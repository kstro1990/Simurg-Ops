'use client';

import React, { useMemo, useState } from 'react';
import { ExecutionRun } from '@/types/agent';
import {
  History,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Download,
  Search,
  Send,
  Monitor,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Clock,
} from 'lucide-react';
import { Markdown } from './Markdown';

interface HistoryModalProps {
  runs: ExecutionRun[];
  onClearHistory: () => void;
}

type StatusFilter = 'all' | 'completed' | 'failed' | 'simulated';

/** Los runs antiguos guardaban solo la hora (`toLocaleTimeString`). */
function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export const HistoryModal: React.FC<HistoryModalProps> = ({ runs, onClearHistory }) => {
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const agentNames = useMemo(
    () => Array.from(new Set(runs.map((r) => r.agentName))).sort(),
    [runs]
  );

  const filteredRuns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (agentFilter !== 'all' && run.agentName !== agentFilter) return false;
      if (statusFilter === 'simulated' && !run.simulated) return false;
      if (statusFilter === 'completed' && run.status !== 'completed') return false;
      if (statusFilter === 'failed' && run.status !== 'failed') return false;
      if (!q) return true;
      return (
        run.prompt.toLowerCase().includes(q) ||
        run.finalOutput.toLowerCase().includes(q) ||
        run.agentName.toLowerCase().includes(q)
      );
    });
  }, [runs, query, agentFilter, statusFilter]);

  const handleExport = (format: 'json' | 'markdown') => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    let content: string;
    let mime: string;
    let extension: string;

    if (format === 'json') {
      content = JSON.stringify(filteredRuns, null, 2);
      mime = 'application/json';
      extension = 'json';
    } else {
      content = filteredRuns
        .map(
          (run) =>
            `## ${run.agentAvatar} ${run.agentName} — ${formatTimestamp(run.timestamp)}\n\n` +
            `- Estado: ${run.status}${run.simulated ? ' (SIMULADO)' : ''}\n` +
            `- Origen: ${run.source ?? 'web'}\n` +
            (run.metrics ? `- Tokens: ${run.metrics.totalTokens}\n` : '') +
            `\n**Prompt:**\n\n${run.prompt}\n\n**Respuesta:**\n\n${run.finalOutput}\n`
        )
        .join('\n---\n\n');
      mime = 'text/markdown';
      extension = 'md';
    }

    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `historial-agentes-${stamp}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    if (
      window.confirm(
        `¿Borrar las ${runs.length} ejecuciones del historial? Esta acción no se puede deshacer.`
      )
    ) {
      onClearHistory();
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-6 border border-white/10 space-y-4">
      <div className="flex items-start justify-between border-b border-white/10 pb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <History className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-100">
              Historial de Ejecuciones de Agentes
            </h2>
            <p className="text-xs text-slate-400">
              {runs.length} ejecuciones registradas
              {filteredRuns.length !== runs.length && ` · ${filteredRuns.length} tras filtrar`}
            </p>
          </div>
        </div>

        {runs.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExport('json')}
              className="flex items-center gap-1 text-xs text-slate-300 hover:text-white bg-slate-900 px-3 py-1.5 rounded-lg border border-white/10"
            >
              <Download className="w-3.5 h-3.5" /> JSON
            </button>
            <button
              onClick={() => handleExport('markdown')}
              className="flex items-center gap-1 text-xs text-slate-300 hover:text-white bg-slate-900 px-3 py-1.5 rounded-lg border border-white/10"
            >
              <Download className="w-3.5 h-3.5" /> Markdown
            </button>
            <button
              onClick={handleClear}
              className="text-xs text-rose-400 hover:text-rose-300 bg-rose-500/10 px-3 py-1.5 rounded-lg border border-rose-500/20"
            >
              Limpiar
            </button>
          </div>
        )}
      </div>

      {runs.length > 0 && (
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar en prompts y respuestas..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl glass-input text-xs"
            />
          </div>
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="px-3 py-2 rounded-xl glass-input text-xs"
            aria-label="Filtrar por agente"
          >
            <option value="all">Todos los agentes</option>
            {agentNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-2 rounded-xl glass-input text-xs"
            aria-label="Filtrar por estado"
          >
            <option value="all">Cualquier estado</option>
            <option value="completed">Completadas</option>
            <option value="failed">Fallidas</option>
            <option value="simulated">Simuladas</option>
          </select>
        </div>
      )}

      {filteredRuns.length > 0 ? (
        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
          {filteredRuns.map((run) => {
            const isExpanded = expandedId === run.id;
            return (
              <div
                key={run.id}
                className="p-4 rounded-xl bg-slate-950/70 border border-white/10 space-y-2 hover:border-white/20 transition-all"
              >
                <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg">{run.agentAvatar}</span>
                    <span className="font-bold text-slate-200">{run.agentName}</span>
                    <span className="text-[10px] text-indigo-400 font-mono">({run.agentRole})</span>

                    {run.status === 'failed' ? (
                      <span className="px-2 py-0.5 text-[9px] font-semibold rounded-full flex items-center gap-1 bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        <AlertCircle className="w-3 h-3" /> Fallida
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[9px] font-semibold rounded-full flex items-center gap-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" /> Completada
                      </span>
                    )}

                    {run.simulated && (
                      <span className="px-2 py-0.5 text-[9px] font-semibold rounded-full flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        <FlaskConical className="w-3 h-3" /> Simulada
                      </span>
                    )}

                    <span className="px-2 py-0.5 text-[9px] font-semibold rounded-full flex items-center gap-1 bg-slate-800 text-slate-300 border border-white/10">
                      {run.source === 'telegram' ? (
                        <>
                          <Send className="w-3 h-3 text-cyan-400" /> Telegram
                          {run.telegramChatId ? ` · ${run.telegramChatId}` : ''}
                        </>
                      ) : (
                        <>
                          <Monitor className="w-3 h-3 text-indigo-400" /> Web
                        </>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTimestamp(run.timestamp)}
                    </span>
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

                <button
                  onClick={() => setExpandedId(isExpanded ? null : run.id)}
                  className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  {isExpanded ? 'Ocultar respuesta completa' : 'Ver respuesta completa'}
                </button>

                {isExpanded ? (
                  <Markdown className="text-slate-300 pt-1">{run.finalOutput}</Markdown>
                ) : (
                  <div className="text-xs text-slate-400 pt-1 line-clamp-3 whitespace-pre-wrap">
                    {run.finalOutput}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-12 text-center text-xs text-slate-400 border border-dashed border-white/10 rounded-xl">
          {runs.length === 0
            ? 'Aún no hay ejecuciones registradas en el historial.'
            : 'Ninguna ejecución coincide con los filtros aplicados.'}
        </div>
      )}
    </div>
  );
};
