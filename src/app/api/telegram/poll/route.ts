import { NextRequest, NextResponse } from 'next/server';
import { AgentConfig, ExecutionRun } from '@/types/agent';
import { getTelegramUpdates, processTelegramAgentRequest } from '@/lib/telegramService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agents, apiKey, offsets } = body as {
      agents: AgentConfig[];
      apiKey?: string;
      offsets?: Record<string, number>;
    };

    if (!Array.isArray(agents)) {
      return NextResponse.json({ success: false, error: 'Lista de agentes inválida.' }, { status: 400 });
    }

    const newRuns: ExecutionRun[] = [];
    const updatedOffsets: Record<string, number> = { ...(offsets || {}) };

    for (const agent of agents) {
      if (agent.telegramConfig?.enabled && agent.telegramConfig?.botToken) {
        const botToken = agent.telegramConfig.botToken;
        const currentOffset = updatedOffsets[agent.id] || 0;

        const updates = await getTelegramUpdates(botToken, currentOffset);

        for (const update of updates) {
          updatedOffsets[agent.id] = Math.max(updatedOffsets[agent.id] || 0, update.update_id + 1);

          if (update.message && update.message.text) {
            // Ignore bot commands like /start if needed, or process them directly
            const userText = update.message.text.trim();
            const chatId = update.message.chat.id;

            try {
              const run = await processTelegramAgentRequest({
                agent,
                userPrompt: userText,
                chatId,
                apiKey,
                botToken,
              });
              newRuns.push(run);
            } catch (err: any) {
              console.error(`Error processing Telegram message for agent ${agent.name}:`, err);
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      newRuns,
      newOffsets: updatedOffsets,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Error polling Telegram updates.' },
      { status: 500 }
    );
  }
}
