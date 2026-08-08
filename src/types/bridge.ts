import { AIProvider, AgentModel, ProviderKeys } from './agent';
import type { ConversationMessage } from './conversation';
import type { McpServerConfig, McpTraceEntry } from './mcp';

export interface BridgeRequest {
  provider: AIProvider;
  model: AgentModel;
  systemPrompt: string;
  /** Turno actual, ya con el contexto de tools/MCP preflight añadido. */
  userPrompt: string;
  /**
   * Turnos previos, ya recortados por el motor y **sin** el turno actual.
   * Omitirlo es el comportamiento one-shot de siempre.
   */
  history?: ConversationMessage[];
  temperature: number;
  maxTokens: number;
  keys: ProviderKeys;
  /**
   * Servidores MCP en modo agéntico. Solo lo usa la ruta de Anthropic: el bucle
   * de tool-calling corre dentro del puente porque ahí ya se puede hablar con
   * los servidores MCP sin pasar por HTTP, y así el estado de la conversación
   * nunca cruza la frontera navegador/servidor.
   */
  mcpServers?: McpServerConfig[];
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
  /** Tools MCP que el modelo decidió llamar, en orden. */
  toolTrace?: McpTraceEntry[];
}

/**
 * El motor de agentes no importa el bridge directamente: recibe este transporte.
 * En el servidor se le pasa la implementación real (`runProviderBridge`), que usa
 * child_process; en el navegador se le pasa `fetchProviderBridge`, que va por HTTP.
 * Así el bundle de cliente nunca arrastra módulos de Node.
 */
export type BridgeFn = (request: BridgeRequest) => Promise<BridgeResult>;
