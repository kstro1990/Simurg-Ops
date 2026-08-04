import { NextRequest, NextResponse } from 'next/server';
import { processTelegramAgentRequest } from '@/lib/telegramService';
import { addHistoryRun, getStoredSettings } from '@/lib/serverStorage';
import { AgentConfig, ProviderKeys } from '@/types/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agent, prompt, chatId, botToken, apiKey, providerKeys } = body as {
      agent: AgentConfig;
      prompt: string;
      chatId: string;
      botToken: string;
      apiKey?: string;
      providerKeys?: ProviderKeys;
    };

    if (!agent || !prompt || !chatId || !botToken) {
      return NextResponse.json(
        { error: 'Agente, prompt, chatId y botToken son requeridos' },
        { status: 400 }
      );
    }

    const storedKeys = await getStoredSettings();

    const runResult = await processTelegramAgentRequest({
      agent,
      userPrompt: prompt,
      chatId,
      apiKey,
      providerKeys: { ...storedKeys, ...(providerKeys || {}) },
      botToken,
    });

    await addHistoryRun(runResult);

    return NextResponse.json({
      success: runResult.status === 'completed',
      simulated: runResult.simulated ?? false,
      error: runResult.status === 'failed' ? runResult.finalOutput : undefined,
      runResult,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Error al enviar mensaje de prueba a Telegram.',
      },
      { status: 500 }
    );
  }
}
