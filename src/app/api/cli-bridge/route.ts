import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, model, systemPrompt, userPrompt, temperature = 0.3, maxTokens = 2048, keys = {} } = body;

    // 1. ANTHROPIC / CLAUDE CODE API
    if (provider === 'anthropic' || provider === 'claude-code') {
      const apiKey = keys.anthropicApiKey?.trim() || process.env.ANTHROPIC_API_KEY || '';

      if (apiKey && apiKey.length > 5) {
        let anthropicModel = 'claude-3-7-sonnet-20250219';
        if (model === 'claude-3.5-haiku') anthropicModel = 'claude-3-5-haiku-20241022';
        else if (model === 'claude-3.5-sonnet') anthropicModel = 'claude-3-5-sonnet-20241022';

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
          const errData = await res.json().catch(() => ({}));
          throw new Error(`Anthropic API Error (${res.status}): ${errData?.error?.message || res.statusText}`);
        }

        const data = await res.json();
        const outputText = data.content?.[0]?.text || 'Sin respuesta del modelo Claude.';

        return NextResponse.json({
          success: true,
          provider,
          model,
          output: outputText,
          usage: {
            promptTokens: data.usage?.input_tokens || Math.floor(userPrompt.length / 4),
            completionTokens: data.usage?.output_tokens || Math.floor(outputText.length / 4),
          },
        });
      }

      // Try local Claude Code CLI binary if available
      if (provider === 'claude-code') {
        try {
          const sanitizePrompt = userPrompt.replace(/"/g, '\\"');
          const { stdout } = await execPromise(`claude -p "${sanitizePrompt}"`, { timeout: 15000 });
          if (stdout && stdout.trim()) {
            return NextResponse.json({
              success: true,
              provider: 'claude-code',
              model: 'claude-code',
              output: stdout.trim(),
              source: 'cli_binary',
            });
          }
        } catch (cliErr) {
          // Fallback handled below
        }
      }
    }

    // 2. COPILOT CLI & OPENAI API
    if (provider === 'copilot-cli' || provider === 'openai') {
      const apiKey = keys.openaiApiKey?.trim() || keys.copilotToken?.trim() || process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN || '';

      if (apiKey && apiKey.length > 5) {
        let openaiModel = 'gpt-4o';
        if (model === 'gpt-4o-mini') openaiModel = 'gpt-4o-mini';

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
          const errData = await res.json().catch(() => ({}));
          throw new Error(`OpenAI/Copilot API Error (${res.status}): ${errData?.error?.message || res.statusText}`);
        }

        const data = await res.json();
        const outputText = data.choices?.[0]?.message?.content || 'Sin respuesta del modelo.';

        return NextResponse.json({
          success: true,
          provider,
          model,
          output: outputText,
          usage: {
            promptTokens: data.usage?.prompt_tokens || Math.floor(userPrompt.length / 4),
            completionTokens: data.usage?.completion_tokens || Math.floor(outputText.length / 4),
          },
        });
      }

      // Try local GitHub Copilot CLI binary if available
      if (provider === 'copilot-cli') {
        try {
          const sanitizePrompt = userPrompt.replace(/"/g, '\\"');
          const { stdout } = await execPromise(`gh copilot suggest "${sanitizePrompt}"`, { timeout: 15000 });
          if (stdout && stdout.trim()) {
            return NextResponse.json({
              success: true,
              provider: 'copilot-cli',
              model: 'copilot-cli',
              output: stdout.trim(),
              source: 'cli_binary',
            });
          }
        } catch (cliErr) {
          // Fallback handled below
        }
      }
    }

    return NextResponse.json(
      {
        success: false,
        message: `No API key or CLI binary found for provider "${provider}". Falling back to smart agent engine simulation.`,
      },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error executing CLI bridge request',
      },
      { status: 500 }
    );
  }
}
