import { NextRequest } from 'next/server';
import { getLiveSnapshot, subscribeLiveEvents } from '@/lib/liveEvents';
import type { LiveEvent } from '@/types/liveEvent';

/**
 * Stream SSE del monitor en vivo.
 *
 * `runtime = 'nodejs'` es obligatorio, no decorativo: el bus comparte proceso
 * con `providerBridge` y `mcpClient`, que usan `child_process`.
 *
 * NO se declara `export const dynamic`. Los Route Handlers no se cachean por
 * defecto desde Next 15, y ese flag desaparece con Cache Components.
 */
export const runtime = 'nodejs';

/** Latido para que proxies y navegadores no den la conexión por muerta. */
const HEARTBEAT_MS = 15_000;
/**
 * Más pestañas abiertas que esto y algo va mal: cada una es un suscriptor y,
 * además, cada una corre su propio sondeo de Telegram.
 */
const MAX_CONNECTIONS = 8;

const CONNECTIONS_KEY = Symbol.for('aether.liveStreamConnections');
type CounterHolder = typeof globalThis & { [CONNECTIONS_KEY]?: { count: number } };

function connections(): { count: number } {
  const holder = globalThis as CounterHolder;
  holder[CONNECTIONS_KEY] ??= { count: 0 };
  return holder[CONNECTIONS_KEY];
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest) {
  const counter = connections();
  if (counter.count >= MAX_CONNECTIONS) {
    return new Response('Demasiadas conexiones al monitor en vivo.', { status: 503 });
  }

  const encoder = new TextEncoder();
  counter.count += 1;

  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  // Idempotente a propósito: Next aborta `request.signal` y además invoca
  // `cancel()` del stream cuando el cliente se va. Las dos rutas pasan por aquí.
  const cleanup = () => {
    if (closed) return;
    closed = true;
    counter.count = Math.max(0, counter.count - 1);
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Encolar tras el cierre lanza. Es la fuga clásica del latido.
          cleanup();
        }
      };

      // Suscribirse ANTES del snapshot: al revés se perdería lo que ocurra
      // entre ambos. El solape lo resuelve el cliente descartando por `seq`.
      unsubscribe = subscribeLiveEvents((event: LiveEvent) => {
        // `desiredSize <= 0` significa que el cliente no está drenando (portátil
        // suspendido con la pestaña abierta). Se sacrifican los pasos de
        // pensamiento, que son los ruidosos, y se conserva el esqueleto.
        if ((controller.desiredSize ?? 1) <= 0 && event.type === 'thought') return;
        send(frame('live', event));
      });

      // El snapshot se encola de forma SÍNCRONA: Next solo vuelca las cabeceras
      // en la primera escritura, así que sin esto `EventSource.onopen` no
      // dispara y una conexión ociosa parece colgada.
      send('retry: 5000\n\n');
      send(frame('snapshot', getLiveSnapshot()));

      heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);

      req.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // `no-transform` desactiva el middleware `compression` de Next, que corre
      // en dev y en producción y bufearía los eventos.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
