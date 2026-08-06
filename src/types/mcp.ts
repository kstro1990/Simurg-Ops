/**
 * Configuración MCP (Model Context Protocol) por agente.
 *
 * Igual que las herramientas de `lib/tools.ts`, las tools MCP se ejecutan como
 * enriquecedores *pre-flight*: se invocan antes de generar y su salida se anexa
 * al prompt. NO hay bucle de tool-calling dirigido por el modelo, porque no todos
 * los proveedores del harness lo soportan (Copilot y claude-code van por CLI
 * one-shot). Por eso el usuario declara explícitamente qué tool invocar y con
 * qué argumentos.
 */

export type McpTransport = 'stdio' | 'http';

/**
 * Cómo se usan las tools de un servidor:
 *
 * - `preflight` — se invocan las tools declaradas en `calls`, siempre, antes de
 *   generar. El modelo no elige nada. Funciona con todos los proveedores.
 * - `agentic` — se le pasan los esquemas de las tools al modelo y él decide cuál
 *   llamar y con qué argumentos, iterando hasta terminar. Es el uso correcto de
 *   MCP y el único que hace útiles las tools de escritura, pero requiere un
 *   proveedor con canal de tool-calling: Gemini y Anthropic por API. Los
 *   proveedores por CLI (`claude-code`, `copilot-cli`) son one-shot y no lo
 *   soportan; ahí se degrada a `preflight`.
 */
export type McpMode = 'preflight' | 'agentic';

/** Una invocación pre-flight: qué tool llamar y con qué argumentos fijos. */
export interface McpToolCall {
  toolName: string;
  /**
   * Valores literales. Dentro de cualquier string se sustituye la plantilla
   * `{{prompt}}` por el prompt del usuario antes de llamar al servidor.
   */
  arguments?: Record<string, unknown>;
}

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;

  // --- stdio: proceso local ---
  /** Binario a lanzar, p. ej. `npx`. Nunca se pasa por un shell. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;

  // --- http: servidor remoto (Streamable HTTP, con reintento por SSE) ---
  url?: string;
  headers?: Record<string, string>;

  /** Timeout por operación. Por defecto `MCP_DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;

  /** Por defecto `preflight`, para no cambiar el comportamiento de lo ya guardado. */
  mode?: McpMode;

  /** Solo en modo `preflight`: tools que se invocan en cada ejecución. */
  calls: McpToolCall[];

  /**
   * Solo en modo `agentic`: tools que se le ofrecen al modelo. Vacío o ausente =
   * todas las que exponga el servidor.
   */
  allowedTools?: string[];
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpListRequest {
  server: McpServerConfig;
}

export interface McpListResult {
  success: boolean;
  tools?: McpToolInfo[];
  /** Motivo del fallo cuando success === false. */
  message?: string;
}

export interface McpCallRequest {
  server: McpServerConfig;
  call: McpToolCall;
  userPrompt: string;
}

export interface McpCallResult {
  success: boolean;
  output?: string;
  message?: string;
}

/**
 * El motor de agentes no importa el cliente MCP directamente: recibe este
 * transporte, exactamente igual que con `BridgeFn`. El transporte stdio usa
 * `child_process`, así que importarlo desde el motor rompería el bundle de
 * cliente.
 *
 * - Servidor y CLI: `runMcpBridge` (lib/mcpClient.ts).
 * - Navegador: `fetchMcpBridge` (lib/mcpBridgeClient.ts).
 */
export type McpFn = (request: McpCallRequest) => Promise<McpCallResult>;

/**
 * Listado de tools, con el mismo criterio de inyección que `McpFn`. El modo
 * agéntico lo necesita para construir los esquemas que ve el modelo.
 */
export type McpListFn = (request: McpListRequest) => Promise<McpListResult>;

export const MCP_DEFAULT_TIMEOUT_MS = 30_000;

/** Tope de vueltas del bucle agéntico, para que un modelo no se quede en bucle. */
export const MCP_MAX_ITERATIONS = 8;

/**
 * Los nombres de tool MCP (`search-vault`, `read-note`) llevan guiones, que los
 * proveedores no siempre aceptan como nombre de función. Se sanean y se guarda
 * el mapa inverso.
 */
export function sanitizeToolName(serverId: string, toolName: string): string {
  return `${serverId}__${toolName}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Registro de una tool ejecutada durante un bucle agéntico. Cuando el bucle
 * corre en el servidor (Anthropic), el navegador no puede ver los pasos en vivo:
 * la traza viaja en el resultado y el motor la convierte en `ThoughtStep`.
 */
export interface McpTraceEntry {
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  output?: string;
  message?: string;
}

/** Una tool MCP ya resuelta y lista para ofrecérsela a un modelo. */
export interface McpBoundTool {
  /** Nombre saneado que ve el modelo. */
  alias: string;
  /** Nombre real en el servidor. */
  toolName: string;
  server: McpServerConfig;
  description: string;
  inputSchema: Record<string, unknown>;
}
