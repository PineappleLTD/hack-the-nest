/**
 * Runs before every test file.
 * - Fake API keys only; optional integrations (Stripe, eBay) start unconfigured.
 * - A fresh temp SQLite file per test file (never data/agent-shop.db), emptied before each test.
 * - No network: fetch and raw sockets throw, and exa-js / @anthropic-ai/sdk are replaced by fakes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, vi } from "vitest";
import { resetAnthropic } from "./helpers/anthropic-mock";
import { resetExa } from "./helpers/exa-mock";

process.env.EXA_API_KEY = "test-exa-key-not-real";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key-not-real";
for (const name of ["ANTHROPIC_MODEL", "ANTHROPIC_AUTH_TOKEN", "STRIPE_SECRET_KEY", "EBAY_OAUTH_TOKEN", "EBAY_ENV", "EBAY_APP_ID"]) {
  delete process.env[name];
}

const dbPath = path.join(os.tmpdir(), `agent-shop-test-${process.pid}-${crypto.randomUUID()}.db`);
process.env.DB_PATH = dbPath;
// src/lib/db.ts keeps its connection on globalThis; never inherit one pointing at another file.
globalThis.__agentShopDb?.close();
globalThis.__agentShopDb = undefined;

// ---------- No network ----------
const blockedFetch = async (input: unknown) => {
  throw new Error(`Network access is blocked in tests: fetch(${String(input)})`);
};
globalThis.fetch = blockedFetch as unknown as typeof fetch;
net.Socket.prototype.connect = function blockedConnect() {
  throw new Error("Network access is blocked in tests (net.Socket.connect)");
} as unknown as typeof net.Socket.prototype.connect;

vi.mock("exa-js", () => import("./helpers/exa-mock"));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const { anthropicModule } = await import("./helpers/anthropic-mock");
  return anthropicModule(await importOriginal());
});

// The app logs every Exa call and failure; keep test output readable (TEST_VERBOSE=1 to see it).
if (!process.env.TEST_VERBOSE) {
  console.log = () => {};
  console.error = () => {};
}

beforeEach(() => {
  resetExa();
  resetAnthropic();
  globalThis.__agentShopDb?.exec("DELETE FROM cache; DELETE FROM deals; DELETE FROM stripe_accounts;");
});

afterAll(() => {
  globalThis.__agentShopDb?.close();
  globalThis.__agentShopDb = undefined;
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbPath + suffix, { force: true });
});
