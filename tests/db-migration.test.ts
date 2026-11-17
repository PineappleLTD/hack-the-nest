// An older database (deals table without the deal-detail columns) is upgraded when the app opens it.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

describe("deals migration", () => {
  it("adds scope/applies_to/percent_off/amount_off/min_spend/max_savings and keeps existing rows", async () => {
    const old = new Database(process.env.DB_PATH!);
    old.exec(`
      CREATE TABLE cache (key TEXT PRIMARY KEY, namespace TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE deals (
        id TEXT PRIMARY KEY, store TEXT NOT NULL, store_key TEXT NOT NULL, query TEXT NOT NULL, code TEXT,
        description TEXT NOT NULL, discount_text TEXT NOT NULL, expires_at TEXT, source_url TEXT NOT NULL,
        source_title TEXT, found_at INTEGER NOT NULL
      );
      INSERT INTO deals VALUES ('legacy-1', 'Amazon', 'amazon', 'amazon', 'GUN5WP5N', '$40 off Dual Power Fuel Transfer Pump',
        '$40 off', NULL, 'https://www.amazon.com/promotion/psp/A1B2C3', NULL, 1);
    `);
    old.close();

    const { db } = await import("@/lib/db");
    const cols = (db.prepare("PRAGMA table_info(deals)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(["scope", "applies_to", "percent_off", "amount_off", "min_spend", "max_savings"]),
    );
    expect(db.prepare("SELECT code, scope, percent_off FROM deals WHERE id = 'legacy-1'").get()).toEqual({
      code: "GUN5WP5N",
      scope: null,
      percent_off: null,
    });

    // A legacy row has scope null and must never be auto-applied.
    const { dealsForStore } = await import("@/lib/deals");
    const { applyDeal } = await import("@/lib/discount");
    const [legacy] = dealsForStore("amazon");
    expect(legacy.scope).toBeNull();
    expect(applyDeal(39.99, legacy)).toBeNull();
    expect(applyDeal(400, legacy)).toBeNull();
  });
});
