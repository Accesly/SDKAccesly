/**
 * `useBalance(walletAddress?)` — devuelve el balance XLM del Smart Account
 * con push real-time vía SSE.
 *
 * Si SSE está configurado (env tiene `walletStreamUrl` y `EventSource` existe),
 * el hook se suscribe al canal `balance` del `wallet-stream` Lambda y se
 * actualiza instantáneamente cuando cambia el balance on-chain.
 *
 * Fallback automático a polling cada 10s si SSE no está disponible (entorno
 * que no lo soporta o backend self-hosteado sin el endpoint).
 *
 * El `walletAddress` se auto-resuelve desde el `DeviceStore` si no se pasa
 * (cubrir el caso "wallet del user actual sin tener que pasarla a mano").
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccesly } from './useAccesly.js';
import { ENVIRONMENT_DEFAULTS } from '../config.js';
import { subscribeToWalletEvent } from './walletSubscription.js';

const POLL_FALLBACK_MS = 10_000;

function useStableRef<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export interface UseBalanceResult {
  /** Stroops como string base-10. `null` mientras se carga o no hay address. */
  readonly stroops: string | null;
  /** Mismo balance como string decimal en XLM. `null` mientras se carga. */
  readonly xlm: string | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Fuerza fetch HTTP inmediato (útil tras una operación del user). */
  refresh(): Promise<void>;
}

export function useBalance(walletAddress?: string | null): UseBalanceResult {
  const { wallet, _internal } = useAccesly();
  const username = _internal.username;

  const [resolvedAddress, setResolvedAddress] = useState<string | null>(
    walletAddress ?? null,
  );
  const [stroops, setStroops] = useState<string | null>(null);
  const [xlm, setXlm] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Resolver walletAddress si no fue pasado explícitamente.
  const walletRef = useStableRef(wallet);
  useEffect(() => {
    if (walletAddress) {
      setResolvedAddress(walletAddress);
      return;
    }
    if (!username) {
      setResolvedAddress(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const stored = await walletRef.current.getStoredCredential(username);
        if (cancelled) return;
        setResolvedAddress(stored?.walletAddress ?? null);
      } catch {
        if (!cancelled) setResolvedAddress(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, username, walletRef]);

  // Suscribirse SSE — o si no está, fallback a polling.
  const envDefaults = ENVIRONMENT_DEFAULTS[_internal.env];
  const streamUrl = envDefaults.walletStreamUrl;
  const endpointsRef = useStableRef(_internal.endpoints);

  const doFetchOnce = useCallback(async () => {
    if (!resolvedAddress) return;
    try {
      const res = await endpointsRef.current.walletBalance(resolvedAddress);
      setStroops(res.xlm.stroops);
      setXlm(res.xlm.xlm);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [resolvedAddress, endpointsRef]);

  const doFetchRef = useStableRef(doFetchOnce);
  useEffect(() => {
    if (!resolvedAddress) {
      setIsLoading(false);
      return undefined;
    }

    // Intentar suscripción SSE primero.
    const unsubscribe = subscribeToWalletEvent(
      streamUrl,
      resolvedAddress,
      'balance',
      (data) => {
        setStroops(data.stroops);
        setXlm(data.xlm);
        setError(null);
        setIsLoading(false);
      },
    );

    if (unsubscribe) {
      // SSE conectado — pero hacemos UN fetch HTTP inicial para no esperar
      // hasta el primer push del server (puede tardar 10s).
      void doFetchRef.current();
      return unsubscribe;
    }

    // SSE no disponible → polling fallback.
    void doFetchRef.current();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void doFetchRef.current();
    }, POLL_FALLBACK_MS);

    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (!document.hidden) void doFetchRef.current();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, [resolvedAddress, streamUrl, doFetchRef]);

  const refresh = useCallback(async () => {
    await doFetchRef.current();
  }, [doFetchRef]);

  return { stroops, xlm, isLoading, error, refresh };
}
