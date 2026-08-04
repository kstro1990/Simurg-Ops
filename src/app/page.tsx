'use client';

import React, { useState, useEffect } from 'react';
import { AgentConfig, ExecutionRun, WorkflowConfig, TelegramConfig, ProviderKeys } from '@/types/agent';
import { DEFAULT_AGENTS, DEFAULT_WORKFLOWS } from '@/lib/presets';
import { Navbar } from '@/components/Navbar';
import { AgentCard } from '@/components/AgentCard';
import { AgentModal } from '@/components/AgentModal';
import { ExecutionPanel } from '@/components/ExecutionPanel';
import { WorkflowBuilder } from '@/components/WorkflowBuilder';
import { HistoryModal } from '@/components/HistoryModal';
import { ApiKeyModal } from '@/components/ApiKeyModal';
import { TelegramModal } from '@/components/TelegramModal';
import { Search, Sparkles, Send } from 'lucide-react';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'agents' | 'workbench' | 'workflows' | 'history'>('agents');
  const [agents, setAgents] = useState<AgentConfig[]>(DEFAULT_AGENTS);
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>(DEFAULT_WORKFLOWS);
  const [selectedAgent, setSelectedAgent] = useState<AgentConfig | null>(DEFAULT_AGENTS[0]);
  const [runsHistory, setRunsHistory] = useState<ExecutionRun[]>([]);
  const [apiKey, setApiKey] = useState<string>('');
  const [providerKeys, setProviderKeys] = useState<ProviderKeys>({});

  // Modals state
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [telegramAgent, setTelegramAgent] = useState<AgentConfig | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const storedKey = localStorage.getItem('aether_gemini_api_key');
      if (storedKey) setApiKey(storedKey);

      const storedProviderKeys = localStorage.getItem('aether_provider_keys');
      if (storedProviderKeys) {
        try {
          const parsedPk = JSON.parse(storedProviderKeys);
          setProviderKeys(parsedPk);
        } catch {}
      } else if (storedKey) {
        setProviderKeys({ geminiApiKey: storedKey });
      }

      const storedAgents = localStorage.getItem('aether_agents');
      if (storedAgents) {
        const parsed = JSON.parse(storedAgents);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const existingIds = new Set(parsed.map((a: AgentConfig) => a.id));
          const missingDefaults = DEFAULT_AGENTS.filter((def) => !existingIds.has(def.id));
          const merged = [...parsed, ...missingDefaults];
          setAgents(merged);
          setSelectedAgent(merged[0]);
          if (missingDefaults.length > 0) {
            localStorage.setItem('aether_agents', JSON.stringify(merged));
          }
        }
      }

      const storedWorkflows = localStorage.getItem('aether_workflows');
      if (storedWorkflows) {
        const parsedWf = JSON.parse(storedWorkflows);
        if (Array.isArray(parsedWf) && parsedWf.length > 0) {
          setWorkflows(parsedWf);
        }
      }

      const storedHistory = localStorage.getItem('aether_history');
      if (storedHistory) {
        const parsedHist = JSON.parse(storedHistory);
        if (Array.isArray(parsedHist)) setRunsHistory(parsedHist);
      }
    } catch (e) {
      console.error('Error reading localStorage', e);
    }
  }, []);

  const [telegramOffsets, setTelegramOffsets] = useState<Record<string, number>>({});

  // Background Telegram Polling Loop (Long Polling for Local Dev & Real-Time responses)
  useEffect(() => {
    const hasEnrolledTelegramAgents = agents.some(
      (a) => a.telegramConfig?.enabled && a.telegramConfig?.botToken
    );
    if (!hasEnrolledTelegramAgents) return;

    let isPolling = false;
    const pollTelegramMessages = async () => {
      if (isPolling) return;
      isPolling = true;
      try {
        const res = await fetch('/api/telegram/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agents,
            apiKey,
            offsets: telegramOffsets,
          }),
        });
        const data = await res.json();
        if (data.success) {
          if (data.newOffsets) {
            setTelegramOffsets((prev) => ({ ...prev, ...data.newOffsets }));
          }
          if (Array.isArray(data.newRuns) && data.newRuns.length > 0) {
            setRunsHistory((prev) => {
              const updatedHistory = [...data.newRuns, ...prev];
              localStorage.setItem('aether_history', JSON.stringify(updatedHistory));
              return updatedHistory;
            });
          }
        }
      } catch (err) {
        console.error('Error polling Telegram messages:', err);
      } finally {
        isPolling = false;
      }
    };

    const intervalId = setInterval(pollTelegramMessages, 3000);
    pollTelegramMessages();

    return () => clearInterval(intervalId);
  }, [agents, apiKey, telegramOffsets]);

  // Save changes to localStorage
  const saveAgentsToStorage = (newAgents: AgentConfig[]) => {
    setAgents(newAgents);
    localStorage.setItem('aether_agents', JSON.stringify(newAgents));
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
  };

  const handleSaveAgent = (agentToSave: AgentConfig) => {
    const existingIndex = agents.findIndex((a) => a.id === agentToSave.id);
    let updated: AgentConfig[];
    if (existingIndex >= 0) {
      updated = [...agents];
      updated[existingIndex] = agentToSave;
    } else {
      updated = [agentToSave, ...agents];
    }
    saveAgentsToStorage(updated);
    setSelectedAgent(agentToSave);
  };

  const handleSaveTelegramConfig = (agentId: string, telegramConfig: TelegramConfig) => {
    const updated = agents.map((a) => {
      if (a.id === agentId) {
        return {
          ...a,
          telegramConfig,
        };
      }
      return a;
    });
    saveAgentsToStorage(updated);
  };

  const handleDeleteAgent = (agentId: string) => {
    const updated = agents.filter((a) => a.id !== agentId);
    saveAgentsToStorage(updated);
    if (selectedAgent?.id === agentId) {
      setSelectedAgent(updated[0] || null);
    }
  };

  const handleCloneAgent = (agentToClone: AgentConfig) => {
    const cloned: AgentConfig = {
      ...agentToClone,
      id: 'agent-' + Date.now(),
      name: `${agentToClone.name} (Copia)`,
      isCustom: true,
      createdAt: new Date().toISOString(),
    };
    const updated = [cloned, ...agents];
    saveAgentsToStorage(updated);
    setSelectedAgent(cloned);
  };

  const handleSaveWorkflow = (newWf: WorkflowConfig) => {
    const updated = [newWf, ...workflows];
    setWorkflows(updated);
    localStorage.setItem('aether_workflows', JSON.stringify(updated));
  };

  const handleSaveRunHistory = (newRun: ExecutionRun) => {
    const updated = [newRun, ...runsHistory];
    setRunsHistory(updated);
    localStorage.setItem('aether_history', JSON.stringify(updated));
  };

  const handleClearHistory = () => {
    setRunsHistory([]);
    localStorage.removeItem('aether_history');
  };

  const handleRunAgent = (agent: AgentConfig) => {
    setSelectedAgent(agent);
    setActiveTab('workbench');
  };

  const handleOpenTelegramModal = (agent: AgentConfig) => {
    setTelegramAgent(agent);
    setIsTelegramModalOpen(true);
  };

  // Filtered agents
  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.role.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.description.toLowerCase().includes(searchQuery.toLowerCase());

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
      {/* Navigation Header */}
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

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-8">
        {/* TAB 1: AGENTS DASHBOARD */}
        {activeTab === 'agents' && (
          <div className="space-y-6">
            {/* Hero / Header Section */}
            <div className="glass-panel rounded-2xl p-6 lg:p-8 border border-white/10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-indigo-600/10 via-cyan-500/10 to-transparent blur-3xl pointer-events-none" />
              <div className="max-w-2xl space-y-3 relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> Multi-AI Architecture: Gemini, Claude Code, Copilot CLI & OpenAI
                </div>
                <h2 className="text-2xl lg:text-3xl font-extrabold tracking-tight text-slate-100">
                  Panel de Control de <span className="text-gradient">Agentes Multi-IA</span>
                </h2>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Crea y orquesta agentes autónomos conectados a <strong className="text-amber-400">Claude Code</strong>, <strong className="text-emerald-400 font-semibold">GitHub Copilot CLI</strong>, <strong className="text-indigo-400 font-semibold">Google Gemini</strong> y <strong className="text-cyan-400 font-semibold">OpenAI</strong>, enrolando cada uno a su propio bot de Telegram.
                </p>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              {/* Search input */}
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

              {/* Category Pills */}
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

            {/* Agent Grid */}
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
                  onOpenTelegramModal={handleOpenTelegramModal}
                />
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: WORKBENCH */}
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

        {/* TAB 3: WORKFLOWS */}
        {activeTab === 'workflows' && (
          <WorkflowBuilder
            workflows={workflows}
            agents={agents}
            apiKey={apiKey}
            providerKeys={providerKeys}
            onSaveWorkflow={handleSaveWorkflow}
          />
        )}

        {/* TAB 4: HISTORY */}
        {activeTab === 'history' && (
          <HistoryModal runs={runsHistory} onClearHistory={handleClearHistory} />
        )}
      </main>

      {/* Modals */}
      <AgentModal
        isOpen={isAgentModalOpen}
        onClose={() => setIsAgentModalOpen(false)}
        onSave={handleSaveAgent}
        initialAgent={editingAgent}
      />

      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        apiKey={apiKey}
        onSaveApiKey={handleSaveApiKey}
        providerKeys={providerKeys}
        onSaveProviderKeys={handleSaveProviderKeys}
      />

      <TelegramModal
        isOpen={isTelegramModalOpen}
        onClose={() => setIsTelegramModalOpen(false)}
        agent={telegramAgent}
        apiKey={apiKey}
        onSaveTelegramConfig={handleSaveTelegramConfig}
      />
    </div>
  );
}
