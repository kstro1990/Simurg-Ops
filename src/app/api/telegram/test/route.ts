import { NextRequest, NextResponse } from 'next/server';
import {
  processTelegramAgentRequest,
  processTelegramWorkflowRequest,
} from '@/lib/telegramService';
import {
  addHistoryRun,
  getStoredAgents,
  getStoredSettings,
  getStoredWorkflows,
} from '@/lib/serverStorage';
import { indexAgents } from '@/lib/workflowEngine';
import { AgentConfig, ProviderKeys } from '@/types/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agent, workflowId, prompt, chatId, botToken, apiKey, providerKeys } = body as {
      /** Agente inline; alternativa a `workflowId`. */
      agent?: AgentConfig;
      /** Id de un workflow guardado; alternativa a `agent`. */
      workflowId?: string;
      prompt: string;
      chatId: string;
      botToken: string;
      apiKey?: string;
      providerKeys?: ProviderKeys;
    };

    if ((!agent && !workflowId) || !prompt || !chatId || !botToken) {
      return NextResponse.json(
        { error: 'Agente o workflowId, prompt, chatId y botToken son requeridos' },
        { status: 400 }
      );
    }

    const storedKeys = await getStoredSettings();
    const effectiveKeys = { ...storedKeys, ...(providerKeys || {}) };

    if (workflowId) {
      const [workflows, agents] = await Promise.all([getStoredWorkflows(), getStoredAgents()]);
      const workflow = workflows.find((w) => w.id === workflowId);
      if (!workflow) {
        return NextResponse.json({ error: `Workflow ${workflowId} no encontrado.` }, { status: 404 });
      }

      const runs = await processTelegramWorkflowRequest({
        workflow,
        agents: indexAgents(agents),
        userPrompt: prompt,
        chatId,
        apiKey,
        providerKeys: effectiveKeys,
        botToken,
      });

      // Array vacío = era un comando. No es un fallo: el bot hizo justo lo que
      // se le pidió, así que el modal no debe reportar error.
      if (runs.length === 0) {
        return NextResponse.json({ success: true, command: true });
      }

      for (const run of runs) await addHistoryRun(run);

      const failed = runs.find((r) => r.status === 'failed');
      return NextResponse.json({
        success: !failed,
        simulated: runs.some((r) => r.simulated),
        error: failed?.finalOutput,
        stepCount: runs.length,
      });
    }

    const runResult = await processTelegramAgentRequest({
      agent: agent as AgentConfig,
      userPrompt: prompt,
      chatId,
      apiKey,
      providerKeys: effectiveKeys,
      botToken,
    });

    // `null` = era un comando (/nuevo, /ayuda). No es un fallo: sin esta guarda
    // el modal reportaría un error donde el bot hizo justo lo que se le pidió.
    if (!runResult) {
      return NextResponse.json({ success: true, command: true });
    }

    await addHistoryRun(runResult);

    return NextResponse.json({
      success: runResult.status === 'completed',
      simulated: runResult.simulated ?? false,
      error: runResult.status === 'failed' ? runResult.finalOutput : undefined,
      runResult,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Error al enviar mensaje de prueba a Telegram.',
      },
      { status: 500 }
    );
  }
}
