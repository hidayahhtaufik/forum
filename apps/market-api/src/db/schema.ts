import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/// SQLite schema for FORUM market-api. Conventions:
/// - Big integers stored as TEXT (e.g. WAD-encoded shares, USDC base units). SQLite's INTEGER is 64-bit;
///   anything potentially exceeding 2^63-1 (wad amounts) must be TEXT.
/// - Timestamps stored as INTEGER (unix seconds).
/// - Addresses stored as lowercase 0x-prefixed hex TEXT (sanitize on insert).

export const markets = sqliteTable(
  "markets",
  {
    /** keccak256(question || closes_at) — also the on-chain marketId */
    id: text("id").primaryKey(),
    /** Cloned ForexMarket address */
    address: text("address").notNull(),
    question: text("question").notNull(),
    /** "EURUSD", "EURGBP", etc. */
    pair: text("pair").notNull(),
    /** Strike price in WAD (1e18). Stored as decimal string. */
    strikeWad: text("strike_wad").notNull(),
    /** "GT" | "GTE" | "LT" | "LTE" */
    comparator: text("comparator").notNull(),
    /** LMSR b parameter, WAD (1e18). Decimal string. */
    bWad: text("b_wad").notNull(),
    /** Outstanding YES shares (WAD). Updated by indexer. */
    qYesWad: text("q_yes_wad").notNull().default("0"),
    /** Outstanding NO shares (WAD). Updated by indexer. */
    qNoWad: text("q_no_wad").notNull().default("0"),
    /** Net trading flow in 6-dec USDC. Updated by indexer. */
    collateralEscrowed: text("collateral_escrowed").notNull().default("0"),
    /** Fee pool in 6-dec USDC. Updated by indexer. */
    feeAccrued: text("fee_accrued").notNull().default("0"),

    opensAt: integer("opens_at").notNull(),
    closesAt: integer("closes_at").notNull(),
    resolvesAt: integer("resolves_at"), // null until resolved

    /** 0=OPEN, 1=CLOSED, 2=RESOLVED */
    phase: integer("phase").notNull().default(0),
    /** null until resolved; 0=NO, 1=YES, 2=INVALID */
    winningOutcome: integer("winning_outcome"),

    createdAtBlock: integer("created_at_block").notNull(),
    createdAtTxHash: text("created_at_tx_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    /** Source identifier that proposed this market.
     *  "manual" (default), "scout:bbc", "scout:ecb", "scout:tg:forexlive", etc. */
    createdBy: text("created_by").notNull().default("manual"),
    /** Collateral asset: "USDC" (default) or "EURC". Maps to ARC_USDC / ARC_EURC
     *  env addresses at runtime. Forex markets settle in the same asset they
     *  collateralised in — gives Agora RFB 03's "USDC ↔ EURC pairing" first-class
     *  support without forcing a swap layer. */
    collateral: text("collateral").notNull().default("USDC"),
  },
  (t) => ({
    pairIdx: index("markets_pair_idx").on(t.pair),
    phaseIdx: index("markets_phase_idx").on(t.phase),
    closesAtIdx: index("markets_closes_at_idx").on(t.closesAt),
  }),
);

export const bets = sqliteTable(
  "bets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    agentAddress: text("agent_address").notNull(),
    /** 0=NO, 1=YES */
    outcome: integer("outcome").notNull(),
    /** Shares in WAD */
    sharesWad: text("shares_wad").notNull(),
    /** Cost paid in 6-dec USDC (excludes fee) */
    costUsdc: text("cost_usdc").notNull(),
    /** Fee paid in 6-dec USDC */
    feeUsdc: text("fee_usdc").notNull(),
    /** EIP-712 intent hash from the agent — uniqueness anchor */
    intentHash: text("intent_hash").notNull(),
    /** M1 Trace Pinning — sha256 of the LLM rationale that produced this bet.
     *  Optional: human bets + heuristic-fallback bets won't have one. The
     *  rationale text + structured forecast JSON are stored in the
     *  forecast_traces table keyed on this hash. */
    forecastSha256: text("forecast_sha256"),
    /** Circle Gateway batch settlement tx (if known) */
    settlementTxHash: text("settlement_tx_hash"),
    /** ForexMarket.buyShares tx */
    marketTxHash: text("market_tx_hash").notNull(),
    blockNumber: integer("block_number").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    marketIdx: index("bets_market_idx").on(t.marketId),
    agentIdx: index("bets_agent_idx").on(t.agentAddress),
    intentUniq: uniqueIndex("bets_intent_uniq").on(t.intentHash),
  }),
);

export const agents = sqliteTable(
  "agents",
  {
    address: text("address").primaryKey(),
    operator: text("operator").notNull(),
    profileHash: text("profile_hash").notNull(),
    name: text("name"),
    /** "oracle" | "mirror" | "arb" | "custom" */
    kind: text("kind").default("custom"),
    score: integer("score").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    totalVolumeUsdc: text("total_volume_usdc").notNull().default("0"),
    registeredAt: integer("registered_at").notNull(),
    registeredAtTxHash: text("registered_at_tx_hash"),
    /** D-7 — 1 USDC anti-sybil badge bought via /agents/:addr/verify. */
    verified: integer("verified").notNull().default(0),
    /** D-7 — sha256-of-email or lowercase EVM addr of the user who spawned
     *  this agent (matches trader_wallets.identity). Default agents (Oracle
     *  / Sage / Hermes / Augur / Mirror) leave this null; user-spawned
     *  agents from /agents/spawn always set it. */
    ownerIdentity: text("owner_identity"),
    /** Human-readable label the operator picked at spawn time. */
    personaLabel: text("persona_label"),
    /** Strategy identifier — "standard" | "contrarian" | "edge_weighted" |
     *  "copy_oracle" | etc. Used by the agent-loop to dispatch behavior. */
    strategyId: text("strategy_id"),
    /** M6 — owner-picked emoji shown on agent cards. Optional; UI falls back
     *  to a strategy-based default when null. */
    avatarEmoji: text("avatar_emoji"),
    /** M13 — LLM provider chosen by the persona owner. One of
     *  "claude" | "openai" | "gemini" | "deepseek" | "xai" | "custom". Null
     *  for default agents (provider config baked into runner env) and for
     *  config-pending personas. Auto-detected by `detectProvider` when an
     *  ai_base_url is supplied without an explicit provider. */
    aiProvider: text("ai_provider"),
    /** AES-256-GCM ciphertext (hex) of the owner-supplied API key. Encrypted
     *  with TRADER_MASTER_KEY using the same scheme as trader privkeys. */
    aiApiKeyEncrypted: text("ai_api_key_encrypted"),
    /** 12-byte IV (hex) — accompanies ai_api_key_encrypted. */
    aiKeyIv: text("ai_key_iv"),
    /** 16-byte GCM auth tag (hex). */
    aiKeyAuthTag: text("ai_key_auth_tag"),
    /** Optional OpenAI-compatible base URL (e.g. self-hosted endpoint). When
     *  set without an explicit aiProvider, `detectProvider` infers from this. */
    aiBaseUrl: text("ai_base_url"),
    /** Model identifier the runner should call (free-text — provider-specific). */
    aiModel: text("ai_model"),
  },
  (t) => ({
    operatorIdx: index("agents_operator_idx").on(t.operator),
    scoreIdx: index("agents_score_idx").on(t.score),
  }),
);

/// Polymarket/Kalshi-style custodial trader wallets. Each FORUM identity gets a
/// fresh EOA generated server-side. The privkey is AES-256-GCM-encrypted using
/// TRADER_MASTER_KEY at rest. All manual bets sign with this EOA → EIP-3009
/// works uniformly for Rabby users AND Google email users (Dria smart wallets
/// can't sign EIP-3009 because USDC only does ecrecover).
///
/// `identity` is the upstream login identifier:
///   - For wallet logins (Rabby/MetaMask): lowercase EVM address of the connected wallet
///   - For email/Google logins (Dynamic Dria): sha256("google:" + email) as 0x-hex
export const traderWallets = sqliteTable(
  "trader_wallets",
  {
    /** sha256-of-email or lowercase EVM addr — see header comment */
    identity: text("identity").primaryKey(),
    /** Fresh EOA generated for this identity (lowercase 0x) */
    address: text("address").notNull(),
    /** AES-256-GCM ciphertext of the 32-byte privkey, hex-encoded (96 chars) */
    encryptedPrivkey: text("encrypted_privkey").notNull(),
    /** AES-GCM 12-byte IV (24 hex chars) — unique per row */
    iv: text("iv").notNull(),
    /** AES-GCM 16-byte auth tag (32 hex chars) */
    authTag: text("auth_tag").notNull(),
    /** Has this trader received their 1 USDC faucet drip? */
    faucetReceived: integer("faucet_received").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    /// P0-B audit: EOA that authenticated at /traders/issue. EIP-712 challenge
    /// signatures must recover to this address (or to the trader address itself
    /// for server-side runners). NULL on legacy pre-audit rows.
    ownerWallet: text("owner_wallet"),
  },
  (t) => ({
    addressUniq: uniqueIndex("trader_wallets_address_uniq").on(t.address),
  }),
);

/// Forecast traces — the M1 "Trace Pinning" primitive. Every LLM-driven bet
/// can publish the reasoning that produced it: the rationale text gets
/// sha256'd, stored here (and optionally pinned to Irys for permanence),
/// and the hash is referenced from the bet row via `bets.forecast_sha256`.
///
/// Why this matters: Polymarket / Kalshi can't economically pin a per-bet
/// reasoning trace because their settlement chains charge too much per
/// receipt. Arc's ~$0.01 fees make per-decision publication viable, so the
/// reasoning *itself* becomes a verifiable on-chain artifact. v0.1 stores
/// the rationale in our own DB; M1 final adds the Irys mainnet pin.
export const forecastTraces = sqliteTable(
  "forecast_traces",
  {
    /** sha256(rationale) hex, 0x-prefixed. Canonical identifier. */
    sha256: text("sha256").primaryKey(),
    /** Agent that produced the forecast (lowercase 0x). */
    agentAddress: text("agent_address").notNull(),
    /** Market the forecast was for. */
    marketId: text("market_id").notNull(),
    /** 0=NO, 1=YES — the side the agent picked. */
    outcome: integer("outcome").notNull(),
    /** Stated probability for the chosen outcome, e.g. "0.62". */
    probability: text("probability"),
    /** Stated confidence (0..1), e.g. "0.78". */
    confidence: text("confidence"),
    /** Full LLM rationale. Plaintext when `cipherAlg` is null. When the trace
     *  was published encrypted (M2.2), this is base64-encoded ciphertext —
     *  the hash is still computed over THIS exact bytes, so verification of
     *  hash(ciphertext) === sha256 works identically. Decryption is a
     *  client-side step using the agent operator's symmetric key. */
    rationale: text("rationale").notNull(),
    /** Optional structured forecast JSON for richer rendering. */
    rationaleJson: text("rationale_json"),
    /** Model identifier the agent used, e.g. "mimo-v2-pro" or "deepseek-v4-pro". */
    model: text("model"),
    /** M2.2 encrypted trace privacy.
     *  null      → plaintext (default, public reasoning)
     *  "aes-256-gcm" → AES-256-GCM ciphertext in `rationale` field; iv + authTag below. */
    cipherAlg: text("cipher_alg"),
    /** 12-byte AES-GCM IV, hex-encoded. */
    cipherIv: text("cipher_iv"),
    /** 16-byte AES-GCM auth tag, hex-encoded. */
    cipherAuthTag: text("cipher_auth_tag"),
    /** Irys/Arweave transaction id if pinned permanently. NULL = DB-only v0.1. */
    irysId: text("irys_id"),
    /** Public Irys gateway URL when pinned. */
    irysUrl: text("irys_url"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    agentIdx:  index("forecast_traces_agent_idx").on(t.agentAddress),
    marketIdx: index("forecast_traces_market_idx").on(t.marketId),
  }),
);

export const resolutions = sqliteTable("resolutions", {
  marketId: text("market_id")
    .primaryKey()
    .references(() => markets.id),
  outcome: integer("outcome").notNull(),
  dataHash: text("data_hash").notNull(),
  source: text("source").notNull(),
  signer: text("signer").notNull(),
  txHash: text("tx_hash").notNull(),
  resolvedAt: integer("resolved_at").notNull(),
  /** ISO date string the ECB reference rate was taken from (YYYY-MM-DD). */
  ecbDate: text("ecb_date"),
  /** Actual rate value as a decimal string (e.g., "1.1715"). Stored as TEXT to
   *  preserve precision — SQLite REAL would round-trip via float. */
  ecbRate: text("ecb_rate"),
});

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

/// M4 Trace Markets — meta-bets on agent reasoning win-rates over a
/// rolling time window. "Will Oracle's win-rate be ≥ 60% over the
/// next 24h?" Resolves off-chain from bets ⨯ resolutions join; bets
/// settle on-chain in USDC against market-api treasury.
export const traceMarkets = sqliteTable(
  "trace_markets",
  {
    id: text("id").primaryKey(), // keccak(targetAgent + threshold + opensAt)
    /** Agent whose win-rate is being predicted. */
    targetAgent: text("target_agent").notNull(),
    /** Threshold in basis points (5000 = 50%, 6000 = 60%). */
    thresholdBps: integer("threshold_bps").notNull(),
    /** Window over which win-rate is measured. */
    windowHours: integer("window_hours").notNull(),
    opensAt: integer("opens_at").notNull(),
    closesAt: integer("closes_at").notNull(),
    /** 0=OPEN, 1=CLOSED, 2=RESOLVED */
    phase: integer("phase").notNull().default(0),
    /** 0=NO (didn't hit threshold), 1=YES (did), 2=INVALID (no bets in window). */
    winningOutcome: integer("winning_outcome"),
    yesPoolUsdc: text("yes_pool_usdc").notNull().default("0"),
    noPoolUsdc: text("no_pool_usdc").notNull().default("0"),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
    /** Computed win-rate at resolution time, in basis points. */
    resolvedWinRateBps: integer("resolved_win_rate_bps"),
  },
  (t) => ({
    targetIdx: index("trace_markets_agent_idx").on(t.targetAgent),
    phaseIdx:  index("trace_markets_phase_idx").on(t.phase),
  }),
);

export const traceBets = sqliteTable(
  "trace_bets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    traceMarketId: text("trace_market_id").notNull(),
    bettor: text("bettor").notNull(),
    /** 0=NO, 1=YES */
    outcome: integer("outcome").notNull(),
    /** Bet size in 6-dec base units. */
    costUsdc: text("cost_usdc").notNull(),
    /** On-chain USDC settlement tx hash. */
    txHash: text("tx_hash"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    marketIdx: index("trace_bets_market_idx").on(t.traceMarketId),
    bettorIdx: index("trace_bets_bettor_idx").on(t.bettor),
  }),
);

export type TraceMarket = typeof traceMarkets.$inferSelect;
export type NewTraceMarket = typeof traceMarkets.$inferInsert;
export type TraceBet = typeof traceBets.$inferSelect;
export type NewTraceBet = typeof traceBets.$inferInsert;

/// Idempotent CREATE IF NOT EXISTS statements. Run on first boot.
export const INITIAL_SCHEMA_SQL = `
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
  opens_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  resolves_at INTEGER,
  phase INTEGER NOT NULL DEFAULT 0,
  winning_outcome INTEGER,
  created_at_block INTEGER NOT NULL,
  created_at_tx_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'manual',
  collateral TEXT NOT NULL DEFAULT 'USDC'
);
CREATE INDEX IF NOT EXISTS markets_pair_idx ON markets (pair);
CREATE INDEX IF NOT EXISTS markets_phase_idx ON markets (phase);
CREATE INDEX IF NOT EXISTS markets_closes_at_idx ON markets (closes_at);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL REFERENCES markets(id),
  agent_address TEXT NOT NULL,
  outcome INTEGER NOT NULL,
  shares_wad TEXT NOT NULL,
  cost_usdc TEXT NOT NULL,
  fee_usdc TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  settlement_tx_hash TEXT,
  market_tx_hash TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL
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
  registered_at INTEGER NOT NULL,
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
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS trader_wallets_address_uniq ON trader_wallets (address);

CREATE TABLE IF NOT EXISTS resolutions (
  market_id TEXT PRIMARY KEY REFERENCES markets(id),
  outcome INTEGER NOT NULL,
  data_hash TEXT NOT NULL,
  source TEXT NOT NULL,
  signer TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  resolved_at INTEGER NOT NULL,
  ecb_date TEXT,
  ecb_rate TEXT
);
`;
