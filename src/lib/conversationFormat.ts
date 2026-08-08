import {
  ConversationMessage,
  FLAT_TRANSCRIPT_MAX_CHARS,
} from '@/types/conversation';

/**
 * Traduce el historial (texto plano) al formato de mensajes de cada proveedor.
 *
 * Módulo puro a propósito: no usa nada de Node, así que lo pueden importar
 * tanto el motor en el navegador como el puente en el servidor.
 */

/** Gemini usa 'model' donde el resto usa 'assistant'. */
export function toGeminiContents(
  history: ConversationMessage[]
): Array<Record<string, unknown>> {
  return history.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));
}

/**
 * Los turnos previos van como string plano. Anthropic los acepta conviviendo
 * en el mismo array con los turnos de bloques que empuja el bucle de tools.
 */
export function toAnthropicMessages(
  history: ConversationMessage[]
): Array<{ role: string; content: unknown }> {
  return history.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export function toOpenAIMessages(
  history: ConversationMessage[]
): Array<{ role: string; content: string }> {
  return history.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

const TRUNCATION_NOTICE = '[… turnos anteriores omitidos por longitud …]';

/**
 * Aplana la conversación a un único string, para los dos proveedores que no
 * tienen array de mensajes: el binario `copilot` y `claude -p`.
 *
 * Con `history` vacío produce **exactamente** el formato de antes
 * (`systemPrompt\n\n---\n\ncurrentPrompt`), para no regresionar el caso
 * one-shot.
 *
 * El resultado viaja por argv, así que se trunca por el principio: con
 * historial largo más el contexto de MCP se puede rozar el ARG_MAX del sistema.
 */
export function flattenTranscript(
  history: ConversationMessage[],
  currentPrompt: string,
  systemPrompt?: string
): string {
  const header = systemPrompt?.trim() ? `${systemPrompt}\n\n---\n\n` : '';

  if (!history.length) {
    return `${header}${currentPrompt}`;
  }

  const label = (message: ConversationMessage) =>
    message.role === 'assistant' ? 'Asistente' : 'Usuario';

  // Presupuesto para el bloque de conversación previa: lo que quede tras el
  // system prompt y el mensaje actual, que son innegociables.
  const fixedChars = header.length + currentPrompt.length + 80;
  const budget = FLAT_TRANSCRIPT_MAX_CHARS - fixedChars;

  const turns: string[] = [];
  let used = 0;
  let truncated = false;

  // Se recorre del más reciente al más antiguo: si hay que cortar, se pierde
  // lo viejo, no lo que acaba de decirse.
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = `${label(history[i])}: ${history[i].content}`;
    if (budget > 0 && used + turn.length + 2 > budget) {
      truncated = true;
      break;
    }
    turns.unshift(turn);
    used += turn.length + 2;
  }

  if (!turns.length) {
    return `${header}${currentPrompt}`;
  }

  const previous = [truncated ? TRUNCATION_NOTICE : null, ...turns]
    .filter(Boolean)
    .join('\n\n');

  return `${header}[CONVERSACIÓN PREVIA]\n\n${previous}\n\n---\n\n[MENSAJE ACTUAL]\n\nUsuario: ${currentPrompt}`;
}
