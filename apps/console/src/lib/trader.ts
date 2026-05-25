"use client";

/// Client for the FORUM trader-wallet endpoints (Polymarket/Kalshi model).
///
/// Each FORUM identity (Rabby connect OR email/Google login) gets a fresh
/// EOA generated server-side. The privkey lives encrypted in market-api;
/// all bets are signed server-side using the trader privkey, which is why
/// this flow works for Dynamic Dria smart wallets too — they never sign
/// EIP-3009 themselves.

import { buildAuthHeaders, type Signer } from "./auth";

const API = process.env.NEXT_PUBLIC_MARKET_API_URL ?? "http://127.0.0.1:8403";

export type TraderInfo = {
  address: string;
  usdcBalance: string;
  usdcBalanceFormatted: string;
  faucetReceived: boolean;
  createdAt: number;
  ageSeconds: number;
};

export type IssueResult = { address: string; isNew: boolean; faucetReceived: boolean };

/// Derive a stable, client-computed identity string from the Dynamic login state.
///   - Email/Google logins → "email:" + lowercased email
///   - Wallet logins      → "wallet:" + lowercased connected address
///
/// The server only needs the identity to be stable across sessions for the same
/// user. The actual auth+custody guarantee comes from the server holding the
/// trader privkey under TRADER_MASTER_KEY.
export function deriveIdentity(opts: { email?: string | null; walletAddress?: string | null }): string | null {
  const email = opts.email?.trim().toLowerCase();
  if (email && email.includes("@")) return `email:${email}`;
  const wallet = opts.walletAddress?.trim().toLowerCase();
  if (wallet && /^0x[a-f0-9]{40}$/.test(wallet)) return `wallet:${wallet}`;
  return null;
}

/// Pass `ownerWallet` (the connected Dynamic EOA) so the server records it
/// as the only wallet allowed to authorize privileged trader operations.
/// See SECURITY_AUDIT P0-B-001..009 + apps/market-api/src/lib/auth.ts.
export async function issueTrader(identity: string, ownerWallet?: string): Promise<IssueResult> {
  const res = await fetch(`${API}/traders/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity, ...(ownerWallet ? { ownerWallet } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`issue failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as IssueResult;
}

export async function fetchTrader(address: string): Promise<TraderInfo | null> {
  const res = await fetch(`${API}/traders/${address.toLowerCase()}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch trader failed: ${res.status}`);
  return (await res.json()) as TraderInfo;
}

export async function requestFaucet(address: string): Promise<{ txHash: string; explorer: string }> {
  const res = await fetch(`${API}/traders/${address.toLowerCase()}/faucet`, { method: "POST" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`faucet failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as { txHash: string; explorer: string };
}

export type TraderBetResult = {
  marketId: string;
  marketAddress: string;
  outcome: 0 | 1;
  shares: string;
  costUsdc: string;
  feeUsdc: string;
  txHash: string;
  settlementTxHash: string;
  blockNumber: number;
  explorer: string;
};

export type WithdrawResult = {
  address: string;
  destinationAddress: string;
  amountUsdc: string;
  txHash: string;
  explorer: string;
};

export type ClaimResult = {
  marketId: string;
  outcome: 0 | 1;
  shares: string;
  claimedUsdc: string;
  txHash: string | null;
  explorer: string | null;
  note?: string;
};

/// Claim winning shares from a resolved market on behalf of the trader wallet.
/// Server signs the on-chain claim() call using the custodial privkey, funds a
/// tiny USDC float for gas if the wallet is dry, and the payout lands directly
/// in the trader wallet.
export async function claimMarket(args: {
  traderAddress: string;
  marketId: string;
  signer: Signer;
}): Promise<ClaimResult> {
  const auth = await buildAuthHeaders({ traderAddress: args.traderAddress, signer: args.signer });
  const res = await fetch(`${API}/traders/${args.traderAddress.toLowerCase()}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ marketId: args.marketId }),
    signal: AbortSignal.timeout(120_000),
  }).catch((err: unknown) => {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("claim timed out after 120s — try again in a moment");
    }
    throw err;
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`claim failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as ClaimResult;
}

export async function withdrawFromTrader(args: {
  traderAddress: string;
  destinationAddress: string;
  amountUsdc: string;
  signer: Signer;
}): Promise<WithdrawResult> {
  const auth = await buildAuthHeaders({ traderAddress: args.traderAddress, signer: args.signer });
  const res = await fetch(`${API}/traders/${args.traderAddress.toLowerCase()}/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({
      destinationAddress: args.destinationAddress,
      amountUsdc: args.amountUsdc,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`withdraw failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as WithdrawResult;
}

export type Quote = {
  marketId: string;
  outcome: 0 | 1;
  shares: string;
  costUsdc: string;
  feeUsdc: string;
  totalPaidUsdc: string;
  validUntil: string;
};

/// Live quote for a prospective bet. Used by BetForm to render the
/// Polymarket-style shares + payout + ROI breakdown as the user types.
export async function fetchQuote(args: {
  marketId: string;
  outcome: 0 | 1;
  amountUsdc: string;
}): Promise<Quote> {
  // Match the server-side heuristic: 1 USDC budget ≈ 2 shares at initial 50/50.
  // The actual LMSR cost the quote returns may differ slightly — that's the point.
  const budget = BigInt(Math.floor(Number(args.amountUsdc) * 1_000_000));
  const sharesWad = budget * 2n * 10n ** 12n;
  const url = `${API}/markets/${args.marketId.toLowerCase()}/quote?outcome=${args.outcome}&shares=${sharesWad}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`quote failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as Quote;
}

/// M8.2 — Premium insights unlocked via x402 nanopayment. Server signs the
/// EIP-712 USDC TransferWithAuthorization using the custodial trader privkey,
/// settles 0.001 USDC on Arc, then returns the agent's premium stats payload.
/// Owner-free pass: if the trader matches the agent's owner_identity, server
/// skips payment and returns the payload directly.
export type PremiumInsights = {
  address: string;
  paid: boolean;
  settledTx: string | null;
  pricePaidUsdc: string;
  persona: { name: string | null; personaLabel: string | null; strategyId: string | null; verified: boolean };
  honos: { score: number; wins: number; losses: number; settled: number; rank: number | null; rankOf: number; winRate: number | null };
  winRate24h: number | null;
  winRate7d: number | null;
  winRateAllTime: number | null;
  pnlUsdc: string;
  pnlByMarket: Array<{ marketId: string; pnlUsdc: string }>;
  signalCorrelation: number | null;
  streak: number;
  mostBetMarket: { marketId: string; volumeUsdc: string } | null;
  latestForecasts: Array<{
    sha256: string;
    marketId: string;
    outcome: 0 | 1;
    confidence: string | null;
    model: string | null;
    rationaleSnippet: string;
    createdAt: number;
  }>;
  stats: { totalBets: number; totalVolumeUsdc: string; avgBetSizeUsdc: string; yesShare: number };
  recentBets: Array<{
    id: number; marketId: string; outcome: 0 | 1;
    costUsdc: string; feeUsdc: string;
    marketTxHash: string; forecastSha256: string | null; createdAt: number;
  }>;
};

export type UnlockInsightsResult = {
  ok: true;
  ownerFreePass: boolean;
  insights: PremiumInsights;
  settlementTxHash: string | null;
  arcscanUrl: string | null;
};

export async function unlockInsights(args: {
  traderAddress: string;
  targetAgent: string;
  signer: Signer;
}): Promise<UnlockInsightsResult> {
  const auth = await buildAuthHeaders({ traderAddress: args.traderAddress, signer: args.signer });
  const res = await fetch(`${API}/traders/${args.traderAddress.toLowerCase()}/unlock-insights`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ targetAgent: args.targetAgent.toLowerCase() }),
    signal: AbortSignal.timeout(120_000),
  }).catch((err: unknown) => {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("unlock timed out after 120s — market-api may be backed up");
    }
    throw err;
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`unlock failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as UnlockInsightsResult;
}

export async function placeTraderBet(args: {
  traderAddress: string;
  marketId: string;
  outcome: 0 | 1;
  amountUsdc: string;
  slippageBps?: number;
  signer: Signer;
}): Promise<TraderBetResult> {
  // 90s ceiling — covers a worst-case settle + approve + buyShares cycle
  // through market-api's serialized chain queue (3 tx × 25-30s each on Arc
  // Testnet). If the backend is wedged on a stuck nonce, the user gets a
  // clear error instead of a forever-spinning button.
  const auth = await buildAuthHeaders({ traderAddress: args.traderAddress, signer: args.signer });
  const res = await fetch(`${API}/traders/${args.traderAddress.toLowerCase()}/bet`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({
      marketId: args.marketId,
      outcome: args.outcome,
      amountUsdc: args.amountUsdc,
      slippageBps: args.slippageBps ?? 50,
    }),
    signal: AbortSignal.timeout(90_000),
  }).catch((err: unknown) => {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("bet timed out after 90s — market-api may be backed up. Try again in a moment.");
    }
    throw err;
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`bet failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TraderBetResult;
}
