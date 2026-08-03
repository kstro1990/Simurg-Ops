import React from 'react';
import { ExecutionRun } from '@/types/agent';
import { History, X, Clock, Cpu, CheckCircle2, AlertCircle, FileText } from 'lucide-react';

interface HistoryModalProps {
  runs: ExecutionRun[];
  onClearHistory: () => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({ runs, onClearHistory }) => {
  return (
    <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <History className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">Historial de Ejecuciones de Agentes</h2>
            <p className="text-xs text-slate-400">Registro de todas las ejecuciones, tokens consumidos y respuestas</p>
          </div>
        </div>

        {runs.length > 0 && (
          <button
            onClick={onClearHistory}
            className="text-xs text-rose-400 hover:text-rose-300 bg-rose-500/10 px-3 py-1.5 rounded-lg border border-rose-500/20"
          >
            Limpiar Historial
          </button>
        )}
      </div>

      {runs.length > 0 ? (
        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
          {runs.map((run) => (
            <div
              key={run.id}
              className="p-4 rounded-xl bg-slate-950/70 border border-white/10 space-y-2 hover:border-white/20 transition-all"
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{run.agentAvatar}</span>
                  <span className="font-bold text-slate-200">{run.agentName}</span>
                  <span className="text-[10px] text-indigo-400 font-mono">({run.agentRole})</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                  <span>{run.timestamp}</span>
                  {run.metrics && (
                    <span className="text-cyan-400 flex items-center gap-1">
                      <Cpu className="w-3 h-3" />
                      {run.metrics.totalTokens} tokens
                    </span>
                  )}
                </div>
              </div>

              <div className="text-xs text-slate-300 bg-slate-900/60 p-2.5 rounded-lg border border-white/5 font-mono">
                <span className="text-indigo-400 font-bold">Prompt: </span>
                {run.prompt}
              </div>

              <div className="text-xs text-slate-300 prose prose-invert max-w-none pt-2 line-clamp-3">
                {run.finalOutput}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-12 text-center text-xs text-slate-400 border border-dashed border-white/10 rounded-xl">
          Aún no hay ejecuciones registradas en el historial.
        </div>
      )}
    </div>
  );
};
