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
  `);
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
 */
export async function cached<T>(
  namespace: string,
  keyParts: unknown,
  fn: () => Promise<T>,
  shouldCache: (v: T) => boolean = () => true,
): Promise<T> {
  const key = `${namespace}:${hashKey(keyParts)}`;
  const row = db.prepare("SELECT value FROM cache WHERE key = ?").get(key) as { value: string } | undefined;
  if (row) return JSON.parse(row.value) as T;
  const value = await fn();
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
