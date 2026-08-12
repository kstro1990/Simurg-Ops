import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramToken } from '@/lib/telegramService';
import { findTelegramTokenOwner, TelegramOwnerKind } from '@/lib/serverStorage';
import { errorMessage } from '@/lib/errors';

export async function POST(req: NextRequest) {
  try {
    const { botToken, ownerKind, ownerId } = (await req.json()) as {
      botToken?: string;
      /** Quién pretende quedarse el token; permite excluirse a sí mismo. */
      ownerKind?: TelegramOwnerKind;
      ownerId?: string;
    };

    if (!botToken) {
      return NextResponse.json({ error: 'Bot Token es requerido' }, { status: 400 });
    }

    // `getUpdates` es exclusivo por token: si el mismo bot quedara enrolado en
    // dos sitios, ambos sondearían y se robarían los mensajes entre sí.
    const owner = await findTelegramTokenOwner(
      botToken,
      ownerKind && ownerId ? { kind: ownerKind, id: ownerId } : undefined
    );

    if (owner) {
      return NextResponse.json(
        {
          error: `Ese bot ya está enrolado en ${owner.kind === 'workflow' ? 'el workflow' : 'el agente'} "${owner.name}". Un token solo puede pertenecer a uno: si se comparte, ambos se roban los mensajes.`,
          conflict: owner,
        },
        { status: 409 }
      );
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
