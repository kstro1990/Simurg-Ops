# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Next.js dev server on http://localhost:3000
npm run build    # production build
npm start        # serve the production build
npm run lint     # eslint (flat config, eslint.config.mjs)

npx tsx cli/harness.ts --help    # terminal CLI (no web server needed)
```

`node`/`npm` may not be on the default PATH; they live under `~/.nvm/versions/node/<version>/bin`.

No test framework is configured — there are no tests to run.

## Stack notes

- Next.js **16.2.12** App Router + React 19. Per `AGENTS.md`, consult `node_modules/next/dist/docs/` before writing Next-specific code; this major differs from older conventions.
- Tailwind **v4** — configured entirely through `@import "tailwindcss"` in `src/app/globals.css`. There is no `tailwind.config.*`, and `@tailwindcss/typography` is **not** installed: markdown output is styled by the hand-written `.markdown-body` rules in that file, not by `prose`.
- `@/*` maps to `src/*` — including from `cli/`, which imports app code through the alias and runs via `tsx`.
- All user-facing copy is **Spanish**. Match that when adding UI text or agent prompts.

## Architecture

Single-page app (`src/app/page.tsx` owns nearly all state) with four tabs — agents dashboard, workbench, workflows, history — over Route Handlers in `src/app/api/`. A separate terminal CLI in `cli/` drives the same engine without the web server.

### Provider execution: the bridge indirection

`src/lib/agentEngine.ts` → `runAgentEngine()` is the single execution path. `getProviderFromModel()` (in `src/types/agent.ts`) derives the provider from the model-string prefix, then:

1. **Gemini** — called inline via `@google/genai`.
2. **Everything else** — delegated to the injected `bridgeFn`, never imported statically. This matters: the real implementation (`src/lib/providerBridge.ts`) uses `child_process`, so importing it from the engine would break the client bundle.

Pass the right transport for the context — there is **no default**, on purpose:

| Caller | `bridgeFn` |
|---|---|
| Browser (`ExecutionPanel`, `WorkflowBuilder`) | `fetchProviderBridge` (`src/lib/bridgeClient.ts`) → POSTs to `/api/cli-bridge` |
| Server routes, `telegramService` | `runProviderBridge` (`src/lib/providerBridge.ts`) |
| `cli/harness.ts` | `directBridge` (`cli/cliEngine.ts`, a thin re-export of `runProviderBridge`) |

Omitting `bridgeFn` is an integration error, and the engine reports it as such. The earlier default was a fetch to a **relative** URL, which silently never resolved server-side — every Telegram message and every `/api/*/execute` call fell through to the simulator.

### Simulation is a labelled fallback, not a silent one

When no real provider answers, behaviour depends on `providerKeys.strictMode`:

- **strict on** — `runAgentEngine` throws `ProviderUnavailableError` listing why each route failed.
- **strict off** — the simulator produces plausible provider-flavoured Markdown, prefixed with a visible warning banner, and the result carries `simulated: true`. That flag propagates into `ExecutionRun` and is rendered as a "SIMULADO" badge in the workbench, workflow results, and history.

Never treat a `simulated` run as model output.

### Model IDs

`AgentModel` (`src/types/agent.ts`) holds the *app-level* IDs. `providerBridge.ts` maps them to wire IDs. Two constraints that are easy to break:

- Anthropic IDs carry **no date suffix** (`claude-opus-5`, not `claude-opus-5-20260101`), and the pre-4.6 generation is retired — those IDs 404.
- Opus 5 / Sonnet 5 **reject `temperature`** with a 400, and thinking is on by default with `max_tokens` capping thinking + text together. `providerBridge.ts` handles both (temperature allowlist, `ANTHROPIC_MIN_MAX_TOKENS` floor). Load the `claude-api` skill before changing that file.

`normalizeModel()` remaps retired IDs on load, and `getStoredAgents()` persists the migration so stored agents keep working.

### Copilot goes through its own CLI — never through OpenAI

`copilot-*` models are **not** an OpenAI-compatible endpoint. There is no HTTP API here: `callCopilotCli()` shells out to the local `copilot` binary in non-interactive mode (`--prompt … --output-format json`) and the session lives inside that binary (`copilot login`). The earlier code sent `GITHUB_TOKEN` to `api.openai.com` as if it were an OpenAI key, which is always a 401 — that route never worked. `copilotToken` is now optional and injected as `COPILOT_GITHUB_TOKEN`, for hosts with no interactive login.

- Output is JSONL: only `assistant.message` carries the answer. `assistant.message_delta` events are the streaming view of that same text — summing both duplicates the response.
- `--allow-all-tools` is **deliberately not passed**. The CLI is a full agent with shell and disk access; a harness that only wants text must not grant that. Denied tools still yield a text answer.
- `temperature` / `maxTokens` have no CLI equivalent and are ignored.
- Explicit `--model` requires a Copilot plan that permits model choice. On restricted plans every named model is rejected and only `copilot-cli` (auto mode) works — the bridge detects that and says so rather than failing opaquely. `copilot help config` lists the global catalog, not your entitlements.

### Persistence: `data/*.json`

`src/lib/serverStorage.ts` owns all reads and writes. `data/` is **gitignored** — it holds bot tokens and API keys in plaintext.

- Writes go to a `.tmp` file and are `rename`d into place (atomic on POSIX), serialized per-file through an in-module promise-chain mutex. Read-modify-write helpers (`addHistoryRun`, `saveOrUpdateAgent`, …) run inside that lock.
- A corrupt JSON file is moved aside to `<file>.corrupt-<timestamp>` rather than overwritten with presets — the old behaviour silently destroyed the user's agents.
- History is capped at `HISTORY_LIMIT` (200) entries.
- Telegram `update_id` offsets live in `data/telegram-offsets.json`, merged with `Math.max` per agent.

The client mirrors state into `aether_*` localStorage keys, but the server wins on load; localStorage is only a fallback when a fetch fails.

### Telegram

Each agent carries its own `telegramConfig` (one agent ↔ one bot). Enrolment requires a successful `/api/telegram/verify` call — the modal will not mark a bot `connected` on an unverified token.

- **Polling** — `page.tsx` pings `/api/telegram/poll` every 3s, but sends no payload: agents, keys, and offsets are all read server-side, so reloading the page no longer reprocesses old messages.
- **Webhook** — `/api/telegram/webhook?agentId=<id>` loads the real stored agent and its token. It never accepts credentials via query string. Set `TELEGRAM_WEBHOOK_SECRET` to require Telegram's `X-Telegram-Bot-Api-Secret-Token` header.

### Tools

`src/lib/tools.ts` are pre-flight prompt enrichers, not model-driven tool calls: every tool on an agent runs unconditionally before generation and its JSON output is appended to the prompt. Each definition carries a `simulated` flag — `web_search`, `image_generator`, and `data_extractor` return labelled placeholder data. `code_executor` really runs JavaScript via `new Function`, **in-process and unsandboxed**; it only executes when an explicit `code` argument is supplied.

`runTools()` in `agentEngine.ts` memoizes its result. It used to run once on the real-provider path and again in the simulator fallback — harmless for the placeholder tools, but with MCP that meant spawning processes and hitting remote APIs twice per request.

### MCP: one server set per agent

Each agent carries its own `mcpServers: McpServerConfig[]` (`src/types/mcp.ts`), edited in `McpServerEditor` inside `AgentModal` — same one-agent-one-config shape as `telegramConfig`.

**MCP tools are pre-flight enrichers too, not model-driven tool calls.** The model never sees a tool schema and cannot choose or iterate: the user declares which tools to invoke and with what arguments, they all run before generation, and their output is appended as `[CONTEXT FROM MCP: <server> / <tool>]`. A real agentic loop was rejected because `copilot-cli` and `claude-code` are one-shot CLI calls with no tool-call channel.

- Arguments are static JSON. `{{prompt}}` is interpolated with the user's prompt anywhere in a string value, including nested — it's the only way a call can depend on the request. See `interpolateArgs()`.
- Both transports are supported. **stdio** spawns a local binary (`StdioClientTransport`, env filtered through `getDefaultEnvironment()` plus the user's own vars). **http** tries Streamable HTTP and retries with SSE; the error reported is always the *first* transport's, because otherwise a 401 surfaces as the 404 the SSE `GET` gets back.
- One connection per call — `connect` → call → `close`. No pool: it matches the one-shot model of the rest of the harness and avoids orphaned child processes between Next requests.
- A failing MCP server degrades context; it never aborts the run. That's the one place MCP differs from `bridgeFn`: a missing `mcpFn` is logged as an integration error and execution continues.
- **stdio runs an arbitrary local binary with full disk and network access.** Whoever can edit an agent can execute code on the host. `env` and `headers` (MCP tokens) are stored in cleartext in `data/agents.json`.

Same bridge indirection as providers — `mcpFn` is injected, never imported from the engine, because `mcpClient.ts` uses `child_process`:

| Caller | `mcpFn` |
|---|---|
| Browser | `fetchMcpBridge` (`src/lib/mcpBridgeClient.ts`) → `/api/mcp/call` |
| Server routes, `telegramService` | `runMcpBridge` (`src/lib/mcpClient.ts`) |
| `cli/harness.ts` | `directMcp` (`cli/cliEngine.ts`) |

`/api/mcp/tools` lists a server's tools; it backs the modal's "Probar conexión" button so the user picks from the real catalog instead of typing names blind.

`ThoughtStep.toolName` is typed to the local `ToolName` union, so MCP steps leave it undefined and carry their identity in `toolArgs` (`mcpServer`, `mcpTool`); `ExecutionPanel` labels them via `mcpStepLabel()`.

### Workflows

`WorkflowConfig` is a linear chain: each step's `finalOutput` becomes the next step's prompt, prefixed by that step's optional `customInstruction`. `WorkflowBuilder` runs the chain client-side and writes each step to history; `/api/workflows/execute` implements the same pipeline server-side for programmatic callers. No branching, no parallelism.
