import {
  LIVE_TEXT_CAP,
  type LiveEvent,
  type LiveEventInput,
  type LiveSnapshot,
  type LiveTrace,
} from '@/types/liveEvent';

/**
 * Bus en memoria del monitor en vivo.
 *
 * Solo servidor: lo consumen `/api/events/stream`, `/api/events/publish` y los
 * productores que ya corren en el proceso Node (`telegramService`, las rutas de
 * ejecución). Los motores compartidos (`agentEngine`, `workflowEngine`) NO
 * deben importarlo: se ejecutan también en el navegador, y ahí no hay bus. Esa
 * es la misma razón por la que `bridgeFn` y `mcpFn` se inyectan.
 *
 * Nada de esto se persiste. `data/history.json` es el registro de auditoría;
 * esto es una consola de operación y muere con el proceso, a propósito.
 */

/** Peticiones en curso que se guardan a la vez. Se desaloja la más antigua. */
const MAX_ACTIVE_TRACES = 20;
/** Eventos por traza. Un bucle agéntico largo no puede crecer sin techo. */
const MAX_EVENTS_PER_TRACE = 200;
/**
 * Una traza sin `run_end` (proceso reiniciado, excepción fuera del try) se
 * quedaría colgada para siempre. Se barre por silencio.
 */
const TRACE_TTL_MS = 10 * 60 * 1000;

type Listener = (event: LiveEvent) => void;

interface LiveBus {
  version: number;
  seq: number;
  listeners: Set<Listener>;
  traces: Map<string, LiveTrace>;
  startedAt: string;
}

const BUS_VERSION = 1;
const BUS_KEY = Symbol.for('aether.liveEventBus');

type BusHolder = typeof globalThis & { [BUS_KEY]?: LiveBus };

/**
 * El bus se fija en `globalThis` porque Turbopack reevalúa los módulos del
 * servidor al recargar en caliente. Sin esto quedarían dos buses vivos: los
 * productores publicarían en uno y el stream escucharía en el otro. Se versiona
 * para que un cambio de forma no reviente contra un bus viejo del mismo proceso.
 */
function getBus(): LiveBus {
  const holder = globalThis as BusHolder;
  const existing = holder[BUS_KEY];
  if (existing && existing.version === BUS_VERSION) return existing;

  const bus: LiveBus = {
    version: BUS_VERSION,
    seq: 0,
    listeners: new Set(),
    traces: new Map(),
    startedAt: new Date().toISOString(),
  };
  holder[BUS_KEY] = bus;
  return bus;
}

function truncate(text: unknown): string {
  const value = typeof text === 'string' ? text : String(text ?? '');
  return value.length > LIVE_TEXT_CAP ? `${value.slice(0, LIVE_TEXT_CAP)}…` : value;
}

/**
 * Recorta cada campo de texto antes de publicar. Doble motivo: el monitor no
 * tiene por qué transportar salidas completas de modelo, y así se evita que un
 * productor descuidado meta un objeto de configuración entero en el bus.
 */
function sanitize(input: LiveEventInput): LiveEventInput {
  switch (input.type) {
    case 'run_start':
      return { ...input, prompt: truncate(input.prompt) };
    case 'step_result':
      return {
        ...input,
        output: truncate(input.output),
        ...(input.error ? { error: truncate(input.error) } : {}),
      };
    case 'thought':
      return {
        ...input,
        step: {
          ...input.step,
          content: truncate(input.step.content),
          ...(input.step.toolResult ? { toolResult: truncate(input.step.toolResult) } : {}),
        },
      };
    case 'run_end':
      return {
        ...input,
        finalOutput: truncate(input.finalOutput),
        ...(input.error ? { error: truncate(input.error) } : {}),
      };
    default:
      return input;
  }
}

function sweepStaleTraces(bus: LiveBus, now: number): void {
  for (const [traceId, trace] of bus.traces) {
    if (now - Date.parse(trace.updatedAt) > TRACE_TTL_MS) {
      bus.traces.delete(traceId);
    }
  }
}

function applyToTrace(bus: LiveBus, event: LiveEvent): void {
  if (event.type === 'run_start') {
    if (bus.traces.size >= MAX_ACTIVE_TRACES) {
      const oldest = [...bus.traces.values()].sort(
        (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)
      )[0];
      if (oldest) bus.traces.delete(oldest.traceId);
    }
    bus.traces.set(event.traceId, {
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
    });
    return;
  }

  const trace = bus.traces.get(event.traceId);
  // Un evento suelto sin `run_start` (bus reiniciado a media ejecución) se
  // emite igual a los suscriptores, pero no resucita la traza.
  if (!trace) return;

  trace.updatedAt = event.at;
  if (trace.events.length >= MAX_EVENTS_PER_TRACE) {
    trace.events.shift();
    trace.droppedEvents += 1;
  }
  trace.events.push(event);

  if (event.type === 'run_end') {
    trace.status = event.status;
    trace.endedAt = event.at;
    // Terminada deja de estar "en curso": el usuario pidió flujo en vivo, no
    // un búfer de lo ya ocurrido. El evento sí llega a quien esté conectado.
    bus.traces.delete(event.traceId);
  }
}

/**
 * Publica un evento. **Nunca lanza**: un suscriptor roto no puede tumbar un bot
 * de Telegram. Mismo principio de degradar-sin-abortar que MCP.
 */
export function publishLiveEvent(input: LiveEventInput): void {
  try {
    const bus = getBus();
    const now = Date.now();
    sweepStaleTraces(bus, now);

    bus.seq += 1;
    const event = {
      ...sanitize(input),
      seq: bus.seq,
      at: new Date(now).toISOString(),
    } as LiveEvent;

    applyToTrace(bus, event);

    for (const listener of bus.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[liveEvents] suscriptor falló', error);
      }
    }
  } catch (error) {
    console.error('[liveEvents] no se pudo publicar', error);
  }
}

export function subscribeLiveEvents(listener: Listener): () => void {
  const bus = getBus();
  bus.listeners.add(listener);
  // Se quita exactamente esta función: tras un recarga en caliente pueden
  // convivir cierres viejos de conexiones muertas.
  return () => {
    bus.listeners.delete(listener);
  };
}

export function getLiveSnapshot(): LiveSnapshot {
  const bus = getBus();
  sweepStaleTraces(bus, Date.now());
  return {
    traces: [...bus.traces.values()].sort(
      (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)
    ),
    subscribers: bus.listeners.size,
    serverStartedAt: bus.startedAt,
  };
}

export function newTraceId(): string {
  return crypto.randomUUID();
}
