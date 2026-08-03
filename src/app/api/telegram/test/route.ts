import { NextRequest, NextResponse } from 'next/server';
import { processTelegramAgentRequest, sendTelegramMessage } from '@/lib/telegramService';
import { AgentConfig } from '@/types/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agent, prompt, chatId, botToken, apiKey } = body as {
      agent: AgentConfig;
      prompt: string;
      chatId: string;
      botToken: string;
      apiKey?: string;
    };

    if (!agent || !prompt || !chatId || !botToken) {
      return NextResponse.json(
        { error: 'Agente, prompt, chatId y botToken son requeridos' },
        { status: 400 }
      );
    }

    const runResult = await processTelegramAgentRequest({
      agent,
      userPrompt: prompt,
      chatId,
      apiKey,
      botToken,
    });

    return NextResponse.json({
      success: true,
      runResult,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error al enviar mensaje de prueba a Telegram.' },
      { status: 500 }
    );
  }
}
