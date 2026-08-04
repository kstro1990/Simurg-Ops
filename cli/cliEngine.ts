/**
 * Puente de proveedores para el CLI.
 *
 * Antes este fichero duplicaba la lógica de la app web (IDs de modelo propios,
 * su propio `exec` con interpolación de shell). Las dos copias se desincronizaron
 * y esta se quedó con modelos de Anthropic ya retirados. Ahora delega en la
 * misma implementación que usa el servidor: `src/lib/providerBridge.ts`.
 */

import { runProviderBridge } from '@/lib/providerBridge';
import { BridgeRequest, BridgeResult } from '@/types/bridge';

export type CliBridgeRequest = BridgeRequest;
export type CliBridgeResponse = BridgeResult;

/** Función de puente para el CLI: llama a las APIs y binarios directamente. */
export async function directBridge(request: CliBridgeRequest): Promise<CliBridgeResponse> {
  return runProviderBridge(request);
}
