import { NextRequest, NextResponse } from 'next/server';
import { runAgentEngine } from '@/lib/agentEngine';
import { runProviderBridge } from '@/lib/providerBridge';
import { listMcpTools, runMcpBridge } from '@/lib/mcpClient';
import { getStoredSettings } from '@/lib/serverStorage';
import { AgentConfig, ProviderKeys } from '@/types/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agent, prompt, apiKey, providerKeys } = body as {
      agent: AgentConfig;
      prompt: string;
      apiKey?: string;
      providerKeys?: ProviderKeys;
    };

    if (!agent || !prompt) {
      return NextResponse.json({ error: 'Agente y prompt son requeridos.' }, { status: 400 });
    }

    const storedKeys = await getStoredSettings();

    const result = await runAgentEngine({
      agent,
      userPrompt: prompt,
      apiKey,
      providerKeys: { ...storedKeys, ...(providerKeys || {}) },
      // En el servidor se invoca el puente directamente: un fetch relativo no
      // resolvería y la ejecución caería silenciosamente al simulador.
      bridgeFn: runProviderBridge,
      mcpFn: runMcpBridge,
      mcpListFn: listMcpTools,
    });

    return NextResponse.json({
      success: true,
      agentId: agent.id,
      agentName: agent.name,
      result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error en la ejecución del agente.' },
      { status: 500 }
    );
  }
}
