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
 * Styling: **inline styles** para todo el layout crítico (posicionamiento,
 * dimensiones, aspect-ratio, colores base). El componente funciona
 * sin depender de que el integrador tenga Tailwind configurado ni escanee
 * el kit en su content path. Los tokens de color respetan la paleta lavanda
 * del kit con fallback dark-friendly.
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
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          borderRadius: 20,
          background: '#0f0f1a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
          color: '#f5f5f5',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            {props.title ?? 'Escanear QR'}
          </h3>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#aaa',
              fontSize: 12,
              padding: '6px 10px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Cerrar
          </button>
        </div>

        {/* Contenedor cuadrado sin depender de `aspect-square` de Tailwind.
            El truco `paddingTop: 100%` fuerza height = width. */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            paddingTop: '100%',
            background: '#000',
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
          {starting && !error ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                color: 'rgba(255, 255, 255, 0.8)',
              }}
            >
              Iniciando cámara…
            </div>
          ) : null}
          {error ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 24,
                background: 'rgba(0, 0, 0, 0.65)',
              }}
            >
              <p style={{ margin: 0, fontSize: 13, color: '#fff' }}>{error}</p>
            </div>
          ) : null}
        </div>

        <p style={{ margin: 0, padding: '12px 16px', fontSize: 12, color: '#888' }}>
          {props.hint ??
            'Apunta la cámara al código. Detectamos direcciones Stellar (G…, C…) y URIs SEP-0007.'}
        </p>
      </div>
    </div>
  );
}
