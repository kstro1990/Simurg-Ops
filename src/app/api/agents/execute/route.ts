import { NextRequest, NextResponse } from 'next/server';
import { runAgentEngine } from '@/lib/agentEngine';
import { runProviderBridge } from '@/lib/providerBridge';
import { listMcpTools, runMcpBridge } from '@/lib/mcpClient';
import {
  appendConversationTurn,
  getConversationMessages,
  getStoredSettings,
} from '@/lib/serverStorage';
import { newTraceId, publishLiveEvent } from '@/lib/liveEvents';
import { AgentConfig, ProviderKeys } from '@/types/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agent, prompt, apiKey, providerKeys, threadKey } = body as {
      agent: AgentConfig;
      prompt: string;
      apiKey?: string;
      providerKeys?: ProviderKeys;
      /** Opcional: sin él la ruta se comporta como siempre, sin memoria. */
      threadKey?: string;
    };

    if (!agent || !prompt) {
      return NextResponse.json({ error: 'Agente y prompt son requeridos.' }, { status: 400 });
    }

    if (threadKey && threadKey.includes('::')) {
      return NextResponse.json(
        { error: 'threadKey no puede contener "::".' },
        { status: 400 }
      );
    }

    const storedKeys = await getStoredSettings();
    const history = threadKey ? await getConversationMessages(agent.id, threadKey) : [];

    const traceId = newTraceId();
    publishLiveEvent({
      traceId,
      type: 'run_start',
      source: 'web',
      targetKind: 'agent',
      targetId: agent.id,
      targetName: agent.name,
      targetAvatar: agent.avatar,
      prompt,
    });

    let result;
    try {
      result = await runAgentEngine({
        agent,
        userPrompt: prompt,
        history,
        apiKey,
        providerKeys: { ...storedKeys, ...(providerKeys || {}) },
        // En el servidor se invoca el puente directamente: un fetch relativo no
        // resolvería y la ejecución caería silenciosamente al simulador.
        bridgeFn: runProviderBridge,
        mcpFn: runMcpBridge,
        mcpListFn: listMcpTools,
        onStepUpdate: (step) => publishLiveEvent({ traceId, type: 'thought', step }),
      });
    } catch (err) {
      // Sin esto la traza se quedaría "en curso" hasta que la barriera el TTL.
      const message = err instanceof Error ? err.message : String(err);
      publishLiveEvent({
        traceId,
        type: 'run_end',
        status: 'failed',
        finalOutput: message,
        simulated: false,
        error: message,
      });
      throw err;
    }

    publishLiveEvent({
      traceId,
      type: 'run_end',
      status: 'completed',
      finalOutput: result.finalOutput,
      metrics: result.metrics,
      simulated: result.simulated,
    });

    if (threadKey) {
      const now = new Date().toISOString();
      await appendConversationTurn(agent.id, threadKey, {
        user: { role: 'user', content: prompt, timestamp: now },
        assistant: {
          role: 'assistant',
          content: result.finalOutput,
          timestamp: now,
          simulated: result.simulated,
        },
      });
    }

    return NextResponse.json({
      success: true,
      agentId: agent.id,
      agentName: agent.name,
      threadKey,
      result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error en la ejecución del agente.' },
      { status: 500 }
    );
  }
}
