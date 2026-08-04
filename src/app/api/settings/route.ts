import { NextRequest, NextResponse } from 'next/server';
import { getStoredSettings, saveStoredSettings } from '@/lib/serverStorage';
import { errorMessage } from '@/lib/errors';

export async function GET() {
  try {
    const settings = await getStoredSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const keys = await req.json();
    const updatedSettings = await saveStoredSettings(keys);
    return NextResponse.json({ success: true, settings: updatedSettings });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
