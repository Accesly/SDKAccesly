'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * `<QrScanModal>` — overlay full-screen para escanear QR con la cámara del
 * device. Usado por `<SendFlow>` para el flow "Escanear QR" pero exportado
 * por el kit para que integradores puedan reusarlo en otros pantallas.
 *
 * Comportamiento:
 *   1. Al montar, pide permission de la cámara y arranca el video.
 *   2. Detecta QR en cada frame vía `qr-scanner` (WebAssembly).
 *   3. Al detectar, llama `onResult(text)` y cierra automáticamente.
 *   4. Si el user cancela o niega permission, llama `onClose()`.
 *
 * Cámara: `environment` facing (trasera en móvil). Si no está disponible cae
 * a la default. HTTPS obligatorio — en HTTP el prompt de permission no
 * aparece (política de browsers).
 *
 * UI: sigue el mismo estilo Tailwind que el resto del kit (rounded-xl,
 * bordes neutros, dark-mode friendly).
 */
export interface QrScanModalProps {
  readonly onResult: (raw: string) => void;
  readonly onClose: () => void;
  /** Texto de encabezado. Default: "Escanear QR". */
  readonly title?: string;
  /** Texto descriptivo debajo del video. Default: instrucciones genéricas. */
  readonly hint?: string;
}

export function QrScanModal(props: QrScanModalProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<{ stop: () => void; destroy: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!videoRef.current) return;
      try {
        // Dynamic import — la librería incluye un worker, la cargamos on-demand
        // para no penalizar el bundle inicial del kit.
        const { default: QrScanner } = await import('qr-scanner');

        const scanner = new QrScanner(
          videoRef.current,
          (result) => {
            if (cancelled) return;
            const text = typeof result === 'string' ? result : result.data;
            if (!text) return;
            props.onResult(text);
          },
          {
            preferredCamera: 'environment',
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 5,
          },
        );

        if (cancelled) {
          scanner.destroy();
          return;
        }
        await scanner.start();
        scannerRef.current = scanner;
        setStarting(false);
      } catch (err) {
        if (cancelled) return;
        setStarting(false);
        // Errores típicos: NotAllowedError (permission denied),
        // NotFoundError (sin cámara), NotSupportedError (no HTTPS), etc.
        const msg =
          err instanceof Error
            ? err.name === 'NotAllowedError'
              ? 'Permite el acceso a la cámara para escanear.'
              : err.name === 'NotFoundError'
                ? 'No detectamos ninguna cámara en este dispositivo.'
                : err.message
            : 'No se pudo iniciar la cámara.';
        setError(msg);
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
    // Solo montamos el scanner una vez por instancia del modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.title ?? 'Escanear QR'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
          <h3 className="text-sm font-semibold">{props.title ?? 'Escanear QR'}</h3>
          <button
            type="button"
            onClick={props.onClose}
            className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 px-2 py-1 rounded-lg"
            aria-label="Cerrar"
          >
            Cerrar
          </button>
        </div>

        <div className="relative aspect-square bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
          />
          {starting && !error ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/80">
              Iniciando cámara…
            </div>
          ) : null}
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-center px-6">
              <p className="text-sm text-white">{error}</p>
            </div>
          ) : null}
        </div>

        <p className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
          {props.hint ??
            'Apunta la cámara al código. Detectamos direcciones Stellar (G…, C…) y URIs SEP-0007.'}
        </p>
      </div>
    </div>
  );
}
