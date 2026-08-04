import React, { useState, useEffect } from 'react';
import { AgentConfig, AgentModel, ToolName } from '@/types/agent';
import { X, Bot, Wrench, Cpu, Sliders, Check } from 'lucide-react';
import { TOOLS } from '@/lib/tools';

interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (agent: AgentConfig) => void;
  initialAgent?: AgentConfig | null;
}

const EMOJI_OPTIONS = ['🤖', '🕵️', '💻', '🔍', '✍️', '🎨', '🧠', '⚡', '🚀', '📊', '🛡️', '⚙️'];

export const AgentModal: React.FC<AgentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialAgent,
}) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState('🤖');
  const [model, setModel] = useState<AgentModel>('gemini-2.5-flash');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.3);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [selectedTools, setSelectedTools] = useState<ToolName[]>(['web_search']);

  useEffect(() => {
    if (initialAgent) {
      setName(initialAgent.name);
      setRole(initialAgent.role);
      setDescription(initialAgent.description);
      setAvatar(initialAgent.avatar || '🤖');
      setModel(initialAgent.model);
      setSystemPrompt(initialAgent.systemPrompt);
      setTemperature(initialAgent.temperature);
      setMaxTokens(initialAgent.maxTokens);
      setSelectedTools(initialAgent.tools || []);
    } else {
      // Reset form
      setName('');
      setRole('');
      setDescription('');
      setAvatar('🤖');
      setModel('gemini-2.5-flash');
      setSystemPrompt('Eres un agente autónomo de IA diseñado para asistir al usuario de manera precisa y eficiente.');
      setTemperature(0.3);
      setMaxTokens(2048);
      setSelectedTools(['web_search', 'code_executor']);
    }
  }, [initialAgent, isOpen]);

  if (!isOpen) return null;

  const toggleTool = (toolName: ToolName) => {
    if (selectedTools.includes(toolName)) {
      setSelectedTools(selectedTools.filter((t) => t !== toolName));
    } else {
      setSelectedTools([...selectedTools, toolName]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const agentToSave: AgentConfig = {
      id: initialAgent?.id || 'agent-' + Date.now(),
      name: name.trim(),
      role: role.trim() || 'Especialista en IA',
      description: description.trim() || 'Agente configurado a medida.',
      avatar,
      model,
      systemPrompt: systemPrompt.trim(),
      temperature,
      maxTokens,
      tools: selectedTools,
      isCustom: true,
      createdAt: initialAgent?.createdAt || new Date().toISOString(),
    };

    onSave(agentToSave);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-2xl rounded-2xl border border-white/10 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xl">
              {avatar}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">
                {initialAgent ? 'Editar Agente' : 'Crear Nuevo Agente'}
              </h2>
              <p className="text-xs text-slate-400">Configura la identidad, modelo y capacidades del agente</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Avatar & Name & Role */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-3 flex flex-col items-center">
              <label className="text-xs font-semibold text-slate-300 mb-2">Avatar Emoji</label>
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
                      avatar === emo ? 'bg-indigo-600 ring-2 ring-indigo-400' : 'bg-slate-800 hover:bg-slate-700'
                    }`}
                  >
                    {emo}
                  </button>
                ))}
              </div>
            </div>

            <div className="md:col-span-9 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Nombre del Agente *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Architect Assistant"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Rol / Especialidad</label>
                <input
                  type="text"
                  placeholder="Ej: Lead Software Engineer"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Descripción Breve</label>
                <input
                  type="text"
                  placeholder="Explica brevemente lo que hace este agente"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-sm"
                />
              </div>
            </div>
          </div>

          {/* Model Selection Grouped by Provider */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              Modelo Base e Inteligencia Artificial
            </label>
            
            <div className="space-y-3">
              {/* Google Gemini */}
              <div>
                <div className="text-[11px] font-bold text-indigo-400 mb-1.5 flex items-center gap-1">
                  ♊ Google Gemini
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  {[
                    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: 'Rápido y eficiente' },
                    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: 'Máximo razonamiento' },
                    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', desc: 'Ligero' },
                    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', desc: 'Complejo' },
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setModel(item.id as AgentModel)}
                      className={`p-2.5 rounded-xl text-left border transition-all ${
                        model === item.id
                          ? 'bg-indigo-600/25 border-indigo-500 text-slate-100 shadow-md shadow-indigo-500/10'
                          : 'bg-slate-900/60 border-white/10 text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-bold">{item.label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Claude Code & Anthropic */}
              <div>
                <div className="text-[11px] font-bold text-amber-400 mb-1.5 flex items-center gap-1">
                  🎭 Anthropic & Claude Code CLI
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  {[
                    { id: 'claude-code', label: 'Claude Code CLI', desc: 'Agente CLI local (claude -p)' },
                    { id: 'claude-3.7-sonnet', label: 'Claude 3.7 Sonnet', desc: 'Pensamiento híbrido' },
                    { id: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', desc: 'Codificación avanzada' },
                    { id: 'claude-3.5-haiku', label: 'Claude 3.5 Haiku', desc: 'Ultra rápido' },
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setModel(item.id as AgentModel)}
                      className={`p-2.5 rounded-xl text-left border transition-all ${
                        model === item.id
                          ? 'bg-amber-600/25 border-amber-500 text-slate-100 shadow-md shadow-amber-500/10'
                          : 'bg-slate-900/60 border-white/10 text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-bold">{item.label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* GitHub Copilot CLI */}
              <div>
                <div className="text-[11px] font-bold text-emerald-400 mb-1.5 flex items-center gap-1">
                  🐙 GitHub Copilot CLI & OpenAI
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  {[
                    { id: 'copilot-cli', label: 'Copilot CLI', desc: 'CLI sugiriendo comandos (gh copilot)' },
                    { id: 'copilot-gpt-4o', label: 'Copilot GPT-4o', desc: 'Asistente de código GitHub' },
                    { id: 'gpt-4o', label: 'OpenAI GPT-4o', desc: 'Multimodal de alta precisión' },
                    { id: 'gpt-4o-mini', label: 'OpenAI GPT-4o Mini', desc: 'Económico y rápido' },
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setModel(item.id as AgentModel)}
                      className={`p-2.5 rounded-xl text-left border transition-all ${
                        model === item.id
                          ? 'bg-emerald-600/25 border-emerald-500 text-slate-100 shadow-md shadow-emerald-500/10'
                          : 'bg-slate-900/60 border-white/10 text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <div className="text-xs font-bold">{item.label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>


          {/* System Prompt */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Instrucciones del Sistema (System Prompt)
            </label>
            <textarea
              rows={5}
              placeholder="Define las reglas, tono, restricciones y formato que debe seguir este agente..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl glass-input text-xs font-mono leading-relaxed"
            />
          </div>

          {/* Tools Toggle Selection */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
              <Wrench className="w-4 h-4 text-indigo-400" />
              Herramientas de Agente Habilitadas
            </label>
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

          {/* Hyperparameters: Temperature & Max Tokens */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/10">
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
              />
              <div className="flex justify-between text-[9px] text-slate-400 mt-1">
                <span>Preciso (0.0)</span>
                <span>Creativo (1.0)</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Límite de Tokens (Max Tokens)</label>
              <input
                type="number"
                min="256"
                max="8192"
                step="256"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value) || 2048)}
                className="w-full px-3.5 py-1.5 rounded-xl glass-input text-xs"
              />
            </div>
          </div>

          {/* Action Footer */}
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
