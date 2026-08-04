import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramToken } from '@/lib/telegramService';
import { errorMessage } from '@/lib/errors';

export async function POST(req: NextRequest) {
  try {
    const { botToken } = (await req.json()) as { botToken?: string };

    if (!botToken) {
      return NextResponse.json({ error: 'Bot Token es requerido' }, { status: 400 });
    }

    const botInfo = await verifyTelegramToken(botToken);

    return NextResponse.json({ success: true, botInfo });
  } catch (err) {
    return NextResponse.json(
      { error: errorMessage(err, 'No se pudo conectar con Telegram.') },
      { status: 400 }
    );
  }
}
