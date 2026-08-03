import { NextRequest, NextResponse } from 'next/server';
import { processTelegramAgentRequest } from '@/lib/telegramService';
import { AgentConfig } from '@/types/agent';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Telegram Update Structure
    const message = body.message || body.edited_message;
    if (!message || !message.text) {
      return NextResponse.json({ ok: true, status: 'Ignored non-text message' });
    }

    const chatId = message.chat.id;
    const userText = message.text;

    // Check query params for agent context
    const url = new URL(req.url);
    const botTokenParam = url.searchParams.get('token');
    const agentIdParam = url.searchParams.get('agentId');

    if (!botTokenParam || !agentIdParam) {
      return NextResponse.json(
        { error: 'Webhook requiere query params token y agentId' },
        { status: 400 }
      );
    }

    // Dummy minimal agent config if not fully passed
    const minimalAgent: AgentConfig = {
      id: agentIdParam,
      name: 'Telegram Agent',
      role: 'Autonomous Agent',
      description: 'Agent receiving Telegram updates',
      avatar: '🤖',
      model: 'gemini-2.5-flash',
      systemPrompt: 'Eres un agente autónomo de IA en Telegram.',
      temperature: 0.3,
      maxTokens: 2048,
      tools: ['web_search'],
      createdAt: new Date().toISOString(),
    };

    const apiKeyParam = url.searchParams.get('apiKey') || process.env.GEMINI_API_KEY || '';

    // Process update asynchronously
    const run = await processTelegramAgentRequest({
      agent: minimalAgent,
      userPrompt: userText,
      chatId,
      apiKey: apiKeyParam,
      botToken: botTokenParam,
    });

    return NextResponse.json({
      ok: true,
      status: 'Message processed and sent to Telegram',
      runId: run.id,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Error processing Telegram update' }, { status: 500 });
  }
}
