'use client';

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  FlaskConical,
  Layers,
  Monitor,
  Radio,
  Send,
  SkipForward,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { liveStore, type LiveConnectionState } from '@/lib/liveEventsClient';
import type { LiveEvent, LiveTrace } from '@/types/liveEvent';

/**
 * Consola de operación: enseña, según ocurren, las peticiones que atraviesan el
 * arnés — bots de Telegram (agente y workflow), ejecuciones de la web y del CLI.
 *
 * No es el historial. `data/history.json` sigue siendo el registro de auditoría
 * y sobrevive a los reinicios; esto es efímero a propósito.
 *
 * El texto se pinta en plano, nunca como Markdown: `/api/events/publish` no está
 * autenticado y aquí puede aterrizar contenido de cualquiera.
 */

const BADGE = 'px-2 py-0.5 text-[9px] font-semibold rounded-full flex items-center gap-1';

function useElapsed(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return tick;
}

function formatDuration(fromIso: string, toIso?: string): string {
  const ms = (toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = ms / 1000;
  return seconds < 60
    ? `${seconds.toFixed(1)} s`
    : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

function SourceBadge({ trace }: { trace: LiveTrace }) {
  if (trace.source === 'telegram') {
    return (
      <span className={`${BADGE} bg-slate-800 text-slate-300 border border-white/10`}>
        <Send className="w-3 h-3 text-cyan-400" />
        Telegram{trace.telegramChatId ? ` · ${trace.telegramChatId}` : ''}
      </span>
    );
  }
  if (trace.source === 'cli') {
    return (
      <span className={`${BADGE} bg-slate-800 text-slate-300 border border-white/10`}>
        <Terminal className="w-3 h-3 text-emerald-400" /> CLI
      </span>
    );
  }
  return (
    <span className={`${BADGE} bg-slate-800 text-slate-300 border border-white/10`}>
      <Monitor className="w-3 h-3 text-indigo-400" /> Web
    </span>
  );
}

function StatusBadge({ trace }: { trace: LiveTrace }) {
  if (trace.status === 'running') {
    return (
      <span className={`${BADGE} bg-amber-500/20 text-amber-300 border border-amber-500/40`}>
        <Clock className="w-3 h-3 animate-spin" /> En curso
      </span>
    );
  }
  if (trace.status === 'failed') {
    return (
      <span className={`${BADGE} bg-rose-500/20 text-rose-300 border border-rose-500/30`}>
        <AlertCircle className="w-3 h-3" /> Fallida
      </span>
    );
  }
  if (trace.status === 'aborted') {
    return (
      <span className={`${BADGE} bg-slate-700/60 text-slate-300 border border-white/10`}>
        <SkipForward className="w-3 h-3" /> Detenida
      </span>
    );
  }
  return (
    <span className={`${BADGE} bg-emerald-500/20 text-emerald-300 border border-emerald-500/30`}>
      <CheckCircle2 className="w-3 h-3" /> Completada
    </span>
  );
}

interface StepView {
  index: number;
  stepName: string;
  agentName: string;
  agentAvatar: string;
  status: 'running' | 'completed' | 'skipped' | 'failed';
  output?: string;
  error?: string;
  simulated: boolean;
  tokens?: number;
  latencyMs?: number;
}

/**
 * Reconstruye los pasos a partir de la traza. Tolera que falte el `step_start`:
 * un paso omitido no lo emite, porque el motor lo dispara después de resolver el
 * agente (`workflowEngine.ts`).
 */
function buildSteps(events: LiveEvent[]): StepView[] {
  const byIndex = new Map<number, StepView>();

  for (const event of events) {
    if (event.type === 'step_start') {
      byIndex.set(event.index, {
        index: event.index,
        stepName: event.stepName,
        agentName: event.agentName,
        agentAvatar: event.agentAvatar,
        status: 'running',
        simulated: false,
      });
    }
    if (event.type === 'step_result') {
      byIndex.set(event.index, {
        index: event.index,
        stepName: event.stepName,
        agentName: event.agentName,
        agentAvatar: event.agentAvatar,
        status: event.status,
        output: event.output,
        error: event.error,
        simulated: event.simulated,
        tokens: event.metrics?.totalTokens,
        latencyMs: event.metrics?.latencyMs,
      });
    }
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

function stepClasses(status: StepView['status']): string {
  switch (status) {
    case 'running':
      return 'bg-amber-500/20 border-amber-500/60 animate-pulse';
    case 'completed':
      return 'bg-emerald-500/10 border-emerald-500/40';
    case 'skipped':
      return 'bg-slate-900/60 border-amber-500/30';
    default:
      return 'bg-rose-500/10 border-rose-500/40';
  }
}

function StepIcon({ status }: { status: StepView['status'] }) {
  if (status === 'running') return <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />;
  if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'skipped') return <SkipForward className="w-3.5 h-3.5 text-amber-400" />;
  return <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;
}

function TraceCard({ trace }: { trace: LiveTrace }) {
  const [expanded, setExpanded] = useState(false);
  useElapsed(trace.status === 'running');

  const steps = useMemo(() => buildSteps(trace.events), [trace.events]);
  const thoughts = useMemo(
    () => trace.events.filter((e) => e.type === 'thought'),
    [trace.events]
  );
  const end = useMemo(
    () => trace.events.find((e) => e.type === 'run_end'),
    [trace.events]
  );
  const simulated =
    (end?.type === 'run_end' && end.simulated) || steps.some((s) => s.simulated);

  return (
    <div
      className={`p-4 rounded-xl bg-slate-950/70 border space-y-3 transition-all ${
        trace.status === 'running'
          ? 'border-amber-500/40 shadow-md shadow-amber-500/10'
          : 'border-white/10 hover:border-white/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-2xl">{trace.targetAvatar}</span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-100 truncate">{trace.targetName}</div>
            <div className="text-[10px] text-indigo-400 font-mono flex items-center gap-1">
              {trace.targetKind === 'workflow' ? (
                <>
                  <Layers className="w-3 h-3" /> Workflow
                  {trace.totalSteps ? ` · ${trace.totalSteps} pasos` : ''}
                </>
              ) : (
                <>
                  <Activity className="w-3 h-3" /> Agente
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <SourceBadge trace={trace} />
          {simulated && (
            <span className={`${BADGE} bg-amber-500/20 text-amber-300 border border-amber-500/40`}>
              <FlaskConical className="w-3 h-3" /> SIMULADO
            </span>
          )}
          <StatusBadge trace={trace} />
          <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(trace.startedAt, trace.endedAt)}
          </span>
        </div>
      </div>

      <p className="text-[11px] font-mono text-slate-400 bg-slate-900/70 rounded-lg p-2.5 whitespace-pre-wrap break-words line-clamp-3">
        {trace.prompt || '(sin texto)'}
      </p>

      {steps.length > 0 && (
        <div className="space-y-1.5">
          {steps.map((step) => (
            <div
              key={step.index}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] ${stepClasses(step.status)}`}
            >
              <StepIcon status={step.status} />
              <span className="font-mono text-[10px] text-indigo-300 shrink-0">
                {step.index + 1}.
              </span>
              <span className="shrink-0">{step.agentAvatar}</span>
              <span className="text-slate-200 truncate">{step.stepName}</span>
              <span className="text-slate-500 truncate hidden sm:inline">· {step.agentName}</span>
              <span className="ml-auto shrink-0 text-[10px] font-mono text-slate-400 flex items-center gap-2">
                {step.tokens !== undefined && (
                  <span className="flex items-center gap-1">
                    <Cpu className="w-3 h-3" />
                    {step.tokens}
                  </span>
                )}
                {step.latencyMs !== undefined && <span>{(step.latencyMs / 1000).toFixed(1)} s</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {(thoughts.length > 0 || end) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {expanded ? 'Ocultar detalle' : `Ver detalle (${thoughts.length} pasos de razonamiento)`}
        </button>
      )}

      {expanded && (
        <div className="space-y-1.5 border-t border-white/10 pt-2.5">
          {thoughts.map((event) =>
            event.type === 'thought' ? (
              <div
                key={event.seq}
                className="text-[11px] text-slate-400 bg-slate-900/60 rounded-lg px-2.5 py-1.5 whitespace-pre-wrap break-words"
              >
                <span className="text-[9px] font-mono text-indigo-400 mr-2 uppercase">
                  {event.step.type}
                </span>
                {event.step.content}
              </div>
            ) : null
          )}
          {trace.droppedEvents > 0 && (
            <p className="text-[10px] text-amber-400">
              Se descartaron {trace.droppedEvents} eventos por volumen.
            </p>
          )}
        </div>
      )}

      {end?.type === 'run_end' && end.finalOutput && (
        <div className="border-t border-white/10 pt-2.5">
          <div className="text-[10px] font-semibold text-slate-400 mb-1">Salida final</div>
          <p className="text-[11px] text-slate-300 whitespace-pre-wrap break-words">
            {end.finalOutput}
          </p>
        </div>
      )}
    </div>
  );
}

const CONNECTION_LABEL: Record<LiveConnectionState, string> = {
  idle: 'Desconectado',
  connecting: 'Conectando…',
  open: 'Conectado',
  reconnecting: 'Reconectando…',
};

export const LiveMonitor: React.FC = () => {
  const snapshot = useSyncExternalStore(
    liveStore.subscribe,
    liveStore.getSnapshot,
    liveStore.getServerSnapshot
  );

  const running = snapshot.traces.filter((t) => t.status === 'running').length;

  return (
    <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <Radio className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">Monitor en vivo</h2>
            <p className="text-[11px] text-slate-400">
              Peticiones atravesando el arnés ahora mismo. No se guarda nada: el historial completo
              está en la pestaña Historial.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`${BADGE} ${
              snapshot.connection === 'open'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
            }`}
          >
            {snapshot.connection === 'open' ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            {CONNECTION_LABEL[snapshot.connection]}
          </span>
          {running > 0 && (
            <span className={`${BADGE} bg-amber-500/20 text-amber-300 border border-amber-500/40`}>
              <Clock className="w-3 h-3 animate-spin" /> {running} en curso
            </span>
          )}
          <button
            onClick={liveStore.clear}
            disabled={snapshot.traces.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Limpiar
          </button>
        </div>
      </div>

      {snapshot.traces.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-400 border border-dashed border-white/10 rounded-xl">
          Nada en marcha. Escribe a un bot de Telegram o lanza una ejecución desde el workbench y
          aparecerá aquí al instante.
        </div>
      ) : (
        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
          {snapshot.traces.map((trace) => (
            <TraceCard key={trace.traceId} trace={trace} />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Mantiene abierto el `EventSource` mientras la app esté montada, sin renderizar
 * nada ni provocar renders en el componente que lo hospeda. Va en `page.tsx`
 * para que el monitor siga recogiendo eventos aunque estés en otra pestaña.
 */
export const LiveMonitorConnection: React.FC = () => {
  useEffect(() => liveStore.acquire(), []);
  return null;
};
