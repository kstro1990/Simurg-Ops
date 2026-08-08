import { NextRequest, NextResponse } from 'next/server';
import { processTelegramAgentRequest } from '@/lib/telegramService';
import { addHistoryRun, getStoredAgents, getStoredSettings } from '@/lib/serverStorage';

/**
 * Recibe updates de Telegram por webhook.
 *
 * Configúralo con `?agentId=<id>` — el token y las claves se leen del estado
 * del servidor, nunca de la query string (una API key en la URL acaba en logs
 * de acceso, proxies y referers).
 *
 * Si defines TELEGRAM_WEBHOOK_SECRET, se exige la cabecera
 * `X-Telegram-Bot-Api-Secret-Token` que Telegram envía cuando registras el
 * webhook con `secret_token`. Sin ella, cualquiera que alcance el puerto puede
 * hacer que el agente gaste tokens.
 */
export async function POST(req: NextRequest) {
  try {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret) {
      const received = req.headers.get('x-telegram-bot-api-secret-token');
      if (received !== expectedSecret) {
        return NextResponse.json({ error: 'Secret token inválido.' }, { status: 401 });
      }
    }

    const body = await req.json();
    const message = body.message || body.edited_message;
    if (!message?.text) {
      return NextResponse.json({ ok: true, status: 'Mensaje sin texto, ignorado.' });
    }

    const agentId = new URL(req.url).searchParams.get('agentId');
    if (!agentId) {
      return NextResponse.json(
        { error: 'El webhook requiere el query param agentId.' },
        { status: 400 }
      );
    }

    const agents = await getStoredAgents();
    const agent = agents.find((a) => a.id === agentId);

    if (!agent) {
      return NextResponse.json({ error: `Agente ${agentId} no encontrado.` }, { status: 404 });
    }

    const botToken = agent.telegramConfig?.botToken;
    if (!agent.telegramConfig?.enabled || !botToken) {
      return NextResponse.json(
        { error: `El agente ${agent.name} no está enrolado en Telegram.` },
        { status: 409 }
      );
    }

    const settings = await getStoredSettings();

    const run = await processTelegramAgentRequest({
      agent,
      userPrompt: message.text,
      chatId: message.chat.id,
      apiKey: settings.geminiApiKey,
      providerKeys: settings,
      botToken,
    });

    // `null` = era un comando (/nuevo, /ayuda): no hubo ejecución que registrar.
    if (!run) {
      return NextResponse.json({ ok: true, command: true });
    }

    await addHistoryRun(run);

    return NextResponse.json({ ok: true, runId: run.id, simulated: run.simulated ?? false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error procesando el update de Telegram.' },
      { status: 500 }
    );
  }
}
