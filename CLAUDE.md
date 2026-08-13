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

`src/lib/serverStorage.ts` owns all reads and writes. `data/` is **gitignored** — it holds bot tokens and API keys in plaintext. That now includes `workflows.json`, not just `agents.json` and `settings.json`: a workflow can carry its own `telegramConfig`.

The one committed file there is `data/agents.example.json`, regenerated by `npm run agents:example` (`scripts/make-agents-example.mjs`). It exists so an agent's *shape* — MCP `mode`, `allowedTools`, system prompt — survives a clone, while the secret does not: every `env`/`headers` value and any `telegramConfig.botToken` becomes a `<RELLENA_…>` marker, and host-absolute paths in `args` become `<RUTA_LOCAL>`. The script collects what it redacted and **aborts if any of those values survive into the output**, so a forgotten field fails loudly instead of shipping a token. Note the `.gitignore` entry is `/data/*` plus a negation, not `/data/` — git does not descend into an excluded directory, so the exception would never apply otherwise.

- Writes go to a `.tmp` file and are `rename`d into place (atomic on POSIX), serialized per-file through an in-module promise-chain mutex. Read-modify-write helpers (`addHistoryRun`, `saveOrUpdateAgent`, …) run inside that lock.
- A corrupt JSON file is moved aside to `<file>.corrupt-<timestamp>` rather than overwritten with presets — the old behaviour silently destroyed the user's agents.
- History is capped at `HISTORY_LIMIT` (200) entries.
- Telegram `update_id` offsets live in `data/telegram-offsets.json`, merged with `Math.max` per agent.

The client mirrors state into `aether_*` localStorage keys, but the server wins on load; localStorage is only a fallback when a fetch fails.

### Multi-turn conversations

`data/conversations.json` is the model's **live context**; `history.json` is an audit log. They are not merged, and context is never derived by filtering history — history's global 200-entry cap would evict a quiet bot's thread as soon as another agent got busy, and it mixes workflow steps in with chat turns.

Shape: a map keyed `` `${agentId}::${threadKey}` `` (`conversationId()` in `src/types/conversation.ts`), threadKey being `web` or `tg:<chatId>`. Per-thread cap `CONVERSATION_MESSAGE_CAP` (60), plus thread eviction by oldest `updatedAt` at `CONVERSATION_THREAD_CAP` (200).

**Only final assistant text is ever persisted.** No provider content objects — Gemini `parts` carrying a `thoughtSignature`, Anthropic blocks carrying thinking — go anywhere near this file. Prior turns re-enter each request as plain text and every agentic loop starts fresh, which is exactly why the two verbatim-echo rules below stay satisfiable: the objects that must be replayed untouched only ever live inside a single `runAgentEngine` call. Caching them across requests reintroduces the 400s.

`selectContextMessages()` is the **only** guard on well-formedness, and it is load-bearing: it drops simulated turns, collapses consecutive same-role messages, strips a leading `assistant` and a trailing `user`, then windows to `memoryTurns * 2`. The trailing-`user` trim is not cosmetic — an unanswered question left at the end becomes two consecutive user turns as soon as the caller appends the current one. `AgentConfig.memoryTurns` (0 = no memory, absent = `DEFAULT_MEMORY_TURNS`) is the per-agent window; note that agents stored before this feature therefore gain memory on load.

A failed run persists **nothing**. Half a turn on disk breaks role alternation for every subsequent request. Storage failures degrade memory but never abort a run — same principle as MCP, opposite of `bridgeFn`.

Threading per provider lives in `src/lib/conversationFormat.ts`. Gemini, Anthropic and OpenAI take real message arrays; `copilot` and `claude -p` have no such interface, so `flattenTranscript()` renders the thread into their single argv string (and, with empty history, reproduces the old format byte-for-byte). That flattening is also what finally gives `claude -p` its system prompt, which the binary path used to drop outright. `claude --resume` is deliberately unused: it would bind state to the binary's own session store, invisible here and with different reset semantics from `/nuevo`.

`/api/cli-bridge` rebuilds `BridgeRequest` field by field, so **any field not listed there is silently dropped** — that is where browser-side memory (and, before this, browser-side agentic MCP) goes missing.

### Telegram

**Agents and workflows both enrol**, each carrying its own `telegramConfig` (one owner ↔ one bot) and sharing one generalized `TelegramModal` — see `TelegramTarget` and the `agentTelegramTarget()` / `workflowTelegramTarget()` adapters. Enrolment requires a successful `/api/telegram/verify` call — the modal will not mark a bot `connected` on an unverified token.

**A bot token may belong to exactly one owner.** `getUpdates` is exclusive per token: two pollers on the same bot steal each other's messages, and since each tracks its own offset, both advance independently and updates vanish non-deterministically. One-agent-one-bot made this implicit; workflows make it possible to duplicate a token, so `verify` now runs `findTelegramTokenOwner()` (`serverStorage.ts`) and answers **409** naming the current owner. The caller passes `ownerKind`/`ownerId` so re-verifying your own token isn't a conflict.

- **Polling** — `page.tsx` pings `/api/telegram/poll` every 3s, but sends no payload: agents, workflows, keys, and offsets are all read server-side, so reloading the page no longer reprocesses old messages. The gate that starts the interval counts **both** kinds; when it only counted agents, a workflow-only install never polled at all.
- **Offsets** — keyed by `telegramOffsetKey(kind, id)`: agents keep their bare id so existing offsets stay valid, workflows go under `wf:<id>`.
- **Webhook** — `/api/telegram/webhook?agentId=<id>` or `?workflowId=<id>` loads the real stored owner and its token. It never accepts credentials via query string. Set `TELEGRAM_WEBHOOK_SECRET` to require Telegram's `X-Telegram-Bot-Api-Secret-Token` header.
- **Conversation** — one thread per `chat.id`. `processTelegramAgentRequest` returns `ExecutionRun | null`, `null` meaning the message was a command (`/nuevo`, `/start`, `/ayuda`) so there is no run to record — every call site needs the `if (run)` guard. `parseTelegramCommand()` tolerates the `@bot` suffix Telegram appends in groups; matching `text === '/nuevo'` would treat it as a prompt.

#### Workflow bots

`processTelegramWorkflowRequest()` is the sibling of the agent one: one message runs the whole chain through `runWorkflowPipeline()`. It returns `ExecutionRun[]` — one per executed step — and the empty array is the analogue of the agent path's `null`, meaning the message was a command.

- **No memory, by design.** A pipeline step is not a conversation turn, so nothing is read from or written to `data/conversations.json` and every message starts the chain from scratch. `/nuevo` says so rather than silently doing nothing.
- **One live progress message.** The bot sends a status block and rewrites it with `editTelegramMessage()` as each step closes (✅ / ⏭️ / ❌), then sends the final output. That is why `onStepResult` is `void | Promise<void>` and the engine awaits it — fire-and-forget edits arrive out of order. `sendTelegramMessage()` returns the first chunk's `message_id` for this; a failed edit falls back to a new message.
- **Runs are attributed to Telegram** via `workflowStepToRun(step, i, { source: 'telegram', telegramChatId })`. Skipped steps never executed, so they are not recorded.
- **The poll tick handles at most one pipeline message per tick.** Ticks are sequential across every bot and a chain can take minutes; without the cap, a burst of messages would leave every other bot mute. The rest stay queued because their offset isn't advanced. `isPollingRef` in `page.tsx` already prevents overlapping ticks, so nothing is double-processed. A real fix needs a job queue.
- **The workflow webhook answers 200 before running**, unlike the agent one. Telegram retries an update the webhook doesn't answer in time, which on a multi-minute chain means running the pipeline twice. The harness is a long-lived process, so the run is detached — history and chat delivery happen after the response.

### Tools: MCP is the only mechanism

There is no local tool registry. `src/lib/tools.ts` and the `ToolName` union were **removed**, and with them the "Herramientas de Agente Habilitadas" checkbox grid — that heading now sits on top of `McpServerEditor` in `AgentModal`, and `AgentCard` lists a tool as the MCP server it comes from, tagged with its mode. Do not reintroduce a parallel tool path; add tools as MCP servers. Web search, the one capability the old registry pretended to have, comes from a search MCP server (Tavily, Brave, …) in `agentic` mode — paste its `mcpServers` block into `McpServerEditor` — or from the provider's own native search on Gemini/Anthropic.

The old registry was removed because none of it worked: `web_search`, `image_generator` and `data_extractor` returned labelled placeholder JSON, and `code_executor` — the only real one, a `new Function` with no sandbox — was unreachable, because `runLocalTools()` only ever passed `{query, prompt, text}` and the tool needs an explicit `code` argument. On top of that, nothing was model-driven: every enabled tool ran before generation with the user's prompt as every argument, and its output was appended to the real prompt as `[CONTEXT FROM TOOL: …]`, so agents paid tokens to be told the data was invented. MCP's `agentic` mode already does this properly.

`AgentConfig.tools` is gone; `migrateAgents()` in `serverStorage.ts` deletes the orphan key from stored agents and persists the pruned version. `ThoughtStep.toolName` was **kept**, retyped from `ToolName` to `string`, so entries already in `data/history.json` still render — MCP steps leave it undefined and carry their identity in `toolArgs`.

`runTools()` in `agentEngine.ts` now just wraps the pre-flight MCP pass, but keeps memoizing: it used to run once on the real-provider path and again in the simulator fallback, which with MCP meant spawning processes and hitting remote APIs twice per request.

When a model asks for several tools in one turn, both agentic loops resolve them with `Promise.all` — they are independent calls, each opening its own MCP connection. Ordering of the trace is preserved deliberately: in `agentEngine.ts` the `tool_call` step is emitted before the first `await` and `runAgenticTool` **returns** its result step instead of emitting it, so the caller can add them in request order rather than completion order.

### MCP: one server set per agent

Each agent carries its own `mcpServers: McpServerConfig[]` (`src/types/mcp.ts`), edited in `McpServerEditor` inside `AgentModal` — same one-agent-one-config shape as `telegramConfig`.

Each server picks a `mode`:

- **`preflight`** (default, and what a stored server without the field gets) — pre-flight prompt enricher. The model never sees a schema: the user declares which tools to invoke and with what arguments, they all run before generation, and the output is appended as `[CONTEXT FROM MCP: <server> / <tool>]`. Works on every provider. Never put write tools here — they'd run on every message with fixed arguments.
- **`agentic`** — real tool-calling. Schemas go to the model, it picks the tool and the arguments, the result is fed back, and it iterates up to `MCP_MAX_ITERATIONS`. This is the only mode that makes write tools useful, because they run only when the model asks.

Agentic mode needs a provider with a tool-call channel: **Gemini** (loop in `agentEngine.ts`, using the injected `mcpFn`/`mcpListFn`) and **Anthropic by API** (loop inside `providerBridge.ts`, which is server-only and imports `mcpClient` directly, so conversation state never crosses the browser/server boundary). `copilot-cli` and `openai` are not wired; `claude-code` only qualifies when an Anthropic API key routes it to the API instead of the `claude -p` binary. The engine emits an explicit error step when an agent asks for agentic mode on a provider that can't do it — silent degradation would look like the tools simply doing nothing.

Two echo-back rules, both learned the hard way and both the same principle — **return the model's turn unmodified**: Gemini 3.x attaches a `thoughtSignature` to each `functionCall` and 400s if the turn is reconstructed instead of replayed; Anthropic carries thinking inside the assistant blocks. Both loops push the provider's own content object back verbatim.

`sanitizeSchema()` (`src/lib/mcpTools.ts`) prunes MCP's full JSON Schema down to the keys providers accept — Gemini rejects `$schema`, `additionalProperties`, `minLength` and friends. Tool names are aliased to `<serverId>__<tool>` with non-alphanumerics replaced, since MCP names carry hyphens.

Because the Anthropic loop runs server-side, the browser can't see its steps live: the tools it called come back as `toolTrace` on the `BridgeResult` and the engine replays them into `ThoughtStep`s.

- In `preflight` mode, arguments are static JSON and `{{prompt}}` is interpolated with the user's prompt anywhere in a string value, including nested — the only way a call can depend on the request. See `interpolateArgs()`. In `agentic` mode there is no interpolation: the model supplies the arguments, which is the whole point.
- `draftArguments()` (`McpServerEditor.tsx`) prefills a preflight call from the tool's `inputSchema` and puts `{{prompt}}` in **at most one** property — chosen by name (`query`, `pattern`, …), never in an identifier or location (`vault`, `path`, `file`, …), with the remaining required fields left visibly empty. Filling every required string with it — the original behaviour — meant `search-vault` was born with the user's prompt in `vault`, and all 11 `obsidian-mcp` tools require `vault`. The identifier blacklist is load-bearing on its own: `list_directory` declares exactly one required string, `path`.
- Both transports are supported. **stdio** spawns a local binary (`StdioClientTransport`, env filtered through `getDefaultEnvironment()` plus the user's own vars). **http** tries Streamable HTTP and retries with SSE; the error reported is always the *first* transport's, because otherwise a 401 surfaces as the 404 the SSE `GET` gets back.
- stdio pipes the child's **stderr** and buffers it (8 KB cap, drained immediately so a chatty server can't block). When startup fails, that text becomes the error message — it beats anything the protocol reports. A server that dies during the handshake only produces `-32000 Connection closed`, while its stderr says `Vault directory does not exist: /path`.
- One connection per call — `connect` → call → `close`. No pool: it matches the one-shot model of the rest of the harness and avoids orphaned child processes between Next requests.
- A failing MCP server degrades context; it never aborts the run. That's the one place MCP differs from `bridgeFn`: a missing `mcpFn` is logged as an integration error and execution continues.
- **stdio runs an arbitrary local binary with full disk and network access.** Whoever can edit an agent can execute code on the host. `env` and `headers` (MCP tokens) are stored in cleartext in `data/agents.json`.

Same bridge indirection as providers — `mcpFn` is injected, never imported from the engine, because `mcpClient.ts` uses `child_process`:

| Caller | `mcpFn` |
|---|---|
| Browser | `fetchMcpBridge` (`src/lib/mcpBridgeClient.ts`) → `/api/mcp/call` |
| Server routes, `telegramService` | `runMcpBridge` (`src/lib/mcpClient.ts`) |
| `cli/harness.ts` | `directMcp` (`cli/cliEngine.ts`) |

`parseMcpConfig()` (`src/lib/mcpConfigImport.ts`) backs the editor's "Pegar JSON" box: it ingests the `{"mcpServers": {…}}` block every MCP server publishes, in any of its three shapes (wrapped, bare map, single server). Hand-transcribing that block into the form fields is where configuration goes wrong — a package name and a path left on one line of the args textarea arrive as a single `argv` entry, and the resulting `npm ENOENT` names a path nobody typed. Importing keeps the array pre-split. Note that a path with spaces is a legitimate single argument, so a "looks glued together" heuristic can't be written without false-positiving on correct configs — that's why the fix is import, not detection.

`/api/mcp/tools` lists a server's tools; it backs the modal's "Probar conexión" button so the user picks from the real catalog instead of typing names blind.

`ThoughtStep.toolName` is typed to the local `ToolName` union, so MCP steps leave it undefined and carry their identity in `toolArgs` (`mcpServer`, `mcpTool`); `ExecutionPanel` labels them via `mcpStepLabel()`.

### Workflows

`WorkflowConfig` is a linear chain: each step's `finalOutput` becomes the next step's prompt, prefixed by that step's optional `customInstruction`. No branching, no parallelism.

The chain lives in **one** place — `runWorkflowPipeline()` in `src/lib/workflowEngine.ts` — driven by `WorkflowBuilder` in the browser and by `/api/workflows/execute` on the server. It takes the same injected `bridgeFn`/`mcpFn`/`mcpListFn` as `runAgentEngine`, and for the same reason. There used to be two hand-written copies of the loop, and they had already drifted: different context prefixes (so the same workflow produced different prompts depending on where it ran), different missing-agent behaviour, and history written on only one of the two paths.

- The prefix is the exported constant `WORKFLOW_CONTEXT_PREFIX`. Don't inline it again.
- Steps carry **no `history`** — a pipeline step is not a conversation turn, so `memoryTurns` does not apply and nothing touches `data/conversations.json`. The chaining *is* the context.
- Three per-step outcomes, all of them non-fatal to the run as a whole: `completed`; `skipped` when the step's `agentId` no longer exists (the chain continues with the previous output untouched, and nothing is written to history); `failed` when `runAgentEngine` throws (the chain stops, but `stepResults` still carries every step already paid for). The server route therefore answers **200** with partial results on a mid-chain failure — 500 is reserved for errors in the route itself.
- Both paths write one `ExecutionRun` per executed step, built by the shared `workflowStepToRun()` so the two histories are byte-identical in shape.
- `signal` is checked at step boundaries only; it does not abort a `runAgentEngine` call in flight. That's what the workbench's "Detener" button drives.

`/api/workflows/execute` resolves agents from `getStoredAgents()` and accepts `workflowId` as an alternative to an inline `workflow`. `agentsMap` in the body is now an optional override for unsaved agents — requiring it meant a programmatic caller had to re-send full agent configs, MCP credentials included.

`POST /api/workflows` validates through `isWorkflowConfig()` and **upserts by `id`**. Both matter: it used to persist any JSON, so `{}` became a workflow with no `id` that `DELETE ?id=` could never remove; and the blind prepend duplicated a workflow every time the UI's edit form saved it.

### Monitor en vivo: efímero por diseño

The "En vivo" tab (`LiveMonitor.tsx`) shows requests **while they run** — Telegram bots (agent and workflow), the workbench, `WorkflowBuilder`, `/api/*/execute`, and the CLI. It is a fifth tab, and `AppTab` (`src/types/ui.ts`) now holds the union that was duplicated between `page.tsx` and `NavbarProps`.

It is **not** history. `data/history.json` is the audit log and survives restarts; the live bus is a `Map` in `src/lib/liveEvents.ts` that dies with the process. Nothing is written to `data/`. A trace is evicted the moment its `run_end` lands, plus a TTL sweep (10 min) for the traces whose `run_end` never comes — a hard restart mid-pipeline, an exception outside a `try`. Caps mirror the storage ones in spirit: `MAX_ACTIVE_TRACES` (20), `MAX_EVENTS_PER_TRACE` (200), every text field truncated to `LIVE_TEXT_CAP`.

`publishLiveEvent()` **never throws** and wraps each subscriber in its own `try`. A wedged SSE connection must not be able to kill a Telegram bot — same degrade-never-abort rule as MCP, the opposite of `bridgeFn`.

The bus is pinned on `globalThis` under a versioned `Symbol.for()` key. Turbopack re-evaluates server modules on hot reload; without the pin you get two buses, producers publishing into one and the stream listening on the other, and the monitor silently goes dead.

**`liveEvents.ts` is server-only and must stay unreachable from the browser.** Do not publish from inside `agentEngine.ts` or `workflowEngine.ts` — they run in the browser too. The engines expose callbacks (`onStepStart`, `onStepResult`, the new `onAgentStep`) and the *caller* publishes; same reason `bridgeFn` and `mcpFn` are injected.

- **`GET /api/events/stream`** — SSE. The `snapshot` frame is enqueued **synchronously in `start()`**: Next only flushes headers on the first write (`pipe-readable.js`), so a deferred first frame leaves `EventSource.onopen` hanging and an idle connection looks hung. `Cache-Control: no-cache, no-transform` is load-bearing — Next's `compression` middleware runs in dev *and* prod and `no-transform` is what makes it skip. Cleanup is idempotent because Next fires **both** `request.signal`'s abort and the stream's `cancel()`. No `export const dynamic`: Route Handlers are uncached by default since 15, and that flag is removed under Cache Components.
- **`POST /api/events/publish`** — ingest for the producers outside the server process: the browser engines and the CLI. Takes a batch (a Gemini agentic loop would otherwise cost one request per thought). **Unauthenticated**, like everything else here — anyone who can reach the port can inject events, which is why the monitor renders event text as plain text and never through `Markdown`.
- The CLI only emits when `HARNESS_EVENTS_URL` is set. Without it there is no connection attempt at all, so running the CLI with no server up costs nothing.

The `EventSource` lives in a module-level ref-counted store (`liveEventsClient.ts`), not in `page.tsx`, and `LiveMonitorConnection` is a `null`-rendering component that just holds a reference. `page.tsx` owns all app state and renders every panel unmemoized, so putting a per-event `setState` there would repaint a mid-run `ExecutionPanel` dozens of times a second. Notifications are coalesced on a ~100 ms timer and `getSnapshot()` returns a cached reference — a fresh array per call is an infinite render loop.

Client-side, a finished trace **stays on screen** even though the server dropped it; on reconnect the snapshot replaces the live traces and local finished ones are kept (`mergeSnapshot`). There is deliberately no `Last-Event-ID` replay: the data is ephemeral, so a gap is honest.

Two shape details worth knowing: a `skipped` step emits `step_result` with **no** preceding `step_start` (the engine fires `onStepStart` after resolving the agent), so the UI reducer tolerates a missing start; and Anthropic's agentic tool calls run inside `providerBridge.ts` and surface as `toolTrace` afterwards, so those steps arrive in one burst at the end rather than in real time.
