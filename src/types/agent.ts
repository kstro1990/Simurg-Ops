export type AIProvider = 'gemini' | 'claude-code' | 'anthropic' | 'copilot-cli' | 'openai';

export type AgentModel = 
  | 'gemini-2.5-flash' 
  | 'gemini-2.5-pro' 
  | 'gemini-1.5-flash' 
  | 'gemini-1.5-pro'
  | 'claude-code'
  | 'claude-3.7-sonnet'
  | 'claude-3.5-sonnet'
  | 'claude-3.5-haiku'
  | 'copilot-cli'
  | 'copilot-gpt-4o'
  | 'gpt-4o'
  | 'gpt-4o-mini';

export interface ProviderKeys {
  geminiApiKey?: string;
  anthropicApiKey?: string;
  copilotToken?: string;
  openaiApiKey?: string;
  cliBridgeUrl?: string;
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
  toolArgs?: Record<string, any>;
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
