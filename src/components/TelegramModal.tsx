'use client';

import React, { useState } from 'react';
import { AgentConfig, ProviderKeys, TelegramConfig, WorkflowConfig } from '@/types/agent';
import {
  Send,
  X,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Bot,
  MessageSquare,
  AlertCircle,
} from 'lucide-react';

/**
 * Un agente o un workflow, vistos desde el enrolamiento en Telegram. Ambos
 * llevan un `telegramConfig` con la misma relación uno-a-uno con su bot, así
 * que el modal es el mismo y solo cambian las etiquetas y el cuerpo que manda
 * a `/api/telegram/test`.
 */
export interface TelegramTarget {
  kind: 'agent' | 'workflow';
  id: string;
  name: string;
  avatar: string;
  /** `agent.role` para agentes; "N pasos secuenciales" para workflows. */
  subtitle: string;
  telegramConfig?: TelegramConfig;
  /** Solo en agentes: el modal lo manda inline a la ruta de prueba. */
  agent?: AgentConfig;
}

export function agentTelegramTarget(agent: AgentConfig): TelegramTarget {
  return {
    kind: 'agent',
    id: agent.id,
    name: agent.name,
    avatar: agent.avatar,
    subtitle: agent.role,
    telegramConfig: agent.telegramConfig,
    agent,
  };
}

export function workflowTelegramTarget(workflow: WorkflowConfig): TelegramTarget {
  return {
    kind: 'workflow',
    id: workflow.id,
    name: workflow.name,
    avatar: '🔗',
    subtitle: `${workflow.steps.length} pasos secuenciales`,
    telegramConfig: workflow.telegramConfig,
  };
}

interface TelegramModalProps {
  onClose: () => void;
  target: TelegramTarget;
  apiKey?: string;
  providerKeys?: ProviderKeys;
  onSaveTelegramConfig: (targetId: string, config: TelegramConfig) => void;
}

export const TelegramModal: React.FC<TelegramModalProps> = ({
  onClose,
  target,
  apiKey,
  providerKeys,
  onSaveTelegramConfig,
}) => {
  const isWorkflow = target.kind === 'workflow';
  const [botToken, setBotToken] = useState(target.telegramConfig?.botToken ?? '');
  const [botInfo, setBotInfo] = useState<{ username: string; firstName: string } | null>(
    target.telegramConfig?.botUsername
      ? {
          username: target.telegramConfig.botUsername,
          firstName: target.telegramConfig.botFirstName || target.name,
        }
      : null
  );
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [testChatId, setTestChatId] = useState('');
  const [testPrompt, setTestPrompt] = useState(
    isWorkflow
      ? 'Prueba rápida: resume en dos frases para qué sirve esta cadena.'
      : 'Hola agente, ¿cuál es tu rol y capacidades?'
  );
  const [isSendingTest, setIsSendingTest] = useState(false);

  type BotInfo = { username: string; firstName: string };

  const handleVerifyToken = async (): Promise<BotInfo | null> => {
    if (!botToken.trim()) {
      setErrorMsg('Ingresa un Bot Token válido.');
      return null;
    }

    setIsVerifying(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/telegram/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ownerKind/ownerId permiten que el dueño actual se re-verifique sin
        // chocar consigo mismo; para cualquier otro el servidor responde 409.
        body: JSON.stringify({
          botToken: botToken.trim(),
          ownerKind: target.kind,
          ownerId: target.id,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Token inválido.');
      }

      const info: BotInfo = {
        username: data.botInfo.username,
        firstName: data.botInfo.first_name,
      };
      setBotInfo(info);
      setSuccessMsg(`Bot verificado: @${data.botInfo.username}`);
      return info;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error de conexión con Telegram.');
      setBotInfo(null);
      return null;
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSendTestMessage = async () => {
    if (!botToken.trim() || !testChatId.trim()) {
      setErrorMsg('Ingresa el Bot Token y un Chat ID de Telegram válido.');
      return;
    }

    setIsSendingTest(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // El workflow se resuelve en el servidor por id; el agente va inline
          // para poder probar cambios aún sin guardar.
          ...(isWorkflow ? { workflowId: target.id } : { agent: target.agent }),
          prompt: testPrompt,
          chatId: testChatId.trim(),
          botToken: botToken.trim(),
          apiKey,
          // Sin esto, probar un agente Claude/OpenAI iba sin la credencial de su
          // proveedor y siempre acababa en el simulador.
          providerKeys,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falló el envío del mensaje.');
      }

      setSuccessMsg(
        data.simulated
          ? '⚠️ Mensaje enviado, pero la respuesta fue SIMULADA: revisa la clave del proveedor.'
          : '¡Mensaje enviado a Telegram con éxito! Revisa tu chat.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al enviar mensaje a Telegram.');
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleUnenroll = () => {
    onSaveTelegramConfig(target.id, { enabled: false, status: 'disconnected' });
    onClose();
  };

  const handleSaveAndEnroll = async () => {
    if (!botToken.trim()) {
      handleUnenroll();
      return;
    }

    // Antes se marcaba 'connected' con solo tener texto en el campo, así que la
    // tarjeta mostraba "@" vacío y un bot inexistente aparecía como conectado.
    // Si el token no está verificado, se verifica ahora y se aborta si falla.
    const info = botInfo ?? (await handleVerifyToken());
    if (!info) return;

    onSaveTelegramConfig(target.id, {
      enabled: true,
      botToken: botToken.trim(),
      botUsername: info.username,
      botFirstName: info.firstName || target.name,
      status: 'connected',
      lastActive: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
              <Send className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                {isWorkflow ? 'Enrolar Workflow en Telegram' : 'Enrolar Agente en Telegram'}
                <span className="text-xs text-indigo-400 font-normal">
                  ({target.avatar} {target.name})
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {isWorkflow
                  ? `Cada mensaje ejecutará la cadena completa · ${target.subtitle}`
                  : 'Conecta un Bot de Telegram autónomo a este agente'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-white/5 space-y-1.5 text-xs">
            <div className="font-bold text-cyan-400 flex items-center gap-1.5">
              <Bot className="w-4 h-4" /> Paso 1: Crea tu Bot en Telegram
            </div>
            <p className="text-slate-300">
              Abre Telegram y busca a <strong className="text-white">@BotFather</strong>. Envía el
              comando{' '}
              <code className="bg-slate-950 px-1.5 py-0.5 rounded text-indigo-300">/newbot</code> y
              sigue las instrucciones para obtener tu Token HTTP API.
            </p>
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-cyan-400 hover:underline font-semibold"
            >
              Abrir BotFather en Telegram <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div>
            <label htmlFor="tg-token" className="block text-xs font-semibold text-slate-300 mb-1.5">
              Paso 2: Pega el Telegram Bot Token
            </label>
            <div className="flex gap-2">
              <input
                id="tg-token"
                type="password"
                placeholder="123456789:ABCdefGHIjklmno..."
                value={botToken}
                onChange={(e) => {
                  setBotToken(e.target.value);
                  setBotInfo(null);
                  setSuccessMsg('');
                }}
                className="flex-1 px-3.5 py-2 rounded-xl glass-input text-xs font-mono"
              />
              <button
                type="button"
                onClick={handleVerifyToken}
                disabled={isVerifying || !botToken.trim()}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-400 text-white text-xs font-bold shadow-md flex items-center gap-1.5"
              >
                {isVerifying && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Verificar Token
              </button>
            </div>
          </div>

          {botInfo && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <div className="font-bold text-slate-100">{botInfo.firstName}</div>
                  <div className="text-[11px] text-cyan-400 font-mono">@{botInfo.username}</div>
                </div>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/40">
                Bot verificado
              </span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/20 text-rose-300 text-xs border border-rose-500/30 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-300 text-xs border border-emerald-500/30 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              {successMsg}
            </div>
          )}

          {botToken.trim() && (
            <div className="pt-3 border-t border-white/10 space-y-3">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-cyan-400" /> Paso 3: Probar envío de mensaje
              </span>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-5">
                  <label htmlFor="tg-chat-id" className="block text-[11px] text-slate-400 mb-1">
                    Tu Chat ID de Telegram
                  </label>
                  <input
                    id="tg-chat-id"
                    type="text"
                    placeholder="Ej: 123456789"
                    value={testChatId}
                    onChange={(e) => setTestChatId(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl glass-input text-xs font-mono"
                  />
                  <span className="text-[9px] text-slate-400">
                    (Obtenlo escribiendo a <strong className="text-slate-300">@userinfobot</strong>{' '}
                    en Telegram)
                  </span>
                </div>

                <div className="md:col-span-7">
                  <label htmlFor="tg-test-prompt" className="block text-[11px] text-slate-400 mb-1">
                    Mensaje de prueba
                  </label>
                  <input
                    id="tg-test-prompt"
                    type="text"
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl glass-input text-xs"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleSendTestMessage}
                disabled={isSendingTest || !testChatId.trim()}
                className="w-full py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-400 text-white text-xs font-bold shadow-md flex items-center justify-center gap-2"
              >
                {isSendingTest ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Procesando y enviando...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" /> Enviar prueba interactiva
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 px-6 py-4 border-t border-white/10 bg-slate-950/40">
          {target.telegramConfig?.enabled ? (
            <button
              onClick={handleUnenroll}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-rose-400 hover:text-rose-300 bg-slate-900 border border-rose-500/30"
            >
              Desenrolar
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-white/10"
            >
              Cancelar
            </button>
            <button
              onClick={handleSaveAndEnroll}
              disabled={isVerifying}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-cyan-500 hover:brightness-110 disabled:opacity-60 shadow-lg shadow-indigo-600/20"
            >
              Guardar enrolamiento
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
