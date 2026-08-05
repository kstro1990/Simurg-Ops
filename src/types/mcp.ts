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

  /** Tools que se invocan en cada ejecución. Vacío = el servidor no aporta contexto. */
  calls: McpToolCall[];
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

export const MCP_DEFAULT_TIMEOUT_MS = 30_000;
