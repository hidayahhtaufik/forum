import { describe, it, expect, beforeEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { Agent, BudgetExceededError, hashIntent } from "../src/agent.js";
import type { Market, BetReceipt } from "../src/types.js";

// ============================================================
// Test fixtures — mock market-api responses
// ============================================================

const MARKET_API_BASE = "http://mock-market-api.local";
const PAYTO: `0x${string}` = "0xaa80FC146954aD2f0FD669dD665439e1e6ac5b68";

const fixtureMarket: Market = {
  id: "0x9939c3c1143745d096d38fa39c6a36c6e8fd55d6e912573e0bff839a3d594b67",
  address: "0xfFE4E3943fdd6E100959A4FDa7ce2091dde24315",
  question: "Will EUR/USD close >= 1.10 at 16:00 CET on 2026-05-15?",
  pair: "EURUSD",
  strikeWad: "1100000000000000000",
  comparator: "GTE",
  bWad: "100000000000000000000",
  qYesWad: "0",
  qNoWad: "0",
  collateralEscrowed: "5000000",
  feeAccrued: "0",
  opensAt: 1_700_000_000,
  closesAt: 9_000_000_000,
  resolvesAt: null,
  phase: 0,
  winningOutcome: null,
  createdAtBlock: 1,
  createdAtTxHash: "0x" + "ab".repeat(32),
  createdAt: 1_700_000_000,
};

type FetchCall = { url: string; init?: RequestInit };

function makeMockFetch(opts?: { onPlaceBet?: (body: unknown) => BetReceipt | { error: string; status: number } }) {
  const calls: FetchCall[] = [];
  const handler: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    calls.push({ url, ...(init !== undefined ? { init } : {}) });

    if (url.endsWith("/")) {
      return jsonResponse({
        name: "FORUM market-api",
        version: "0.1.0",
        chainId: 5042002,
        payTo: PAYTO,
        facilitator: "https://gateway-api-testnet.circle.com",
        contracts: {},
      });
    }
    if (url.endsWith("/health")) {
      return jsonResponse({ ok: true, onchain: true, totalMarkets: "1" });
    }
    if (url.endsWith("/markets") || url.endsWith("/markets?status=open")) {
      return jsonResponse({ count: 1, markets: [fixtureMarket] });
    }
    if (url.endsWith(`/markets/${fixtureMarket.id}`)) {
      return jsonResponse(fixtureMarket);
    }
    if (url.includes(`/markets/${fixtureMarket.id}/quote`)) {
      // Return a deterministic quote: 0.5 USDC cost, 0.01 fee for 1e18 wad shares.
      return jsonResponse({
        marketId: fixtureMarket.id,
        marketAddress: fixtureMarket.address,
        outcome: 1,
        shares: "1000000000000000000",
        costUsdc: "500000",
        feeUsdc: "10000",
        totalPaidUsdc: "510000",
        validUntil: String(Math.floor(Date.now() / 1000) + 30),
        nonce: "0x" + "ab".repeat(32),
        signature: ("0x" + "cd".repeat(65)),
        signer: PAYTO,
        domain: { name: "FORUM Market Quote", version: "1", chainId: 5042002, verifyingContract: PAYTO },
      });
    }
    if (url.endsWith(`/markets/${fixtureMarket.id}/bets`)) {
      if (opts?.onPlaceBet) {
        const body = init?.body ? JSON.parse(init.body as string) : null;
        const result = opts.onPlaceBet(body);
        if ("error" in result) return jsonResponse({ error: result.error }, result.status);
        return jsonResponse(result);
      }
      return jsonResponse({
        marketId: fixtureMarket.id,
        marketAddress: fixtureMarket.address,
        outcome: 1,
        shares: "1000000000000000000",
        costUsdc: "500000",
        feeUsdc: "10000",
        txHash: "0x" + "ef".repeat(32),
        blockNumber: 42_000_000,
        explorer: "https://testnet.arcscan.app/tx/0xef",
      } satisfies BetReceipt);
    }
    if (url.includes("/peers/register")) {
      return jsonResponse({ address: "0x0", service: "forum.markets.v0", registeredAt: 0, lastSeen: 0 });
    }

    return jsonResponse({ error: `mock: unhandled ${url}` }, 404);
  };
  return { handler, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ============================================================
// Tests
// ============================================================

describe("hashIntent", () => {
  it("is deterministic for identical inputs", () => {
    const intent = {
      marketId: fixtureMarket.id,
      outcome: 1 as const,
      shares: "1000000000000000000",
      maxCost: "520000",
      deadline: 1_700_000_000,
      agent: "0xaa80FC146954aD2f0FD669dD665439e1e6ac5b68" as `0x${string}`,
      nonce: ("0x" + "11".repeat(32)) as `0x${string}`,
    };
    expect(hashIntent(intent)).toBe(hashIntent(intent));
  });

  it("changes when any field changes", () => {
    const base = {
      marketId: fixtureMarket.id,
      outcome: 1 as const,
      shares: "1000000000000000000",
      maxCost: "520000",
      deadline: 1_700_000_000,
      agent: "0xaa80FC146954aD2f0FD669dD665439e1e6ac5b68" as `0x${string}`,
      nonce: ("0x" + "11".repeat(32)) as `0x${string}`,
    };
    expect(hashIntent(base)).not.toBe(hashIntent({ ...base, shares: "2000000000000000000" }));
    expect(hashIntent(base)).not.toBe(hashIntent({ ...base, outcome: 0 }));
    expect(hashIntent(base)).not.toBe(hashIntent({ ...base, maxCost: "999999" }));
  });
});

describe("Agent.subscribeMarkets", () => {
  it("emits 'market' event for each fetched open market, marking first as new", async () => {
    const { handler } = makeMockFetch();
    const agent = new Agent({
      wallet: privateKeyToAccount(generatePrivateKey()),
      marketApi: { baseURL: MARKET_API_BASE },
      fetchImpl: handler,
      pollIntervalMs: 100_000, // long — we only care about the first tick
    });

    const received: Array<{ marketId: string; isNew: boolean }> = [];
    agent.on("market", (e) => received.push({ marketId: e.market.id, isNew: e.isNew }));

    await agent.subscribeMarkets();
    await new Promise((r) => setTimeout(r, 50));
    agent.unsubscribeMarkets();

    expect(received).toHaveLength(1);
    expect(received[0]?.marketId).toBe(fixtureMarket.id);
    expect(received[0]?.isNew).toBe(true);
  });

  it("filters by pair when provided", async () => {
    const { handler } = makeMockFetch();
    const agent = new Agent({
      wallet: privateKeyToAccount(generatePrivateKey()),
      marketApi: { baseURL: MARKET_API_BASE },
      fetchImpl: handler,
      pollIntervalMs: 100_000,
    });

    const received: string[] = [];
    agent.on("market", (e) => received.push(e.market.pair));

    await agent.subscribeMarkets({ pair: "GBPUSD" });
    await new Promise((r) => setTimeout(r, 50));
    agent.unsubscribeMarkets();

    expect(received).toHaveLength(0); // fixture is EURUSD, filtered out
  });
});

describe("Agent.placeBet", () => {
  it("builds a valid intent, signs it, and the server-side hash + recovery matches", async () => {
    let receivedBody: unknown = null;
    const { handler } = makeMockFetch({
      onPlaceBet: (body) => {
        receivedBody = body;
        return {
          marketId: fixtureMarket.id,
          marketAddress: fixtureMarket.address,
          outcome: 1,
          shares: "1000000000000000000",
          costUsdc: "500000",
          feeUsdc: "10000",
          txHash: "0x" + "ef".repeat(32),
          blockNumber: 42_000_000,
          explorer: "ok",
        };
      },
    });
    const wallet = privateKeyToAccount(generatePrivateKey());
    const agent = new Agent({
      wallet,
      marketApi: { baseURL: MARKET_API_BASE },
      fetchImpl: handler,
    });

    const receipt = await agent.placeBet({
      marketId: fixtureMarket.id,
      outcome: 1,
      sharesWad: 1_000_000_000_000_000_000n,
    });

    expect(receipt.txHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(receivedBody).toBeTruthy();

    // Verify the SDK's intent signature recovers to the wallet that signed it.
    const r = receivedBody as { intent: Parameters<typeof hashIntent>[0]; intentSignature: `0x${string}` };
    const intentHash = hashIntent(r.intent);
    const recovered = await recoverMessageAddress({
      message: { raw: intentHash },
      signature: r.intentSignature,
    });
    expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  it("uses payTo from market-api info as authorization.to (NOT the market clone)", async () => {
    let receivedBody: unknown = null;
    const { handler } = makeMockFetch({
      onPlaceBet: (body) => {
        receivedBody = body;
        return {
          marketId: fixtureMarket.id,
          marketAddress: fixtureMarket.address,
          outcome: 1,
          shares: "1000000000000000000",
          costUsdc: "500000",
          feeUsdc: "10000",
          txHash: "0x" + "ef".repeat(32),
          blockNumber: 42_000_000,
          explorer: "ok",
        };
      },
    });
    const agent = new Agent({
      wallet: privateKeyToAccount(generatePrivateKey()),
      marketApi: { baseURL: MARKET_API_BASE },
      fetchImpl: handler,
    });

    await agent.placeBet({
      marketId: fixtureMarket.id,
      outcome: 1,
      sharesWad: 1_000_000_000_000_000_000n,
    });

    const r = receivedBody as { authorization: { to: string } };
    expect(r.authorization.to.toLowerCase()).toBe(PAYTO.toLowerCase());
    expect(r.authorization.to.toLowerCase()).not.toBe(fixtureMarket.address.toLowerCase());
  });

  it("rejects bets that exceed per-bet budget cap", async () => {
    const { handler } = makeMockFetch();
    const agent = new Agent({
      wallet: privateKeyToAccount(generatePrivateKey()),
      marketApi: { baseURL: MARKET_API_BASE },
      fetchImpl: handler,
      budget: { perBetUsdc: "0.10", dailyCapUsdc: "1.00" },
    });

    // Mock quote returns 0.51 USDC total; perBet cap = 0.10.
    await expect(
      agent.placeBet({
        marketId: fixtureMarket.id,
        outcome: 1,
        sharesWad: 1_000_000_000_000_000_000n,
      }),
    ).rejects.toThrow(BudgetExceededError);
  });

  it("rejects bets that exceed daily cap (after first bet was within perBet but cumulative exceeds)", async () => {
    const { handler } = makeMockFetch();
    const agent = new Agent({
      wallet: privateKeyToAccount(generatePrivateKey()),
      marketApi: { baseURL: MARKET_API_BASE },
      fetchImpl: handler,
      budget: { perBetUsdc: "1.00", dailyCapUsdc: "0.60" },
    });

    // First bet: 0.51 USDC — fits perBet (1.00) AND dailyCap (0.60).
    await agent.placeBet({
      marketId: fixtureMarket.id,
      outcome: 1,
      sharesWad: 1_000_000_000_000_000_000n,
    });

    // Second bet would push total to 1.02 — exceeds dailyCap.
    await expect(
      agent.placeBet({
        marketId: fixtureMarket.id,
        outcome: 1,
        sharesWad: 1_000_000_000_000_000_000n,
      }),
    ).rejects.toThrow(BudgetExceededError);
  });
});
