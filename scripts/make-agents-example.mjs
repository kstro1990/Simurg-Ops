/**
 * Genera `data/agents.example.json` a partir de `data/agents.json`, sustituyendo
 * las credenciales por marcadores.
 *
 * `data/` está ignorado por git porque guarda tokens en claro (ver .gitignore).
 * El fichero de ejemplo es la única excepción, y existe para que la forma de un
 * agente — modo MCP, `allowedTools`, system prompt — viaje con el repo sin que
 * viaje el secreto.
 *
 *   npm run agents:example
 *
 * Tras editar agentes desde la UI, vuelve a ejecutarlo y commitea el resultado.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'data/agents.json';
const TARGET = 'data/agents.example.json';

/** Marcador visible: hay que rellenarlo antes de usar el fichero. */
const placeholder = (key) => `<RELLENA_${key.toUpperCase()}>`;

/**
 * Todo lo que se redacta se apunta aquí, y al final se comprueba que ninguno de
 * esos valores sobrevive en la salida. Es la red de seguridad: si mañana alguien
 * añade un campo con credenciales y olvida tratarlo, la aserción no lo detecta,
 * pero al menos garantiza que lo que sí sabemos que es secreto no se cuela.
 */
const redacted = [];

function scrubRecord(record, prefix) {
  if (!record) return record;
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.trim()) redacted.push(value);
    out[key] = placeholder(`${prefix}_${key}`.replace(/[^a-zA-Z0-9_]/g, '_'));
  }
  return out;
}

/** Las rutas absolutas del host no son secretas, pero no sirven en otra máquina. */
function scrubArgs(args) {
  if (!Array.isArray(args)) return args;
  return args.map((arg) =>
    /^(\/Users\/|\/home\/|[A-Za-z]:\\)/.test(arg) ? '<RUTA_LOCAL>' : arg,
  );
}

const agents = JSON.parse(readFileSync(SOURCE, 'utf8'));

const example = agents.map((agent) => {
  const copy = structuredClone(agent);

  for (const server of copy.mcpServers ?? []) {
    if (server.env) server.env = scrubRecord(server.env, 'env');
    if (server.headers) server.headers = scrubRecord(server.headers, 'header');
    server.args = scrubArgs(server.args);
  }

  if (copy.telegramConfig?.botToken) {
    redacted.push(copy.telegramConfig.botToken);
    copy.telegramConfig.botToken = placeholder('telegram_bot_token');
  }

  return copy;
});

const output = JSON.stringify(example, null, 2) + '\n';

const leaked = redacted.filter((value) => output.includes(value));
if (leaked.length) {
  console.error(`ABORTADO: ${leaked.length} credencial(es) siguen en la salida.`);
  process.exit(1);
}

writeFileSync(TARGET, output);
console.log(
  `${TARGET}: ${example.length} agentes, ${redacted.length} credencial(es) sustituidas.`,
);
