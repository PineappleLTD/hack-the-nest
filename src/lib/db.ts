import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "agent-shop.db");

declare global {
  var __agentShopDb: Database.Database | undefined;
}

function open(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      store TEXT NOT NULL,
      store_key TEXT NOT NULL,
      query TEXT NOT NULL,
      code TEXT,
      description TEXT NOT NULL,
      discount_text TEXT NOT NULL,
      expires_at TEXT,
      source_url TEXT NOT NULL,
      source_title TEXT,
      found_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS deals_store_key ON deals(store_key);
    CREATE TABLE IF NOT EXISTS stripe_accounts (
      seller_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  // Columns added after the first release; older databases get them on open.
  const dealCols = new Set((db.prepare("PRAGMA table_info(deals)").all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of [
    ["scope", "TEXT"],
    ["applies_to", "TEXT"],
    ["percent_off", "REAL"],
    ["amount_off", "REAL"],
    ["min_spend", "REAL"],
    ["max_savings", "REAL"],
  ]) {
    if (!dealCols.has(name)) db.exec(`ALTER TABLE deals ADD COLUMN ${name} ${type}`);
  }
  return db;
}

// Reuse one connection across hot reloads in dev.
export const db: Database.Database = globalThis.__agentShopDb ?? (globalThis.__agentShopDb = open());

export function hashKey(parts: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * Read-through cache. `fn` only runs on a miss; its result is stored as JSON.
 * Pass `shouldCache` to skip storing empty/failed results.
 * Pass `maxAgeMs` to refresh entries older than that; if the refresh throws, the stale value is returned.
 */
export async function cached<T>(
  namespace: string,
  keyParts: unknown,
  fn: () => Promise<T>,
  shouldCache: (v: T) => boolean = () => true,
  maxAgeMs?: number,
): Promise<T> {
  const key = `${namespace}:${hashKey(keyParts)}`;
  const row = db.prepare("SELECT value, created_at FROM cache WHERE key = ?").get(key) as
    | { value: string; created_at: number }
    | undefined;
  if (row && (maxAgeMs == null || Date.now() - row.created_at < maxAgeMs)) return JSON.parse(row.value) as T;
  let value: T;
  try {
    value = await fn();
  } catch (err) {
    if (row) {
      console.error(`[cache:${namespace}] refresh failed, serving stale entry`, err instanceof Error ? err.message : err);
      return JSON.parse(row.value) as T;
    }
    throw err;
  }
  if (shouldCache(value)) {
    db.prepare("INSERT OR REPLACE INTO cache (key, namespace, value, created_at) VALUES (?, ?, ?, ?)").run(
      key,
      namespace,
      JSON.stringify(value),
      Date.now(),
    );
  }
  return value;
}
