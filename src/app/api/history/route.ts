import { NextRequest, NextResponse } from 'next/server';
import { getStoredHistory, saveStoredHistory, addHistoryRun } from '@/lib/serverStorage';

export async function GET() {
  try {
    const history = await getStoredHistory();
    return NextResponse.json({ success: true, history });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const run = await req.json();
    const updatedHistory = await addHistoryRun(run);
    return NextResponse.json({ success: true, history: updatedHistory });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await saveStoredHistory([]);
    return NextResponse.json({ success: true, history: [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
