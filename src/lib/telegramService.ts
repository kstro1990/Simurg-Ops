import { AgentConfig, ExecutionRun } from '@/types/agent';
import { runAgentEngine } from './agentEngine';

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
    } catch (e) {
      // Fallback without parse_mode if Markdown parsing fails due to special characters
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
  botToken: string;
}): Promise<ExecutionRun> {
  const { agent, userPrompt, chatId, apiKey, botToken } = options;

  // Send initial "Thinking..." notification to Telegram
  await sendTelegramMessage(
    botToken,
    chatId,
    `🤖 *${agent.name}* está procesando tu solicitud...\n\n_Pensamiento en progreso con modelo ${agent.model}_`
  );

  // Execute Agent Engine
  const result = await runAgentEngine({
    agent,
    userPrompt,
    apiKey,
  });

  // Format final response with Agent header
  const telegramText = `🤖 *${agent.avatar} ${agent.name}* (${agent.role}):\n\n${result.finalOutput}\n\n⏱️ _Latencia: ${result.metrics.latencyMs}ms | Tokens: ${result.metrics.totalTokens}_`;

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
    timestamp: new Date().toLocaleTimeString(),
    source: 'telegram',
    telegramChatId: String(chatId),
  };
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
