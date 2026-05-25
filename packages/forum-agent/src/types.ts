/// Shared SDK types. Keep this file dependency-free so consumers can import types
/// without pulling in viem/openai/zod.

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/// FORUM market metadata as returned by market-api GET /markets/:id.
export type Market = {
  id: Hex;
  address: Address;
  question: string;
  pair: string;
  /// Decimal-string WAD-encoded strike (e.g. "1100000000000000000" = 1.10).
  strikeWad: string;
  /// "GT" | "GTE" | "LT" | "LTE"
  comparator: "GT" | "GTE" | "LT" | "LTE";
  /// LMSR b parameter (WAD)
  bWad: string;
  /// Outstanding YES shares (WAD)
  qYesWad: string;
  /// Outstanding NO shares (WAD)
  qNoWad: string;
  /// 6-dec USDC
  collateralEscrowed: string;
  feeAccrued: string;
  opensAt: number;
  closesAt: number;
  resolvesAt: number | null;
  /// 0=OPEN, 1=CLOSED, 2=RESOLVED
  phase: 0 | 1 | 2;
  winningOutcome: 0 | 1 | 2 | null;
  createdAtBlock: number;
  createdAtTxHash: Hex;
  createdAt: number;
};

/// LLM forecast output — strict shape returned by the trading-agent system prompt.
export type Forecast = {
  outcome: "YES" | "NO";
  /// 0..1 probability the trader believes for YES (regardless of outcome above).
  probability: number;
  /// 0..1 confidence in the forecast itself.
  confidence: number;
  /// Short human-readable reasoning. Optional — agents may skip.
  rationale: string;
  /// USDC base-units (6-dec) the LLM thinks should be bet. Pre-budget-cap.
  suggestedSizeUsdc: string;
  /// LLM model identifier — only set when the SDK pins via Trace Pinning,
  /// so the trace row records which model produced the rationale.
  model?: string;
};

/// Receipt returned by POST /forecasts/pin (M1 Trace Pinning).
/// The hash is the canonical identifier; irys fields are populated once
/// permanent storage lands in M1 final.
export type ForecastTraceReceipt = {
  sha256: `0x${string}`;
  irysId: string | null;
  irysUrl: string | null;
  /// True if the server already had this exact trace stored.
  deduped: boolean;
};

/// What the SDK pulls back from market-api GET /markets/:id/quote.
export type SignedQuote = {
  marketId: Hex;
  marketAddress: Address;
  outcome: 0 | 1;
  shares: string; // WAD
  costUsdc: string; // 6-dec
  feeUsdc: string; // 6-dec
  totalPaidUsdc: string;
  validUntil: string;
  nonce: Hex;
  signature: Hex;
  signer: Address;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
};

/// Bet intent the agent signs and POSTs to market-api `/markets/:id/bets`.
export type BetIntent = {
  marketId: Hex;
  outcome: 0 | 1;
  shares: string; // WAD
  /// Inclusive cap (USDC base units) — server reverts if quoted total > maxCost.
  maxCost: string; // 6-dec
  /// Unix seconds.
  deadline: number;
  /// Agent's EVM address.
  agent: Address;
  /// Random 32-byte nonce — same one used in the EIP-3009 authorization.
  nonce: Hex;
};

/// EIP-3009 transferWithAuthorization payload that the buyer signs against USDC.
export type Eip3009Authorization = {
  from: Address;
  to: Address;
  value: string; // 6-dec USDC base units
  validAfter: number;
  validBefore: number;
  nonce: Hex;
};

/// Result of a successful placeBet — the receipt market-api returns after on-chain dispatch.
export type BetReceipt = {
  marketId: Hex;
  marketAddress: Address;
  outcome: 0 | 1;
  shares: string;
  costUsdc: string;
  feeUsdc: string;
  txHash: Hex;
  blockNumber: number;
  explorer: string;
};

/// Per-agent budget envelope — enforced in-SDK before any LLM or chain call.
export type BudgetConfig = {
  /// Maximum USDC (decimal string, e.g. "1.00") per single bet.
  perBetUsdc: string;
  /// Maximum USDC spent per rolling 24h window.
  dailyCapUsdc: string;
};

/// What the agent emits on `on("market", ...)` for downstream handling.
export type MarketEvent = {
  market: Market;
  /// Indicates this is the first time the agent sees this market in this session.
  isNew: boolean;
};
