import { NextRequest, NextResponse } from 'next/server';
import { runAgentEngine } from '@/lib/agentEngine';
import { AgentConfig, WorkflowConfig } from '@/types/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workflow, agentsMap, initialPrompt, apiKey } = body as {
      workflow: WorkflowConfig;
      agentsMap: Record<string, AgentConfig>;
      initialPrompt: string;
      apiKey?: string;
    };

    if (!workflow || !agentsMap || !initialPrompt) {
      return NextResponse.json(
        { error: 'Workflow, Mapa de Agentes y Prompt Inicial son requeridos.' },
        { status: 400 }
      );
    }

    let currentInput = initialPrompt;
    const stepResults = [];

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      const agent = agentsMap[step.agentId];

      if (!agent) {
        throw new Error(`Agente con ID ${step.agentId} no encontrado.`);
      }

      const promptForStep = step.customInstruction
        ? `${step.customInstruction}\n\n[INPUT ANTERIOR]:\n${currentInput}`
        : currentInput;

      const result = await runAgentEngine({
        agent,
        userPrompt: promptForStep,
        apiKey,
      });

      stepResults.push({
        stepId: step.id,
        stepName: step.stepName,
        agentName: agent.name,
        agentAvatar: agent.avatar,
        input: promptForStep,
        output: result.finalOutput,
        steps: result.steps,
        status: 'completed' as const,
      });

      // Pass current step output as input to next agent
      currentInput = result.finalOutput;
    }

    return NextResponse.json({
      success: true,
      workflowId: workflow.id,
      workflowName: workflow.name,
      stepResults,
      finalOutput: currentInput,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error en la ejecución del flujo multi-agente.' },
      { status: 500 }
    );
  }
}
