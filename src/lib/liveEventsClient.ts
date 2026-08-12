'use client';

import type {
  LiveEvent,
  LiveEventInput,
  LiveSnapshot,
  LiveTrace,
} from '@/types/liveEvent';

/**
 * Lado cliente del monitor en vivo.
 *
 * Dos piezas independientes:
 *
 * 1. `postLiveEvent()` — emisión. Los motores corren en el navegador, así que
 *    sus callbacks de progreso no pueden llamar al bus directamente y publican
 *    por HTTP contra `/api/events/publish`. Es telemetría: si falla, la
 *    ejecución sigue igual.
 * 2. `liveStore` — recepción. Un único `EventSource` con recuento de
 *    referencias, fuera de React, que expone `subscribe`/`getSnapshot` para
 *    `useSyncExternalStore`. Deliberadamente NO vive en `page.tsx`: ese
 *    componente renderiza toda la app sin memoizar, y un evento por paso
 *    repintaría un `ExecutionPanel` a media ejecución.
 */

// ---------------------------------------------------------------- emisión

let queue: LiveEventInput[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const FLUSH_MS = 120;
const MAX_BATCH = 50;

function flushQueue(): void {
  flushTimer = null;
  if (queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);

  fetch('/api/events/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
    keepalive: true,
  }).catch(() => {
    // El monitor es un extra. Un fallo aquí no puede ensuciar la consola ni
    // afectar a la ejecución que se está monitorizando.
  });

  if (queue.length > 0) flushTimer = setTimeout(flushQueue, FLUSH_MS);
}

/** Encola un evento hacia el bus del servidor. No espera respuesta. */
export function postLiveEvent(event: LiveEventInput): void {
  if (typeof window === 'undefined') return;
  queue.push(event);
  if (queue.length >= MAX_BATCH) {
    if (flushTimer) clearTimeout(flushTimer);
    flushQueue();
    return;
  }
  flushTimer ??= setTimeout(flushQueue, FLUSH_MS);
}

export function newTraceId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------- recepción

/** Trazas que se conservan en pantalla, terminadas incluidas. */
const MAX_CLIENT_TRACES = 50;
const NOTIFY_MS = 100;

export type LiveConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface LiveStoreSnapshot {
  traces: LiveTrace[];
  connection: LiveConnectionState;
  serverStartedAt: string | null;
  subscribers: number;
}

const EMPTY: LiveStoreSnapshot = {
  traces: [],
  connection: 'idle',
  serverStartedAt: null,
  subscribers: 0,
};

/**
 * Reproduce el evento sobre la lista local. A diferencia del bus del servidor,
 * aquí una traza terminada NO se borra: es lo que el operador acaba de ver.
 */
function applyEvent(traces: LiveTrace[], event: LiveEvent): LiveTrace[] {
  if (event.type === 'run_start') {
    const trace: LiveTrace = {
      traceId: event.traceId,
      source: event.source,
      targetKind: event.targetKind,
      targetId: event.targetId,
      targetName: event.targetName,
      targetAvatar: event.targetAvatar,
      prompt: event.prompt,
      telegramChatId: event.telegramChatId,
      totalSteps: event.totalSteps,
      startedAt: event.at,
      updatedAt: event.at,
      status: 'running',
      events: [event],
      droppedEvents: 0,
    };
    return [trace, ...traces.filter((t) => t.traceId !== event.traceId)].slice(
      0,
      MAX_CLIENT_TRACES
    );
  }

  const index = traces.findIndex((t) => t.traceId === event.traceId);
  // Evento huérfano: el bus se reinició a media ejecución o la traza ya se
  // desalojó. Se ignora en vez de inventar una tarjeta sin cabecera.
  if (index === -1) return traces;

  const previous = traces[index];
  if (previous.events.some((e) => e.seq === event.seq)) return traces;

  const updated: LiveTrace = {
    ...previous,
    updatedAt: event.at,
    events: [...previous.events, event],
    ...(event.type === 'dropped'
      ? { droppedEvents: previous.droppedEvents + event.count }
      : {}),
    ...(event.type === 'run_end'
      ? { status: event.status, endedAt: event.at }
      : {}),
  };

  const next = [...traces];
  next[index] = updated;
  return next;
}

/**
 * Funde el snapshot de reconexión con lo que ya hay en pantalla: las trazas
 * vivas las manda el servidor, las terminadas solo existen aquí.
 */
function mergeSnapshot(local: LiveTrace[], snapshot: LiveTrace[]): LiveTrace[] {
  const fromServer = new Map(snapshot.map((t) => [t.traceId, t]));
  const kept = local.filter((t) => !fromServer.has(t.traceId));
  return [...snapshot, ...kept]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, MAX_CLIENT_TRACES);
}

function createStore() {
  let snapshot: LiveStoreSnapshot = EMPTY;
  let source: EventSource | null = null;
  let refCount = 0;
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  /**
   * Las notificaciones se agrupan: un pipeline hablador emitiría decenas de
   * eventos por segundo y cada uno provocaría un render.
   */
  const notify = () => {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      for (const listener of listeners) listener();
    }, NOTIFY_MS);
  };

  const patch = (next: Partial<LiveStoreSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    notify();
  };

  const connect = () => {
    if (source || typeof window === 'undefined') return;
    patch({ connection: 'connecting' });

    const es = new EventSource('/api/events/stream');
    source = es;

    es.onopen = () => patch({ connection: 'open' });

    // `EventSource` reconecta solo; solo hay que reflejarlo en la UI.
    es.onerror = () => patch({ connection: 'reconnecting' });

    es.addEventListener('snapshot', (message) => {
      try {
        const data = JSON.parse((message as MessageEvent<string>).data) as LiveSnapshot;
        patch({
          connection: 'open',
          serverStartedAt: data.serverStartedAt,
          subscribers: data.subscribers,
          traces: mergeSnapshot(snapshot.traces, data.traces),
        });
      } catch {
        /* trama corrupta: se ignora */
      }
    });

    es.addEventListener('live', (message) => {
      try {
        const event = JSON.parse((message as MessageEvent<string>).data) as LiveEvent;
        patch({ traces: applyEvent(snapshot.traces, event) });
      } catch {
        /* trama corrupta: se ignora */
      }
    });
  };

  const disconnect = () => {
    source?.close();
    source = null;
    patch({ connection: 'idle' });
  };

  return {
    /**
     * El recuento de referencias es lo que hace inocuo el doble efecto de
     * StrictMode y permite que la conexión sobreviva a los cambios de pestaña.
     */
    acquire(): () => void {
      refCount += 1;
      connect();
      return () => {
        refCount -= 1;
        if (refCount <= 0) {
          refCount = 0;
          disconnect();
        }
      };
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Devuelve SIEMPRE la misma referencia hasta que algo cambia. */
    getSnapshot(): LiveStoreSnapshot {
      return snapshot;
    },
    getServerSnapshot(): LiveStoreSnapshot {
      return EMPTY;
    },
    clear(): void {
      patch({ traces: [] });
    },
  };
}

type LiveStore = ReturnType<typeof createStore>;

const STORE_KEY = Symbol.for('aether.liveStore');
type StoreHolder = typeof globalThis & { [STORE_KEY]?: LiveStore };

/** Fijado en `globalThis` por el mismo motivo que el bus: recarga en caliente. */
function getStore(): LiveStore {
  const holder = globalThis as StoreHolder;
  holder[STORE_KEY] ??= createStore();
  return holder[STORE_KEY];
}

export const liveStore = {
  acquire: () => getStore().acquire(),
  subscribe: (listener: () => void) => getStore().subscribe(listener),
  getSnapshot: () => getStore().getSnapshot(),
  getServerSnapshot: () => getStore().getServerSnapshot(),
  clear: () => getStore().clear(),
};
