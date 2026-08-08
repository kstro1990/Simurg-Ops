/**
 * Conversaciones multi-turno.
 *
 * INVARIANTE: aquí solo viaja **texto plano**. Ningún objeto del proveedor
 * (los `parts` de Gemini con su `thoughtSignature`, los bloques de Anthropic
 * con thinking dentro) se guarda nunca en un `ConversationMessage`. Esos
 * objetos hay que devolverlos verbatim, y solo se puede garantizar dentro de
 * una única llamada a `runAgentEngine`; cachearlos entre peticiones reintroduce
 * los 400 que documenta CLAUDE.md.
 */

export type ConversationRole = 'user' | 'assistant';

export interface ConversationMessage {
  role: ConversationRole;
  /** Texto plano. Nunca bloques del proveedor. */
  content: string;
  /** ISO. */
  timestamp: string;
  /** Enlace opcional al ExecutionRun de history.json (solo en 'assistant'). */
  runId?: string;
  /** true si la produjo el simulador. Se guarda, pero NO se realimenta. */
  simulated?: boolean;
}

export interface ConversationThread {
  agentId: string;
  /** 'web' | `tg:${chatId}` */
  threadKey: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

/** Clave del mapa en disco: `${agentId}::${threadKey}`. */
export type ConversationStore = Record<string, ConversationThread>;

export const WEB_THREAD_KEY = 'web';

export const telegramThreadKey = (chatId: string | number): string => `tg:${chatId}`;

export const conversationId = (agentId: string, threadKey: string): string =>
  `${agentId}::${threadKey}`;

/** Turnos por defecto cuando el agente no trae el campo. */
export const DEFAULT_MEMORY_TURNS = 6;
/** Tope de turnos configurable por agente. */
export const MAX_MEMORY_TURNS = 20;
/**
 * Mensajes retenidos por hilo en disco. Deliberadamente mayor que cualquier
 * `memoryTurns` plausible: subir la memoria de un agente recupera contexto
 * antiguo en vez de encontrárselo ya borrado.
 */
export const CONVERSATION_MESSAGE_CAP = 60;
/** Hilos totales retenidos; se desalojan por `updatedAt` más antiguo. */
export const CONVERSATION_THREAD_CAP = 200;
/** Tope de caracteres del transcript aplanado (copilot / claude -p, van por argv). */
export const FLAT_TRANSCRIPT_MAX_CHARS = 12_000;

export function resolveMemoryTurns(memoryTurns?: number): number {
  if (typeof memoryTurns !== 'number' || !Number.isFinite(memoryTurns)) {
    return DEFAULT_MEMORY_TURNS;
  }
  return Math.max(0, Math.min(MAX_MEMORY_TURNS, Math.floor(memoryTurns)));
}

/**
 * Recorta el historial a los últimos N turnos (1 turno = user + assistant) y
 * garantiza que la secuencia resultante está bien formada.
 *
 * Es el **único** guardián de esa invariante: tanto Gemini como Anthropic
 * responden 400 duro si la conversación empieza por 'assistant' o si hay dos
 * mensajes seguidos del mismo rol.
 */
export function selectContextMessages(
  messages: ConversationMessage[],
  memoryTurns: number
): ConversationMessage[] {
  if (!Array.isArray(messages) || memoryTurns <= 0) return [];

  // El texto simulado no es salida de un modelo: realimentarlo haría que el
  // agente construyera sobre su propia invención.
  const real = messages.filter((m) => !m.simulated && m?.content?.trim());

  // Colapsa roles consecutivos quedándose con el último de cada racha.
  const alternating: ConversationMessage[] = [];
  for (const message of real) {
    const previous = alternating[alternating.length - 1];
    if (previous && previous.role === message.role) {
      alternating[alternating.length - 1] = message;
    } else {
      alternating.push(message);
    }
  }

  // Un 'assistant' inicial no tiene turno de usuario al que responder.
  while (alternating.length > 0 && alternating[0].role === 'assistant') {
    alternating.shift();
  }

  // Un 'user' final es una pregunta que nunca se respondió (p. ej. porque su
  // respuesta era simulada y se acaba de filtrar). Reenviarla dejaría dos
  // turnos de usuario seguidos en cuanto el llamante añada el turno actual.
  while (alternating.length > 0 && alternating[alternating.length - 1].role === 'user') {
    alternating.pop();
  }

  const windowed = alternating.slice(-(memoryTurns * 2));

  // El recorte puede haber dejado un 'assistant' huérfano al principio.
  while (windowed.length > 0 && windowed[0].role === 'assistant') {
    windowed.shift();
  }

  return windowed;
}
