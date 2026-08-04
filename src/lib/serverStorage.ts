import fs from 'fs/promises';
import path from 'path';
import { AgentConfig, WorkflowConfig, ExecutionRun, ProviderKeys } from '@/types/agent';
import { DEFAULT_AGENTS, DEFAULT_WORKFLOWS } from '@/lib/presets';

const DATA_DIR = path.join(process.cwd(), 'data');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const WORKFLOWS_FILE = path.join(DATA_DIR, 'workflows.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('Error creating data directory:', err);
  }
}

// --- AGENTS STORAGE ---
export async function getStoredAgents(): Promise<AgentConfig[]> {
  await ensureDataDir();
  try {
    const data = await fs.readFile(AGENTS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const existingIds = new Set(parsed.map((a: AgentConfig) => a.id));
      const missingDefaults = DEFAULT_AGENTS.filter((def) => !existingIds.has(def.id));
      if (missingDefaults.length > 0) {
        const merged = [...parsed, ...missingDefaults];
        await saveStoredAgents(merged);
        return merged;
      }
      return parsed;
    }
  } catch (err) {
    // File doesn't exist or corrupt, seed defaults
    await saveStoredAgents(DEFAULT_AGENTS);
  }
  return DEFAULT_AGENTS;
}

export async function saveStoredAgents(agents: AgentConfig[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf-8');
}

export async function saveOrUpdateAgent(agent: AgentConfig): Promise<AgentConfig[]> {
  const agents = await getStoredAgents();
  const index = agents.findIndex((a) => a.id === agent.id);
  let updated: AgentConfig[];
  if (index >= 0) {
    updated = [...agents];
    updated[index] = agent;
  } else {
    updated = [agent, ...agents];
  }
  await saveStoredAgents(updated);
  return updated;
}

export async function deleteStoredAgent(agentId: string): Promise<AgentConfig[]> {
  const agents = await getStoredAgents();
  const updated = agents.filter((a) => a.id !== agentId);
  await saveStoredAgents(updated);
  return updated;
}

// --- WORKFLOWS STORAGE ---
export async function getStoredWorkflows(): Promise<WorkflowConfig[]> {
  await ensureDataDir();
  try {
    const data = await fs.readFile(WORKFLOWS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    await saveStoredWorkflows(DEFAULT_WORKFLOWS);
  }
  return DEFAULT_WORKFLOWS;
}

export async function saveStoredWorkflows(workflows: WorkflowConfig[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(WORKFLOWS_FILE, JSON.stringify(workflows, null, 2), 'utf-8');
}

// --- HISTORY STORAGE ---
export async function getStoredHistory(): Promise<ExecutionRun[]> {
  await ensureDataDir();
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    // empty history by default
  }
  return [];
}

export async function saveStoredHistory(history: ExecutionRun[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

export async function addHistoryRun(run: ExecutionRun): Promise<ExecutionRun[]> {
  const history = await getStoredHistory();
  const updated = [run, ...history];
  await saveStoredHistory(updated);
  return updated;
}

// --- SETTINGS STORAGE ---
export async function getStoredSettings(): Promise<ProviderKeys> {
  await ensureDataDir();
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

export async function saveStoredSettings(keys: ProviderKeys): Promise<ProviderKeys> {
  await ensureDataDir();
  const current = await getStoredSettings();
  const updated = { ...current, ...keys };
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}
