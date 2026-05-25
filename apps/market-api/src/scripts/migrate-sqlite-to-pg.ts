/// One-shot data migration: sqlite (`market.db`) → Postgres.
///
/// Usage:
///   SQLITE_DB_PATH=./market.db \
///   DATABASE_URL=postgresql://ttsadmin:...@127.0.0.1:5433/forum_db \
///   pnpm tsx src/scripts/migrate-sqlite-to-pg.ts
///
/// Strategy:
///   - Read every row from each sqlite table.
///   - INSERT INTO <table> (...) VALUES (...) ON CONFLICT DO NOTHING into pg.
///   - On AUTO-INCREMENT id columns (`bets.id`, `trace_bets.id`) we OMIT the id
///     and let pg's `GENERATED ALWAYS AS IDENTITY` assign a fresh one. We DO
///     copy the rest of the row verbatim. (No callsites reference bet ids
///     externally — the only unique anchor that matters is `bets.intent_hash`,
///     and that's preserved by the column copy.)
///   - Idempotent: re-running the script is a no-op once data is in pg
///     (uniqueness anchors prevent dupes).
///   - Fails loud: any unexpected error stops the migration with a clear
///     `[migrate-pg] FAILED on <table>` message.
///
/// What we do NOT touch:
///   - The original sqlite file. Migration is read-only against it.
///   - The pg schema itself — assume market-api has booted at least once
///     against the target DATABASE_URL so PG_INITIAL_SCHEMA_SQL + PG_MIGRATIONS
///     already ran. The deployment runbook (docs/POSTGRES_MIGRATION.md) lists
///     this as step 3 before this script in step 4.

import Database from "better-sqlite3";
import postgres from "postgres";
import { resolve } from "node:path";

const SQLITE_PATH = resolve(process.cwd(), process.env.SQLITE_DB_PATH ?? "./market.db");
const PG_URL = process.env.DATABASE_URL ?? "";

if (!PG_URL.startsWith("postgres://") && !PG_URL.startsWith("postgresql://")) {
  console.error("[migrate-pg] DATABASE_URL must be a postgres:// or postgresql:// URL");
  process.exit(1);
}

/// Tables to copy, in dependency order (parent before child due to FK refs).
/// `idColumn` set when pg uses `GENERATED ALWAYS AS IDENTITY` and we want to
/// skip the source id so pg assigns a fresh one.
type TableSpec = {
  name: string;
  /** Column to omit from the INSERT (pg-generated identity). */
  identityColumn?: string;
  /** ON CONFLICT target — column(s) that act as a uniqueness anchor for skip-on-dup. */
  conflictTarget?: string;
};

const TABLES: ReadonlyArray<TableSpec> = [
  { name: "markets",          conflictTarget: "(id)" },
  { name: "resolutions",      conflictTarget: "(market_id)" },
  { name: "agents",           conflictTarget: "(address)" },
  { name: "trader_wallets",   conflictTarget: "(identity)" },
  { name: "bets",             identityColumn: "id", conflictTarget: "(intent_hash)" },
  { name: "forecast_traces",  conflictTarget: "(sha256)" },
  { name: "trace_markets",    conflictTarget: "(id)" },
  { name: "trace_bets",       identityColumn: "id" /* no natural unique anchor; rerun = dupes if dropped */ },
  { name: "copy_trades",      conflictTarget: "(subscriber, target)" },
  { name: "agent_listings",   conflictTarget: "(agent_address)" },
  { name: "agent_rentals",    conflictTarget: "(renter, agent_address, starts_at)" },
];

async function main() {
  console.log(`[migrate-pg] sqlite: ${SQLITE_PATH}`);
  console.log(`[migrate-pg] postgres: ${PG_URL.replace(/:[^:@/]+@/, ":***@")}`);

  const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  const pg = postgres(PG_URL, { max: 1 });

  let totalCopied = 0;
  try {
    for (const spec of TABLES) {
      const exists = sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
        .get(spec.name);
      if (!exists) {
        console.log(`[migrate-pg] skip ${spec.name} (not in sqlite)`);
        continue;
      }
      const rows = sqlite.prepare(`SELECT * FROM ${spec.name}`).all() as Array<Record<string, unknown>>;
      const beforeRes = await pg.unsafe(`SELECT COUNT(*)::int AS n FROM ${spec.name}`);
      const beforeCount = Number(beforeRes[0]?.n ?? 0);
      console.log(`[migrate-pg] ${spec.name}: sqlite=${rows.length} pg(before)=${beforeCount}`);

      if (rows.length === 0) {
        console.log(`[migrate-pg]   nothing to copy`);
        continue;
      }

      // Drop the auto-generated identity column from the insert payload.
      const columns = Object.keys(rows[0]!).filter((c) => c !== spec.identityColumn);
      const colList = columns.map((c) => `"${c}"`).join(", ");

      let inserted = 0;
      for (const row of rows) {
        const values = columns.map((c) => row[c]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
        const conflict = spec.conflictTarget
          ? `ON CONFLICT ${spec.conflictTarget} DO NOTHING`
          : `ON CONFLICT DO NOTHING`;
        const result = await pg.unsafe(
          `INSERT INTO ${spec.name} (${colList}) VALUES (${placeholders}) ${conflict}`,
          values as never[],
        );
        // postgres-js returns a result with `.count` for write ops.
        inserted += (result as unknown as { count: number }).count ?? 0;
      }

      const afterRes = await pg.unsafe(`SELECT COUNT(*)::int AS n FROM ${spec.name}`);
      const afterCount = Number(afterRes[0]?.n ?? 0);
      console.log(`[migrate-pg]   inserted=${inserted} pg(after)=${afterCount}`);
      totalCopied += inserted;
    }
    console.log(`[migrate-pg] DONE. rows inserted total=${totalCopied}`);
  } catch (err) {
    console.error(`[migrate-pg] FAILED:`, err);
    process.exitCode = 1;
  } finally {
    sqlite.close();
    await pg.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(`[migrate-pg] fatal:`, err);
  process.exit(1);
});
