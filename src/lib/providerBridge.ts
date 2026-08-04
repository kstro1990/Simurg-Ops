import { execFile } from 'child_process';
import { promisify } from 'util';
import { AgentModel } from '@/types/agent';
import { BridgeRequest, BridgeResult } from '@/types/bridge';

const execFilePromise = promisify(execFile);

const CLI_TIMEOUT_MS = 60_000;

/**
 * IDs vigentes de la Messages API de Anthropic. Los antiguos (claude-3-7-sonnet-*,
 * claude-3-5-sonnet-*, claude-3-5-haiku-*) están retirados y devuelven 404.
 */
const ANTHROPIC_MODEL_MAP: Partial<Record<AgentModel, string>> = {
  'claude-opus-5': 'claude-opus-5',
  'claude-sonnet-5': 'claude-sonnet-5',
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-code': 'claude-opus-5',
};

/**
 * Opus 5 y Sonnet 5 rechazan `temperature` con 400: el muestreo se controla por
 * prompt. Haiku 4.5 sí lo acepta.
 */
const ANTHROPIC_TEMPERATURE_SUPPORTED = new Set(['claude-haiku-4-5']);

/**
 * En Opus 5 el pensamiento está activo por defecto y `max_tokens` limita
 * pensamiento + respuesta juntos, así que un tope ajustado trunca la respuesta
 * a media frase. Damos margen.
 */
const ANTHROPIC_MIN_MAX_TOKENS = 8192;

const OPENAI_MODEL_MAP: Partial<Record<AgentModel, string>> = {
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
  'copilot-gpt-4o': 'gpt-4o',
  'copilot-cli': 'gpt-4o',
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function callAnthropic(request: BridgeRequest, apiKey: string): Promise<BridgeResult> {
  const anthropicModel = ANTHROPIC_MODEL_MAP[request.model] || 'claude-opus-5';
  const maxTokens = Math.max(request.maxTokens, ANTHROPIC_MIN_MAX_TOKENS);

  const body: Record<string, unknown> = {
    model: anthropicModel,
    max_tokens: maxTokens,
    system: request.systemPrompt || undefined,
    messages: [{ role: 'user', content: request.userPrompt }],
  };

  if (ANTHROPIC_TEMPERATURE_SUPPORTED.has(anthropicModel)) {
    body.temperature = request.temperature;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const detail = (errData as { error?: { message?: string } })?.error?.message || res.statusText;
    throw new Error(`Anthropic API Error (${res.status}): ${detail}`);
  }

  const data = await res.json();

  if (data.stop_reason === 'refusal') {
    throw new Error(
      `Anthropic rechazó la solicitud (categoría: ${data.stop_details?.category ?? 'desconocida'}).`
    );
  }

  const textBlock = Array.isArray(data.content)
    ? data.content.find((block: { type?: string }) => block?.type === 'text')
    : null;
  const outputText = textBlock?.text?.trim();

  if (!outputText) {
    throw new Error(`Anthropic devolvió una respuesta vacía (stop_reason: ${data.stop_reason}).`);
  }

  return {
    success: true,
    output: outputText,
    source: 'api',
    usage: {
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
    },
  };
}

async function callOpenAI(request: BridgeRequest, apiKey: string): Promise<BridgeResult> {
  const openaiModel = OPENAI_MODEL_MAP[request.model] || 'gpt-4o';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      messages: [
        ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
        { role: 'user', content: request.userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const detail = (errData as { error?: { message?: string } })?.error?.message || res.statusText;
    throw new Error(`OpenAI API Error (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const outputText = data.choices?.[0]?.message?.content?.trim();

  if (!outputText) {
    throw new Error('OpenAI devolvió una respuesta vacía.');
  }

  return {
    success: true,
    output: outputText,
    source: 'api',
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Invoca un binario local. Usa execFile con array de argumentos, nunca una
 * plantilla de shell: el prompt es texto arbitrario del usuario y con `exec`
 * un `$(...)` dentro del prompt se ejecutaría como comando.
 */
async function callCliBinary(binary: string, args: string[]): Promise<BridgeResult | null> {
  try {
    const { stdout } = await execFilePromise(binary, args, {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = stdout?.trim();
    if (output) {
      return { success: true, output, source: 'cli_binary' };
    }
  } catch {
    // Binario ausente o fallido: lo trata el llamante.
  }
  return null;
}

/**
 * Implementación real del puente a proveedores. SOLO SERVIDOR — importa
 * child_process. Desde el navegador use `fetchProviderBridge` (bridgeClient.ts).
 */
export async function runProviderBridge(request: BridgeRequest): Promise<BridgeResult> {
  const { provider, keys } = request;

  try {
    if (provider === 'anthropic' || provider === 'claude-code') {
      const apiKey = keys.anthropicApiKey?.trim() || process.env.ANTHROPIC_API_KEY || '';

      if (apiKey.length > 5) {
        return await callAnthropic(request, apiKey);
      }

      if (provider === 'claude-code') {
        const cliResult = await callCliBinary('claude', ['-p', request.userPrompt]);
        if (cliResult) return cliResult;
      }

      return {
        success: false,
        message:
          'No hay ANTHROPIC_API_KEY configurada ni un binario `claude` disponible en el PATH.',
      };
    }

    if (provider === 'openai' || provider === 'copilot-cli') {
      const apiKey =
        keys.openaiApiKey?.trim() ||
        keys.copilotToken?.trim() ||
        process.env.OPENAI_API_KEY ||
        process.env.GITHUB_TOKEN ||
        '';

      if (apiKey.length > 5) {
        return await callOpenAI(request, apiKey);
      }

      if (provider === 'copilot-cli') {
        const cliResult = await callCliBinary('gh', ['copilot', 'suggest', request.userPrompt]);
        if (cliResult) return cliResult;
      }

      return {
        success: false,
        message:
          'No hay OPENAI_API_KEY / GITHUB_TOKEN configurados ni un binario `gh` disponible en el PATH.',
      };
    }

    return { success: false, message: `El puente no atiende al proveedor "${provider}".` };
  } catch (err) {
    return { success: false, message: errorMessage(err) };
  }
}
