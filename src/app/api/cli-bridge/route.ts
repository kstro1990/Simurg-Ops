import { NextRequest, NextResponse } from 'next/server';
import { runProviderBridge } from '@/lib/providerBridge';
import { getStoredSettings } from '@/lib/serverStorage';
import { BridgeRequest } from '@/types/bridge';

/**
 * Envoltorio HTTP sobre `runProviderBridge`, para que el navegador pueda usar
 * el puente. La lógica vive en lib/providerBridge.ts, que el servidor y el CLI
 * invocan directamente sin pasar por HTTP.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<BridgeRequest>;

    if (!body.provider || !body.model || typeof body.userPrompt !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Faltan campos obligatorios: provider, model, userPrompt.' },
        { status: 400 }
      );
    }

    // Las claves guardadas en el servidor son el respaldo de las que envía el cliente.
    const storedKeys = await getStoredSettings();

    // OJO: la petición se reconstruye campo a campo, así que cualquier campo
    // que no aparezca aquí se descarta en silencio. `mcpServers` faltaba, lo que
    // dejaba al bucle agéntico de Anthropic sin servidores cuando la ejecución
    // salía del navegador.
    const result = await runProviderBridge({
      provider: body.provider,
      model: body.model,
      systemPrompt: body.systemPrompt || '',
      userPrompt: body.userPrompt,
      history: body.history,
      temperature: body.temperature ?? 0.3,
      maxTokens: body.maxTokens ?? 2048,
      keys: { ...storedKeys, ...(body.keys || {}) },
      mcpServers: body.mcpServers,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Error en el puente de proveedores.',
      },
      { status: 500 }
    );
  }
}
