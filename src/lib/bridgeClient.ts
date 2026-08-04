import { BridgeRequest, BridgeResult } from '@/types/bridge';

/**
 * Transporte de navegador: reenvía la petición a /api/cli-bridge, que ejecuta
 * `runProviderBridge` en el servidor. Solo válido en el cliente — la URL es
 * relativa, así que desde el servidor no resuelve (usa runProviderBridge ahí).
 */
export async function fetchProviderBridge(request: BridgeRequest): Promise<BridgeResult> {
  try {
    const res = await fetch('/api/cli-bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const data = (await res.json().catch(() => ({}))) as BridgeResult;

    if (!res.ok) {
      return { success: false, message: data.message || `El puente devolvió ${res.status}.` };
    }

    return data;
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
