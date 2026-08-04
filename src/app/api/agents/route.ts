import { NextRequest, NextResponse } from 'next/server';
import { getStoredAgents, saveOrUpdateAgent, deleteStoredAgent, saveStoredAgents } from '@/lib/serverStorage';

export async function GET() {
  try {
    const agents = await getStoredAgents();
    return NextResponse.json({ success: true, agents });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (Array.isArray(body)) {
      // Bulk update
      await saveStoredAgents(body);
      return NextResponse.json({ success: true, agents: body });
    }
    // Single agent save/update
    const updatedAgents = await saveOrUpdateAgent(body);
    return NextResponse.json({ success: true, agents: updatedAgents });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('id');
    if (!agentId) {
      return NextResponse.json({ success: false, error: 'Agent ID required' }, { status: 400 });
    }
    const updatedAgents = await deleteStoredAgent(agentId);
    return NextResponse.json({ success: true, agents: updatedAgents });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
