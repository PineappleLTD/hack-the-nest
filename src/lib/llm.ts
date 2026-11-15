import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { cached } from "./db";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  return (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

function model(): string {
  return process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
}

/**
 * Ask Claude for JSON matching `schema` (structured outputs; the SDK validates it with zod).
 * Returns null if the model refuses, runs out of tokens, or the output doesn't validate.
 * Throws on API/config errors so they are not cached and callers can surface them.
 * Results (including nulls) are cached by model + prompt.
 */
export async function structured<S extends z.ZodType>(
  name: string,
  schema: S,
  system: string,
  user: string,
): Promise<z.infer<S> | null> {
  const m = model();
  return cached<z.infer<S> | null>("llm", { name, model: m, system, user }, async () => {
    try {
      const res = await anthropic().messages.parse({
        model: m,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: "low", format: zodOutputFormat(schema) },
      });
      if (res.stop_reason !== "end_turn") {
        console.error(`[llm:${name}] stop_reason=${res.stop_reason}`);
        return null;
      }
      return (res.parsed_output as z.infer<S> | null) ?? null;
    } catch (err) {
      console.error(`[llm:${name}]`, err instanceof Error ? err.message : err);
      throw err;
    }
  });
}

/** Like `structured` but never throws; returns null on any failure. */
export async function tryStructured<S extends z.ZodType>(
  name: string,
  schema: S,
  system: string,
  user: string,
): Promise<z.infer<S> | null> {
  try {
    return await structured(name, schema, system, user);
  } catch {
    return null;
  }
}

/**
 * Run `fn` over items with bounded concurrency, turning per-item errors into null.
 * If every item failed (and there was at least one), rethrow the first error so a
 * broken key or outage shows up as an error instead of an empty result.
 */
export async function mapSettled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R | null>): Promise<(R | null)[]> {
  const errors: unknown[] = [];
  const out = await mapLimit(items, limit, (item) =>
    fn(item).catch((err) => {
      errors.push(err);
      return null;
    }),
  );
  if (items.length > 0 && errors.length === items.length) throw errors[0];
  return out;
}

/** Run async tasks with bounded concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
