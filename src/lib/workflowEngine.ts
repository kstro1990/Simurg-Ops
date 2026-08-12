import {
  AgentConfig,
  ExecutionRun,
  ProviderKeys,
  ThoughtStep,
  WorkflowConfig,
  WorkflowStepResult,
} from '@/types/agent';
import { BridgeFn } from '@/types/bridge';
import { McpFn, McpListFn } from '@/types/mcp';
import { runAgentEngine } from './agentEngine';

/**
 * Prefijo con el que la salida de un paso entra en el prompt del siguiente.
 * Vive aquí, como constante, porque antes estaba duplicado literal en el
 * cliente (`[CONTEXTO DEL AGENTE ANTERIOR]`) y en la ruta de servidor
 * (`[INPUT ANTERIOR]`): el mismo workflow producía prompts distintos según por
 * dónde se ejecutara.
 */
export const WORKFLOW_CONTEXT_PREFIX = '[CONTEXTO DEL AGENTE ANTERIOR]';

export type { WorkflowStepResult };

export interface WorkflowPipelineResult {
  stepResults: WorkflowStepResult[];
  finalOutput: string;
  /** true si algún paso lo atendió el simulador. */
  simulated: boolean;
  /** true si un paso lanzó y cortó la cadena. */
  failed: boolean;
  /** true si el `signal` cortó la cadena antes de agotar los pasos. */
  aborted: boolean;
}

export interface RunWorkflowPipelineOptions {
  workflow: WorkflowConfig;
  /** Agentes indexados por `id`. Ver `indexAgents()`. */
  agents: Record<string, AgentConfig>;
  initialPrompt: string;
  apiKey?: string;
  providerKeys?: ProviderKeys;
  /**
   * Mismos transportes inyectados que `runAgentEngine`, y por el mismo motivo:
   * las implementaciones reales usan `child_process` y no pueden importarse
   * desde un módulo que también corre en el navegador.
   */
  bridgeFn?: BridgeFn;
  mcpFn?: McpFn;
  mcpListFn?: McpListFn;
  /** Se invoca justo antes de lanzar el paso `index`. Da el avance en la UI. */
  onStepStart?: (index: number) => void;
  /**
   * Se invoca al cerrar cada paso, sea cual sea su `status`. Se **espera** si
   * devuelve una promesa: el bot de Telegram edita un mensaje de progreso aquí
   * y sin el await los edits llegarían desordenados.
   */
  onStepResult?: (result: WorkflowStepResult, index: number) => void | Promise<void>;
  /**
   * Traza de pensamiento del agente del paso `index`, según se produce. Sin
   * esto el monitor en vivo enseñaría los workflows mucho más gruesos que los
   * agentes sueltos, lo que se lee como un fallo.
   */
  onAgentStep?: (step: ThoughtStep, index: number) => void;
  /** Se comprueba en la frontera de cada paso; no aborta una llamada en vuelo. */
  signal?: AbortSignal;
}

export function indexAgents(agents: AgentConfig[]): Record<string, AgentConfig> {
  return Object.fromEntries(agents.map((agent) => [agent.id, agent]));
}

export function buildStepPrompt(
  customInstruction: string | undefined,
  currentInput: string
): string {
  return customInstruction
    ? `${customInstruction}\n\n${WORKFLOW_CONTEXT_PREFIX}:\n${currentInput}`
    : currentInput;
}

export interface WorkflowStepRunOptions {
  timestamp?: string;
  /** 'web' por defecto; 'telegram' cuando el pipeline lo dispara un bot. */
  source?: ExecutionRun['source'];
  telegramChatId?: string;
}

/**
 * Id de historial de un paso. Se expone para que el monitor en vivo pueda
 * referenciar la `ExecutionRun` que acabará en `data/history.json` sin volver a
 * escribir el formato a mano y arriesgarse a que las dos versiones deriven.
 */
export function workflowStepRunId(timestamp: string, index: number): string {
  return `run-wf-${Date.parse(timestamp) || Date.now()}-${index}`;
}

/**
 * Convierte un paso ejecutado en la entrada de historial correspondiente, para
 * que el camino de navegador y el de servidor escriban exactamente el mismo
 * shape en `data/history.json`.
 */
export function workflowStepToRun(
  result: WorkflowStepResult,
  index: number,
  options: WorkflowStepRunOptions = {}
): ExecutionRun {
  const { timestamp = new Date().toISOString(), source = 'web', telegramChatId } = options;
  return {
    id: workflowStepRunId(timestamp, index),
    agentId: result.agentId,
    agentName: result.agentName,
    agentAvatar: result.agentAvatar,
    agentRole: result.agentRole,
    prompt: result.input,
    status: result.status === 'completed' ? 'completed' : 'failed',
    steps: result.steps,
    finalOutput: result.output,
    metrics: result.metrics ?? undefined,
    timestamp,
    source,
    ...(telegramChatId ? { telegramChatId } : {}),
    simulated: result.simulated,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Ejecuta la cadena lineal de un workflow: la salida de cada paso es la entrada
 * del siguiente, prefijada por la `customInstruction` del paso.
 *
 * Los pasos NO llevan `history`: un paso de pipeline no es un turno de
 * conversación, así que `memoryTurns` no aplica aquí y nada se persiste en
 * `data/conversations.json`. El encadenado ya es el único contexto que un paso
 * necesita ver.
 */
export async function runWorkflowPipeline(
  options: RunWorkflowPipelineOptions
): Promise<WorkflowPipelineResult> {
  const {
    workflow,
    agents,
    initialPrompt,
    apiKey,
    providerKeys,
    bridgeFn,
    mcpFn,
    mcpListFn,
    onStepStart,
    onStepResult,
    onAgentStep,
    signal,
  } = options;

  const stepResults: WorkflowStepResult[] = [];
  let currentInput = initialPrompt;
  let simulated = false;
  let failed = false;
  let aborted = false;

  const push = async (result: WorkflowStepResult, index: number) => {
    stepResults.push(result);
    await onStepResult?.(result, index);
  };

  for (let index = 0; index < workflow.steps.length; index++) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }

    const step = workflow.steps[index];
    const agent = agents[step.agentId];

    // Un paso huérfano no interrumpe el pipeline: se marca y la cadena sigue
    // con la salida del paso anterior intacta. Antes el servidor lanzaba aquí
    // y tiraba todo el trabajo previo.
    if (!agent) {
      await push(
        {
          stepId: step.id,
          stepName: step.stepName,
          agentId: step.agentId,
          agentName: `Agente ${step.agentId} (no encontrado)`,
          agentAvatar: '⚠️',
          agentRole: 'Desconocido',
          input: buildStepPrompt(step.customInstruction, currentInput),
          output: `El paso "${step.stepName}" referencia el agente ${step.agentId}, que ya no existe. Se omite.`,
          steps: [],
          metrics: null,
          simulated: false,
          status: 'skipped',
          error: `Agente ${step.agentId} no encontrado.`,
        },
        index
      );
      continue;
    }

    onStepStart?.(index);
    const promptForStep = buildStepPrompt(step.customInstruction, currentInput);

    try {
      const result = await runAgentEngine({
        agent,
        userPrompt: promptForStep,
        apiKey,
        providerKeys,
        bridgeFn,
        mcpFn,
        mcpListFn,
        ...(onAgentStep ? { onStepUpdate: (step: ThoughtStep) => onAgentStep(step, index) } : {}),
      });

      simulated = simulated || result.simulated;
      currentInput = result.finalOutput;

      await push(
        {
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
          status: 'completed',
        },
        index
      );
    } catch (err) {
      // La cadena se corta —el siguiente paso no tendría entrada válida— pero
      // se devuelve lo ya ejecutado en lugar de un error vacío.
      failed = true;
      await push(
        {
          stepId: step.id,
          stepName: step.stepName,
          agentId: agent.id,
          agentName: agent.name,
          agentAvatar: agent.avatar,
          agentRole: agent.role,
          input: promptForStep,
          output: '',
          steps: [],
          metrics: null,
          simulated: false,
          status: 'failed',
          error: errorMessage(err),
        },
        index
      );
      break;
    }
  }

  return { stepResults, finalOutput: currentInput, simulated, failed, aborted };
}
