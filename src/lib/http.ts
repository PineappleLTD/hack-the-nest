import { NextResponse } from "next/server";

/** Thrown when an optional integration has no credentials, so routes can answer 503 with a clear message. */
export class NotConfiguredError extends Error {
  name = "NotConfiguredError";
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serverError(err: unknown) {
  const message = err instanceof Error ? err.message : "Something went wrong";
  // Missing credentials for an optional integration: a clear 503, not a stack trace.
  if (err instanceof NotConfiguredError) return NextResponse.json({ error: message }, { status: 503 });
  console.error("[api]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
