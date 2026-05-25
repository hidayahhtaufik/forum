/// One-shot Postgres schema bootstrap.
///
/// Use when the runtime bootstrap inside `openDatabase()` didn't fire
/// (e.g. process crashed at better-sqlite3 import before reaching the
/// postgres branch). This script imports `PG_INITIAL_SCHEMA_SQL` +
/// `PG_MIGRATIONS` directly without touching better-sqlite3, so a broken
/// native binary won't block it.
///
/// Usage:
///   DATABASE_URL=postgresql://user:pass@host:port/dbname \
///     pnpm tsx src/scripts/bootstrap-pg.ts
///
/// Idempotent — every CREATE TABLE / ALTER TABLE is wrapped with
/// `IF NOT EXISTS`. Safe to re-run.

import postgres from "postgres";
import { PG_INITIAL_SCHEMA_SQL, PG_MIGRATIONS } from "../db/schema-pg.js";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
  console.error("[bootstrap-pg] DATABASE_URL must be a postgres:// or postgresql:// URL");
  console.error(`  got: ${url || "(empty)"}`);
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

console.log(`[bootstrap-pg] target: ${url.replace(/:[^:@/]+@/, ":***@")}`);

try {
  console.log("[bootstrap-pg] running PG_INITIAL_SCHEMA_SQL...");
  await sql.unsafe(PG_INITIAL_SCHEMA_SQL);
  console.log("[bootstrap-pg] initial schema applied.");

  for (const m of PG_MIGRATIONS) {
    process.stdout.write(`[bootstrap-pg] migration ${m.name} ... `);
    try {
      await sql.unsafe(m.sql);
      console.log("ok");
    } catch (err) {
      const msg = (err as Error).message.split("\n")[0] ?? String(err);
      console.log(`skipped (${msg.slice(0, 100)})`);
    }
  }

  const tables = await sql<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
  console.log(`[bootstrap-pg] done. ${tables.length} tables in public schema:`);
  for (const t of tables) console.log(`  - ${t.table_name}`);
} catch (err) {
  console.error("[bootstrap-pg] FAILED:", err);
  process.exit(1);
} finally {
  await sql.end();
}
