import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { cached } from "./db";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  return (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

function model(): string {
  const m = process.env.OPENAI_MODEL;
  if (!m) throw new Error("OPENAI_MODEL is not set");
  return m;
}

/**
 * Ask the model for JSON matching `schema` (OpenAI structured outputs), then
 * re-validate with zod. Returns null if the call fails or output is invalid.
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
      const res = await openai().chat.completions.create({
        model: m,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: zodResponseFormat(schema, name),
      });
      const content = res.choices[0]?.message?.content;
      if (!content) return null;
      const parsed = schema.safeParse(JSON.parse(content));
      return parsed.success ? parsed.data : null;
    } catch (err) {
      console.error(`[llm:${name}]`, err instanceof Error ? err.message : err);
      // Throw so transient errors are not cached as null.
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
