import { ToolName } from '@/types/agent';

export interface ToolDefinition {
  name: ToolName;
  displayName: string;
  description: string;
  icon: string;
  /** true si la herramienta devuelve datos inventados en vez de reales. */
  simulated: boolean;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export const TOOLS: Record<ToolName, ToolDefinition> = {
  web_search: {
    name: 'web_search',
    displayName: 'Web Search (simulada)',
    description:
      'DEMO: devuelve resultados de búsqueda inventados. No consulta la web; sirve para probar el flujo de herramientas.',
    icon: '🌐',
    simulated: true,
    execute: async (args) => {
      const query = asString(args.query) || 'consultas generales de IA y desarrollo web';
      return JSON.stringify(
        {
          status: 'simulated',
          warning: 'Resultados generados localmente. Esta herramienta no consulta la web.',
          query,
          results: [
            {
              title: `Búsqueda simulada: ${query}`,
              snippet: `Resultado de ejemplo para "${query}". No proviene de ninguna búsqueda real.`,
              url: null,
            },
          ],
        },
        null,
        2
      );
    },
  },

  code_executor: {
    name: 'code_executor',
    displayName: 'Code Sandbox Executor',
    description:
      'Ejecuta JavaScript en el proceso del servidor. ATENCIÓN: no hay aislamiento real; el código tiene acceso al runtime de Node.',
    icon: '⚡',
    simulated: false,
    execute: async (args) => {
      const code = asString(args.code);
      const lang = asString(args.language) || 'javascript';

      // Solo se ejecuta si viene código explícito. El motor llama a todas las
      // herramientas con el prompt del usuario en `text`/`query`/`prompt`, y
      // ejecutar eso como código sería absurdo además de peligroso.
      if (!code) {
        return JSON.stringify(
          {
            status: 'skipped',
            reason:
              'No se recibió el parámetro `code`. Esta herramienta solo ejecuta código explícito.',
          },
          null,
          2
        );
      }

      const isJs = ['javascript', 'js', 'typescript', 'ts'].includes(lang);
      if (!isJs) {
        return JSON.stringify(
          { status: 'unsupported', language: lang, reason: 'Solo se soporta JavaScript.' },
          null,
          2
        );
      }

      try {
        const logs: string[] = [];
        const customConsole = {
          log: (...msgs: unknown[]) =>
            logs.push(
              msgs.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' ')
            ),
          error: (...msgs: unknown[]) => logs.push('[ERROR] ' + msgs.map(String).join(' ')),
          warn: (...msgs: unknown[]) => logs.push('[WARN] ' + msgs.map(String).join(' ')),
        };

        // NO es un sandbox: `new Function` corre con todos los privilegios del
        // proceso. Se mantiene porque esta app está pensada para uso local con
        // código propio; no la expongas a entradas de terceros.
        const runFn = new Function('console', code);
        const result = runFn(customConsole);
        const stdout =
          logs.length > 0
            ? logs.join('\n')
            : result !== undefined
              ? String(result)
              : 'Código ejecutado sin errores (sin salida std).';

        return JSON.stringify({ status: 'success', language: lang, stdout }, null, 2);
      } catch (err) {
        return JSON.stringify(
          { status: 'error', error: err instanceof Error ? err.message : String(err) },
          null,
          2
        );
      }
    },
  },

  image_generator: {
    name: 'image_generator',
    displayName: 'Visual UI Concept Generator (simulada)',
    description:
      'DEMO: no genera imágenes. Devuelve una descripción textual del concepto visual solicitado.',
    icon: '🖼️',
    simulated: true,
    execute: async (args) => {
      const prompt = asString(args.prompt) || 'Interfaz moderna de agente de IA';
      return JSON.stringify(
        {
          status: 'simulated',
          warning: 'No se ha generado ninguna imagen. Esta herramienta es un marcador de posición.',
          prompt,
          description: `Concepto visual descrito para: "${prompt}".`,
        },
        null,
        2
      );
    },
  },

  data_extractor: {
    name: 'data_extractor',
    displayName: 'Data Extractor (simulada)',
    description:
      'DEMO: devuelve un esquema de ejemplo. No analiza realmente el texto que recibe.',
    icon: '📊',
    simulated: true,
    execute: async (args) => {
      const text = asString(args.text) || '';
      return JSON.stringify(
        {
          status: 'simulated',
          warning: 'Datos de ejemplo. Esta herramienta no realiza extracción real.',
          processedLength: text.length,
        },
        null,
        2
      );
    },
  },
};
