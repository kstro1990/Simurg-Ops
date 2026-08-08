import { execFile } from 'child_process';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { AgentModel } from '@/types/agent';
import { BridgeRequest, BridgeResult } from '@/types/bridge';
import { McpTraceEntry, MCP_MAX_ITERATIONS } from '@/types/mcp';
import {
  flattenTranscript,
  toAnthropicMessages,
  toOpenAIMessages,
} from './conversationFormat';
import { agenticServers, executeBoundTool, resolveAgenticTools } from './mcpTools';
import { listMcpTools, runMcpBridge } from './mcpClient';

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
};

/**
 * IDs que acepta `copilot --model` (ver `copilot help config`). `copilot-cli`
 * no mapea a ninguno a propósito: sin `--model` el CLI usa su modo automático
 * y elige el modelo por sí mismo.
 */
const COPILOT_MODEL_MAP: Partial<Record<AgentModel, string>> = {
  'copilot-claude-opus-5': 'claude-opus-5',
  'copilot-claude-sonnet-5': 'claude-sonnet-5',
  'copilot-claude-haiku-4.5': 'claude-haiku-4.5',
  'copilot-gpt-5.5': 'gpt-5.5',
  'copilot-gpt-5-mini': 'gpt-5-mini',
  'copilot-gemini-3.1-pro-preview': 'gemini-3.1-pro-preview',
};

/**
 * El CLI de Copilot arranca una sesión de agente completa, no un simple
 * completion: 60 s se quedan cortos en cuanto el prompt es real.
 */
const COPILOT_TIMEOUT_MS = 180_000;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

interface AnthropicBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

async function postAnthropic(
  apiKey: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown> & { content?: AnthropicBlock[] }> {
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

  return data;
}

function anthropicText(content: AnthropicBlock[] | undefined): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim();
}

async function callAnthropic(request: BridgeRequest, apiKey: string): Promise<BridgeResult> {
  const anthropicModel = ANTHROPIC_MODEL_MAP[request.model] || 'claude-opus-5';
  const maxTokens = Math.max(request.maxTokens, ANTHROPIC_MIN_MAX_TOKENS);

  // --- Modo agéntico: se le ofrecen las tools MCP y el modelo decide ---
  const servers = agenticServers(request.mcpServers);
  const { tools, failures } = servers.length
    ? await resolveAgenticTools(servers, listMcpTools)
    : { tools: [], failures: [] as string[] };

  const byAlias = new Map(tools.map((tool) => [tool.alias, tool]));
  const toolTrace: McpTraceEntry[] = [];

  // Los turnos previos entran como texto plano; Anthropic los acepta conviviendo
  // con los turnos de bloques que empuja el bucle de tools más abajo. Esos
  // bloques se devuelven **sin tocar**: en Opus 5 el pensamiento va dentro y
  // editarlo rompe el turno.
  const messages: Array<{ role: string; content: unknown }> = [
    ...toAnthropicMessages(request.history ?? []),
    { role: 'user', content: request.userPrompt },
  ];

  let promptTokens = 0;
  let completionTokens = 0;

  for (let iteration = 0; iteration < MCP_MAX_ITERATIONS; iteration++) {
    const body: Record<string, unknown> = {
      model: anthropicModel,
      max_tokens: maxTokens,
      system: request.systemPrompt || undefined,
      messages,
    };

    if (ANTHROPIC_TEMPERATURE_SUPPORTED.has(anthropicModel)) {
      body.temperature = request.temperature;
    }

    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        name: tool.alias,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
    }

    const data = await postAnthropic(apiKey, body);
    promptTokens += (data.usage as { input_tokens?: number })?.input_tokens ?? 0;
    completionTokens += (data.usage as { output_tokens?: number })?.output_tokens ?? 0;

    const toolUses = (data.content ?? []).filter((block) => block?.type === 'tool_use');

    if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const outputText = anthropicText(data.content);
      if (!outputText) {
        throw new Error(
          `Anthropic devolvió una respuesta vacía (stop_reason: ${data.stop_reason}).`
        );
      }
      return {
        success: true,
        output: outputText,
        source: 'api',
        usage: { promptTokens, completionTokens },
        toolTrace: toolTrace.length ? toolTrace : undefined,
      };
    }

    // El turno del asistente entero, incluidos los bloques de pensamiento.
    messages.push({ role: 'assistant', content: data.content });

    // Todos los `tool_result` van en UN solo mensaje de usuario: repartirlos
    // enseña al modelo a dejar de pedir tools en paralelo.
    const results = [];
    for (const use of toolUses) {
      const tool = byAlias.get(use.name ?? '');
      const args = (use.input ?? {}) as Record<string, unknown>;

      if (!tool) {
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `La tool "${use.name}" no está disponible.`,
          is_error: true,
        });
        continue;
      }

      const result = await executeBoundTool(tool, args, runMcpBridge);
      const text = result.success
        ? result.output || '(sin contenido)'
        : result.message || 'La tool falló sin detalle.';

      toolTrace.push({
        server: tool.server.name || tool.server.id,
        tool: tool.toolName,
        arguments: args,
        ok: Boolean(result.success),
        output: result.success ? text : undefined,
        message: result.success ? undefined : text,
      });

      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: text,
        is_error: !result.success,
      });
    }

    messages.push({ role: 'user', content: results });
  }

  // Se agotaron las vueltas: se devuelve lo último que dijo con una nota, en vez
  // de perder el trabajo hecho.
  const detail = failures.length ? ` Además: ${failures.join(' ')}` : '';
  return {
    success: false,
    message: `El bucle de tools se detuvo tras ${MCP_MAX_ITERATIONS} vueltas sin respuesta final.${detail}`,
    toolTrace: toolTrace.length ? toolTrace : undefined,
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
        ...toOpenAIMessages(request.history ?? []),
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

interface CopilotEvent {
  type?: string;
  data?: {
    content?: string;
    outputTokens?: number;
    message?: string;
    error?: string;
  };
  exitCode?: number;
  error?: string;
}

/**
 * Extrae la respuesta del JSONL de `copilot --output-format json`. El CLI emite
 * un objeto por línea; sólo `assistant.message` lleva texto final (los
 * `assistant.message_delta` son el streaming del mismo contenido, así que
 * sumarlos duplicaría la respuesta).
 */
function parseCopilotJsonl(stdout: string): {
  output: string;
  outputTokens: number;
  exitCode?: number;
  errorText?: string;
} {
  let output = '';
  let outputTokens = 0;
  let exitCode: number | undefined;
  let errorText: string | undefined;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    let event: CopilotEvent;
    try {
      event = JSON.parse(trimmed) as CopilotEvent;
    } catch {
      continue; // Línea truncada o ruido: no invalida el resto de la sesión.
    }

    if (event.type === 'assistant.message' && event.data?.content) {
      output += (output ? '\n\n' : '') + event.data.content;
      outputTokens += event.data.outputTokens ?? 0;
    } else if (event.type === 'error' || event.type === 'session.error') {
      errorText = event.data?.message || event.data?.error || event.error;
    } else if (event.type === 'result') {
      exitCode = event.exitCode;
    }
  }

  return { output: output.trim(), outputTokens, exitCode, errorText };
}

/**
 * Ejecuta el CLI de GitHub Copilot en modo no interactivo.
 *
 * A diferencia del resto de proveedores, aquí no hay endpoint HTTP: la
 * autenticación vive en el propio CLI (`copilot login`) o en
 * `COPILOT_GITHUB_TOKEN`. Por eso `copilotToken` se inyecta como variable de
 * entorno en lugar de como cabecera.
 *
 * Decisiones deliberadas sobre los flags:
 * - **No** se pasa `--allow-all-tools`. El CLI es un agente con acceso a shell y
 *   al disco; un harness que sólo quiere texto no debe concederle eso. Sin el
 *   flag, cualquier herramienta que pida queda denegada y responde igualmente.
 * - `-C` apunta al directorio temporal y `--no-custom-instructions` evita que el
 *   AGENTS.md del repo se cuele en el prompt de todos los agentes.
 * - `temperature` y `maxTokens` no tienen equivalente en el CLI: se ignoran.
 */
async function callCopilotCli(
  request: BridgeRequest,
  token: string
): Promise<BridgeResult> {
  // El CLI no tiene array de mensajes: la conversación se aplana a un string.
  // Sin historial el resultado es idéntico al formato anterior.
  const prompt = flattenTranscript(
    request.history ?? [],
    request.userPrompt,
    request.systemPrompt
  );

  const args = [
    '--prompt',
    prompt,
    '--output-format',
    'json',
    '--no-color',
    '--log-level',
    'none',
    '--no-ask-user',
    '--no-custom-instructions',
    '--no-auto-update',
    '--no-remote-export',
    '--disable-builtin-mcps',
    '--disallow-temp-dir',
    '-C',
    tmpdir(),
  ];

  const wireModel = COPILOT_MODEL_MAP[request.model];
  if (wireModel) args.push('--model', wireModel);

  const env = { ...process.env };
  if (token) env.COPILOT_GITHUB_TOKEN = token;

  let stdout = '';
  let stderr = '';
  let execError: unknown;

  try {
    ({ stdout, stderr } = await execFilePromise('copilot', args, {
      timeout: COPILOT_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      cwd: tmpdir(),
      env,
    }));
  } catch (err) {
    // Con salida distinta de cero el CLI puede haber respondido igualmente:
    // se conserva stdout y se decide después de parsearlo.
    execError = err;
    stdout = (err as { stdout?: string })?.stdout ?? '';
    stderr = (err as { stderr?: string })?.stderr ?? '';
  }

  // El plan de Copilot decide qué modelos admite `--model`. En las cuentas
  // restringidas (p. ej. Copilot Free) sólo funciona el modo automático, aunque
  // `copilot help config` liste el catálogo completo.
  if (wireModel && /is not available/i.test(stderr)) {
    return {
      success: false,
      message:
        `Tu plan de Copilot no permite elegir "${wireModel}" con --model. ` +
        'Usa el modelo "Copilot (automático)", que deja que el CLI escoja, o cambia a un plan que habilite la selección de modelo.',
    };
  }

  if (execError && !stdout) {
    const code = (execError as { code?: string | number })?.code;
    if (code === 'ENOENT') {
      return {
        success: false,
        message:
          'El binario `copilot` no está en el PATH. Instálalo con `brew install copilot` (o `npm i -g @github/copilot`) y autentícate con `copilot login`.',
      };
    }
    if ((execError as { killed?: boolean })?.killed) {
      return {
        success: false,
        message: `El CLI de Copilot superó el tiempo límite de ${COPILOT_TIMEOUT_MS / 1000} s.`,
      };
    }
    // Se prefiere stderr al mensaje de execFile: este último incluye la línea de
    // comando completa, y con ella el prompt entero del usuario.
    const detail = stderr.trim().split('\n')[0] || errorMessage(execError);
    return { success: false, message: `Fallo al ejecutar el CLI de Copilot: ${detail}` };
  }

  const { output, outputTokens, exitCode, errorText } = parseCopilotJsonl(stdout);

  if (!output) {
    const detail =
      errorText ||
      (exitCode ? `el CLI terminó con código ${exitCode}` : 'no emitió ningún mensaje del asistente');
    return {
      success: false,
      message: `El CLI de Copilot no devolvió respuesta: ${detail}. Comprueba la sesión con \`copilot login\`.`,
    };
  }

  return {
    success: true,
    output,
    source: 'cli_binary',
    usage: { promptTokens: 0, completionTokens: outputTokens },
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
        // `claude -p` recibe un único string, así que el system prompt y los
        // turnos previos van aplanados dentro. Antes se pasaba `userPrompt` a
        // secas y la persona del agente se ignoraba por completo en esta ruta.
        //
        // No se usa `--resume`: ataría el estado a la sesión del binario, que es
        // invisible para conversations.json y tendría otra semántica de reset.
        const cliResult = await callCliBinary('claude', [
          '-p',
          flattenTranscript(request.history ?? [], request.userPrompt, request.systemPrompt),
        ]);
        if (cliResult) return cliResult;
      }

      return {
        success: false,
        message:
          'No hay ANTHROPIC_API_KEY configurada ni un binario `claude` disponible en el PATH.',
      };
    }

    if (provider === 'copilot-cli') {
      // Copilot no se atiende con la API de OpenAI: un token de GitHub contra
      // api.openai.com siempre da 401. Su única ruta real es el CLI propio,
      // que trae su propia sesión autenticada.
      const token =
        keys.copilotToken?.trim() ||
        process.env.COPILOT_GITHUB_TOKEN ||
        process.env.GH_TOKEN ||
        process.env.GITHUB_TOKEN ||
        '';

      return await callCopilotCli(request, token);
    }

    if (provider === 'openai') {
      const apiKey = keys.openaiApiKey?.trim() || process.env.OPENAI_API_KEY || '';

      if (apiKey.length > 5) {
        return await callOpenAI(request, apiKey);
      }

      return {
        success: false,
        message: 'No hay OPENAI_API_KEY configurada para el proveedor OpenAI.',
      };
    }

    return { success: false, message: `El puente no atiende al proveedor "${provider}".` };
  } catch (err) {
    return { success: false, message: errorMessage(err) };
  }
}
