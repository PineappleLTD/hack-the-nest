// Tripwire: if any of these fail, other tests might reach a paid API or the real database.
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { describe, expect, it } from "vitest";
import Exa from "exa-js";
import Anthropic from "@anthropic-ai/sdk";
import FakeExa, { exa } from "./helpers/exa-mock";
import { anthropic } from "./helpers/anthropic-mock";

describe("test isolation", () => {
  it("uses fake API keys and leaves optional integrations unconfigured", () => {
    expect(process.env.EXA_API_KEY).toBe("test-exa-key-not-real");
    expect(process.env.ANTHROPIC_API_KEY).toBe("test-anthropic-key-not-real");
    expect(process.env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(process.env.EBAY_OAUTH_TOKEN).toBeUndefined();
  });

  it("points the database at a temp file, never data/agent-shop.db", async () => {
    expect(process.env.DB_PATH).toBeTruthy();
    expect(path.dirname(process.env.DB_PATH!)).toBe(os.tmpdir());
    const { db } = await import("@/lib/db");
    expect(db.name).toBe(process.env.DB_PATH);
    expect(db.name).not.toContain(path.join("data", "agent-shop.db"));
  });

  it("replaces exa-js with the fake", async () => {
    expect(Exa).toBe(FakeExa);
    await expect(new Exa("k").search("anything")).rejects.toThrow(/did not stub/);
    expect(exa.search).toHaveBeenCalledTimes(1);
  });

  it("replaces @anthropic-ai/sdk with the fake but keeps the real error classes", async () => {
    const client = new Anthropic({ apiKey: "k" });
    await expect(client.messages.parse({} as never)).rejects.toThrow(/did not stub/);
    expect(anthropic.parse).toHaveBeenCalledTimes(1);
    const real = await import("@anthropic-ai/sdk");
    expect(Anthropic.AuthenticationError).toBe(real.AuthenticationError);
    expect(new real.AuthenticationError(401, {}, "x", new Headers())).toBeInstanceOf(Anthropic.APIError);
  });

  it("blocks fetch and raw sockets", async () => {
    await expect(fetch("https://api.exa.ai/search")).rejects.toThrow(/blocked/);
    expect(() => http.get("http://example.com")).toThrow(/blocked/);
  });
});
