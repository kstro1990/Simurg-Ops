import { NextRequest, NextResponse } from 'next/server';
import {
  deleteStoredWorkflow,
  getStoredWorkflows,
  saveStoredWorkflows,
} from '@/lib/serverStorage';
import { WorkflowConfig } from '@/types/agent';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error desconocido';
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Sin esta validación, un POST de `{}` se persistía como un workflow sin `id`
 * que `DELETE ?id=` no podía volver a borrar nunca.
 */
function isWorkflowConfig(value: unknown): value is WorkflowConfig {
  if (!value || typeof value !== 'object') return false;
  const wf = value as Partial<WorkflowConfig>;
  if (!nonEmptyString(wf.id) || !nonEmptyString(wf.name)) return false;
  if (!Array.isArray(wf.steps)) return false;
  return wf.steps.every(
    (step) =>
      step &&
      typeof step === 'object' &&
      nonEmptyString(step.id) &&
      nonEmptyString(step.agentId) &&
      typeof step.stepName === 'string'
  );
}

export async function GET() {
  try {
    const workflows = await getStoredWorkflows();
    return NextResponse.json({ success: true, workflows });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let workflows: WorkflowConfig[];

    if (Array.isArray(body)) {
      // Reemplazo total de la lista.
      if (!body.every(isWorkflowConfig)) {
        return NextResponse.json(
          { success: false, error: 'La lista contiene workflows inválidos.' },
          { status: 400 }
        );
      }
      workflows = body;
    } else {
      if (!isWorkflowConfig(body)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Workflow inválido: requiere id, name y steps con id, agentId y stepName.',
          },
          { status: 400 }
        );
      }
      // Upsert por id: la edición desde la UI reenvía el mismo id y antes se
      // duplicaba en la lista en lugar de actualizarse.
      const current = await getStoredWorkflows();
      const index = current.findIndex((w) => w.id === body.id);
      workflows =
        index === -1
          ? [body, ...current]
          : current.map((w, i) => (i === index ? body : w));
    }

    await saveStoredWorkflows(workflows);
    return NextResponse.json({ success: true, workflows });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const workflowId = new URL(req.url).searchParams.get('id');
    if (!workflowId) {
      return NextResponse.json(
        { success: false, error: 'Se requiere el query param id.' },
        { status: 400 }
      );
    }
    const workflows = await deleteStoredWorkflow(workflowId);
    return NextResponse.json({ success: true, workflows });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
