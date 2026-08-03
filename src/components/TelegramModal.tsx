import React, { useState, useEffect } from 'react';
import { AgentConfig, TelegramConfig } from '@/types/agent';
import { Send, X, CheckCircle2, ExternalLink, ShieldCheck, RefreshCw, Bot, MessageSquare, AlertCircle } from 'lucide-react';

interface TelegramModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: AgentConfig | null;
  apiKey?: string;
  onSaveTelegramConfig: (agentId: string, config: TelegramConfig) => void;
}

export const TelegramModal: React.FC<TelegramModalProps> = ({
  isOpen,
  onClose,
  agent,
  apiKey,
  onSaveTelegramConfig,
}) => {
  const [botToken, setBotToken] = useState('');
  const [botInfo, setBotInfo] = useState<{ username: string; firstName: string } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Test message state
  const [testChatId, setTestChatId] = useState('');
  const [testPrompt, setTestPrompt] = useState('Hola agente, ¿cuál es tu rol y capacidades?');
  const [isSendingTest, setIsSendingTest] = useState(false);

  useEffect(() => {
    if (agent?.telegramConfig) {
      setBotToken(agent.telegramConfig.botToken || '');
      if (agent.telegramConfig.botUsername) {
        setBotInfo({
          username: agent.telegramConfig.botUsername,
          firstName: agent.telegramConfig.botFirstName || agent.name,
        });
      } else {
        setBotInfo(null);
      }
    } else {
      setBotToken('');
      setBotInfo(null);
    }
    setErrorMsg('');
    setSuccessMsg('');
  }, [agent, isOpen]);

  if (!isOpen || !agent) return null;

  const handleVerifyToken = async () => {
    if (!botToken.trim()) {
      setErrorMsg('Ingresa un Bot Token válido.');
      return;
    }

    setIsVerifying(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch('/api/telegram/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: botToken.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Token inválido.');
      }

      setBotInfo({
        username: data.botInfo.username,
        firstName: data.botInfo.first_name,
      });

      setSuccessMsg(`Bot verificado exitosamente: @${data.botInfo.username}`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error de conexión con Telegram.');
      setBotInfo(null);
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
          agent,
          prompt: testPrompt,
          chatId: testChatId.trim(),
          botToken: botToken.trim(),
          apiKey,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falló el envío del mensaje.');
      }

      setSuccessMsg('¡Mensaje enviado a Telegram con éxito! Revisa tu chat.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al enviar mensaje a Telegram.');
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleSaveAndEnroll = () => {
    if (!botToken.trim()) {
      onSaveTelegramConfig(agent.id, {
        enabled: false,
        status: 'disconnected',
      });
    } else {
      onSaveTelegramConfig(agent.id, {
        enabled: true,
        botToken: botToken.trim(),
        botUsername: botInfo?.username || '',
        botFirstName: botInfo?.firstName || agent.name,
        status: 'connected',
        lastActive: new Date().toLocaleTimeString(),
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-xl">
              <Send className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                Enrolar Agente en Telegram
                <span className="text-xs text-indigo-400 font-normal">({agent.name})</span>
              </h2>
              <p className="text-xs text-slate-400">Conecta un Bot de Telegram autónomo a este agente</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Step 1: Create Bot Info */}
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-white/5 space-y-1.5 text-xs">
            <div className="font-bold text-cyan-400 flex items-center gap-1.5">
              <Bot className="w-4 h-4" /> Paso 1: Crea tu Bot en Telegram
            </div>
            <p className="text-slate-300">
              Abre Telegram y busca a <strong className="text-white">@BotFather</strong>. Envía el comando <code className="bg-slate-950 px-1.5 py-0.5 rounded text-indigo-300">/newbot</code> y sigue las instrucciones para obtener tu Token HTTP API.
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

          {/* Step 2: Token Input & Verify */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Paso 2: Pega el Telegram Bot Token
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="123456789:ABCdefGHIjklmno..."
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                className="flex-1 px-3.5 py-2 rounded-xl glass-input text-xs font-mono"
              />
              <button
                type="button"
                onClick={handleVerifyToken}
                disabled={isVerifying || !botToken.trim()}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md flex items-center gap-1.5"
              >
                {isVerifying && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Verificar Token
              </button>
            </div>
          </div>

          {/* Bot Status Banner */}
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
                Bot Conectado
              </span>
            </div>
          )}

          {/* Error / Success Feedback */}
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

          {/* Step 3: Test Interactive Messaging */}
          {botToken.trim() && (
            <div className="pt-3 border-t border-white/10 space-y-3">
              <label className="block text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-cyan-400" /> Paso 3: Probar Envío de Mensaje a Telegram
              </label>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-5">
                  <label className="block text-[11px] text-slate-400 mb-1">Tu Chat ID de Telegram</label>
                  <input
                    type="text"
                    placeholder="Ej: 123456789"
                    value={testChatId}
                    onChange={(e) => setTestChatId(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl glass-input text-xs font-mono"
                  />
                  <span className="text-[9px] text-slate-400">
                    (Obtenlo escribiendo a <strong className="text-slate-300">@userinfobot</strong> en Telegram)
                  </span>
                </div>

                <div className="md:col-span-7">
                  <label className="block text-[11px] text-slate-400 mb-1">Mensaje de Prueba</label>
                  <input
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
                className="w-full py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md flex items-center justify-center gap-2"
              >
                {isSendingTest ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Procesando con Agente y enviando a Telegram...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" /> Enviar Prueba Interactiva a Telegram
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-white/10 bg-slate-950/40">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-white/10"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveAndEnroll}
            className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-cyan-500 hover:brightness-110 shadow-lg shadow-indigo-600/20"
          >
            Guardar y Guardar Enrolamiento
          </button>
        </div>
      </div>
    </div>
  );
};
