import { NextRequest, NextResponse } from 'next/server';
import { getStoredHistory, saveStoredHistory, addHistoryRun } from '@/lib/serverStorage';
import { errorMessage } from '@/lib/errors';

export async function GET() {
  try {
    const history = await getStoredHistory();
    return NextResponse.json({ success: true, history });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const run = await req.json();
    const updatedHistory = await addHistoryRun(run);
    return NextResponse.json({ success: true, history: updatedHistory });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await saveStoredHistory([]);
    return NextResponse.json({ success: true, history: [] });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
