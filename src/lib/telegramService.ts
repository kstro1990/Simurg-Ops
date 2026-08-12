import {
  AgentConfig,
  ExecutionRun,
  ProviderKeys,
  WorkflowConfig,
  WorkflowStepResult,
} from '@/types/agent';
import { resolveMemoryTurns, telegramThreadKey } from '@/types/conversation';
import { runAgentEngine } from './agentEngine';
import { runWorkflowPipeline, workflowStepRunId, workflowStepToRun } from './workflowEngine';
import { runProviderBridge } from './providerBridge';
import { listMcpTools, runMcpBridge } from './mcpClient';
import {
  appendConversationTurn,
  getConversationMessages,
  resetConversation,
} from './serverStorage';
import { newTraceId, publishLiveEvent } from './liveEvents';

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
  can_join_groups?: boolean;
}

export async function verifyTelegramToken(botToken: string): Promise<TelegramBotInfo> {
  const cleanToken = botToken.trim();
  if (!cleanToken) {
    throw new Error('Token de Telegram inválido o vacío.');
  }

  const res = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  const data = await res.json();
  if (!data.ok || !data.result) {
    throw new Error(data.description || 'No se pudo verificar el Token de Telegram.');
  }

  return data.result as TelegramBotInfo;
}

/**
 * Envía un mensaje, troceándolo si excede el límite de Telegram.
 *
 * Devuelve el `message_id` del **primer** trozo, que es lo que necesita
 * `editTelegramMessage` para el mensaje de progreso de los pipelines. `null` si
 * no se pudo enviar nada.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string
): Promise<number | null> {
  const cleanToken = botToken.trim();
  if (!cleanToken || !chatId) return null;

  // Truncate message if it exceeds Telegram's 4096 character limit per message
  const maxLen = 4000;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.substring(i, i + maxLen));
  }

  let firstMessageId: number | null = null;

  for (const chunk of chunks) {
    let data: { ok?: boolean; result?: { message_id?: number } } | null = null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
        }),
      });
      data = await res.json();
      // Telegram responde 400 con ok:false cuando el Markdown del modelo tiene
      // caracteres que no sabe cerrar; eso no lanza, hay que mirar el `ok`.
      if (!data?.ok) throw new Error('markdown rechazado');
    } catch {
      // Reintento sin parse_mode: el Markdown del modelo puede tener
      // caracteres que Telegram rechaza.
      try {
        const res = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
          }),
        });
        data = await res.json();
      } catch {
        data = null;
      }
    }

    if (firstMessageId === null && data?.ok && typeof data.result?.message_id === 'number') {
      firstMessageId = data.result.message_id;
    }
  }

  return firstMessageId;
}

/**
 * Reescribe un mensaje ya enviado. Es lo que permite que el progreso de un
 * pipeline sea un único mensaje que se actualiza, en vez de N+2 mensajes.
 *
 * Si el edit falla (mensaje demasiado viejo, Markdown inválido, texto idéntico)
 * cae a enviar uno nuevo y devuelve su id: el usuario nunca se queda sin señal.
 */
export async function editTelegramMessage(
  botToken: string,
  chatId: string | number,
  messageId: number,
  text: string
): Promise<number | null> {
  const cleanToken = botToken.trim();
  if (!cleanToken || !chatId) return null;

  try {
    const res = await fetch(`https://api.telegram.org/bot${cleanToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text.slice(0, 4000),
        parse_mode: 'Markdown',
      }),
    });
    const data = await res.json();
    if (data?.ok) return messageId;
  } catch {
    // Cae al envío nuevo.
  }

  return sendTelegramMessage(botToken, chatId, text);
}

export type TelegramCommand = 'nuevo' | 'start' | 'ayuda';

/**
 * Extrae el comando de un mensaje. El sufijo `@bot` no es opcional de tratar:
 * en grupos Telegram entrega `/nuevo@mi_bot`, y un `text === '/nuevo'` lo
 * tomaría por un prompt cualquiera.
 */
export function parseTelegramCommand(text: string): TelegramCommand | null {
  const match = /^\/(nuevo|start|ayuda)(@\w+)?\b/i.exec(text.trim());
  return match ? (match[1].toLowerCase() as TelegramCommand) : null;
}

/**
 * Atiende un mensaje entrante de Telegram.
 *
 * Devuelve `null` cuando el mensaje era un comando: no hubo ejecución, así que
 * tampoco hay nada que guardar en el historial.
 */
export async function processTelegramAgentRequest(options: {
  agent: AgentConfig;
  userPrompt: string;
  chatId: string | number;
  apiKey?: string;
  providerKeys?: ProviderKeys;
  botToken: string;
}): Promise<ExecutionRun | null> {
  const { agent, userPrompt, chatId, apiKey, providerKeys, botToken } = options;

  // Un hilo por chat: es lo que un usuario espera de un bot.
  const threadKey = telegramThreadKey(chatId);
  const memoryTurns = resolveMemoryTurns(agent.memoryTurns);

  const command = parseTelegramCommand(userPrompt);

  if (command === 'nuevo') {
    await resetConversation(agent.id, threadKey);
    await sendTelegramMessage(
      botToken,
      chatId,
      '🧹 Conversación reiniciada. El agente ya no recuerda los mensajes anteriores.'
    );
    return null;
  }

  if (command === 'start' || command === 'ayuda') {
    await sendTelegramMessage(
      botToken,
      chatId,
      `🤖 *${agent.avatar} ${agent.name}* — ${agent.role}\n\n` +
        `Modelo: ${agent.model}\n` +
        `Memoria: ${memoryTurns === 0 ? 'desactivada' : `últimos ${memoryTurns} turnos`}\n\n` +
        'Comandos:\n' +
        '/nuevo — empezar una conversación nueva\n' +
        '/ayuda — mostrar esta ayuda'
    );
    return null;
  }

  // Aviso inicial de "procesando" al chat de Telegram
  await sendTelegramMessage(
    botToken,
    chatId,
    `🤖 *${agent.name}* está procesando tu solicitud...\n\n_Pensamiento en progreso con modelo ${agent.model}_`
  );

  const history = await getConversationMessages(agent.id, threadKey);

  // Monitor en vivo. Se emite después de los guardas de comando: `/ayuda` no
  // produce ejecución, así que tampoco debe producir traza.
  const traceId = newTraceId();
  publishLiveEvent({
    traceId,
    type: 'run_start',
    source: 'telegram',
    targetKind: 'agent',
    targetId: agent.id,
    targetName: agent.name,
    targetAvatar: agent.avatar,
    prompt: userPrompt,
    telegramChatId: String(chatId),
  });

  try {
    const result = await runAgentEngine({
      agent,
      userPrompt,
      history,
      apiKey,
      providerKeys,
      // Esto corre en el servidor: hay que invocar el puente directamente.
      bridgeFn: runProviderBridge,
      mcpFn: runMcpBridge,
      mcpListFn: listMcpTools,
      onStepUpdate: (step) => publishLiveEvent({ traceId, type: 'thought', step }),
    });

    const simulatedWarning = result.simulated
      ? '\n\n⚠️ _Respuesta SIMULADA: no se pudo contactar con el proveedor._'
      : '';

    const telegramText = `🤖 *${agent.avatar} ${agent.name}* (${agent.role}):\n\n${result.finalOutput}\n\n⏱️ _Latencia: ${result.metrics.latencyMs}ms | Tokens: ${result.metrics.totalTokens}_${simulatedWarning}`;

    await sendTelegramMessage(botToken, chatId, telegramText);

    const runId = 'run-tg-' + Date.now();
    const now = new Date().toISOString();

    // El par usuario+respuesta se guarda junto y de forma atómica: media
    // conversación (solo el turno del usuario) rompería la alternancia de roles
    // y provocaría un 400 en la petición siguiente.
    await appendConversationTurn(agent.id, threadKey, {
      user: { role: 'user', content: userPrompt, timestamp: now },
      assistant: {
        role: 'assistant',
        content: result.finalOutput,
        timestamp: now,
        runId,
        // Se guarda para que la transcripción sea honesta, pero el motor no lo
        // realimenta: el agente no debe construir sobre texto inventado.
        simulated: result.simulated,
      },
    });

    publishLiveEvent({
      traceId,
      type: 'run_end',
      status: 'completed',
      finalOutput: result.finalOutput,
      metrics: result.metrics,
      simulated: result.simulated,
    });

    return {
      id: runId,
      agentId: agent.id,
      agentName: agent.name,
      agentAvatar: agent.avatar,
      agentRole: agent.role,
      prompt: userPrompt,
      status: 'completed',
      steps: result.steps,
      finalOutput: result.finalOutput,
      metrics: result.metrics,
      timestamp: new Date().toISOString(),
      source: 'telegram',
      telegramChatId: String(chatId),
      threadKey,
      simulated: result.simulated,
      provider: result.provider,
    };
  } catch (err) {
    // En modo estricto el motor lanza en vez de simular: el usuario de Telegram
    // debe enterarse del fallo en lugar de quedarse esperando. El turno fallido
    // NO se persiste: dejaría un mensaje de usuario sin respuesta que rompe la
    // alternancia de roles del hilo.
    const message = err instanceof Error ? err.message : String(err);
    await sendTelegramMessage(
      botToken,
      chatId,
      `❌ *${agent.name}* no pudo completar la solicitud:\n\n${message}`
    );

    publishLiveEvent({
      traceId,
      type: 'run_end',
      status: 'failed',
      finalOutput: message,
      simulated: false,
      error: message,
    });

    return {
      id: 'run-tg-' + Date.now(),
      agentId: agent.id,
      agentName: agent.name,
      agentAvatar: agent.avatar,
      agentRole: agent.role,
      prompt: userPrompt,
      status: 'failed',
      steps: [],
      finalOutput: message,
      timestamp: new Date().toISOString(),
      source: 'telegram',
      telegramChatId: String(chatId),
      threadKey,
    };
  }
}

// --- WORKFLOWS ---

const STEP_ICON: Record<WorkflowStepResult['status'], string> = {
  completed: '✅',
  skipped: '⏭️',
  failed: '❌',
};

function formatSeconds(ms?: number): string {
  return typeof ms === 'number' ? ` (${(ms / 1000).toFixed(1)} s)` : '';
}

/**
 * Cuerpo del mensaje de progreso. Se recalcula entero en cada paso y se reenvía
 * con `editTelegramMessage`, de modo que el chat conserva un único mensaje vivo
 * en lugar de acumular uno por paso.
 */
function renderProgress(
  workflow: WorkflowConfig,
  results: WorkflowStepResult[],
  agents: Record<string, AgentConfig>
): string {
  const lines = workflow.steps.map((step, index) => {
    const done = results[index];
    const agent = agents[step.agentId];
    const label = `${agent?.avatar ?? '⚠️'} ${agent?.name ?? step.agentId}`;

    if (done) {
      return `${STEP_ICON[done.status]} ${index + 1}/${workflow.steps.length} · ${label}${formatSeconds(done.metrics?.latencyMs ?? undefined)}`;
    }
    // El primer paso sin resultado es el que está corriendo ahora mismo.
    const running = index === results.length;
    return `${running ? '⏳' : '◽'} ${index + 1}/${workflow.steps.length} · ${label}`;
  });

  return `🔗 *${workflow.name}* (${workflow.steps.length} pasos)\n\n${lines.join('\n')}`;
}

/**
 * Atiende un mensaje entrante dirigido al bot de un **workflow**: un mensaje
 * dispara la cadena completa.
 *
 * A diferencia de un agente, aquí **no hay memoria**. Un paso de pipeline no es
 * un turno de conversación, así que nada se lee ni se escribe en
 * `data/conversations.json` y cada mensaje arranca la cadena desde cero.
 *
 * Devuelve una ejecución por paso ejecutado — el análogo del `null` de
 * `processTelegramAgentRequest` es aquí el array vacío, que significa que el
 * mensaje era un comando y no hubo nada que registrar.
 */
export async function processTelegramWorkflowRequest(options: {
  workflow: WorkflowConfig;
  /** Agentes ya indexados por id. Ver `indexAgents()` en workflowEngine. */
  agents: Record<string, AgentConfig>;
  userPrompt: string;
  chatId: string | number;
  apiKey?: string;
  providerKeys?: ProviderKeys;
  botToken: string;
}): Promise<ExecutionRun[]> {
  const { workflow, agents, userPrompt, chatId, apiKey, providerKeys, botToken } = options;

  const command = parseTelegramCommand(userPrompt);

  if (command === 'nuevo') {
    await sendTelegramMessage(
      botToken,
      chatId,
      'ℹ️ Este bot ejecuta un pipeline y no guarda memoria: cada mensaje lanza la cadena completa desde cero, así que no hay nada que reiniciar.'
    );
    return [];
  }

  if (command === 'start' || command === 'ayuda') {
    const steps = workflow.steps
      .map((step, index) => {
        const agent = agents[step.agentId];
        return agent
          ? `${index + 1}. ${agent.avatar} *${agent.name}* — \`${agent.model}\``
          : `${index + 1}. ⚠️ Agente ${step.agentId} (no encontrado, se omitirá)`;
      })
      .join('\n');

    await sendTelegramMessage(
      botToken,
      chatId,
      `🔗 *${workflow.name}*\n${workflow.description}\n\n` +
        `Cadena de ${workflow.steps.length} pasos:\n${steps}\n\n` +
        'Escríbeme lo que quieras y lo recorreré entero, pasando la salida de cada agente al siguiente.\n\n' +
        '⚠️ Este bot *no tiene memoria*: cada mensaje ejecuta la cadena desde cero.\n\n' +
        'Comandos:\n/ayuda — mostrar esta ayuda'
    );
    return [];
  }

  if (workflow.steps.length === 0) {
    await sendTelegramMessage(botToken, chatId, `⚠️ El workflow *${workflow.name}* no tiene pasos.`);
    return [];
  }

  const stepResults: WorkflowStepResult[] = [];
  let progressId = await sendTelegramMessage(
    botToken,
    chatId,
    renderProgress(workflow, stepResults, agents)
  );

  // Monitor en vivo: igual que en la ruta de agente, después de los guardas de
  // comando y del workflow vacío.
  const traceId = newTraceId();
  const timestamp = new Date().toISOString();
  publishLiveEvent({
    traceId,
    type: 'run_start',
    source: 'telegram',
    targetKind: 'workflow',
    targetId: workflow.id,
    targetName: workflow.name,
    targetAvatar: '🔗',
    prompt: userPrompt,
    telegramChatId: String(chatId),
    totalSteps: workflow.steps.length,
  });

  const pipeline = await runWorkflowPipeline({
    workflow,
    agents,
    initialPrompt: userPrompt,
    apiKey,
    providerKeys,
    // Esto corre en el servidor: hay que invocar los puentes directamente.
    bridgeFn: runProviderBridge,
    mcpFn: runMcpBridge,
    mcpListFn: listMcpTools,
    onStepStart: (index) => {
      const step = workflow.steps[index];
      const agent = agents[step.agentId];
      publishLiveEvent({
        traceId,
        type: 'step_start',
        index,
        stepName: step.stepName,
        agentName: agent?.name ?? step.agentId,
        agentAvatar: agent?.avatar ?? '⚠️',
      });
    },
    onAgentStep: (step, index) => publishLiveEvent({ traceId, type: 'thought', index, step }),
    onStepResult: async (result, index) => {
      stepResults.push(result);
      publishLiveEvent({
        traceId,
        type: 'step_result',
        index,
        stepName: result.stepName,
        agentName: result.agentName,
        agentAvatar: result.agentAvatar,
        status: result.status,
        output: result.output,
        metrics: result.metrics ?? undefined,
        simulated: result.simulated,
        ...(result.error ? { error: result.error } : {}),
        ...(result.status === 'skipped'
          ? {}
          : { runId: workflowStepRunId(timestamp, index) }),
      });

      const text = renderProgress(workflow, stepResults, agents);
      // Se espera a propósito: sin await los edits llegarían desordenados.
      progressId = progressId
        ? await editTelegramMessage(botToken, chatId, progressId, text)
        : await sendTelegramMessage(botToken, chatId, text);
    },
  });

  if (pipeline.failed) {
    const failure = pipeline.stepResults.at(-1);
    await sendTelegramMessage(
      botToken,
      chatId,
      `❌ El pipeline *${workflow.name}* se detuvo en "${failure?.stepName ?? 'un paso'}":\n\n${failure?.error ?? 'Error desconocido.'}`
    );
    publishLiveEvent({
      traceId,
      type: 'run_end',
      status: 'failed',
      finalOutput: pipeline.finalOutput,
      simulated: pipeline.simulated,
      error: failure?.error ?? 'Error desconocido.',
    });
  } else {
    const last = pipeline.stepResults.filter((s) => s.status === 'completed').at(-1);
    const totalMs = pipeline.stepResults.reduce((sum, s) => sum + (s.metrics?.latencyMs ?? 0), 0);
    const totalTokens = pipeline.stepResults.reduce(
      (sum, s) => sum + (s.metrics?.totalTokens ?? 0),
      0
    );
    const simulatedWarning = pipeline.simulated
      ? '\n\n⚠️ _Algún paso devolvió una respuesta SIMULADA: no se pudo contactar con el proveedor._'
      : '';

    await sendTelegramMessage(
      botToken,
      chatId,
      `🤖 *${last?.agentAvatar ?? '🔗'} ${last?.agentName ?? workflow.name}*:\n\n${pipeline.finalOutput}\n\n` +
        `⏱️ _Total: ${(totalMs / 1000).toFixed(1)} s | Tokens: ${totalTokens}_${simulatedWarning}`
    );

    publishLiveEvent({
      traceId,
      type: 'run_end',
      status: pipeline.aborted ? 'aborted' : 'completed',
      finalOutput: pipeline.finalOutput,
      simulated: pipeline.simulated,
    });
  }

  // Un paso omitido no llegó a ejecutarse: no hay nada que registrar. El
  // `timestamp` es el mismo que ya usó el monitor para calcular los `runId`.
  return pipeline.stepResults
    .map((result, index) =>
      result.status === 'skipped'
        ? null
        : workflowStepToRun(result, index, {
            timestamp,
            source: 'telegram',
            telegramChatId: String(chatId),
          })
    )
    .filter((run): run is ExecutionRun => run !== null);
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
  };
}

export async function getTelegramUpdates(botToken: string, offset?: number): Promise<TelegramUpdate[]> {
  const cleanToken = botToken.trim();
  if (!cleanToken) return [];

  const url = `https://api.telegram.org/bot${cleanToken}/getUpdates?timeout=0${offset ? `&offset=${offset}` : ''}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();
    if (data.ok && Array.isArray(data.result)) {
      return data.result as TelegramUpdate[];
    }
  } catch (err) {
    console.error('Error fetching Telegram updates:', err);
  }
  return [];
}
