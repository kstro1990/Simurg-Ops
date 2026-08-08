import { NextRequest, NextResponse } from 'next/server';
import { runMcpBridge } from '@/lib/mcpClient';
import { McpCallRequest } from '@/types/mcp';

/**
 * Envoltorio HTTP sobre `runMcpBridge`, para que el navegador pueda invocar
 * tools MCP. La lógica vive en lib/mcpClient.ts, que el servidor y el CLI
 * invocan directamente sin pasar por HTTP.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<McpCallRequest>;

    if (!body.server || !body.call?.toolName || typeof body.userPrompt !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Faltan campos obligatorios: server, call.toolName, userPrompt.' },
        { status: 400 }
      );
    }

    const result = await runMcpBridge({
      server: body.server,
      call: body.call,
      userPrompt: body.userPrompt,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Error en el puente MCP.',
      },
      { status: 500 }
    );
  }
}
