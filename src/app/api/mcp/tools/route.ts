import { NextRequest, NextResponse } from 'next/server';
import { listMcpTools } from '@/lib/mcpClient';
import { McpListRequest } from '@/types/mcp';

/**
 * Lista las tools que expone un servidor MCP. Lo consume el botón "Probar
 * conexión" de AgentModal para que el usuario elija qué invocar sin tener que
 * conocer el catálogo de memoria.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<McpListRequest>;

    if (!body.server) {
      return NextResponse.json(
        { success: false, message: 'Falta la configuración del servidor MCP.' },
        { status: 400 }
      );
    }

    const result = await listMcpTools({ server: body.server });

    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Error listando tools MCP.',
      },
      { status: 500 }
    );
  }
}
