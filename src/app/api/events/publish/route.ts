import { NextRequest, NextResponse } from 'next/server';
import { publishLiveEvent } from '@/lib/liveEvents';
import { errorMessage } from '@/lib/errors';
import type { LiveEventInput } from '@/types/liveEvent';

/**
 * Entrada de eventos para los productores que NO viven en este proceso: los
 * motores que corren en el navegador (`ExecutionPanel`, `WorkflowBuilder`) y el
 * CLI. Los productores de servidor llaman a `publishLiveEvent` directamente.
 *
 * Acepta un lote: un bucle agéntico de Gemini emite muchos pasos y una petición
 * por paso costaría más que lo que se está monitorizando.
 *
 * Sin autenticación, igual que el resto del arnés. Cualquiera que alcance el
 * puerto puede inyectar eventos falsos en la consola. Por eso el monitor pinta
 * el texto en plano y nunca como Markdown.
 */
export const runtime = 'nodejs';

/** Eventos por petición. Cortafuegos contra un cliente descontrolado. */
const MAX_BATCH = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Guarda estricta de la unión discriminada, en la línea de `isWorkflowConfig()`
 * en la ruta de workflows. Un evento mal formado se descarta, no se propaga.
 */
function isLiveEventInput(value: unknown): value is LiveEventInput {
  if (!isRecord(value) || !nonEmptyString(value.traceId)) return false;

  switch (value.type) {
    case 'run_start':
      return (
        (value.source === 'telegram' || value.source === 'web' || value.source === 'cli') &&
        (value.targetKind === 'agent' || value.targetKind === 'workflow') &&
        nonEmptyString(value.targetId) &&
        typeof value.targetName === 'string' &&
        typeof value.prompt === 'string'
      );
    case 'step_start':
      return typeof value.index === 'number' && typeof value.stepName === 'string';
    case 'step_result':
      return (
        typeof value.index === 'number' &&
        (value.status === 'completed' || value.status === 'skipped' || value.status === 'failed') &&
        typeof value.output === 'string'
      );
    case 'thought':
      return isRecord(value.step) && typeof value.step.content === 'string';
    case 'run_end':
      return (
        (value.status === 'completed' || value.status === 'failed' || value.status === 'aborted') &&
        typeof value.finalOutput === 'string'
      );
    default:
      return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const candidates: unknown[] = Array.isArray(body) ? body : [body];

    if (candidates.length > MAX_BATCH) {
      return NextResponse.json(
        { success: false, error: `Máximo ${MAX_BATCH} eventos por petición.` },
        { status: 400 }
      );
    }

    let accepted = 0;
    for (const candidate of candidates) {
      if (!isLiveEventInput(candidate)) continue;
      publishLiveEvent(candidate);
      accepted += 1;
    }

    return NextResponse.json({ success: true, accepted, received: candidates.length });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
