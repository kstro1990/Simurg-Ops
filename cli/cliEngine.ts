/**
 * CLI Bridge Engine — Direct API calls without Next.js server.
 *
 * This module implements the BridgeFn interface from agentEngine.ts
 * to call Anthropic, OpenAI, and local CLI binaries directly,
 * bypassing the web server entirely.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export interface CliBridgeRequest {
  provider: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  keys: {
    geminiApiKey?: string;
    anthropicApiKey?: string;
    openaiApiKey?: string;
    copilotToken?: string;
  };
}

export interface CliBridgeResponse {
  success: boolean;
  output?: string;
  source?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  message?: string;
  error?: string;
}

/**
 * Direct bridge function for CLI — calls APIs directly without Next.js server.
 */
export async function directBridge(request: CliBridgeRequest): Promise<CliBridgeResponse> {
  const { provider, model, systemPrompt, userPrompt, temperature, maxTokens, keys } = request;

  // ── ANTHROPIC / CLAUDE CODE ──────────────────────────────────────────

  if (provider === 'anthropic' || provider === 'claude-code') {
    const apiKey = keys.anthropicApiKey?.trim() || process.env.ANTHROPIC_API_KEY || '';

    if (apiKey && apiKey.length > 5) {
      let anthropicModel = 'claude-3-7-sonnet-20250219';
      if (model === 'claude-3.5-haiku') anthropicModel = 'claude-3-5-haiku-20241022';
      else if (model === 'claude-3.5-sonnet') anthropicModel = 'claude-3-5-sonnet-20241022';

      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: anthropicModel,
            max_tokens: maxTokens,
            temperature,
            system: systemPrompt || undefined,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({})) as any;
          throw new Error(`Anthropic API Error (${res.status}): ${errData?.error?.message || res.statusText}`);
        }

        const data = await res.json() as any;
        const outputText = data.content?.[0]?.text || 'Sin respuesta del modelo Claude.';

        return {
          success: true,
          output: outputText,
          source: 'api_direct',
          usage: {
            promptTokens: data.usage?.input_tokens,
            completionTokens: data.usage?.output_tokens,
          },
        };
      } catch (err: any) {
        // If API fails, try CLI binary below
        if (provider !== 'claude-code') {
          return { success: false, message: `Anthropic API error: ${err.message}` };
        }
      }
    }

    // Try local Claude Code CLI binary
    if (provider === 'claude-code') {
      try {
        const sanitizedPrompt = userPrompt.replace(/"/g, '\\"');
        const { stdout } = await execPromise(`claude -p "${sanitizedPrompt}"`, { timeout: 30000 });
        if (stdout && stdout.trim()) {
          return {
            success: true,
            output: stdout.trim(),
            source: 'cli_binary',
          };
        }
      } catch {
        // Fall through
      }
    }

    return { success: false, message: 'No API key or Claude CLI binary available.' };
  }

  // ── OPENAI / COPILOT CLI ─────────────────────────────────────────────

  if (provider === 'openai' || provider === 'copilot-cli') {
    const apiKey = keys.openaiApiKey?.trim() || keys.copilotToken?.trim() || process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN || '';

    if (apiKey && apiKey.length > 5) {
      let openaiModel = 'gpt-4o';
      if (model === 'gpt-4o-mini') openaiModel = 'gpt-4o-mini';

      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: openaiModel,
            temperature,
            max_tokens: maxTokens,
            messages: [
              ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
              { role: 'user', content: userPrompt },
            ],
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({})) as any;
          throw new Error(`OpenAI API Error (${res.status}): ${errData?.error?.message || res.statusText}`);
        }

        const data = await res.json() as any;
        const outputText = data.choices?.[0]?.message?.content || 'Sin respuesta del modelo.';

        return {
          success: true,
          output: outputText,
          source: 'api_direct',
          usage: {
            promptTokens: data.usage?.prompt_tokens,
            completionTokens: data.usage?.completion_tokens,
          },
        };
      } catch (err: any) {
        if (provider !== 'copilot-cli') {
          return { success: false, message: `OpenAI API error: ${err.message}` };
        }
      }
    }

    // Try local GitHub Copilot CLI binary
    if (provider === 'copilot-cli') {
      try {
        const sanitizedPrompt = userPrompt.replace(/"/g, '\\"');
        const { stdout } = await execPromise(`gh copilot suggest "${sanitizedPrompt}"`, { timeout: 30000 });
        if (stdout && stdout.trim()) {
          return {
            success: true,
            output: stdout.trim(),
            source: 'cli_binary',
          };
        }
      } catch {
        // Fall through
      }
    }

    return { success: false, message: 'No API key or Copilot CLI binary available.' };
  }

  return { success: false, message: `Unsupported provider for direct bridge: "${provider}"` };
}
