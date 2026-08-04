import { NextRequest, NextResponse } from 'next/server';
import { ExecutionRun } from '@/types/agent';
import { getTelegramUpdates, processTelegramAgentRequest } from '@/lib/telegramService';
import {
  addHistoryRun,
  getStoredAgents,
  getStoredSettings,
  getTelegramOffsets,
  mergeTelegramOffsets,
} from '@/lib/serverStorage';

/**
 * Sondeo de mensajes de Telegram. El cliente solo dispara el tick: los agentes,
 * las claves y los offsets se leen del servidor, para que recargar la página no
 * haga que el bot reprocese mensajes ya atendidos.
 */
export async function POST(req: NextRequest) {
  try {
    // El cuerpo es opcional; se acepta por compatibilidad pero ya no se usa.
    await req.json().catch(() => ({}));

    const [agents, settings, offsets] = await Promise.all([
      getStoredAgents(),
      getStoredSettings(),
      getTelegramOffsets(),
    ]);

    const newRuns: ExecutionRun[] = [];
    const updatedOffsets: Record<string, number> = { ...offsets };

    for (const agent of agents) {
      const botToken = agent.telegramConfig?.botToken;
      if (!agent.telegramConfig?.enabled || !botToken) continue;

      const currentOffset = updatedOffsets[agent.id] || 0;
      const updates = await getTelegramUpdates(botToken, currentOffset);

      for (const update of updates) {
        // El offset avanza aunque el mensaje no sea de texto o falle su
        // procesamiento; si no, un mensaje problemático bloquea la cola.
        updatedOffsets[agent.id] = Math.max(updatedOffsets[agent.id] || 0, update.update_id + 1);

        const userText = update.message?.text?.trim();
        if (!userText || !update.message) continue;

        try {
          const run = await processTelegramAgentRequest({
            agent,
            userPrompt: userText,
            chatId: update.message.chat.id,
            apiKey: settings.geminiApiKey,
            providerKeys: settings,
            botToken,
          });
          await addHistoryRun(run);
          newRuns.push(run);
        } catch (err) {
          console.error(`Error procesando mensaje de Telegram para ${agent.name}:`, err);
        }
      }
    }

    // Persistimos antes de responder: si el cliente muere, no se pierde el avance.
    const persistedOffsets = await mergeTelegramOffsets(updatedOffsets);

    return NextResponse.json({
      success: true,
      newRuns,
      newOffsets: persistedOffsets,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Error sondeando Telegram.',
      },
      { status: 500 }
    );
  }
}
