export type AIProvider = 'gemini' | 'claude-code' | 'anthropic' | 'copilot-cli' | 'openai';

/**
 * IDs de modelo a nivel de app. Para Gemini coinciden con los IDs de la API,
 * así que `agentEngine` los pasa tal cual; para el resto, `providerBridge`
 * los traduce.
 */
export type AgentModel =
  | 'gemini-3.6-flash'
  | 'gemini-3.5-flash'
  | 'gemini-3.1-pro-preview'
  | 'gemini-3.5-flash-lite'
  | 'gemini-3.1-flash-lite'
  | 'claude-code'
  | 'claude-opus-5'
  | 'claude-sonnet-5'
  | 'claude-haiku-4-5'
  | 'copilot-cli'
  | 'copilot-gpt-4o'
  | 'gpt-4o'
  | 'gpt-4o-mini';

export const AGENT_MODELS: AgentModel[] = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'claude-code',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5',
  'copilot-cli',
  'copilot-gpt-4o',
  'gpt-4o',
  'gpt-4o-mini',
];

/** Modelo por defecto cuando un ID guardado no se reconoce en absoluto. */
export const DEFAULT_MODEL: AgentModel = 'gemini-3.6-flash';

/**
 * Modelos retirados o deprecados que pueden seguir guardados en data/agents.json
 * o en localStorage de instalaciones anteriores. Estos IDs ya no existen en las
 * APIs, así que hay que reasignarlos al cargar o las ejecuciones dan 404.
 */
const LEGACY_MODEL_MAP: Record<string, AgentModel> = {
  // Gemini 1.5 y 2.x
  'gemini-1.5-flash': 'gemini-3.6-flash',
  'gemini-1.5-pro': 'gemini-3.1-pro-preview',
  'gemini-2.0-flash': 'gemini-3.6-flash',
  'gemini-2.0-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.5-flash': 'gemini-3.6-flash',
  'gemini-2.5-pro': 'gemini-3.1-pro-preview',
  // Previews de Gemini 3 ya apagadas
  'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite',
  // Anthropic pre-4.6
  'claude-3.7-sonnet': 'claude-sonnet-5',
  'claude-3.5-sonnet': 'claude-sonnet-5',
  'claude-3.5-haiku': 'claude-haiku-4-5',
};

export function normalizeModel(model: string): AgentModel {
  if ((AGENT_MODELS as string[]).includes(model)) return model as AgentModel;
  return LEGACY_MODEL_MAP[model] || DEFAULT_MODEL;
}

export interface ProviderKeys {
  geminiApiKey?: string;
  anthropicApiKey?: string;
  copilotToken?: string;
  openaiApiKey?: string;
  cliBridgeUrl?: string;
  /**
   * Con modo estricto activo el motor falla en vez de conmutar al simulador.
   * Sin esto una ejecución "exitosa" puede ser texto inventado.
   */
  strictMode?: boolean;
}

export function getProviderFromModel(model: AgentModel): AIProvider {
  if (model === 'claude-code') return 'claude-code';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('copilot-')) return 'copilot-cli';
  if (model.startsWith('gpt-')) return 'openai';
  return 'gemini';
}


export type ToolName = 'web_search' | 'code_executor' | 'image_generator' | 'data_extractor';

export interface TelegramConfig {
  enabled: boolean;
  botToken?: string;
  botUsername?: string;
  botFirstName?: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  lastActive?: string;
  errorMessage?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  description: string;
  avatar: string;
  model: AgentModel;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  tools: ToolName[];
  telegramConfig?: TelegramConfig;
  isCustom?: boolean;
  createdAt: string;
}

export type StepType = 'thought' | 'tool_call' | 'tool_result' | 'output' | 'error';

export interface ThoughtStep {
  id: string;
  type: StepType;
  content: string;
  timestamp: string;
  toolName?: ToolName;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
}

export interface ExecutionMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export interface ExecutionRun {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  agentRole: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  steps: ThoughtStep[];
  finalOutput: string;
  metrics?: ExecutionMetrics;
  timestamp: string;
  source?: 'web' | 'telegram';
  telegramChatId?: string;
  /** true si la salida la produjo el motor de simulación, no un modelo real. */
  simulated?: boolean;
  /** Proveedor que atendió la ejecución realmente. */
  provider?: AIProvider;
}

export interface WorkflowStep {
  id: string;
  agentId: string;
  stepName: string;
  customInstruction?: string;
}

export interface WorkflowConfig {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  createdAt: string;
}

export interface WorkflowRunResult {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  stepResults: {
    stepId: string;
    agentName: string;
    input: string;
    output: string;
    status: 'completed' | 'failed';
  }[];
  timestamp: string;
}
