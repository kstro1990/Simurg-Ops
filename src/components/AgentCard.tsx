'use client';

import React from 'react';
import { AgentConfig } from '@/types/agent';
import { Play, Edit3, Trash2, Copy, Cpu, Wrench, Send } from 'lucide-react';
import { TOOLS } from '@/lib/tools';

interface AgentCardProps {
  agent: AgentConfig;
  onRun: (agent: AgentConfig) => void;
  onEdit: (agent: AgentConfig) => void;
  onClone: (agent: AgentConfig) => void;
  onDelete?: (agentId: string) => void;
  onOpenTelegramModal: (agent: AgentConfig) => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  onRun,
  onEdit,
  onClone,
  onDelete,
  onOpenTelegramModal,
}) => {
  const isTelegramConnected =
    agent.telegramConfig?.enabled && agent.telegramConfig?.status === 'connected';
  const botUsername = agent.telegramConfig?.botUsername;

  return (
    <div className="glass-panel glass-panel-hover rounded-2xl p-5 flex flex-col justify-between border border-white/10 relative overflow-hidden group">
      {/* Background Accent Glow */}
      <div className="absolute -top-12 -right-12 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/25 transition-all duration-500 pointer-events-none" />

      <div>
        {/* Header: Avatar, Name & Model Badge */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-center text-2xl shadow-inner group-hover:scale-105 transition-transform">
              {agent.avatar || '🤖'}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                {agent.name}
                {agent.isCustom && (
                  <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded">
                    Personalizado
                  </span>
                )}
              </h3>
              <p className="text-xs font-medium text-indigo-400">{agent.role}</p>
            </div>
          </div>

          <span className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono rounded-lg shadow-sm border ${
            agent.model.startsWith('claude-')
              ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
              : agent.model.startsWith('copilot-')
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : agent.model.startsWith('gpt-')
              ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
              : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
          }`}>
            <Cpu className="w-3 h-3" />
            {agent.model}
          </span>
        </div>

        {/* Telegram Status Badge */}
        {isTelegramConnected ? (
          <div className="mb-3 flex items-center justify-between px-3 py-1.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-xs">
            <span className="flex items-center gap-1.5 font-bold text-cyan-300">
              <Send className="w-3.5 h-3.5 text-cyan-400" />
              {botUsername ? `Telegram: @${botUsername}` : 'Telegram enrolado'}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              Activo
            </span>
          </div>
        ) : null}

        {/* Description */}
        <p className="text-xs text-slate-300 mb-4 line-clamp-2 leading-relaxed">
          {agent.description}
        </p>

        {/* Active Tools List */}
        <div className="mb-4">
          <div className="flex items-center gap-1 text-[11px] text-slate-400 font-medium mb-1.5">
            <Wrench className="w-3 h-3 text-slate-400" />
            <span>Herramientas Activas ({agent.tools.length}):</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.length > 0 ? (
              agent.tools.map((toolName) => {
                const toolDef = TOOLS[toolName];
                return (
                  <span
                    key={toolName}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-900/80 text-slate-300 border border-white/10"
                  >
                    <span>{toolDef?.icon || '⚙️'}</span>
                    <span>{toolDef?.displayName || toolName}</span>
                  </span>
                );
              })
            ) : (
              <span className="text-[10px] text-slate-400 italic">Sin herramientas asignadas</span>
            )}
          </div>
        </div>

        {/* Configuration Specs Footer */}
        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-2 border-t border-white/5 mb-4">
          <span>Temp: <strong className="text-slate-300">{agent.temperature}</strong></span>
          <span>Max Tokens: <strong className="text-slate-300">{agent.maxTokens}</strong></span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-2 pt-2">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => onRun(agent)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all active:scale-95"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Ejecutar Agente
          </button>

          <button
            onClick={() => onOpenTelegramModal(agent)}
            title="Enrolar Bot de Telegram"
            className={`p-2 rounded-xl border transition-all ${
              isTelegramConnected
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/30'
                : 'bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800 border-white/10'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onEdit(agent)}
              title="Editar Agente"
              className="p-2 rounded-lg bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800 border border-white/10 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => onClone(agent)}
              title="Duplicar Agente"
              className="p-2 rounded-lg bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800 border border-white/10 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>

            {agent.isCustom && onDelete && (
              <button
                onClick={() => onDelete(agent.id)}
                title="Eliminar Agente"
                className="p-2 rounded-lg bg-slate-900/80 text-rose-400 hover:text-rose-300 hover:bg-rose-500/20 border border-white/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
