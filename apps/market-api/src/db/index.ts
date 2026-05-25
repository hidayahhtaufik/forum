// Eagerly import only the Postgres path. better-sqlite3 + drizzle-orm/better-sqlite3
// are LAZY-imported inside the sqlite branch of `openDatabase()` so a broken
// native binary (e.g. Node version mismatch) does not crash the process on
// boot when we're using Postgres in production.
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schemaPg from "./schema-pg.js";
import { PG_INITIAL_SCHEMA_SQL, PG_MIGRATIONS } from "./schema-pg.js";

/// Switchable DB driver. `DATABASE_URL` env decides at boot:
///   - postgres:// or postgresql:// → postgres-js + drizzle/postgres-js
///   - file:... or sqlite:... or anything else → better-sqlite3 (legacy/fallback)
///
/// The exported `DB` type is the postgres-js Drizzle shape (its API is a
/// strict superset for our usage — it has `.execute()` for raw SQL which
/// sqlite-core does not). The sqlite branch is wrapped with a thin
/// `.execute()` polyfill so callsites are uniform. Row inference is
/// byte-identical between the two schemas (every sqlite `integer()` column
/// maps to a pg `bigint({mode:'number'})`, and `text` ↔ `text`).
///
/// All callsites use Drizzle's portable async/PromiseLike methods
/// (`.select().from().where()` is `await`able on both drivers). Sync
/// terminal methods (`.run()/.get()/.all()`) are forbidden — they exist
/// only on better-sqlite3 and would break the pg path.

export type DB = PostgresJsDatabase<typeof schemaPg>;

/// SQLite ALTER migrations — verbatim from the pre-migration codebase.
/// Postgres uses `PG_MIGRATIONS` from schema-pg.ts which adds `IF NOT EXISTS`
/// guards (pg supports `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` natively;
/// sqlite does not, so this list keeps the try/catch pattern).
const SQLITE_MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: "markets.created_by",  sql: `ALTER TABLE markets ADD COLUMN created_by TEXT NOT NULL DEFAULT 'manual'` },
  { name: "resolutions.ecb_date",  sql: `ALTER TABLE resolutions ADD COLUMN ecb_date TEXT` },
  { name: "resolutions.ecb_rate",  sql: `ALTER TABLE resolutions ADD COLUMN ecb_rate TEXT` },
  { name: "markets.collateral",    sql: `ALTER TABLE markets ADD COLUMN collateral TEXT NOT NULL DEFAULT 'USDC'` },
  {
    name: "copy_trades.create",
    sql: `CREATE TABLE IF NOT EXISTS copy_trades (
      subscriber TEXT NOT NULL,
      target TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      size_multiplier REAL NOT NULL DEFAULT 0.25,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (subscriber, target)
    )`,
  },
  {
    name: "agent_listings.create",
    sql: `CREATE TABLE IF NOT EXISTS agent_listings (
      agent_address TEXT NOT NULL,
      seller TEXT NOT NULL,
      buy_price_usdc TEXT NOT NULL,
      sold_to TEXT,
      sold_at INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (agent_address)
    )`,
  },
  {
    name: "agent_rentals.create",
    sql: `CREATE TABLE IF NOT EXISTS agent_rentals (
      renter TEXT NOT NULL,
      agent_address TEXT NOT NULL,
      duration_hours INTEGER NOT NULL,
      price_usdc TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (renter, agent_address, starts_at)
    )`,
  },
  {
    name: "forecast_traces.create",
    sql: `CREATE TABLE IF NOT EXISTS forecast_traces (
      sha256 TEXT PRIMARY KEY,
      agent_address TEXT NOT NULL,
      market_id TEXT NOT NULL,
      outcome INTEGER NOT NULL,
      probability TEXT,
      confidence TEXT,
      rationale TEXT NOT NULL,
      rationale_json TEXT,
      model TEXT,
      irys_id TEXT,
      irys_url TEXT,
      created_at INTEGER NOT NULL
    )`,
  },
  { name: "forecast_traces.agent_idx",   sql: `CREATE INDEX IF NOT EXISTS forecast_traces_agent_idx ON forecast_traces (agent_address)` },
  { name: "forecast_traces.market_idx",  sql: `CREATE INDEX IF NOT EXISTS forecast_traces_market_idx ON forecast_traces (market_id)` },
  { name: "bets.forecast_sha256",        sql: `ALTER TABLE bets ADD COLUMN forecast_sha256 TEXT` },
  { name: "forecast_traces.cipher_alg",    sql: `ALTER TABLE forecast_traces ADD COLUMN cipher_alg TEXT` },
  { name: "forecast_traces.cipher_iv",     sql: `ALTER TABLE forecast_traces ADD COLUMN cipher_iv TEXT` },
  { name: "forecast_traces.cipher_auth_tag", sql: `ALTER TABLE forecast_traces ADD COLUMN cipher_auth_tag TEXT` },
  { name: "agents.verified",         sql: `ALTER TABLE agents ADD COLUMN verified INTEGER NOT NULL DEFAULT 0` },
  { name: "agents.owner_identity",   sql: `ALTER TABLE agents ADD COLUMN owner_identity TEXT` },
  { name: "agents.persona_label",    sql: `ALTER TABLE agents ADD COLUMN persona_label TEXT` },
  { name: "agents.strategy_id",      sql: `ALTER TABLE agents ADD COLUMN strategy_id TEXT` },
  { name: "agent_rentals.tx_hash",   sql: `ALTER TABLE agent_rentals ADD COLUMN tx_hash TEXT` },
  {
    name: "trace_markets.create",
    sql: `CREATE TABLE IF NOT EXISTS trace_markets (
      id TEXT PRIMARY KEY,
      target_agent TEXT NOT NULL,
      threshold_bps INTEGER NOT NULL,
      window_hours INTEGER NOT NULL,
      opens_at INTEGER NOT NULL,
      closes_at INTEGER NOT NULL,
      phase INTEGER NOT NULL DEFAULT 0,
      winning_outcome INTEGER,
      yes_pool_usdc TEXT NOT NULL DEFAULT '0',
      no_pool_usdc TEXT NOT NULL DEFAULT '0',
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      resolved_win_rate_bps INTEGER
    )`,
  },
  { name: "trace_markets.agent_idx",  sql: `CREATE INDEX IF NOT EXISTS trace_markets_agent_idx ON trace_markets (target_agent)` },
  { name: "trace_markets.phase_idx",  sql: `CREATE INDEX IF NOT EXISTS trace_markets_phase_idx ON trace_markets (phase)` },
  {
    name: "trace_bets.create",
    sql: `CREATE TABLE IF NOT EXISTS trace_bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_market_id TEXT NOT NULL,
      bettor TEXT NOT NULL,
      outcome INTEGER NOT NULL,
      cost_usdc TEXT NOT NULL,
      tx_hash TEXT,
      created_at INTEGER NOT NULL
    )`,
  },
  { name: "trace_bets.market_idx",   sql: `CREATE INDEX IF NOT EXISTS trace_bets_market_idx ON trace_bets (trace_market_id)` },
  { name: "trace_bets.bettor_idx",   sql: `CREATE INDEX IF NOT EXISTS trace_bets_bettor_idx ON trace_bets (bettor)` },
  { name: "agents.avatar_emoji",     sql: `ALTER TABLE agents ADD COLUMN avatar_emoji TEXT` },
  { name: "agents.ai_provider",            sql: `ALTER TABLE agents ADD COLUMN ai_provider TEXT` },
  { name: "agents.ai_api_key_encrypted",   sql: `ALTER TABLE agents ADD COLUMN ai_api_key_encrypted TEXT` },
  { name: "agents.ai_key_iv",              sql: `ALTER TABLE agents ADD COLUMN ai_key_iv TEXT` },
  { name: "agents.ai_key_auth_tag",        sql: `ALTER TABLE agents ADD COLUMN ai_key_auth_tag TEXT` },
  { name: "agents.ai_base_url",            sql: `ALTER TABLE agents ADD COLUMN ai_base_url TEXT` },
  { name: "agents.ai_model",               sql: `ALTER TABLE agents ADD COLUMN ai_model TEXT` },
  { name: "agent_listings.rent_6h_usdc",   sql: `ALTER TABLE agent_listings ADD COLUMN rent_6h_usdc TEXT` },
  { name: "agent_listings.rent_24h_usdc",  sql: `ALTER TABLE agent_listings ADD COLUMN rent_24h_usdc TEXT` },
  { name: "agent_listings.rent_week_usdc", sql: `ALTER TABLE agent_listings ADD COLUMN rent_week_usdc TEXT` },
  { name: "agent_listings.rent_month_usdc",sql: `ALTER TABLE agent_listings ADD COLUMN rent_month_usdc TEXT` },
  { name: "trader_wallets.owner_wallet",   sql: `ALTER TABLE trader_wallets ADD COLUMN owner_wallet TEXT` },
];

// Structural type to avoid eager import of better-sqlite3 types at module scope.
type SqliteInstance = { exec: (sql: string) => unknown };

function runSqliteMigrations(sqlite: SqliteInstance): void {
  for (const m of SQLITE_MIGRATIONS) {
    try {
      sqlite.exec(m.sql);
      console.log(`[forum/market-api] migration applied: ${m.name}`);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("duplicate column name") || msg.includes("already exists")) {
        console.log(`[forum/market-api] migration skipped (already applied): ${m.name}`);
        continue;
      }
      throw new Error(`migration "${m.name}" failed: ${msg}`);
    }
  }
}

async function runPgMigrations(client: postgres.Sql): Promise<void> {
  for (const m of PG_MIGRATIONS) {
    try {
      await client.unsafe(m.sql);
      console.log(`[forum/market-api] migration applied: ${m.name}`);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      // Postgres' `IF NOT EXISTS` should make these idempotent; this catch
      // is defensive belt+suspenders for older pg versions / race conditions.
      if (msg.includes("already exists") || msg.includes("duplicate")) {
        console.log(`[forum/market-api] migration skipped (already applied): ${m.name}`);
        continue;
      }
      throw new Error(`migration "${m.name}" failed: ${msg}`);
    }
  }
}

function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

export async function openDatabase(url: string): Promise<{ db: DB; close: () => Promise<void> | void }> {
  if (isPostgresUrl(url)) {
    // Postgres branch. `postgres()` opens a connection pool — max=10 is fine
    // for our request volume (single market-api process; concurrent agent bets
    // are already serialized via `withChainLock`).
    const client = postgres(url, {
      max: 10,
      idle_timeout: 20,
      // Override BIGINT (OID 20) parser: return JS number instead of BigInt.
      // Why: every callsite that uses `db.execute(sql\`raw SQL\`)` bypasses
      // Drizzle's column-level `bigint({mode:"number"})` coercion, so postgres-js
      // returns native BigInt instances. JSON.stringify can't serialize BigInt
      // → all such endpoints return `{"error":"Do not know how to serialize a BigInt"}`.
      // Our BIGINT values (unix-second timestamps, block numbers, bet ids) are
      // all well under 2^53 — safe to coerce to Number.
      types: {
        bigint: {
          to: 20,
          from: [20],
          serialize: (x: number | bigint) =>
            typeof x === "bigint" ? x.toString() : String(x),
          parse: (x: string) => Number(x),
        },
      },
    });
    // Bootstrap schema + run idempotent migrations.
    await client.unsafe(PG_INITIAL_SCHEMA_SQL);
    await runPgMigrations(client);

    const pgDb: PostgresJsDatabase<typeof schemaPg> = drizzlePg(client, { schema: schemaPg });
    // Cast through unknown — the two Drizzle row types are inference-identical
    // for our column set (every sqlite integer→number column maps to pg
    // bigint({mode:'number'})→number). See block comment at top of file.
    const db = pgDb as unknown as DB;
    return {
      db,
      close: async () => { await client.end({ timeout: 5 }); },
    };
  }

  // SQLite branch — lazy-load better-sqlite3 + its drizzle adapter so a
  // broken native binary (Node ABI version mismatch) only fails if we
  // actually use sqlite. In Postgres production this code path is dead.
  const [{ default: Database }, { drizzle: drizzleSqlite }, schema, { INITIAL_SCHEMA_SQL }] = await Promise.all([
    import("better-sqlite3"),
    import("drizzle-orm/better-sqlite3"),
    import("./schema.js"),
    import("./schema.js"),
  ]);
  // Strip `sqlite:` or `file:` prefix for path resolution.
  const stripped = url.replace(/^sqlite:|^file:/, "");
  const path = resolve(process.cwd(), stripped);
  mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");

  sqlite.exec(INITIAL_SCHEMA_SQL);
  runSqliteMigrations(sqlite);

  const sqliteDb = drizzleSqlite(sqlite, { schema });
  // Polyfill `.execute(sql\`...\`)` on the sqlite Drizzle instance so callsites
  // written against the pg API still work. sqlite-core has `.all()` and
  // `.run()` for raw SQL but no `.execute()`. We pick `.all()` which returns
  // an array of rows — same shape callers expect from postgres-js `.execute()`.
  // Cast to `any` only here so we can attach the method dynamically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (sqliteDb as any).execute = function (query: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Promise.resolve((sqliteDb as any).all(query));
  };
  const db = sqliteDb as unknown as DB;
  return { db, close: () => { sqlite.close(); } };
}

export { schemaPg as schema };
