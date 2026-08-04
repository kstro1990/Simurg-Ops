import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { runProviderBridge } from '@/lib/providerBridge';
import { getStoredSettings } from '@/lib/serverStorage';
import { AIProvider, AgentModel, ProviderKeys } from '@/types/agent';

/** Modelo más barato de cada proveedor: esto solo comprueba que la clave sirve. */
const PROBE_MODEL: Record<AIProvider, AgentModel> = {
  gemini: 'gemini-2.5-flash',
  anthropic: 'claude-haiku-4-5',
  'claude-code': 'claude-haiku-4-5',
  'copilot-cli': 'gpt-4o-mini',
  openai: 'gpt-4o-mini',
};

const PROBE_PROMPT = 'Responde únicamente con la palabra: OK';

/**
 * Comprueba que una credencial funciona de verdad contra el proveedor.
 * Antes no había forma de saber si una clave era válida hasta que una ejecución
 * caía al simulador sin decir por qué.
 */
export async function POST(req: NextRequest) {
  try {
    const { provider, keys } = (await req.json()) as {
      provider?: AIProvider;
      keys?: ProviderKeys;
    };

    if (!provider || !(provider in PROBE_MODEL)) {
      return NextResponse.json(
        { success: false, message: `Proveedor no reconocido: ${provider}` },
        { status: 400 }
      );
    }

    const storedKeys = await getStoredSettings();
    const effectiveKeys: ProviderKeys = { ...storedKeys, ...(keys || {}) };

    if (provider === 'gemini') {
      const apiKey = effectiveKeys.geminiApiKey?.trim() || process.env.GEMINI_API_KEY || '';
      if (apiKey.length < 6) {
        return NextResponse.json({ success: false, message: 'No hay una API key de Gemini.' });
      }
      try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: PROBE_MODEL.gemini,
          contents: PROBE_PROMPT,
          config: { maxOutputTokens: 16 },
        });
        return NextResponse.json({
          success: true,
          message: `Conexión correcta (${PROBE_MODEL.gemini}).`,
          sample: response.text?.trim().slice(0, 60) ?? '',
        });
      } catch (err) {
        return NextResponse.json({
          success: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const result = await runProviderBridge({
      provider,
      model: PROBE_MODEL[provider],
      systemPrompt: '',
      userPrompt: PROBE_PROMPT,
      temperature: 0,
      maxTokens: 64,
      keys: effectiveKeys,
    });

    return NextResponse.json({
      success: result.success,
      message: result.success
        ? `Conexión correcta vía ${result.source === 'cli_binary' ? 'binario CLI local' : 'API remota'}.`
        : (result.message ?? 'El proveedor no respondió.'),
      sample: result.output?.trim().slice(0, 60) ?? '',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Error probando el proveedor.',
      },
      { status: 500 }
    );
  }
}
