'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AgentConfig, ExecutionRun, ThoughtStep, ProviderKeys } from '@/types/agent';
import {
  ConversationMessage,
  WEB_THREAD_KEY,
  resolveMemoryTurns,
} from '@/types/conversation';
import {
  Play,
  Terminal,
  Cpu,
  Clock,
  Copy,
  Check,
  Sparkles,
  Bot,
  FlaskConical,
  Eraser,
  Brain,
} from 'lucide-react';
import { runAgentEngine } from '@/lib/agentEngine';
import { fetchProviderBridge } from '@/lib/bridgeClient';
import { fetchMcpBridge, fetchMcpTools } from '@/lib/mcpBridgeClient';
import { newTraceId, postLiveEvent } from '@/lib/liveEventsClient';
import { Markdown } from './Markdown';

interface ExecutionPanelProps {
  selectedAgent: AgentConfig | null;
  agents: AgentConfig[];
  onSelectAgent: (agent: AgentConfig) => void;
  apiKey: string;
  providerKeys?: ProviderKeys;
  onSaveRunHistory: (run: ExecutionRun) => void;
}

/**
 * Los pasos MCP no llevan `toolName` (ese campo está tipado con el registro de
 * herramientas locales); su identidad viaja en `toolArgs`.
 */
function mcpStepLabel(step: ThoughtStep): string | null {
  const args = step.toolArgs as { mcpServer?: string; mcpTool?: string } | undefined;
  if (!args?.mcpTool) return null;
  return args.mcpServer ? `${args.mcpServer} / ${args.mcpTool}` : args.mcpTool;
}

const SAMPLE_PROMPTS = [
  'Investiga y crea un microservicio en Next.js para gestionar colas de tareas background',
  'Audita la seguridad de esta función async y propone correcciones de timeouts',
  'Crea un concepto UI neón futurista con glassmorphism para un dashboard de IA',
];

export const ExecutionPanel: React.FC<ExecutionPanelProps> = ({
  selectedAgent,
  agents,
  onSelectAgent,
  apiKey,
  providerKeys,
  onSaveRunHistory,
}) => {
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [currentRun, setCurrentRun] = useState<ExecutionRun | null>(null);
  const [copiedStepId, setCopiedStepId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);

  const memoryTurns = resolveMemoryTurns(selectedAgent?.memoryTurns);
  const agentId = selectedAgent?.id;

  // Cambiar de agente vacía el panel al instante, en render y no en un efecto:
  // así no se llega a pintar un fotograma con la conversación del agente
  // anterior. Es el patrón que React documenta para reaccionar a un cambio de
  // prop sin cascada de renders.
  const [loadedAgentId, setLoadedAgentId] = useState(agentId);
  if (agentId !== loadedAgentId) {
    setLoadedAgentId(agentId);
    setMessages([]);
    setCurrentRun(null);
  }

  // Un hilo por agente en el workbench: encaja con el modelo de "un agente
  // seleccionado" que ya tiene el panel, sin necesidad de un selector de hilos.
  useEffect(() => {
    if (!agentId) return;

    let cancelled = false;

    fetch(
      `/api/conversations?agentId=${encodeURIComponent(agentId)}&threadKey=${WEB_THREAD_KEY}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setMessages(data.success ? data.messages : []);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [messages]);

  const handleNewConversation = async () => {
    if (!selectedAgent) return;
    setMessages([]);
    setCurrentRun(null);
    await fetch(
      `/api/conversations?agentId=${encodeURIComponent(selectedAgent.id)}&threadKey=${WEB_THREAD_KEY}`,
      { method: 'DELETE' }
    ).catch(console.error);
  };

  const handleExecute = async () => {
    if (!selectedAgent || !prompt.trim() || isRunning) return;

    const userPrompt = prompt.trim();
    // El contexto se captura ANTES del append optimista: el turno actual viaja
    // en `userPrompt`, no en el historial.
    const history = messages;
    const sentAt = new Date().toISOString();

    setPrompt('');
    setMessages((prev) => [...prev, { role: 'user', content: userPrompt, timestamp: sentAt }]);

    setIsRunning(true);
    const newRun: ExecutionRun = {
      id: 'run-' + Date.now(),
      agentId: selectedAgent.id,
      agentName: selectedAgent.name,
      agentAvatar: selectedAgent.avatar,
      agentRole: selectedAgent.role,
      prompt: userPrompt,
      status: 'running',
      steps: [],
      finalOutput: '',
      timestamp: sentAt,
      threadKey: WEB_THREAD_KEY,
    };

    setCurrentRun(newRun);
    // Acumulamos los pasos aquí además de en el estado: si la ejecución falla,
    // el `setCurrentRun` funcional aún no ha llegado y perderíamos la traza.
    const streamedSteps: ThoughtStep[] = [];

    const traceId = newTraceId();
    postLiveEvent({
      traceId,
      type: 'run_start',
      source: 'web',
      targetKind: 'agent',
      targetId: selectedAgent.id,
      targetName: selectedAgent.name,
      targetAvatar: selectedAgent.avatar,
      prompt: userPrompt,
    });

    try {
      const result = await runAgentEngine({
        agent: selectedAgent,
        userPrompt,
        history,
        apiKey,
        providerKeys,
        bridgeFn: fetchProviderBridge,
        mcpFn: fetchMcpBridge,
        mcpListFn: fetchMcpTools,
        onStepUpdate: (step: ThoughtStep) => {
          streamedSteps.push(step);
          setCurrentRun((prev) => (prev ? { ...prev, steps: [...prev.steps, step] } : null));
          postLiveEvent({ traceId, type: 'thought', step });
        },
      });

      const completedRun: ExecutionRun = {
        ...newRun,
        status: 'completed',
        steps: result.steps,
        finalOutput: result.finalOutput,
        metrics: result.metrics,
        simulated: result.simulated,
        provider: result.provider,
      };

      setCurrentRun(completedRun);
      onSaveRunHistory(completedRun);
      postLiveEvent({
        traceId,
        type: 'run_end',
        status: 'completed',
        finalOutput: result.finalOutput,
        metrics: result.metrics,
        simulated: result.simulated,
      });

      const assistantMessage: ConversationMessage = {
        role: 'assistant',
        content: result.finalOutput,
        timestamp: new Date().toISOString(),
        runId: completedRun.id,
        simulated: result.simulated,
      };
      setMessages((prev) => [...prev, assistantMessage]);

      // El motor corre en el navegador, así que el turno se persiste por HTTP.
      // Si esto falla, la conversación sigue viva en pantalla y solo se pierde
      // la memoria: degradar es preferible a abortar un turno ya respondido.
      fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgent.id,
          threadKey: WEB_THREAD_KEY,
          user: { role: 'user', content: userPrompt, timestamp: sentAt },
          assistant: assistantMessage,
        }),
      }).catch(console.error);
    } catch (err) {
      // El mensaje del usuario se queda en pantalla (para que vea qué envió)
      // pero NO se persiste: medio turno en disco rompería la alternancia de
      // roles y haría fallar la petición siguiente.
      const failedRun: ExecutionRun = {
        ...newRun,
        status: 'failed',
        // Conservamos los pasos ya emitidos: sin ellos el historial guarda un
        // fallo sin ninguna pista de dónde se rompió.
        steps: streamedSteps,
        finalOutput: `Error en la ejecución: ${err instanceof Error ? err.message : String(err)}`,
      };
      setCurrentRun(failedRun);
      onSaveRunHistory(failedRun);
      postLiveEvent({
        traceId,
        type: 'run_end',
        status: 'failed',
        finalOutput: failedRun.finalOutput,
        simulated: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopyOutput = (stepId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedStepId(stepId);
    window.setTimeout(() => setCopiedStepId((id) => (id === stepId ? null : id)), 2000);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Columna izquierda: selector y entrada de tarea */}
      <div className="lg:col-span-5 space-y-6">
        <div className="glass-panel rounded-2xl p-5 border border-white/10">
          <div className="text-xs font-bold text-slate-300 mb-3 flex items-center justify-between">
            <span>1. Seleccionar Agente Activo</span>
            <span className="text-[10px] text-slate-400 font-normal">
              {agents.length} disponibles
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent)}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                  selectedAgent?.id === agent.id
                    ? 'bg-indigo-600/20 border-indigo-500/80 text-white shadow-md shadow-indigo-500/10'
                    : 'bg-slate-900/40 border-white/5 text-slate-400 hover:bg-slate-900/80 hover:text-slate-200'
                }`}
              >
                <div className="text-2xl">{agent.avatar || '🤖'}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate">{agent.name}</div>
                  <div className="text-[10px] text-indigo-400 truncate">{agent.role}</div>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-white/10 text-slate-400">
                  {agent.model}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="task-prompt" className="block text-xs font-bold text-slate-300">
              2. Prompt / Instrucción de la Tarea
            </label>
            <span
              title="Turnos anteriores que el agente recibe como contexto. Se configura al editar el agente."
              className="text-[10px] text-slate-400 flex items-center gap-1"
            >
              <Brain className="w-3 h-3 text-indigo-400" />
              {memoryTurns === 0 ? 'Sin memoria' : `Memoria: ${memoryTurns} turnos`}
            </span>
          </div>

          <div className="mb-3">
            <div className="text-[10px] text-slate-400 mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" /> Prompts sugeridos rápidos:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_PROMPTS.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setPrompt(sp)}
                  className="text-[10px] bg-slate-900/80 hover:bg-indigo-950 text-slate-300 border border-white/10 rounded-lg px-2.5 py-1 text-left transition-colors line-clamp-1"
                >
                  {sp}
                </button>
              ))}
            </div>
          </div>

          <textarea
            id="task-prompt"
            rows={4}
            placeholder="Describe la tarea, o continúa la conversación... (Enter para enviar, Mayús+Enter para salto de línea)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleExecute();
              }
            }}
            className="w-full px-3.5 py-2.5 rounded-xl glass-input text-xs leading-relaxed mb-4"
          />

          <div className="flex gap-2">
            <button
              onClick={handleExecute}
              disabled={!selectedAgent || !prompt.trim() || isRunning}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold text-white shadow-lg transition-all ${
                isRunning || !selectedAgent || !prompt.trim()
                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed border border-white/5'
                  : 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 hover:brightness-110 shadow-indigo-500/25 active:scale-95'
              }`}
            >
              {isRunning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Ejecutando Agente...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  {messages.length > 0 ? 'Enviar' : 'Lanzar Agente'}
                </>
              )}
            </button>

            <button
              onClick={handleNewConversation}
              disabled={!selectedAgent || isRunning || messages.length === 0}
              title="Olvidar la conversación y empezar de cero"
              className="flex items-center justify-center gap-1.5 px-3.5 py-3 rounded-xl text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-slate-900/80 border-white/10 text-slate-300 hover:text-white hover:bg-slate-800"
            >
              <Eraser className="w-4 h-4" />
              Nueva
            </button>
          </div>
        </div>
      </div>

      {/* Columna derecha: stream de ejecución */}
      <div className="lg:col-span-7">
        <div className="glass-panel rounded-2xl p-5 border border-white/10 h-full flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                <Terminal className="w-4 h-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                  Live Stream de Ejecución
                  {currentRun && (
                    <span
                      className={`px-2 py-0.5 text-[9px] font-semibold rounded-full flex items-center gap-1 ${
                        currentRun.status === 'running'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                          : currentRun.status === 'completed'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {currentRun.status === 'running' && 'En ejecución...'}
                      {currentRun.status === 'completed' && 'Completado'}
                      {currentRun.status === 'failed' && 'Error'}
                    </span>
                  )}
                  {currentRun?.simulated && (
                    <span
                      title="La respuesta la generó el motor local, no el proveedor."
                      className="px-2 py-0.5 text-[9px] font-semibold rounded-full flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40"
                    >
                      <FlaskConical className="w-3 h-3" />
                      SIMULADO
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-slate-400">
                  {selectedAgent
                    ? `Agente: ${selectedAgent.avatar} ${selectedAgent.name} (${selectedAgent.model})`
                    : 'Selecciona un agente para ver el stream.'}
                </p>
              </div>
            </div>

            {currentRun?.metrics && (
              <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono bg-slate-900/90 px-3 py-1.5 rounded-lg border border-white/10">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-cyan-400" />
                  {currentRun.metrics.latencyMs}ms
                </span>
                <span className="flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-indigo-400" />
                  {currentRun.metrics.totalTokens} tokens
                </span>
              </div>
            )}
          </div>

          {/* Lista de mensajes: la conversación en sí. */}
          {messages.length > 0 && (
            <div
              ref={messagesRef}
              className="flex-1 space-y-3 overflow-y-auto max-h-[420px] pr-2 mb-4"
            >
              {messages.map((message, index) => (
                <div
                  key={`${message.timestamp}-${index}`}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs border ${
                      message.role === 'user'
                        ? 'bg-indigo-600/20 border-indigo-500/40 text-slate-100 whitespace-pre-wrap'
                        : 'bg-slate-950/80 border-white/10 text-slate-200'
                    }`}
                  >
                    {message.role === 'user' ? (
                      message.content
                    ) : (
                      <Markdown>{message.content}</Markdown>
                    )}
                    {message.simulated && (
                      <div className="mt-2 text-[9px] font-semibold text-amber-300 flex items-center gap-1">
                        <FlaskConical className="w-3 h-3" />
                        SIMULADO
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {currentRun ? (
            <details open={isRunning} className="group">
              <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1.5 mb-2 select-none">
                <Brain className="w-3.5 h-3.5 text-indigo-400" />
                Razonamiento del último turno ({currentRun.steps.length} pasos)
              </summary>
              <StepStream
                steps={currentRun.steps}
                copiedStepId={copiedStepId}
                onCopy={handleCopyOutput}
              />
            </details>
          ) : messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-white/10 rounded-xl bg-slate-950/30">
              <Bot className="w-12 h-12 text-slate-400 mb-3" />
              <h4 className="text-sm font-bold text-slate-300">Mesa de Trabajo Lista</h4>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                Selecciona un agente a la izquierda, ingresa tu instrucción y presiona{' '}
                <strong>Lanzar Agente</strong> para ver la transmisión en tiempo real.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

interface StepStreamProps {
  steps: ThoughtStep[];
  copiedStepId: string | null;
  onCopy: (stepId: string, content: string) => void;
}

/** Traza de razonamiento del turno en curso. Extraído tal cual del panel. */
const StepStream: React.FC<StepStreamProps> = ({ steps, copiedStepId, onCopy }) => (
  <div className="flex-1 flex flex-col space-y-4 overflow-y-auto max-h-[400px] pr-2">
              <div className="space-y-2">
                {steps.map((step) => (
                  <div
                    key={step.id}
                    className={`p-3 rounded-xl text-xs font-mono border transition-all ${
                      step.type === 'thought'
                        ? 'bg-slate-900/60 border-indigo-500/20 text-slate-300'
                        : step.type === 'tool_call'
                          ? 'bg-cyan-950/40 border-cyan-500/30 text-cyan-200'
                          : step.type === 'tool_result'
                            ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
                            : step.type === 'error'
                              ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                              : 'bg-slate-900 border-white/10 text-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] opacity-70 mb-1">
                      <span className="font-bold uppercase tracking-wider flex items-center gap-1">
                        {step.type === 'thought' && '🧠 Razonamiento'}
                        {step.type === 'tool_call' &&
                          (step.toolName
                            ? `🛠️ Invocación: ${step.toolName}`
                            : `🔌 ${mcpStepLabel(step) ?? 'Invocación MCP'}`)}
                        {step.type === 'tool_result' &&
                          (step.toolName
                            ? `✅ Resultado: ${step.toolName}`
                            : `✅ Resultado MCP${mcpStepLabel(step) ? `: ${mcpStepLabel(step)}` : ''}`)}
                        {step.type === 'error' && '❌ Error de Ejecución'}
                        {step.type === 'output' && '📄 Salida Final'}
                      </span>
                      <span>{step.timestamp}</span>
                    </div>

                    <div className="whitespace-pre-wrap leading-relaxed">
                      {step.type === 'output' ? (
                        <div className="font-sans text-xs text-slate-200 bg-slate-950/90 p-4 rounded-xl border border-white/10">
                          <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/10">
                            <span className="font-bold text-indigo-400">Respuesta</span>
                            <button
                              onClick={() => onCopy(step.id, step.content)}
                              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white bg-slate-900 px-2 py-1 rounded border border-white/10"
                            >
                              {copiedStepId === step.id ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              {copiedStepId === step.id ? 'Copiado' : 'Copiar'}
                            </button>
                          </div>
                          <Markdown>{step.content}</Markdown>
                        </div>
                      ) : (
                        step.content
                      )}

                      {step.toolResult && (
                        <pre className="mt-2 p-2 rounded bg-slate-950/90 text-[10px] text-emerald-400 overflow-x-auto border border-emerald-500/20">
                          {step.toolResult}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>
  </div>
);
