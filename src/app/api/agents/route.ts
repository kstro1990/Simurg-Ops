import { NextRequest, NextResponse } from 'next/server';
import {
  getStoredAgents,
  saveOrUpdateAgent,
  deleteStoredAgent,
  saveStoredAgents,
} from '@/lib/serverStorage';
import { errorMessage } from '@/lib/errors';

export async function GET() {
  try {
    const agents = await getStoredAgents();
    return NextResponse.json({ success: true, agents });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (Array.isArray(body)) {
      await saveStoredAgents(body);
      return NextResponse.json({ success: true, agents: body });
    }
    const updatedAgents = await saveOrUpdateAgent(body);
    return NextResponse.json({ success: true, agents: updatedAgents });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const agentId = new URL(req.url).searchParams.get('id');
    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'Se requiere el query param id.' },
        { status: 400 }
      );
    }
    const updatedAgents = await deleteStoredAgent(agentId);
    return NextResponse.json({ success: true, agents: updatedAgents });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
