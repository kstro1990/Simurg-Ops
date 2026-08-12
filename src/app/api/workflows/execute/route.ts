import { NextRequest, NextResponse } from 'next/server';
import { runProviderBridge } from '@/lib/providerBridge';
import { listMcpTools, runMcpBridge } from '@/lib/mcpClient';
import {
  addHistoryRun,
  getStoredAgents,
  getStoredSettings,
  getStoredWorkflows,
} from '@/lib/serverStorage';
import {
  indexAgents,
  runWorkflowPipeline,
  workflowStepRunId,
  workflowStepToRun,
} from '@/lib/workflowEngine';
import { newTraceId, publishLiveEvent } from '@/lib/liveEvents';
import {
  AgentConfig,
  ProviderKeys,
  WorkflowConfig,
  WorkflowRunResult,
} from '@/types/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workflow, workflowId, agentsMap, initialPrompt, apiKey, providerKeys } = body as {
      /** Workflow inline; alternativa a `workflowId`. */
      workflow?: WorkflowConfig;
      /** Id de un workflow ya guardado en `data/workflows.json`. */
      workflowId?: string;
      /**
       * Opcional: por defecto los agentes se resuelven del almacenamiento del
       * servidor. Solo hace falta enviarlos para ejecutar agentes efímeros que
       * aún no están guardados.
       */
      agentsMap?: Record<string, AgentConfig>;
      initialPrompt?: string;
      apiKey?: string;
      providerKeys?: ProviderKeys;
    };

    if (!initialPrompt || !initialPrompt.trim()) {
      return NextResponse.json({ error: 'El Prompt Inicial es requerido.' }, { status: 400 });
    }

    let resolvedWorkflow = workflow;
    if (!resolvedWorkflow && workflowId) {
      const stored = await getStoredWorkflows();
      resolvedWorkflow = stored.find((w) => w.id === workflowId);
      if (!resolvedWorkflow) {
        return NextResponse.json(
          { error: `Workflow ${workflowId} no encontrado.` },
          { status: 404 }
        );
      }
    }

    if (!resolvedWorkflow || !Array.isArray(resolvedWorkflow.steps)) {
      return NextResponse.json(
        { error: 'Se requiere workflow (inline) o workflowId.' },
        { status: 400 }
      );
    }

    // Los agentes viven en el servidor: obligar al llamador a reenviarlos le
    // hacía duplicar configuraciones completas, credenciales MCP incluidas.
    const agents = { ...indexAgents(await getStoredAgents()), ...(agentsMap || {}) };
    const storedKeys = await getStoredSettings();

    // Se sella antes de arrancar para que el monitor en vivo pueda anunciar el
    // `runId` de cada paso mientras la cadena todavía corre.
    const timestamp = new Date().toISOString();
    const traceId = newTraceId();
    const wf = resolvedWorkflow;
    publishLiveEvent({
      traceId,
      type: 'run_start',
      source: 'web',
      targetKind: 'workflow',
      targetId: wf.id,
      targetName: wf.name,
      targetAvatar: '🔗',
      prompt: initialPrompt,
      totalSteps: wf.steps.length,
    });

    const pipeline = await runWorkflowPipeline({
      workflow: wf,
      agents,
      initialPrompt,
      apiKey,
      providerKeys: { ...storedKeys, ...(providerKeys || {}) },
      bridgeFn: runProviderBridge,
      mcpFn: runMcpBridge,
      mcpListFn: listMcpTools,
      onStepStart: (index) => {
        const step = wf.steps[index];
        const agent = agents[step.agentId];
        publishLiveEvent({
          traceId,
          type: 'step_start',
          index,
          stepName: step.stepName,
          agentName: agent?.name ?? step.agentId,
          agentAvatar: agent?.avatar ?? '⚠️',
        });
      },
      onAgentStep: (step, index) => publishLiveEvent({ traceId, type: 'thought', index, step }),
      onStepResult: (result, index) =>
        publishLiveEvent({
          traceId,
          type: 'step_result',
          index,
          stepName: result.stepName,
          agentName: result.agentName,
          agentAvatar: result.agentAvatar,
          status: result.status,
          output: result.output,
          metrics: result.metrics ?? undefined,
          simulated: result.simulated,
          ...(result.error ? { error: result.error } : {}),
          ...(result.status === 'skipped' ? {} : { runId: workflowStepRunId(timestamp, index) }),
        }),
    });

    publishLiveEvent({
      traceId,
      type: 'run_end',
      status: pipeline.failed ? 'failed' : 'completed',
      finalOutput: pipeline.finalOutput,
      simulated: pipeline.simulated,
      ...(pipeline.failed
        ? { error: pipeline.stepResults.at(-1)?.error ?? 'El pipeline falló.' }
        : {}),
    });

    // El camino de navegador ya escribía historial por paso; este no. Se hace
    // secuencialmente porque `addHistoryRun` es read-modify-write bajo lock.
    for (const [index, step] of pipeline.stepResults.entries()) {
      if (step.status === 'skipped') continue;
      try {
        await addHistoryRun(workflowStepToRun(step, index, { timestamp }));
      } catch (err) {
        // El historial es auditoría: un fallo al escribirlo no invalida la
        // ejecución que ya se pagó.
        console.error('No se pudo registrar el paso del workflow en el historial:', err);
      }
    }

    const response: WorkflowRunResult & { success: boolean; error?: string } = {
      success: !pipeline.failed,
      id: `wfrun-${Date.parse(timestamp)}`,
      workflowId: resolvedWorkflow.id,
      workflowName: resolvedWorkflow.name,
      status: pipeline.failed ? 'failed' : 'completed',
      stepResults: pipeline.stepResults,
      finalOutput: pipeline.finalOutput,
      simulated: pipeline.simulated,
      timestamp,
    };

    if (pipeline.failed) {
      response.error = pipeline.stepResults.at(-1)?.error ?? 'El pipeline falló.';
    }

    // 200 incluso al fallar: la respuesta lleva los pasos que sí se ejecutaron.
    // El 500 queda para errores de la propia ruta.
    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Error en la ejecución del flujo multi-agente.',
      },
      { status: 500 }
    );
  }
}
