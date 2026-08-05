/**
 * Puente de proveedores para el CLI.
 *
 * Antes este fichero duplicaba la lógica de la app web (IDs de modelo propios,
 * su propio `exec` con interpolación de shell). Las dos copias se desincronizaron
 * y esta se quedó con modelos de Anthropic ya retirados. Ahora delega en la
 * misma implementación que usa el servidor: `src/lib/providerBridge.ts`.
 */

import { runProviderBridge } from '@/lib/providerBridge';
import { runMcpBridge } from '@/lib/mcpClient';
import { BridgeRequest, BridgeResult } from '@/types/bridge';
import { McpCallRequest, McpCallResult } from '@/types/mcp';

export type CliBridgeRequest = BridgeRequest;
export type CliBridgeResponse = BridgeResult;

/** Función de puente para el CLI: llama a las APIs y binarios directamente. */
export async function directBridge(request: CliBridgeRequest): Promise<CliBridgeResponse> {
  return runProviderBridge(request);
}

/**
 * Transporte MCP para el CLI. Mismo motivo que `directBridge`: en terminal no
 * hay servidor HTTP al que reenviar, así que se llama a la implementación real.
 */
export async function directMcp(request: McpCallRequest): Promise<McpCallResult> {
  return runMcpBridge(request);
}
