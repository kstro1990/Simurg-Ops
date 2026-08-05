/**
 * CLI Terminal UI Utilities
 * Rich terminal output with ANSI colors, spinners, and formatting.
 * Zero external dependencies.
 */

// ── ANSI Color Codes ──────────────────────────────────────────────────

const ESC = '\x1b[';

export const colors = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  underline: `${ESC}4m`,

  // Foreground
  black: `${ESC}30m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,

  // Bright foreground
  brightBlack: `${ESC}90m`,
  brightRed: `${ESC}91m`,
  brightGreen: `${ESC}92m`,
  brightYellow: `${ESC}93m`,
  brightBlue: `${ESC}94m`,
  brightMagenta: `${ESC}95m`,
  brightCyan: `${ESC}96m`,
  brightWhite: `${ESC}97m`,

  // Background
  bgBlack: `${ESC}40m`,
  bgRed: `${ESC}41m`,
  bgGreen: `${ESC}42m`,
  bgYellow: `${ESC}43m`,
  bgBlue: `${ESC}44m`,
  bgMagenta: `${ESC}45m`,
  bgCyan: `${ESC}46m`,
  bgWhite: `${ESC}47m`,
};

// ── Styled text helpers ───────────────────────────────────────────────

export function c(color: string, text: string): string {
  return `${color}${text}${colors.reset}`;
}

export function bold(text: string): string {
  return c(colors.bold, text);
}

export function dim(text: string): string {
  return c(colors.dim, text);
}

// ── Banner / Header ───────────────────────────────────────────────────

export function printBanner(): void {
  const banner = `
${c(colors.brightCyan, '╔══════════════════════════════════════════════════════════╗')}
${c(colors.brightCyan, '║')}  ${c(colors.bold + colors.brightWhite, '🤖  AI Agent Harness — Terminal CLI')}                    ${c(colors.brightCyan, '║')}
${c(colors.brightCyan, '║')}  ${c(colors.dim + colors.white, 'Execute AI agents directly from your terminal')}          ${c(colors.brightCyan, '║')}
${c(colors.brightCyan, '╚══════════════════════════════════════════════════════════╝')}`;
  console.log(banner);
}

export function printSeparator(): void {
  console.log(c(colors.dim, '─'.repeat(60)));
}

// ── Spinner ───────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIdx = 0;
  private message: string;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    this.frameIdx = 0;
    process.stdout.write('\x1b[?25l'); // hide cursor
    this.interval = setInterval(() => {
      const frame = SPINNER_FRAMES[this.frameIdx % SPINNER_FRAMES.length];
      process.stdout.write(`\r  ${c(colors.brightCyan, frame)} ${this.message}`);
      this.frameIdx++;
    }, 80);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\r\x1b[2K'); // clear line
    process.stdout.write('\x1b[?25h'); // show cursor
    if (finalMessage) {
      console.log(`  ${c(colors.brightGreen, '✔')} ${finalMessage}`);
    }
  }
}

// ── Step display ──────────────────────────────────────────────────────

const STEP_ICONS: Record<string, string> = {
  thought: '💭',
  tool_call: '🔧',
  tool_result: '📦',
  output: '✅',
  error: '❌',
};

const STEP_COLORS: Record<string, string> = {
  thought: colors.brightBlue,
  tool_call: colors.brightYellow,
  tool_result: colors.brightMagenta,
  output: colors.brightGreen,
  error: colors.brightRed,
};

export function printStep(type: string, content: string, toolName?: string): void {
  const icon = STEP_ICONS[type] || '•';
  const color = STEP_COLORS[type] || colors.white;
  const label = type.toUpperCase().replace('_', ' ');
  const toolTag = toolName ? c(colors.dim, ` [${toolName}]`) : '';

  console.log(`\n  ${icon} ${c(color + colors.bold, label)}${toolTag}`);

  // Indent content lines
  const lines = content.split('\n');
  for (const line of lines) {
    console.log(`     ${c(colors.white, line)}`);
  }
}

// ── Metrics table ─────────────────────────────────────────────────────

export function printMetrics(metrics: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}): void {
  console.log('');
  printSeparator();
  console.log(`  ${c(colors.bold + colors.brightWhite, '📊  Execution Metrics')}`);
  printSeparator();

  const rows = [
    ['Prompt Tokens', String(metrics.promptTokens)],
    ['Completion Tokens', String(metrics.completionTokens)],
    ['Total Tokens', String(metrics.totalTokens)],
    ['Latency', `${metrics.latencyMs}ms`],
  ];

  for (const [label, value] of rows) {
    console.log(`  ${c(colors.dim, label.padEnd(22))} ${c(colors.brightCyan, value)}`);
  }

  printSeparator();
}

// ── Agent list display ────────────────────────────────────────────────

export function printAgentList(agents: { id: string; name: string; avatar: string; role: string; model: string }[]): void {
  console.log(`\n  ${c(colors.bold + colors.brightWhite, '📋  Available Agents')}\n`);

  agents.forEach((agent, i) => {
    const idx = c(colors.brightCyan, String(i + 1).padStart(2));
    const name = c(colors.bold + colors.white, agent.name);
    const model = c(colors.dim, `(${agent.model})`);
    console.log(`  ${idx}. ${agent.avatar} ${name} ${model}`);
    console.log(`      ${c(colors.dim, agent.role)}`);
  });
  console.log('');
}

// ── Prompt input ──────────────────────────────────────────────────────

import * as readline from 'readline';

export function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`  ${c(colors.brightYellow, '?')} ${question} `, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Error display ─────────────────────────────────────────────────────

export function printError(message: string): void {
  console.error(`\n  ${c(colors.brightRed, '✖ ERROR:')} ${message}`);
}

export function printSuccess(message: string): void {
  console.log(`\n  ${c(colors.brightGreen, '✔')} ${message}`);
}

// ── Help text ─────────────────────────────────────────────────────────

export function printHelp(): void {
  console.log(`
${c(colors.bold + colors.brightWhite, 'AI Agent Harness — Terminal CLI')}

${c(colors.bold, 'USAGE:')}
  npx tsx cli/harness.ts [OPTIONS]

${c(colors.bold, 'OPTIONS:')}
  ${c(colors.brightCyan, '--agent <id>')}       Agent ID to run (e.g. agent-developer)
  ${c(colors.brightCyan, '--prompt <text>')}     Prompt to send to the agent
  ${c(colors.brightCyan, '--list')}              List available agents and exit
  ${c(colors.brightCyan, '--help')}              Show this help message

${c(colors.bold, 'ENVIRONMENT VARIABLES:')}
  ${c(colors.brightYellow, 'GEMINI_API_KEY')}      Google Gemini API key
  ${c(colors.brightYellow, 'ANTHROPIC_API_KEY')}   Anthropic (Claude) API key
  ${c(colors.brightYellow, 'OPENAI_API_KEY')}      OpenAI API key
  ${c(colors.brightYellow, 'COPILOT_GITHUB_TOKEN')} GitHub token for the Copilot CLI
                        (optional: "copilot login" is the usual route)

${c(colors.bold, 'EXAMPLES:')}
  ${c(colors.dim, '# Interactive mode')}
  npx tsx cli/harness.ts

  ${c(colors.dim, '# Direct execution')}
  npx tsx cli/harness.ts --agent agent-developer --prompt "Create a REST API"

  ${c(colors.dim, '# List agents')}
  npx tsx cli/harness.ts --list
`);
}
