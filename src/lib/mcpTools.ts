/**
 * Utilidades del modo agéntico MCP: resolver qué tools se le ofrecen al modelo
 * y ejecutar la que elija.
 *
 * Es lógica pura a propósito — sin `child_process` ni nada de Node — para que la
 * puedan usar tanto `agentEngine.ts` (que corre también en el navegador) como
 * `providerBridge.ts` (solo servidor).
 */

import {
  McpBoundTool,
  McpCallResult,
  McpFn,
  McpListFn,
  McpServerConfig,
  sanitizeToolName,
} from '@/types/mcp';

/** Claves de JSON Schema que los proveedores aceptan sin protestar. */
const SCHEMA_KEYS = new Set([
  'type',
  'description',
  'properties',
  'required',
  'items',
  'enum',
  'nullable',
]);

/**
 * Los esquemas MCP son JSON Schema completo (`$schema`, `additionalProperties`,
 * `minLength`, `default`…). Gemini rechaza las claves que no conoce, así que se
 * poda a lo que entienden todos los proveedores.
 */
export function sanitizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {} };
  }

  const prune = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(prune);
    if (!node || typeof node !== 'object') return node;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (!SCHEMA_KEYS.has(key)) continue;
      if (key === 'properties' && value && typeof value === 'object') {
        const props: Record<string, unknown> = {};
        for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
          props[propName] = prune(propSchema);
        }
        out.properties = props;
      } else if (key === 'items') {
        out.items = prune(value);
      } else {
        out[key] = value;
      }
    }
    if (!out.type) out.type = 'object';
    return out;
  };

  const pruned = prune(schema) as Record<string, unknown>;
  // Un objeto sin propiedades declaradas hace fallar la validación en algunos
  // proveedores; se le da una forma mínima válida.
  if (pruned.type === 'object' && !pruned.properties) pruned.properties = {};
  return pruned;
}

export interface ResolvedTools {
  tools: McpBoundTool[];
  /** Servidores que no se pudieron consultar, con su motivo. */
  failures: string[];
}

/**
 * Lista las tools de los servidores en modo agéntico y las deja listas para
 * ofrecérselas al modelo. Un servidor caído no impide usar los demás.
 */
export async function resolveAgenticTools(
  servers: McpServerConfig[],
  listFn: McpListFn
): Promise<ResolvedTools> {
  const tools: McpBoundTool[] = [];
  const failures: string[] = [];
  const seen = new Set<string>();

  for (const server of servers) {
    const label = server.name || server.id;
    const result = await listFn({ server });

    if (!result.success) {
      failures.push(result.message || `MCP [${label}]: no se pudieron listar sus tools.`);
      continue;
    }

    const allow = server.allowedTools?.length ? new Set(server.allowedTools) : null;

    for (const tool of result.tools ?? []) {
      if (allow && !allow.has(tool.name)) continue;

      let alias = sanitizeToolName(server.id, tool.name);
      // Dos servidores distintos podrían sanear al mismo alias; se desempata.
      let suffix = 2;
      while (seen.has(alias)) alias = `${sanitizeToolName(server.id, tool.name)}_${suffix++}`;
      seen.add(alias);

      tools.push({
        alias,
        toolName: tool.name,
        server,
        description: tool.description || `Tool ${tool.name} del servidor MCP ${label}.`,
        inputSchema: sanitizeSchema(tool.inputSchema),
      });
    }
  }

  return { tools, failures };
}

/**
 * Ejecuta la tool que pidió el modelo. Los argumentos vienen del modelo, así que
 * no se interpola `{{prompt}}`: aquí el modelo sí elige, que es justo el punto
 * del modo agéntico.
 */
export async function executeBoundTool(
  tool: McpBoundTool,
  args: Record<string, unknown>,
  mcpFn: McpFn
): Promise<McpCallResult> {
  return mcpFn({
    server: tool.server,
    call: { toolName: tool.toolName, arguments: args },
    userPrompt: '',
  });
}

/** Servidores habilitados que corren en modo agéntico. */
export function agenticServers(servers: McpServerConfig[] | undefined): McpServerConfig[] {
  return (servers ?? []).filter((s) => s.enabled && s.mode === 'agentic');
}

/** Servidores habilitados que corren como enriquecedores pre-flight. */
export function preflightServers(servers: McpServerConfig[] | undefined): McpServerConfig[] {
  return (servers ?? []).filter(
    (s) => s.enabled && s.mode !== 'agentic' && (s.calls?.length ?? 0) > 0
  );
}
