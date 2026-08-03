import { AgentConfig, ThoughtStep, ExecutionMetrics } from '@/types/agent';
import { TOOLS } from './tools';
import { GoogleGenAI } from '@google/genai';

export interface ExecuteAgentOptions {
  agent: AgentConfig;
  userPrompt: string;
  apiKey?: string;
  onStepUpdate?: (step: ThoughtStep) => void;
}

export interface AgentExecutionResult {
  steps: ThoughtStep[];
  finalOutput: string;
  metrics: ExecutionMetrics;
}

export async function runAgentEngine(options: ExecuteAgentOptions): Promise<AgentExecutionResult> {
  const { agent, userPrompt, apiKey, onStepUpdate } = options;
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

  const effectiveApiKey = apiKey?.trim() || process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';

  // Check if API key is provided and valid
  if (effectiveApiKey && effectiveApiKey.length > 5) {
    try {
      addStep({
        type: 'thought',
        content: `Iniciando agente ${agent.avatar} ${agent.name} conectando a Gemini API (${agent.model})...`,
      });

      const ai = new GoogleGenAI({ apiKey: effectiveApiKey });
      
      // Determine tool declarations for Gemini if tools enabled
      let promptWithTools = `${agent.systemPrompt}\n\n[USER REQUEST]:\n${userPrompt}`;
      
      if (agent.tools && agent.tools.length > 0) {
        addStep({
          type: 'thought',
          content: `Herramientas activas asignadas a este agente: ${agent.tools.join(', ')}. Ejecutando análisis de capacidades...`,
        });

        // Run enabled tools first to enrich context if applicable
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

      // Map model string directly or fallback to supported Gemini models
      let geminiModelName = 'gemini-2.5-flash';
      if (agent.model === 'gemini-2.5-pro' || agent.model === 'gemini-1.5-pro') {
        geminiModelName = 'gemini-2.5-pro';
      } else {
        geminiModelName = 'gemini-2.5-flash';
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
        content: `[Gemini API Error]: ${err?.message || String(err)}. Conmutando a motor de simulación inteligente...`,
      });
      // Fall through to simulation engine below
    }
  }

  // --- SIMULATION ENGINE (Fallback & Demo Mode) ---
  addStep({
    type: 'thought',
    content: `Agente ${agent.avatar} **${agent.name}** iniciado (${agent.role}). Modo de análisis autónomo activado.`,
  });

  await delay(400);

  addStep({
    type: 'thought',
    content: `Analizando el prompt del usuario: "${userPrompt.substring(0, 80)}${userPrompt.length > 80 ? '...' : ''}" con temperatura ${agent.temperature} y modelo ${agent.model}.`,
  });

  await delay(600);

  // Execute assigned tools in simulation
  if (agent.tools && agent.tools.length > 0) {
    for (const toolName of agent.tools) {
      const toolDef = TOOLS[toolName];
      if (toolDef) {
        addStep({
          type: 'thought',
          content: `Invocando la herramienta autónoma [${toolDef.displayName}] para obtener información...`,
        });

        await delay(500);

        addStep({
          type: 'tool_call',
          toolName,
          content: `Ejecutando ${toolDef.displayName}...`,
          toolArgs: { query: userPrompt, prompt: userPrompt, text: userPrompt },
        });

        const toolResult = await toolDef.execute({ query: userPrompt, prompt: userPrompt, text: userPrompt });

        await delay(400);

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
    content: `Integrando resultados de herramientas y estructurando el informe final del agente...`,
  });

  await delay(600);

  const simulatedOutput = generateSimulatedOutput(agent, userPrompt);
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

function generateSimulatedOutput(agent: AgentConfig, prompt: string): string {
  const pLower = prompt.toLowerCase();

  if (agent.id === 'agent-developer' || agent.role.toLowerCase().includes('engineer') || pLower.includes('código') || pLower.includes('code')) {
    return `## 💻 Solución Técnica Desarrollada por ${agent.name}

Para resolver tu requerimiento: **"${prompt}"**, he diseñado la siguiente implementación limpia y optimizada en TypeScript:

\`\`\`typescript
// Solution generated by ${agent.name}
export interface AgentResponse<T> {
  success: boolean;
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

    // Core processing logic
    const result = await this.processPayload(payload);

    return {
      success: true,
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
- **Métricas integradas**: Mide latencia y consumo en tiempo real.
- **Escalabilidad**: Fácilmente extensible para pipelines de microservicios o agentes adicionales.`;
  }

  if (agent.id === 'agent-auditor' || agent.role.toLowerCase().includes('security')) {
    return `## 🔍 Reporte de Auditoría de Código y Seguridad

**Auditor:** ${agent.name} (${agent.role})  
**Objetivo de Inspección:** "${prompt}"

---

### 🛡️ Matriz de Evaluación de Calidad

| Criterio | Calificación | Estado | Observación |
| :--- | :---: | :---: | :--- |
| **Seguridad OWASP** | 9.5 / 10 | 🟢 Aprobado | Sin inyecciones ni datos sensibles expuestos |
| **Maniobra de Excepciones** | 8.8 / 10 | 🟢 Aprobado | Manejo seguro de bloques try/catch |
| **Optimizaciones Async** | 9.0 / 10 | 🟢 Aprobado | Llamadas no bloqueantes eficientes |

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
El componente o especificación cumple con los estándares exigidos para entornos de producción.`;
  }

  if (agent.id === 'agent-designer' || agent.role.toLowerCase().includes('designer')) {
    return `## 🎨 Concepto Visual & Sistema de Diseño UI/UX

**Diseñado por:** ${agent.name}  
**Concepto:** "${prompt}"

### 🌌 Paleta de Colores Neón & Glassmorphism
- **Fondo Principal**: \`#090d16\` (Deep Space Dark)
- **Superficie de Tarjeta**: \`rgba(255, 255, 255, 0.04)\` con \`backdrop-filter: blur(16px)\`
- **Acento Primario (Glow)**: \`#6366f1\` (Electric Indigo)
- **Acento Secundario**: \`#06b6d4\` (Cyber Cyan)

### 📐 Componente Destacado:
![Concepto Visual Generated](https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800&auto=format&fit=crop)

### ✨ Especificaciones de Interacción:
1. **Hover en tarjetas**: Elevación con \`transform: translateY(-4px)\` y brillo perimetral (\`box-shadow: 0 0 20px rgba(99, 102, 241, 0.3)\`).
2. **Pulsos de Estado**: Indicador de pulso verde en agente activo (\`animation: pulse 2s infinite\`).`;
  }

  if (agent.id === 'agent-log-sentinel' || agent.role.toLowerCase().includes('log') || pLower.includes('log') || pLower.includes('error')) {
    return `## 🚨 Análisis de Log & Diagnóstico SRE
**Inspector:** ${agent.name} (${agent.role})  
**Log Procesado:** \`${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}\`

---

### 📊 Nivel de Severidad: 🟠 **ERROR (Atención Requerida)**

### 🔍 Causa Raíz Detectada (Root Cause Analysis):
Se ha detectado una excepción en la capa de conexión/servicio al procesar solicitudes concurrentes. Los logs indican un tiempo de espera agotado (Timeout) o fallo de inicialización en el pool de recursos.

### 🛠️ Recomendación & Solución Inmediata:
1. **Verificar Límites de Conexión**: Incrementar el \`poolSize\` o ajustar el tiempo de respuesta del socket.
2. **Implementar Retry con Backoff Exponencial**:
\`\`\`typescript
// Parche sugerido por ${agent.name}
export async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 500): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise(r => setTimeout(r, delayMs));
    return withRetry(fn, retries - 1, delayMs * 2);
  }
}
\`\`\`

### 📌 Acciones Preventivas:
- Configurar alertas automáticas en Telegram para logs con nivel \`CRITICAL\` o \`ERROR\`.
- Revisar métricas de memoria RAM y latencia en el servidor.`;
  }

  return `## 📑 Informe Generado por ${agent.name}

**Rol:** ${agent.role}  
**Consulta Atendida:** "${prompt}"

---

### 💡 Análisis Principal
Basado en las mejores prácticas actuales de la industria, he procesado tu solicitud integrando razonamiento paso a paso e inspección de capacidades.

1. **Diagnóstico Inicial**: Se ha evaluado el escenario para determinar los componentes requeridos y la estrategia idónea.
2. **Sintesis de Resultados**: 
   - El sistema opera con alta estabilidad y respuesta fluida.
   - Las configuraciones de modelo (${agent.model}) aseguran un balance perfecto entre velocidad y precisión.

---

### 🚀 Recomendación del Agente
> "${agent.description}"

Puedes encadenar la salida de este agente con otro especialista mediante la pestaña de **Workflows** para completar un flujo integral.`;
}
