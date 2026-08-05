import {
  AgentConfig,
  ThoughtStep,
  ExecutionMetrics,
  ProviderKeys,
  AIProvider,
  getProviderFromModel,
} from '@/types/agent';
import { BridgeFn } from '@/types/bridge';
import { McpFn } from '@/types/mcp';
import { TOOLS } from './tools';
import { GoogleGenAI } from '@google/genai';

export type { BridgeRequest, BridgeResult, BridgeFn } from '@/types/bridge';

export interface ExecuteAgentOptions {
  agent: AgentConfig;
  userPrompt: string;
  apiKey?: string;
  providerKeys?: ProviderKeys;
  onStepUpdate?: (step: ThoughtStep) => void;
  /**
   * Transporte hacia los proveedores no-Gemini.
   * - Servidor y CLI: `runProviderBridge` (lib/providerBridge.ts).
   * - Navegador: `fetchProviderBridge` (lib/bridgeClient.ts).
   *
   * No hay valor por defecto a propósito: el default anterior era un fetch a
   * una URL relativa, que desde el servidor nunca resuelve y hacía que Telegram
   * y las rutas /execute cayeran siempre al simulador sin avisar.
   */
  bridgeFn?: BridgeFn;
  /**
   * Transporte hacia los servidores MCP del agente, con el mismo criterio que
   * `bridgeFn`: sin default, porque la implementación real usa child_process.
   * - Servidor y CLI: `runMcpBridge` (lib/mcpClient.ts).
   * - Navegador: `fetchMcpBridge` (lib/mcpBridgeClient.ts).
   *
   * A diferencia de `bridgeFn`, omitirlo no aborta la ejecución: MCP es
   * contexto opcional, el proveedor no.
   */
  mcpFn?: McpFn;
}

export interface AgentExecutionResult {
  steps: ThoughtStep[];
  finalOutput: string;
  metrics: ExecutionMetrics;
  /** true si la salida la fabricó el simulador en lugar de un modelo real. */
  simulated: boolean;
  provider: AIProvider;
}

/**
 * Se lanza en modo estricto cuando ningún proveedor real pudo atender la
 * ejecución. Sin modo estricto el motor conmuta al simulador y marca el
 * resultado con `simulated: true`.
 */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runAgentEngine(options: ExecuteAgentOptions): Promise<AgentExecutionResult> {
  const { agent, userPrompt, apiKey, providerKeys, onStepUpdate, bridgeFn, mcpFn } = options;
  const startTime = Date.now();
  const steps: ThoughtStep[] = [];
  const strictMode = Boolean(providerKeys?.strictMode);

  const addStep = (step: Omit<ThoughtStep, 'id' | 'timestamp'>) => {
    const fullStep: ThoughtStep = {
      ...step,
      id: 'step-' + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
    };
    steps.push(fullStep);
    if (onStepUpdate) {
      onStepUpdate(fullStep);
    }
    return fullStep;
  };

  const provider = getProviderFromModel(agent.model);
  /** Motivos por los que cada ruta real falló, para el mensaje del modo estricto. */
  const failures: string[] = [];

  /**
   * El contexto de herramientas se calcula una sola vez por ejecución. Antes se
   * recalculaba en el fallback al simulador, lo que con MCP significaría lanzar
   * procesos y pegar a APIs remotas dos veces por cada petición.
   */
  let toolContextCache: string | null = null;

  /** Herramientas locales de `lib/tools.ts` (registro cerrado). */
  const runLocalTools = async (): Promise<string> => {
    if (!agent.tools || agent.tools.length === 0) return '';

    addStep({
      type: 'thought',
      content: `Herramientas activas asignadas a este agente: ${agent.tools.join(', ')}. Recopilando contexto...`,
    });

    let context = '';
    for (const toolName of agent.tools) {
      const toolDef = TOOLS[toolName];
      if (!toolDef) continue;

      addStep({
        type: 'tool_call',
        toolName,
        content: `Ejecutando herramienta [${toolDef.displayName}]...`,
        toolArgs: { query: userPrompt, prompt: userPrompt, text: userPrompt },
      });

      const toolResult = await toolDef.execute({
        query: userPrompt,
        prompt: userPrompt,
        text: userPrompt,
      });

      addStep({
        type: 'tool_result',
        toolName,
        content: `Resultado obtenido de ${toolDef.displayName}`,
        toolResult,
      });

      context += `\n\n[CONTEXT FROM TOOL: ${toolDef.displayName}]:\n${toolResult}`;
    }
    return context;
  };

  /**
   * Servidores MCP del agente. Son enriquecedores pre-flight, igual que las
   * herramientas locales: se invocan las tools que el usuario declaró y su
   * salida se anexa al prompt. Un servidor caído degrada el contexto, nunca
   * tumba la ejecución.
   *
   * `ThoughtStep.toolName` está tipado como `ToolName` (registro local), así que
   * los pasos MCP lo dejan sin definir y llevan la identidad en `content` y
   * `toolArgs`.
   */
  const runMcpServers = async (): Promise<string> => {
    const servers = (agent.mcpServers ?? []).filter(
      (server) => server.enabled && server.calls?.length > 0
    );
    if (servers.length === 0) return '';

    if (!mcpFn) {
      const detail =
        'Hay servidores MCP habilitados pero no se proporcionó transporte (mcpFn). Es un error de integración; la ejecución continúa sin contexto MCP.';
      failures.push(detail);
      addStep({ type: 'error', content: `[MCP]: ${detail}` });
      return '';
    }

    addStep({
      type: 'thought',
      content: `Servidores MCP habilitados: ${servers.map((s) => s.name || s.id).join(', ')}. Recopilando contexto...`,
    });

    let context = '';
    for (const server of servers) {
      const label = server.name || server.id;
      for (const call of server.calls) {
        addStep({
          type: 'tool_call',
          content: `Invocando MCP [${label}] → ${call.toolName}...`,
          toolArgs: {
            mcpServer: label,
            mcpTransport: server.transport,
            mcpTool: call.toolName,
            arguments: call.arguments ?? {},
          },
        });

        const result = await mcpFn({ server, call, userPrompt });

        if (result.success && result.output) {
          addStep({
            type: 'tool_result',
            content: `Resultado obtenido de MCP [${label}] → ${call.toolName}`,
            toolResult: result.output,
          });
          context += `\n\n[CONTEXT FROM MCP: ${label} / ${call.toolName}]:\n${result.output}`;
        } else {
          const detail = result.message || `MCP [${label}] → ${call.toolName} no devolvió salida.`;
          failures.push(detail);
          addStep({ type: 'error', content: detail });
        }
      }
    }
    return context;
  };

  /** Ejecuta las herramientas del agente y devuelve el contexto recopilado. */
  const runTools = async (): Promise<string> => {
    if (toolContextCache !== null) return toolContextCache;
    const context = (await runLocalTools()) + (await runMcpServers());
    toolContextCache = context;
    return context;
  };

  // --- 1. MOTOR GEMINI ---
  if (provider === 'gemini') {
    const effectiveApiKey =
      providerKeys?.geminiApiKey?.trim() ||
      apiKey?.trim() ||
      process.env.GEMINI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
      '';

    if (effectiveApiKey.length > 5) {
      try {
        addStep({
          type: 'thought',
          content: `Iniciando agente ${agent.avatar} ${agent.name} conectando a Gemini API (${agent.model})...`,
        });

        const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
        const toolContext = await runTools();
        const promptWithTools = `${agent.systemPrompt}\n\n[USER REQUEST]:\n${userPrompt}${toolContext}`;

        addStep({
          type: 'thought',
          content: 'Sintetizando razonamiento final y generando respuesta estructurada...',
        });

        // Los IDs de Gemini a nivel de app coinciden con los de la API, así que
        // se pasan tal cual. `normalizeModel` ya ha remapeado los retirados al
        // cargar el agente, y añadir un modelo nuevo no requiere tocar esto.
        const response = await ai.models.generateContent({
          model: agent.model,
          contents: promptWithTools,
          config: {
            temperature: agent.temperature,
            maxOutputTokens: agent.maxTokens,
          },
        });

        const text = response.text?.trim();
        if (!text) {
          throw new Error('Gemini devolvió una respuesta vacía.');
        }

        addStep({ type: 'output', content: text });

        return {
          steps,
          finalOutput: text,
          simulated: false,
          provider,
          metrics: {
            promptTokens: Math.floor(userPrompt.length / 4) + 150,
            completionTokens: Math.floor(text.length / 4),
            totalTokens: Math.floor((userPrompt.length + text.length) / 4) + 150,
            latencyMs: Date.now() - startTime,
          },
        };
      } catch (err) {
        const detail = `[Gemini API Error]: ${errorMessage(err)}`;
        failures.push(detail);
        addStep({ type: 'error', content: detail });
      }
    } else {
      const detail = 'No hay una API key de Gemini configurada.';
      failures.push(detail);
      addStep({ type: 'error', content: `[Gemini]: ${detail}` });
    }
  }

  // --- 2. MOTOR CLAUDE CODE / ANTHROPIC / COPILOT CLI / OPENAI ---
  if (
    provider === 'claude-code' ||
    provider === 'anthropic' ||
    provider === 'copilot-cli' ||
    provider === 'openai'
  ) {
    if (!bridgeFn) {
      const detail =
        'No se proporcionó transporte hacia el proveedor (bridgeFn). Es un error de integración, no de configuración.';
      failures.push(detail);
      addStep({ type: 'error', content: `[${provider.toUpperCase()}]: ${detail}` });
    } else {
      try {
        addStep({
          type: 'thought',
          content: `Iniciando agente ${agent.avatar} ${agent.name} [Conexión: ${provider.toUpperCase()}] usando modelo ${agent.model}...`,
        });

        const toolContext = await runTools();

        addStep({
          type: 'thought',
          content: `Conectando con el proveedor ${provider}...`,
        });

        const bridgeResult = await bridgeFn({
          provider,
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          userPrompt: `${userPrompt}${toolContext}`,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          keys: providerKeys || {},
        });

        if (bridgeResult.success && bridgeResult.output) {
          addStep({
            type: 'thought',
            content: `Respuesta recibida desde ${bridgeResult.source === 'cli_binary' ? 'binario CLI local' : 'API remota'} (${provider}).`,
          });

          addStep({ type: 'output', content: bridgeResult.output });

          const promptTokens =
            bridgeResult.usage?.promptTokens || Math.floor(userPrompt.length / 4) + 120;
          const completionTokens =
            bridgeResult.usage?.completionTokens || Math.floor(bridgeResult.output.length / 4);

          return {
            steps,
            finalOutput: bridgeResult.output,
            simulated: false,
            provider,
            metrics: {
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
              latencyMs: Date.now() - startTime,
            },
          };
        }

        const detail = `[${provider.toUpperCase()}]: ${bridgeResult.message || 'El proveedor no devolvió salida.'}`;
        failures.push(detail);
        addStep({ type: 'error', content: detail });
      } catch (err) {
        const detail = `[Bridge Failure]: ${errorMessage(err)}`;
        failures.push(detail);
        addStep({ type: 'error', content: detail });
      }
    }
  }

  // --- 3. MODO ESTRICTO: fallar en vez de inventar ---
  if (strictMode) {
    throw new ProviderUnavailableError(
      `Ningún proveedor real pudo atender la ejecución (${provider}).\n${failures.join('\n')}`
    );
  }

  // --- 4. MOTOR DE SIMULACIÓN (demo / fallback explícito) ---
  addStep({
    type: 'thought',
    content: `⚠️ Sin proveedor real disponible. Conmutando a MODO SIMULACIÓN: lo que sigue es texto generado localmente, NO proviene de ${provider.toUpperCase()}.`,
  });

  await delay(400);

  addStep({
    type: 'thought',
    content: `Analizando el prompt del usuario: "${userPrompt.substring(0, 80)}${userPrompt.length > 80 ? '...' : ''}" con temperatura ${agent.temperature} en ${agent.model}.`,
  });

  await delay(500);

  await runTools();

  addStep({
    type: 'thought',
    content: 'Sintetizando informe final con el motor de simulación...',
  });

  await delay(500);

  const simulatedOutput = generateSimulatedOutput(agent, userPrompt, provider);

  addStep({ type: 'output', content: simulatedOutput });

  return {
    steps,
    finalOutput: simulatedOutput,
    simulated: true,
    provider,
    metrics: {
      promptTokens: Math.floor(userPrompt.length / 4) + 80,
      completionTokens: Math.floor(simulatedOutput.length / 4),
      totalTokens: Math.floor((userPrompt.length + simulatedOutput.length) / 4) + 80,
      latencyMs: Date.now() - startTime,
    },
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateSimulatedOutput(agent: AgentConfig, prompt: string, provider: string): string {
  const pLower = prompt.toLowerCase();
  const banner = `> ⚠️ **Respuesta simulada.** No se pudo contactar con ${provider.toUpperCase()}; este texto lo generó el motor local de demostración. Configura la API key correspondiente, o activa el modo estricto para que estas ejecuciones fallen en vez de simularse.\n\n---\n\n`;

  // SIMULACIÓN ESPECIALIZADA DE CLAUDE CODE CLI
  if (provider === 'claude-code' || agent.model === 'claude-code') {
    return `${banner}## 🎭 Claude Code CLI (${agent.name})

**Comando que se habría invocado:** \`claude -p "${prompt.substring(0, 60)}..."\`

---

### 💻 Forma de la solución:

\`\`\`typescript
export interface ClaudeTaskRunner<T> {
  id: string;
  provider: 'claude-code';
  execute(input: T): Promise<{ status: 'success' | 'failed'; result: T }>;
}

export class ClaudeCodeEngine implements ClaudeTaskRunner<string> {
  public readonly provider = 'claude-code' as const;

  constructor(public readonly id: string) {}

  public async execute(input: string) {
    return { status: 'success' as const, result: \`Claude Code procesó: \${input}\` };
  }
}
\`\`\`

### 📌 Para obtener una respuesta real
Configura \`ANTHROPIC_API_KEY\`, o instala el CLI \`claude\` y comprueba que está en el PATH del proceso que sirve la app.`;
  }

  // SIMULACIÓN ESPECIALIZADA DE COPILOT CLI
  if (provider === 'copilot-cli' || agent.model.startsWith('copilot-')) {
    return `${banner}## 🐙 GitHub Copilot CLI (${agent.name})

**Comando que se habría invocado:** \`copilot --prompt "${prompt.substring(0, 60)}..." --output-format json\`

---

\`\`\`bash
# Este agente no usa API key: se apoya en la sesión del CLI de Copilot
brew install copilot        # o: npm i -g @github/copilot
copilot login               # autentica la máquina que sirve la app

# Alternativa sin login interactivo (por ejemplo, en un contenedor)
export COPILOT_GITHUB_TOKEN="ghp_..."
\`\`\`

### 📌 Para obtener una respuesta real
Instala el binario \`copilot\`, comprueba que está en el PATH del proceso que sirve la app y ejecuta \`copilot login\` (o define \`COPILOT_GITHUB_TOKEN\`).`;
  }

  // SIMULACIONES GENERALES POR ESPECIALIDAD
  if (
    agent.id === 'agent-developer' ||
    agent.role.toLowerCase().includes('engineer') ||
    pLower.includes('código') ||
    pLower.includes('code')
  ) {
    return `${banner}## 💻 Esbozo técnico de ${agent.name} [${provider.toUpperCase()}]

Para tu requerimiento: **"${prompt}"**, esta sería la forma de la implementación:

\`\`\`typescript
export interface AgentResponse<T> {
  success: boolean;
  provider: '${provider}';
  data: T;
  timestamp: string;
}

export class TaskExecutor {
  constructor(private readonly agentId: string) {}

  public async executeTask<T>(taskName: string, payload: Record<string, unknown>): Promise<AgentResponse<T>> {
    console.log(\`[\${this.agentId}] Executing task: \${taskName}\`);
    return {
      success: true,
      provider: '${provider}',
      data: payload as T,
      timestamp: new Date().toISOString(),
    };
  }
}
\`\`\`

Es una plantilla genérica, no una solución analizada para tu caso. Configura el proveedor para obtener una respuesta real.`;
  }

  if (agent.id === 'agent-auditor' || agent.role.toLowerCase().includes('security')) {
    return `${banner}## 🔍 Auditoría NO realizada [${provider.toUpperCase()}]

**Auditor:** ${agent.name} (${agent.role})
**Objetivo:** "${prompt}"

---

| Criterio | Estado | Observación |
| :--- | :---: | :--- |
| **Seguridad OWASP** | ⚪ Sin evaluar | Requiere un modelo real |
| **Conexión al proveedor** | 🔴 Sin conexión | No se alcanzó ${provider} |
| **Manejo de excepciones** | ⚪ Sin evaluar | Requiere un modelo real |

### Veredicto
Ninguno. No trates esta salida como una auditoría: configura la API key del proveedor.`;
  }

  return `${banner}## 📑 Informe de ${agent.name} [${provider.toUpperCase()}]

**Rol:** ${agent.role}
**Modelo solicitado:** ${agent.model}
**Consulta:** "${prompt}"

---

### 💡 Qué habría pasado
Esta consulta se habría procesado con **${provider.toUpperCase()}** a temperatura ${agent.temperature}, pero no hubo conexión con el proveedor.

### 🚀 Siguiente paso
Abre el modal de claves API y configura la credencial de **${provider}**, o cambia el modelo del agente a uno cuyo proveedor sí tengas configurado.`;
}
