import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramToken } from '@/lib/telegramService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { botToken } = body as { botToken: string };

    if (!botToken) {
      return NextResponse.json({ error: 'Bot Token es requerido' }, { status: 400 });
    }

    const botInfo = await verifyTelegramToken(botToken);

    return NextResponse.json({
      success: true,
      botInfo,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'No se pudo conectar con Telegram.' },
      { status: 400 }
    );
  }
}
