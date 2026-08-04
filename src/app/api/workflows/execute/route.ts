import { NextRequest, NextResponse } from 'next/server';
import { runAgentEngine } from '@/lib/agentEngine';
import { runProviderBridge } from '@/lib/providerBridge';
import { getStoredSettings } from '@/lib/serverStorage';
import { AgentConfig, ProviderKeys, WorkflowConfig } from '@/types/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workflow, agentsMap, initialPrompt, apiKey, providerKeys } = body as {
      workflow: WorkflowConfig;
      agentsMap: Record<string, AgentConfig>;
      initialPrompt: string;
      apiKey?: string;
      providerKeys?: ProviderKeys;
    };

    if (!workflow || !agentsMap || !initialPrompt) {
      return NextResponse.json(
        { error: 'Workflow, Mapa de Agentes y Prompt Inicial son requeridos.' },
        { status: 400 }
      );
    }

    const storedKeys = await getStoredSettings();
    const effectiveKeys = { ...storedKeys, ...(providerKeys || {}) };

    let currentInput = initialPrompt;
    const stepResults = [];
    let anySimulated = false;

    for (const step of workflow.steps) {
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
        providerKeys: effectiveKeys,
        bridgeFn: runProviderBridge,
      });

      anySimulated = anySimulated || result.simulated;

      stepResults.push({
        stepId: step.id,
        stepName: step.stepName,
        agentId: agent.id,
        agentName: agent.name,
        agentAvatar: agent.avatar,
        agentRole: agent.role,
        input: promptForStep,
        output: result.finalOutput,
        steps: result.steps,
        metrics: result.metrics,
        simulated: result.simulated,
        status: 'completed' as const,
      });

      // La salida de cada paso alimenta el prompt del siguiente.
      currentInput = result.finalOutput;
    }

    return NextResponse.json({
      success: true,
      workflowId: workflow.id,
      workflowName: workflow.name,
      stepResults,
      finalOutput: currentInput,
      simulated: anySimulated,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Error en la ejecución del flujo multi-agente.',
      },
      { status: 500 }
    );
  }
}
