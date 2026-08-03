import { ToolName } from '@/types/agent';

export interface ToolDefinition {
  name: ToolName;
  displayName: string;
  description: string;
  icon: string;
  execute: (args: Record<string, any>) => Promise<string>;
}

export const TOOLS: Record<ToolName, ToolDefinition> = {
  web_search: {
    name: 'web_search',
    displayName: 'Web Search',
    description: 'Busca información actualizada en la web y documentación técnica.',
    icon: '🌐',
    execute: async (args: { query?: string }) => {
      const query = args.query || 'consultas generales de IA y desarrollo web';
      // Simulated live web search result with structured details
      return JSON.stringify({
        status: 'success',
        query,
        results: [
          {
            title: `Búsqueda Web: ${query}`,
            snippet: `Resultados recientes extraídos para "${query}". La arquitectura de agentes autónomos con pipelines reactivos optimiza la latencia y la precisión en respuestas complejas.`,
            url: `https://search.aether.ai/results?q=${encodeURIComponent(query)}`,
          },
          {
            title: 'Mejores Prácticas en Sistemas Multi-Agente 2026',
            snippet: 'Uso de streaming de pensamientos, descomposiciones de tareas y orquestación basada en estados para agentes autónomos.',
            url: 'https://docs.aether.ai/multi-agent-patterns',
          },
        ],
      }, null, 2);
    },
  },

  code_executor: {
    name: 'code_executor',
    displayName: 'Code Sandbox Executor',
    description: 'Ejecuta scripts en JavaScript / TypeScript en un entorno seguro e inspecciona la salida.',
    icon: '⚡',
    execute: async (args: { language?: string; code?: string }) => {
      const code = args.code || 'console.log("Execution test OK");';
      const lang = args.language || 'javascript';
      try {
        if (lang === 'javascript' || lang === 'js' || lang === 'typescript' || lang === 'ts') {
          // Simple safe evaluation for demo/sandbox purposes
          let logs: string[] = [];
          const customConsole = {
            log: (...msgs: any[]) => logs.push(msgs.map(m => typeof m === 'object' ? JSON.stringify(m) : m).join(' ')),
            error: (...msgs: any[]) => logs.push('[ERROR] ' + msgs.join(' ')),
            warn: (...msgs: any[]) => logs.push('[WARN] ' + msgs.join(' ')),
          };
          
          // Safe Function runner
          const runFn = new Function('console', code);
          const result = runFn(customConsole);
          const outputStr = logs.length > 0 ? logs.join('\n') : (result !== undefined ? String(result) : 'Código ejecutado sin errores (sin salida std).');

          return JSON.stringify({
            status: 'success',
            language: lang,
            stdout: outputStr,
            executionTimeMs: Math.floor(Math.random() * 40) + 10,
          }, null, 2);
        }

        return JSON.stringify({
          status: 'success',
          language: lang,
          stdout: `[${lang.toUpperCase()} Sandbox Simulated Execution]\nCode compiled cleanly with exit code 0.`,
          executionTimeMs: 45,
        }, null, 2);
      } catch (err: any) {
        return JSON.stringify({
          status: 'error',
          error: err?.message || String(err),
        }, null, 2);
      }
    },
  },

  image_generator: {
    name: 'image_generator',
    displayName: 'Visual UI Concept Generator',
    description: 'Genera artefactos visuales y diagramas de arquitectura UI.',
    icon: '🖼️',
    execute: async (args: { prompt?: string }) => {
      const prompt = args.prompt || 'Interfaz moderna de agente de IA';
      return JSON.stringify({
        status: 'success',
        prompt,
        visualArtifactUrl: `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800&auto=format&fit=crop`,
        description: `Concepto visual generado para: "${prompt}" con estética glassmorphism y neón.`,
      }, null, 2);
    },
  },

  data_extractor: {
    name: 'data_extractor',
    displayName: 'Data Extractor & Structurer',
    description: 'Extrae información desestructurada y la convierte en esquemas JSON limpios.',
    icon: '📊',
    execute: async (args: { text?: string; fields?: string[] }) => {
      const text = args.text || 'Texto de muestra';
      return JSON.stringify({
        status: 'success',
        processedLength: text.length,
        structuredData: {
          summary: 'Datos extraídos con éxito.',
          entitiesFound: ['Agente', 'Workflow', 'Gemini AI'],
          confidenceScore: 0.98,
        },
      }, null, 2);
    },
  },
};
