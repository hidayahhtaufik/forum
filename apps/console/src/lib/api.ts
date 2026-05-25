/// Server-side fetchers used by Next.js Server Components and route handlers.
/// All requests are no-store by default — landing data is intentionally fresh.

const API = process.env.NEXT_PUBLIC_MARKET_API_URL ?? "http://127.0.0.1:8403";

export type Market = {
  id: string;
  address: string;
  question: string;
  pair: string;
  strikeWad: string;
  comparator: "GT" | "GTE" | "LT" | "LTE";
  bWad: string;
  qYesWad: string;
  qNoWad: string;
  collateralEscrowed: string;
  feeAccrued: string;
  opensAt: number;
  closesAt: number;
  resolvesAt: number | null;
  phase: 0 | 1 | 2;
  winningOutcome: 0 | 1 | 2 | null;
  createdAtBlock: number;
  createdAtTxHash: string;
  createdAt: number;
  /** Source identifier — "manual", "scout:ecb", "scout:fed", "scout:bbc", "scout:tg:<channel>", etc. */
  createdBy: string;
  /** Collateral asset — "USDC" (default) or "EURC". Markets settle in this asset. */
  collateral?: "USDC" | "EURC";
};

export type Bet = {
  id: number;
  marketId: string;
  agentAddress: string;
  outcome: 0 | 1;
  sharesWad: string;
  costUsdc: string;
  feeUsdc: string;
  marketTxHash: string;
  blockNumber: number;
  createdAt: number;
  /** M1 Trace Pinning — sha256 of the LLM rationale linked to this bet, if pinned. */
  forecastSha256?: string | null;
};

export type ForecastTrace = {
  sha256: string;
  agentAddress: string;
  marketId: string;
  outcome: 0 | 1;
  probability: string | null;
  confidence: string | null;
  /** Plaintext rationale, OR base64-encoded ciphertext when `cipher` is set. */
  rationale: string;
  rationaleJson: unknown;
  model: string | null;
  irysId: string | null;
  irysUrl: string | null;
  /** M2.2 — non-null when the trace is encrypted. Decryption is client-side. */
  cipher: {
    alg: "aes-256-gcm";
    iv: string;
    authTag: string;
  } | null;
  createdAt: number;
};

export async function fetchForecastTrace(hash: string): Promise<ForecastTrace | null> {
  if (!/^0x[a-f0-9]{64}$/i.test(hash)) return null;
  return safeJson<ForecastTrace>(`${API}/forecasts/${hash.toLowerCase()}`);
}

export type ServiceInfo = {
  name: string;
  version: string;
  chainId: number;
  payTo: string;
  facilitator: string;
  contracts: Record<string, string>;
};

export async function fetchInfo(): Promise<ServiceInfo | null> {
  return safeJson<ServiceInfo>(`${API}/`);
}

export type ProtocolStats = {
  treasuryAddress: string;
  /** USDC base units (6 decimals) — total balance of the treasury wallet on-chain. */
  treasuryBalance: string;
  /** Sum of feeAccrued across every market (active + resolved). USDC base units. */
  totalFeesAccrued: string;
  /** Sum of cost+fee across every settled bet. USDC base units. */
  totalVolume: string;
  /** Sum of collateralEscrowed across all markets. USDC base units. */
  totalCollateral: string;
  marketsTotal: number;
  marketsOpen: number;
  marketsClosed: number;
  marketsResolved: number;
  betCount: number;
  agentCount: number;
  chainId: number;
};

export async function fetchProtocolStats(): Promise<ProtocolStats | null> {
  return safeJson<ProtocolStats>(`${API}/protocol/stats`);
}

export async function fetchMarkets(opts?: { status?: "open" | "closed" | "resolved" }): Promise<Market[]> {
  const qs = opts?.status ? `?status=${opts.status}` : "";
  const data = await safeJson<{ count: number; markets: Market[] }>(`${API}/markets${qs}`);
  return data?.markets ?? [];
}

export async function fetchRecentBets(limit = 20): Promise<Bet[]> {
  const data = await safeJson<{ count: number; bets: Bet[] }>(`${API}/bets/recent?limit=${limit}`);
  return data?.bets ?? [];
}

export type MeshMessage = {
  id: number;
  sender: string;
  envelopeType: string;
  marketId: string | null;
  bodyJson: string;
  sigPrefix: string;
  signedAt: number;
  createdAt: number;
};

export async function fetchRecentMeshMessages(limit = 50): Promise<MeshMessage[]> {
  const data = await safeJson<{ count: number; messages: MeshMessage[] }>(
    `${API}/mesh/recent?limit=${limit}`,
  );
  return data?.messages ?? [];
}

export type ForecastTrailBet = {
  id: number;
  marketId: string;
  agentAddress: string;
  outcome: 0 | 1;
  costUsdc: string;
  marketTxHash: string;
  createdAt: number;
};

export type ForecastTrail = {
  hash: string;
  generatedAt: number;
  pinnedToIrys: { irysId: string; irysUrl: string | null } | null;
  market: {
    id: string;
    question: string;
    phase: number;
    opensAt: number;
    closesAt: number;
    resolvesAt: number | null;
    createdAt: number;
  } | null;
  bets: ForecastTrailBet[];
  resolution: {
    outcome: 0 | 1 | 2;
    txHash: string;
    resolvedAt: number;
    source: string;
    ecbRate: string | null;
    ecbDate: string | null;
  } | null;
};

export async function fetchForecastTrail(hash: string): Promise<ForecastTrail | null> {
  return safeJson<ForecastTrail>(`${API}/forecasts/${hash}/trail`);
}

export type AuditTrailRow = {
  marketId: string;
  marketAddress: string;
  question: string;
  pair: string;
  strikeWad: string;
  comparator: "GT" | "GTE" | "LT" | "LTE";
  closesAt: number;
  createdAt: number;
  createdBy: string;
  outcome: 0 | 1 | 2;
  dataHash: string;
  source: string;
  signer: string;
  txHash: string;
  resolvedAt: number;
  ecbDate: string | null;
  ecbRate: string | null;
};

export type AuditTrail = {
  count: number;
  generatedAt: number;
  commitments: {
    deterministicFinality: string;
    attestedSource: string;
    signedResolution: string;
    auditability: string;
  };
  rows: AuditTrailRow[];
};

export async function fetchAuditTrail(limit = 50): Promise<AuditTrail | null> {
  return safeJson<AuditTrail>(`${API}/protocol/audit-trail?limit=${limit}`);
}

export type Honos = {
  /** Reputation score — log-weighted wins minus log-weighted losses. */
  score: number;
  wins: number;
  losses: number;
  settled: number;
  /** 1-indexed rank among all agents with at least one settled bet. */
  rank: number | null;
  /** Total agents in the leaderboard (denominator for rank). */
  rankOf: number;
  /** Wins / settled, rounded to 3 decimals. Null if no settled bets. */
  winRate: number | null;
};

export type AgentPersonaAi = {
  /** "claude" | "openai" | "gemini" | "deepseek" | "xai" | "custom" | null */
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  /** Whether an encrypted API key is stored — secret itself is NEVER returned. */
  hasKey: boolean;
};

export type AgentPersona = {
  name: string | null;
  personaLabel: string | null;
  /** "standard" | "conservative" | "contrarian" | "edge_weighted" | "copy_oracle" | null */
  strategyId: string | null;
  avatarEmoji: string | null;
  /** Lowercase trader-wallet address of the user who spawned this agent. Null for default agents. */
  ownerIdentity: string | null;
  verified: boolean;
  /** "oracle" | "mirror" | "arb" | "custom" | null */
  kind: string | null;
  /** M13 — owner-supplied LLM credentials (key value redacted). */
  ai?: AgentPersonaAi;
};

export type AgentProfile = {
  address: string;
  betCount: number;
  yesCount: number;
  noCount: number;
  totalVolumeUsdc: string;
  firstBetAt: number | null;
  lastBetAt: number | null;
  bets: Bet[];
  /** M2.1 Honos reputation — v0 DB-derived; M2 swap to on-chain. */
  honos?: Honos;
  /** M6 — persona fields for owner-side edit + marketplace cards. Null for default agents. */
  persona?: AgentPersona | null;
};

export async function fetchAgentProfile(address: string): Promise<AgentProfile | null> {
  return safeJson<AgentProfile>(`${API}/agents/${address.toLowerCase()}`);
}

export type HonosLeaderboardRow = {
  rank: number;
  address: string;
  score: number;
  wins: number;
  losses: number;
  winRate: number | null;
};

export async function fetchHonosLeaderboard(limit = 20): Promise<HonosLeaderboardRow[]> {
  const data = await safeJson<{ leaderboard: HonosLeaderboardRow[] }>(`${API}/agents/leaderboard?limit=${limit}`);
  return data?.leaderboard ?? [];
}

/// User-spawned personas currently listed for outright purchase. Joined to
/// `agents` server-side so the /marketplace UI can render a card without
/// an extra per-agent fetch.
export type MarketplaceListing = {
  agent_address: string;
  seller: string;
  /** USDC base units (6 dec), e.g. "5000000" = 5 USDC. "0" = buy disabled
   *  (rent-only listing); UI hides the Buy button when this is "0". */
  buy_price_usdc: string;
  /** Owner-set rent tier prices (6-dec USDC base units). NULL = tier not
   *  offered → UI hides that rent button. */
  rent_6h_usdc: string | null;
  rent_24h_usdc: string | null;
  rent_week_usdc: string | null;
  rent_month_usdc: string | null;
  created_at: number;
  name: string | null;
  persona_label: string | null;
  avatar_emoji: string | null;
  strategy_id: string | null;
  verified: number | null;
};

export async function fetchMarketplaceListings(): Promise<MarketplaceListing[]> {
  const data = await safeJson<{ count: number; listings: MarketplaceListing[] }>(`${API}/marketplace/listings`);
  return data?.listings ?? [];
}

export type Resolution = {
  marketId: string;
  outcome: 0 | 1 | 2;
  dataHash: string;
  source: string;
  signer: string;
  txHash: string;
  resolvedAt: number;
  /** ISO date (YYYY-MM-DD) the source rate was sampled from. Null for archived
   *  resolutions pre-2026-05-15 that landed before this field existed. */
  ecbDate?: string | null;
  /** Decimal-string rate (e.g., "1.1715"). Same back-compat caveat as ecbDate. */
  ecbRate?: string | null;
};

export async function fetchResolution(marketId: string): Promise<Resolution | null> {
  return safeJson<Resolution>(`${API}/markets/${marketId.toLowerCase()}/resolution`);
}

/// M4 Trace Markets — meta-bets on agent reasoning win-rates.
/// `currentWinRateBps` is computed live by the backend from bets ⨯ resolutions.
/// Pool sizes are base-units strings; convert via Number()/1e6 for display.
export type TraceMarket = {
  id: string;
  targetAgent: string;
  thresholdBps: number;
  windowHours: number;
  opensAt: number;
  closesAt: number;
  phase: 0 | 1 | 2;
  winningOutcome: 0 | 1 | null;
  yesPoolUsdc: string;
  noPoolUsdc: string;
  createdAt: number;
  resolvedAt: number | null;
  resolvedWinRateBps: number | null;
  currentWinRateBps: number;
  currentSettled: number;
};

export type TraceMarketBet = {
  id: number;
  traceMarketId: string;
  bettor: string;
  outcome: 0 | 1;
  costUsdc: string;
  txHash: string | null;
  createdAt: number;
};

/// Source bet — one of the target agent's own bets within the resolution
/// window, joined with the eventual winning outcome of that market. The
/// resolved validity report uses these to prove WHY the win-rate landed where
/// it did. Only populated by the backend when `phase === 2`.
export type TraceSourceBet = {
  marketId: string;
  agentOutcome: number;
  winningOutcome: number | null;
  isWin: boolean;
  settlementTxHash: string | null;
  createdAt: number;
};

export type TraceMarketDetail = TraceMarket & {
  bets: TraceMarketBet[];
  /// Count of settled bets the resolver considered. Mirrors `currentSettled`
  /// for open markets; frozen at resolution time for resolved markets.
  settledBetsConsidered?: number;
  /// Empty array when phase !== 2.
  sourceBets?: TraceSourceBet[];
};

export async function fetchTraceMarkets(status?: "open" | "resolved"): Promise<TraceMarket[]> {
  const qs = status ? `?status=${status}` : "";
  const data = await safeJson<{ count: number; traceMarkets: TraceMarket[] }>(`${API}/trace-markets${qs}`);
  return data?.traceMarkets ?? [];
}

export async function fetchTraceMarket(id: string): Promise<TraceMarketDetail | null> {
  if (!/^0x[a-f0-9]{64}$/i.test(id)) return null;
  return safeJson<TraceMarketDetail>(`${API}/trace-markets/${id.toLowerCase()}`);
}

/// M7 — Circle CCTP V2 cross-chain funding (Base → Arc, etc).

export type CctpSource = {
  id: "base-sepolia" | "ethereum-sepolia" | "arbitrum-sepolia";
  label: string;
  chainId: number;
  domain: number;
  usdc: `0x${string}`;
  tokenMessenger: `0x${string}`;
  messageTransmitter: `0x${string}`;
  explorer: string;
  finalityMin: number;
};

export type CctpBurnConfig = {
  source: CctpSource;
  destination: {
    label: string;
    chainId: number;
    domain: number;
    usdc: string;
    messageTransmitter: string;
    tokenMessenger: string;
    explorer: string;
  };
};

export type CctpAttestationResponse =
  | { status: "pending"; messages: Array<{ message: string | null; attestation: string | null; status: string | null }> }
  | { status: "ready"; messages: Array<{ message: string; attestation: string; status: string | null }> }
  | { status: "not_found" };

export async function fetchCctpSources(): Promise<{ sources: CctpSource[]; destination: { chainId: number; domain: number } } | null> {
  return safeJson(`${API}/cctp/sources`);
}

export async function fetchCctpBurnConfig(chainId: string): Promise<CctpBurnConfig | null> {
  return safeJson(`${API}/cctp/burn-config/${chainId}`);
}

export async function fetchCctpAttestation(burnTx: string, sourceDomain: number): Promise<CctpAttestationResponse | null> {
  if (!/^0x[a-f0-9]{64}$/i.test(burnTx)) return null;
  return safeJson(`${API}/cctp/attestation/${burnTx.toLowerCase()}?sourceDomain=${sourceDomain}`);
}

export type CctpReceiveResult =
  | { ok: true; txHash: string; explorer: string }
  | { ok: false; error: string };

export async function submitCctpReceive(message: string, attestation: string): Promise<CctpReceiveResult> {
  const res = await fetch(`${API}/cctp/receive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, attestation }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string; txHash?: string; explorer?: string };
  if (!res.ok) return { ok: false, error: json.error ?? `HTTP ${res.status}` };
  if (!json.txHash || !json.explorer) return { ok: false, error: "receive succeeded but response missing tx" };
  return { ok: true, txHash: json.txHash, explorer: json.explorer };
}

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/// Aggregated agent stats, derived from bets + (later) market resolutions.
/// v0.1 surfaces what's known: address, total volume, bet count.
export type AgentStat = {
  address: string;
  label: string | null; // optional display name from a known-address map
  betCount: number;
  totalVolumeUsdc: bigint; // sum of cost + fee
  lastBetTs: number;
  lastBetTx: string;
};

const KNOWN_AGENTS: Record<string, { label: string; strategy: string }> = {
  "0xd04d955c9989982e76cfb6287affd97acbe0ae2f": { label: "oracle", strategy: "mimo · ECB rate" },
  "0x24018ec27dbc3f5805d19b7d6f89d83eba7ef85a": { label: "mirror", strategy: "copy-trade 0.5×" },
  "0x2344d1fcb82c1dfe9d3de49ddfdd2878bbfbdff0": { label: "sage", strategy: "mimo · conservative" },
  "0xce78b7f1016aff9db58de3d986e8cd36262bcf90": { label: "hermes", strategy: "mimo · contrarian" },
  "0x1ffd8313bb45ccdfdf151e194f2bc8e8293206af": { label: "augur", strategy: "mimo · edge-weighted Kelly" },
  "0x58cda47b1ad044757b44046718ed64036583f2a3": { label: "deployer", strategy: "test wallet" },
};

export function knownAgent(addr: string): { label: string; strategy: string } | null {
  return KNOWN_AGENTS[addr.toLowerCase()] ?? null;
}

export function aggregateAgents(allBets: Bet[]): AgentStat[] {
  const byAddr = new Map<string, AgentStat>();
  for (const b of allBets) {
    const addr = b.agentAddress.toLowerCase();
    const known = knownAgent(addr);
    const existing = byAddr.get(addr) ?? {
      address: addr,
      label: known?.label ?? null,
      betCount: 0,
      totalVolumeUsdc: 0n,
      lastBetTs: 0,
      lastBetTx: "",
    };
    existing.betCount += 1;
    existing.totalVolumeUsdc += BigInt(b.costUsdc) + BigInt(b.feeUsdc);
    if (b.createdAt > existing.lastBetTs) {
      existing.lastBetTs = b.createdAt;
      existing.lastBetTx = b.marketTxHash;
    }
    byAddr.set(addr, existing);
  }
  return Array.from(byAddr.values()).sort((a, b) => {
    if (b.totalVolumeUsdc !== a.totalVolumeUsdc) {
      return b.totalVolumeUsdc > a.totalVolumeUsdc ? 1 : -1;
    }
    return b.lastBetTs - a.lastBetTs;
  });
}
