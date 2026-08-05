'use client';

import React, { useMemo, useState } from 'react';
import { AgentConfig, ExecutionRun, WorkflowConfig, ProviderKeys } from '@/types/agent';
import {
  Layers,
  ArrowRight,
  Play,
  CheckCircle2,
  Clock,
  Plus,
  Trash2,
  AlertCircle,
  FlaskConical,
} from 'lucide-react';
import { runAgentEngine } from '@/lib/agentEngine';
import { fetchProviderBridge } from '@/lib/bridgeClient';
import { fetchMcpBridge } from '@/lib/mcpBridgeClient';
import { Markdown } from './Markdown';

interface WorkflowBuilderProps {
  workflows: WorkflowConfig[];
  agents: AgentConfig[];
  apiKey: string;
  providerKeys?: ProviderKeys;
  onSaveWorkflow: (workflow: WorkflowConfig) => void;
  onDeleteWorkflow: (workflowId: string) => void;
  onSaveRunHistory: (run: ExecutionRun) => void;
}

interface PipelineResult {
  stepId: string;
  stepName: string;
  agentName: string;
  agentAvatar: string;
  output: string;
  simulated: boolean;
  failed: boolean;
}

export const WorkflowBuilder: React.FC<WorkflowBuilderProps> = ({
  workflows,
  agents,
  apiKey,
  providerKeys,
  onSaveWorkflow,
  onDeleteWorkflow,
  onSaveRunHistory,
}) => {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    workflows[0]?.id ?? null
  );
  const [initialPrompt, setInitialPrompt] = useState(
    'Construye una solución completa para una app de gestión de proyectos con IA'
  );
  const [isRunning, setIsRunning] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [pipelineResults, setPipelineResults] = useState<PipelineResult[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  // Estado del formulario de creación
  const [isCreating, setIsCreating] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [newWorkflowDesc, setNewWorkflowDesc] = useState('');
  const [newSteps, setNewSteps] = useState<{ agentId: string; instruction: string }[]>([]);

  const agentsMap = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a])) as Record<string, AgentConfig>,
    [agents]
  );

  // Los workflows llegan de forma asíncrona desde /api/workflows, así que la
  // selección se deriva en cada render en lugar de fijarse al montar: si se
  // guardara en estado, la vista se quedaría vacía hasta recargar.
  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflowId) ?? workflows[0] ?? null,
    [workflows, selectedWorkflowId]
  );

  const handleRunWorkflow = async () => {
    if (!selectedWorkflow || isRunning || !initialPrompt.trim()) return;

    setIsRunning(true);
    setPipelineResults([]);
    setRunError(null);
    let currentInput = initialPrompt.trim();

    try {
      for (let i = 0; i < selectedWorkflow.steps.length; i++) {
        setActiveStepIndex(i);
        const step = selectedWorkflow.steps[i];
        const agent = agentsMap[step.agentId];

        if (!agent) {
          // Antes los pasos sin agente se saltaban en silencio y los resultados
          // se mapeaban por índice, atribuyendo salidas al agente equivocado.
          setPipelineResults((prev) => [
            ...prev,
            {
              stepId: step.id,
              stepName: step.stepName,
              agentName: `Agente ${step.agentId} (no encontrado)`,
              agentAvatar: '⚠️',
              output: `El paso "${step.stepName}" referencia el agente ${step.agentId}, que ya no existe. Se omite.`,
              simulated: false,
              failed: true,
            },
          ]);
          continue;
        }

        const promptForStep = step.customInstruction
          ? `${step.customInstruction}\n\n[CONTEXTO DEL AGENTE ANTERIOR]:\n${currentInput}`
          : currentInput;

        const result = await runAgentEngine({
          agent,
          userPrompt: promptForStep,
          apiKey,
          providerKeys,
          bridgeFn: fetchProviderBridge,
          mcpFn: fetchMcpBridge,
        });

        currentInput = result.finalOutput;

        setPipelineResults((prev) => [
          ...prev,
          {
            stepId: step.id,
            stepName: step.stepName,
            agentName: agent.name,
            agentAvatar: agent.avatar,
            output: result.finalOutput,
            simulated: result.simulated,
            failed: false,
          },
        ]);

        // Cada paso queda en el historial: antes los workflows no dejaban rastro.
        onSaveRunHistory({
          id: `run-wf-${Date.now()}-${i}`,
          agentId: agent.id,
          agentName: agent.name,
          agentAvatar: agent.avatar,
          agentRole: agent.role,
          prompt: promptForStep,
          status: 'completed',
          steps: result.steps,
          finalOutput: result.finalOutput,
          metrics: result.metrics,
          timestamp: new Date().toISOString(),
          source: 'web',
          simulated: result.simulated,
          provider: result.provider,
        });
      }
    } catch (err) {
      // Sin este catch, un fallo dejaba isRunning en true para siempre y el
      // botón quedaba bloqueado hasta recargar la página.
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setActiveStepIndex(null);
      setIsRunning(false);
    }
  };

  const handleAddAgentToNewWorkflow = (agentId: string) => {
    setNewSteps((prev) => [...prev, { agentId, instruction: '' }]);
  };

  const handleRemoveStepFromNewWorkflow = (index: number) => {
    setNewSteps((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleUpdateStepInstruction = (index: number, instruction: string) => {
    setNewSteps((prev) => prev.map((s, idx) => (idx === index ? { ...s, instruction } : s)));
  };

  const handleSaveNewWorkflow = () => {
    if (!newWorkflowName.trim() || newSteps.length === 0) return;

    const newWf: WorkflowConfig = {
      id: 'wf-' + Date.now(),
      name: newWorkflowName.trim(),
      description: newWorkflowDesc.trim() || 'Flujo multi-agente personalizado.',
      steps: newSteps.map((s, index) => {
        const agent = agentsMap[s.agentId];
        return {
          id: `step-${index + 1}`,
          agentId: s.agentId,
          stepName: `${index + 1}. ${agent?.name || 'Agente'}`,
          // Vacío en vez de un placeholder inútil: sin instrucción, el paso
          // recibe tal cual la salida del anterior.
          customInstruction: s.instruction.trim() || undefined,
        };
      }),
      createdAt: new Date().toISOString(),
    };

    onSaveWorkflow(newWf);
    setSelectedWorkflowId(newWf.id);
    setIsCreating(false);
    setNewWorkflowName('');
    setNewWorkflowDesc('');
    setNewSteps([]);
  };

  const handleDelete = (wf: WorkflowConfig) => {
    if (!window.confirm(`¿Eliminar el workflow "${wf.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    if (selectedWorkflowId === wf.id) {
      setSelectedWorkflowId(workflows.find((w) => w.id !== wf.id)?.id ?? null);
      setPipelineResults([]);
    }
    onDeleteWorkflow(wf.id);
  };

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="glass-panel rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            Orquestación de Pipelines Multi-Agente
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Encadena múltiples agentes especialistas en secuencia. La salida de cada agente sirve
            como entrada enriquecida para el siguiente.
          </p>
        </div>

        <button
          onClick={() => setIsCreating(!isCreating)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          {isCreating ? 'Cancelar' : 'Crear Nuevo Workflow'}
        </button>
      </div>

      {/* Formulario de creación */}
      {isCreating && (
        <div className="glass-panel rounded-2xl p-6 border border-indigo-500/30 space-y-4">
          <h3 className="text-sm font-bold text-slate-100">
            Crear Flujo Multi-Agente Personalizado
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Nombre del Workflow (ej: Pipeline de Auditoría de IA)"
              value={newWorkflowName}
              onChange={(e) => setNewWorkflowName(e.target.value)}
              className="px-3.5 py-2 rounded-xl glass-input text-xs"
            />
            <input
              type="text"
              placeholder="Descripción breve..."
              value={newWorkflowDesc}
              onChange={(e) => setNewWorkflowDesc(e.target.value)}
              className="px-3.5 py-2 rounded-xl glass-input text-xs"
            />
          </div>

          <div>
            <span className="block text-xs font-semibold text-slate-300 mb-2">
              Añadir agentes en orden de ejecución:
            </span>
            <div className="flex flex-wrap gap-2 mb-3">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleAddAgentToNewWorkflow(agent.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-xs text-slate-300 hover:text-white hover:border-indigo-500 transition-all"
                >
                  <span>{agent.avatar}</span>
                  <span>{agent.name}</span>
                  <Plus className="w-3 h-3 text-indigo-400" />
                </button>
              ))}
            </div>

            <div className="p-3 bg-slate-950/60 rounded-xl border border-white/5 space-y-2">
              <span className="text-[11px] font-bold text-slate-400 block">
                Secuencia e instrucciones por paso:
              </span>
              {newSteps.length === 0 && (
                <p className="text-[11px] text-slate-500">
                  Aún no has añadido ningún agente al flujo.
                </p>
              )}
              {newSteps.map((s, idx) => {
                const a = agentsMap[s.agentId];
                return (
                  <div
                    key={`${s.agentId}-${idx}`}
                    className="flex flex-col md:flex-row md:items-center gap-2"
                  >
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/30 text-indigo-200 border border-indigo-500/40 text-xs shrink-0">
                      <span className="font-mono text-[10px]">{idx + 1}</span>
                      <span>{a?.avatar}</span>
                      <span>{a?.name}</span>
                      <button
                        onClick={() => handleRemoveStepFromNewWorkflow(idx)}
                        className="ml-1 text-rose-400 hover:text-rose-300"
                        aria-label={`Quitar paso ${idx + 1}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                    <input
                      type="text"
                      placeholder="Instrucción para este paso (opcional)"
                      value={s.instruction}
                      onChange={(e) => handleUpdateStepInstruction(idx, e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg glass-input text-[11px]"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={handleSaveNewWorkflow}
              disabled={!newWorkflowName.trim() || newSteps.length === 0}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-400 text-white shadow-md"
            >
              Guardar Workflow
            </button>
          </div>
        </div>
      )}

      {/* Vista principal */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-4">
          <div className="glass-panel rounded-2xl p-5 border border-white/10 space-y-3">
            <h3 className="text-xs font-bold text-slate-300">Workflows Disponibles</h3>
            <div className="space-y-2">
              {workflows.map((wf) => (
                <div
                  key={wf.id}
                  className={`rounded-xl border transition-all ${
                    selectedWorkflow?.id === wf.id
                      ? 'bg-indigo-600/20 border-indigo-500/80 shadow-md'
                      : 'bg-slate-900/40 border-white/5 hover:bg-slate-900/80'
                  }`}
                >
                  <button
                    onClick={() => {
                      setSelectedWorkflowId(wf.id);
                      setPipelineResults([]);
                      setRunError(null);
                    }}
                    className="w-full p-3.5 text-left"
                  >
                    <div className="text-xs font-bold text-slate-100">{wf.name}</div>
                    <div className="text-[10px] text-slate-400 mt-1">{wf.description}</div>
                    <div className="text-[10px] text-indigo-400 font-mono mt-2">
                      {wf.steps.length} pasos secuenciales
                    </div>
                  </button>
                  <div className="px-3.5 pb-2.5 flex justify-end">
                    <button
                      onClick={() => handleDelete(wf)}
                      className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-5 border border-white/10 space-y-3">
            <label htmlFor="pipeline-prompt" className="block text-xs font-bold text-slate-300">
              Prompt Inicial del Pipeline
            </label>
            <textarea
              id="pipeline-prompt"
              rows={4}
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              className="w-full px-3 py-2 rounded-xl glass-input text-xs leading-relaxed"
            />
            <button
              onClick={handleRunWorkflow}
              disabled={isRunning || !selectedWorkflow || !initialPrompt.trim()}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold text-white shadow-lg transition-all ${
                isRunning || !selectedWorkflow || !initialPrompt.trim()
                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-indigo-600 to-cyan-600 hover:brightness-110 shadow-indigo-600/20 active:scale-95'
              }`}
            >
              {isRunning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Ejecutando Pipeline...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Ejecutar Pipeline Completo
                </>
              )}
            </button>

            {runError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-[11px] text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>El pipeline se detuvo: {runError}</span>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6">
          {/* Diagrama */}
          <div className="glass-panel rounded-2xl p-6 border border-white/10">
            <h3 className="text-xs font-bold text-slate-300 mb-4">
              Diagrama de Orquestación Secuencial
            </h3>
            {selectedWorkflow ? (
              <div className="flex flex-col md:flex-row items-center justify-between gap-4 overflow-x-auto pb-2">
                {selectedWorkflow.steps.map((step, idx) => {
                  const agent = agentsMap[step.agentId];
                  const isActive = activeStepIndex === idx;
                  const isCompleted = pipelineResults.length > idx;

                  return (
                    <React.Fragment key={step.id}>
                      <div
                        className={`flex-1 p-4 rounded-xl border transition-all min-w-[180px] ${
                          isActive
                            ? 'bg-amber-500/20 border-amber-500/60 shadow-lg shadow-amber-500/20 animate-pulse'
                            : isCompleted
                              ? 'bg-emerald-500/10 border-emerald-500/40 text-slate-200'
                              : 'bg-slate-900/60 border-white/10 text-slate-400'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-mono text-indigo-400 font-bold">
                            PASO {idx + 1}
                          </span>
                          {isCompleted ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : isActive ? (
                            <Clock className="w-4 h-4 text-amber-400 animate-spin" />
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="text-2xl">{agent?.avatar || '⚠️'}</span>
                          <div>
                            <div className="text-xs font-bold text-slate-100">
                              {agent?.name || 'Agente no encontrado'}
                            </div>
                            <div className="text-[10px] text-slate-400">{agent?.role}</div>
                          </div>
                        </div>
                      </div>

                      {idx < selectedWorkflow.steps.length - 1 && (
                        <ArrowRight className="w-5 h-5 text-indigo-400 hidden md:block shrink-0" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Selecciona o crea un workflow para verlo.</p>
            )}
          </div>

          {/* Resultados */}
          <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
            <h3 className="text-xs font-bold text-slate-300">Resultados del Pipeline</h3>
            {pipelineResults.length > 0 ? (
              <div className="space-y-4">
                {pipelineResults.map((res, idx) => (
                  <div
                    key={`${res.stepId}-${idx}`}
                    className="p-4 rounded-xl bg-slate-950/80 border border-white/10 space-y-2"
                  >
                    <div className="flex items-center justify-between border-b border-white/10 pb-2 gap-2 flex-wrap">
                      <span className="text-xs font-bold text-indigo-300 flex items-center gap-2">
                        <span>{res.agentAvatar}</span>
                        <span>Salida de {res.agentName}</span>
                        {res.simulated && (
                          <span className="px-2 py-0.5 text-[9px] font-semibold rounded-full flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            <FlaskConical className="w-3 h-3" />
                            SIMULADO
                          </span>
                        )}
                      </span>
                      <span
                        className={`text-[10px] font-mono ${res.failed ? 'text-rose-400' : 'text-emerald-400'}`}
                      >
                        {res.failed ? `Paso ${idx + 1} omitido` : `Paso ${idx + 1} completado`}
                      </span>
                    </div>
                    <Markdown className="text-slate-300">{res.output}</Markdown>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center border border-dashed border-white/10 rounded-xl text-xs text-slate-400">
                Ejecuta el pipeline para visualizar las respuestas encadenadas de los agentes.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
