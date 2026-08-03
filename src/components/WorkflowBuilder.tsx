import React, { useState } from 'react';
import { AgentConfig, WorkflowConfig, WorkflowStep } from '@/types/agent';
import { Layers, ArrowRight, Play, CheckCircle2, Clock, Plus, Trash2, Sparkles, Bot } from 'lucide-react';
import { runAgentEngine } from '@/lib/agentEngine';

interface WorkflowBuilderProps {
  workflows: WorkflowConfig[];
  agents: AgentConfig[];
  apiKey: string;
  onSaveWorkflow: (workflow: WorkflowConfig) => void;
}

export const WorkflowBuilder: React.FC<WorkflowBuilderProps> = ({
  workflows,
  agents,
  apiKey,
  onSaveWorkflow,
}) => {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowConfig>(workflows[0] || null);
  const [initialPrompt, setInitialPrompt] = useState('Construye una solución completa para una app de gestión de proyectos con IA');
  const [isRunning, setIsRunning] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [pipelineResults, setPipelineResults] = useState<{ stepId: string; output: string }[]>([]);

  // State for creating new workflow
  const [isCreating, setIsCreating] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [newWorkflowDesc, setNewWorkflowDesc] = useState('');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);

  const handleRunWorkflow = async () => {
    if (!selectedWorkflow || isRunning || !initialPrompt.trim()) return;

    setIsRunning(true);
    setPipelineResults([]);
    let currentInput = initialPrompt.trim();

    const agentsMap = agents.reduce((acc, a) => {
      acc[a.id] = a;
      return acc;
    }, {} as Record<string, AgentConfig>);

    for (let i = 0; i < selectedWorkflow.steps.length; i++) {
      setActiveStepIndex(i);
      const step = selectedWorkflow.steps[i];
      const agent = agentsMap[step.agentId];

      if (agent) {
        const promptForStep = step.customInstruction
          ? `${step.customInstruction}\n\n[CONTEXTO DEL AGENTE ANTERIOR]:\n${currentInput}`
          : currentInput;

        const result = await runAgentEngine({
          agent,
          userPrompt: promptForStep,
          apiKey,
        });

        currentInput = result.finalOutput;
        setPipelineResults((prev) => [...prev, { stepId: step.id, output: result.finalOutput }]);
      }
    }

    setActiveStepIndex(null);
    setIsRunning(false);
  };

  const handleAddAgentToNewWorkflow = (agentId: string) => {
    setSelectedAgentIds([...selectedAgentIds, agentId]);
  };

  const handleRemoveAgentFromNewWorkflow = (index: number) => {
    setSelectedAgentIds(selectedAgentIds.filter((_, idx) => idx !== index));
  };

  const handleSaveNewWorkflow = () => {
    if (!newWorkflowName.trim() || selectedAgentIds.length === 0) return;

    const newWf: WorkflowConfig = {
      id: 'wf-' + Date.now(),
      name: newWorkflowName.trim(),
      description: newWorkflowDesc.trim() || 'Flujo multi-agente personalizado.',
      steps: selectedAgentIds.map((agentId, index) => {
        const agent = agents.find((a) => a.id === agentId);
        return {
          id: `step-${index + 1}`,
          agentId,
          stepName: `${index + 1}. ${agent?.name || 'Agente'}`,
          customInstruction: `Paso ${index + 1}: Ejecutar tarea asignada.`,
        };
      }),
      createdAt: new Date().toISOString(),
    };

    onSaveWorkflow(newWf);
    setSelectedWorkflow(newWf);
    setIsCreating(false);
    setNewWorkflowName('');
    setNewWorkflowDesc('');
    setSelectedAgentIds([]);
  };

  const agentsMap = agents.reduce((acc, a) => {
    acc[a.id] = a;
    return acc;
  }, {} as Record<string, AgentConfig>);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            Orquestación de Pipelines Multi-Agente
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Encadena múltiples agentes especialistas en secuencia. La salida de cada agente servirá como entrada enriquecida para el siguiente.
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

      {/* Modal / Section for creating new workflow */}
      {isCreating && (
        <div className="glass-panel rounded-2xl p-6 border border-indigo-500/30 space-y-4">
          <h3 className="text-sm font-bold text-slate-100">Crear Flujo Multi-Agente Personalizado</h3>
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
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              Seleccionar Agentes en Orden de Ejecución:
            </label>
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

            {/* Sequence Preview */}
            <div className="p-3 bg-slate-950/60 rounded-xl border border-white/5">
              <span className="text-[11px] font-bold text-slate-400 block mb-2">Secuencia seleccionada:</span>
              <div className="flex flex-wrap items-center gap-2">
                {selectedAgentIds.map((id, idx) => {
                  const a = agentsMap[id];
                  return (
                    <React.Fragment key={idx}>
                      <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/30 text-indigo-200 border border-indigo-500/40 text-xs">
                        <span>{a?.avatar}</span>
                        <span>{a?.name}</span>
                        <button
                          onClick={() => handleRemoveAgentFromNewWorkflow(idx)}
                          className="ml-1 text-rose-400 hover:text-rose-300"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                      {idx < selectedAgentIds.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-slate-400" />}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={handleSaveNewWorkflow}
              disabled={!newWorkflowName.trim() || selectedAgentIds.length === 0}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md"
            >
              Guardar Workflow
            </button>
          </div>
        </div>
      )}

      {/* Main Workflow View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Workflow List & Controls */}
        <div className="lg:col-span-4 space-y-4">
          <div className="glass-panel rounded-2xl p-5 border border-white/10 space-y-3">
            <h3 className="text-xs font-bold text-slate-300">Workflows Disponibles</h3>
            <div className="space-y-2">
              {workflows.map((wf) => (
                <button
                  key={wf.id}
                  onClick={() => {
                    setSelectedWorkflow(wf);
                    setPipelineResults([]);
                  }}
                  className={`w-full p-3.5 rounded-xl border text-left transition-all ${
                    selectedWorkflow?.id === wf.id
                      ? 'bg-indigo-600/20 border-indigo-500/80 text-white shadow-md'
                      : 'bg-slate-900/40 border-white/5 text-slate-400 hover:bg-slate-900/80'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-100">{wf.name}</div>
                  <div className="text-[10px] text-slate-400 mt-1">{wf.description}</div>
                  <div className="text-[10px] text-indigo-400 font-mono mt-2">
                    {wf.steps.length} Pasos Secuenciales
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-5 border border-white/10 space-y-3">
            <label className="block text-xs font-bold text-slate-300">Prompt Inicial del Pipeline</label>
            <textarea
              rows={4}
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              className="w-full px-3 py-2 rounded-xl glass-input text-xs leading-relaxed"
            />
            <button
              onClick={handleRunWorkflow}
              disabled={isRunning || !selectedWorkflow || !initialPrompt.trim()}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold text-white shadow-lg transition-all ${
                isRunning
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
          </div>
        </div>

        {/* Visual Pipeline & Results */}
        <div className="lg:col-span-8 space-y-6">
          {/* Visual Sequence Chain */}
          <div className="glass-panel rounded-2xl p-6 border border-white/10">
            <h3 className="text-xs font-bold text-slate-300 mb-4">Diagrama de Orquestación Secuencial</h3>
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
                          <span className="text-2xl">{agent?.avatar || '🤖'}</span>
                          <div>
                            <div className="text-xs font-bold text-slate-100">{agent?.name || 'Agente'}</div>
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
            ) : null}
          </div>

          {/* Pipeline Results View */}
          <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
            <h3 className="text-xs font-bold text-slate-300">Resultados del Pipeline</h3>
            {pipelineResults.length > 0 ? (
              <div className="space-y-4">
                {pipelineResults.map((res, idx) => {
                  const step = selectedWorkflow.steps[idx];
                  const agent = agentsMap[step?.agentId || ''];
                  return (
                    <div key={res.stepId} className="p-4 rounded-xl bg-slate-950/80 border border-white/10 space-y-2">
                      <div className="flex items-center justify-between border-b border-white/10 pb-2">
                        <span className="text-xs font-bold text-indigo-300 flex items-center gap-2">
                          <span>{agent?.avatar}</span>
                          <span>Salida de {agent?.name}</span>
                        </span>
                        <span className="text-[10px] text-emerald-400 font-mono">Paso {idx + 1} completado</span>
                      </div>
                      <div className="prose prose-invert max-w-none text-xs leading-relaxed text-slate-300">
                        {res.output}
                      </div>
                    </div>
                  );
                })}
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
