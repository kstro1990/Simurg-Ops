import fs from 'fs/promises';
import path from 'path';
import { AgentConfig, WorkflowConfig, ExecutionRun, ProviderKeys, normalizeModel } from '@/types/agent';
import {
  ConversationMessage,
  ConversationStore,
  CONVERSATION_MESSAGE_CAP,
  CONVERSATION_THREAD_CAP,
  conversationId,
} from '@/types/conversation';
import { DEFAULT_AGENTS, DEFAULT_WORKFLOWS } from '@/lib/presets';

const DATA_DIR = path.join(process.cwd(), 'data');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const WORKFLOWS_FILE = path.join(DATA_DIR, 'workflows.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const TELEGRAM_OFFSETS_FILE = path.join(DATA_DIR, 'telegram-offsets.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');

/** El historial se reescribe entero en cada ejecución: sin tope crece sin límite. */
const HISTORY_LIMIT = 200;

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Serializa las operaciones sobre un mismo fichero. Sin esto, dos ejecuciones
 * concurrentes hacen read-modify-write a la vez y la última pisa a la primera.
 */
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(file) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // La cadena de bloqueo no debe romperse si una operación falla.
  locks.set(
    file,
    next.catch(() => undefined)
  );
  return next;
}

/**
 * Escribe a un temporal y renombra. `rename` es atómico en POSIX, así que un
 * fallo a mitad de escritura nunca deja el fichero destino truncado.
 */
async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await ensureDataDir();
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}

interface ReadResult<T> {
  value: T | null;
  /** true cuando el fichero no existe (primer arranque), false si existe pero no se pudo leer. */
  missing: boolean;
}

async function readJson<T>(file: string): Promise<ReadResult<T>> {
  await ensureDataDir();
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { value: null, missing: true };
    }
    console.error(`[serverStorage] No se pudo leer ${file}:`, err);
    return { value: null, missing: false };
  }

  try {
    return { value: JSON.parse(raw) as T, missing: false };
  } catch (err) {
    // El fichero existe pero está corrupto. NO lo sobrescribimos con los
    // presets: eso borraría los agentes del usuario. Lo apartamos para que
    // pueda recuperarlo a mano.
    const quarantine = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    console.error(`[serverStorage] ${file} está corrupto; se mueve a ${quarantine}`, err);
    await fs.rename(file, quarantine).catch(() => undefined);
    return { value: null, missing: true };
  }
}

// --- AGENTES ---

/** Reasigna modelos retirados para que los agentes guardados sigan funcionando. */
function migrateAgents(agents: AgentConfig[]): AgentConfig[] {
  return agents.map((agent) => ({ ...agent, model: normalizeModel(agent.model) }));
}

export async function getStoredAgents(): Promise<AgentConfig[]> {
  const { value, missing } = await readJson<AgentConfig[]>(AGENTS_FILE);

  if (Array.isArray(value)) {
    const migrated = migrateAgents(value);
    // Si la migración cambió algo, persistirlo para no repetirla en cada carga.
    if (JSON.stringify(migrated) !== JSON.stringify(value)) {
      await saveStoredAgents(migrated);
    }
    return migrated;
  }

  if (missing) {
    const seeded = migrateAgents(DEFAULT_AGENTS);
    await saveStoredAgents(seeded);
    return seeded;
  }

  // Error de E/S transitorio: devolvemos los presets pero sin escribir nada.
  return migrateAgents(DEFAULT_AGENTS);
}

export async function saveStoredAgents(agents: AgentConfig[]): Promise<void> {
  await withLock(AGENTS_FILE, () => writeJsonAtomic(AGENTS_FILE, agents));
}

export async function saveOrUpdateAgent(agent: AgentConfig): Promise<AgentConfig[]> {
  return withLock(AGENTS_FILE, async () => {
    const { value } = await readJson<AgentConfig[]>(AGENTS_FILE);
    const agents = Array.isArray(value) ? value : DEFAULT_AGENTS;
    const index = agents.findIndex((a) => a.id === agent.id);
    const updated = index >= 0 ? agents.map((a, i) => (i === index ? agent : a)) : [agent, ...agents];
    await writeJsonAtomic(AGENTS_FILE, updated);
    return updated;
  });
}

export async function deleteStoredAgent(agentId: string): Promise<AgentConfig[]> {
  const updated = await withLock(AGENTS_FILE, async () => {
    const { value } = await readJson<AgentConfig[]>(AGENTS_FILE);
    const agents = Array.isArray(value) ? value : DEFAULT_AGENTS;
    const next = agents.filter((a) => a.id !== agentId);
    await writeJsonAtomic(AGENTS_FILE, next);
    return next;
  });

  // Fuera del lock de agentes: son ficheros distintos con locks distintos, y
  // anidarlos invitaría a un interbloqueo en cuanto alguien los reordene.
  await deleteAgentConversations(agentId);

  return updated;
}

// --- WORKFLOWS ---
export async function getStoredWorkflows(): Promise<WorkflowConfig[]> {
  const { value, missing } = await readJson<WorkflowConfig[]>(WORKFLOWS_FILE);

  if (Array.isArray(value) && value.length > 0) return value;

  if (missing) {
    await saveStoredWorkflows(DEFAULT_WORKFLOWS);
  }
  return DEFAULT_WORKFLOWS;
}

export async function saveStoredWorkflows(workflows: WorkflowConfig[]): Promise<void> {
  await withLock(WORKFLOWS_FILE, () => writeJsonAtomic(WORKFLOWS_FILE, workflows));
}

export async function deleteStoredWorkflow(workflowId: string): Promise<WorkflowConfig[]> {
  return withLock(WORKFLOWS_FILE, async () => {
    const { value } = await readJson<WorkflowConfig[]>(WORKFLOWS_FILE);
    const workflows = Array.isArray(value) ? value : DEFAULT_WORKFLOWS;
    const updated = workflows.filter((w) => w.id !== workflowId);
    await writeJsonAtomic(WORKFLOWS_FILE, updated);
    return updated;
  });
}

// --- HISTORIAL ---
export async function getStoredHistory(): Promise<ExecutionRun[]> {
  const { value } = await readJson<ExecutionRun[]>(HISTORY_FILE);
  return Array.isArray(value) ? value : [];
}

export async function saveStoredHistory(history: ExecutionRun[]): Promise<void> {
  await withLock(HISTORY_FILE, () =>
    writeJsonAtomic(HISTORY_FILE, history.slice(0, HISTORY_LIMIT))
  );
}

export async function addHistoryRun(run: ExecutionRun): Promise<ExecutionRun[]> {
  return withLock(HISTORY_FILE, async () => {
    const { value } = await readJson<ExecutionRun[]>(HISTORY_FILE);
    const history = Array.isArray(value) ? value : [];
    const updated = [run, ...history].slice(0, HISTORY_LIMIT);
    await writeJsonAtomic(HISTORY_FILE, updated);
    return updated;
  });
}

// --- AJUSTES ---
export async function getStoredSettings(): Promise<ProviderKeys> {
  const { value } = await readJson<ProviderKeys>(SETTINGS_FILE);
  return value && typeof value === 'object' ? value : {};
}

export async function saveStoredSettings(keys: ProviderKeys): Promise<ProviderKeys> {
  return withLock(SETTINGS_FILE, async () => {
    const { value } = await readJson<ProviderKeys>(SETTINGS_FILE);
    const current = value && typeof value === 'object' ? value : {};
    const updated = { ...current, ...keys };
    await writeJsonAtomic(SETTINGS_FILE, updated);
    return updated;
  });
}

// --- CONVERSACIONES ---
// Contexto vivo del modelo, separado del historial: `history.json` es un log de
// auditoría con tope global de 200 entradas, así que un bot tranquilo perdería
// su hilo en cuanto otro agente se pusiera a trabajar.
//
// Solo texto plano: ver la nota de invariante en types/conversation.ts.

export async function getStoredConversations(): Promise<ConversationStore> {
  const { value } = await readJson<ConversationStore>(CONVERSATIONS_FILE);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Mensajes del hilo en orden cronológico. Nunca lanza: si la memoria no se
 * puede leer, la ejecución sigue sin contexto en vez de fallar.
 */
export async function getConversationMessages(
  agentId: string,
  threadKey: string
): Promise<ConversationMessage[]> {
  try {
    const store = await getStoredConversations();
    const thread = store[conversationId(agentId, threadKey)];
    return Array.isArray(thread?.messages) ? thread.messages : [];
  } catch (err) {
    console.error('[serverStorage] No se pudo leer la conversación:', err);
    return [];
  }
}

/**
 * Añade el turno completo (usuario + respuesta) en un único read-modify-write
 * bajo el lock. Escribirlos por separado dejaría, ante un fallo intermedio, un
 * mensaje de usuario colgado que rompe la alternancia de roles y provoca un 400
 * en la siguiente petición.
 */
export async function appendConversationTurn(
  agentId: string,
  threadKey: string,
  turn: { user: ConversationMessage; assistant?: ConversationMessage }
): Promise<ConversationMessage[]> {
  return withLock(CONVERSATIONS_FILE, async () => {
    const { value } = await readJson<ConversationStore>(CONVERSATIONS_FILE);
    const store: ConversationStore =
      value && typeof value === 'object' && !Array.isArray(value) ? value : {};

    const key = conversationId(agentId, threadKey);
    const now = new Date().toISOString();
    const existing = store[key];

    const messages = [
      ...(Array.isArray(existing?.messages) ? existing.messages : []),
      turn.user,
      ...(turn.assistant ? [turn.assistant] : []),
    ].slice(-CONVERSATION_MESSAGE_CAP);

    store[key] = {
      agentId,
      threadKey,
      messages,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    // Desalojo por antigüedad: sin esto, un grupo que genere chat_id nuevos sin
    // parar haría crecer el fichero indefinidamente.
    const keys = Object.keys(store);
    if (keys.length > CONVERSATION_THREAD_CAP) {
      keys
        .sort((a, b) => (store[a].updatedAt ?? '').localeCompare(store[b].updatedAt ?? ''))
        .slice(0, keys.length - CONVERSATION_THREAD_CAP)
        .forEach((stale) => delete store[stale]);
    }

    await writeJsonAtomic(CONVERSATIONS_FILE, store);
    return messages;
  });
}

/** Borra el hilo. Devuelve true si existía. */
export async function resetConversation(agentId: string, threadKey: string): Promise<boolean> {
  return withLock(CONVERSATIONS_FILE, async () => {
    const { value } = await readJson<ConversationStore>(CONVERSATIONS_FILE);
    const store: ConversationStore =
      value && typeof value === 'object' && !Array.isArray(value) ? value : {};

    const key = conversationId(agentId, threadKey);
    if (!store[key]) return false;

    delete store[key];
    await writeJsonAtomic(CONVERSATIONS_FILE, store);
    return true;
  });
}

/** Borra todos los hilos de un agente. Se llama al eliminarlo. */
export async function deleteAgentConversations(agentId: string): Promise<void> {
  await withLock(CONVERSATIONS_FILE, async () => {
    const { value } = await readJson<ConversationStore>(CONVERSATIONS_FILE);
    const store: ConversationStore =
      value && typeof value === 'object' && !Array.isArray(value) ? value : {};

    let changed = false;
    for (const [key, thread] of Object.entries(store)) {
      if (thread.agentId === agentId) {
        delete store[key];
        changed = true;
      }
    }

    if (changed) await writeJsonAtomic(CONVERSATIONS_FILE, store);
  });
}

// --- OFFSETS DE TELEGRAM ---
// Deben vivir en disco: si se guardan en el estado de React se reinician al
// recargar la página y el bot reprocesa mensajes ya atendidos.
export type TelegramOffsets = Record<string, number>;

export async function getTelegramOffsets(): Promise<TelegramOffsets> {
  const { value } = await readJson<TelegramOffsets>(TELEGRAM_OFFSETS_FILE);
  return value && typeof value === 'object' ? value : {};
}

/** Fusiona offsets quedándose siempre con el mayor visto por agente. */
export async function mergeTelegramOffsets(offsets: TelegramOffsets): Promise<TelegramOffsets> {
  return withLock(TELEGRAM_OFFSETS_FILE, async () => {
    const { value } = await readJson<TelegramOffsets>(TELEGRAM_OFFSETS_FILE);
    const current = value && typeof value === 'object' ? value : {};
    const updated: TelegramOffsets = { ...current };
    for (const [agentId, offset] of Object.entries(offsets)) {
      updated[agentId] = Math.max(updated[agentId] ?? 0, offset);
    }
    await writeJsonAtomic(TELEGRAM_OFFSETS_FILE, updated);
    return updated;
  });
}
