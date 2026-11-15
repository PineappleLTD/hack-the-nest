import { afterEach, describe, expect, it, vi } from "vitest";
import { cached, db, hashKey } from "@/lib/db";

afterEach(() => {
  vi.useRealTimers();
});

describe("cached", () => {
  it("runs fn on a miss and serves the stored value afterwards", async () => {
    const fn = vi.fn(async () => ({ n: 1 }));
    expect(await cached("t", { q: "a" }, fn)).toEqual({ n: 1 });
    expect(await cached("t", { q: "a" }, fn)).toEqual({ n: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    const row = db.prepare("SELECT namespace, value FROM cache WHERE key = ?").get(`t:${hashKey({ q: "a" })}`);
    expect(row).toEqual({ namespace: "t", value: JSON.stringify({ n: 1 }) });
  });

  it("keys by namespace and key parts", async () => {
    const fn = vi.fn(async () => "v");
    await cached("t", { q: "a" }, fn);
    await cached("t", { q: "b" }, fn);
    await cached("other", { q: "a" }, fn);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not store a value when shouldCache says no", async () => {
    const fn = vi.fn(async () => [] as string[]);
    await cached("t", "k", fn, (v) => v.length > 0);
    await cached("t", "k", fn, (v) => v.length > 0);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not store a thrown error, so the next call tries again", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    await expect(cached("t", "k", fn)).rejects.toThrow("boom");
    expect(await cached("t", "k", fn)).toBe("ok");
  });

  it("without maxAgeMs, an entry never expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    const fn = vi.fn(async () => "v1");
    await cached("t", "k", fn);
    vi.setSystemTime(new Date("2027-11-01T12:00:00Z"));
    expect(await cached("t", "k", fn)).toBe("v1");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("with maxAgeMs, a fresh entry is served and a stale one refreshed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
    const fn = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");
    const hour = 3600_000;
    expect(await cached("t", "k", fn, undefined, hour)).toBe("v1");
    vi.setSystemTime(new Date("2026-11-15T08:59:00Z"));
    expect(await cached("t", "k", fn, undefined, hour)).toBe("v1");
    vi.setSystemTime(new Date("2026-11-15T09:01:00Z"));
    expect(await cached("t", "k", fn, undefined, hour)).toBe("v2");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("serves the stale value when the refresh throws", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
    await cached("t", "k", async () => "old", undefined, 1000);
    vi.setSystemTime(new Date("2026-11-15T09:00:00Z"));
    expect(await cached("t", "k", async () => Promise.reject(new Error("Exa down")), undefined, 1000)).toBe("old");
  });

  it("throws when the refresh fails and there is nothing stale to serve", async () => {
    await expect(cached("t", "nothing", async () => Promise.reject(new Error("Exa down")), undefined, 1000)).rejects.toThrow(
      "Exa down",
    );
  });

  it("round-trips null (an LLM 'no answer' is cached too)", async () => {
    const fn = vi.fn(async () => null);
    expect(await cached("t", "null", fn)).toBeNull();
    expect(await cached("t", "null", fn)).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("schema", () => {
  it("creates the deals table with the deal-detail columns", () => {
    const cols = (db.prepare("PRAGMA table_info(deals)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(["scope", "applies_to", "percent_off", "amount_off", "min_spend", "max_savings", "found_at"]),
    );
  });

  it("hashKey is stable for equal inputs", () => {
    expect(hashKey({ a: 1 })).toBe(hashKey({ a: 1 }));
    expect(hashKey({ a: 1 })).not.toBe(hashKey({ a: 2 }));
  });
});
