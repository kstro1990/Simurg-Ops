/**
 * Importa el bloque JSON con el que se documentan todos los servidores MCP.
 *
 * Transcribir ese bloque a mano a los campos del modal es donde se cuelan los
 * errores: basta dejar el nombre del paquete y una ruta en la misma línea del
 * campo de argumentos para que lleguen como un solo `argv` y el comando falle
 * con un mensaje que no se parece en nada a la causa. Pegando el JSON el array
 * ya viene partido y no hay nada que transcribir.
 */

import { McpServerConfig } from '@/types/mcp';

export interface McpImportResult {
  servers: McpServerConfig[];
  /** Motivo del fallo cuando no se pudo importar nada. */
  error?: string;
}

/** Forma laxa: es JSON de fuera, no se asume nada. */
type RawServer = Record<string, unknown>;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Acepta tanto `["-y", "pkg"]` como una cadena suelta. */
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
  }
  const single = asString(value);
  return single ? [single] : [];
}

function asStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item;
    else if (typeof item === 'number' || typeof item === 'boolean') out[key] = String(item);
  }
  return out;
}

function isServerShape(value: unknown): value is RawServer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as RawServer;
  return typeof obj.command === 'string' || typeof obj.url === 'string' || typeof obj.type === 'string';
}

/** Nombre de reserva: el primer argumento que no es un flag suele ser el paquete. */
function inferName(raw: RawServer): string {
  const args = asStringArray(raw.args);
  const pkg = args.find((a) => !a.startsWith('-'));
  return pkg || asString(raw.command) || 'Servidor MCP';
}

function toServerConfig(name: string, raw: RawServer, index: number): McpServerConfig | null {
  const url = asString(raw.url);
  const command = asString(raw.command);
  const type = asString(raw.type)?.toLowerCase();

  // Un id por servidor: importar varios de golpe con Date.now() a secas los
  // colapsaría en el mismo id.
  const id = `mcp-${Date.now().toString(36)}-${index}`;

  if (url || type === 'http' || type === 'sse' || type === 'streamable-http') {
    if (!url) return null;
    return {
      id,
      name,
      enabled: true,
      transport: 'http',
      url,
      headers: asStringRecord(raw.headers),
      calls: [],
    };
  }

  if (command) {
    return {
      id,
      name,
      enabled: true,
      transport: 'stdio',
      command,
      args: asStringArray(raw.args),
      env: asStringRecord(raw.env),
      calls: [],
    };
  }

  return null;
}

/**
 * Acepta, en este orden:
 * - `{ "mcpServers": { "<nombre>": { … } } }` — el formato publicado.
 * - `{ "<nombre>": { "command": … } }` — el mapa suelto.
 * - `{ "command": …, "args": [...] }` — un único servidor.
 *
 * Las claves de otros clientes que aquí no se usan (`disabled`, `alwaysAllow`,
 * `timeout`…) se ignoran sin romper.
 */
export function parseMcpConfig(text: string): McpImportResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { servers: [], error: 'Pega la configuración JSON del servidor.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      servers: [],
      error: `JSON inválido: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { servers: [], error: 'Se esperaba un objeto JSON.' };
  }

  const root = parsed as Record<string, unknown>;
  const container =
    root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers)
      ? (root.mcpServers as Record<string, unknown>)
      : root;

  // Un único servidor pegado sin envoltorio ni nombre.
  if (isServerShape(container)) {
    const raw = container as RawServer;
    const server = toServerConfig(inferName(raw), raw, 0);
    return server
      ? { servers: [server] }
      : { servers: [], error: 'El servidor no indica ni "command" ni "url".' };
  }

  const servers: McpServerConfig[] = [];
  const skipped: string[] = [];
  let index = 0;
  for (const [name, value] of Object.entries(container)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const server = toServerConfig(name, value as RawServer, index++);
    if (server) servers.push(server);
    else skipped.push(name);
  }

  if (servers.length === 0) {
    return {
      servers: [],
      error: skipped.length
        ? `Ningún servidor utilizable: ${skipped.join(', ')} no indican "command" ni "url".`
        : 'No se encontró ninguna configuración de servidor MCP en ese JSON.',
    };
  }

  // Algo entró: se reporta lo descartado sin bloquear el resto.
  return {
    servers,
    error: skipped.length ? `Se omitieron (sin "command" ni "url"): ${skipped.join(', ')}.` : undefined,
  };
}
