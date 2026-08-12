'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AgentConfig,
  ExecutionRun,
  WorkflowConfig,
  TelegramConfig,
  ProviderKeys,
} from '@/types/agent';
import { DEFAULT_AGENTS, DEFAULT_WORKFLOWS } from '@/lib/presets';
import { Navbar } from '@/components/Navbar';
import { AgentCard } from '@/components/AgentCard';
import { AgentModal } from '@/components/AgentModal';
import { ExecutionPanel } from '@/components/ExecutionPanel';
import { WorkflowBuilder } from '@/components/WorkflowBuilder';
import { HistoryModal } from '@/components/HistoryModal';
import { LiveMonitor, LiveMonitorConnection } from '@/components/LiveMonitor';
import type { AppTab } from '@/types/ui';
import { ApiKeyModal } from '@/components/ApiKeyModal';
import {
  TelegramModal,
  TelegramTarget,
  agentTelegramTarget,
  workflowTelegramTarget,
} from '@/components/TelegramModal';
import { Search, Sparkles, Send } from 'lucide-react';

const TELEGRAM_POLL_INTERVAL_MS = 3000;

export default function Home() {
  const [activeTab, setActiveTab] = useState<AppTab>('agents');
  const [agents, setAgents] = useState<AgentConfig[]>(DEFAULT_AGENTS);
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>(DEFAULT_WORKFLOWS);
  const [selectedAgent, setSelectedAgent] = useState<AgentConfig | null>(DEFAULT_AGENTS[0]);
  const [runsHistory, setRunsHistory] = useState<ExecutionRun[]>([]);
  const [apiKey, setApiKey] = useState<string>('');
  const [providerKeys, setProviderKeys] = useState<ProviderKeys>({});

  // Modales
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  // Un único modal de Telegram para agentes y workflows.
  const [telegramTarget, setTelegramTarget] = useState<TelegramTarget | null>(null);

  // Búsqueda y filtros
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Carga inicial: el servidor manda; localStorage solo es respaldo si falla.
  useEffect(() => {
    async function loadInitialData() {
      let serverSettingsLoaded = false;
      try {
        const resSettings = await fetch('/api/settings');
        if (resSettings.ok) {
          const dataSettings = await resSettings.json();
          if (dataSettings.success && dataSettings.settings) {
            setProviderKeys(dataSettings.settings);
            if (dataSettings.settings.geminiApiKey) {
              setApiKey(dataSettings.settings.geminiApiKey);
            }
            localStorage.setItem('aether_provider_keys', JSON.stringify(dataSettings.settings));
            serverSettingsLoaded = true;
          }
        }
      } catch (err) {
        console.error('Error fetching server settings:', err);
      }

      if (!serverSettingsLoaded) {
        const storedKey = localStorage.getItem('aether_gemini_api_key');
        if (storedKey) setApiKey(storedKey);
        const storedProviderKeys = localStorage.getItem('aether_provider_keys');
        if (storedProviderKeys) {
          try {
            setProviderKeys((prev) => ({ ...prev, ...JSON.parse(storedProviderKeys) }));
          } catch {
            // Respaldo corrupto: se ignora.
          }
        }
      }

      let serverAgentsLoaded = false;
      try {
        const resAgents = await fetch('/api/agents');
        if (resAgents.ok) {
          const dataAgents = await resAgents.json();
          if (dataAgents.success && Array.isArray(dataAgents.agents) && dataAgents.agents.length) {
            setAgents(dataAgents.agents);
            setSelectedAgent(dataAgents.agents[0]);
            localStorage.setItem('aether_agents', JSON.stringify(dataAgents.agents));
            serverAgentsLoaded = true;
          }
        }
      } catch (err) {
        console.error('Error fetching server agents:', err);
      }

      if (!serverAgentsLoaded) {
        const storedAgents = localStorage.getItem('aether_agents');
        if (storedAgents) {
          try {
            const parsed = JSON.parse(storedAgents);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setAgents(parsed);
              setSelectedAgent(parsed[0]);
            }
          } catch {
            // Respaldo corrupto: se ignora.
          }
        }
      }

      let serverWorkflowsLoaded = false;
      try {
        const resWf = await fetch('/api/workflows');
        if (resWf.ok) {
          const dataWf = await resWf.json();
          if (dataWf.success && Array.isArray(dataWf.workflows) && dataWf.workflows.length > 0) {
            setWorkflows(dataWf.workflows);
            localStorage.setItem('aether_workflows', JSON.stringify(dataWf.workflows));
            serverWorkflowsLoaded = true;
          }
        }
      } catch (err) {
        console.error('Error fetching server workflows:', err);
      }

      if (!serverWorkflowsLoaded) {
        const storedWorkflows = localStorage.getItem('aether_workflows');
        if (storedWorkflows) {
          try {
            const parsedWf = JSON.parse(storedWorkflows);
            if (Array.isArray(parsedWf) && parsedWf.length > 0) {
              setWorkflows(parsedWf);
            }
          } catch {
            // Respaldo corrupto: se ignora.
          }
        }
      }

      try {
        const resHist = await fetch('/api/history');
        if (resHist.ok) {
          const dataHist = await resHist.json();
          if (dataHist.success && Array.isArray(dataHist.history)) {
            setRunsHistory(dataHist.history);
            localStorage.setItem('aether_history', JSON.stringify(dataHist.history));
          }
        }
      } catch (err) {
        console.error('Error fetching server history:', err);
      }
    }

    loadInitialData();
  }, []);

  // Cuenta agentes Y workflows: si solo mirara agentes, una instalación con
  // únicamente workflows enrolados nunca arrancaría el sondeo.
  const hasEnrolledTelegramBots =
    agents.some((a) => a.telegramConfig?.enabled && a.telegramConfig?.botToken) ||
    workflows.some((w) => w.telegramConfig?.enabled && w.telegramConfig?.botToken);

  // Sondeo de Telegram. Los offsets y los agentes viven en el servidor; aquí
  // solo se dispara el tick y se recogen las ejecuciones nuevas.
  const isPollingRef = useRef(false);
  useEffect(() => {
    if (!hasEnrolledTelegramBots) return;

    let cancelled = false;

    const pollTelegramMessages = async () => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;
      try {
        const res = await fetch('/api/telegram/poll', { method: 'POST' });
        const data = await res.json();
        if (!cancelled && data.success && Array.isArray(data.newRuns) && data.newRuns.length > 0) {
          setRunsHistory((prev) => {
            const updated = [...data.newRuns, ...prev];
            localStorage.setItem('aether_history', JSON.stringify(updated));
            return updated;
          });
        }
      } catch (err) {
        console.error('Error polling Telegram messages:', err);
      } finally {
        isPollingRef.current = false;
      }
    };

    const intervalId = window.setInterval(pollTelegramMessages, TELEGRAM_POLL_INTERVAL_MS);
    pollTelegramMessages();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [hasEnrolledTelegramBots]);

  const saveAgentsToStorage = useCallback(async (newAgents: AgentConfig[]) => {
    setAgents(newAgents);
    localStorage.setItem('aether_agents', JSON.stringify(newAgents));
    try {
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAgents),
      });
    } catch (err) {
      console.error('Error saving agents to server:', err);
    }
  }, []);

  const saveStoredKeysToServer = async (keys: ProviderKeys) => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keys),
      });
    } catch (err) {
      console.error('Error saving settings to server:', err);
    }
  };

  const handleSaveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('aether_gemini_api_key', key);
  };

  const handleSaveProviderKeys = (keys: ProviderKeys) => {
    setProviderKeys(keys);
    localStorage.setItem('aether_provider_keys', JSON.stringify(keys));
    if (keys.geminiApiKey) {
      setApiKey(keys.geminiApiKey);
      localStorage.setItem('aether_gemini_api_key', keys.geminiApiKey);
    }
    saveStoredKeysToServer(keys);
  };

  const handleSaveAgent = (agentToSave: AgentConfig) => {
    const existingIndex = agents.findIndex((a) => a.id === agentToSave.id);
    const updated =
      existingIndex >= 0
        ? agents.map((a, i) => (i === existingIndex ? agentToSave : a))
        : [agentToSave, ...agents];
    saveAgentsToStorage(updated);
    setSelectedAgent(agentToSave);
  };

  const handleSaveTelegramConfig = (agentId: string, telegramConfig: TelegramConfig) => {
    const updated = agents.map((a) => (a.id === agentId ? { ...a, telegramConfig } : a));
    saveAgentsToStorage(updated);
  };

  const handleSaveWorkflowTelegramConfig = (
    workflowId: string,
    telegramConfig: TelegramConfig
  ) => {
    const target = workflows.find((w) => w.id === workflowId);
    if (!target) return;
    // Reutiliza el upsert por id de handleSaveWorkflow, que además persiste.
    handleSaveWorkflow({ ...target, telegramConfig });
  };

  const handleDeleteAgent = async (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (
      !window.confirm(
        `¿Eliminar el agente "${agent?.name ?? agentId}"? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }

    const updated = agents.filter((a) => a.id !== agentId);
    setAgents(updated);
    localStorage.setItem('aether_agents', JSON.stringify(updated));
    if (selectedAgent?.id === agentId) {
      setSelectedAgent(updated[0] || null);
    }
    try {
      await fetch(`/api/agents?id=${encodeURIComponent(agentId)}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Error deleting agent on server:', err);
    }
  };

  const handleCloneAgent = (agentToClone: AgentConfig) => {
    const cloned: AgentConfig = {
      ...agentToClone,
      id: 'agent-' + Date.now(),
      name: `${agentToClone.name} (Copia)`,
      // Un clon no hereda el bot: dos agentes con el mismo token competirían
      // por los mismos updates de Telegram.
      telegramConfig: undefined,
      isCustom: true,
      createdAt: new Date().toISOString(),
    };
    saveAgentsToStorage([cloned, ...agents]);
    setSelectedAgent(cloned);
  };

  const handleSaveWorkflow = async (newWf: WorkflowConfig) => {
    // Upsert por id: editar un workflow reenvía el mismo id, y un prepend ciego
    // lo duplicaba en la lista.
    const exists = workflows.some((w) => w.id === newWf.id);
    const updated = exists ? workflows.map((w) => (w.id === newWf.id ? newWf : w)) : [newWf, ...workflows];
    setWorkflows(updated);
    localStorage.setItem('aether_workflows', JSON.stringify(updated));
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWf),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.workflows)) {
        // El servidor es la fuente autoritativa; localStorage solo es respaldo.
        setWorkflows(data.workflows);
        localStorage.setItem('aether_workflows', JSON.stringify(data.workflows));
      } else if (data.error) {
        console.error('El servidor rechazó el workflow:', data.error);
      }
    } catch (err) {
      console.error('Error saving workflow to server:', err);
    }
  };

  const handleDeleteWorkflow = async (workflowId: string) => {
    const updated = workflows.filter((w) => w.id !== workflowId);
    setWorkflows(updated);
    localStorage.setItem('aether_workflows', JSON.stringify(updated));
    try {
      await fetch(`/api/workflows?id=${encodeURIComponent(workflowId)}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Error deleting workflow on server:', err);
    }
  };

  const handleSaveRunHistory = async (newRun: ExecutionRun) => {
    setRunsHistory((prev) => {
      const updated = [newRun, ...prev];
      localStorage.setItem('aether_history', JSON.stringify(updated));
      return updated;
    });
    try {
      await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRun),
      });
    } catch (err) {
      console.error('Error saving history run to server:', err);
    }
  };

  const handleClearHistory = async () => {
    setRunsHistory([]);
    localStorage.removeItem('aether_history');
    try {
      await fetch('/api/history', { method: 'DELETE' });
    } catch (err) {
      console.error('Error clearing history on server:', err);
    }
  };

  const handleRunAgent = (agent: AgentConfig) => {
    setSelectedAgent(agent);
    setActiveTab('workbench');
  };

  const filteredAgents = agents.filter((agent) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      agent.name.toLowerCase().includes(q) ||
      agent.role.toLowerCase().includes(q) ||
      agent.description.toLowerCase().includes(q);

    if (selectedCategory === 'telegram') return matchesSearch && agent.telegramConfig?.enabled;
    if (selectedCategory === 'custom') return matchesSearch && agent.isCustom;
    if (selectedCategory === 'preset') return matchesSearch && !agent.isCustom;
    return matchesSearch;
  });

  const hasAnyKey = Boolean(
    apiKey?.trim() ||
      providerKeys.geminiApiKey?.trim() ||
      providerKeys.anthropicApiKey?.trim() ||
      providerKeys.copilotToken?.trim() ||
      providerKeys.openaiApiKey?.trim()
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#090d16] text-slate-100 selection:bg-indigo-500 selection:text-white">
      {/* Mantiene el stream SSE abierto en cualquier pestaña. No renderiza nada
          ni provoca renders aquí: el estado vive fuera de React. */}
      <LiveMonitorConnection />

      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
        onOpenNewAgentModal={() => {
          setEditingAgent(null);
          setIsAgentModalOpen(true);
        }}
        hasApiKey={hasAnyKey}
        activeAgentCount={agents.length}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-8">
        {/* PESTAÑA 1: AGENTES */}
        {activeTab === 'agents' && (
          <div className="space-y-6">
            <div className="glass-panel rounded-2xl p-6 lg:p-8 border border-white/10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-indigo-600/10 via-cyan-500/10 to-transparent blur-3xl pointer-events-none" />
              <div className="max-w-2xl space-y-3 relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> Multi-AI Architecture:
                  Gemini, Claude Code, Copilot CLI & OpenAI
                </div>
                <h2 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-slate-100">
                  Panel de Control de <span className="text-gradient">Agentes Multi-IA</span>
                </h2>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Crea y orquesta agentes autónomos conectados a{' '}
                  <strong className="text-amber-400">Claude Code</strong>,{' '}
                  <strong className="text-emerald-400 font-semibold">GitHub Copilot CLI</strong>,{' '}
                  <strong className="text-indigo-400 font-semibold">Google Gemini</strong> y{' '}
                  <strong className="text-cyan-400 font-semibold">OpenAI</strong>, enrolando cada
                  uno a su propio bot de Telegram.
                </p>
                {!providerKeys.strictMode && (
                  <p className="text-[11px] text-amber-300/90 bg-amber-950/30 border border-amber-500/25 rounded-lg px-3 py-2">
                    El modo estricto está desactivado: si un proveedor no responde, las ejecuciones
                    se completan con texto simulado (marcado como tal). Actívalo en el modal de
                    claves para que fallen en su lugar.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="relative w-full md:w-96">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar agentes por nombre, rol o habilidad..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl glass-input text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 bg-slate-900/80 p-1 rounded-xl border border-white/5 w-full md:w-auto justify-center">
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedCategory === 'all'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Todos ({agents.length})
                </button>
                <button
                  onClick={() => setSelectedCategory('telegram')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                    selectedCategory === 'telegram'
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Send className="w-3 h-3 text-cyan-400" />
                  Enrolados en Telegram ({agents.filter((a) => a.telegramConfig?.enabled).length})
                </button>
                <button
                  onClick={() => setSelectedCategory('preset')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedCategory === 'preset'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Predeterminados
                </button>
                <button
                  onClick={() => setSelectedCategory('custom')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedCategory === 'custom'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Personalizados ({agents.filter((a) => a.isCustom).length})
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onRun={handleRunAgent}
                  onEdit={(a) => {
                    setEditingAgent(a);
                    setIsAgentModalOpen(true);
                  }}
                  onClone={handleCloneAgent}
                  onDelete={handleDeleteAgent}
                  onOpenTelegramModal={(a) => setTelegramTarget(agentTelegramTarget(a))}
                />
              ))}
            </div>
          </div>
        )}

        {/* PESTAÑA 2: WORKBENCH */}
        {activeTab === 'workbench' && (
          <ExecutionPanel
            selectedAgent={selectedAgent}
            agents={agents}
            onSelectAgent={setSelectedAgent}
            apiKey={apiKey}
            providerKeys={providerKeys}
            onSaveRunHistory={handleSaveRunHistory}
          />
        )}

        {/* PESTAÑA 3: WORKFLOWS */}
        {activeTab === 'workflows' && (
          <WorkflowBuilder
            workflows={workflows}
            agents={agents}
            apiKey={apiKey}
            providerKeys={providerKeys}
            onSaveWorkflow={handleSaveWorkflow}
            onDeleteWorkflow={handleDeleteWorkflow}
            onOpenTelegram={(wf) => setTelegramTarget(workflowTelegramTarget(wf))}
            onSaveRunHistory={handleSaveRunHistory}
          />
        )}

        {/* PESTAÑA 4: EN VIVO */}
        {activeTab === 'live' && <LiveMonitor />}

        {/* PESTAÑA 5: HISTORIAL */}
        {activeTab === 'history' && (
          <HistoryModal runs={runsHistory} onClearHistory={handleClearHistory} />
        )}
      </main>

      {/* Los modales se montan al abrirse (con `key`) para que su estado se
          inicialice desde las props en lugar de sincronizarse con un efecto. */}
      {isAgentModalOpen && (
        <AgentModal
          key={editingAgent?.id ?? 'new-agent'}
          onClose={() => setIsAgentModalOpen(false)}
          onSave={handleSaveAgent}
          initialAgent={editingAgent}
        />
      )}

      {isApiKeyModalOpen && (
        <ApiKeyModal
          onClose={() => setIsApiKeyModalOpen(false)}
          apiKey={apiKey}
          onSaveApiKey={handleSaveApiKey}
          providerKeys={providerKeys}
          onSaveProviderKeys={handleSaveProviderKeys}
        />
      )}

      {telegramTarget && (
        <TelegramModal
          key={`${telegramTarget.kind}-${telegramTarget.id}`}
          onClose={() => setTelegramTarget(null)}
          target={telegramTarget}
          apiKey={apiKey}
          providerKeys={providerKeys}
          onSaveTelegramConfig={
            telegramTarget.kind === 'workflow'
              ? handleSaveWorkflowTelegramConfig
              : handleSaveTelegramConfig
          }
        />
      )}
    </div>
  );
}
