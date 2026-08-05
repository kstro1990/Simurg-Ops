/**
 * Cliente MCP del harness. **Solo servidor**: el transporte stdio lanza procesos
 * con child_process, así que este módulo no puede acabar en el bundle del
 * navegador. Igual que `providerBridge.ts`, se inyecta en el motor en vez de
 * importarse desde él (ver `McpFn` en types/mcp.ts).
 *
 * Cada operación abre una conexión, la usa y la cierra. No hay pool: encaja con
 * el modelo one-shot del resto del harness y evita dejar procesos hijos
 * huérfanos vivos entre requests de Next.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  McpCallRequest,
  McpCallResult,
  McpListRequest,
  McpListResult,
  McpServerConfig,
  McpToolInfo,
  MCP_DEFAULT_TIMEOUT_MS,
} from '@/types/mcp';

const CLIENT_INFO = { name: 'ai-agent-harness', version: '0.1.0' };

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function timeoutOf(server: McpServerConfig): number {
  const value = Number(server.timeoutMs);
  return Number.isFinite(value) && value > 0 ? value : MCP_DEFAULT_TIMEOUT_MS;
}

/**
 * `connect()` no acepta timeout propio: un servidor stdio que nunca responde al
 * handshake dejaría la ejecución colgada indefinidamente.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: sin respuesta tras ${ms} ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function buildStdioTransport(server: McpServerConfig): Transport {
  const command = server.command?.trim();
  if (!command) {
    throw new Error('El servidor stdio no tiene comando configurado.');
  }
  return new StdioClientTransport({
    command,
    args: server.args?.filter((arg) => arg.length > 0) ?? [],
    // getDefaultEnvironment() filtra el entorno del proceso a lo seguro de heredar
    // (PATH, HOME…); encima van las variables que declaró el usuario.
    env: { ...getDefaultEnvironment(), ...(server.env ?? {}) },
    stderr: 'ignore',
  });
}

function buildHttpTransports(server: McpServerConfig): Transport[] {
  const raw = server.url?.trim();
  if (!raw) {
    throw new Error('El servidor HTTP no tiene URL configurada.');
  }
  const url = new URL(raw);
  const headers = server.headers && Object.keys(server.headers).length > 0 ? server.headers : undefined;
  // Streamable HTTP es el transporte actual; SSE es el legado. El SDK no hace
  // el fallback solo, así que se intenta en orden.
  return [
    new StreamableHTTPClientTransport(url, { requestInit: headers ? { headers } : undefined }),
    new SSEClientTransport(url, { requestInit: headers ? { headers } : undefined }),
  ];
}

/**
 * Abre una conexión, ejecuta `fn` y cierra siempre. Para HTTP prueba Streamable
 * y, si el handshake falla, reintenta con SSE.
 */
async function withClient<T>(server: McpServerConfig, fn: (client: Client) => Promise<T>): Promise<T> {
  const ms = timeoutOf(server);
  const transports = server.transport === 'stdio' ? [buildStdioTransport(server)] : buildHttpTransports(server);

  // Se conserva el error del PRIMER transporte: es el principal, y si se
  // reportara el del reintento SSE un 401 acabaría saliendo como el 404 que
  // devuelve el endpoint al no tener ruta GET.
  let firstError: unknown;
  for (let i = 0; i < transports.length; i++) {
    const client = new Client(CLIENT_INFO);
    try {
      await withTimeout(client.connect(transports[i]), ms, 'Conexión MCP');
    } catch (err) {
      if (firstError === undefined) firstError = err;
      await client.close().catch(() => {});
      // Un fallo de autenticación no es un desajuste de transporte: reintentar
      // por SSE solo enmascararía la causa real.
      if (/401|403|unauthorized|forbidden/i.test(errorMessage(err))) break;
      continue;
    }
    try {
      return await fn(client);
    } finally {
      await client.close().catch(() => {});
    }
  }
  throw firstError ?? new Error('No se pudo conectar con el servidor MCP.');
}

/** Aplana el `content[]` de MCP a texto plano para poder anexarlo al prompt. */
function flattenContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const item = block as Record<string, unknown>;
    switch (item.type) {
      case 'text':
        if (typeof item.text === 'string') parts.push(item.text);
        break;
      case 'image':
        parts.push(`[imagen ${typeof item.mimeType === 'string' ? item.mimeType : 'binaria'} omitida]`);
        break;
      case 'audio':
        parts.push('[audio omitido]');
        break;
      case 'resource_link':
        parts.push(`[recurso: ${String(item.uri ?? 'sin uri')}]`);
        break;
      case 'resource': {
        const resource = item.resource as Record<string, unknown> | undefined;
        if (resource && typeof resource.text === 'string') {
          parts.push(resource.text);
        } else {
          parts.push(`[recurso: ${String(resource?.uri ?? 'sin uri')}]`);
        }
        break;
      }
      default:
        parts.push(JSON.stringify(item));
    }
  }
  return parts.join('\n').trim();
}

/**
 * Sustituye `{{prompt}}` por el prompt del usuario en todos los strings de los
 * argumentos, incluidos los anidados. El modelo no elige argumentos en este
 * diseño pre-flight, así que esta plantilla es la única vía para que la llamada
 * dependa de la petición.
 */
export function interpolateArgs(value: unknown, userPrompt: string): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*prompt\s*\}\}/g, userPrompt);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateArgs(item, userPrompt));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = interpolateArgs(item, userPrompt);
    }
    return out;
  }
  return value;
}

/** Lista las tools que expone un servidor. Lo usa el botón "Probar conexión". */
export async function listMcpTools(request: McpListRequest): Promise<McpListResult> {
  const { server } = request;
  try {
    const tools = await withClient(server, async (client) => {
      const result = await client.listTools(undefined, { timeout: timeoutOf(server) });
      return (result.tools ?? []).map(
        (tool): McpToolInfo => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })
      );
    });
    return { success: true, tools };
  } catch (err) {
    return { success: false, message: describeFailure(server, err) };
  }
}

/** Implementación real de `McpFn`. */
export async function runMcpBridge(request: McpCallRequest): Promise<McpCallResult> {
  const { server, call, userPrompt } = request;
  if (!call.toolName) {
    return { success: false, message: 'La invocación MCP no indica ninguna tool.' };
  }

  const args = interpolateArgs(call.arguments ?? {}, userPrompt) as Record<string, unknown>;

  try {
    return await withClient(server, async (client) => {
      const result = await client.callTool(
        { name: call.toolName, arguments: args },
        undefined,
        { timeout: timeoutOf(server) }
      );

      const output = flattenContent(result.content);

      if (result.isError) {
        // Un error de la tool llega como resultado normal con isError, no como
        // excepción, así que no pasa por describeFailure: se etiqueta aquí.
        const label = server.name || server.id;
        return {
          success: false,
          message: `MCP [${label}] → ${call.toolName}: ${output || 'error sin detalle.'}`,
        };
      }
      if (!output) {
        return { success: true, output: '(la tool no devolvió contenido textual)' };
      }
      return { success: true, output };
    });
  } catch (err) {
    return { success: false, message: describeFailure(server, err) };
  }
}

/** Traduce fallos habituales a algo accionable en la UI. */
function describeFailure(server: McpServerConfig, err: unknown): string {
  const message = errorMessage(err);
  const label = server.name || server.id;

  if (server.transport === 'stdio') {
    if (message.includes('ENOENT')) {
      return `MCP [${label}]: no se encontró el comando "${server.command}". Comprueba que está instalado y en el PATH.`;
    }
    if (message.includes('EACCES')) {
      return `MCP [${label}]: sin permisos para ejecutar "${server.command}".`;
    }
  } else {
    if (/401|unauthorized/i.test(message)) {
      return `MCP [${label}]: 401 no autorizado. Revisa las cabeceras de autenticación.`;
    }
    if (/403|forbidden/i.test(message)) {
      return `MCP [${label}]: 403 prohibido. El token no tiene acceso a este servidor.`;
    }
    if (/404/.test(message)) {
      return `MCP [${label}]: 404 en ${server.url}. ¿Es esa la ruta del endpoint MCP?`;
    }
    if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(message)) {
      return `MCP [${label}]: no se pudo alcanzar ${server.url}.`;
    }
  }
  return `MCP [${label}]: ${message}`;
}
