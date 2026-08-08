import { NextRequest, NextResponse } from 'next/server';
import {
  appendConversationTurn,
  getConversationMessages,
  resetConversation,
} from '@/lib/serverStorage';
import { errorMessage } from '@/lib/errors';
import type { ConversationMessage } from '@/types/conversation';

/**
 * Hilos de conversación para el navegador. El workbench ejecuta el motor en el
 * cliente, así que necesita leer y escribir el hilo por HTTP; en el servidor
 * (Telegram) se llaman directamente los helpers de `serverStorage`.
 */

/**
 * `::` es el separador de la clave compuesta `${agentId}::${threadKey}`, así que
 * aceptarlo dentro del threadKey permitiría falsificar la clave de otro hilo.
 */
function readParams(req: NextRequest): { agentId: string; threadKey: string } | null {
  const params = new URL(req.url).searchParams;
  const agentId = params.get('agentId')?.trim();
  const threadKey = params.get('threadKey')?.trim();

  if (!agentId || !threadKey) return null;
  if (agentId.includes('::') || threadKey.includes('::')) return null;

  return { agentId, threadKey };
}

export async function GET(req: NextRequest) {
  try {
    const params = readParams(req);
    if (!params) {
      return NextResponse.json(
        { success: false, error: 'Faltan agentId y threadKey, o contienen "::".' },
        { status: 400 }
      );
    }

    const messages = await getConversationMessages(params.agentId, params.threadKey);
    return NextResponse.json({ success: true, messages });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      agentId?: string;
      threadKey?: string;
      user?: ConversationMessage;
      assistant?: ConversationMessage;
    };

    const agentId = body.agentId?.trim();
    const threadKey = body.threadKey?.trim();

    if (!agentId || !threadKey || agentId.includes('::') || threadKey.includes('::')) {
      return NextResponse.json(
        { success: false, error: 'Faltan agentId y threadKey, o contienen "::".' },
        { status: 400 }
      );
    }

    if (!body.user || body.user.role !== 'user' || typeof body.user.content !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Falta el mensaje de usuario del turno.' },
        { status: 400 }
      );
    }

    const messages = await appendConversationTurn(agentId, threadKey, {
      user: body.user,
      assistant: body.assistant,
    });

    return NextResponse.json({ success: true, messages });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const params = readParams(req);
    if (!params) {
      return NextResponse.json(
        { success: false, error: 'Faltan agentId y threadKey, o contienen "::".' },
        { status: 400 }
      );
    }

    const existed = await resetConversation(params.agentId, params.threadKey);
    return NextResponse.json({ success: true, existed, messages: [] });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
