'use client';

import React, { useState } from 'react';
import { Plug, Plus, Trash2, Check, Loader2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { McpServerConfig, McpToolCall, McpToolInfo, MCP_DEFAULT_TIMEOUT_MS } from '@/types/mcp';
import { fetchMcpTools } from '@/lib/mcpBridgeClient';

interface McpServerEditorProps {
  servers: McpServerConfig[];
  onChange: (servers: McpServerConfig[]) => void;
}

/** Estado del botón "Probar conexión" por servidor. */
interface ProbeState {
  loading?: boolean;
  tools?: McpToolInfo[];
  error?: string;
}

const newServer = (): McpServerConfig => ({
  id: 'mcp-' + Date.now().toString(36),
  name: '',
  enabled: true,
  transport: 'stdio',
  command: '',
  args: [],
  env: {},
  calls: [],
});

/** `CLAVE=valor` por línea ⇄ Record. Los valores pueden contener `=`. */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function formatEnv(env?: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

/** `Cabecera: valor` por línea ⇄ Record. */
function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function formatHeaders(headers?: Record<string, string>): string {
  return Object.entries(headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

/**
 * Prellena los argumentos a partir del `inputSchema` de la tool: las propiedades
 * obligatorias de tipo string reciben `{{prompt}}`, que el cliente sustituye por
 * la petición del usuario en cada ejecución.
 */
function draftArguments(tool: McpToolInfo): Record<string, unknown> {
  const schema = tool.inputSchema as
    | { properties?: Record<string, { type?: string }>; required?: string[] }
    | undefined;
  const required = schema?.required ?? [];
  const properties = schema?.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const key of required) {
    const type = properties[key]?.type;
    if (type === 'number' || type === 'integer') out[key] = 0;
    else if (type === 'boolean') out[key] = false;
    else if (type === 'array') out[key] = [];
    else if (type === 'object') out[key] = {};
    else out[key] = '{{prompt}}';
  }
  return out;
}

export const McpServerEditor: React.FC<McpServerEditorProps> = ({ servers, onChange }) => {
  const [expanded, setExpanded] = useState<string | null>(servers.length === 1 ? servers[0].id : null);
  const [probes, setProbes] = useState<Record<string, ProbeState>>({});
  /** Texto crudo del editor de argumentos, para poder teclear JSON inválido sin perder el foco. */
  const [argsDrafts, setArgsDrafts] = useState<Record<string, string>>({});
  const [argsErrors, setArgsErrors] = useState<Record<string, string>>({});

  const patch = (id: string, changes: Partial<McpServerConfig>) => {
    onChange(servers.map((s) => (s.id === id ? { ...s, ...changes } : s)));
  };

  const addServer = () => {
    const server = newServer();
    onChange([...servers, server]);
    setExpanded(server.id);
  };

  const removeServer = (id: string) => {
    onChange(servers.filter((s) => s.id !== id));
  };

  const probe = async (server: McpServerConfig) => {
    setProbes((prev) => ({ ...prev, [server.id]: { loading: true } }));
    const result = await fetchMcpTools({ server });
    setProbes((prev) => ({
      ...prev,
      [server.id]: result.success
        ? { tools: result.tools ?? [] }
        : { error: result.message || 'No se pudo conectar.' },
    }));
  };

  const toggleCall = (server: McpServerConfig, tool: McpToolInfo) => {
    const exists = server.calls.some((c) => c.toolName === tool.name);
    if (exists) {
      patch(server.id, { calls: server.calls.filter((c) => c.toolName !== tool.name) });
      return;
    }
    const call: McpToolCall = { toolName: tool.name, arguments: draftArguments(tool) };
    setArgsDrafts((prev) => ({
      ...prev,
      [`${server.id}::${tool.name}`]: JSON.stringify(call.arguments, null, 2),
    }));
    patch(server.id, { calls: [...server.calls, call] });
  };

  const updateArgs = (server: McpServerConfig, toolName: string, text: string) => {
    const key = `${server.id}::${toolName}`;
    setArgsDrafts((prev) => ({ ...prev, [key]: text }));

    // La configuración guardada se mantiene siempre válida: si el JSON no parsea
    // se muestra el error y no se propaga el cambio.
    try {
      const parsed = text.trim() ? JSON.parse(text) : {};
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Los argumentos deben ser un objeto JSON.');
      }
      setArgsErrors((prev) => ({ ...prev, [key]: '' }));
      patch(server.id, {
        calls: server.calls.map((c) =>
          c.toolName === toolName ? { ...c, arguments: parsed as Record<string, unknown> } : c
        ),
      });
    } catch (err) {
      setArgsErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : 'JSON inválido.',
      }));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
          <Plug className="w-4 h-4 text-cyan-400" />
          Servidores MCP de este agente
        </span>
        <button
          type="button"
          onClick={addServer}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Añadir servidor
        </button>
      </div>

      <p className="text-[10px] text-slate-500 mb-3">
        Las tools MCP se ejecutan <strong>antes</strong> de generar y su salida se añade al prompt.
        El modelo no las elige: indica aquí qué invocar y con qué argumentos. Usa{' '}
        <code className="text-cyan-400">{'{{prompt}}'}</code> para insertar la petición del usuario.
      </p>

      {servers.length === 0 && (
        <div className="p-3 rounded-xl bg-slate-900/40 border border-white/5 text-[11px] text-slate-500">
          Sin servidores MCP. Este agente solo usará las herramientas locales.
        </div>
      )}

      <div className="space-y-2.5">
        {servers.map((server) => {
          const isOpen = expanded === server.id;
          const state = probes[server.id] ?? {};
          return (
            <div
              key={server.id}
              className="rounded-xl border border-white/10 bg-slate-900/40 overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : server.id)}
                  className="text-slate-400 hover:text-white"
                  aria-label={isOpen ? 'Contraer' : 'Expandir'}
                >
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-slate-200 truncate">
                    {server.name || 'Servidor sin nombre'}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {server.transport === 'stdio'
                      ? `stdio · ${server.command || 'sin comando'}`
                      : `http · ${server.url || 'sin URL'}`}
                    {' · '}
                    {server.calls.length} tool{server.calls.length === 1 ? '' : 's'}
                  </div>
                </div>

                <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={(e) => patch(server.id, { enabled: e.target.checked })}
                    className="accent-cyan-500"
                  />
                  Activo
                </label>

                <button
                  type="button"
                  onClick={() => removeServer(server.id)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  aria-label="Eliminar servidor"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {isOpen && (
                <div className="px-3 pb-3 space-y-3 border-t border-white/5 pt-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                        Nombre
                      </label>
                      <input
                        type="text"
                        placeholder="Ej: Ficheros locales"
                        value={server.name}
                        onChange={(e) => patch(server.id, { name: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-lg glass-input text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                        Transporte
                      </label>
                      <select
                        value={server.transport}
                        onChange={(e) =>
                          patch(server.id, { transport: e.target.value as 'stdio' | 'http' })
                        }
                        className="w-full px-3 py-1.5 rounded-lg glass-input text-xs"
                      >
                        <option value="stdio">stdio (proceso local)</option>
                        <option value="http">http (servidor remoto)</option>
                      </select>
                    </div>
                  </div>

                  {server.transport === 'stdio' ? (
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                          Comando
                        </label>
                        <input
                          type="text"
                          placeholder="npx"
                          value={server.command ?? ''}
                          onChange={(e) => patch(server.id, { command: e.target.value })}
                          className="w-full px-3 py-1.5 rounded-lg glass-input text-xs font-mono"
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                            Argumentos (uno por línea)
                          </label>
                          <textarea
                            rows={3}
                            placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/tmp'}
                            value={(server.args ?? []).join('\n')}
                            onChange={(e) =>
                              patch(server.id, {
                                args: e.target.value.split('\n').filter((a) => a.trim().length > 0),
                              })
                            }
                            className="w-full px-3 py-2 rounded-lg glass-input text-[11px] font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                            Variables de entorno (CLAVE=valor)
                          </label>
                          <textarea
                            rows={3}
                            placeholder={'API_TOKEN=xxxx'}
                            defaultValue={formatEnv(server.env)}
                            onChange={(e) => patch(server.id, { env: parseEnv(e.target.value) })}
                            className="w-full px-3 py-2 rounded-lg glass-input text-[11px] font-mono"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-amber-400/80 flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        El transporte stdio ejecuta este binario en la máquina donde corre el
                        harness, con acceso completo a disco y red.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                          URL del endpoint MCP
                        </label>
                        <input
                          type="url"
                          placeholder="https://ejemplo.com/mcp"
                          value={server.url ?? ''}
                          onChange={(e) => patch(server.id, { url: e.target.value })}
                          className="w-full px-3 py-1.5 rounded-lg glass-input text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                          Cabeceras (Cabecera: valor)
                        </label>
                        <textarea
                          rows={2}
                          placeholder={'Authorization: Bearer xxxx'}
                          defaultValue={formatHeaders(server.headers)}
                          onChange={(e) => patch(server.id, { headers: parseHeaders(e.target.value) })}
                          className="w-full px-3 py-2 rounded-lg glass-input text-[11px] font-mono"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                      Timeout (ms)
                    </label>
                    <input
                      type="number"
                      min={1000}
                      step={1000}
                      placeholder={String(MCP_DEFAULT_TIMEOUT_MS)}
                      value={server.timeoutMs ?? ''}
                      onChange={(e) =>
                        patch(server.id, {
                          timeoutMs: e.target.value ? parseInt(e.target.value, 10) : undefined,
                        })
                      }
                      className="w-full px-3 py-1.5 rounded-lg glass-input text-xs"
                    />
                  </div>

                  <div className="pt-2 border-t border-white/5">
                    <button
                      type="button"
                      onClick={() => probe(server)}
                      disabled={state.loading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-50 transition-colors"
                    >
                      {state.loading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Plug className="w-3 h-3" />
                      )}
                      Probar conexión y listar tools
                    </button>

                    {state.error && (
                      <p className="mt-2 text-[10px] text-rose-400 flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        {/* El stderr del servidor llega en varias líneas (p. ej. los
                            pasos que imprime obsidian-mcp); sin esto se aplastan. */}
                        <span className="whitespace-pre-line font-mono">{state.error}</span>
                      </p>
                    )}

                    {state.tools && state.tools.length === 0 && (
                      <p className="mt-2 text-[10px] text-slate-500">
                        Conectado, pero el servidor no expone ninguna tool.
                      </p>
                    )}

                    {state.tools && state.tools.length > 0 && (
                      <div className="mt-2.5 space-y-2">
                        <p className="text-[10px] text-slate-500">
                          {state.tools.length} tools disponibles. Marca las que deba invocar el
                          agente en cada ejecución:
                        </p>
                        {state.tools.map((tool) => {
                          const call = server.calls.find((c) => c.toolName === tool.name);
                          const key = `${server.id}::${tool.name}`;
                          return (
                            <div
                              key={tool.name}
                              className={`rounded-lg border p-2.5 transition-colors ${
                                call
                                  ? 'bg-cyan-500/10 border-cyan-500/30'
                                  : 'bg-slate-900/60 border-white/5'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => toggleCall(server, tool)}
                                className="flex items-start gap-2 text-left w-full"
                              >
                                <div
                                  className={`w-3.5 h-3.5 mt-0.5 rounded border flex items-center justify-center shrink-0 ${
                                    call ? 'bg-cyan-500 border-cyan-500' : 'border-white/20'
                                  }`}
                                >
                                  {call && <Check className="w-2.5 h-2.5 text-slate-950" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] font-bold text-slate-200 font-mono">
                                    {tool.name}
                                  </div>
                                  {tool.description && (
                                    <p className="text-[10px] text-slate-400 mt-0.5">
                                      {tool.description}
                                    </p>
                                  )}
                                </div>
                              </button>

                              {call && (
                                <div className="mt-2">
                                  <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                                    Argumentos (JSON)
                                  </label>
                                  <textarea
                                    rows={3}
                                    value={
                                      argsDrafts[key] ??
                                      JSON.stringify(call.arguments ?? {}, null, 2)
                                    }
                                    onChange={(e) => updateArgs(server, tool.name, e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg glass-input text-[11px] font-mono"
                                  />
                                  {argsErrors[key] && (
                                    <p className="text-[10px] text-rose-400 mt-1">
                                      {argsErrors[key]}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {!state.tools && server.calls.length > 0 && (
                      <p className="mt-2 text-[10px] text-slate-500">
                        Tools configuradas: {server.calls.map((c) => c.toolName).join(', ')}. Prueba
                        la conexión para editarlas.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
