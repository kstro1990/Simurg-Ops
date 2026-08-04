#!/usr/bin/env npx tsx
/**
 * AI Agent Harness — Terminal CLI
 *
 * Execute AI agents directly from your terminal without starting the web server.
 *
 * Usage:
 *   npx tsx cli/harness.ts                              # Interactive mode
 *   npx tsx cli/harness.ts --agent agent-developer --prompt "Hello"  # Direct mode
 *   npx tsx cli/harness.ts --list                       # List agents
 *   npx tsx cli/harness.ts --help                       # Show help
 */

import * as path from 'path';
import * as fs from 'fs';
import { AgentConfig, ProviderKeys, getProviderFromModel } from '@/types/agent';
import { runAgentEngine } from '@/lib/agentEngine';
import { DEFAULT_AGENTS } from '@/lib/presets';
import { GoogleGenAI } from '@google/genai';
import { directBridge } from './cliEngine';
import {
  printBanner,
  printHelp,
  printSeparator,
  printAgentList,
  printStep,
  printMetrics,
  printError,
  printSuccess,
  prompt,
  Spinner,
  colors,
  c,
} from './ui';

// ── Load .env file if present ─────────────────────────────────────────

function loadEnvFile(): void {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'cli', '.env'),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim();
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

// ── Load agents (presets + stored) ────────────────────────────────────

function loadAgents(): AgentConfig[] {
  const agents = [...DEFAULT_AGENTS];

  // Try loading stored custom agents from data/agents.json
  const storedPath = path.resolve(process.cwd(), 'data', 'agents.json');
  if (fs.existsSync(storedPath)) {
    try {
      const stored: AgentConfig[] = JSON.parse(fs.readFileSync(storedPath, 'utf-8'));
      // Add only custom agents not already in presets
      const presetIds = new Set(agents.map(a => a.id));
      for (const agent of stored) {
        if (!presetIds.has(agent.id)) {
          agents.push(agent);
        }
      }
    } catch {
      // Ignore malformed file
    }
  }

  return agents;
}

// ── Build provider keys from environment ──────────────────────────────

function getProviderKeysFromEnv(): ProviderKeys {
  return {
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    copilotToken: process.env.GITHUB_TOKEN || '',
  };
}

// ── Execute agent ─────────────────────────────────────────────────────

async function executeAgent(agent: AgentConfig, userPrompt: string): Promise<void> {
  const providerKeys = getProviderKeysFromEnv();
  const provider = getProviderFromModel(agent.model);

  console.log('');
  console.log(`  ${c(colors.bold + colors.brightWhite, `Executing: ${agent.avatar} ${agent.name}`)}`);
  console.log(`  ${c(colors.dim, `Provider: ${provider} | Model: ${agent.model} | Temp: ${agent.temperature}`)}`);
  printSeparator();

  const spinner = new Spinner('Processing...');
  spinner.start();

  try {
    const result = await runAgentEngine({
      agent,
      userPrompt,
      apiKey: providerKeys.geminiApiKey,
      providerKeys,
      bridgeFn: directBridge,
      onStepUpdate: (step) => {
        spinner.stop();
        printStep(step.type, step.content, step.toolName);
        if (step.type !== 'output' && step.type !== 'error') {
          spinner.update('Processing next step...');
          spinner.start();
        }
      },
    });

    spinner.stop();

    // Print final output if not already printed via steps
    const lastStep = result.steps[result.steps.length - 1];
    if (!lastStep || lastStep.type !== 'output') {
      printStep('output', result.finalOutput);
    }

    // Print metrics
    printMetrics(result.metrics);

  } catch (err: any) {
    spinner.stop();
    printError(err.message || String(err));
  }
}

// ── Parse CLI arguments ───────────────────────────────────────────────

function parseArgs(): { agentId?: string; prompt?: string; list?: boolean; help?: boolean } {
  const args = process.argv.slice(2);
  const result: { agentId?: string; prompt?: string; list?: boolean; help?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--agent':
      case '-a':
        result.agentId = args[++i];
        break;
      case '--prompt':
      case '-p':
        result.prompt = args[++i];
        break;
      case '--list':
      case '-l':
        result.list = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
    }
  }

  return result;
}

// ── Interactive mode ──────────────────────────────────────────────────

async function interactiveMode(agents: AgentConfig[]): Promise<void> {
  printBanner();

  // Show available API keys status
  const keys = getProviderKeysFromEnv();
  console.log(`\n  ${c(colors.bold + colors.brightWhite, '🔑  API Keys Status')}`);
  const keyStatus = (name: string, value?: string) => {
    const status = value && value.length > 5
      ? c(colors.brightGreen, '● Connected')
      : c(colors.dim, '○ Not set');
    console.log(`     ${c(colors.white, name.padEnd(18))} ${status}`);
  };
  keyStatus('Gemini', keys.geminiApiKey);
  keyStatus('Anthropic', keys.anthropicApiKey);
  keyStatus('OpenAI', keys.openaiApiKey);
  keyStatus('GitHub/Copilot', keys.copilotToken);

  // Main interaction loop
  let running = true;
  while (running) {
    printAgentList(agents);

    const choice = await prompt(`Select agent ${c(colors.dim, '(number)')}, or ${c(colors.dim, '"q" to quit')}:`);

    if (choice.toLowerCase() === 'q' || choice.toLowerCase() === 'quit' || choice.toLowerCase() === 'exit') {
      running = false;
      printSuccess('Session ended. ¡Hasta la próxima! 👋');
      break;
    }

    const agentIndex = parseInt(choice, 10) - 1;
    if (isNaN(agentIndex) || agentIndex < 0 || agentIndex >= agents.length) {
      printError(`Invalid selection. Enter a number between 1 and ${agents.length}.`);
      continue;
    }

    const selectedAgent = agents[agentIndex];
    console.log(`\n  ${c(colors.brightCyan, '→')} Selected: ${selectedAgent.avatar} ${c(colors.bold, selectedAgent.name)}`);

    const userPrompt = await prompt('Enter your prompt:');
    if (!userPrompt) {
      printError('Prompt cannot be empty.');
      continue;
    }

    await executeAgent(selectedAgent, userPrompt);

    console.log('');
    const again = await prompt(`Run another agent? ${c(colors.dim, '(y/n)')}:`);
    if (again.toLowerCase() !== 'y' && again.toLowerCase() !== 'yes' && again.toLowerCase() !== 's' && again.toLowerCase() !== 'si') {
      running = false;
      printSuccess('Session ended. ¡Hasta la próxima! 👋');
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvFile();

  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const agents = loadAgents();

  if (args.list) {
    printBanner();
    printAgentList(agents);
    process.exit(0);
  }

  // Direct mode: --agent and --prompt provided
  if (args.agentId && args.prompt) {
    const agent = agents.find(a => a.id === args.agentId || a.name.toLowerCase() === args.agentId?.toLowerCase());
    if (!agent) {
      printError(`Agent "${args.agentId}" not found. Use --list to see available agents.`);
      process.exit(1);
    }
    await executeAgent(agent, args.prompt);
    process.exit(0);
  }

  // If only one of --agent or --prompt is provided, warn
  if (args.agentId && !args.prompt) {
    printError('Missing --prompt. Both --agent and --prompt are required for direct mode.');
    process.exit(1);
  }
  if (args.prompt && !args.agentId) {
    printError('Missing --agent. Both --agent and --prompt are required for direct mode.');
    process.exit(1);
  }

  // Interactive mode
  await interactiveMode(agents);
}

main().catch((err) => {
  printError(err.message || String(err));
  process.exit(1);
});
