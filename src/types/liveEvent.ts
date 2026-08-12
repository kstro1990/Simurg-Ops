import type { ExecutionMetrics, ThoughtStep } from './agent';

/**
 * Eventos del monitor en vivo.
 *
 * Esto NO es historial: `data/history.json` sigue siendo el registro de
 * auditoría y sobrevive a los reinicios. Aquí solo viaja lo que está pasando
 * ahora mismo, por un bus en memoria que muere con el proceso.
 *
 * Los tipos viven en `types/` y no en el bus para que el navegador pueda
 * importarlos sin arrastrar `lib/liveEvents.ts`, que es solo de servidor.
 */

export type LiveSource = 'telegram' | 'web' | 'cli';
export type LiveTargetKind = 'agent' | 'workflow';

/** Longitud máxima de cualquier texto que viaje por el bus. */
export const LIVE_TEXT_CAP = 2000;

export interface LiveEventCommon {
  /** Agrupa todos los eventos de una misma petición. */
  traceId: string;
  /** Orden global. Lo asigna el bus, no el productor. */
  seq: number;
  at: string;
}

export interface LiveRunStart {
  type: 'run_start';
  source: LiveSource;
  targetKind: LiveTargetKind;
  targetId: string;
  targetName: string;
  targetAvatar: string;
  /** Prompt del usuario, truncado. Nunca configuración ni credenciales. */
  prompt: string;
  telegramChatId?: string;
  /** Número de pasos esperados; solo en workflows. */
  totalSteps?: number;
}

export interface LiveStepStart {
  type: 'step_start';
  index: number;
  stepName: string;
  agentName: string;
  agentAvatar: string;
}

export interface LiveStepResult {
  type: 'step_result';
  index: number;
  stepName: string;
  agentName: string;
  agentAvatar: string;
  status: 'completed' | 'skipped' | 'failed';
  output: string;
  metrics?: ExecutionMetrics;
  simulated: boolean;
  error?: string;
  /** Id de la `ExecutionRun` que este paso dejará en el historial. */
  runId?: string;
}

export interface LiveThought {
  type: 'thought';
  /** Índice del paso del workflow al que pertenece; ausente en agentes sueltos. */
  index?: number;
  step: ThoughtStep;
}

export interface LiveRunEnd {
  type: 'run_end';
  status: 'completed' | 'failed' | 'aborted';
  finalOutput: string;
  metrics?: ExecutionMetrics;
  simulated: boolean;
  error?: string;
}

/**
 * Aviso de que se descartaron eventos por presión de red. Preferimos decirlo a
 * dejar un hueco silencioso en la traza.
 */
export interface LiveDropped {
  type: 'dropped';
  count: number;
}

export type LiveEventBody =
  | LiveRunStart
  | LiveStepStart
  | LiveStepResult
  | LiveThought
  | LiveRunEnd
  | LiveDropped;

export type LiveEventInput = LiveEventBody & { traceId: string };
export type LiveEvent = LiveEventBody & LiveEventCommon;

/** Estado acumulado de una petición en curso. */
export interface LiveTrace {
  traceId: string;
  source: LiveSource;
  targetKind: LiveTargetKind;
  targetId: string;
  targetName: string;
  targetAvatar: string;
  prompt: string;
  telegramChatId?: string;
  totalSteps?: number;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  events: LiveEvent[];
  droppedEvents: number;
}

export interface LiveSnapshot {
  traces: LiveTrace[];
  subscribers: number;
  serverStartedAt: string;
}
