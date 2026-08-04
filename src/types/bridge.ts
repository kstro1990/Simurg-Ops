import { AIProvider, AgentModel, ProviderKeys } from './agent';

export interface BridgeRequest {
  provider: AIProvider;
  model: AgentModel;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  keys: ProviderKeys;
}

export interface BridgeUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface BridgeResult {
  success: boolean;
  output?: string;
  /** 'api' si respondió el proveedor remoto, 'cli_binary' si fue un binario local. */
  source?: 'api' | 'cli_binary';
  /** Motivo del fallo cuando success === false. */
  message?: string;
  usage?: BridgeUsage;
}

/**
 * El motor de agentes no importa el bridge directamente: recibe este transporte.
 * En el servidor se le pasa la implementación real (`runProviderBridge`), que usa
 * child_process; en el navegador se le pasa `fetchProviderBridge`, que va por HTTP.
 * Así el bundle de cliente nunca arrastra módulos de Node.
 */
export type BridgeFn = (request: BridgeRequest) => Promise<BridgeResult>;
