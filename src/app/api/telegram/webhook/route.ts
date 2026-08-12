import { NextRequest, NextResponse } from 'next/server';
import {
  processTelegramAgentRequest,
  processTelegramWorkflowRequest,
} from '@/lib/telegramService';
import {
  addHistoryRun,
  getStoredAgents,
  getStoredSettings,
  getStoredWorkflows,
} from '@/lib/serverStorage';
import { indexAgents } from '@/lib/workflowEngine';

/**
 * Recibe updates de Telegram por webhook.
 *
 * Configúralo con `?agentId=<id>` o `?workflowId=<id>` — el token y las claves
 * se leen del estado del servidor, nunca de la query string (una API key en la
 * URL acaba en logs de acceso, proxies y referers).
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

    const params = new URL(req.url).searchParams;
    const agentId = params.get('agentId');
    const workflowId = params.get('workflowId');

    if (workflowId) {
      const workflows = await getStoredWorkflows();
      const workflow = workflows.find((w) => w.id === workflowId);

      if (!workflow) {
        return NextResponse.json({ error: `Workflow ${workflowId} no encontrado.` }, { status: 404 });
      }

      const botToken = workflow.telegramConfig?.botToken;
      if (!workflow.telegramConfig?.enabled || !botToken) {
        return NextResponse.json(
          { error: `El workflow ${workflow.name} no está enrolado en Telegram.` },
          { status: 409 }
        );
      }

      const [agents, settings] = await Promise.all([getStoredAgents(), getStoredSettings()]);

      // Se responde YA y el pipeline sigue por detrás. Una cadena de varios
      // pasos tarda minutos; si el webhook no contesta a tiempo Telegram
      // reintenta el update y el pipeline se ejecutaría dos veces. El harness
      // es un proceso largo (`next start`), así que desacoplar es viable: la
      // entrega al chat y el historial ocurren después de esta respuesta.
      void processTelegramWorkflowRequest({
        workflow,
        agents: indexAgents(agents),
        userPrompt: message.text,
        chatId: message.chat.id,
        apiKey: settings.geminiApiKey,
        providerKeys: settings,
        botToken,
      })
        .then(async (runs) => {
          for (const run of runs) await addHistoryRun(run);
        })
        .catch((err) => {
          console.error(`Error ejecutando el workflow ${workflow.name} desde el webhook:`, err);
        });

      return NextResponse.json({ ok: true, accepted: true, workflowId });
    }

    if (!agentId) {
      return NextResponse.json(
        { error: 'El webhook requiere el query param agentId o workflowId.' },
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
