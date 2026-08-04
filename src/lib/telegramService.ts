import { AgentConfig, ExecutionRun, ProviderKeys } from '@/types/agent';
import { runAgentEngine } from './agentEngine';
import { runProviderBridge } from './providerBridge';

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

export async function processTelegramAgentRequest(options: {
  agent: AgentConfig;
  userPrompt: string;
  chatId: string | number;
  apiKey?: string;
  providerKeys?: ProviderKeys;
  botToken: string;
}): Promise<ExecutionRun> {
  const { agent, userPrompt, chatId, apiKey, providerKeys, botToken } = options;

  // Aviso inicial de "procesando" al chat de Telegram
  await sendTelegramMessage(
    botToken,
    chatId,
    `🤖 *${agent.name}* está procesando tu solicitud...\n\n_Pensamiento en progreso con modelo ${agent.model}_`
  );

  try {
    const result = await runAgentEngine({
      agent,
      userPrompt,
      apiKey,
      providerKeys,
      // Esto corre en el servidor: hay que invocar el puente directamente.
      bridgeFn: runProviderBridge,
    });

    const simulatedWarning = result.simulated
      ? '\n\n⚠️ _Respuesta SIMULADA: no se pudo contactar con el proveedor._'
      : '';

    const telegramText = `🤖 *${agent.avatar} ${agent.name}* (${agent.role}):\n\n${result.finalOutput}\n\n⏱️ _Latencia: ${result.metrics.latencyMs}ms | Tokens: ${result.metrics.totalTokens}_${simulatedWarning}`;

    await sendTelegramMessage(botToken, chatId, telegramText);

    return {
      id: 'run-tg-' + Date.now(),
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
      simulated: result.simulated,
      provider: result.provider,
    };
  } catch (err) {
    // En modo estricto el motor lanza en vez de simular: el usuario de Telegram
    // debe enterarse del fallo en lugar de quedarse esperando.
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
