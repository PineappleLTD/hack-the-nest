import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as SDK from "@anthropic-ai/sdk";
import { mapLimit, mapSettled, structured, tryStructured } from "@/lib/llm";
import { anthropic, authError } from "./helpers/anthropic-mock";

const Schema = z.object({ answer: z.string() });
const ok = (parsed: unknown) => ({ stop_reason: "end_turn", parsed_output: parsed });

describe("structured", () => {
  it("calls messages.parse with Haiku, thinking disabled, low effort and a structured format", async () => {
    anthropic.parse.mockResolvedValue(ok({ answer: "42" }));
    expect(await structured("demo", Schema, "You answer.", "What is 6x7?")).toEqual({ answer: "42" });
    expect(anthropic.parse).toHaveBeenCalledTimes(1);
    const params = anthropic.parse.mock.calls[0][0];
    expect(params).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 4096,
      system: "You answer.",
      messages: [{ role: "user", content: "What is 6x7?" }],
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
    });
    expect(params.output_config?.format).toBeTruthy();
    expect(anthropic.clientOptions).toEqual([{ apiKey: "test-anthropic-key-not-real" }]);
  });

  it("uses ANTHROPIC_MODEL when set", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-sonnet-5-5");
    anthropic.parse.mockResolvedValue(ok({ answer: "x" }));
    await structured("demo", Schema, "s", "model override");
    expect(anthropic.parse.mock.calls[0][0].model).toBe("claude-sonnet-5-5");
  });

  it.each(["max_tokens", "refusal", "pause_turn"])("returns null when stop_reason is %s", async (stop_reason) => {
    anthropic.parse.mockResolvedValue({ stop_reason, parsed_output: { answer: "partial" } });
    expect(await structured("demo", Schema, "s", `stop ${stop_reason}`)).toBeNull();
  });

  it("returns null when there is no parsed output", async () => {
    anthropic.parse.mockResolvedValue(ok(null));
    expect(await structured("demo", Schema, "s", "no output")).toBeNull();
  });

  it("caches by name + model + prompt", async () => {
    anthropic.parse.mockResolvedValue(ok({ answer: "a" }));
    await structured("demo", Schema, "s", "same");
    await structured("demo", Schema, "s", "same");
    expect(anthropic.parse).toHaveBeenCalledTimes(1);
    await structured("demo", Schema, "s", "different");
    await structured("other", Schema, "s", "same");
    expect(anthropic.parse).toHaveBeenCalledTimes(3);
  });

  it("an invalid key becomes a readable error", async () => {
    anthropic.parse.mockRejectedValue(authError(SDK));
    await expect(structured("demo", Schema, "s", "u")).rejects.toThrow("Claude rejected the API key (check ANTHROPIC_API_KEY)");
  });

  it("does not cache errors, so a fixed key works on the next call", async () => {
    anthropic.parse.mockRejectedValueOnce(authError(SDK)).mockResolvedValueOnce(ok({ answer: "fixed" }));
    await expect(structured("demo", Schema, "s", "retry me")).rejects.toThrow(/rejected the API key/);
    expect(await structured("demo", Schema, "s", "retry me")).toEqual({ answer: "fixed" });
  });

  it.each([
    [() => new SDK.PermissionDeniedError(403, {}, "nope", new Headers()), "This Anthropic API key can't use the configured model"],
    [() => new SDK.NotFoundError(404, {}, "nope", new Headers()), "Claude model not found: claude-haiku-5-5 (check ANTHROPIC_MODEL)"],
    [() => new SDK.RateLimitError(429, {}, "slow down", new Headers()), "Claude is rate limiting requests right now; try again in a moment"],
    [() => new SDK.APIConnectionError({ message: "ECONNREFUSED" }), "Couldn't reach the Claude API (network error)"],
    [() => new SDK.InternalServerError(500, {}, "oops", new Headers()), "Claude API error 500"],
  ])("maps SDK errors to readable messages (%#)", async (make, message) => {
    anthropic.parse.mockRejectedValue(make());
    await expect(structured("demo", Schema, "s", `err ${message}`)).rejects.toThrow(message);
  });

  it("passes non-SDK errors through unchanged", async () => {
    const err = new TypeError("bad");
    anthropic.parse.mockRejectedValue(err);
    await expect(structured("demo", Schema, "s", "type error")).rejects.toBe(err);
  });

  it("a missing ANTHROPIC_API_KEY is an error, not a silent null", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(structured("demo", Schema, "s", "no key")).rejects.toThrow("ANTHROPIC_API_KEY is not set");
    expect(anthropic.parse).not.toHaveBeenCalled();
  });
});

describe("tryStructured", () => {
  it("returns null instead of throwing", async () => {
    anthropic.parse.mockRejectedValue(authError(SDK));
    expect(await tryStructured("demo", Schema, "s", "u")).toBeNull();
  });
});

describe("mapSettled", () => {
  it("turns per-item errors into null and keeps order", async () => {
    const out = await mapSettled([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("bad page");
      return n * 10;
    });
    expect(out).toEqual([10, null, 30]);
  });

  it("rethrows the first error when every item failed", async () => {
    await expect(
      mapSettled([1, 2], 2, async (n) => {
        throw new Error(`fail ${n}`);
      }),
    ).rejects.toThrow("fail 1");
  });

  it("does not throw when every item returned null (no error)", async () => {
    expect(await mapSettled([1, 2], 2, async () => null)).toEqual([null, null]);
  });

  it("returns [] for no items", async () => {
    expect(await mapSettled([], 4, async () => 1)).toEqual([]);
  });
});

describe("mapLimit", () => {
  it("bounds concurrency and preserves order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n, i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return `${i}:${n}`;
    });
    expect(out).toEqual(["0:5", "1:1", "2:4", "3:2", "4:3"]);
    expect(peak).toBe(2);
  });
});
