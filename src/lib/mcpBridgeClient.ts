import { McpCallRequest, McpCallResult, McpListRequest, McpListResult } from '@/types/mcp';

/**
 * Transporte de navegador hacia MCP: reenvía a /api/mcp/*, que ejecuta
 * `lib/mcpClient.ts` en el servidor. Solo válido en el cliente — las URLs son
 * relativas, así que desde el servidor no resuelven (usa runMcpBridge ahí).
 */
export async function fetchMcpBridge(request: McpCallRequest): Promise<McpCallResult> {
  try {
    const res = await fetch('/api/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const data = (await res.json().catch(() => ({}))) as McpCallResult;

    if (!res.ok) {
      return { success: false, message: data.message || `El puente MCP devolvió ${res.status}.` };
    }

    return data;
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Lista las tools de un servidor MCP desde el navegador. */
export async function fetchMcpTools(request: McpListRequest): Promise<McpListResult> {
  try {
    const res = await fetch('/api/mcp/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const data = (await res.json().catch(() => ({}))) as McpListResult;

    if (!res.ok) {
      return { success: false, message: data.message || `El puente MCP devolvió ${res.status}.` };
    }

    return data;
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
