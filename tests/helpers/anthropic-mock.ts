/**
 * Stand-in for the `@anthropic-ai/sdk` package. tests/setup.ts mocks "@anthropic-ai/sdk" with
 * `anthropicModule()` for every test file, so no test can reach the real Claude API. The SDK's real
 * error classes are kept, so `instanceof Anthropic.AuthenticationError` in src/lib/llm.ts still works.
 */
import { vi } from "vitest";
import type * as SDK from "@anthropic-ai/sdk";

export type ParseParams = {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: string; content: string }[];
  thinking?: { type: string };
  output_config?: { effort?: string; format?: unknown };
};
export type ParseResult = { stop_reason: string; parsed_output: unknown };

export const anthropic = {
  parse: vi.fn<(params: ParseParams) => Promise<ParseResult>>(async () => {
    throw new Error("anthropic.messages.parse was called but this test did not stub it");
  }),
  /** Options passed to `new Anthropic(opts)`. */
  clientOptions: [] as unknown[],
};

export function resetAnthropic() {
  anthropic.parse.mockReset();
  anthropic.clientOptions.length = 0;
}

const ERROR_CLASSES = [
  "AnthropicError",
  "APIError",
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "APIUserAbortError",
  "AuthenticationError",
  "BadRequestError",
  "ConflictError",
  "InternalServerError",
  "NotFoundError",
  "PermissionDeniedError",
  "RateLimitError",
  "UnprocessableEntityError",
] as const;

export async function anthropicModule(actual: typeof SDK) {
  class FakeAnthropic {
    messages = { parse: (params: ParseParams) => anthropic.parse(params) };
    constructor(opts: unknown) {
      anthropic.clientOptions.push(opts);
    }
  }
  const real = actual.default as unknown as Record<string, unknown>;
  for (const name of ERROR_CLASSES) {
    if (real[name]) Object.defineProperty(FakeAnthropic, name, { value: real[name] });
  }
  return { ...actual, default: FakeAnthropic, Anthropic: FakeAnthropic };
}

/** A real SDK AuthenticationError, as the SDK throws for an invalid x-api-key. */
export function authError(actual: typeof SDK): Error {
  const body = { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };
  return new actual.AuthenticationError(401, body, "invalid x-api-key", new Headers());
}
