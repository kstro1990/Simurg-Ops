import { NextRequest, NextResponse } from 'next/server';
import { getStoredWorkflows, saveStoredWorkflows } from '@/lib/serverStorage';

export async function GET() {
  try {
    const workflows = await getStoredWorkflows();
    return NextResponse.json({ success: true, workflows });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
