import { NextRequest, NextResponse } from 'next/server';
import { ExecutionRun } from '@/types/agent';
import {
  getTelegramUpdates,
  processTelegramAgentRequest,
  processTelegramWorkflowRequest,
} from '@/lib/telegramService';
import {
  addHistoryRun,
  getStoredAgents,
  getStoredSettings,
  getStoredWorkflows,
  getTelegramOffsets,
  mergeTelegramOffsets,
  telegramOffsetKey,
} from '@/lib/serverStorage';
import { indexAgents } from '@/lib/workflowEngine';

/**
 * Sondeo de mensajes de Telegram, para agentes y para workflows. El cliente
 * solo dispara el tick: los agentes, los workflows, las claves y los offsets se
 * leen del servidor, para que recargar la página no haga que el bot reprocese
 * mensajes ya atendidos.
 */
export async function POST(req: NextRequest) {
  try {
    // El cuerpo es opcional; se acepta por compatibilidad pero ya no se usa.
    await req.json().catch(() => ({}));

    const [agents, workflows, settings, offsets] = await Promise.all([
      getStoredAgents(),
      getStoredWorkflows(),
      getStoredSettings(),
      getTelegramOffsets(),
    ]);

    const newRuns: ExecutionRun[] = [];
    const updatedOffsets: Record<string, number> = { ...offsets };

    for (const agent of agents) {
      const botToken = agent.telegramConfig?.botToken;
      if (!agent.telegramConfig?.enabled || !botToken) continue;

      const offsetKey = telegramOffsetKey('agent', agent.id);
      const currentOffset = updatedOffsets[offsetKey] || 0;
      const updates = await getTelegramUpdates(botToken, currentOffset);

      for (const update of updates) {
        // El offset avanza aunque el mensaje no sea de texto o falle su
        // procesamiento; si no, un mensaje problemático bloquea la cola.
        updatedOffsets[offsetKey] = Math.max(updatedOffsets[offsetKey] || 0, update.update_id + 1);

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
          // `null` = era un comando (/nuevo, /ayuda): no hubo ejecución.
          if (run) {
            await addHistoryRun(run);
            newRuns.push(run);
          }
        } catch (err) {
          console.error(`Error procesando mensaje de Telegram para ${agent.name}:`, err);
        }
      }
    }

    // Los workflows van después y comparten el índice de agentes: cada pipeline
    // los resuelve por id y no tiene sentido releerlos por cada uno.
    const agentsById = indexAgents(agents);

    // Un pipeline puede tardar minutos y el tick es secuencial, así que se
    // atiende como mucho un mensaje de pipeline por tick: el resto se queda en
    // la cola de Telegram (no se avanza su offset) y entra en el siguiente. Sin
    // este tope, una ráfaga de mensajes dejaría mudos a los demás bots durante
    // muchísimo tiempo.
    let pipelineRunThisTick = false;

    for (const workflow of workflows) {
      const botToken = workflow.telegramConfig?.botToken;
      if (!workflow.telegramConfig?.enabled || !botToken) continue;

      const offsetKey = telegramOffsetKey('workflow', workflow.id);
      const currentOffset = updatedOffsets[offsetKey] || 0;
      const updates = await getTelegramUpdates(botToken, currentOffset);

      for (const update of updates) {
        const userText = update.message?.text?.trim();
        const isCommand = !!userText && userText.startsWith('/');

        // Los comandos son instantáneos y no cuentan para el tope.
        if (pipelineRunThisTick && userText && !isCommand) break;

        updatedOffsets[offsetKey] = Math.max(updatedOffsets[offsetKey] || 0, update.update_id + 1);

        if (!userText || !update.message) continue;

        try {
          const runs = await processTelegramWorkflowRequest({
            workflow,
            agents: agentsById,
            userPrompt: userText,
            chatId: update.message.chat.id,
            apiKey: settings.geminiApiKey,
            providerKeys: settings,
            botToken,
          });
          // Array vacío = era un comando: no hubo ejecución que registrar.
          if (runs.length > 0) pipelineRunThisTick = true;
          for (const run of runs) {
            await addHistoryRun(run);
            newRuns.push(run);
          }
        } catch (err) {
          console.error(`Error procesando mensaje de Telegram para ${workflow.name}:`, err);
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
