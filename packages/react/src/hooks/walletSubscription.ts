/**
 * `WalletSubscription` — singleton manager por wallet address que abre UNA
 * sola conexión `EventSource` al `wallet-stream` Lambda y desmultiplexa los
 * eventos a múltiples subscribers (hooks).
 *
 * Beneficios:
 *  - 3 hooks (`useBalance`, `useWalletActivity`, `useWalletStatus`) sobre la
 *    misma wallet → 1 sola conexión TCP, no 3 polls separados.
 *  - Auto-reconnect cuando el server cierra (default de EventSource — `retry:`).
 *  - Ref-count: la conexión se abre con el primer subscriber y se cierra
 *    cuando no quedan listeners (`useEffect` cleanup en cada hook).
 *  - Eventos cacheados: el último valor recibido de cada tipo se replay-ea
 *    a nuevos subscribers para que no esperen el próximo push.
 *
 * Sin SSE configurado (`walletStreamUrl` vacío) o cuando `EventSource` no
 * existe (SSR / workers), los hooks individuales detectan el flag
 * `unavailable` y caen al polling fallback que ya existe.
 */

export type WalletStreamEventType = 'status' | 'balance' | 'activity' | 'bootstrap';

export interface WalletStreamStatusPayload {
  readonly walletAddress: string | null;
  readonly onChain: boolean | null;
}

/**
 * Fase 17 (2026-07-11) — evento emitido por el `wallet-stream` cuando el
 * `bootstrap-worker` cambia el flag `bootstrapPending` en DDB.
 *
 * Transiciones:
 *  - Al abrir el stream: emite el estado actual (bootstrapping | ready).
 *  - Cuando el worker termina: emite `ready` con el txHash del bootstrap tx.
 */
export interface WalletStreamBootstrapPayload {
  readonly status: 'bootstrapping' | 'ready';
  readonly txHash?: string;
  readonly attemptCount?: number;
}

export interface WalletStreamBalancePayload {
  readonly stroops: string;
  readonly xlm: string;
}

/**
 * Activity tipada lista para renderizar. Cuatro variants:
 *
 *  - `wallet-created`  — deploy inicial del Smart Account.
 *  - `signer-rotated`  — rotación de signer (recovery).
 *  - `transfer-in`     — recibió XLM.
 *  - `transfer-out`    — envió XLM.
 *
 * Otros eventos on-chain (signer_added/removed internos, ruido) se descartan.
 */
export type WalletActivityItem =
  | {
      readonly type: 'wallet-created';
      readonly txHash: string;
      readonly ledger: number;
      readonly timestamp: string | null;
    }
  | {
      readonly type: 'signer-rotated';
      readonly txHash: string;
      readonly ledger: number;
      readonly timestamp: string | null;
      readonly newOwnerEd25519Hex: string;
    }
  | {
      readonly type: 'transfer-in';
      readonly txHash: string;
      readonly ledger: number;
      readonly timestamp: string | null;
      readonly from: string;
      readonly amountStroops: string;
    }
  | {
      readonly type: 'transfer-out';
      readonly txHash: string;
      readonly ledger: number;
      readonly timestamp: string | null;
      readonly to: string;
      readonly amountStroops: string;
    };

export interface WalletStreamActivityPayload {
  readonly events: readonly WalletActivityItem[];
}

type Listener<T> = (payload: T) => void;

interface InternalSubscription {
  status: Set<Listener<WalletStreamStatusPayload>>;
  balance: Set<Listener<WalletStreamBalancePayload>>;
  activity: Set<Listener<WalletStreamActivityPayload>>;
  bootstrap: Set<Listener<WalletStreamBootstrapPayload>>;
}

interface WalletSubscriptionState {
  readonly walletAddress: string;
  readonly url: string;
  eventSource: EventSource | null;
  listeners: InternalSubscription;
  lastStatus: WalletStreamStatusPayload | null;
  lastBalance: WalletStreamBalancePayload | null;
  lastBootstrap: WalletStreamBootstrapPayload | null;
  /** Acumulamos los últimos eventos para que nuevos subscribers vean histórico. */
  activityBuffer: WalletActivityItem[];
  refCount: number;
}

const ACTIVITY_BUFFER_MAX = 50;

const subscriptions = new Map<string, WalletSubscriptionState>();

function buildSubscriptionUrl(streamUrl: string, walletAddress: string): string {
  // Lambda Function URL ya trae trailing slash en algunos casos — normalizamos.
  const base = streamUrl.replace(/\/$/, '');
  return `${base}/?walletAddress=${encodeURIComponent(walletAddress)}`;
}

function openConnection(state: WalletSubscriptionState): void {
  if (state.eventSource) return;
  if (typeof EventSource === 'undefined') return;

  let es: EventSource;
  try {
    es = new EventSource(state.url, { withCredentials: false });
  } catch (err) {
    console.warn('[walletSubscription] EventSource construction failed', err);
    return;
  }
  state.eventSource = es;

  es.addEventListener('status', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as WalletStreamStatusPayload;
      state.lastStatus = data;
      for (const listener of state.listeners.status) listener(data);
    } catch {
      /* ignore malformed */
    }
  });

  es.addEventListener('balance', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as WalletStreamBalancePayload;
      state.lastBalance = data;
      for (const listener of state.listeners.balance) listener(data);
    } catch {
      /* ignore malformed */
    }
  });

  es.addEventListener('activity', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as WalletStreamActivityPayload;
      // Acumula al buffer (más reciente primero). Trim al max.
      const merged = [...data.events, ...state.activityBuffer];
      // Dedup por txHash + ledger.
      const seen = new Set<string>();
      const deduped: WalletActivityItem[] = [];
      for (const item of merged) {
        const key = `${item.txHash}:${item.ledger}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
        if (deduped.length >= ACTIVITY_BUFFER_MAX) break;
      }
      state.activityBuffer = deduped;
      for (const listener of state.listeners.activity) {
        listener({ events: state.activityBuffer });
      }
    } catch {
      /* ignore malformed */
    }
  });

  es.addEventListener('bootstrap', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data) as WalletStreamBootstrapPayload;
      state.lastBootstrap = data;
      for (const listener of state.listeners.bootstrap) listener(data);
    } catch {
      /* ignore malformed */
    }
  });

  es.addEventListener('close', () => {
    // El server cerró por timeout de budget — EventSource reconectará solo.
    // No hacemos nada acá.
  });

  es.onerror = () => {
    // Network blip o end-of-stream. EventSource auto-reconecta por default,
    // pero si la URL no funciona (404, CORS) el browser cierra para siempre.
    // No cerramos nosotros para dejar que el browser lo intente.
  };
}

function closeConnection(state: WalletSubscriptionState): void {
  if (!state.eventSource) return;
  state.eventSource.close();
  state.eventSource = null;
}

function getOrCreateSubscription(
  streamUrl: string,
  walletAddress: string,
): WalletSubscriptionState {
  const existing = subscriptions.get(walletAddress);
  if (existing) return existing;
  const state: WalletSubscriptionState = {
    walletAddress,
    url: buildSubscriptionUrl(streamUrl, walletAddress),
    eventSource: null,
    listeners: {
      status: new Set(),
      balance: new Set(),
      activity: new Set(),
      bootstrap: new Set(),
    },
    lastStatus: null,
    lastBalance: null,
    lastBootstrap: null,
    activityBuffer: [],
    refCount: 0,
  };
  subscriptions.set(walletAddress, state);
  return state;
}

/**
 * Suscribirse a un tipo de evento de la wallet. Devuelve una función
 * de cleanup que el caller (típicamente `useEffect`) debe llamar para
 * desuscribir y, eventualmente, cerrar la conexión SSE.
 *
 * Si SSE no está disponible (URL vacía, EventSource undefined), devuelve
 * `null` para indicar al caller que use el fallback de polling.
 */
export function subscribeToWalletEvent<T extends WalletStreamEventType>(
  streamUrl: string,
  walletAddress: string,
  eventType: T,
  listener: T extends 'status'
    ? Listener<WalletStreamStatusPayload>
    : T extends 'balance'
      ? Listener<WalletStreamBalancePayload>
      : T extends 'bootstrap'
        ? Listener<WalletStreamBootstrapPayload>
        : Listener<WalletStreamActivityPayload>,
): (() => void) | null {
  if (!streamUrl || typeof EventSource === 'undefined') return null;

  const state = getOrCreateSubscription(streamUrl, walletAddress);
  state.refCount += 1;

  // Registrar listener (cast a través del shape conocido).
  (state.listeners[eventType] as Set<typeof listener>).add(listener);

  // Replay del último valor cacheado para que el subscriber tenga data inmediata.
  if (eventType === 'status' && state.lastStatus) {
    (listener as Listener<WalletStreamStatusPayload>)(state.lastStatus);
  } else if (eventType === 'balance' && state.lastBalance) {
    (listener as Listener<WalletStreamBalancePayload>)(state.lastBalance);
  } else if (eventType === 'activity' && state.activityBuffer.length > 0) {
    (listener as Listener<WalletStreamActivityPayload>)({
      events: state.activityBuffer,
    });
  } else if (eventType === 'bootstrap' && state.lastBootstrap) {
    (listener as Listener<WalletStreamBootstrapPayload>)(state.lastBootstrap);
  }

  // Abrir conexión si es el primer subscriber.
  if (!state.eventSource) openConnection(state);

  return () => {
    (state.listeners[eventType] as Set<typeof listener>).delete(listener);
    state.refCount -= 1;
    if (state.refCount <= 0) {
      closeConnection(state);
      subscriptions.delete(walletAddress);
    }
  };
}

/**
 * Cierra TODAS las conexiones SSE activas. Útil para tests o cuando el user
 * cierra sesión y querés limpiar conexiones colgadas. Llamar en `auth.signOut`
 * lo tienen pendiente como mejora — por ahora el cleanup natural de los
 * unmount basta.
 */
export function closeAllWalletSubscriptions(): void {
  for (const state of subscriptions.values()) closeConnection(state);
  subscriptions.clear();
}
