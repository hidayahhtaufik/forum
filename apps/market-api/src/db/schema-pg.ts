import { bigint, integer, pgTable, text, uniqueIndex, index, doublePrecision } from "drizzle-orm/pg-core";

/// Postgres schema for FORUM market-api. Mirror of `schema.ts` (sqlite-core)
/// with these dialect translations:
/// - sqlite INTEGER (used for unix-seconds timestamps + counters + booleans-as-0/1)
///   → pg BIGINT for timestamps/counters (safe for very large values, matches sqlite
///   INTEGER 8-byte width). Standard `integer()` (int4) for small enums like phase/outcome.
/// - sqlite TEXT → pg TEXT (identical).
/// - autoIncrement IDs → bigint with `generatedAlwaysAsIdentity()` (pg 11+).
/// - REAL (size_multiplier) → doublePrecision.
///
/// Same camelCase ↔ snake_case column mapping as sqlite schema so app.ts code
/// using `markets.qYesWad` etc. is portable across dialects.

export const markets = pgTable(
  "markets",
  {
    id: text("id").primaryKey(),
    address: text("address").notNull(),
    question: text("question").notNull(),
    pair: text("pair").notNull(),
    strikeWad: text("strike_wad").notNull(),
    comparator: text("comparator").notNull(),
    bWad: text("b_wad").notNull(),
    qYesWad: text("q_yes_wad").notNull().default("0"),
    qNoWad: text("q_no_wad").notNull().default("0"),
    collateralEscrowed: text("collateral_escrowed").notNull().default("0"),
    feeAccrued: text("fee_accrued").notNull().default("0"),
    opensAt: bigint("opens_at", { mode: "number" }).notNull(),
    closesAt: bigint("closes_at", { mode: "number" }).notNull(),
    resolvesAt: bigint("resolves_at", { mode: "number" }),
    phase: integer("phase").notNull().default(0),
    winningOutcome: integer("winning_outcome"),
    createdAtBlock: bigint("created_at_block", { mode: "number" }).notNull(),
    createdAtTxHash: text("created_at_tx_hash").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    createdBy: text("created_by").notNull().default("manual"),
    collateral: text("collateral").notNull().default("USDC"),
  },
  (t) => ({
    pairIdx: index("markets_pair_idx").on(t.pair),
    phaseIdx: index("markets_phase_idx").on(t.phase),
    closesAtIdx: index("markets_closes_at_idx").on(t.closesAt),
  }),
);

export const bets = pgTable(
  "bets",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    agentAddress: text("agent_address").notNull(),
    outcome: integer("outcome").notNull(),
    sharesWad: text("shares_wad").notNull(),
    costUsdc: text("cost_usdc").notNull(),
    feeUsdc: text("fee_usdc").notNull(),
    intentHash: text("intent_hash").notNull(),
    forecastSha256: text("forecast_sha256"),
    settlementTxHash: text("settlement_tx_hash"),
    marketTxHash: text("market_tx_hash").notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    marketIdx: index("bets_market_idx").on(t.marketId),
    agentIdx: index("bets_agent_idx").on(t.agentAddress),
    intentUniq: uniqueIndex("bets_intent_uniq").on(t.intentHash),
  }),
);

export const agents = pgTable(
  "agents",
  {
    address: text("address").primaryKey(),
    operator: text("operator").notNull(),
    profileHash: text("profile_hash").notNull(),
    name: text("name"),
    kind: text("kind").default("custom"),
    score: integer("score").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    totalVolumeUsdc: text("total_volume_usdc").notNull().default("0"),
    registeredAt: bigint("registered_at", { mode: "number" }).notNull(),
    registeredAtTxHash: text("registered_at_tx_hash"),
    verified: integer("verified").notNull().default(0),
    ownerIdentity: text("owner_identity"),
    personaLabel: text("persona_label"),
    strategyId: text("strategy_id"),
    avatarEmoji: text("avatar_emoji"),
    aiProvider: text("ai_provider"),
    aiApiKeyEncrypted: text("ai_api_key_encrypted"),
    aiKeyIv: text("ai_key_iv"),
    aiKeyAuthTag: text("ai_key_auth_tag"),
    aiBaseUrl: text("ai_base_url"),
    aiModel: text("ai_model"),
  },
  (t) => ({
    operatorIdx: index("agents_operator_idx").on(t.operator),
    scoreIdx: index("agents_score_idx").on(t.score),
  }),
);

export const traderWallets = pgTable(
  "trader_wallets",
  {
    identity: text("identity").primaryKey(),
    address: text("address").notNull(),
    encryptedPrivkey: text("encrypted_privkey").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    faucetReceived: integer("faucet_received").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    lastUsedAt: bigint("last_used_at", { mode: "number" }),
    // P0-B audit: owner_wallet is the EOA that authenticated when /traders/issue
    // first minted this row. Privileged endpoints require an EIP-712 signature
    // from this wallet (or from the trader address itself for server-side
    // runners). NULL on legacy rows minted before the auth gate landed —
    // those rows still work with the "signer === trader address" branch.
    ownerWallet: text("owner_wallet"),
  },
  (t) => ({
    addressUniq: uniqueIndex("trader_wallets_address_uniq").on(t.address),
  }),
);

export const forecastTraces = pgTable(
  "forecast_traces",
  {
    sha256: text("sha256").primaryKey(),
    agentAddress: text("agent_address").notNull(),
    marketId: text("market_id").notNull(),
    outcome: integer("outcome").notNull(),
    probability: text("probability"),
    confidence: text("confidence"),
    rationale: text("rationale").notNull(),
    rationaleJson: text("rationale_json"),
    model: text("model"),
    cipherAlg: text("cipher_alg"),
    cipherIv: text("cipher_iv"),
    cipherAuthTag: text("cipher_auth_tag"),
    irysId: text("irys_id"),
    irysUrl: text("irys_url"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    agentIdx:  index("forecast_traces_agent_idx").on(t.agentAddress),
    marketIdx: index("forecast_traces_market_idx").on(t.marketId),
  }),
);

export const resolutions = pgTable("resolutions", {
  marketId: text("market_id")
    .primaryKey()
    .references(() => markets.id),
  outcome: integer("outcome").notNull(),
  dataHash: text("data_hash").notNull(),
  source: text("source").notNull(),
  signer: text("signer").notNull(),
  txHash: text("tx_hash").notNull(),
  resolvedAt: bigint("resolved_at", { mode: "number" }).notNull(),
  ecbDate: text("ecb_date"),
  ecbRate: text("ecb_rate"),
});

export const traceMarkets = pgTable(
  "trace_markets",
  {
    id: text("id").primaryKey(),
    targetAgent: text("target_agent").notNull(),
    thresholdBps: integer("threshold_bps").notNull(),
    windowHours: integer("window_hours").notNull(),
    opensAt: bigint("opens_at", { mode: "number" }).notNull(),
    closesAt: bigint("closes_at", { mode: "number" }).notNull(),
    phase: integer("phase").notNull().default(0),
    winningOutcome: integer("winning_outcome"),
    yesPoolUsdc: text("yes_pool_usdc").notNull().default("0"),
    noPoolUsdc: text("no_pool_usdc").notNull().default("0"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    resolvedAt: bigint("resolved_at", { mode: "number" }),
    resolvedWinRateBps: integer("resolved_win_rate_bps"),
  },
  (t) => ({
    targetIdx: index("trace_markets_agent_idx").on(t.targetAgent),
    phaseIdx:  index("trace_markets_phase_idx").on(t.phase),
  }),
);

export const traceBets = pgTable(
  "trace_bets",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    traceMarketId: text("trace_market_id").notNull(),
    bettor: text("bettor").notNull(),
    outcome: integer("outcome").notNull(),
    costUsdc: text("cost_usdc").notNull(),
    txHash: text("tx_hash"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    marketIdx: index("trace_bets_market_idx").on(t.traceMarketId),
    bettorIdx: index("trace_bets_bettor_idx").on(t.bettor),
  }),
);

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
export type Bet = typeof bets.$inferSelect;
export type NewBet = typeof bets.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Resolution = typeof resolutions.$inferSelect;
export type NewResolution = typeof resolutions.$inferInsert;
export type TraderWallet = typeof traderWallets.$inferSelect;
export type NewTraderWallet = typeof traderWallets.$inferInsert;
export type ForecastTrace = typeof forecastTraces.$inferSelect;
export type NewForecastTrace = typeof forecastTraces.$inferInsert;
export type TraceMarket = typeof traceMarkets.$inferSelect;
export type NewTraceMarket = typeof traceMarkets.$inferInsert;
export type TraceBet = typeof traceBets.$inferSelect;
export type NewTraceBet = typeof traceBets.$inferInsert;

/// Marketplace tables that live ONLY in the runtime migration array on sqlite —
/// but pg also needs concrete schema for runtime/seeding. Define them so
/// drizzle infers types parity with sqlite paths.
export const copyTrades = pgTable("copy_trades", {
  subscriber: text("subscriber").notNull(),
  target: text("target").notNull(),
  active: integer("active").notNull().default(1),
  sizeMultiplier: doublePrecision("size_multiplier").notNull().default(0.25),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const agentListings = pgTable("agent_listings", {
  agentAddress: text("agent_address").primaryKey(),
  seller: text("seller").notNull(),
  buyPriceUsdc: text("buy_price_usdc").notNull(),
  soldTo: text("sold_to"),
  soldAt: bigint("sold_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  rent6hUsdc: text("rent_6h_usdc"),
  rent24hUsdc: text("rent_24h_usdc"),
  rentWeekUsdc: text("rent_week_usdc"),
  rentMonthUsdc: text("rent_month_usdc"),
});

export const agentRentals = pgTable("agent_rentals", {
  renter: text("renter").notNull(),
  agentAddress: text("agent_address").notNull(),
  durationHours: integer("duration_hours").notNull(),
  priceUsdc: text("price_usdc").notNull(),
  startsAt: bigint("starts_at", { mode: "number" }).notNull(),
  endsAt: bigint("ends_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  txHash: text("tx_hash"),
});


/// Sender broadcasts via AXL and the server mirrors a row here so the
/// landing-page Live Mesh Feed has a queryable + SSE-fanoutable record.


/// Idempotent Postgres-flavored CREATE TABLE statements run on first boot.
/// Differences from the sqlite version (`INITIAL_SCHEMA_SQL` in schema.ts):
/// - `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
/// - sqlite `INTEGER` for unix timestamps + block numbers → `BIGINT` (Postgres `INTEGER` is int4)
/// - All other types are byte-identical (`TEXT`).
export const PG_INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  question TEXT NOT NULL,
  pair TEXT NOT NULL,
  strike_wad TEXT NOT NULL,
  comparator TEXT NOT NULL,
  b_wad TEXT NOT NULL,
  q_yes_wad TEXT NOT NULL DEFAULT '0',
  q_no_wad TEXT NOT NULL DEFAULT '0',
  collateral_escrowed TEXT NOT NULL DEFAULT '0',
  fee_accrued TEXT NOT NULL DEFAULT '0',
  opens_at BIGINT NOT NULL,
  closes_at BIGINT NOT NULL,
  resolves_at BIGINT,
  phase INTEGER NOT NULL DEFAULT 0,
  winning_outcome INTEGER,
  created_at_block BIGINT NOT NULL,
  created_at_tx_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'manual',
  collateral TEXT NOT NULL DEFAULT 'USDC'
);
CREATE INDEX IF NOT EXISTS markets_pair_idx ON markets (pair);
CREATE INDEX IF NOT EXISTS markets_phase_idx ON markets (phase);
CREATE INDEX IF NOT EXISTS markets_closes_at_idx ON markets (closes_at);

CREATE TABLE IF NOT EXISTS bets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id),
  agent_address TEXT NOT NULL,
  outcome INTEGER NOT NULL,
  shares_wad TEXT NOT NULL,
  cost_usdc TEXT NOT NULL,
  fee_usdc TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  settlement_tx_hash TEXT,
  market_tx_hash TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS bets_market_idx ON bets (market_id);
CREATE INDEX IF NOT EXISTS bets_agent_idx ON bets (agent_address);
CREATE UNIQUE INDEX IF NOT EXISTS bets_intent_uniq ON bets (intent_hash);

CREATE TABLE IF NOT EXISTS agents (
  address TEXT PRIMARY KEY,
  operator TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  name TEXT,
  kind TEXT DEFAULT 'custom',
  score INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  total_volume_usdc TEXT NOT NULL DEFAULT '0',
  registered_at BIGINT NOT NULL,
  registered_at_tx_hash TEXT
);
CREATE INDEX IF NOT EXISTS agents_operator_idx ON agents (operator);
CREATE INDEX IF NOT EXISTS agents_score_idx ON agents (score);

CREATE TABLE IF NOT EXISTS trader_wallets (
  identity TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  encrypted_privkey TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  faucet_received INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS trader_wallets_address_uniq ON trader_wallets (address);

CREATE TABLE IF NOT EXISTS resolutions (
  market_id TEXT PRIMARY KEY REFERENCES markets(id),
  outcome INTEGER NOT NULL,
  data_hash TEXT NOT NULL,
  source TEXT NOT NULL,
  signer TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  resolved_at BIGINT NOT NULL,
  ecb_date TEXT,
  ecb_rate TEXT
);
`;

/// Per-column ALTER migrations for postgres. Identical SQL to sqlite paths
/// in 99% of cases (`ALTER TABLE ... ADD COLUMN`, `CREATE INDEX`, `CREATE
/// TABLE IF NOT EXISTS`). Two divergences vs sqlite:
/// - `trace_bets.id` uses `BIGINT GENERATED ALWAYS AS IDENTITY` (pg syntax)
///   instead of sqlite's `INTEGER PRIMARY KEY AUTOINCREMENT`.
/// - `INTEGER` columns used for unix-second timestamps and block numbers
///   become `BIGINT`. We default new ALTER ADD COLUMN ones the same way.
export const PG_MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: "markets.created_by",     sql: `ALTER TABLE markets ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'manual'` },
  { name: "resolutions.ecb_date",   sql: `ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS ecb_date TEXT` },
  { name: "resolutions.ecb_rate",   sql: `ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS ecb_rate TEXT` },
  { name: "markets.collateral",     sql: `ALTER TABLE markets ADD COLUMN IF NOT EXISTS collateral TEXT NOT NULL DEFAULT 'USDC'` },
  {
    name: "copy_trades.create",
    sql: `CREATE TABLE IF NOT EXISTS copy_trades (
      subscriber TEXT NOT NULL,
      target TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      size_multiplier DOUBLE PRECISION NOT NULL DEFAULT 0.25,
      created_at BIGINT NOT NULL,
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
      sold_at BIGINT,
      created_at BIGINT NOT NULL,
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
      starts_at BIGINT NOT NULL,
      ends_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
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
      created_at BIGINT NOT NULL
    )`,
  },
  { name: "forecast_traces.agent_idx",   sql: `CREATE INDEX IF NOT EXISTS forecast_traces_agent_idx ON forecast_traces (agent_address)` },
  { name: "forecast_traces.market_idx",  sql: `CREATE INDEX IF NOT EXISTS forecast_traces_market_idx ON forecast_traces (market_id)` },
  { name: "bets.forecast_sha256",        sql: `ALTER TABLE bets ADD COLUMN IF NOT EXISTS forecast_sha256 TEXT` },
  { name: "forecast_traces.cipher_alg",    sql: `ALTER TABLE forecast_traces ADD COLUMN IF NOT EXISTS cipher_alg TEXT` },
  { name: "forecast_traces.cipher_iv",     sql: `ALTER TABLE forecast_traces ADD COLUMN IF NOT EXISTS cipher_iv TEXT` },
  { name: "forecast_traces.cipher_auth_tag", sql: `ALTER TABLE forecast_traces ADD COLUMN IF NOT EXISTS cipher_auth_tag TEXT` },
  { name: "agents.verified",        sql: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS verified INTEGER NOT NULL DEFAULT 0` },
  { name: "agents.owner_identity",  sql: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_identity TEXT` },
  { name: "agents.persona_label",   sql: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS persona_label TEXT` },
  { name: "agents.strategy_id",     sql: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS strategy_id TEXT` },
  { name: "agent_rentals.tx_hash",  sql: `ALTER TABLE agent_rentals ADD COLUMN IF NOT EXISTS tx_hash TEXT` },
  {
    name: "trace_markets.create",
    sql: `CREATE TABLE IF NOT EXISTS trace_markets (
      id TEXT PRIMARY KEY,
      target_agent TEXT NOT NULL,
      threshold_bps INTEGER NOT NULL,
      window_hours INTEGER NOT NULL,
      opens_at BIGINT NOT NULL,
      closes_at BIGINT NOT NULL,
      phase INTEGER NOT NULL DEFAULT 0,
      winning_outcome INTEGER,
      yes_pool_usdc TEXT NOT NULL DEFAULT '0',
      no_pool_usdc TEXT NOT NULL DEFAULT '0',
      created_at BIGINT NOT NULL,
      resolved_at BIGINT,
      resolved_win_rate_bps INTEGER
    )`,
  },
  { name: "trace_markets.agent_idx",  sql: `CREATE INDEX IF NOT EXISTS trace_markets_agent_idx ON trace_markets (target_agent)` },
  { name: "trace_markets.phase_idx",  sql: `CREATE INDEX IF NOT EXISTS trace_markets_phase_idx ON trace_markets (phase)` },
  {
    name: "trace_bets.create",
    sql: `CREATE TABLE IF NOT EXISTS trace_bets (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      trace_market_id TEXT NOT NULL,
      bettor TEXT NOT NULL,
      outcome INTEGER NOT NULL,
      cost_usdc TEXT NOT NULL,
      tx_hash TEXT,
      created_at BIGINT NOT NULL
    )`,
  },
  { name: "trace_bets.market_idx",   sql: `CREATE INDEX IF NOT EXISTS trace_bets_market_idx ON trace_bets (trace_market_id)` },
  { name: "trace_bets.bettor_idx",   sql: `CREATE INDEX IF NOT EXISTS trace_bets_bettor_idx ON trace_bets (bettor)` },
  { name: "agents.avatar_emoji",     sql: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_emoji TEXT` },
  { name: "agents.ai_provider",            sql: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS ai_provider TEXT` },
  { name: "agents.ai_api_key_encrypted",   sql: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS ai_api_key_encrypted TEXT` },
  { name: "agents.ai_key_iv",              sql: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS ai_key_iv TEXT` },
  { name: "agents.ai_key_auth_tag",        sql: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS ai_key_auth_tag TEXT` },
  { name: "agents.ai_base_url",            sql: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS ai_base_url TEXT` },
  { name: "agents.ai_model",               sql: `ALTER TABLE agents ADD COLUMN IF NOT EXISTS ai_model TEXT` },
  { name: "agent_listings.rent_6h_usdc",   sql: `ALTER TABLE agent_listings ADD COLUMN IF NOT EXISTS rent_6h_usdc TEXT` },
  { name: "agent_listings.rent_24h_usdc",  sql: `ALTER TABLE agent_listings ADD COLUMN IF NOT EXISTS rent_24h_usdc TEXT` },
  { name: "agent_listings.rent_week_usdc", sql: `ALTER TABLE agent_listings ADD COLUMN IF NOT EXISTS rent_week_usdc TEXT` },
  { name: "agent_listings.rent_month_usdc",sql: `ALTER TABLE agent_listings ADD COLUMN IF NOT EXISTS rent_month_usdc TEXT` },
  { name: "trader_wallets.owner_wallet",   sql: `ALTER TABLE trader_wallets ADD COLUMN IF NOT EXISTS owner_wallet TEXT` },
];
