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

/** Tope del buffer de stderr, para que un servidor ruidoso no infle memoria. */
const STDERR_LIMIT = 8 * 1024;
/** Recorte del stderr al mostrarlo en la UI. */
const STDERR_DISPLAY_LIMIT = 600;

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

/** Un transporte junto a lo que su proceso haya escrito en stderr, si aplica. */
interface TransportAttempt {
  transport: Transport;
  readStderr: () => string;
}

/**
 * Error de arranque que arrastra el stderr del proceso hijo. Sin esto, un
 * servidor que muere durante el handshake solo produce "-32000 Connection
 * closed", que no dice nada: el motivo real siempre va por stderr.
 */
class McpStartupError extends Error {
  stderr: string;
  constructor(cause: unknown, stderr: string) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'McpStartupError';
    this.stderr = stderr;
  }
}

function buildStdioTransport(server: McpServerConfig): TransportAttempt {
  const command = server.command?.trim();
  if (!command) {
    throw new Error('El servidor stdio no tiene comando configurado.');
  }
  const transport = new StdioClientTransport({
    command,
    args: server.args?.filter((arg) => arg.length > 0) ?? [],
    // getDefaultEnvironment() filtra el entorno del proceso a lo seguro de heredar
    // (PATH, HOME…); encima van las variables que declaró el usuario.
    env: { ...getDefaultEnvironment(), ...(server.env ?? {}) },
    stderr: 'pipe',
  });

  // El listener se engancha AHORA, antes de connect(): el SDK devuelve el
  // PassThrough de inmediato justo para esto, y una tubería que nadie drena
  // acaba bloqueando a un servidor hablador.
  let captured = '';
  transport.stderr?.on('data', (chunk: Buffer | string) => {
    if (captured.length >= STDERR_LIMIT) return;
    captured += chunk.toString();
    if (captured.length > STDERR_LIMIT) captured = captured.slice(0, STDERR_LIMIT);
  });

  return { transport, readStderr: () => captured.trim() };
}

function buildHttpTransports(server: McpServerConfig): TransportAttempt[] {
  const raw = server.url?.trim();
  if (!raw) {
    throw new Error('El servidor HTTP no tiene URL configurada.');
  }
  const url = new URL(raw);
  const headers = server.headers && Object.keys(server.headers).length > 0 ? server.headers : undefined;
  // Streamable HTTP es el transporte actual; SSE es el legado. El SDK no hace
  // el fallback solo, así que se intenta en orden. No hay proceso hijo, así que
  // tampoco hay stderr que capturar.
  return [
    new StreamableHTTPClientTransport(url, { requestInit: headers ? { headers } : undefined }),
    new SSEClientTransport(url, { requestInit: headers ? { headers } : undefined }),
  ].map((transport) => ({ transport, readStderr: () => '' }));
}

/**
 * Abre una conexión, ejecuta `fn` y cierra siempre. Para HTTP prueba Streamable
 * y, si el handshake falla, reintenta con SSE.
 */
async function withClient<T>(server: McpServerConfig, fn: (client: Client) => Promise<T>): Promise<T> {
  const ms = timeoutOf(server);
  const attempts =
    server.transport === 'stdio' ? [buildStdioTransport(server)] : buildHttpTransports(server);

  // Se conserva el error del PRIMER transporte: es el principal, y si se
  // reportara el del reintento SSE un 401 acabaría saliendo como el 404 que
  // devuelve el endpoint al no tener ruta GET.
  let firstError: unknown;
  for (const attempt of attempts) {
    const client = new Client(CLIENT_INFO);
    try {
      await withTimeout(client.connect(attempt.transport), ms, 'Conexión MCP');
    } catch (err) {
      // El proceso puede seguir escribiendo el motivo justo al morir; se le da
      // un respiro para que el stderr llegue antes de construir el mensaje.
      await new Promise((r) => setTimeout(r, 50));
      if (firstError === undefined) firstError = new McpStartupError(err, attempt.readStderr());
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

/** Recorta el stderr sin partir una línea por la mitad. */
function trimStderr(text: string): string {
  if (text.length <= STDERR_DISPLAY_LIMIT) return text;
  const cut = text.slice(0, STDERR_DISPLAY_LIMIT);
  const lastBreak = cut.lastIndexOf('\n');
  return `${(lastBreak > 0 ? cut.slice(0, lastBreak) : cut).trimEnd()}\n…`;
}

/** Traduce fallos habituales a algo accionable en la UI. */
function describeFailure(server: McpServerConfig, err: unknown): string {
  const message = errorMessage(err);
  const label = server.name || server.id;

  // Lo que el propio servidor imprimió gana a cualquier error de protocolo:
  // "Vault directory does not exist: /ruta" vale mucho más que "Connection closed".
  const stderr = err instanceof McpStartupError ? err.stderr : '';
  if (stderr) {
    return `MCP [${label}]: ${trimStderr(stderr)}`;
  }

  if (server.transport === 'stdio') {
    if (message.includes('ENOENT')) {
      return `MCP [${label}]: no se encontró el comando "${server.command}". Comprueba que está instalado y en el PATH.`;
    }
    if (message.includes('EACCES')) {
      return `MCP [${label}]: sin permisos para ejecutar "${server.command}".`;
    }
    if (/-32000|connection closed/i.test(message)) {
      // Sin stderr no hay nada que traducir: el proceso arrancó y se cerró sin
      // hablar MCP. Lo accionable es que el usuario lo lance a mano y mire.
      const cmd = [server.command, ...(server.args ?? [])].join(' ');
      return `MCP [${label}]: el proceso arrancó y se cerró sin completar el handshake MCP, y no escribió nada en stderr. Pruébalo a mano en una terminal: ${cmd}`;
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
