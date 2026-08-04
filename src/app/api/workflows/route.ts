import { NextRequest, NextResponse } from 'next/server';
import {
  deleteStoredWorkflow,
  getStoredWorkflows,
  saveStoredWorkflows,
} from '@/lib/serverStorage';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error desconocido';
}

export async function GET() {
  try {
    const workflows = await getStoredWorkflows();
    return NextResponse.json({ success: true, workflows });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let workflows = await getStoredWorkflows();
    if (Array.isArray(body)) {
      workflows = body;
    } else {
      workflows = [body, ...workflows];
    }
    await saveStoredWorkflows(workflows);
    return NextResponse.json({ success: true, workflows });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const workflowId = new URL(req.url).searchParams.get('id');
    if (!workflowId) {
      return NextResponse.json(
        { success: false, error: 'Se requiere el query param id.' },
        { status: 400 }
      );
    }
    const workflows = await deleteStoredWorkflow(workflowId);
    return NextResponse.json({ success: true, workflows });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
