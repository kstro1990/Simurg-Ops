'use client';

import React, { useState } from 'react';
import { AgentConfig, AgentModel, DEFAULT_MODEL, ToolName } from '@/types/agent';
import { MAX_MEMORY_TURNS, resolveMemoryTurns } from '@/types/conversation';
import { McpServerConfig } from '@/types/mcp';
import { X, Wrench, Cpu, Check } from 'lucide-react';
import { TOOLS } from '@/lib/tools';
import { McpServerEditor } from './McpServerEditor';

interface AgentModalProps {
  onClose: () => void;
  onSave: (agent: AgentConfig) => void;
  initialAgent?: AgentConfig | null;
}

const EMOJI_OPTIONS = ['🤖', '🕵️', '💻', '🔍', '✍️', '🎨', '🧠', '⚡', '🚀', '📊', '🛡️', '⚙️'];

const DEFAULT_TOOLS: ToolName[] = ['web_search'];
const DEFAULT_SYSTEM_PROMPT =
  'Eres un agente autónomo de IA diseñado para asistir al usuario de manera precisa y eficiente.';

const MIN_MAX_TOKENS = 256;
const MAX_MAX_TOKENS = 8192;

interface ModelOption {
  id: AgentModel;
  label: string;
  desc: string;
}

const GEMINI_MODELS: ModelOption[] = [
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', desc: 'Equilibrado, agentes y multimodal' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', desc: 'Agentes y programación' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', desc: 'Razonamiento profundo (preview)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', desc: 'El más rápido y barato' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', desc: 'Económico, alto volumen' },
];

const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'claude-code', label: 'Claude Code CLI', desc: 'Agente CLI local (claude -p)' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', desc: 'Máxima capacidad' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', desc: 'Equilibrio velocidad/calidad' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', desc: 'Ultra rápido y económico' },
];

const OPENAI_MODELS: ModelOption[] = [
  // Elegir modelo explícito requiere un plan de Copilot que lo permita; en los
  // planes restringidos sólo funciona el modo automático.
  { id: 'copilot-cli', label: 'Copilot (automático)', desc: 'El CLI elige el modelo — compatible con todos los planes' },
  { id: 'copilot-claude-opus-5', label: 'Copilot · Claude Opus 5', desc: 'Máxima capacidad (según plan)' },
  { id: 'copilot-claude-sonnet-5', label: 'Copilot · Claude Sonnet 5', desc: 'Equilibrio velocidad/calidad (según plan)' },
  { id: 'copilot-claude-haiku-4.5', label: 'Copilot · Claude Haiku 4.5', desc: 'Ultra rápido y económico (según plan)' },
  { id: 'copilot-gpt-5.5', label: 'Copilot · GPT-5.5', desc: 'Razonamiento general (según plan)' },
  { id: 'copilot-gpt-5-mini', label: 'Copilot · GPT-5 Mini', desc: 'El más barato (según plan)' },
  { id: 'copilot-gemini-3.1-pro-preview', label: 'Copilot · Gemini 3.1 Pro', desc: 'Contexto largo, preview (según plan)' },
  { id: 'gpt-4o', label: 'OpenAI GPT-4o', desc: 'Multimodal de alta precisión' },
  { id: 'gpt-4o-mini', label: 'OpenAI GPT-4o Mini', desc: 'Económico y rápido' },
];

export const AgentModal: React.FC<AgentModalProps> = ({ onClose, onSave, initialAgent }) => {
  // El componente se monta de nuevo cada vez que se abre (la página lo renderiza
  // condicionalmente con `key`), así que el estado se inicializa desde las props
  // en lugar de sincronizarse con un efecto.
  const [name, setName] = useState(initialAgent?.name ?? '');
  const [role, setRole] = useState(initialAgent?.role ?? '');
  const [description, setDescription] = useState(initialAgent?.description ?? '');
  const [avatar, setAvatar] = useState(initialAgent?.avatar || '🤖');
  const [model, setModel] = useState<AgentModel>(initialAgent?.model ?? DEFAULT_MODEL);
  const [systemPrompt, setSystemPrompt] = useState(
    initialAgent?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
  );
  const [temperature, setTemperature] = useState(initialAgent?.temperature ?? 0.3);
  const [maxTokens, setMaxTokens] = useState(initialAgent?.maxTokens ?? 2048);
  const [memoryTurns, setMemoryTurns] = useState(resolveMemoryTurns(initialAgent?.memoryTurns));
  const [selectedTools, setSelectedTools] = useState<ToolName[]>(
    initialAgent?.tools ?? DEFAULT_TOOLS
  );
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(initialAgent?.mcpServers ?? []);

  const toggleTool = (toolName: ToolName) => {
    setSelectedTools((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    // El input de tipo number permite escribir cualquier valor; los atributos
    // min/max del HTML no lo impiden al enviar por teclado.
    const safeMaxTokens = Math.min(
      MAX_MAX_TOKENS,
      Math.max(MIN_MAX_TOKENS, Number.isFinite(maxTokens) ? maxTokens : 2048)
    );

    const agentToSave: AgentConfig = {
      id: initialAgent?.id || 'agent-' + Date.now(),
      name: name.trim(),
      role: role.trim() || 'Especialista en IA',
      description: description.trim() || 'Agente configurado a medida.',
      avatar,
      model,
      systemPrompt: systemPrompt.trim(),
      temperature,
      maxTokens: safeMaxTokens,
      tools: selectedTools,
      memoryTurns: resolveMemoryTurns(memoryTurns),
      mcpServers,
      // Este modal no edita el enrolamiento de Telegram: hay que arrastrarlo,
      // o guardar un agente enrolado lo desenrolaría sin avisar.
      telegramConfig: initialAgent?.telegramConfig,
      // Editar un preset no lo convierte en personalizado.
      isCustom: initialAgent ? (initialAgent.isCustom ?? false) : true,
      createdAt: initialAgent?.createdAt || new Date().toISOString(),
    };

    onSave(agentToSave);
    onClose();
  };

  const renderModelGroup = (
    title: string,
    titleClass: string,
    options: ModelOption[],
    selectedClass: string
  ) => (
    <div>
      <div className={`text-[11px] font-bold mb-1.5 flex items-center gap-1 ${titleClass}`}>
        {title}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {options.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setModel(item.id)}
            className={`p-2.5 rounded-xl text-left border transition-all ${
              model === item.id
                ? selectedClass
                : 'bg-slate-900/60 border-white/10 text-slate-400 hover:border-white/20'
            }`}
          >
            <div className="text-xs font-bold">{item.label}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{item.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-2xl rounded-2xl border border-white/10 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xl">
              {avatar}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">
                {initialAgent ? 'Editar Agente' : 'Crear Nuevo Agente'}
              </h2>
              <p className="text-xs text-slate-400">
                Configura la identidad, modelo y capacidades del agente
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-3 flex flex-col items-center">
              <span className="text-xs font-semibold text-slate-300 mb-2">Avatar Emoji</span>
              <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center text-3xl mb-2 shadow-inner">
                {avatar}
              </div>
              <div className="flex flex-wrap justify-center gap-1 max-w-[120px]">
                {EMOJI_OPTIONS.map((emo) => (
                  <button
                    key={emo}
                    type="button"
                    onClick={() => setAvatar(emo)}
                    className={`w-6 h-6 rounded text-xs flex items-center justify-center transition-all ${
                      avatar === emo
                        ? 'bg-indigo-600 ring-2 ring-indigo-400'
                        : 'bg-slate-800 hover:bg-slate-700'
                    }`}
                  >
                    {emo}
                  </button>
                ))}
              </div>
            </div>

            <div className="md:col-span-9 space-y-3">
              <div>
                <label htmlFor="agent-name" className="block text-xs font-semibold text-slate-300 mb-1">
                  Nombre del Agente *
                </label>
                <input
                  id="agent-name"
                  type="text"
                  required
                  placeholder="Ej: Architect Assistant"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-sm"
                />
              </div>

              <div>
                <label htmlFor="agent-role" className="block text-xs font-semibold text-slate-300 mb-1">
                  Rol / Especialidad
                </label>
                <input
                  id="agent-role"
                  type="text"
                  placeholder="Ej: Lead Software Engineer"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-sm"
                />
              </div>

              <div>
                <label htmlFor="agent-desc" className="block text-xs font-semibold text-slate-300 mb-1">
                  Descripción Breve
                </label>
                <input
                  id="agent-desc"
                  type="text"
                  placeholder="Explica brevemente lo que hace este agente"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-sm"
                />
              </div>
            </div>
          </div>

          <div>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              Modelo Base e Inteligencia Artificial
            </span>

            <div className="space-y-3">
              {renderModelGroup(
                '♊ Google Gemini',
                'text-indigo-400',
                GEMINI_MODELS,
                'bg-indigo-600/25 border-indigo-500 text-slate-100 shadow-md shadow-indigo-500/10'
              )}
              {renderModelGroup(
                '🎭 Anthropic & Claude Code CLI',
                'text-amber-400',
                ANTHROPIC_MODELS,
                'bg-amber-600/25 border-amber-500 text-slate-100 shadow-md shadow-amber-500/10'
              )}
              {renderModelGroup(
                '🐙 GitHub Copilot CLI & OpenAI',
                'text-emerald-400',
                OPENAI_MODELS,
                'bg-emerald-600/25 border-emerald-500 text-slate-100 shadow-md shadow-emerald-500/10'
              )}
            </div>
          </div>

          <div>
            <label htmlFor="agent-system-prompt" className="block text-xs font-semibold text-slate-300 mb-1">
              Instrucciones del Sistema (System Prompt)
            </label>
            <textarea
              id="agent-system-prompt"
              rows={5}
              placeholder="Define las reglas, tono, restricciones y formato que debe seguir este agente..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl glass-input text-xs font-mono leading-relaxed"
            />
          </div>

          <div>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
              <Wrench className="w-4 h-4 text-indigo-400" />
              Herramientas de Agente Habilitadas
            </span>
            <div className="grid grid-cols-2 gap-3">
              {Object.values(TOOLS).map((tool) => {
                const isSelected = selectedTools.includes(tool.name);
                return (
                  <button
                    type="button"
                    key={tool.name}
                    onClick={() => toggleTool(tool.name)}
                    className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'bg-indigo-500/15 border-indigo-500/40 text-slate-100'
                        : 'bg-slate-900/40 border-white/5 text-slate-400 hover:bg-slate-900/80'
                    }`}
                  >
                    <div className="text-xl mt-0.5">{tool.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200">{tool.displayName}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{tool.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 border-t border-white/10">
            <McpServerEditor servers={mcpServers} onChange={setMcpServers} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2 border-t border-white/10">
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1">
                <span>Temperatura</span>
                <span className="text-indigo-400">{temperature}</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-indigo-500"
                aria-label="Temperatura"
              />
              <div className="flex justify-between text-[9px] text-slate-400 mt-1">
                <span>Preciso (0.0)</span>
                <span>Creativo (1.0)</span>
              </div>
            </div>

            <div>
              <label htmlFor="agent-max-tokens" className="block text-xs font-semibold text-slate-300 mb-1">
                Límite de Tokens (Max Tokens)
              </label>
              <input
                id="agent-max-tokens"
                type="number"
                min={MIN_MAX_TOKENS}
                max={MAX_MAX_TOKENS}
                step="256"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 2048)}
                className="w-full px-3.5 py-1.5 rounded-xl glass-input text-xs"
              />
              <p className="text-[9px] text-slate-500 mt-1">
                Entre {MIN_MAX_TOKENS} y {MAX_MAX_TOKENS}.
              </p>
            </div>

            <div>
              <label
                htmlFor="agent-memory-turns"
                className="block text-xs font-semibold text-slate-300 mb-1"
              >
                Memoria conversacional (turnos)
              </label>
              <input
                id="agent-memory-turns"
                type="number"
                min={0}
                max={MAX_MEMORY_TURNS}
                step="1"
                value={memoryTurns}
                onChange={(e) => {
                  // Vaciar la caja debe quedarse en 0, no saltar al valor por
                  // defecto, que es lo que haría `resolveMemoryTurns(NaN)`.
                  const parsed = parseInt(e.target.value, 10);
                  setMemoryTurns(Number.isFinite(parsed) ? resolveMemoryTurns(parsed) : 0);
                }}
                className="w-full px-3.5 py-1.5 rounded-xl glass-input text-xs"
              />
              <p className="text-[9px] text-slate-500 mt-1">
                Turnos anteriores que el agente recuerda (0 = una sola pregunta por vez, sin
                memoria). Cada turno extra se reenvía en cada petición, así que sube el consumo
                de tokens.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-white/10 hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
            >
              {initialAgent ? 'Guardar Cambios' : 'Crear Agente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
