import { AgentConfig, ExecutionRun, ProviderKeys } from '@/types/agent';
import { resolveMemoryTurns, telegramThreadKey } from '@/types/conversation';
import { runAgentEngine } from './agentEngine';
import { runProviderBridge } from './providerBridge';
import { listMcpTools, runMcpBridge } from './mcpClient';
import {
  appendConversationTurn,
  getConversationMessages,
  resetConversation,
} from './serverStorage';

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
  can_join_groups?: boolean;
}

export async function verifyTelegramToken(botToken: string): Promise<TelegramBotInfo> {
  const cleanToken = botToken.trim();
  if (!cleanToken) {
    throw new Error('Token de Telegram inválido o vacío.');
  }

  const res = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  const data = await res.json();
  if (!data.ok || !data.result) {
    throw new Error(data.description || 'No se pudo verificar el Token de Telegram.');
  }

  return data.result as TelegramBotInfo;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string
): Promise<boolean> {
  const cleanToken = botToken.trim();
  if (!cleanToken || !chatId) return false;

  // Truncate message if it exceeds Telegram's 4096 character limit per message
  const maxLen = 4000;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.substring(i, i + maxLen));
  }

  for (const chunk of chunks) {
    try {
      await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
        }),
      });
    } catch {
      // Reintento sin parse_mode: el Markdown del modelo puede tener
      // caracteres que Telegram rechaza.
      await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
        }),
      });
    }
  }

  return true;
}

export type TelegramCommand = 'nuevo' | 'start' | 'ayuda';

/**
 * Extrae el comando de un mensaje. El sufijo `@bot` no es opcional de tratar:
 * en grupos Telegram entrega `/nuevo@mi_bot`, y un `text === '/nuevo'` lo
 * tomaría por un prompt cualquiera.
 */
export function parseTelegramCommand(text: string): TelegramCommand | null {
  const match = /^\/(nuevo|start|ayuda)(@\w+)?\b/i.exec(text.trim());
  return match ? (match[1].toLowerCase() as TelegramCommand) : null;
}

/**
 * Atiende un mensaje entrante de Telegram.
 *
 * Devuelve `null` cuando el mensaje era un comando: no hubo ejecución, así que
 * tampoco hay nada que guardar en el historial.
 */
export async function processTelegramAgentRequest(options: {
  agent: AgentConfig;
  userPrompt: string;
  chatId: string | number;
  apiKey?: string;
  providerKeys?: ProviderKeys;
  botToken: string;
}): Promise<ExecutionRun | null> {
  const { agent, userPrompt, chatId, apiKey, providerKeys, botToken } = options;

  // Un hilo por chat: es lo que un usuario espera de un bot.
  const threadKey = telegramThreadKey(chatId);
  const memoryTurns = resolveMemoryTurns(agent.memoryTurns);

  const command = parseTelegramCommand(userPrompt);

  if (command === 'nuevo') {
    await resetConversation(agent.id, threadKey);
    await sendTelegramMessage(
      botToken,
      chatId,
      '🧹 Conversación reiniciada. El agente ya no recuerda los mensajes anteriores.'
    );
    return null;
  }

  if (command === 'start' || command === 'ayuda') {
    await sendTelegramMessage(
      botToken,
      chatId,
      `🤖 *${agent.avatar} ${agent.name}* — ${agent.role}\n\n` +
        `Modelo: ${agent.model}\n` +
        `Memoria: ${memoryTurns === 0 ? 'desactivada' : `últimos ${memoryTurns} turnos`}\n\n` +
        'Comandos:\n' +
        '/nuevo — empezar una conversación nueva\n' +
        '/ayuda — mostrar esta ayuda'
    );
    return null;
  }

  // Aviso inicial de "procesando" al chat de Telegram
  await sendTelegramMessage(
    botToken,
    chatId,
    `🤖 *${agent.name}* está procesando tu solicitud...\n\n_Pensamiento en progreso con modelo ${agent.model}_`
  );

  const history = await getConversationMessages(agent.id, threadKey);

  try {
    const result = await runAgentEngine({
      agent,
      userPrompt,
      history,
      apiKey,
      providerKeys,
      // Esto corre en el servidor: hay que invocar el puente directamente.
      bridgeFn: runProviderBridge,
      mcpFn: runMcpBridge,
      mcpListFn: listMcpTools,
    });

    const simulatedWarning = result.simulated
      ? '\n\n⚠️ _Respuesta SIMULADA: no se pudo contactar con el proveedor._'
      : '';

    const telegramText = `🤖 *${agent.avatar} ${agent.name}* (${agent.role}):\n\n${result.finalOutput}\n\n⏱️ _Latencia: ${result.metrics.latencyMs}ms | Tokens: ${result.metrics.totalTokens}_${simulatedWarning}`;

    await sendTelegramMessage(botToken, chatId, telegramText);

    const runId = 'run-tg-' + Date.now();
    const now = new Date().toISOString();

    // El par usuario+respuesta se guarda junto y de forma atómica: media
    // conversación (solo el turno del usuario) rompería la alternancia de roles
    // y provocaría un 400 en la petición siguiente.
    await appendConversationTurn(agent.id, threadKey, {
      user: { role: 'user', content: userPrompt, timestamp: now },
      assistant: {
        role: 'assistant',
        content: result.finalOutput,
        timestamp: now,
        runId,
        // Se guarda para que la transcripción sea honesta, pero el motor no lo
        // realimenta: el agente no debe construir sobre texto inventado.
        simulated: result.simulated,
      },
    });

    return {
      id: runId,
      agentId: agent.id,
      agentName: agent.name,
      agentAvatar: agent.avatar,
      agentRole: agent.role,
      prompt: userPrompt,
      status: 'completed',
      steps: result.steps,
      finalOutput: result.finalOutput,
      metrics: result.metrics,
      timestamp: new Date().toISOString(),
      source: 'telegram',
      telegramChatId: String(chatId),
      threadKey,
      simulated: result.simulated,
      provider: result.provider,
    };
  } catch (err) {
    // En modo estricto el motor lanza en vez de simular: el usuario de Telegram
    // debe enterarse del fallo en lugar de quedarse esperando. El turno fallido
    // NO se persiste: dejaría un mensaje de usuario sin respuesta que rompe la
    // alternancia de roles del hilo.
    const message = err instanceof Error ? err.message : String(err);
    await sendTelegramMessage(
      botToken,
      chatId,
      `❌ *${agent.name}* no pudo completar la solicitud:\n\n${message}`
    );

    return {
      id: 'run-tg-' + Date.now(),
      agentId: agent.id,
      agentName: agent.name,
      agentAvatar: agent.avatar,
      agentRole: agent.role,
      prompt: userPrompt,
      status: 'failed',
      steps: [],
      finalOutput: message,
      timestamp: new Date().toISOString(),
      source: 'telegram',
      telegramChatId: String(chatId),
      threadKey,
    };
  }
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
  };
}

export async function getTelegramUpdates(botToken: string, offset?: number): Promise<TelegramUpdate[]> {
  const cleanToken = botToken.trim();
  if (!cleanToken) return [];

  const url = `https://api.telegram.org/bot${cleanToken}/getUpdates?timeout=0${offset ? `&offset=${offset}` : ''}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (data.ok && Array.isArray(data.result)) {
      return data.result as TelegramUpdate[];
    }
  } catch (err) {
    console.error('Error fetching Telegram updates:', err);
  }
  return [];
}
