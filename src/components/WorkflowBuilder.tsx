'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  AgentConfig,
  ExecutionRun,
  WorkflowConfig,
  WorkflowStepResult,
  ProviderKeys,
} from '@/types/agent';
import {
  Layers,
  ArrowRight,
  Play,
  Square,
  CheckCircle2,
  Clock,
  Plus,
  Trash2,
  Pencil,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  SkipForward,
  FlaskConical,
  Send,
} from 'lucide-react';
import {
  indexAgents,
  runWorkflowPipeline,
  workflowStepRunId,
  workflowStepToRun,
} from '@/lib/workflowEngine';
import { newTraceId, postLiveEvent } from '@/lib/liveEventsClient';
import { fetchProviderBridge } from '@/lib/bridgeClient';
import { fetchMcpBridge, fetchMcpTools } from '@/lib/mcpBridgeClient';
import { Markdown } from './Markdown';

interface WorkflowBuilderProps {
  workflows: WorkflowConfig[];
  agents: AgentConfig[];
  apiKey: string;
  providerKeys?: ProviderKeys;
  onSaveWorkflow: (workflow: WorkflowConfig) => void;
  onDeleteWorkflow: (workflowId: string) => void;
  onSaveRunHistory: (run: ExecutionRun) => void;
  /** Abre el modal de Telegram sobre este workflow. Lo posee `page.tsx`. */
  onOpenTelegram: (workflow: WorkflowConfig) => void;
}

interface DraftStep {
  agentId: string;
  instruction: string;
  /**
   * Etiqueta del paso SIN el prefijo numérico, que se recalcula al guardar.
   * Se arrastra por el formulario en vez de regenerarse desde el nombre del
   * agente: es una etiqueta propia del paso ("Investigación Inicial"), y
   * rehacerla borraba los nombres descriptivos al editar el workflow.
   */
  stepName: string;
}

/** Quita el "3. " inicial para que renumerar al guardar no lo acumule. */
function stripStepNumber(stepName: string): string {
  return stepName.replace(/^\s*\d+\.\s*/, '').trim();
}

export const WorkflowBuilder: React.FC<WorkflowBuilderProps> = ({
  workflows,
  agents,
  apiKey,
  providerKeys,
  onSaveWorkflow,
  onDeleteWorkflow,
  onSaveRunHistory,
  onOpenTelegram,
}) => {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    workflows[0]?.id ?? null
  );
  const [initialPrompt, setInitialPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [pipelineResults, setPipelineResults] = useState<WorkflowStepResult[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Estado del formulario, compartido entre alta y edición.
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [editingCreatedAt, setEditingCreatedAt] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftSteps, setDraftSteps] = useState<DraftStep[]>([]);

  const agentsMap = useMemo(() => indexAgents(agents), [agents]);

  // Los workflows llegan de forma asíncrona desde /api/workflows, así que la
  // selección se deriva en cada render en lugar de fijarse al montar: si se
  // guardara en estado, la vista se quedaría vacía hasta recargar.
  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflowId) ?? workflows[0] ?? null,
    [workflows, selectedWorkflowId]
  );

  const handleRunWorkflow = async () => {
    if (!selectedWorkflow || isRunning || !initialPrompt.trim()) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setPipelineResults([]);
    setRunError(null);

    // El motor corre en el navegador, así que el monitor en vivo se alimenta
    // por HTTP. Es telemetría: si falla, la ejecución no se entera.
    const traceId = newTraceId();
    const timestamp = new Date().toISOString();
    postLiveEvent({
      traceId,
      type: 'run_start',
      source: 'web',
      targetKind: 'workflow',
      targetId: selectedWorkflow.id,
      targetName: selectedWorkflow.name,
      targetAvatar: '🔗',
      prompt: initialPrompt.trim(),
      totalSteps: selectedWorkflow.steps.length,
    });

    try {
      const pipeline = await runWorkflowPipeline({
        workflow: selectedWorkflow,
        agents: agentsMap,
        initialPrompt: initialPrompt.trim(),
        apiKey,
        providerKeys,
        bridgeFn: fetchProviderBridge,
        mcpFn: fetchMcpBridge,
        mcpListFn: fetchMcpTools,
        signal: controller.signal,
        onStepStart: (index) => {
          setActiveStepIndex(index);
          const step = selectedWorkflow.steps[index];
          const agent = agentsMap[step.agentId];
          postLiveEvent({
            traceId,
            type: 'step_start',
            index,
            stepName: step.stepName,
            agentName: agent?.name ?? step.agentId,
            agentAvatar: agent?.avatar ?? '⚠️',
          });
        },
        onAgentStep: (step, index) => postLiveEvent({ traceId, type: 'thought', index, step }),
        onStepResult: (result, index) => {
          setPipelineResults((prev) => [...prev, result]);
          postLiveEvent({
            traceId,
            type: 'step_result',
            index,
            stepName: result.stepName,
            agentName: result.agentName,
            agentAvatar: result.agentAvatar,
            status: result.status,
            output: result.output,
            metrics: result.metrics ?? undefined,
            simulated: result.simulated,
            ...(result.error ? { error: result.error } : {}),
            ...(result.status === 'skipped'
              ? {}
              : { runId: workflowStepRunId(timestamp, index) }),
          });
          // Cada paso queda en el historial: antes los workflows no dejaban
          // rastro. Los omitidos no se registran, no hubo ejecución.
          if (result.status !== 'skipped') {
            onSaveRunHistory(workflowStepToRun(result, index, { timestamp }));
          }
        },
      });

      if (pipeline.failed) {
        setRunError(pipeline.stepResults.at(-1)?.error ?? 'El pipeline falló.');
      } else if (pipeline.aborted) {
        setRunError('Pipeline detenido por el usuario.');
      }

      postLiveEvent({
        traceId,
        type: 'run_end',
        status: pipeline.failed ? 'failed' : pipeline.aborted ? 'aborted' : 'completed',
        finalOutput: pipeline.finalOutput,
        simulated: pipeline.simulated,
        ...(pipeline.failed
          ? { error: pipeline.stepResults.at(-1)?.error ?? 'El pipeline falló.' }
          : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      postLiveEvent({
        traceId,
        type: 'run_end',
        status: 'failed',
        finalOutput: message,
        simulated: false,
        error: message,
      });
      // Salvaguarda: `runWorkflowPipeline` ya captura los fallos por paso, pero
      // sin este catch un error inesperado dejaría isRunning en true para
      // siempre y el botón bloqueado hasta recargar la página.
      setRunError(message);
    } finally {
      abortRef.current = null;
      setActiveStepIndex(null);
      setIsRunning(false);
    }
  };

  const handleStopWorkflow = () => {
    abortRef.current?.abort();
  };

  const resetForm = () => {
    setEditingWorkflowId(null);
    setEditingCreatedAt(null);
    setDraftName('');
    setDraftDesc('');
    setDraftSteps([]);
  };

  const handleToggleCreate = () => {
    if (isFormOpen) {
      setIsFormOpen(false);
      resetForm();
      return;
    }
    resetForm();
    setIsFormOpen(true);
  };

  const handleEditWorkflow = (wf: WorkflowConfig) => {
    // Se selecciona también: si no, editas un workflow mientras el diagrama de
    // la derecha sigue mostrando otro.
    setSelectedWorkflowId(wf.id);
    setEditingWorkflowId(wf.id);
    setEditingCreatedAt(wf.createdAt);
    setDraftName(wf.name);
    setDraftDesc(wf.description);
    setDraftSteps(
      wf.steps.map((s) => ({
        agentId: s.agentId,
        instruction: s.customInstruction ?? '',
        stepName: stripStepNumber(s.stepName),
      }))
    );
    setIsFormOpen(true);
  };

  const handleAddAgentToDraft = (agentId: string) => {
    setDraftSteps((prev) => [
      ...prev,
      { agentId, instruction: '', stepName: agentsMap[agentId]?.name ?? 'Agente' },
    ]);
  };

  const handleRemoveDraftStep = (index: number) => {
    setDraftSteps((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleUpdateDraftInstruction = (index: number, instruction: string) => {
    setDraftSteps((prev) => prev.map((s, idx) => (idx === index ? { ...s, instruction } : s)));
  };

  const handleUpdateDraftStepName = (index: number, stepName: string) => {
    setDraftSteps((prev) => prev.map((s, idx) => (idx === index ? { ...s, stepName } : s)));
  };

  const handleMoveDraftStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    setDraftSteps((prev) => {
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSaveDraft = () => {
    if (!draftName.trim() || draftSteps.length === 0) return;

    const wf: WorkflowConfig = {
      id: editingWorkflowId ?? 'wf-' + Date.now(),
      name: draftName.trim(),
      description: draftDesc.trim() || 'Flujo multi-agente personalizado.',
      steps: draftSteps.map((s, index) => ({
        id: `step-${index + 1}`,
        agentId: s.agentId,
        // Solo se renumera el prefijo; la etiqueta la conserva el borrador para
        // que reordenar o editar no borre los nombres descriptivos.
        stepName: `${index + 1}. ${stripStepNumber(s.stepName) || agentsMap[s.agentId]?.name || 'Agente'}`,
        // Vacío en vez de un placeholder inútil: sin instrucción, el paso
        // recibe tal cual la salida del anterior.
        customInstruction: s.instruction.trim() || undefined,
      })),
      // El formulario no toca el bot, pero reconstruye el objeto entero: sin
      // arrastrar la config, editar un workflow lo desenrolaría de Telegram.
      telegramConfig: editingWorkflowId
        ? workflows.find((w) => w.id === editingWorkflowId)?.telegramConfig
        : undefined,
      createdAt: editingCreatedAt ?? new Date().toISOString(),
    };

    onSaveWorkflow(wf);
    setSelectedWorkflowId(wf.id);
    setIsFormOpen(false);
    resetForm();
  };

  const handleDelete = (wf: WorkflowConfig) => {
    if (!window.confirm(`¿Eliminar el workflow "${wf.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    if (selectedWorkflowId === wf.id) {
      setSelectedWorkflowId(workflows.find((w) => w.id !== wf.id)?.id ?? null);
      setPipelineResults([]);
    }
    if (editingWorkflowId === wf.id) {
      setIsFormOpen(false);
      resetForm();
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
          onClick={handleToggleCreate}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          {isFormOpen ? 'Cancelar' : 'Crear Nuevo Workflow'}
        </button>
      </div>

      {/* Formulario de alta / edición */}
      {isFormOpen && (
        <div className="glass-panel rounded-2xl p-6 border border-indigo-500/30 space-y-4">
          <h3 className="text-sm font-bold text-slate-100">
            {editingWorkflowId
              ? `Editar Workflow: ${draftName || 'sin nombre'}`
              : 'Crear Flujo Multi-Agente Personalizado'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Nombre del Workflow (ej: Pipeline de Auditoría de IA)"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="px-3.5 py-2 rounded-xl glass-input text-xs"
            />
            <input
              type="text"
              placeholder="Descripción breve..."
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
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
                  onClick={() => handleAddAgentToDraft(agent.id)}
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
              {draftSteps.length === 0 && (
                <p className="text-[11px] text-slate-500">
                  Aún no has añadido ningún agente al flujo.
                </p>
              )}
              {draftSteps.map((s, idx) => {
                const a = agentsMap[s.agentId];
                return (
                  <div
                    key={`${s.agentId}-${idx}`}
                    className="flex flex-col md:flex-row md:items-center gap-2"
                  >
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/30 text-indigo-200 border border-indigo-500/40 text-xs shrink-0">
                      <span className="font-mono text-[10px]">{idx + 1}</span>
                      <span>{a?.avatar ?? '⚠️'}</span>
                      <span>{a?.name ?? `Agente ${s.agentId} (no encontrado)`}</span>
                      <button
                        onClick={() => handleMoveDraftStep(idx, -1)}
                        disabled={idx === 0}
                        className="ml-1 text-indigo-300 hover:text-white disabled:opacity-30 disabled:hover:text-indigo-300"
                        aria-label={`Subir paso ${idx + 1}`}
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleMoveDraftStep(idx, 1)}
                        disabled={idx === draftSteps.length - 1}
                        className="text-indigo-300 hover:text-white disabled:opacity-30 disabled:hover:text-indigo-300"
                        aria-label={`Bajar paso ${idx + 1}`}
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleRemoveDraftStep(idx)}
                        className="text-rose-400 hover:text-rose-300"
                        aria-label={`Quitar paso ${idx + 1}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                    <input
                      type="text"
                      placeholder="Nombre del paso"
                      aria-label={`Nombre del paso ${idx + 1}`}
                      value={s.stepName}
                      onChange={(e) => handleUpdateDraftStepName(idx, e.target.value)}
                      className="w-full md:w-44 px-3 py-1.5 rounded-lg glass-input text-[11px] shrink-0"
                    />
                    <input
                      type="text"
                      placeholder="Instrucción para este paso (opcional)"
                      value={s.instruction}
                      onChange={(e) => handleUpdateDraftInstruction(idx, e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg glass-input text-[11px]"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={handleSaveDraft}
              disabled={!draftName.trim() || draftSteps.length === 0}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-400 text-white shadow-md"
            >
              {editingWorkflowId ? 'Guardar Cambios' : 'Guardar Workflow'}
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
                    <div className="text-[10px] text-indigo-400 font-mono mt-2 flex items-center gap-2 flex-wrap">
                      <span>{wf.steps.length} pasos secuenciales</span>
                      {wf.telegramConfig?.status === 'connected' && wf.telegramConfig.botUsername && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                          <Send className="w-2.5 h-2.5" />@{wf.telegramConfig.botUsername}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="px-3.5 pb-2.5 flex justify-end gap-3">
                    <button
                      onClick={() => onOpenTelegram(wf)}
                      className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-cyan-300 transition-colors"
                    >
                      <Send className="w-3 h-3" />
                      Telegram
                    </button>
                    <button
                      onClick={() => handleEditWorkflow(wf)}
                      className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-indigo-300 transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      Editar
                    </button>
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
              placeholder="Describe la tarea que recorrerá toda la cadena de agentes..."
              onChange={(e) => setInitialPrompt(e.target.value)}
              className="w-full px-3 py-2 rounded-xl glass-input text-xs leading-relaxed"
            />
            {isRunning ? (
              <button
                onClick={handleStopWorkflow}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold text-white shadow-lg bg-rose-600 hover:bg-rose-500 transition-all"
              >
                <Square className="w-4 h-4 fill-current" />
                Detener tras el paso actual
              </button>
            ) : (
              <button
                onClick={handleRunWorkflow}
                disabled={!selectedWorkflow || !initialPrompt.trim()}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold text-white shadow-lg transition-all ${
                  !selectedWorkflow || !initialPrompt.trim()
                    ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-600 to-cyan-600 hover:brightness-110 shadow-indigo-600/20 active:scale-95'
                }`}
              >
                <Play className="w-4 h-4 fill-current" />
                Ejecutar Pipeline Completo
              </button>
            )}

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
                        className={`text-[10px] font-mono flex items-center gap-1 ${
                          res.status === 'completed'
                            ? 'text-emerald-400'
                            : res.status === 'skipped'
                              ? 'text-amber-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {res.status === 'skipped' && <SkipForward className="w-3 h-3" />}
                        {res.status === 'failed' && <AlertCircle className="w-3 h-3" />}
                        {res.status === 'completed'
                          ? `Paso ${idx + 1} completado`
                          : res.status === 'skipped'
                            ? `Paso ${idx + 1} omitido`
                            : `Paso ${idx + 1} falló`}
                      </span>
                    </div>
                    {res.status === 'failed' ? (
                      <p className="text-[11px] text-rose-300">{res.error}</p>
                    ) : (
                      <Markdown className="text-slate-300">{res.output}</Markdown>
                    )}
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
