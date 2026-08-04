'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
  Cpu,
  Terminal,
  Sparkles,
  Code,
  Loader2,
  XCircle,
} from 'lucide-react';
import { AIProvider, ProviderKeys } from '@/types/agent';

interface ApiKeyModalProps {
  onClose: () => void;
  apiKey?: string;
  onSaveApiKey?: (key: string) => void;
  providerKeys?: ProviderKeys;
  onSaveProviderKeys?: (keys: ProviderKeys) => void;
}

type TabId = 'all' | 'gemini' | 'claude' | 'copilot' | 'openai';

interface TestState {
  status: 'idle' | 'testing' | 'ok' | 'error';
  message?: string;
}

const TABS: { id: TabId; label: string; icon: React.ReactNode; activeClass: string }[] = [
  {
    id: 'all',
    label: 'Todas las IAs',
    icon: null,
    activeClass: 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    icon: <Sparkles className="w-3 h-3 text-indigo-400" />,
    activeClass: 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40',
  },
  {
    id: 'claude',
    label: 'Claude Code',
    icon: <Terminal className="w-3 h-3 text-amber-400" />,
    activeClass: 'bg-amber-600/30 text-amber-300 border border-amber-500/40',
  },
  {
    id: 'copilot',
    label: 'Copilot CLI',
    icon: <Code className="w-3 h-3 text-emerald-400" />,
    activeClass: 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40',
  },
  // Esta pestaña existía en el tipo y en la condición de render, pero no había
  // botón para activarla: la sección de OpenAI solo se veía en "Todas las IAs".
  {
    id: 'openai',
    label: 'OpenAI',
    icon: <Cpu className="w-3 h-3 text-cyan-400" />,
    activeClass: 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/40',
  },
];

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  onClose,
  apiKey = '',
  onSaveApiKey,
  providerKeys = {},
  onSaveProviderKeys,
}) => {
  const [geminiKey, setGeminiKey] = useState(providerKeys.geminiApiKey || apiKey || '');
  const [anthropicKey, setAnthropicKey] = useState(providerKeys.anthropicApiKey || '');
  const [copilotToken, setCopilotToken] = useState(providerKeys.copilotToken || '');
  const [openaiKey, setOpenaiKey] = useState(providerKeys.openaiApiKey || '');
  const [strictMode, setStrictMode] = useState(Boolean(providerKeys.strictMode));
  const [statusMsg, setStatusMsg] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [tests, setTests] = useState<Partial<Record<AIProvider, TestState>>>({});

  // Los timers deben cancelarse al desmontar: si no, el modal cerrado sigue
  // intentando actualizar estado.
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const currentKeys = (): ProviderKeys => ({
    geminiApiKey: geminiKey.trim(),
    anthropicApiKey: anthropicKey.trim(),
    copilotToken: copilotToken.trim(),
    openaiApiKey: openaiKey.trim(),
    strictMode,
  });

  const handleTest = async (provider: AIProvider) => {
    setTests((prev) => ({ ...prev, [provider]: { status: 'testing' } }));
    try {
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, keys: currentKeys() }),
      });
      const data = await res.json();
      setTests((prev) => ({
        ...prev,
        [provider]: {
          status: data.success ? 'ok' : 'error',
          message: data.message,
        },
      }));
    } catch (err) {
      setTests((prev) => ({
        ...prev,
        [provider]: {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const keysToSave = currentKeys();
    onSaveProviderKeys?.(keysToSave);
    onSaveApiKey?.(keysToSave.geminiApiKey ?? '');

    setStatusMsg('Conexiones guardadas.');
    timers.current.push(
      window.setTimeout(() => {
        setStatusMsg('');
        onClose();
      }, 900)
    );
  };

  const renderTestButton = (provider: AIProvider, colorClass: string) => {
    const state = tests[provider];
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => handleTest(provider)}
          disabled={state?.status === 'testing'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors disabled:opacity-60 ${colorClass}`}
        >
          {state?.status === 'testing' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : state?.status === 'ok' ? (
            <CheckCircle2 className="w-3 h-3" />
          ) : state?.status === 'error' ? (
            <XCircle className="w-3 h-3" />
          ) : null}
          Probar conexión
        </button>
        {state?.message && (
          <span
            className={`text-[10px] ${state.status === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}
          >
            {state.message}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-lg rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/40">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">Conexiones de IA & CLI Bridges</h3>
              <p className="text-[11px] text-slate-400">
                Configura Gemini, Claude Code, Copilot CLI y OpenAI
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-white/10 bg-slate-900/60 px-4 py-2 gap-1 overflow-x-auto text-xs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === tab.id ? tab.activeClass : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Gemini */}
          {(activeTab === 'all' || activeTab === 'gemini') && (
            <div className="p-4 rounded-xl bg-slate-900/60 border border-indigo-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="key-gemini"
                  className="text-xs font-bold text-slate-200 flex items-center gap-1.5"
                >
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
                id="key-gemini"
                type="password"
                placeholder="AIzaSy..."
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg glass-input text-xs font-mono"
              />
              <p className="text-[10px] text-slate-400">
                Usada por los modelos Gemini 2.5 Flash y Pro.
              </p>
              {renderTestButton(
                'gemini',
                'border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/20'
              )}
            </div>
          )}

          {/* Anthropic / Claude Code */}
          {(activeTab === 'all' || activeTab === 'claude') && (
            <div className="p-4 rounded-xl bg-slate-900/60 border border-amber-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="key-anthropic"
                  className="text-xs font-bold text-slate-200 flex items-center gap-1.5"
                >
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
                id="key-anthropic"
                type="password"
                placeholder="sk-ant-api..."
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg glass-input text-xs font-mono"
              />
              <p className="text-[10px] text-slate-400">
                Usada por Claude Opus 5, Sonnet 5 y Haiku 4.5. Sin clave, el agente
                &quot;Claude Code CLI&quot; intenta el binario local <code>claude</code>.
              </p>
              {renderTestButton(
                'anthropic',
                'border-amber-500/40 text-amber-300 hover:bg-amber-600/20'
              )}
            </div>
          )}

          {/* Copilot CLI */}
          {(activeTab === 'all' || activeTab === 'copilot') && (
            <div className="p-4 rounded-xl bg-slate-900/60 border border-emerald-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="key-copilot"
                  className="text-xs font-bold text-slate-200 flex items-center gap-1.5"
                >
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
                id="key-copilot"
                type="password"
                placeholder="ghp_... o gho_..."
                value={copilotToken}
                onChange={(e) => setCopilotToken(e.target.value)}
                className="w-full px-3 py-2 rounded-lg glass-input text-xs font-mono"
              />
              <p className="text-[10px] text-slate-400">
                Token personal de GitHub. Sin él se intenta el binario local <code>gh</code>.
              </p>
              {renderTestButton(
                'copilot-cli',
                'border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/20'
              )}
            </div>
          )}

          {/* OpenAI */}
          {(activeTab === 'all' || activeTab === 'openai') && (
            <div className="p-4 rounded-xl bg-slate-900/60 border border-cyan-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="key-openai"
                  className="text-xs font-bold text-slate-200 flex items-center gap-1.5"
                >
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
                id="key-openai"
                type="password"
                placeholder="sk-proj-..."
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg glass-input text-xs font-mono"
              />
              <p className="text-[10px] text-slate-400">Usada por GPT-4o y GPT-4o Mini.</p>
              {renderTestButton('openai', 'border-cyan-500/40 text-cyan-300 hover:bg-cyan-600/20')}
            </div>
          )}

          {/* Modo estricto */}
          <label className="flex items-start gap-3 p-4 rounded-xl bg-slate-900/60 border border-white/10 cursor-pointer">
            <input
              type="checkbox"
              checked={strictMode}
              onChange={(e) => setStrictMode(e.target.checked)}
              className="mt-0.5 accent-indigo-500"
            />
            <span>
              <span className="text-xs font-bold text-slate-200 block">
                Modo estricto (recomendado)
              </span>
              <span className="text-[10px] text-slate-400">
                Si el proveedor no responde, la ejecución falla en lugar de conmutar al motor de
                simulación. Sin esto, una ejecución puede &quot;completarse&quot; con texto
                inventado localmente.
              </span>
            </span>
          </label>

          <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/25 text-[10px] text-amber-200/90 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p>
              Las claves se guardan <strong>sin cifrar</strong>: en el <code>localStorage</code> de
              este navegador y en <code>data/settings.json</code> del servidor. Trátalo como una
              herramienta local y no expongas el puerto a internet.
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
