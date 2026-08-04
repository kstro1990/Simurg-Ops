/** Extrae un mensaje legible de un `unknown` capturado en un catch. */
export function errorMessage(error: unknown, fallback = 'Error desconocido'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}
