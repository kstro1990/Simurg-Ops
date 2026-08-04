import { AgentConfig, ThoughtStep, ExecutionMetrics, ProviderKeys, getProviderFromModel } from '@/types/agent';
import { TOOLS } from './tools';
import { GoogleGenAI } from '@google/genai';

export interface ExecuteAgentOptions {
  agent: AgentConfig;
  userPrompt: string;
  apiKey?: string;
  providerKeys?: ProviderKeys;
  onStepUpdate?: (step: ThoughtStep) => void;
}

export interface AgentExecutionResult {
  steps: ThoughtStep[];
  finalOutput: string;
  metrics: ExecutionMetrics;
}

export async function runAgentEngine(options: ExecuteAgentOptions): Promise<AgentExecutionResult> {
  const { agent, userPrompt, apiKey, providerKeys, onStepUpdate } = options;
  const startTime = Date.now();
  const steps: ThoughtStep[] = [];

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

  // --- 1. GEMINI PROVIDER ENGINE ---
  if (provider === 'gemini') {
    const effectiveApiKey = providerKeys?.geminiApiKey?.trim() || apiKey?.trim() || process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';

    if (effectiveApiKey && effectiveApiKey.length > 5) {
      try {
        addStep({
          type: 'thought',
          content: `Iniciando agente ${agent.avatar} ${agent.name} conectando a Gemini API (${agent.model})...`,
        });

        const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
        let promptWithTools = `${agent.systemPrompt}\n\n[USER REQUEST]:\n${userPrompt}`;
        
        if (agent.tools && agent.tools.length > 0) {
          addStep({
            type: 'thought',
            content: `Herramientas activas asignadas a este agente: ${agent.tools.join(', ')}. Ejecutando análisis de capacidades...`,
          });

          for (const toolName of agent.tools) {
            const toolDef = TOOLS[toolName];
            if (toolDef) {
              addStep({
                type: 'tool_call',
                toolName,
                content: `Ejecutando herramienta [${toolDef.displayName}] para recopilar contexto relevante...`,
                toolArgs: { query: userPrompt, prompt: userPrompt, text: userPrompt },
              });

              const toolResult = await toolDef.execute({ query: userPrompt, prompt: userPrompt, text: userPrompt });

              addStep({
                type: 'tool_result',
                toolName,
                content: `Resultado obtenido de ${toolDef.displayName}`,
                toolResult,
              });

              promptWithTools += `\n\n[CONTEXT FROM TOOL: ${toolDef.displayName}]:\n${toolResult}`;
            }
          }
        }

        addStep({
          type: 'thought',
          content: `Sintetizando razonamiento final y generando respuesta estructurada...`,
        });

        let geminiModelName = 'gemini-2.5-flash';
        if (agent.model === 'gemini-2.5-pro' || agent.model === 'gemini-1.5-pro') {
          geminiModelName = 'gemini-2.5-pro';
        }

        const response = await ai.models.generateContent({
          model: geminiModelName,
          contents: promptWithTools,
          config: {
            temperature: agent.temperature,
            maxOutputTokens: agent.maxTokens,
          },
        });

        const text = response.text || 'Sin respuesta del modelo.';
        const latencyMs = Date.now() - startTime;

        addStep({
          type: 'output',
          content: text,
        });

        return {
          steps,
          finalOutput: text,
          metrics: {
            promptTokens: Math.floor(userPrompt.length / 4) + 150,
            completionTokens: Math.floor(text.length / 4),
            totalTokens: Math.floor((userPrompt.length + text.length) / 4) + 150,
            latencyMs,
          },
        };
      } catch (err: any) {
        addStep({
          type: 'error',
          content: `[Gemini API Error]: ${err?.message || String(err)}. Conmutando a motor de simulación autónomo...`,
        });
      }
    }
  }

  // --- 2. CLAUDE CODE, ANTHROPIC, COPILOT CLI & OPENAI ENGINE ---
  if (provider === 'claude-code' || provider === 'anthropic' || provider === 'copilot-cli' || provider === 'openai') {
    try {
      addStep({
        type: 'thought',
        content: `Iniciando agente ${agent.avatar} ${agent.name} [Conexión: ${provider.toUpperCase()}] usando modelo ${agent.model}...`,
      });

      // Run tools if active
      let promptWithTools = userPrompt;
      if (agent.tools && agent.tools.length > 0) {
        addStep({
          type: 'thought',
          content: `Ejecutando inspección previa de herramientas (${agent.tools.join(', ')}) para enriquecer el prompt...`,
        });

        for (const toolName of agent.tools) {
          const toolDef = TOOLS[toolName];
          if (toolDef) {
            addStep({
              type: 'tool_call',
              toolName,
              content: `Ejecutando herramienta [${toolDef.displayName}]...`,
              toolArgs: { query: userPrompt, prompt: userPrompt, text: userPrompt },
            });

            const toolResult = await toolDef.execute({ query: userPrompt, prompt: userPrompt, text: userPrompt });

            addStep({
              type: 'tool_result',
              toolName,
              content: `Contexto obtenido de ${toolDef.displayName}`,
              toolResult,
            });

            promptWithTools += `\n\n[CONTEXT FROM ${toolDef.displayName}]:\n${toolResult}`;
          }
        }
      }

      addStep({
        type: 'thought',
        content: `Conectando con el puente servidor CLI/API de ${provider}...`,
      });

      const res = await fetch('/api/cli-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: agent.model,
          systemPrompt: agent.systemPrompt,
          userPrompt: promptWithTools,
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          keys: providerKeys || {},
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.output) {
          const latencyMs = Date.now() - startTime;

          addStep({
            type: 'thought',
            content: `Respuesta recibida exitosamente desde ${data.source === 'cli_binary' ? 'Binario CLI Local' : 'API Remota'} (${provider}).`,
          });

          addStep({
            type: 'output',
            content: data.output,
          });

          return {
            steps,
            finalOutput: data.output,
            metrics: {
              promptTokens: data.usage?.promptTokens || Math.floor(userPrompt.length / 4) + 120,
              completionTokens: data.usage?.completionTokens || Math.floor(data.output.length / 4),
              totalTokens: (data.usage?.promptTokens || Math.floor(userPrompt.length / 4)) + (data.usage?.completionTokens || Math.floor(data.output.length / 4)) + 120,
              latencyMs,
            },
          };
        }
      }

      const errData = await res.json().catch(() => ({}));
      addStep({
        type: 'error',
        content: `[${provider.toUpperCase()} Bridge Notice]: ${errData?.message || 'No se detectó API Key ni binario CLI local'}. Conmutando a modo de simulación avanzada para ${provider}...`,
      });
    } catch (err: any) {
      addStep({
        type: 'error',
        content: `[Bridge Failure]: ${err?.message || String(err)}. Conmutando a motor de simulación autónomo...`,
      });
    }
  }

  // --- 3. SIMULATION ENGINE (Fallback & Interactive Demo Mode) ---
  addStep({
    type: 'thought',
    content: `Agente ${agent.avatar} **${agent.name}** iniciado en modo autónomo (${provider.toUpperCase()} / ${agent.model}).`,
  });

  await delay(400);

  addStep({
    type: 'thought',
    content: `Analizando el prompt del usuario: "${userPrompt.substring(0, 80)}${userPrompt.length > 80 ? '...' : ''}" con temperatura ${agent.temperature} en ${agent.model}.`,
  });

  await delay(500);

  if (agent.tools && agent.tools.length > 0) {
    for (const toolName of agent.tools) {
      const toolDef = TOOLS[toolName];
      if (toolDef) {
        addStep({
          type: 'thought',
          content: `Invocando la herramienta autónoma [${toolDef.displayName}]...`,
        });

        await delay(400);

        addStep({
          type: 'tool_call',
          toolName,
          content: `Ejecutando ${toolDef.displayName}...`,
          toolArgs: { query: userPrompt, prompt: userPrompt, text: userPrompt },
        });

        const toolResult = await toolDef.execute({ query: userPrompt, prompt: userPrompt, text: userPrompt });

        await delay(300);

        addStep({
          type: 'tool_result',
          toolName,
          content: `Datos procesados exitosamente por ${toolDef.displayName}.`,
          toolResult,
        });
      }
    }
  }

  addStep({
    type: 'thought',
    content: `Sintetizando informe final con el motor de razonamiento ${provider}...`,
  });

  await delay(500);

  const simulatedOutput = generateSimulatedOutput(agent, userPrompt, provider);
  const latencyMs = Date.now() - startTime;

  addStep({
    type: 'output',
    content: simulatedOutput,
  });

  return {
    steps,
    finalOutput: simulatedOutput,
    metrics: {
      promptTokens: Math.floor(userPrompt.length / 4) + 80,
      completionTokens: Math.floor(simulatedOutput.length / 4),
      totalTokens: Math.floor((userPrompt.length + simulatedOutput.length) / 4) + 80,
      latencyMs,
    },
  };
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateSimulatedOutput(agent: AgentConfig, prompt: string, provider: string): string {
  const pLower = prompt.toLowerCase();

  // CLAUDE CODE CLI SPECIALIZED SIMULATION
  if (provider === 'claude-code' || agent.model === 'claude-code') {
    return `## 🎭 Respuesta de Claude Code CLI (${agent.name})

**Comando Invocado:** \`claude -p "${prompt.substring(0, 60)}..."\`

---

### 💻 Análisis de Código y Solución Diseñada por Claude Code:

\`\`\`typescript
/**
 * Generado por Claude Code Agent Engine (${agent.model})
 * Solución optimizada para: ${prompt}
 */
export interface ClaudeTaskRunner<T> {
  id: string;
  provider: 'claude-code';
  execute(input: T): Promise<{ status: 'success' | 'failed'; result: T }>;
}

export class ClaudeCodeEngine implements ClaudeTaskRunner<string> {
  public id = 'claude-agent-${Date.now()}';
  public provider = 'claude-code' as const;

  public async execute(input: string) {
    console.log(\`[Claude Code] Procesando requerimiento: \${input}\`);
    
    // Procesamiento seguro y tipado estricto
    return {
      status: 'success' as const,
      result: \`Claude Code procesó exitosamente: \${input}\`,
    };
  }
}
\`\`\`

### 📌 Razonamiento de Claude Code:
1. **Refactorización de Arquitectura**: Estructura modular alineada a principios DRY y SOLID.
2. **Seguridad**: Validación estricta de entradas para evitar ataques de inyección o desbordamiento de búfer.
3. **Paso de Integración**: Puedes invocar este agente directamente desde la consola ejecutando \`claude -p "instrucción"\`.`;
  }

  // COPILOT CLI SPECIALIZED SIMULATION
  if (provider === 'copilot-cli' || agent.model.startsWith('copilot-')) {
    return `## 🐙 GitHub Copilot CLI Recommendation (${agent.name})

**Comando GitHub Copilot:** \`gh copilot suggest "${prompt.substring(0, 60)}..."\`

---

### 🚀 Comandos & Código Sugerido por Copilot CLI:

\`\`\`bash
# 1. Ejecutar el flujo de construcción del agente
gh copilot suggest "Build Next.js web application with multi-provider AI harness"

# 2. Configurar variables de entorno requeridas
export ANTHROPIC_API_KEY="sk-ant-api..."
export OPENAI_API_KEY="sk-proj-..."
export GEMINI_API_KEY="AIzaSy..."

# 3. Lanzar servidor de desarrollo
npm run dev
\`\`\`

\`\`\`typescript
// Script de Integración de Copilot CLI en TypeScript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function askCopilotCLI(query: string): Promise<string> {
  const { stdout } = await execAsync(\`gh copilot suggest "\${query}"\`);
  return stdout;
}
\`\`\`

### 💡 Explicación de GitHub Copilot CLI:
- **Sugerencia Directa**: Los comandos anteriores permiten conectar GitHub Copilot CLI directamente con el flujo de terminal.
- **Sincronización**: Compatible con repositorios GitHub, OAuth y tokens de personalización.`;
  }

  // GENERAL SPECIALTY SIMULATIONS
  if (agent.id === 'agent-developer' || agent.role.toLowerCase().includes('engineer') || pLower.includes('código') || pLower.includes('code')) {
    return `## 💻 Solución Técnica Desarrollada por ${agent.name} [${provider.toUpperCase()}]

Para resolver tu requerimiento: **"${prompt}"**, he diseñado la siguiente implementación limpia en TypeScript:

\`\`\`typescript
// Solution generated by ${agent.name} (${agent.model})
export interface AgentResponse<T> {
  success: boolean;
  provider: '${provider}';
  data: T;
  timestamp: string;
  executionMetrics: {
    latencyMs: number;
    tokensUsed: number;
  };
}

export class TaskExecutor {
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  public async executeTask<T>(taskName: string, payload: Record<string, any>): Promise<AgentResponse<T>> {
    console.log(\`[\${this.agentId}] Executing task: \${taskName}\`);
    const startTime = Date.now();

    const result = await this.processPayload(payload);

    return {
      success: true,
      provider: '${provider}' as '${provider}',
      data: result as T,
      timestamp: new Date().toISOString(),
      executionMetrics: {
        latencyMs: Date.now() - startTime,
        tokensUsed: 320,
      },
    };
  }

  private async processPayload(payload: Record<string, any>): Promise<any> {
    return {
      status: "COMPLETED",
      processedAt: new Date().toISOString(),
      details: payload,
    };
  }
}
\`\`\`

### 📌 Puntos Clave de la Solución:
- **Tipado estricto**: Interfaces reutilizables con soporte genérico.
- **Conexión Multi-IA**: Compatible con motor ${provider.toUpperCase()} (${agent.model}).
- **Escalabilidad**: Listo para producción.`;
  }

  if (agent.id === 'agent-auditor' || agent.role.toLowerCase().includes('security')) {
    return `## 🔍 Reporte de Auditoría de Código y Seguridad [${provider.toUpperCase()}]

**Auditor:** ${agent.name} (${agent.role})  
**Modelo Motor:** ${agent.model}  
**Objetivo de Inspección:** "${prompt}"

---

### 🛡️ Matriz de Evaluación de Calidad

| Criterio | Calificación | Estado | Observación |
| :--- | :---: | :---: | :--- |
| **Seguridad OWASP** | 9.7 / 10 | 🟢 Aprobado | Sin inyecciones ni datos sensibles expuestos |
| **Integración CLI / Provider** | 9.5 / 10 | 🟢 Aprobado | Conexión fluida con ${provider} |
| **Maniobra de Excepciones** | 9.0 / 10 | 🟢 Aprobado | Manejo seguro de bloques try/catch |

### 🛠️ Correcciones Sugeridas (Diff):

\`\`\`diff
- const data = await fetch(url);
- return data.json();
+ try {
+   const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
+   if (!response.ok) throw new Error(\`HTTP error \${response.status}\`);
+   return await response.json();
+ } catch (err) {
+   console.error("[Audit Warning] Fetch timeout or network failure", err);
+   throw err;
+ }
\`\`\`

### Verdict Final:
El componente cumple con los estándares exigidos para entornos de producción en ${provider.toUpperCase()}.`;
  }

  return `## 📑 Informe Generado por ${agent.name} [${provider.toUpperCase()}]

**Rol:** ${agent.role}  
**Modelo Motor:** ${agent.model}  
**Consulta Atendida:** "${prompt}"

---

### 💡 Análisis Principal
Procesado mediante el motor **${provider.toUpperCase()}** con inspección de contexto y razonamiento autónomo.

1. **Diagnóstico Inicial**: Se evaluó la solicitud utilizando las capacidades avanzadas de ${agent.model}.
2. **Síntesis de Resultados**:
   - Integración multi-proveedor activa con respuesta optimizada.
   - Configuración de temperatura (${agent.temperature}) calibrada.

---

### 🚀 Recomendación del Agente
> "${agent.description}"

Puedes encadenar este agente con otros en la pestaña de **Workflows**.`;
}
