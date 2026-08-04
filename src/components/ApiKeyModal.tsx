import React, { useState, useEffect } from 'react';
import { Key, X, CheckCircle2, ExternalLink, ShieldCheck, Cpu, Terminal, Sparkles, Code } from 'lucide-react';
import { ProviderKeys } from '@/types/agent';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey?: string;
  onSaveApiKey?: (key: string) => void;
  providerKeys?: ProviderKeys;
  onSaveProviderKeys?: (keys: ProviderKeys) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  apiKey = '',
  onSaveApiKey,
  providerKeys = {},
  onSaveProviderKeys,
}) => {
  const [geminiKey, setGeminiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [copilotToken, setCopilotToken] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'gemini' | 'claude' | 'copilot' | 'openai'>('all');

  useEffect(() => {
    setGeminiKey(providerKeys.geminiApiKey || apiKey || '');
    setAnthropicKey(providerKeys.anthropicApiKey || '');
    setCopilotToken(providerKeys.copilotToken || '');
    setOpenaiKey(providerKeys.openaiApiKey || '');
  }, [apiKey, providerKeys, isOpen]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const keysToSave: ProviderKeys = {
      geminiApiKey: geminiKey.trim(),
      anthropicApiKey: anthropicKey.trim(),
      copilotToken: copilotToken.trim(),
      openaiApiKey: openaiKey.trim(),
    };

    if (onSaveProviderKeys) {
      onSaveProviderKeys(keysToSave);
    }
    if (onSaveApiKey) {
      onSaveApiKey(geminiKey.trim());
    }

    setStatusMsg('Conexiones de IA y claves guardadas localmente.');
    setTimeout(() => {
      setStatusMsg('');
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-lg rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/40">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">Conexiones de IA & CLI Bridges</h3>
              <p className="text-[11px] text-slate-400">Configura Gemini, Claude Code, Copilot CLI y OpenAI</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/10 bg-slate-900/60 px-4 py-2 gap-1 overflow-x-auto text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === 'all' ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40' : 'text-slate-400 hover:text-white'
            }`}
          >
            Todas las IAs
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('gemini')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'gemini' ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3 h-3 text-indigo-400" /> Gemini
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('claude')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'claude' ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Terminal className="w-3 h-3 text-amber-400" /> Claude Code
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('copilot')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'copilot' ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Code className="w-3 h-3 text-emerald-400" /> Copilot CLI
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Gemini */}
          {(activeTab === 'all' || activeTab === 'gemini') && (
            <div className="p-4 rounded-xl bg-slate-900/60 border border-indigo-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-indigo-400" /> Google Gemini API Key
                </label>
                <a
                  href="https://aistudio.google.com/app/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-indigo-400 hover:underline flex items-center gap-1 font-medium"
                >
                  Obtener Key <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg glass-input text-xs font-mono"
              />
              <p className="text-[10px] text-slate-400">Usado para modelos Gemini 2.5 Flash, Pro y 1.5.</p>
            </div>
          )}

          {/* Claude Code & Anthropic */}
          {(activeTab === 'all' || activeTab === 'claude') && (
            <div className="p-4 rounded-xl bg-slate-900/60 border border-amber-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-amber-400" /> Claude Code / Anthropic API Key
                </label>
                <a
                  href="https://console.anthropic.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-amber-400 hover:underline flex items-center gap-1 font-medium"
                >
                  Console Anthropic <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <input
                type="password"
                placeholder="sk-ant-api..."
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg glass-input text-xs font-mono"
              />
              <p className="text-[10px] text-slate-400">
                Permite conectar con Claude Code CLI y modelos Claude 3.7 Sonnet / Haiku.
              </p>
            </div>
          )}

          {/* Copilot CLI */}
          {(activeTab === 'all' || activeTab === 'copilot') && (
            <div className="p-4 rounded-xl bg-slate-900/60 border border-emerald-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Code className="w-4 h-4 text-emerald-400" /> GitHub Copilot CLI Token
                </label>
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-emerald-400 hover:underline flex items-center gap-1 font-medium"
                >
                  GitHub Tokens <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <input
                type="password"
                placeholder="ghp_... o gho_..."
                value={copilotToken}
                onChange={(e) => setCopilotToken(e.target.value)}
                className="w-full px-3 py-2 rounded-lg glass-input text-xs font-mono"
              />
              <p className="text-[10px] text-slate-400">
                Token personal de GitHub para invocar la CLI de Copilot o sugerencias de código.
              </p>
            </div>
          )}

          {/* OpenAI */}
          {(activeTab === 'all' || activeTab === 'openai') && (
            <div className="p-4 rounded-xl bg-slate-900/60 border border-cyan-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Cpu className="w-4 h-4 text-cyan-400" /> OpenAI API Key
                </label>
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1 font-medium"
                >
                  Platform OpenAI <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <input
                type="password"
                placeholder="sk-proj-..."
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg glass-input text-xs font-mono"
              />
              <p className="text-[10px] text-slate-400">Usado para modelos GPT-4o y GPT-4o Mini.</p>
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-900 border border-white/5 text-[11px] text-slate-300 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-slate-400 text-[10px]">
              Todas las claves y tokens se guardan de forma encriptada en el almacenamiento local (\`localStorage\`) de tu propio navegador.
            </p>
          </div>

          {statusMsg && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/30">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              {statusMsg}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-white/10"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/20"
            >
              Guardar Conexiones
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
