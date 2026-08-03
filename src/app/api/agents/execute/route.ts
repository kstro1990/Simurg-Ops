import { NextRequest, NextResponse } from 'next/server';
import { runAgentEngine } from '@/lib/agentEngine';
import { AgentConfig } from '@/types/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agent, prompt, apiKey } = body as {
      agent: AgentConfig;
      prompt: string;
      apiKey?: string;
    };

    if (!agent || !prompt) {
      return NextResponse.json(
        { error: 'Agente y prompt son requeridos.' },
        { status: 400 }
      );
    }

    const result = await runAgentEngine({
      agent,
      userPrompt: prompt,
      apiKey,
    });

    return NextResponse.json({
      success: true,
      agentId: agent.id,
      agentName: agent.name,
      result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error en la ejecución del agente.' },
      { status: 500 }
    );
  }
}
