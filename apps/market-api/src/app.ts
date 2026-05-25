import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { keccak256, encodePacked, recoverMessageAddress, getAddress, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eq, and, asc, desc, sql, isNotNull } from "drizzle-orm";

import type { Env } from "./env.js";
import type { Deployment } from "./deployment.js";
import type { Clients } from "./chain/clients.js";
import type { DB } from "./db/index.js";
import { ForexMarketFactoryAbi } from "./chain/abi/factory.js";
import { ForexMarketAbi } from "./chain/abi/forex-market.js";
import { OutcomeTokenAbi } from "./chain/abi/outcome-token.js";
import { ResolverAbi } from "./chain/abi/resolver.js";
import { createWalletClient as createTraderWallet, http as traderHttp } from "viem";
import { signQuote, randomNonce } from "./lib/quote-signer.js";
import { markets, bets, resolutions, traderWallets, forecastTraces, agents, traceMarkets, traceBets } from "./db/schema-pg.js";
import { createHash, createHmac } from "node:crypto";
import { STRATEGIES, getStrategy } from "./lib/strategies.js";
import { arcTestnet } from "./chain/arc.js";
import { createMcpServer, handleMcpHttp } from "./mcp.js";
import { bus } from "./event-bus.js";
import { waitWithRetry } from "./lib/wait-with-retry.js";
import { sendWithReplace } from "./lib/send-with-replace.js";
import { streamSSE } from "hono/streaming";
import { generateTrader, decryptTraderPrivkey } from "./lib/trader-wallet.js";
import { detectProvider, encryptApiKey, type AiProvider } from "./lib/ai-providers.js";
import { executeBet } from "./lib/execute-bet.js";
import { withChainLock, ChainLockTimeoutError } from "./lib/chain-mutex.js";
import { createChallenge, verifyAuthHeader, signerOwnsTrader } from "./lib/auth.js";

export type AppDeps = {
  env: Env;
  deployment: Deployment;
  clients: Clients;
  db: DB;
};

const QuoteQuery = z.object({
  outcome: z.coerce.number().int().min(0).max(1),
  shares: z.string().regex(/^\d+$/, "shares must be a positive integer in WAD"),
});

const CreateMarketBody = z.object({
  question: z.string().min(8).max(256),
  pair: z.string().min(3).max(16),
  strikeWad: z.string().regex(/^\d+$/),
  comparator: z.enum(["GT", "GTE", "LT", "LTE"]),
  bWad: z.string().regex(/^\d+$/),
  opensAt: z.number().int(),
  closesAt: z.number().int(),
  subsidyUsdc: z.string().regex(/^\d+$/),
  /** Optional source identifier — "manual" default. Conventions:
   *  "manual" / "scout:bbc" / "scout:ecb" / "scout:fed" / "scout:tg:<channel>" */
  createdBy: z.string().min(1).max(64).regex(/^[a-z0-9:_-]+$/, "lowercase ascii only").optional(),
  /** Collateral asset — "USDC" (default) or "EURC". Determines which ERC20 the
   *  ForexMarket clone settles in. EURC markets bring RFB 03 alignment for the
   *  Agora hackathon (literal "USDC ↔ EURC pairing"). */
  collateral: z.enum(["USDC", "EURC"]).optional(),
});

const USDC_APPROVE_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Used for one-shot infinite USDC approval (treasury → factory / market).
// Skips per-create approve race when keeper fires multiple back-to-back creates.
const MAX_UINT256 = (1n << 256n) - 1n;

/// Minimal USDC ABI used by /bets to settle the buyer's signed EIP-3009 authorization.
const USDC_TRANSFER_WITH_AUTH_ABI = [
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    name: "transferWithAuthorization",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const HexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const Hex32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const Hex65 = z.string().regex(/^0x[a-fA-F0-9]{130}$/);

const BetIntentSchema = z.object({
  marketId: Hex32,
  outcome: z.literal(0).or(z.literal(1)),
  shares: z.string().regex(/^\d+$/),
  maxCost: z.string().regex(/^\d+$/),
  /// Unix seconds. Must be in the future and within 10 minutes of now —
  /// blocks indefinite-lifetime replay of stale signed intents.
  deadline: z.number().int().positive(),
  agent: HexAddress,
  nonce: Hex32,
});

const Eip3009AuthorizationSchema = z.object({
  from: HexAddress,
  to: HexAddress,
  value: z.string().regex(/^\d+$/),
  validAfter: z.number().int(),
  validBefore: z.number().int(),
  nonce: Hex32,
  v: z.number().int(),
  r: Hex32,
  s: Hex32,
  signature: Hex65,
});

const PlaceBetBody = z.object({
  intent: BetIntentSchema,
  intentSignature: Hex65,
  authorization: Eip3009AuthorizationSchema,
});

/// Strip encrypted-at-rest secrets from an agents-row before serializing in API
/// responses. Replaces ciphertext fields with a boolean `aiHasKey` so the UI
/// can show a "key set" badge without ever shipping the wrapped key.
function redactAgent<T extends {
  aiApiKeyEncrypted?: string | null;
  aiKeyIv?: string | null;
  aiKeyAuthTag?: string | null;
}>(row: T): Omit<T, "aiApiKeyEncrypted" | "aiKeyIv" | "aiKeyAuthTag"> & { aiHasKey: boolean } {
  const { aiApiKeyEncrypted, aiKeyIv, aiKeyAuthTag, ...rest } = row;
  return { ...rest, aiHasKey: !!aiApiKeyEncrypted };
}

/// Re-create the intent hash exactly as the SDK does. Verifier compares against
/// recovered signer to validate the agent's signature over the bet intent.
function packIntentHash(intent: z.infer<typeof BetIntentSchema>): `0x${string}` {
  return keccak256(
    encodePacked(
      ["bytes32", "uint8", "uint256", "uint256", "uint64", "address", "bytes32"],
      [
        intent.marketId as `0x${string}`,
        intent.outcome,
        BigInt(intent.shares),
        BigInt(intent.maxCost),
        BigInt(intent.deadline),
        intent.agent as `0x${string}`,
        intent.nonce as `0x${string}`,
      ],
    ),
  );
}

export function createApp(deps: AppDeps): Hono {
  const { env, deployment, clients, db } = deps;
  const app = new Hono();

  app.use("*", logger());
  app.use("*", requestId());

  /// P2-B-002 — wildcard CORS replaced with an allowlist. forum.auranode.xyz
  /// is the production console host; localhost entries cover dev console
  /// (8404, 3001) and let the forum-keeper local probes through. Same-origin
  /// requests (no Origin header) are allowed so server-side fetches from
  /// 127.0.0.1 (forum-keeper, personas runner, examples scripts) don't fail.
  const CORS_ALLOWLIST = new Set([
    "https://forum.auranode.xyz",
    "http://localhost:8404",
    "http://localhost:3001",
    "http://127.0.0.1:8404",
    "http://127.0.0.1:3001",
  ]);
  app.use("*", cors({
    origin: (origin) => {
      if (!origin) return ""; // same-origin / non-browser callers
      return CORS_ALLOWLIST.has(origin) ? origin : null;
    },
    allowHeaders: ["Content-Type", "X-PAYMENT", "X-Auth-Signature", "X-Auth-Nonce", "X-Runner-Secret", "x-admin-secret"],
  }));

  /// P2-B-005 / P2-F-003 — wrap a server-side error so the response never
  /// leaks raw `err.message`. Logs the full stack keyed by requestId for
  /// post-incident forensics.
  function logAndThrow(c: import("hono").Context, status: 400 | 401 | 402 | 403 | 404 | 409 | 500 | 502 | 503, message: string, err: unknown): never {
    const rid = c.get("requestId") ?? "no-rid";
    if (err) console.error(`[market-api/${rid}] ${message}:`, err);
    throw new HTTPException(status, { message: status >= 500 ? `${message} · request_id=${rid}` : message });
  }

  /// P0-B-001..009 — gate every privileged trader endpoint with the EIP-712
  /// challenge-response identity check. Looks up the trader_wallets row and
  /// asserts the X-Auth-Signature recovers to either the trader's own EOA
  /// (server-side runners) OR the bound owner_wallet (Dynamic UI flow).
  async function requireTraderAuth(
    c: import("hono").Context,
    traderAddress: string,
  ): Promise<void> {
    const targetAddr = traderAddress.toLowerCase();
    const row = (await db.select().from(traderWallets).where(eq(traderWallets.address, targetAddr)))[0];
    if (!row) throw new HTTPException(404, { message: "trader wallet not found" });

    // Server-side runner shortcut — when X-Runner-Secret matches the env var,
    // skip the EIP-712 round-trip. The runner is the only caller that should
    // ever have this secret (forum-personas process env). See
    // RUNNER_AUTH_SECRET in env.ts for the threat-model rationale.
    if (env.RUNNER_AUTH_SECRET) {
      const supplied = c.req.header("x-runner-secret");
      if (supplied && supplied === env.RUNNER_AUTH_SECRET) return;
    }

    // Personas don't have their own owner_wallet — they're owned by another
    // trader. Walk one hop: if `traderAddress` is a persona (agents row with
    // owner_identity → another trader_wallets row), also accept a signature
    // from that owner's bound wallet. This lets users withdraw from their
    // own personas via the Dynamic-signed challenge.
    let ownerHopWallet: string | null = null;
    const agentRow = (await db.select().from(agents).where(eq(agents.address, targetAddr)))[0];
    if (agentRow?.ownerIdentity && agentRow.ownerIdentity !== targetAddr) {
      const ownerRow = (await db.select().from(traderWallets).where(eq(traderWallets.address, agentRow.ownerIdentity)))[0];
      ownerHopWallet = ownerRow?.ownerWallet?.toLowerCase() ?? null;
    }

    const nonce = c.req.header("x-auth-nonce") ?? c.req.header("X-Auth-Nonce");
    const sig = c.req.header("x-auth-signature") ?? c.req.header("X-Auth-Signature");
    const result = await verifyAuthHeader({
      traderAddress: targetAddr,
      nonce,
      signature: sig,
      chainId: env.ARC_CHAIN_ID,
    });
    if (!result.ok) {
      throw new HTTPException(result.status, { message: result.message });
    }
    const directlyOwns = signerOwnsTrader({
      signer: result.signer,
      traderAddress: targetAddr,
      ownerWallet: row.ownerWallet ?? null,
    });
    const ownerHopMatches = ownerHopWallet !== null && result.signer === ownerHopWallet;
    if (!directlyOwns && !ownerHopMatches) {
      throw new HTTPException(401, {
        message: "signer not authorized for this trader address",
      });
    }
  }

  /// Cheap per-IP rate limit: rolling token bucket per scope. Used by
  /// publicly-callable endpoints where we pay gas (cctp/receive, faucet).
  /// In-memory only — restart clears state. Good enough for a hackathon
  /// testnet; a real deploy would use Redis or a CDN edge limiter.
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  function checkRateLimit(c: import("hono").Context, scope: string, max: number, windowMs: number): void {
    // Server-side runners (personas, rental-orchestrator, scout, keeper,
    // translator) all hit market-api from 127.0.0.1, so they share one
    // bucket per scope. Without this bypass the combined load of 9+
    // agents would exhaust a "30/min per IP" cap in seconds. Treat the
    // shared runner secret as proof-of-trust and skip throttling.
    if (env.RUNNER_AUTH_SECRET) {
      const supplied = c.req.header("x-runner-secret");
      if (supplied && supplied === env.RUNNER_AUTH_SECRET) return;
    }
    const ip = (c.req.header("x-forwarded-for") ?? "local").split(",")[0]!.trim();
    const key = `${scope}::${ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (bucket.count >= max) {
      throw new HTTPException(429, {
        message: `rate limit: max ${max} per ${Math.round(windowMs / 1000)}s for ${scope}`,
      });
    }
    bucket.count += 1;
  }

  /// Gate admin-only endpoints (market creation, batch ops) behind the
  /// shared runner secret. Same `RUNNER_AUTH_SECRET` env used by the
  /// persona/rental runners — they already ship with it loaded; UI callers
  /// never do. Throws 401 if the header is missing or wrong, 500 if the
  /// env var itself isn't configured (production must set it).
  function requireAdminSecret(c: import("hono").Context): void {
    if (!env.RUNNER_AUTH_SECRET) {
      throw new HTTPException(500, {
        message: "server misconfigured: admin endpoint requires RUNNER_AUTH_SECRET",
      });
    }
    const supplied = c.req.header("x-runner-secret");
    if (!supplied || supplied !== env.RUNNER_AUTH_SECRET) {
      throw new HTTPException(401, { message: "admin auth required" });
    }
  }

  // ============================================================
  // Auth — EIP-712 challenge-response (P0-B-001..009)
  // ============================================================
  //
  // Flow:
  //   1. Client POST /auth/challenge with `{ identity: "0x<trader-addr>" }`.
  //   2. Server returns `{ nonce, expiresAt }` (5min TTL).
  //   3. Client signs typedData `{ identity, nonce, expiresAt }` with EITHER:
  //      a) the owner wallet bound at /traders/issue (console UI path), OR
  //      b) the trader privkey itself (forum-personas runner path).
  //   4. Client retries the privileged endpoint with
  //      `X-Auth-Nonce: 0x<nonce>` + `X-Auth-Signature: 0x<sig>`.
  //   5. Server recovers signer, compares against (trader address, owner_wallet),
  //      and rejects with 401 if mismatch.

  app.post("/auth/challenge", async (c) => {
    const body = await c.req.json().catch(() => null);
    const Schema = z.object({ identity: HexAddress });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { nonce, expiresAt } = createChallenge(parsed.data.identity);
    return c.json({
      identity: parsed.data.identity.toLowerCase(),
      nonce,
      expiresAt,
      chainId: env.ARC_CHAIN_ID,
      domain: { name: "FORUM market-api", version: "1", chainId: env.ARC_CHAIN_ID },
      primaryType: "AuthChallenge",
      types: {
        AuthChallenge: [
          { name: "identity", type: "address" },
          { name: "nonce", type: "bytes32" },
          { name: "expiresAt", type: "uint256" },
        ],
      },
    });
  });

  // ============================================================
  // Info / health
  // ============================================================

  app.get("/", (c) =>
    c.json({
      name: "FORUM market-api",
      version: "0.1.0",
      chainId: env.ARC_CHAIN_ID,
      facilitator: env.CIRCLE_GATEWAY_FACILITATOR_URL,
      /// Address agents should set as `authorization.to` in EIP-3009 transferWithAuthorization.
      /// The market-api wallet acts as a settle-then-forward relay: it receives buyer's USDC,
      /// approves the market clone, and calls buyShares from itself. v0.2 routes via Circle
      /// Gateway batched settlement instead.
      payTo: clients.account.address,
      contracts: {
        forexMarketFactory: deployment.forexMarketFactory,
        outcomeToken: deployment.outcomeToken,
        resolver: deployment.resolver,
        agentRegistry: deployment.agentRegistry,
      },
      /// Demo affordance — when FORUM_DEMO_MIMO_KEY env is set, the
      /// PersonaAiDrawer surfaces a "Use FORUM's shared MiMo key" toggle so
      /// the Agora demo doesn't require a live API key paste. Capped server-
      /// side at 10 forecasts/day (M13 enforcement TBD; sentinel only at v0.1).
      demoMimoEnabled: !!process.env["FORUM_DEMO_MIMO_KEY"],
    }),
  );

  /// Aggregated protocol economics. Reads from DB (markets + bets) and on-chain
  /// (USDC balance of the treasury wallet). Powers the landing-page revenue
  /// banner — "FORUM has collected X USDC across N markets, all agent-driven".
  ///
  /// Fields:
  ///   treasuryAddress   — market-api wallet (where bet fees pool until withdrawn)
  ///   treasuryBalance   — current USDC balance on-chain (base units, 6 decimals)
  ///   totalFeesAccrued  — sum of feeAccrued across every market (active + resolved)
  ///   totalVolume       — sum of cost+fee across every settled bet
  ///   totalCollateral   — sum of collateralEscrowed across markets (live + locked)
  ///   marketsTotal/open/resolved — phase counts (DB enum: 0=open 1=closed 2=resolved)
  ///   betCount          — total bets ever settled
  ///   agentCount        — distinct addresses that have placed a bet
  /// Institutional audit trail — every resolved market with the full chain
  /// from "Will EUR/USD ≥ X at T?" through ECB date + rate, dataHash,
  /// resolver tx, and Resolver.admin() signer. Designed for the
  /// /protocol/compliance UI: judges + institutions can grep a single
  /// JSON response to verify the protocol's "deterministic, attested,
  /// publicly auditable" claim without scanning Arcscan one tx at a time.
  app.get("/protocol/audit-trail", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
    const rows = ((await db.execute(sql`
      SELECT
        m.id              AS market_id,
        m.address         AS market_address,
        m.question        AS question,
        m.pair            AS pair,
        m.strike_wad      AS strike_wad,
        m.comparator      AS comparator,
        m.closes_at       AS closes_at,
        m.created_at      AS created_at,
        m.created_by      AS created_by,
        r.outcome         AS outcome,
        r.data_hash       AS data_hash,
        r.source          AS source,
        r.signer          AS signer,
        r.tx_hash         AS tx_hash,
        r.resolved_at     AS resolved_at,
        r.ecb_date        AS ecb_date,
        r.ecb_rate        AS ecb_rate
      FROM markets m
      INNER JOIN resolutions r ON r.market_id = m.id
      WHERE m.phase = 2
      ORDER BY r.resolved_at DESC
      LIMIT ${limit}
    `)) as unknown as Array<{
      market_id: string;
      market_address: string;
      question: string;
      pair: string;
      strike_wad: string;
      comparator: string;
      closes_at: number;
      created_at: number;
      created_by: string;
      outcome: number;
      data_hash: string;
      source: string;
      signer: string;
      tx_hash: string;
      resolved_at: number;
      ecb_date: string | null;
      ecb_rate: string | null;
    }>);
    return c.json({
      count: rows.length,
      generatedAt: Math.floor(Date.now() / 1000),
      // Public commitments the trail attests to. Keeps the surface
      // self-describing for institutional consumers who haven't read
      // the README first.
      commitments: {
        deterministicFinality:
          "Every row's tx_hash is on Arc Testnet (chain 5042002). resolved_at is the L1 block timestamp; finality is deterministic.",
        attestedSource:
          "source = 'ECB' indicates the rate was pulled from Frankfurter's mirror of the ECB Statistical Data Warehouse. ecb_date is the exact publication date used.",
        signedResolution:
          "signer is the EIP-712 signer of the Resolution envelope. Resolver.admin() on-chain must match for resolve() to accept the call.",
        auditability:
          "data_hash = keccak256('ECB', date, rateWad). Anyone can independently recompute it from the public ECB rate + market strike.",
      },
      rows: rows.map((r) => ({
        marketId: r.market_id,
        marketAddress: r.market_address,
        question: r.question,
        pair: r.pair,
        strikeWad: r.strike_wad,
        comparator: r.comparator,
        closesAt: r.closes_at,
        createdAt: r.created_at,
        createdBy: r.created_by,
        outcome: r.outcome,
        dataHash: r.data_hash,
        source: r.source,
        signer: r.signer,
        txHash: r.tx_hash,
        resolvedAt: r.resolved_at,
        ecbDate: r.ecb_date,
        ecbRate: r.ecb_rate,
      })),
    });
  });

  app.get("/protocol/stats", async (c) => {
    // SQL-level aggregation to keep this endpoint O(1) rows regardless of
    // how many markets/bets exist. The landing page hits this on every
    // visit, so full table scans here are not acceptable.
    const marketStats = ((await db.execute(sql`
      SELECT
        COUNT(*)::int                                   AS total,
        SUM(CASE WHEN phase = 0 THEN 1 ELSE 0 END)::int AS open_count,
        SUM(CASE WHEN phase = 1 THEN 1 ELSE 0 END)::int AS closed_count,
        SUM(CASE WHEN phase = 2 THEN 1 ELSE 0 END)::int AS resolved_count,
        COALESCE(SUM(fee_accrued::numeric), 0)::text    AS fees_accrued,
        COALESCE(SUM(collateral_escrowed::numeric), 0)::text AS collateral_escrowed
      FROM markets
    `)) as unknown as Array<{
      total: number;
      open_count: number;
      closed_count: number;
      resolved_count: number;
      fees_accrued: string;
      collateral_escrowed: string;
    }>)[0];

    const betStats = ((await db.execute(sql`
      SELECT
        COALESCE(SUM(cost_usdc::numeric + fee_usdc::numeric), 0)::text AS total_volume,
        COUNT(DISTINCT agent_address)::int                              AS unique_agents
      FROM bets
    `)) as unknown as Array<{
      total_volume: string;
      unique_agents: number;
    }>)[0];

    const totalFeesAccrued = BigInt(marketStats?.fees_accrued ?? "0");
    const totalCollateral = BigInt(marketStats?.collateral_escrowed ?? "0");
    const marketsOpen = marketStats?.open_count ?? 0;
    const marketsClosed = marketStats?.closed_count ?? 0;
    const marketsResolved = marketStats?.resolved_count ?? 0;
    const marketsTotal = marketStats?.total ?? 0;
    const totalVolume = BigInt(betStats?.total_volume ?? "0");

    let treasuryBalance = "0";
    try {
      const bal = (await clients.publicClient.readContract({
        address: env.ARC_USDC as `0x${string}`,
        abi: [
          {
            inputs: [{ name: "account", type: "address" }],
            name: "balanceOf",
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
            type: "function",
          },
        ] as const,
        functionName: "balanceOf",
        args: [clients.account.address],
      })) as bigint;
      treasuryBalance = bal.toString();
    } catch {
      // network blip — return 0 rather than 5xx, balance is for display only
    }

    return c.json({
      treasuryAddress: clients.account.address,
      treasuryBalance,
      totalFeesAccrued: totalFeesAccrued.toString(),
      totalVolume: totalVolume.toString(),
      totalCollateral: totalCollateral.toString(),
      marketsTotal,
      marketsOpen,
      marketsClosed,
      marketsResolved,
      betCount: (await db.execute(sql`SELECT COUNT(*)::int AS c FROM bets`) as unknown as Array<{ c: number }>)[0]?.c ?? 0,
      agentCount: betStats?.unique_agents ?? 0,
      chainId: env.ARC_CHAIN_ID,
    });
  });

  app.get("/health", async (c) => {
    let onchainOk = false;
    let totalMarkets: string | null = null;
    try {
      const result = (await clients.publicClient.readContract({
        address: deployment.forexMarketFactory as `0x${string}`,
        abi: ForexMarketFactoryAbi,
        functionName: "totalMarkets",
      })) as bigint;
      totalMarkets = result.toString();
      onchainOk = true;
    } catch {
      // Liveness still ok; flag onchain as down.
    }
    return c.json({
      ok: true,
      timestamp: Math.floor(Date.now() / 1000),
      onchain: onchainOk,
      totalMarkets,
    });
  });

  // ============================================================
  // Markets
  // ============================================================

  /// SSE event stream — clients subscribe via `new EventSource("/events")`. We
  /// push every market.created, bet.placed, market.resolved event the moment it
  /// fires. No replay buffer in v0.1 — clients only see future events.
  ///
  /// Keepalive: a comment frame every 25s to defeat proxy idle timeouts.
  app.get("/events", (c) => {
    return streamSSE(c, async (stream) => {
      // Initial "ready" frame so clients know they're connected.
      await stream.writeSSE({
        event: "ready",
        data: JSON.stringify({ ts: Math.floor(Date.now() / 1000) }),
      });

      const unsubscribe = bus.subscribe((event) => {
        // Hono SSE writes return a Promise; we deliberately don't await inside
        // the synchronous emitter callback. Lost frames on backpressure are
        // acceptable for a UX-only feed.
        stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        }).catch(() => {
          /* client disconnected mid-write — cleanup happens via stream.onAbort */
        });
      });

      // Keepalive ping every 25s. Comments (lines starting with `:`) are
      // ignored by EventSource but keep the TCP connection warm through
      // Cloudflare / nginx idle cutoffs.
      const keepalive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "" }).catch(() => {});
      }, 25_000);

      stream.onAbort(() => {
        clearInterval(keepalive);
        unsubscribe();
      });

      // Block until the client disconnects. Hono's streamSSE returns when
      // the async function resolves, so we await indefinitely.
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    });
  });

  app.get("/markets", async (c) => {
    const status = c.req.query("status");
    let rows = await db.select().from(markets);
    // "open" must also exclude markets whose closesAt is already in the past —
    // otherwise the UI lists them as LIVE while every bet attempt reverts
    // on-chain with WrongPhase() because the contract considers them CLOSED.
    // (The resolver eventually transitions phase 0 → 1, but until then the DB
    // row lies about market state.)
    const nowSec = Math.floor(Date.now() / 1000);
    if (status === "open") {
      rows = rows.filter((r) => r.phase === 0 && r.closesAt > nowSec);
    } else if (status === "closed") {
      // Include both phase=1 AND phase=0-but-closesAt-passed so the UI's
      // "closed" tab covers everything that's no longer biddable.
      rows = rows.filter((r) => r.phase === 1 || (r.phase === 0 && r.closesAt <= nowSec));
    } else if (status === "resolved") {
      rows = rows.filter((r) => r.phase === 2);
    }
    return c.json({ count: rows.length, markets: rows });
  });

  /// Compute Honos reputation v0 from settled bets joined on resolutions.
  /// Score formula: each correct bet adds +size weighting, each wrong bet
  /// subtracts. Tiebreak by recency. The on-chain Honos contract lands in
  /// M2; this provides the SAME interface from the DB so the UI can
  /// already display "Honos score · rank X of Y" today.
  async function computeHonos(address: string): Promise<{
    score: number; wins: number; losses: number; settled: number;
  }> {
    const settled = ((await db.execute(sql`
      SELECT b.cost_usdc, b.outcome, r.outcome AS winning_outcome
      FROM bets b
      INNER JOIN resolutions r ON r.market_id = b.market_id
      WHERE b.agent_address = ${address}
    `)) as unknown as {
      cost_usdc: string; outcome: number; winning_outcome: number | null;
    }[]);
    let score = 0, wins = 0, losses = 0;
    for (const row of settled) {
      // INVALID resolutions (outcome = 2) don't move score
      if (row.winning_outcome === 2 || row.winning_outcome === null) continue;
      const weight = Math.log10(1 + Number(row.cost_usdc) / 1_000_000);
      if (row.outcome === row.winning_outcome) { wins++; score += weight * 10; }
      else { losses++; score -= weight * 6; }
    }
    return { score: Math.round(score), wins, losses, settled: wins + losses };
  }

  async function honosLeaderboard(): Promise<Array<{
    address: string; score: number; wins: number; losses: number;
  }>> {
    const all = ((await db.execute(
      sql`SELECT DISTINCT agent_address FROM bets`
    )) as unknown as { agent_address: string }[]);
    const scored = await Promise.all(all.map(async (r) => {
      const h = await computeHonos(r.agent_address);
      return { address: r.agent_address, ...h };
    }));
    return scored
      .filter((r) => r.wins + r.losses > 0)
      .sort((a, b) => b.score - a.score);
  }

  /// Honos reputation leaderboard — all agents ranked by lifetime score.
  /// v0: DB-derived. M2: Honos contract becomes source of truth.
  app.get("/agents/leaderboard", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
    const board = await honosLeaderboard();
    return c.json({
      count: 0,
      leaderboard: board.slice(0, limit).map((r, i) => ({
        rank: i + 1,
        address: r.address,
        score: r.score,
        wins: r.wins,
        losses: r.losses,
        winRate: (r.wins + r.losses) > 0
          ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
          : null,
      })),
    });
  });

  /// GET /agents/custom
  /// All spawned personas (rows with owner_identity NOT NULL). The
  /// persona-runner polls this every ~30s and runs the appropriate
  /// strategy loop for each. Public so anyone can audit the active
  /// persona zoo.
  ///
  /// M13 — `configPending` flag is true when ai_api_key_encrypted IS NULL.
  /// The runner uses this to skip personas that can't operate (no LLM key
  /// set). Per the M13 spec "persona MUST have LLM key to be operational"
  /// — the "SHARED_DEMO" sentinel value counts as a configured key.
  app.get("/agents/custom", async (c) => {
    // Use Drizzle ORM (portable across sqlite/pg) instead of raw db.execute
    // — postgres-js's execute returns a result shape different from sqlite's
    // polyfill, and the cast-to-array breaks on pg.
    const rows = await db
      .select({
        address: agents.address,
        owner_identity: agents.ownerIdentity,
        persona_label: agents.personaLabel,
        strategy_id: agents.strategyId,
        verified: agents.verified,
        registered_at: agents.registeredAt,
        ai_api_key_encrypted: agents.aiApiKeyEncrypted,
      })
      .from(agents)
      .where(isNotNull(agents.ownerIdentity))
      .orderBy(desc(agents.registeredAt));
    // Redact the encrypted key from the public response — only surface a
    // boolean `configPending` flag derived from its presence/absence.
    const redacted = rows.map((r) => {
      const { ai_api_key_encrypted, ...rest } = r;
      return { ...rest, configPending: !ai_api_key_encrypted };
    });
    return c.json({ count: redacted.length, agents: redacted });
  });

  /// Per-agent profile + lifetime activity. Public, read-only.
  app.get("/agents/:address", async (c) => {
    const address = c.req.param("address").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw new HTTPException(400, { message: "address must be 0x + 40 hex" });
    }
    const allBets = await db
      .select()
      .from(bets)
      .where(eq(bets.agentAddress, address))
      .orderBy(desc(bets.id));
    const totalVolumeUsdc = allBets.reduce(
      (acc, b) => acc + BigInt(b.costUsdc) + BigInt(b.feeUsdc),
      0n,
    );
    const yesCount = allBets.filter((b) => b.outcome === 1).length;
    const noCount = allBets.length - yesCount;
    const honos = await computeHonos(address);
    const leaderboard = await honosLeaderboard();
    const rank = leaderboard.findIndex((r) => r.address === address);
    const agentRow = (await db.select().from(agents).where(eq(agents.address, address)))[0];
    return c.json({
      address,
      betCount: allBets.length,
      yesCount,
      noCount,
      totalVolumeUsdc: totalVolumeUsdc.toString(),
      firstBetAt: allBets[allBets.length - 1]?.createdAt ?? null,
      lastBetAt: allBets[0]?.createdAt ?? null,
      bets: allBets,
      honos: {
        score: honos.score,
        wins: honos.wins,
        losses: honos.losses,
        settled: honos.settled,
        rank: rank >= 0 ? rank + 1 : null,
        rankOf: leaderboard.length,
        winRate: honos.settled > 0
          ? Number((honos.wins / honos.settled).toFixed(3))
          : null,
      },
      // M6 — persona fields for owner-side edit UI and renter-side
      // marketplace cards. Default agents (no row in `agents`) return null.
      // M13 — AI config surfaced as hasKey/provider/baseUrl/model. The
      // encrypted key itself is NEVER returned by any endpoint.
      persona: agentRow ? {
        name: agentRow.name,
        personaLabel: agentRow.personaLabel,
        strategyId: agentRow.strategyId,
        avatarEmoji: agentRow.avatarEmoji,
        ownerIdentity: agentRow.ownerIdentity,
        verified: agentRow.verified === 1,
        kind: agentRow.kind,
        ai: {
          provider: agentRow.aiProvider ?? null,
          baseUrl: agentRow.aiBaseUrl ?? null,
          model: agentRow.aiModel ?? null,
          hasKey: !!agentRow.aiApiKeyEncrypted,
        },
      } : null,
    });
  });

  /// ══════════════════════════════════════════════════════════════════
  /// M8 — Nanopayments-powered-by-Gateway · pay-per-call agent insights
  /// ══════════════════════════════════════════════════════════════════
  /// Real x402 HTTP 402 negotiation. Buyer signs an EIP-3009 transfer
  /// authorization (the same primitive Circle Nanopayments is built on),
  /// market-api verifies + settles immediately on Arc, returns premium
  /// agent insights. M8.1 swaps immediate settle for Gateway-batched
  /// settle once the Circle Nanopayments SDK lands on npm.
  ///
  /// Flow:
  ///   1. GET /agents/:addr/insights  (no X-PAYMENT header)
  ///      → 402 Payment Required
  ///      → body: { x402: { scheme: "exact", network: "arc-testnet",
  ///                        asset: ARC_USDC, amount: "1000",
  ///                        payTo: <treasury>, validBefore: <unix+600>,
  ///                        nonce: <bytes32>, typedData: { ... } } }
  ///   2. Buyer signs the EIP-712 typed data and resends with header:
  ///      X-PAYMENT: base64(json({ from, v, r, s, validAfter, validBefore, nonce }))
  ///   3. Market-api verifies sig matches `from`, broadcasts USDC.
  ///      transferWithAuthorization, then returns the premium payload.
  ///
  /// Price: 0.001 USDC. Owner-free pass: buyer == agent owner_identity.

  const INSIGHTS_PRICE_USDC_BASE_UNITS = 1_000n; // 0.001 USDC

  type X402Payment = {
    from: `0x${string}`;
    validAfter: string;
    validBefore: string;
    nonce: `0x${string}`;
    v: number;
    r: `0x${string}`;
    s: `0x${string}`;
  };

  function buildX402Challenge(args: {
    payTo: `0x${string}`;
    amountBaseUnits: bigint;
    resourcePath: string;
  }) {
    const validAfter = Math.floor(Date.now() / 1000) - 60;
    const validBefore = Math.floor(Date.now() / 1000) + 600;
    const nonce = randomNonce();
    return {
      x402Version: 1,
      scheme: "exact" as const,
      network: "arc-testnet" as const,
      maxAmountRequired: args.amountBaseUnits.toString(),
      asset: env.ARC_USDC,
      payTo: args.payTo,
      resource: args.resourcePath,
      description:
        "Premium agent insights. Settles via gasless USDC EIP-3009 — the same primitive Circle Nanopayments runs on.",
      mimeType: "application/json",
      maxTimeoutSeconds: 600,
      extra: {
        validAfter,
        validBefore,
        nonce,
        typedData: {
          domain: {
            name: "USDC",
            version: "2",
            chainId: env.ARC_CHAIN_ID,
            verifyingContract: env.ARC_USDC,
          },
          primaryType: "TransferWithAuthorization",
          types: {
            TransferWithAuthorization: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "validAfter", type: "uint256" },
              { name: "validBefore", type: "uint256" },
              { name: "nonce", type: "bytes32" },
            ],
          },
          message: {
            to: args.payTo,
            value: args.amountBaseUnits.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce,
          },
        },
      },
    };
  }

  function parseX402PaymentHeader(value: string | undefined): X402Payment | null {
    if (!value) return null;
    try {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      const parsed = JSON.parse(decoded) as Partial<X402Payment>;
      if (
        typeof parsed.from === "string"
        && typeof parsed.validAfter === "string"
        && typeof parsed.validBefore === "string"
        && typeof parsed.nonce === "string"
        && typeof parsed.v === "number"
        && typeof parsed.r === "string"
        && typeof parsed.s === "string"
      ) {
        return parsed as X402Payment;
      }
    } catch {
      // fall through
    }
    return null;
  }

  /// GET /agents/:addr/insights
  /// Premium per-agent stats. Free for the agent's owner_identity wallet;
  /// 0.001 USDC nanopayment for everyone else.
  app.get("/agents/:address/insights", async (c) => {
    const address = c.req.param("address").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw new HTTPException(400, { message: "address must be 0x + 40 hex" });
    }
    const agentRow = (await db.select().from(agents).where(eq(agents.address, address)))[0];
    if (!agentRow) throw new HTTPException(404, { message: "agent not found" });

    // P1-B-001 — the previous owner-free-pass via x-caller header was
    // unauthenticated (anyone could set the header). Removed: every caller
    // (including owners) must pay the x402 nanopayment, OR go through the
    // gated POST /traders/:trader/unlock-insights helper which proves
    // ownership via EIP-712 before serving the payload.
    const paymentHeader = c.req.header("x-payment") ?? c.req.header("X-PAYMENT");
    const payment = parseX402PaymentHeader(paymentHeader);

    if (!payment) {
      const challenge = buildX402Challenge({
        payTo: clients.account.address,
        amountBaseUnits: INSIGHTS_PRICE_USDC_BASE_UNITS,
        resourcePath: `/agents/${address}/insights`,
      });
      c.header("WWW-Authenticate", `Bearer realm="x402", scheme="exact"`);
      return c.json(
        {
          error: "Payment required",
          x402: challenge,
          note: "Sign extra.typedData with EIP-712 and resend with X-PAYMENT header set to base64(json({ from, v, r, s, validAfter, validBefore, nonce })).",
        },
        402,
      );
    }

    let settledTx: `0x${string}` | null = null;
    {
      try {
        const tx = await withChainLock(async () => {
          const h = await clients.walletClient.writeContract({
            chain: arcTestnet,
            account: clients.account,
            address: env.ARC_USDC as `0x${string}`,
            abi: USDC_TRANSFER_WITH_AUTH_ABI,
            functionName: "transferWithAuthorization",
            args: [
              payment.from,
              clients.account.address,
              INSIGHTS_PRICE_USDC_BASE_UNITS,
              BigInt(payment.validAfter),
              BigInt(payment.validBefore),
              payment.nonce,
              payment.v,
              payment.r,
              payment.s,
            ],
          });
          await waitWithRetry(clients.publicClient, h);
          return h;
        });
        settledTx = tx;
      } catch (err) {
        throw new HTTPException(402, {
          message: `payment settle failed: ${(err as Error).message.slice(0, 200)}`,
        });
      }
    }

    // Build the premium payload — beefed-up demo-grade stats. Stays well
    // under 5 kB by capping recent-bets to 10 and trace snippets to 3.
    const allBets = await db
      .select()
      .from(bets)
      .where(eq(bets.agentAddress, address))
      .orderBy(desc(bets.id));
    const honos = await computeHonos(address);
    const leaderboard = await honosLeaderboard();
    const rank = leaderboard.findIndex((r) => r.address === address);
    const totalVolume = allBets.reduce(
      (acc, b) => acc + BigInt(b.costUsdc) + BigInt(b.feeUsdc),
      0n,
    );
    const avgBetSize = allBets.length === 0
      ? "0"
      : (totalVolume / BigInt(allBets.length)).toString();

    // Settled-bet roll-up — join bets ⨯ resolutions to compute win-rate
    // buckets (24h / 7d / lifetime), realized P&L per market, signal
    // correlation, and current streak. INVALID resolutions (outcome=2)
    // are skipped because they refund stake without a win/loss signal.
    const settledRows = ((await db.execute(sql`
      SELECT b.cost_usdc, b.fee_usdc, b.shares_wad, b.outcome, b.market_id, b.created_at,
             r.outcome AS winning_outcome
      FROM bets b
      INNER JOIN resolutions r ON r.market_id = b.market_id
      WHERE b.agent_address = ${address}
      ORDER BY b.created_at DESC
    `)) as unknown as {
      cost_usdc: string;
      fee_usdc: string;
      shares_wad: string;
      outcome: number;
      market_id: string;
      created_at: number;
      winning_outcome: number | null;
    }[]);
    const nowTs = Math.floor(Date.now() / 1000);
    const cutoff24h = nowTs - 24 * 60 * 60;
    const cutoff7d = nowTs - 7 * 24 * 60 * 60;
    const counters = {
      lifetime: { wins: 0, settled: 0 },
      d7: { wins: 0, settled: 0 },
      d1: { wins: 0, settled: 0 },
    };
    // Per-market P&L: settled bets only. Win → +sharesUsdc (each share pays 1
    // USDC); Lose → -(cost+fee). INVALID rows refund and are skipped.
    const pnlByMarket = new Map<string, bigint>();
    let pnlTotal = 0n;
    let correctSignal = 0;
    // Streak — count most-recent contiguous wins (positive) or losses
    // (negative). Resets at the first INVALID or once direction flips.
    let streak = 0;
    let streakStillRunning = true;
    for (const row of settledRows) {
      if (row.winning_outcome === 2 || row.winning_outcome === null) {
        streakStillRunning = false;
        continue;
      }
      const isWin = row.outcome === row.winning_outcome;
      counters.lifetime.settled++;
      if (isWin) counters.lifetime.wins++;
      if (row.created_at >= cutoff7d) {
        counters.d7.settled++;
        if (isWin) counters.d7.wins++;
      }
      if (row.created_at >= cutoff24h) {
        counters.d1.settled++;
        if (isWin) counters.d1.wins++;
      }
      if (isWin) correctSignal++;
      const cost = BigInt(row.cost_usdc) + BigInt(row.fee_usdc);
      const payoutIfWin = BigInt(row.shares_wad) / 10n ** 12n; // WAD → USDC base units
      const pnl = isWin ? payoutIfWin - cost : -cost;
      pnlByMarket.set(row.market_id, (pnlByMarket.get(row.market_id) ?? 0n) + pnl);
      pnlTotal += pnl;
      if (streakStillRunning) {
        if (streak === 0) streak = isWin ? 1 : -1;
        else if ((streak > 0 && isWin) || (streak < 0 && !isWin)) streak += isWin ? 1 : -1;
        else streakStillRunning = false;
      }
    }
    // Top-5 markets by absolute P&L for the breakdown grid.
    const pnlBreakdown = [...pnlByMarket.entries()]
      .map(([marketId, pnl]) => ({ marketId, pnlUsdc: pnl.toString() }))
      .sort((a, b) => {
        const av = BigInt(a.pnlUsdc); const bv = BigInt(b.pnlUsdc);
        const absA = av < 0n ? -av : av; const absB = bv < 0n ? -bv : bv;
        return absA > absB ? -1 : absA < absB ? 1 : 0;
      })
      .slice(0, 5);

    // Most-bet market — highest cumulative cost+fee volume.
    const volumeByMarket = new Map<string, bigint>();
    for (const b of allBets) {
      const v = BigInt(b.costUsdc) + BigInt(b.feeUsdc);
      volumeByMarket.set(b.marketId, (volumeByMarket.get(b.marketId) ?? 0n) + v);
    }
    let mostBetMarket: { marketId: string; volumeUsdc: string } | null = null;
    for (const [mid, v] of volumeByMarket) {
      if (!mostBetMarket || v > BigInt(mostBetMarket.volumeUsdc)) {
        mostBetMarket = { marketId: mid, volumeUsdc: v.toString() };
      }
    }

    // Last 3 forecast traces for this agent — rationale snippet only,
    // capped at 280 chars to keep payload under the 5kB ceiling.
    const traceRows = await db
      .select()
      .from(forecastTraces)
      .where(eq(forecastTraces.agentAddress, address))
      .orderBy(desc(forecastTraces.createdAt))
      .limit(3);
    const latestForecasts = traceRows.map((t) => ({
      sha256: t.sha256,
      marketId: t.marketId,
      outcome: t.outcome,
      confidence: t.confidence,
      model: t.model,
      rationaleSnippet: t.cipherAlg
        ? "(encrypted)"
        : t.rationale.slice(0, 280) + (t.rationale.length > 280 ? "…" : ""),
      createdAt: t.createdAt,
    }));

    return c.json({
      address,
      paid: true,
      settledTx,
      pricePaidUsdc: INSIGHTS_PRICE_USDC_BASE_UNITS.toString(),
      persona: {
        name: agentRow.name,
        personaLabel: agentRow.personaLabel,
        strategyId: agentRow.strategyId,
        verified: agentRow.verified === 1,
      },
      honos: {
        score: honos.score,
        wins: honos.wins,
        losses: honos.losses,
        settled: honos.settled,
        rank: rank >= 0 ? rank + 1 : null,
        rankOf: leaderboard.length,
        winRate:
          honos.settled > 0 ? Number((honos.wins / honos.settled).toFixed(3)) : null,
      },
      // Beefed-up demo stats — added M8.2 for the "Unlock for 0.001 USDC"
      // showcase. winRate buckets are decimals (0.0..1.0); pnl/volume in
      // USDC base units (6 decimals).
      winRate24h: counters.d1.settled > 0
        ? Number((counters.d1.wins / counters.d1.settled).toFixed(3))
        : null,
      winRate7d: counters.d7.settled > 0
        ? Number((counters.d7.wins / counters.d7.settled).toFixed(3))
        : null,
      winRateAllTime: counters.lifetime.settled > 0
        ? Number((counters.lifetime.wins / counters.lifetime.settled).toFixed(3))
        : null,
      pnlUsdc: pnlTotal.toString(),
      pnlByMarket: pnlBreakdown,
      // Signal correlation = how often this agent's pick matched the
      // winning outcome (across settled, non-INVALID bets). Same numerator
      // as winRateAllTime but exposed separately so the UI can label it
      // differently — Polymarket calls this "edge".
      signalCorrelation: counters.lifetime.settled > 0
        ? Number((correctSignal / counters.lifetime.settled).toFixed(3))
        : null,
      streak,
      mostBetMarket,
      latestForecasts,
      stats: {
        totalBets: allBets.length,
        totalVolumeUsdc: totalVolume.toString(),
        avgBetSizeUsdc: avgBetSize,
        yesShare:
          allBets.length === 0
            ? 0
            : Number(((allBets.filter((b) => b.outcome === 1).length / allBets.length) * 100).toFixed(1)),
      },
      recentBets: allBets.slice(0, 10).map((b) => ({
        id: b.id,
        marketId: b.marketId,
        outcome: b.outcome,
        costUsdc: b.costUsdc,
        feeUsdc: b.feeUsdc,
        marketTxHash: b.marketTxHash,
        forecastSha256: b.forecastSha256,
        createdAt: b.createdAt,
      })),
    });
  });

  /// Recent settled bets — read-only feed for the public landing ticker.
  app.get("/bets/recent", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
    const rows = await db
      .select({
        id: bets.id,
        marketId: bets.marketId,
        agentAddress: bets.agentAddress,
        outcome: bets.outcome,
        sharesWad: bets.sharesWad,
        costUsdc: bets.costUsdc,
        feeUsdc: bets.feeUsdc,
        marketTxHash: bets.marketTxHash,
        blockNumber: bets.blockNumber,
        createdAt: bets.createdAt,
        forecastSha256: bets.forecastSha256,
      })
      .from(bets)
      .orderBy(desc(bets.id))
      .limit(limit);
    return c.json({ count: rows.length, bets: rows });
  });

  /// Resolution data for a single market (404 if not yet resolved).
  app.get("/markets/:id/resolution", async (c) => {
    const id = c.req.param("id").toLowerCase();
    const row = (await db.select().from(resolutions).where(eq(resolutions.marketId, id)))[0];
    if (!row) throw new HTTPException(404, { message: `market not yet resolved: ${id}` });
    return c.json(row);
  });

  /// Notification from the resolver worker: a market just resolved. Persists the
  /// resolution row + flips the market phase. v0.1 trusts the resolver (in-process
  /// for VPS); v0.2 will sign this with RESOLVER_ADMIN to harden multi-tenant.
  app.post("/markets/:id/resolution-notify", async (c) => {
    const id = c.req.param("id").toLowerCase();
    const body = await c.req.json().catch(() => null);
    if (!body) throw new HTTPException(400, { message: "JSON body required" });

    const Schema = z.object({
      marketId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      winningOutcome: z.literal(0).or(z.literal(1)).or(z.literal(2)),
      dataHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      timestamp: z.number().int(),
      txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      source: z.string().min(1).max(32),
      ecbDate: z.string().optional(),
      ecbRate: z.number().optional(),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });
    if (parsed.data.marketId.toLowerCase() !== id) {
      throw new HTTPException(400, { message: "marketId path/body mismatch" });
    }

    const market = (await db.select().from(markets).where(eq(markets.id, id)))[0];
    if (!market) throw new HTTPException(404, { message: `market not found: ${id}` });

    // Verify on-chain phase actually flipped before we trust the notification.
    let onchainPhase: number;
    try {
      onchainPhase = Number(
        (await clients.publicClient.readContract({
          address: market.address as `0x${string}`,
          abi: ForexMarketAbi,
          functionName: "phase",
        })) as number | bigint,
      );
    } catch (err) {
      throw new HTTPException(502, {
        message: `phase read failed: ${(err as Error).message}`,
      });
    }
    if (onchainPhase !== 3) {
      throw new HTTPException(409, {
        message: `on-chain phase is ${onchainPhase}, expected 3 (RESOLVED). Solidity enum: 0=UNINITIALIZED, 1=OPEN, 2=CLOSED, 3=RESOLVED.`,
      });
    }

    // Idempotent upsert.
    await db.insert(resolutions)
      .values({
        marketId: id,
        outcome: parsed.data.winningOutcome,
        dataHash: parsed.data.dataHash.toLowerCase(),
        source: parsed.data.source,
        signer: deployment.resolverAdmin.toLowerCase(),
        txHash: parsed.data.txHash.toLowerCase(),
        resolvedAt: parsed.data.timestamp,
        ecbDate: parsed.data.ecbDate ?? null,
        ecbRate: parsed.data.ecbRate !== undefined ? String(parsed.data.ecbRate) : null,
      })
      .onConflictDoNothing();

    await db.update(markets)
      .set({
        phase: 2,
        winningOutcome: parsed.data.winningOutcome,
        resolvesAt: parsed.data.timestamp,
      })
      .where(eq(markets.id, id))
      ;

    bus.emit({
      type: "market.resolved",
      marketId: id,
      outcome: parsed.data.winningOutcome,
      source: parsed.data.source,
      txHash: parsed.data.txHash.toLowerCase(),
      ts: parsed.data.timestamp,
    });

    return c.json({
      marketId: id,
      phase: 2,
      winningOutcome: parsed.data.winningOutcome,
      txHash: parsed.data.txHash,
    });
  });

  /// Force-sync a market's DB phase from on-chain. Use when the resolver
  /// submitted a Resolution on-chain but the notify webhook to market-api
  /// failed (e.g., during a transient outage). Idempotent — reads on-chain
  /// phase + winningOutcome and updates DB if mismatched. Skips signature
  /// verification because on-chain state is the source of truth.
  app.post("/admin/sync-market/:id", async (c) => {
    // P2-B-004 — admin gate. Match the existing /admin/resolve pattern: require
    // a shared-secret header matching env.ADMIN_SECRET. Fail-closed when the
    // env var isn't configured (503 rather than allowing un-gated access).
    const secret = c.req.header("x-admin-secret");
    if (!env.ADMIN_SECRET) {
      throw new HTTPException(503, { message: "ADMIN_SECRET not configured on server" });
    }
    if (secret !== env.ADMIN_SECRET) {
      throw new HTTPException(401, { message: "bad admin secret" });
    }
    const id = c.req.param("id").toLowerCase();
    if (!/^0x[a-f0-9]+$/.test(id)) {
      throw new HTTPException(400, { message: "marketId must be lowercase 0x-hex" });
    }
    const market = (await db.select().from(markets).where(eq(markets.id, id)))[0];
    if (!market) throw new HTTPException(404, { message: "market not found" });

    const [phase, winningOutcome] = await Promise.all([
      clients.publicClient.readContract({
        address: market.address as `0x${string}`,
        abi: ForexMarketAbi,
        functionName: "phase",
      }) as Promise<number | bigint>,
      clients.publicClient.readContract({
        address: market.address as `0x${string}`,
        abi: ForexMarketAbi,
        functionName: "winningOutcome",
      }) as Promise<number | bigint>,
    ]);

    const phaseNum = Number(phase);
    const winNum = Number(winningOutcome);

    // Contract enum (ForexMarket.sol Phase): 0=UNINITIALIZED, 1=OPEN, 2=RESOLVED.
    // There is NO intermediate CLOSED state on-chain — markets go OPEN → RESOLVED
    // directly via Resolver.resolve(). DB enum: 0=open, 1=closed, 2=resolved.
    // The "DB closed" bucket (1) is purely a time-derived UI state (closesAt past
    // but resolver hasn't fired yet) — the chain never reports it.
    let newDbPhase: 0 | 1 | 2 = market.phase as 0 | 1 | 2;
    if (phaseNum === 2) newDbPhase = 2;          // RESOLVED on-chain → resolved in DB
    else newDbPhase = 0;                          // OPEN / UNINITIALIZED → open in DB

    if (newDbPhase !== market.phase || (newDbPhase === 2 && market.winningOutcome !== winNum)) {
      await db.update(markets)
        .set({
          phase: newDbPhase,
          winningOutcome: newDbPhase === 2 ? (winNum as 0 | 1 | 2) : null,
          resolvesAt: newDbPhase === 2 ? Math.floor(Date.now() / 1000) : market.resolvesAt,
        })
        .where(eq(markets.id, id));
    }

    // ALWAYS check if a phase=2 market is missing its resolutions row,
    // even when this sync didn't touch the markets table itself. Markets
    // that were promoted to phase=2 by an earlier sync (before this
    // upsert logic landed) are stuck without a resolution row, which is
    // what powers ResolutionBanner + the arena's winner-walks-to-FINISH
    // animation. Without this branch, those legacy markets stay broken
    // forever: re-running sync would short-circuit at the if() above
    // because phase already matches.
    if (newDbPhase === 2) {
      const existing = (
        await db.select().from(resolutions).where(eq(resolutions.marketId, id))
      )[0];
      if (!existing) {
        const onchainDigest = await clients.publicClient
          .readContract({
            address: deployment.resolver as `0x${string}`,
            abi: ResolverAbi,
            functionName: "resolutionDigest",
            args: [id as `0x${string}`],
          })
          .catch(() => "0x" as `0x${string}`);
        // Source inference for the legacy-heal path. The resolver path
        // always sets the correct source from `ecb.source`; this heal
        // branch only fires when an on-chain resolution exists but the DB
        // row was never written. Pair-aware best-guess matches what the
        // resolver would have used (ECB for EUR pairs, BoC for CAD pairs).
        const pair = (market.pair ?? "").toUpperCase();
        const inferredSource =
          pair.includes("CAD") ? "BoC" :
          pair.includes("EUR") ? "ECB" :
          "ECB-cross";
        await db.insert(resolutions).values({
          marketId: id,
          outcome: winNum,
          dataHash: String(onchainDigest),
          source: inferredSource,
          signer: deployment.resolverAdmin,
          txHash: "",
          resolvedAt: Math.floor(Date.now() / 1000),
          ecbDate: null,
          ecbRate: null,
        });
      } else if (existing.outcome !== winNum) {
        await db.update(resolutions)
          .set({ outcome: winNum, resolvedAt: Math.floor(Date.now() / 1000) })
          .where(eq(resolutions.marketId, id));
      }
    }

    return c.json({
      marketId: id,
      onchainPhase: phaseNum,
      onchainWinningOutcome: winNum,
      dbPhase: newDbPhase,
      updated: newDbPhase !== market.phase,
    });
  });

  /// Admin-only manual trigger. Useful for demo/debug. v0.2 deprecated by full
  /// resolver-as-cron flow + Pyth oracle.
  /// Diagnostic: returns the state of a single market so an operator can
  /// tell at a glance why the resolver is or isn't picking it up. Use this
  /// before deciding whether to restart the resolver process or chase
  /// something else (ECB API, gas, admin key).
  app.post("/admin/resolve/:id", async (c) => {
    const secret = c.req.header("x-admin-secret");
    if (!env.ADMIN_SECRET) {
      throw new HTTPException(503, { message: "ADMIN_SECRET not configured on server" });
    }
    if (secret !== env.ADMIN_SECRET) {
      throw new HTTPException(401, { message: "bad admin secret" });
    }
    const id = c.req.param("id").toLowerCase();
    const m = (await db.select().from(markets).where(eq(markets.id, id)))[0];
    if (!m) throw new HTTPException(404, { message: "market not found" });
    const now = Math.floor(Date.now() / 1000);
    const status =
      m.phase === 2
        ? "already-resolved"
        : m.closesAt > now
          ? "still-open"
          : "awaiting-resolver-tick";
    return c.json({
      ok: true,
      marketId: m.id,
      address: m.address,
      phase: m.phase,
      closesAt: m.closesAt,
      now,
      overdueSeconds: Math.max(0, now - m.closesAt),
      status,
      hint:
        status === "awaiting-resolver-tick"
          ? "If overdueSeconds > 300, the resolver may be stuck. Check `pm2 logs forum-resolver --lines 100 --nostream | grep -E 'failed|underpriced|txpool'` then `pm2 restart forum-resolver`."
          : status === "still-open"
            ? "Market not yet past closesAt — resolver won't touch it yet."
            : "Resolution already on-chain. If UI still shows pending, run POST /admin/sync-market/:id to refresh the DB row.",
    });
  });

  /// Diagnostic: lists every market that is past closesAt but still
  /// phase=0 in the DB. Lets ops eyeball the resolver backlog without
  /// SSHing into the VPS. Read-only; safe to call frequently.
  app.get("/admin/stuck-markets", async (c) => {
    const secret = c.req.header("x-admin-secret");
    if (!env.ADMIN_SECRET) {
      throw new HTTPException(503, { message: "ADMIN_SECRET not configured on server" });
    }
    if (secret !== env.ADMIN_SECRET) {
      throw new HTTPException(401, { message: "bad admin secret" });
    }
    const now = Math.floor(Date.now() / 1000);
    const rows = await db
      .select({
        id: markets.id,
        address: markets.address,
        question: markets.question,
        closesAt: markets.closesAt,
        phase: markets.phase,
      })
      .from(markets)
      .where(eq(markets.phase, 0));
    const stuck = rows
      .filter((r) => r.closesAt <= now)
      .map((r) => ({
        ...r,
        overdueSeconds: now - r.closesAt,
        overdueHuman:
          now - r.closesAt < 3600
            ? `${Math.floor((now - r.closesAt) / 60)}m`
            : `${Math.floor((now - r.closesAt) / 3600)}h`,
      }))
      .sort((a, b) => b.overdueSeconds - a.overdueSeconds);
    return c.json({
      now,
      count: stuck.length,
      hint:
        stuck.length === 0
          ? "Resolver backlog empty — all closed markets are settled."
          : stuck.length > 5
            ? "Resolver appears stuck. Check `pm2 logs forum-resolver | tail -100` for [gas-bump-exhausted] / [admin-key-mismatch] / [rpc-timeout] tags."
            : `${stuck.length} market(s) awaiting resolver tick. Normal under load; alarming if persistent.`,
      stuck,
    });
  });

  app.get("/markets/:id", async (c) => {
    const id = c.req.param("id").toLowerCase();
    const row = (await db.select().from(markets).where(eq(markets.id, id)))[0];
    if (!row) throw new HTTPException(404, { message: `market not found: ${id}` });
    return c.json(row);
  });

  app.get("/markets/:id/quote", async (c) => {
    const id = c.req.param("id").toLowerCase();
    const parsed = QuoteQuery.safeParse({
      outcome: c.req.query("outcome"),
      shares: c.req.query("shares"),
    });
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { outcome, shares: sharesStr } = parsed.data;
    const shares = BigInt(sharesStr);
    if (shares === 0n) throw new HTTPException(400, { message: "shares must be > 0" });

    const market = (await db.select().from(markets).where(eq(markets.id, id)))[0];
    if (!market) throw new HTTPException(404, { message: `market not found: ${id}` });
    if (market.phase !== 0) throw new HTTPException(409, { message: "market not OPEN" });

    let costUsdc: bigint;
    try {
      costUsdc = (await clients.publicClient.readContract({
        address: market.address as `0x${string}`,
        abi: ForexMarketAbi,
        functionName: "previewBuy",
        args: [outcome, shares],
      })) as bigint;
    } catch (err) {
      throw new HTTPException(502, { message: `previewBuy reverted: ${(err as Error).message}` });
    }

    // Fee = 2% of cost (mirrors ForexMarket.FEE_BPS=200/10_000).
    const feeUsdc = (costUsdc * 200n) / 10_000n;
    const validUntil = BigInt(Math.floor(Date.now() / 1000) + 30);
    const nonce = randomNonce();

    const signed = await signQuote(clients.quoteAccount, {
      marketId: id as `0x${string}`,
      outcome,
      shares,
      costUsdc,
      feeUsdc,
      validUntil,
      nonce,
    });

    return c.json({
      marketId: signed.marketId,
      marketAddress: market.address,
      outcome: signed.outcome,
      shares: signed.shares.toString(),
      costUsdc: signed.costUsdc.toString(),
      feeUsdc: signed.feeUsdc.toString(),
      totalPaidUsdc: (signed.costUsdc + signed.feeUsdc).toString(),
      validUntil: signed.validUntil.toString(),
      nonce: signed.nonce,
      signature: signed.signature,
      signer: signed.signer,
      domain: {
        name: "FORUM Market Quote",
        version: "1",
        chainId: env.ARC_CHAIN_ID,
        verifyingContract: signed.signer,
      },
    });
  });

  app.post("/markets", async (c) => {
    // Admin-only: scout daemon + ops scripts. Requires x-runner-secret.
    requireAdminSecret(c);
    const body = await c.req.json().catch(() => null);
    if (!body) throw new HTTPException(400, { message: "JSON body required" });

    const parsed = CreateMarketBody.safeParse(body);
    if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

    const p = parsed.data;
    if (p.closesAt <= p.opensAt) {
      throw new HTTPException(400, { message: "closesAt must be > opensAt" });
    }
    // Hard cap on market duration. The resolver polls every market with
    // phase=0 forever, so an unbounded closesAt = a permanent log-line
    // entry that the worker tries (and fails) to resolve until heat-death.
    // 90 days is comfortably above any sane FX prediction horizon.
    const MAX_DURATION_SEC = 90 * 24 * 60 * 60;
    if (p.closesAt - p.opensAt > MAX_DURATION_SEC) {
      throw new HTTPException(400, {
        message: `closesAt − opensAt cannot exceed 90 days (got ${Math.round((p.closesAt - p.opensAt) / 86400)} days)`,
      });
    }

    const marketId = keccak256(encodePacked(["string", "uint64"], [p.question, BigInt(p.closesAt)]));

    // Two layers of dedup so concurrent callers (forum-keeper, forum-scout)
    // can't sneak duplicate rows past us:
    //   1. Exact id-hash match (question + closesAt). Same payload twice → same row.
    //   2. (pair, opensAt, closesAt) tuple. Different question text but same
    //      market slot → still a dup; return 200 with `deduped: true` so the
    //      caller's outer "is this slot covered?" check converges.
    // Either branch returns 200 instead of 409 so the keeper doesn't treat it
    // as an error and tear down the rest of its tick.
    const dedupResponse = (row: typeof markets.$inferSelect) =>
      c.json({
        marketId: row.id,
        marketAddress: row.address,
        txHash: row.createdAtTxHash,
        blockNumber: row.createdAtBlock,
        explorer: `https://testnet.arcscan.app/tx/${row.createdAtTxHash}`,
        deduped: true,
      });

    const dupById = (await db.select().from(markets).where(eq(markets.id, marketId)))[0];
    if (dupById) return dedupResponse(dupById);

    const dupBySlot = (await db
      .select()
      .from(markets)
      .where(and(eq(markets.pair, p.pair), eq(markets.opensAt, p.opensAt), eq(markets.closesAt, p.closesAt))))[0];
    if (dupBySlot) return dedupResponse(dupBySlot);

    const collateral = p.collateral ?? "USDC";
    const collateralAddress = (collateral === "EURC"
      ? env.ARC_EURC
      : env.ARC_USDC) as `0x${string}`;

    try {
      const result = await withChainLock(async () => {
      // Check existing allowance first — skip approve tx entirely when treasury
      // already has enough headroom. Solves the "ERC20: transfer amount exceeds
      // allowance" race that hit forum-keeper firing 5 markets back-to-back:
      // per-create approves were getting overwritten before the create read them.
      const currentAllowance = (await clients.publicClient.readContract({
        address: collateralAddress,
        abi: USDC_APPROVE_ABI,
        functionName: "allowance",
        args: [clients.account.address, deployment.forexMarketFactory as `0x${string}`],
      })) as bigint;

      if (currentAllowance < BigInt(p.subsidyUsdc)) {
        // Infinite approve so subsequent creates don't need to approve again.
        const approveTx = await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: collateralAddress,
          abi: USDC_APPROVE_ABI,
          functionName: "approve",
          args: [deployment.forexMarketFactory as `0x${string}`, MAX_UINT256],
        });
        await waitWithRetry(clients.publicClient, approveTx);
      }

      const createTx = await clients.walletClient.writeContract({
        chain: arcTestnet,
        account: clients.account,
        address: deployment.forexMarketFactory as `0x${string}`,
        abi: ForexMarketFactoryAbi,
        functionName: "createMarket",
        args: [
          {
            marketId,
            quoteToken: collateralAddress,
            bWad: BigInt(p.bWad),
            opensAt: BigInt(p.opensAt),
            closesAt: BigInt(p.closesAt),
            subsidyUsdc6: BigInt(p.subsidyUsdc),
          },
        ],
      });
      const receipt = await waitWithRetry(clients.publicClient, createTx);

      const cloneAddress = (await clients.publicClient.readContract({
        address: deployment.forexMarketFactory as `0x${string}`,
        abi: ForexMarketFactoryAbi,
        functionName: "marketOf",
        args: [marketId],
      })) as `0x${string}`;

      return { createTx, receipt, cloneAddress };
      });

      const { createTx, receipt, cloneAddress } = result;
      const now = Math.floor(Date.now() / 1000);
      await db.insert(markets)
        .values({
          id: marketId,
          address: cloneAddress.toLowerCase(),
          question: p.question,
          pair: p.pair,
          strikeWad: p.strikeWad,
          comparator: p.comparator,
          bWad: p.bWad,
          opensAt: p.opensAt,
          closesAt: p.closesAt,
          phase: 0,
          createdAtBlock: Number(receipt.blockNumber),
          createdAtTxHash: createTx,
          createdAt: now,
          createdBy: p.createdBy ?? "manual",
          collateral,
        });

      bus.emit({
        type: "market.created",
        marketId,
        address: cloneAddress.toLowerCase(),
        question: p.question,
        pair: p.pair,
        strikeWad: p.strikeWad,
        comparator: p.comparator,
        opensAt: p.opensAt,
        closesAt: p.closesAt,
        txHash: createTx,
        blockNumber: Number(receipt.blockNumber),
        ts: now,
      });

      return c.json({
        marketId,
        marketAddress: cloneAddress,
        txHash: createTx,
        blockNumber: Number(receipt.blockNumber),
        explorer: `https://testnet.arcscan.app/tx/${createTx}`,
      });
    } catch (err) {
      throw new HTTPException(500, { message: `createMarket failed: ${(err as Error).message}` });
    }
  });

  // ============================================================
  // Bets — settle + execute
  // ============================================================

  app.post("/markets/:id/bets", async (c) => {
    const id = c.req.param("id").toLowerCase();
    const body = await c.req.json().catch(() => null);
    if (!body) throw new HTTPException(400, { message: "JSON body required" });

    const parsed = PlaceBetBody.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, {
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
    }
    const { intent, intentSignature, authorization } = parsed.data;

    // 1) Intent address must match marketId in path.
    if (intent.marketId.toLowerCase() !== id) {
      throw new HTTPException(400, { message: "intent.marketId does not match URL" });
    }

    // 1b) Deadline must be in the (server-side) future AND within 10 min.
    // Blocks indefinite replay of long-ago signed intents — the on-chain
    // contract validates too but a permissive contract default would let
    // a stale intent settle hours later.
    const nowSec = Math.floor(Date.now() / 1000);
    if (intent.deadline <= nowSec) {
      throw new HTTPException(400, { message: "intent expired" });
    }
    if (intent.deadline > nowSec + 600) {
      throw new HTTPException(400, { message: "intent deadline > 10min in future" });
    }

    // 2) Verify intent signature against intent.agent.
    //    Uses viem.verifyMessage which falls back to EIP-1271 isValidSignature
    //    when the address is a smart contract (Safe, Dynamic Dria, Argent, etc).
    //    EOAs work as before via ecrecover.
    const intentHash = packIntentHash(intent);
    let intentValid = false;
    try {
      intentValid = await clients.publicClient.verifyMessage({
        address: intent.agent as `0x${string}`,
        message: { raw: intentHash },
        signature: intentSignature as `0x${string}`,
      });
    } catch (err) {
      throw new HTTPException(400, { message: `intent signature check failed: ${(err as Error).message}` });
    }
    if (!intentValid) {
      // Best-effort recovery for debug message (EOA-only).
      let recovered = "<unknown>";
      try {
        recovered = await recoverMessageAddress({
          message: { raw: intentHash },
          signature: intentSignature as `0x${string}`,
        });
      } catch {
        // smart-wallet signatures aren't recoverable as EOAs
      }
      throw new HTTPException(401, {
        message: `intent signature invalid for ${intent.agent} (recovered as EOA: ${recovered}). If using a smart wallet, ensure it implements EIP-1271.`,
      });
    }

    // 3) Cross-check: authorization.from must equal intent.agent, value must equal maxCost.
    if (authorization.from.toLowerCase() !== intent.agent.toLowerCase()) {
      throw new HTTPException(400, { message: "authorization.from does not match intent.agent" });
    }
    if (BigInt(authorization.value) > BigInt(intent.maxCost)) {
      throw new HTTPException(400, { message: "authorization.value exceeds intent.maxCost" });
    }
    if (authorization.nonce.toLowerCase() !== intent.nonce.toLowerCase()) {
      throw new HTTPException(400, { message: "authorization.nonce must match intent.nonce" });
    }

    // 4) Market must exist + be OPEN.
    const market = (await db.select().from(markets).where(eq(markets.id, id)))[0];
    if (!market) throw new HTTPException(404, { message: `market not found: ${id}` });
    if (market.phase !== 0) throw new HTTPException(409, { message: "market not OPEN" });

    // 5) Authorization.to must equal market-api wallet (we relay, then call buyShares).
    if (getAddress(authorization.to) !== getAddress(clients.account.address)) {
      throw new HTTPException(400, {
        message: `authorization.to must be the market-api wallet (${clients.account.address})`,
      });
    }

    // 6) Re-quote on-chain (no trusted stale quote!) + verify maxCost covers it.
    let cost: bigint;
    try {
      cost = (await clients.publicClient.readContract({
        address: market.address as `0x${string}`,
        abi: ForexMarketAbi,
        functionName: "previewBuy",
        args: [intent.outcome, BigInt(intent.shares)],
      })) as bigint;
    } catch (err) {
      throw new HTTPException(502, { message: `previewBuy reverted: ${(err as Error).message}` });
    }
    const fee = (cost * 200n) / 10_000n;
    const totalNeeded = cost + fee;
    if (totalNeeded > BigInt(intent.maxCost)) {
      throw new HTTPException(409, {
        message: `quoted total ${totalNeeded} exceeds intent.maxCost ${intent.maxCost} (slippage)`,
      });
    }
    if (BigInt(authorization.value) < totalNeeded) {
      throw new HTTPException(400, {
        message: `authorization.value ${authorization.value} < required ${totalNeeded}`,
      });
    }

    // 7) Settle USDC via transferWithAuthorization → market-api wallet receives buyer's USDC.
    // sendWithReplace auto-retries with same-nonce + bumped gas on stuck tx,
    // so a validator dropping the first broadcast no longer 502s the user.
    let settleTx: `0x${string}` = "0x" as `0x${string}`;
    try {
      await sendWithReplace(clients.publicClient, async ({ nonce, priorityFeeWei }) => {
        const h = await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: env.ARC_USDC as `0x${string}`,
          abi: USDC_TRANSFER_WITH_AUTH_ABI,
          functionName: "transferWithAuthorization",
          args: [
            authorization.from as `0x${string}`,
            authorization.to as `0x${string}`,
            BigInt(authorization.value),
            BigInt(authorization.validAfter),
            BigInt(authorization.validBefore),
            authorization.nonce as `0x${string}`,
            authorization.v,
            authorization.r as `0x${string}`,
            authorization.s as `0x${string}`,
          ],
          ...(nonce !== undefined ? { nonce } : {}),
          ...(priorityFeeWei !== undefined
            ? { maxPriorityFeePerGas: priorityFeeWei, maxFeePerGas: priorityFeeWei * 2n }
            : {}),
        });
        settleTx = h;
        return h;
      }, { label: "bet:settle" });
    } catch (err) {
      throw new HTTPException(502, { message: `USDC settle failed: ${(err as Error).message}` });
    }

    // 8) Approve the market clone to spend `totalNeeded` from market-api wallet.
    try {
      await sendWithReplace(clients.publicClient, async ({ nonce, priorityFeeWei }) => {
        return await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: env.ARC_USDC as `0x${string}`,
          abi: USDC_APPROVE_ABI,
          functionName: "approve",
          args: [market.address as `0x${string}`, totalNeeded],
          ...(nonce !== undefined ? { nonce } : {}),
          ...(priorityFeeWei !== undefined
            ? { maxPriorityFeePerGas: priorityFeeWei, maxFeePerGas: priorityFeeWei * 2n }
            : {}),
        });
      }, { label: "bet:approve" });
    } catch (err) {
      throw new HTTPException(502, { message: `approve failed: ${(err as Error).message}` });
    }

    // 9) Call ForexMarket.buyShares — clone pulls totalNeeded from market-api wallet,
    //    mints outcome tokens to `intent.agent`.
    let buyTx: `0x${string}` = "0x" as `0x${string}`;
    let buyReceipt: Awaited<ReturnType<typeof clients.publicClient.waitForTransactionReceipt>>;
    try {
      buyReceipt = await sendWithReplace(clients.publicClient, async ({ nonce, priorityFeeWei }) => {
        const h = await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: market.address as `0x${string}`,
          abi: ForexMarketAbi,
          functionName: "buyShares",
          args: [
            intent.outcome,
            BigInt(intent.shares),
            BigInt(intent.maxCost),
            BigInt(intent.deadline),
            intent.agent as `0x${string}`,
            intentHash,
          ],
          ...(nonce !== undefined ? { nonce } : {}),
          ...(priorityFeeWei !== undefined
            ? { maxPriorityFeePerGas: priorityFeeWei, maxFeePerGas: priorityFeeWei * 2n }
            : {}),
        });
        buyTx = h;
        return h;
      }, { label: "bet:buyShares" });
    } catch (err) {
      throw new HTTPException(502, { message: `buyShares reverted: ${(err as Error).message}` });
    }

    // 10) Record the bet. Idempotency on intent_hash (unique index in schema).
    const now = Math.floor(Date.now() / 1000);
    await db.insert(bets)
      .values({
        marketId: id,
        agentAddress: intent.agent.toLowerCase(),
        outcome: intent.outcome,
        sharesWad: intent.shares,
        costUsdc: cost.toString(),
        feeUsdc: fee.toString(),
        intentHash: intentHash.toLowerCase(),
        settlementTxHash: settleTx.toLowerCase(),
        marketTxHash: buyTx.toLowerCase(),
        blockNumber: Number(buyReceipt.blockNumber),
        createdAt: now,
      });

    bus.emit({
      type: "bet.placed",
      marketId: id,
      agentAddress: intent.agent.toLowerCase(),
      outcome: intent.outcome,
      sharesWad: intent.shares,
      costUsdc: cost.toString(),
      feeUsdc: fee.toString(),
      txHash: buyTx.toLowerCase(),
      ts: now,
    });

    // 11) Sync the on-chain market state back into the DB so consumers (Hermes,
    //     Augur, console odds chart) see fresh qYes/qNo without an indexer worker.
    //     Best-effort: failure here doesn't fail the bet response.
    try {
      const [newQYes, newQNo, newCollateral, newFee] = await Promise.all([
        clients.publicClient.readContract({
          address: market.address as `0x${string}`,
          abi: ForexMarketAbi,
          functionName: "qYesWad",
        }) as Promise<bigint>,
        clients.publicClient.readContract({
          address: market.address as `0x${string}`,
          abi: ForexMarketAbi,
          functionName: "qNoWad",
        }) as Promise<bigint>,
        clients.publicClient.readContract({
          address: market.address as `0x${string}`,
          abi: ForexMarketAbi,
          functionName: "collateralEscrowed",
        }) as Promise<bigint>,
        clients.publicClient.readContract({
          address: market.address as `0x${string}`,
          abi: ForexMarketAbi,
          functionName: "feeAccrued",
        }) as Promise<bigint>,
      ]);
      await db.update(markets)
        .set({
          qYesWad: newQYes.toString(),
          qNoWad: newQNo.toString(),
          collateralEscrowed: newCollateral.toString(),
          feeAccrued: newFee.toString(),
        })
        .where(eq(markets.id, id))
        ;
    } catch {
      // non-fatal: indexer worker (v0.2) is the real fix
    }

    return c.json({
      marketId: id,
      marketAddress: market.address,
      outcome: intent.outcome,
      shares: intent.shares,
      costUsdc: cost.toString(),
      feeUsdc: fee.toString(),
      txHash: buyTx,
      blockNumber: Number(buyReceipt.blockNumber),
      explorer: `https://testnet.arcscan.app/tx/${buyTx}`,
    });
  });

  /// ══════════════════════════════════════════════════════════════════
  /// M8.2 — x402-gated public bet endpoints (Circle Nanopayments showcase)
  /// ══════════════════════════════════════════════════════════════════
  /// Public x402 protocol path for placing bets — designed for external
  /// CLI/agent integration. Anyone with USDC on Arc can bet via this flow:
  /// no Dynamic login, no trader wallet issuance, no API key. The bet pays
  /// out shares to the EIP-3009 `from` address, settled via a single gasless
  /// USDC.transferWithAuthorization to the market-api treasury.
  ///
  /// Two-step dance — mirrors /agents/:addr/insights:
  ///   1. POST /markets/:id/bets/x402-quote  {outcome, shares}
  ///      → 402 + x402 challenge whose `maxAmountRequired` = cost + fee,
  ///        plus a `betPreview` block so the buyer knows what they get.
  ///   2. Buyer signs the EIP-712 typedData (USDC TransferWithAuthorization)
  ///      and POSTs to /markets/:id/bets/x402-execute with X-PAYMENT header.
  ///   3. Server verifies signature, broadcasts settle → approve → buyShares,
  ///      returns both tx hashes + arcscan links.
  ///
  /// curl example (quote):
  ///   curl -i -X POST $API/markets/0xMARKET/bets/x402-quote \
  ///     -H 'Content-Type: application/json' \
  ///     -d '{"outcome":1,"shares":"2000000000000000000"}'
  ///   → 402 + body.x402.extra.typedData + body.betPreview
  ///
  /// curl example (execute):
  ///   curl -X POST $API/markets/0xMARKET/bets/x402-execute \
  ///     -H "X-PAYMENT: $(printf '%s' "$AUTH_JSON" | base64)" \
  ///     -H 'Content-Type: application/json' \
  ///     -d '{"outcome":1,"shares":"2000000000000000000"}'
  ///   → {ok:true, settlementTxHash, betTxHash, betReceipt}

  const X402BetQuoteBody = z.object({
    outcome: z.literal(0).or(z.literal(1)),
    /** Shares in 1e18 WAD — same unit /markets/:id/quote uses. */
    shares: z.string().regex(/^\d+$/),
    slippageBps: z.number().int().min(0).max(2_000).optional(),
  });

  app.post("/markets/:marketId/bets/x402-quote", async (c) => {
    const marketId = c.req.param("marketId").toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(marketId)) {
      throw new HTTPException(400, { message: "marketId must be 0x + 64 hex" });
    }
    const body = await c.req.json().catch(() => null);
    const parsed = X402BetQuoteBody.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { outcome, shares: sharesStr } = parsed.data;
    const shares = BigInt(sharesStr);
    if (shares === 0n) throw new HTTPException(400, { message: "shares must be > 0" });

    const market = (await db.select().from(markets).where(eq(markets.id, marketId)))[0];
    if (!market) throw new HTTPException(404, { message: `market not found: ${marketId}` });
    if (market.phase !== 0) throw new HTTPException(409, { message: "market not OPEN" });

    let cost: bigint;
    try {
      cost = (await clients.publicClient.readContract({
        address: market.address as `0x${string}`,
        abi: ForexMarketAbi,
        functionName: "previewBuy",
        args: [outcome, shares],
      })) as bigint;
    } catch (err) {
      throw new HTTPException(502, { message: `previewBuy reverted: ${(err as Error).message}` });
    }
    const fee = (cost * 200n) / 10_000n;
    const total = cost + fee;

    const challenge = buildX402Challenge({
      payTo: clients.account.address,
      amountBaseUnits: total,
      resourcePath: `/markets/${marketId}/bets/x402-execute`,
    });
    c.header("WWW-Authenticate", `Bearer realm="x402", scheme="exact"`);
    return c.json(
      {
        error: "Payment required",
        x402: challenge,
        betPreview: {
          marketId,
          marketAddress: market.address,
          outcome,
          shares: sharesStr,
          costUsdc: cost.toString(),
          feeUsdc: fee.toString(),
          totalUsdc: total.toString(),
          expiresAt: challenge.extra.validBefore,
        },
        note: "Sign extra.typedData with EIP-712 and POST x402-execute with X-PAYMENT header set to base64(json({ from, v, r, s, validAfter, validBefore, nonce })).",
      },
      402,
    );
  });

  const X402BetExecuteBody = z.object({
    outcome: z.literal(0).or(z.literal(1)),
    shares: z.string().regex(/^\d+$/),
    // P1-B-002 — `betFrom` removed. Shares are always minted to the EIP-3009
    // signer (payment.from) so an observer can't frontrun a transit X-PAYMENT
    // by redirecting the position to an attacker-controlled recipient.
  });

  app.post("/markets/:marketId/bets/x402-execute", async (c) => {
    const marketId = c.req.param("marketId").toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(marketId)) {
      throw new HTTPException(400, { message: "marketId must be 0x + 64 hex" });
    }
    const body = await c.req.json().catch(() => null);
    const parsed = X402BetExecuteBody.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { outcome, shares: sharesStr } = parsed.data;
    const shares = BigInt(sharesStr);
    if (shares === 0n) throw new HTTPException(400, { message: "shares must be > 0" });

    const paymentHeader = c.req.header("x-payment") ?? c.req.header("X-PAYMENT");
    const payment = parseX402PaymentHeader(paymentHeader);
    if (!payment) {
      // No payment → return the 402 challenge so caller gets a clean retry.
      const market0 = (await db.select().from(markets).where(eq(markets.id, marketId)))[0];
      if (!market0) throw new HTTPException(404, { message: `market not found: ${marketId}` });
      const cost0 = (await clients.publicClient.readContract({
        address: market0.address as `0x${string}`,
        abi: ForexMarketAbi,
        functionName: "previewBuy",
        args: [outcome, shares],
      })) as bigint;
      const fee0 = (cost0 * 200n) / 10_000n;
      const total0 = cost0 + fee0;
      const challenge = buildX402Challenge({
        payTo: clients.account.address,
        amountBaseUnits: total0,
        resourcePath: `/markets/${marketId}/bets/x402-execute`,
      });
      c.header("WWW-Authenticate", `Bearer realm="x402", scheme="exact"`);
      return c.json(
        { error: "Payment required", x402: challenge, note: "missing X-PAYMENT header" },
        402,
      );
    }

    const market = (await db.select().from(markets).where(eq(markets.id, marketId)))[0];
    if (!market) throw new HTTPException(404, { message: `market not found: ${marketId}` });
    if (market.phase !== 0) throw new HTTPException(409, { message: "market not OPEN" });

    // Re-compute cost (don't trust caller); ensure X-PAYMENT value covers it.
    let cost: bigint;
    try {
      cost = (await clients.publicClient.readContract({
        address: market.address as `0x${string}`,
        abi: ForexMarketAbi,
        functionName: "previewBuy",
        args: [outcome, shares],
      })) as bigint;
    } catch (err) {
      throw new HTTPException(502, { message: `previewBuy reverted: ${(err as Error).message}` });
    }
    const fee = (cost * 200n) / 10_000n;
    const totalNeeded = cost + fee;

    // Settle USDC → market-api wallet via the buyer's EIP-3009 signature.
    let settleTx: `0x${string}`;
    try {
      settleTx = await withChainLock(async () => {
        const h = await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: env.ARC_USDC as `0x${string}`,
          abi: USDC_TRANSFER_WITH_AUTH_ABI,
          functionName: "transferWithAuthorization",
          args: [
            payment.from,
            clients.account.address,
            totalNeeded,
            BigInt(payment.validAfter),
            BigInt(payment.validBefore),
            payment.nonce,
            payment.v,
            payment.r,
            payment.s,
          ],
        });
        await waitWithRetry(clients.publicClient, h);
        return h;
      });
    } catch (err) {
      throw new HTTPException(402, {
        message: `payment settle failed: ${(err as Error).message.slice(0, 200)}`,
      });
    }

    // Approve the market clone to pull totalNeeded from market-api wallet.
    try {
      await withChainLock(async () => {
        const tx = await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: env.ARC_USDC as `0x${string}`,
          abi: USDC_APPROVE_ABI,
          functionName: "approve",
          args: [market.address as `0x${string}`, totalNeeded],
        });
        await waitWithRetry(clients.publicClient, tx);
      });
    } catch (err) {
      throw new HTTPException(502, { message: `approve failed: ${(err as Error).message}` });
    }

    // Build the on-chain intent. Authority is rooted in the X-PAYMENT signature
    // (USDC EIP-3009) — shares mint to payment.from. P1-B-002: no `betFrom`
    // override; the position always lands at the EIP-3009 signer.
    const recipient = payment.from as `0x${string}`;
    const deadline = Number(payment.validBefore);
    const intent = {
      marketId: marketId as `0x${string}`,
      outcome,
      shares: sharesStr,
      maxCost: totalNeeded.toString(),
      deadline,
      agent: recipient,
      nonce: payment.nonce,
    };
    const intentHash = keccak256(
      encodePacked(
        ["bytes32", "uint8", "uint256", "uint256", "uint64", "address", "bytes32"],
        [
          intent.marketId,
          intent.outcome,
          BigInt(intent.shares),
          BigInt(intent.maxCost),
          BigInt(intent.deadline),
          intent.agent,
          intent.nonce,
        ],
      ),
    );

    let buyTx: `0x${string}`;
    let buyReceipt: Awaited<ReturnType<typeof clients.publicClient.waitForTransactionReceipt>>;
    try {
      buyTx = await withChainLock(async () => {
        const tx = await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: market.address as `0x${string}`,
          abi: ForexMarketAbi,
          functionName: "buyShares",
          args: [
            outcome,
            shares,
            totalNeeded,
            BigInt(deadline),
            recipient,
            intentHash,
          ],
        });
        const receipt = await waitWithRetry(clients.publicClient, tx);
        buyReceipt = receipt;
        return tx;
      });
    } catch (err) {
      throw new HTTPException(502, { message: `buyShares reverted: ${(err as Error).message}` });
    }

    const now = Math.floor(Date.now() / 1000);
    await db.insert(bets)
      .values({
        marketId,
        agentAddress: recipient.toLowerCase(),
        outcome,
        sharesWad: sharesStr,
        costUsdc: cost.toString(),
        feeUsdc: fee.toString(),
        intentHash: intentHash.toLowerCase(),
        settlementTxHash: settleTx.toLowerCase(),
        marketTxHash: buyTx.toLowerCase(),
        blockNumber: Number(buyReceipt!.blockNumber),
        createdAt: now,
      });
    bus.emit({
      type: "bet.placed",
      marketId,
      agentAddress: recipient.toLowerCase(),
      outcome,
      sharesWad: sharesStr,
      costUsdc: cost.toString(),
      feeUsdc: fee.toString(),
      txHash: buyTx.toLowerCase(),
      ts: now,
    });

    return c.json({
      ok: true,
      settlementTxHash: settleTx,
      betTxHash: buyTx,
      arcscanSettlement: `https://testnet.arcscan.app/tx/${settleTx}`,
      arcscanBet: `https://testnet.arcscan.app/tx/${buyTx}`,
      betReceipt: {
        marketId,
        marketAddress: market.address,
        outcome,
        shares: sharesStr,
        costUsdc: cost.toString(),
        feeUsdc: fee.toString(),
        totalPaidUsdc: totalNeeded.toString(),
        recipient,
        blockNumber: Number(buyReceipt!.blockNumber),
      },
    });
  });

  // ============================================================
  // Trader wallets — custodial Polymarket/Kalshi-style accounts
  // ============================================================

  const USDC_ERC20_ABI = [
    {
      inputs: [{ name: "account", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
      ],
      name: "transfer",
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "nonpayable",
      type: "function",
    },
  ] as const;

  /// HMAC the raw identity string before it touches the DB. Mitigates P1-F-004:
  /// a leaked DB no longer maps trivially back to "email:user@example.com" —
  /// the attacker also needs IDENTITY_HMAC_SECRET. Pure function, deterministic.
  function hmacIdentity(raw: string): string {
    return createHmac("sha256", env.IDENTITY_HMAC_SECRET).update(raw).digest("hex");
  }

  /// Issue (or fetch existing) custodial trader wallet for a FORUM identity.
  /// Identity = lowercase EVM address for wallet logins, or a sha256-hex digest
  /// for email/Google logins (client computes it). The server stores it as an
  /// opaque key and never echoes it back beyond confirming wallet existence.
  ///
  /// P1-F-004 — new rows store the HMAC'd identity. Lookup is two-step for
  /// backward-compat with pre-migration rows that still hold the raw value:
  ///   1. Try the hashed form (new rows)
  ///   2. Fall back to the raw form (legacy rows). If found, the row keeps its
  ///      raw identity in place — we don't rewrite it inline to avoid surprise
  ///      writes during a read path. A separate `scripts/migrate-identity-hmac.ts`
  ///      can sweep through and rewrite legacy rows during a maintenance window.
  app.post("/traders/issue", async (c) => {
    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      identity: z.string().min(8).max(128).regex(/^[a-z0-9:@_.-]+$/, "identity must be lowercase ascii"),
      /// P0-B audit — owner wallet that authenticated when claiming this
      /// trader. Required so the auth gate has someone to verify against.
      /// Console derives this from Dynamic's primaryWallet.address.
      ownerWallet: HexAddress.optional(),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const rawIdentity = parsed.data.identity.toLowerCase();
    const hashedIdentity = hmacIdentity(rawIdentity);
    const ownerWallet = parsed.data.ownerWallet?.toLowerCase() ?? null;

    // Two-step lookup. If a legacy raw row exists we keep using it (don't
    // overwrite during a request); migration script handles the rewrite.
    const byHash = (await db.select().from(traderWallets).where(eq(traderWallets.identity, hashedIdentity)))[0];
    if (byHash) {
      // Backfill owner_wallet on first authenticated re-issue if the row is
      // missing one (legacy rows minted pre-audit). One-shot: never overwrite
      // an existing binding, which would break the auth gate for that user.
      if (!byHash.ownerWallet && ownerWallet) {
        await db.update(traderWallets)
          .set({ ownerWallet })
          .where(eq(traderWallets.address, byHash.address));
      }
      return c.json({ address: byHash.address, isNew: false, faucetReceived: byHash.faucetReceived === 1 });
    }
    const byRaw = (await db.select().from(traderWallets).where(eq(traderWallets.identity, rawIdentity)))[0];
    if (byRaw) {
      if (!byRaw.ownerWallet && ownerWallet) {
        await db.update(traderWallets)
          .set({ ownerWallet })
          .where(eq(traderWallets.address, byRaw.address));
      }
      return c.json({ address: byRaw.address, isNew: false, faucetReceived: byRaw.faucetReceived === 1 });
    }

    const generated = generateTrader();
    const now = Math.floor(Date.now() / 1000);
    await db.insert(traderWallets)
      .values({
        identity: hashedIdentity,
        address: generated.address.toLowerCase(),
        encryptedPrivkey: generated.encryptedPrivkey,
        iv: generated.iv,
        authTag: generated.authTag,
        faucetReceived: 0,
        createdAt: now,
        ownerWallet,
      })
      ;

    bus.emit({ type: "trader.issued", identity: hashedIdentity, address: generated.address.toLowerCase(), ts: now });
    return c.json({ address: generated.address, isNew: true, faucetReceived: false });
  });

  /// Public balance + status read. Anyone can query — only the address is exposed.
  app.get("/traders/:address", async (c) => {
    const address = c.req.param("address").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw new HTTPException(400, { message: "address must be 0x + 40 hex" });
    }
    const row = (await db.select().from(traderWallets).where(eq(traderWallets.address, address)))[0];
    if (!row) throw new HTTPException(404, { message: "trader wallet not found" });

    let usdcBalance = "0";
    try {
      const bal = (await clients.publicClient.readContract({
        address: env.ARC_USDC as `0x${string}`,
        abi: USDC_ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      })) as bigint;
      usdcBalance = bal.toString();
    } catch {
      // network blip — return 0 rather than 5xx, balance is for display
    }

    return c.json({
      address: row.address,
      usdcBalance,
      usdcBalanceFormatted: formatUnits(BigInt(usdcBalance), 6),
      faucetReceived: row.faucetReceived === 1,
      createdAt: row.createdAt,
      ageSeconds: Math.floor(Date.now() / 1000) - row.createdAt,
    });
  });

  /// P2-B-003 — per-IP rate-limit on the faucet endpoint. Prior to this, the
  /// guard was only `faucet_received` on the trader_wallets row, so a single
  /// IP could mint unlimited traders via /traders/issue and drain the
  /// treasury one drip per identity. Memory store keyed by IP, 5 issues per
  /// IP per hour. Process-local — single-process market-api makes that fine.
  const FAUCET_IP_BUCKET = new Map<string, number[]>();
  const FAUCET_IP_LIMIT = 5;
  const FAUCET_IP_WINDOW_MS = 60 * 60 * 1000;
  function checkFaucetIpRate(ip: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const hits = (FAUCET_IP_BUCKET.get(ip) ?? []).filter((t) => now - t < FAUCET_IP_WINDOW_MS);
    if (hits.length >= FAUCET_IP_LIMIT) {
      const retryMs = FAUCET_IP_WINDOW_MS - (now - hits[0]!);
      return { allowed: false, retryAfterSec: Math.ceil(retryMs / 1000) };
    }
    hits.push(now);
    FAUCET_IP_BUCKET.set(ip, hits);
    return { allowed: true, retryAfterSec: 0 };
  }
  function callerIp(c: import("hono").Context): string {
    // Hono behind the node adapter exposes the socket via c.env.incoming when
    // present. Fall back to x-forwarded-for (set by the reverse proxy) and
    // finally to a fixed sentinel so the limiter still works.
    const fwd = c.req.header("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
    const remote = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })
      ?.incoming?.socket?.remoteAddress;
    return remote ?? "unknown";
  }

  /// Faucet — drip 1 USDC from the market-api treasury wallet. One-time per trader.
  /// Idempotent on faucet_received flag, NOT on tx — if the tx broadcast then the row
  /// will be flagged before we know it confirmed; second attempts return 409.
  app.post("/traders/:address/faucet", async (c) => {
    const address = c.req.param("address").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw new HTTPException(400, { message: "address must be 0x + 40 hex" });
    }
    const ip = callerIp(c);
    const rate = checkFaucetIpRate(ip);
    if (!rate.allowed) {
      c.header("Retry-After", String(rate.retryAfterSec));
      throw new HTTPException(429, {
        message: `faucet rate limit hit for this IP (5/hour). retry in ${rate.retryAfterSec}s`,
      });
    }
    const row = (await db.select().from(traderWallets).where(eq(traderWallets.address, address)))[0];
    if (!row) throw new HTTPException(404, { message: "trader wallet not found" });
    if (row.faucetReceived === 1) {
      throw new HTTPException(409, { message: "faucet already received for this trader" });
    }

    const amount = parseUnits("1", 6);
    let faucetTx: `0x${string}`;
    try {
      faucetTx = await withChainLock(async () => {
        const tx = await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: env.ARC_USDC as `0x${string}`,
          abi: USDC_ERC20_ABI,
          functionName: "transfer",
          args: [address as `0x${string}`, amount],
        });
        await waitWithRetry(clients.publicClient, tx);
        return tx;
      });
    } catch (err) {
      throw new HTTPException(502, { message: `faucet transfer failed: ${(err as Error).message}` });
    }

    const now = Math.floor(Date.now() / 1000);
    await db.update(traderWallets)
      .set({ faucetReceived: 1, lastUsedAt: now })
      .where(eq(traderWallets.address, address))
      ;

    bus.emit({
      type: "faucet.dripped",
      address,
      amountUsdc: amount.toString(),
      txHash: faucetTx.toLowerCase(),
      ts: now,
    });

    return c.json({
      address,
      amountUsdc: amount.toString(),
      txHash: faucetTx,
      explorer: `https://testnet.arcscan.app/tx/${faucetTx}`,
    });
  });

  /// Place a bet from a custodial trader wallet. Server decrypts the trader privkey,
  /// signs the intent + EIP-3009 transferWithAuthorization, then runs the same
  /// settle/approve/buyShares chain ops as the human /bets endpoint.
  ///
  /// Demo-grade auth (v0.1): possession of the trader address is sufficient. Bets
  /// are bounded by the trader's USDC balance, so abuse is naturally limited.
  /// v1.0 will require a Dynamic session JWT proving ownership of the identity.
  app.post("/traders/:address/bet", async (c) => {
    const address = c.req.param("address").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw new HTTPException(400, { message: "address must be 0x + 40 hex" });
    }
    // P0-B-002 — server is about to decrypt the trader privkey + broadcast.
    // Require EIP-712 proof of trader ownership before any sensitive work.
    await requireTraderAuth(c, address);

    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      marketId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      outcome: z.literal(0).or(z.literal(1)),
      /** USDC budget — converted to shares at 2× initial heuristic. */
      amountUsdc: z.string().regex(/^\d+(\.\d+)?$/),
      slippageBps: z.number().int().min(0).max(2_000).default(50),
      /** Optional M1 forecast trace sha256. Linked into bets.forecast_sha256
       *  so /traces/<hash> + the 🔒 pill light up automatically. */
      forecastSha256: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { marketId, outcome, amountUsdc, slippageBps, forecastSha256 } = parsed.data;
    const marketIdLower = marketId.toLowerCase() as `0x${string}`;

    const row = (await db.select().from(traderWallets).where(eq(traderWallets.address, address)))[0];
    if (!row) throw new HTTPException(404, { message: "trader wallet not found" });

    const market = (await db.select().from(markets).where(eq(markets.id, marketIdLower)))[0];
    if (!market) throw new HTTPException(404, { message: "market not found" });
    if (market.phase !== 0) throw new HTTPException(409, { message: "market not OPEN" });

    // Decrypt the trader privkey and build a viem account from it. Held only in
    // memory for the duration of this request.
    let traderAccount: ReturnType<typeof privateKeyToAccount>;
    try {
      const privkey = decryptTraderPrivkey({
        encryptedPrivkey: row.encryptedPrivkey,
        iv: row.iv,
        authTag: row.authTag,
      });
      traderAccount = privateKeyToAccount(privkey);
    } catch (err) {
      throw new HTTPException(500, { message: `trader privkey decrypt failed: ${(err as Error).message}` });
    }

    const traderAddr = traderAccount.address.toLowerCase();
    if (traderAddr !== address) {
      throw new HTTPException(500, { message: "decrypted privkey address mismatch — db tampered or master key wrong" });
    }

    // Convert USDC budget → shares (rough heuristic: at 50/50 init, 1 USDC ≈ 2 YES shares).
    const budget = parseUnits(amountUsdc, 6);
    const sharesWad = budget * 2n * 10n ** 12n;

    // Re-quote on-chain to know the actual cost before signing.
    let cost: bigint;
    try {
      cost = (await clients.publicClient.readContract({
        address: market.address as `0x${string}`,
        abi: ForexMarketAbi,
        functionName: "previewBuy",
        args: [outcome, sharesWad],
      })) as bigint;
    } catch (err) {
      throw new HTTPException(502, { message: `previewBuy reverted: ${(err as Error).message}` });
    }
    const fee = (cost * 200n) / 10_000n;
    const totalNeeded = cost + fee;
    const maxCost = totalNeeded + (totalNeeded * BigInt(slippageBps)) / 10_000n;

    // Verify the trader has enough USDC on-chain to settle.
    let traderUsdcBal: bigint;
    try {
      traderUsdcBal = (await clients.publicClient.readContract({
        address: env.ARC_USDC as `0x${string}`,
        abi: USDC_ERC20_ABI,
        functionName: "balanceOf",
        args: [traderAccount.address],
      })) as bigint;
    } catch (err) {
      throw new HTTPException(502, { message: `balance check failed: ${(err as Error).message}` });
    }
    if (traderUsdcBal < maxCost) {
      throw new HTTPException(402, {
        message: `insufficient USDC balance: trader has ${formatUnits(traderUsdcBal, 6)}, need ${formatUnits(maxCost, 6)} (incl. fee + slippage)`,
      });
    }

    // Build + sign intent (EIP-191 personal_sign of the canonical hash).
    const deadline = Math.floor(Date.now() / 1000) + 60;
    const nonceHex = randomNonce();
    const intent = {
      marketId: marketIdLower,
      outcome,
      shares: sharesWad.toString(),
      maxCost: maxCost.toString(),
      deadline,
      agent: traderAccount.address,
      nonce: nonceHex,
    };
    const intentHash = keccak256(
      encodePacked(
        ["bytes32", "uint8", "uint256", "uint256", "uint64", "address", "bytes32"],
        [
          intent.marketId,
          intent.outcome,
          BigInt(intent.shares),
          BigInt(intent.maxCost),
          BigInt(intent.deadline),
          intent.agent,
          intent.nonce as `0x${string}`,
        ],
      ),
    );
    // Note: the executeBet helper does not verify intent signatures (server is
    // signing on the trader's behalf — trust is rooted in the master key).

    // Sign EIP-3009 TransferWithAuthorization — value = maxCost so settle covers
    // both cost + fee even at upper slippage bound. Surplus refunds to trader
    // automatically since buyShares pulls exactly `totalNeeded` from market-api.
    const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
    const eip3009Sig = await traderAccount.signTypedData({
      domain: {
        name: "USDC",
        version: "2",
        chainId: env.ARC_CHAIN_ID,
        verifyingContract: env.ARC_USDC as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: traderAccount.address,
        to: clients.account.address,
        value: maxCost,
        validAfter,
        validBefore,
        nonce: nonceHex as `0x${string}`,
      },
    });
    if (eip3009Sig.length !== 132) {
      throw new HTTPException(500, { message: `unexpected EIP-3009 signature length: ${eip3009Sig.length}` });
    }
    const r = ("0x" + eip3009Sig.slice(2, 66)) as `0x${string}`;
    const s = ("0x" + eip3009Sig.slice(66, 130)) as `0x${string}`;
    const v = parseInt(eip3009Sig.slice(130, 132), 16);

    const result = await executeBet(
      { env, clients, db },
      {
        market,
        intent: { ...intent, marketId: intent.marketId, agent: intent.agent, nonce: intent.nonce as `0x${string}` },
        intentHash,
        authorization: {
          from: traderAccount.address,
          to: clients.account.address,
          value: maxCost,
          validAfter,
          validBefore,
          nonce: nonceHex as `0x${string}`,
          v,
          r,
          s,
        },
        ...(forecastSha256 ? { forecastSha256 } : {}),
      },
    );

    await db.update(traderWallets)
      .set({ lastUsedAt: Math.floor(Date.now() / 1000) })
      .where(eq(traderWallets.address, address))
      ;

    return c.json(result);
  });

  /// POST /traders/:traderAddress/unlock-insights
  /// Server-side x402 helper — runs the full nanopayment dance on behalf of
  /// the FORUM trader wallet so the UI doesn't need to surface EIP-712 signing.
  ///
  /// Flow:
  ///   1. Look up trader → ensure it exists + has >= 0.001 USDC on-chain.
  ///   2. If caller's trader == targetAgent's owner_identity → skip payment,
  ///      fetch insights directly with a synthetic "x-caller" header.
  ///   3. Otherwise fetch the 402 challenge from /agents/:target/insights,
  ///      decrypt trader privkey, sign the EIP-712 typedData, build
  ///      X-PAYMENT header, retry insights with header.
  ///   4. Return the premium payload + settlement tx hash + arcscan URL.
  app.post("/traders/:traderAddress/unlock-insights", async (c) => {
    const traderAddress = c.req.param("traderAddress").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(traderAddress)) {
      throw new HTTPException(400, { message: "traderAddress must be 0x + 40 hex" });
    }
    // P0-B-003 — gate trader-controlled spend behind EIP-712 identity proof.
    await requireTraderAuth(c, traderAddress);

    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      targetAgent: HexAddress,
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const targetAgent = parsed.data.targetAgent.toLowerCase();

    const row = (await db.select().from(traderWallets).where(eq(traderWallets.address, traderAddress)))[0];
    if (!row) throw new HTTPException(404, { message: "trader wallet not found" });

    const agentRow = (await db.select().from(agents).where(eq(agents.address, targetAgent)))[0];
    if (!agentRow) throw new HTTPException(404, { message: "agent not found" });

    // P1-B-001 — owner free-pass removed. Owners (now proven by the auth
    // gate above) still pay the 0.001 USDC nanopayment; they were previously
    // identified by an unauthenticated x-caller header.

    // Balance gate — must hold >= 0.001 USDC. Surface a 402 with a friendly
    // "deposit more first" message so the UI can route to faucet/withdraw.
    let traderBal: bigint;
    try {
      traderBal = (await clients.publicClient.readContract({
        address: env.ARC_USDC as `0x${string}`,
        abi: USDC_ERC20_ABI,
        functionName: "balanceOf",
        args: [traderAddress as `0x${string}`],
      })) as bigint;
    } catch (err) {
      throw new HTTPException(502, { message: `balance check failed: ${(err as Error).message}` });
    }
    if (traderBal < INSIGHTS_PRICE_USDC_BASE_UNITS) {
      throw new HTTPException(402, {
        message: `insufficient USDC — trader has ${formatUnits(traderBal, 6)}, need ${formatUnits(INSIGHTS_PRICE_USDC_BASE_UNITS, 6)}. Deposit more first.`,
      });
    }

    // Step 1: fetch the 402 challenge.
    const challengeReq = new Request(`http://internal/agents/${targetAgent}/insights`);
    const challengeRes = await app.fetch(challengeReq);
    if (challengeRes.status !== 402) {
      throw new HTTPException(500, { message: `expected 402 from insights, got ${challengeRes.status}` });
    }
    const challengeBody = (await challengeRes.json()) as {
      x402?: { extra?: { typedData?: unknown } };
    };
    const typedData = challengeBody.x402?.extra?.typedData as
      | undefined
      | {
          domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
          primaryType: "TransferWithAuthorization";
          types: Record<string, Array<{ name: string; type: string }>>;
          message: {
            to: `0x${string}`;
            value: string;
            validAfter: string;
            validBefore: string;
            nonce: `0x${string}`;
          };
        };
    if (!typedData) {
      throw new HTTPException(500, { message: "challenge missing extra.typedData" });
    }

    // Step 2: decrypt trader privkey + sign the typed data.
    let traderAccount: ReturnType<typeof privateKeyToAccount>;
    try {
      const privkey = decryptTraderPrivkey({
        encryptedPrivkey: row.encryptedPrivkey,
        iv: row.iv,
        authTag: row.authTag,
      });
      traderAccount = privateKeyToAccount(privkey);
    } catch (err) {
      throw new HTTPException(500, { message: `trader privkey decrypt failed: ${(err as Error).message}` });
    }
    if (traderAccount.address.toLowerCase() !== traderAddress) {
      throw new HTTPException(500, { message: "decrypted privkey address mismatch" });
    }

    const signature = await traderAccount.signTypedData({
      domain: typedData.domain,
      types: {
        TransferWithAuthorization: typedData.types.TransferWithAuthorization!,
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: traderAccount.address,
        to: typedData.message.to,
        value: BigInt(typedData.message.value),
        validAfter: BigInt(typedData.message.validAfter),
        validBefore: BigInt(typedData.message.validBefore),
        nonce: typedData.message.nonce,
      },
    });
    if (signature.length !== 132) {
      throw new HTTPException(500, { message: `unexpected signature length: ${signature.length}` });
    }
    const r = ("0x" + signature.slice(2, 66)) as `0x${string}`;
    const s = ("0x" + signature.slice(66, 130)) as `0x${string}`;
    const v = parseInt(signature.slice(130, 132), 16);

    // Step 3: build the X-PAYMENT header + retry insights with payment.
    const paymentHeader = Buffer.from(
      JSON.stringify({
        from: traderAccount.address,
        validAfter: typedData.message.validAfter,
        validBefore: typedData.message.validBefore,
        nonce: typedData.message.nonce,
        v,
        r,
        s,
      }),
      "utf8",
    ).toString("base64");

    const paidReq = new Request(
      `http://internal/agents/${targetAgent}/insights`,
      { headers: { "x-payment": paymentHeader } },
    );
    const paidRes = await app.fetch(paidReq);
    if (!paidRes.ok) {
      const text = await paidRes.text().catch(() => "");
      throw new HTTPException(502, {
        message: `paid insights call failed: ${paidRes.status} ${text.slice(0, 300)}`,
      });
    }
    const insights = (await paidRes.json()) as { settledTx?: string | null };
    const settlementTxHash = insights.settledTx ?? null;

    return c.json({
      ok: true,
      ownerFreePass: false,
      insights,
      settlementTxHash,
      arcscanUrl: settlementTxHash
        ? `https://testnet.arcscan.app/tx/${settlementTxHash}`
        : null,
    });
  });

  /// Claim winning shares for a custodial trader. Server decrypts the trader
  /// privkey, ensures the wallet has a tiny USDC gas float (Arc Testnet uses
  /// USDC as native gas), and broadcasts `ForexMarket.claim(outcome, shares)`
  /// from the trader's account. Payout USDC lands directly in the trader's
  /// wallet — no extra hop.
  ///
  /// Behavior:
  ///   - 404 if trader / market not found
  ///   - 409 if market not resolved (DB phase != 2)
  ///   - 200 with claimed=0 if trader holds no shares of the winning outcome
  ///     (idempotent — repeat clicks won't error)
  ///   - 200 with claimed>0 + txHash on success
  app.post("/traders/:address/claim", async (c) => {
    const address = c.req.param("address").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw new HTTPException(400, { message: "address must be 0x + 40 hex" });
    }
    // P0-B-005 — gate the gas-top-up + on-chain claim broadcast behind
    // EIP-712 identity proof. Without this, anyone could spam claims and
    // drain 0.1 USDC of treasury gas float per call.
    await requireTraderAuth(c, address);

    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      marketId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const marketId = parsed.data.marketId.toLowerCase() as `0x${string}`;

    const row = (await db.select().from(traderWallets).where(eq(traderWallets.address, address)))[0];
    if (!row) throw new HTTPException(404, { message: "trader wallet not found" });

    const market = (await db.select().from(markets).where(eq(markets.id, marketId)))[0];
    if (!market) throw new HTTPException(404, { message: "market not found" });
    if (market.phase !== 2 || market.winningOutcome === null || market.winningOutcome === undefined) {
      throw new HTTPException(409, { message: "market not resolved" });
    }
    // Invalid (winningOutcome=2) markets need a separate refund path — out of
    // scope for the manual claim button in v0.1.
    if (market.winningOutcome === 2) {
      throw new HTTPException(409, { message: "market resolved INVALID — use claimRefund (not yet exposed)" });
    }
    const outcome = market.winningOutcome as 0 | 1;

    // Decrypt the trader privkey + build the trader's walletClient.
    let traderAccount: ReturnType<typeof privateKeyToAccount>;
    try {
      const privkey = decryptTraderPrivkey({
        encryptedPrivkey: row.encryptedPrivkey,
        iv: row.iv,
        authTag: row.authTag,
      });
      traderAccount = privateKeyToAccount(privkey);
    } catch (err) {
      throw new HTTPException(500, { message: `trader privkey decrypt failed: ${(err as Error).message}` });
    }
    if (traderAccount.address.toLowerCase() !== address) {
      throw new HTTPException(500, { message: "decrypted privkey address mismatch" });
    }

    // Look up shares the trader owns on the winning side.
    const outcomeTokenAddr = (await clients.publicClient.readContract({
      address: market.address as `0x${string}`,
      abi: ForexMarketAbi,
      functionName: "outcomeToken",
    })) as `0x${string}`;
    const tokenId = (await clients.publicClient.readContract({
      address: outcomeTokenAddr,
      abi: OutcomeTokenAbi,
      functionName: "tokenIdOf",
      args: [marketId, outcome],
    })) as bigint;
    const shares = (await clients.publicClient.readContract({
      address: outcomeTokenAddr,
      abi: OutcomeTokenAbi,
      functionName: "balanceOf",
      args: [traderAccount.address, tokenId],
    })) as bigint;

    if (shares === 0n) {
      return c.json({
        marketId,
        outcome,
        shares: "0",
        claimedUsdc: "0",
        txHash: null,
        explorer: null,
        note: "trader holds no shares of the winning side (already claimed, or never won)",
      });
    }

    // Ensure the trader wallet has dust USDC to pay Arc Testnet gas. The
    // post-claim payout will dwarf the float by orders of magnitude — net
    // positive for the trader. Funded via the chain-write lock so we don't
    // race the claim broadcast.
    const GAS_FLOAT_MIN = 100_000n; // 0.1 USDC — comfortable headroom for Arc gas
    const GAS_FLOAT_TOP_UP = 100_000n; // 0.1 USDC top-up if dry

    const traderUsdcBalance = (await clients.publicClient.readContract({
      address: env.ARC_USDC as `0x${string}`,
      abi: USDC_ERC20_ABI,
      functionName: "balanceOf",
      args: [traderAccount.address],
    })) as bigint;

    if (traderUsdcBalance < GAS_FLOAT_MIN) {
      // Fund the trader from market-api wallet so they can sign + broadcast claim.
      try {
        await withChainLock(async () => {
          const fundTx = await clients.walletClient.writeContract({
            chain: arcTestnet,
            account: clients.account,
            address: env.ARC_USDC as `0x${string}`,
            abi: USDC_ERC20_ABI,
            functionName: "transfer",
            args: [traderAccount.address, GAS_FLOAT_TOP_UP],
          });
          await waitWithRetry(clients.publicClient, fundTx);
        });
      } catch (err) {
        throw new HTTPException(502, { message: `gas top-up failed: ${(err as Error).message}` });
      }
    }

    // Build a wallet client signed by the trader. Use the same nonceManager
    // strategy by attaching it to the trader account explicitly.
    const traderWalletClient = createTraderWallet({
      account: traderAccount,
      chain: arcTestnet,
      transport: traderHttp(env.ARC_RPC_URL),
    });

    let claimTx: `0x${string}`;
    try {
      claimTx = await withChainLock(async () => {
        const tx = await traderWalletClient.writeContract({
          chain: arcTestnet,
          account: traderAccount,
          address: market.address as `0x${string}`,
          abi: ForexMarketAbi,
          functionName: "claim",
          args: [outcome, shares],
        });
        await waitWithRetry(clients.publicClient, tx);
        return tx;
      });
    } catch (err) {
      throw new HTTPException(502, { message: `claim failed: ${(err as Error).message.slice(0, 300)}` });
    }

    // 1 USDC per winning share. Shares are WAD (1e18) → USDC base units (1e6).
    const expectedPayout = (shares * 1_000_000n) / 10n ** 18n;

    await db.update(traderWallets)
      .set({ lastUsedAt: Math.floor(Date.now() / 1000) })
      .where(eq(traderWallets.address, address))
      ;

    bus.emit({
      type: "claim.fired",
      marketId,
      agentAddress: traderAccount.address.toLowerCase(),

  /// Withdraw USDC from a custodial trader wallet to any external address.
  ///
  /// Mechanism: server signs an EIP-3009 transferWithAuthorization with
  /// from=trader, to=destination, value=amount. Market-api wallet broadcasts
  /// the tx and pays gas. Trader USDC moves directly to destination — no
  /// market-api custody hop, no second-tx required.
  ///
  /// Demo-grade auth (v0.1): possession of trader address is sufficient (same
  /// as /bet endpoint). v1.0 will gate on Dynamic session JWT.
  app.post("/traders/:address/withdraw", async (c) => {
    const address = c.req.param("address").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      throw new HTTPException(400, { message: "address must be 0x + 40 hex" });
    }
    // P0-B-001 — drain target. Withdraw signs an EIP-3009 from the trader's
    // custodial wallet to any external address. Require EIP-712 proof of
    // trader ownership before decrypting the privkey.
    await requireTraderAuth(c, address);

    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      destinationAddress: HexAddress,
      /** USDC amount in human-readable decimal, e.g. "0.50" or "20" */
      amountUsdc: z.string().regex(/^\d+(\.\d+)?$/),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { destinationAddress, amountUsdc } = parsed.data;
    const destinationLower = destinationAddress.toLowerCase();

    if (destinationLower === address) {
      throw new HTTPException(400, { message: "destination must differ from trader address" });
    }

    const row = (await db.select().from(traderWallets).where(eq(traderWallets.address, address)))[0];
    if (!row) throw new HTTPException(404, { message: "trader wallet not found" });

    let traderAccount: ReturnType<typeof privateKeyToAccount>;
    try {
      const privkey = decryptTraderPrivkey({
        encryptedPrivkey: row.encryptedPrivkey,
        iv: row.iv,
        authTag: row.authTag,
      });
      traderAccount = privateKeyToAccount(privkey);
    } catch (err) {
      throw new HTTPException(500, { message: `trader privkey decrypt failed: ${(err as Error).message}` });
    }
    if (traderAccount.address.toLowerCase() !== address) {
      throw new HTTPException(500, { message: "decrypted privkey address mismatch" });
    }

    const amount = parseUnits(amountUsdc, 6);
    if (amount <= 0n) {
      throw new HTTPException(400, { message: "amount must be > 0" });
    }

    // Balance check.
    let balance: bigint;
    try {
      balance = (await clients.publicClient.readContract({
        address: env.ARC_USDC as `0x${string}`,
        abi: USDC_ERC20_ABI,
        functionName: "balanceOf",
        args: [traderAccount.address],
      })) as bigint;
    } catch (err) {
      throw new HTTPException(502, { message: `balance check failed: ${(err as Error).message}` });
    }
    if (balance < amount) {
      throw new HTTPException(402, {
        message: `insufficient balance: have ${formatUnits(balance, 6)}, need ${formatUnits(amount, 6)}`,
      });
    }

    // Sign EIP-3009 — trader authorizes a USDC transfer DIRECTLY to the user's
    // chosen destination. market-api wallet broadcasts + pays gas.
    const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);
    const nonceHex = randomNonce();

    const sig = await traderAccount.signTypedData({
      domain: {
        name: "USDC",
        version: "2",
        chainId: env.ARC_CHAIN_ID,
        verifyingContract: env.ARC_USDC as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: traderAccount.address,
        to: destinationAddress as `0x${string}`,
        value: amount,
        validAfter,
        validBefore,
        nonce: nonceHex as `0x${string}`,
      },
    });
    if (sig.length !== 132) {
      throw new HTTPException(500, { message: `unexpected signature length: ${sig.length}` });
    }
    const r = ("0x" + sig.slice(2, 66)) as `0x${string}`;
    const s = ("0x" + sig.slice(66, 130)) as `0x${string}`;
    const v = parseInt(sig.slice(130, 132), 16);

    // Broadcast the authorization. Market-api wallet pays the gas — trader
    // doesn't need any USDC reserved for gas, all of their balance is withdrawable.
    let withdrawTx: `0x${string}`;
    try {
      withdrawTx = await withChainLock(async () => {
        const tx = await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: env.ARC_USDC as `0x${string}`,
          abi: USDC_TRANSFER_WITH_AUTH_ABI,
          functionName: "transferWithAuthorization",
          args: [
            traderAccount.address,
            destinationAddress as `0x${string}`,
            amount,
            validAfter,
            validBefore,
            nonceHex as `0x${string}`,
            v,
            r,
            s,
          ],
        });
        await waitWithRetry(clients.publicClient, tx);
        return tx;
      });
    } catch (err) {
      throw new HTTPException(502, { message: `withdraw broadcast failed: ${(err as Error).message}` });
    }

    await db.update(traderWallets)
      .set({ lastUsedAt: Math.floor(Date.now() / 1000) })
      .where(eq(traderWallets.address, address))
      ;

    return c.json({
      address,
      destinationAddress,
      amountUsdc: amount.toString(),
      txHash: withdrawTx,
      explorer: `https://testnet.arcscan.app/tx/${withdrawTx}`,
    });
  });

  // ============================================================
  // MARKETPLACE — copy-trade / buy / sell / rent endpoints
  // v0.1: persist intent to DB. M1 wires real on-chain escrow contracts.
  // ============================================================

  /// POST /marketplace/copy-trade
  /// Subscribe / unsubscribe a copy-trade relationship. When `active=true`,
  /// the agent-loop will mirror the target's bets at sizeMultiplier scale
  /// from the subscriber's trader wallet.
  app.post("/marketplace/copy-trade", async (c) => {
    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      subscriber: HexAddress,
      target: HexAddress,
      active: z.boolean(),
      sizeMultiplier: z.number().positive().max(2).default(0.25),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { subscriber, target, active, sizeMultiplier } = parsed.data;
    const now = Math.floor(Date.now() / 1000);
    // UPSERT — sqlite via INSERT OR REPLACE
    await db.execute(sql`
      INSERT INTO copy_trades (subscriber, target, active, size_multiplier, created_at)
      VALUES (${subscriber.toLowerCase()}, ${target.toLowerCase()}, ${active ? 1 : 0}, ${sizeMultiplier}, ${now})
      ON CONFLICT(subscriber, target) DO UPDATE SET
        active = excluded.active,
        size_multiplier = excluded.size_multiplier
    `);
    return c.json({
      ok: true,
      subscriber: subscriber.toLowerCase(),
      target: target.toLowerCase(),
      active,
      sizeMultiplier,
    });
  });

  /// GET /marketplace/copy-trades/:subscriber
  /// List active copy-trade subscriptions for a wallet.
  app.get("/marketplace/copy-trades/:subscriber", async (c) => {
    const subscriber = c.req.param("subscriber").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(subscriber)) {
      throw new HTTPException(400, { message: "invalid subscriber address" });
    }
    const rows = ((await db.execute(
      sql`SELECT target, active, size_multiplier, created_at FROM copy_trades WHERE subscriber = ${subscriber} AND active = 1`
    )) as unknown as { target: string; active: number; size_multiplier: number; created_at: number }[]);
    return c.json({ subscriber, subscriptions: rows });
  });

  /// POST /marketplace/rent
  /// M3 v0.1 — REAL USDC PAYMENT. Charges the renter's trader wallet
  /// priceUsdc via EIP-3009 transferWithAuthorization → agentAddress (the
  /// agent collects its own rent). On success auto-inserts the
  /// copy_trades row so the renter immediately starts mirroring the
  /// agent's bets at sizeMultiplier=0.25.
  app.post("/marketplace/rent", async (c) => {
    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      renter: HexAddress,
      agentAddress: HexAddress,
      durationHours: z.number().int().min(6).max(720),
      priceUsdc: z.string().regex(/^[0-9]+$/), // USDC base units (6 decimals)
      sizeMultiplier: z.number().positive().max(2).default(0.25),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { renter, agentAddress, durationHours, priceUsdc: clientPriceUsdc, sizeMultiplier } = parsed.data;
    const renterAddr = renter.toLowerCase();
    const agentAddr = agentAddress.toLowerCase();
    // P0-B-009 — gate the renter-side EIP-3009 broadcast behind identity proof.
    await requireTraderAuth(c, renterAddr);

    // M13 gate — target persona must have LLM credentials to rent. Default
    // reference agents (no agents row OR owner_identity NULL) bypass this
    // since their keys are configured at runner-env level, not in the DB.
    const targetAgent = (await db.select().from(agents).where(eq(agents.address, agentAddr)))[0];
    if (targetAgent && targetAgent.ownerIdentity && !targetAgent.aiApiKeyEncrypted) {
      throw new HTTPException(400, {
        message: "This persona is not currently active (owner has not set LLM credentials).",
      });
    }

    // 2026-05-19 — owner-set rent prices. If the agent has a listing,
    // the owner's chosen price for the requested duration tier wins
    // (server source of truth, prevents tampering via client-supplied
    // priceUsdc). If the requested tier was NOT offered by the owner
    // (column NULL), reject. If the agent has no listing — i.e. it's
    // one of the 5 reference agents (Oracle/Sage/Hermes/Augur/Mirror)
    // which are protocol-owned and not listable — fall back to the
    // client-supplied priceUsdc, matching pre-existing v0.1 behavior.
    const tierCol = (() => {
      if (durationHours === 6) return "rent_6h_usdc" as const;
      if (durationHours === 24) return "rent_24h_usdc" as const;
      if (durationHours === 168) return "rent_week_usdc" as const;
      if (durationHours === 720) return "rent_month_usdc" as const;
      return null;
    })();
    const listingRow = ((await db.execute(sql`
      SELECT rent_6h_usdc, rent_24h_usdc, rent_week_usdc, rent_month_usdc, sold_to
      FROM agent_listings WHERE agent_address = ${agentAddr}
    `)) as unknown as {
      rent_6h_usdc: string | null;
      rent_24h_usdc: string | null;
      rent_week_usdc: string | null;
      rent_month_usdc: string | null;
      sold_to: string | null;
    }[])[0];
    let priceUsdc: string;
    if (listingRow && listingRow.sold_to === null) {
      // Listed by an owner — use their tier price.
      if (!tierCol) {
        throw new HTTPException(400, {
          message: "rent tier not offered by owner (only 6h / 24h / 1 week / 1 month supported)",
        });
      }
      const ownerPrice = listingRow[tierCol];
      if (!ownerPrice || BigInt(ownerPrice) <= 0n) {
        throw new HTTPException(400, { message: "rent tier not offered by owner" });
      }
      priceUsdc = ownerPrice;
    } else {
      // No listing → protocol-owned reference agent. Trust the client's
      // tier table (RENT_TIERS on /marketplace) for these.
      priceUsdc = clientPriceUsdc;
    }
    const amount = BigInt(priceUsdc);

    // Look up renter's encrypted trader-wallet privkey.
    const row = (await db
      .select()
      .from(traderWallets)
      .where(eq(traderWallets.address, renterAddr)))[0];
    if (!row) {
      throw new HTTPException(404, {
        message: "renter trader wallet not found — claim one via /traders/issue first",
      });
    }
    let traderAccount: ReturnType<typeof privateKeyToAccount>;
    try {
      const privkey = decryptTraderPrivkey({
        encryptedPrivkey: row.encryptedPrivkey,
        iv: row.iv,
        authTag: row.authTag,
      });
      traderAccount = privateKeyToAccount(privkey);
    } catch (err) {
      throw new HTTPException(500, { message: `renter privkey decrypt failed: ${(err as Error).message}` });
    }
    if (traderAccount.address.toLowerCase() !== renterAddr) {
      throw new HTTPException(500, { message: "decrypted privkey address mismatch" });
    }

    // Balance check before signing.
    let balance: bigint;
    try {
      balance = (await clients.publicClient.readContract({
        address: env.ARC_USDC as `0x${string}`,
        abi: USDC_ERC20_ABI,
        functionName: "balanceOf",
        args: [traderAccount.address],
      })) as bigint;
    } catch (err) {
      throw new HTTPException(502, { message: `balance check failed: ${(err as Error).message}` });
    }
    if (balance < amount) {
      throw new HTTPException(402, {
        message: `insufficient renter balance: have ${formatUnits(balance, 6)}, need ${formatUnits(amount, 6)} USDC`,
      });
    }

    // Sign + broadcast EIP-3009 renter → agent.
    const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);
    const nonceHex = randomNonce();
    const sig = await traderAccount.signTypedData({
      domain: {
        name: "USDC", version: "2",
        chainId: env.ARC_CHAIN_ID,
        verifyingContract: env.ARC_USDC as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: traderAccount.address,
        to: agentAddr as `0x${string}`,
        value: amount, validAfter, validBefore,
        nonce: nonceHex as `0x${string}`,
      },
    });
    const r = ("0x" + sig.slice(2, 66)) as `0x${string}`;
    const s = ("0x" + sig.slice(66, 130)) as `0x${string}`;
    const v = parseInt(sig.slice(130, 132), 16);

    let rentTx: `0x${string}`;
    try {
      rentTx = await withChainLock(async () => {
        const tx = await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: env.ARC_USDC as `0x${string}`,
          abi: USDC_TRANSFER_WITH_AUTH_ABI,
          functionName: "transferWithAuthorization",
          args: [
            traderAccount.address, agentAddr as `0x${string}`,
            amount, validAfter, validBefore, nonceHex as `0x${string}`,
            v, r, s,
          ],
        });
        await waitWithRetry(clients.publicClient, tx);
        return tx;
      });
    } catch (err) {
      throw new HTTPException(502, { message: `rent broadcast failed: ${(err as Error).message}` });
    }

    const now = Math.floor(Date.now() / 1000);

    // M6 fix — if the renter already has an active rental on this agent,
    // EXTEND it instead of inserting a duplicate row. New ends_at = max
    // of (existing ends_at + durationHours*3600, now + durationHours*3600).
    // The renter still pays the full priceUsdc (which we just broadcast),
    // so the bookkeeping needs to reflect the total paid across extensions
    // — we sum into price_usdc and append the new tx hash with a separator.
    const existingActive = ((await db.execute(sql`
      SELECT starts_at, ends_at, price_usdc, tx_hash
      FROM agent_rentals
      WHERE renter = ${renterAddr} AND agent_address = ${agentAddr} AND ends_at > ${now}
      ORDER BY ends_at DESC LIMIT 1
    `)) as unknown as {
      starts_at: number; ends_at: number; price_usdc: string; tx_hash: string | null;
    }[])[0];

    let endsAt: number;
    if (existingActive) {
      const extendedEndsAt = Math.max(existingActive.ends_at, now) + durationHours * 3600;
      const combinedPrice = (BigInt(existingActive.price_usdc) + BigInt(priceUsdc)).toString();
      const combinedTx = existingActive.tx_hash
        ? `${existingActive.tx_hash},${rentTx}`
        : rentTx;
      await db.execute(sql`
        UPDATE agent_rentals
           SET ends_at = ${extendedEndsAt},
               price_usdc = ${combinedPrice},
               tx_hash = ${combinedTx},
               duration_hours = duration_hours + ${durationHours}
         WHERE renter = ${renterAddr}
           AND agent_address = ${agentAddr}
           AND starts_at = ${existingActive.starts_at}
      `);
      endsAt = extendedEndsAt;
    } else {
      endsAt = now + durationHours * 3600;
      await db.execute(sql`
        INSERT INTO agent_rentals (renter, agent_address, duration_hours, price_usdc, starts_at, ends_at, created_at, tx_hash)
        VALUES (${renterAddr}, ${agentAddr}, ${durationHours}, ${priceUsdc}, ${now}, ${endsAt}, ${now}, ${rentTx})
      `);
    }

    await db.execute(sql`
      INSERT INTO copy_trades (subscriber, target, active, size_multiplier, created_at)
      VALUES (${renterAddr}, ${agentAddr}, 1, ${sizeMultiplier}, ${now})
      ON CONFLICT(subscriber, target) DO UPDATE SET
        active = 1,
        size_multiplier = excluded.size_multiplier
    `);

    return c.json({
      ok: true,
      renter: renterAddr,
      agentAddress: agentAddr,
      durationHours,
      priceUsdc,
      sizeMultiplier,
      startsAt: now,
      endsAt,
      txHash: rentTx,
      explorer: `https://testnet.arcscan.app/tx/${rentTx}`,
    });
  });

  /// GET /marketplace/strategies
  /// The library of pre-built strategies a user can pick at agent-spawn time.
  app.get("/marketplace/strategies", (c) => {
    return c.json({ count: STRATEGIES.length, strategies: STRATEGIES });
  });

  /// ──────────────────────────────────────────────────────────────────
  /// M7 — Circle CCTP V2 cross-chain funding (Base → Arc, others later)
  /// ──────────────────────────────────────────────────────────────────
  /// The flow:
  ///   1. User burns USDC on Base via Circle's `TokenMessengerV2.depositForBurn`.
  ///   2. Frontend polls GET /cctp/attestation/:burnTx — we proxy to Circle's
  ///      IRIS attestation service. Returns "pending" until attestation is ready.
  ///   3. Once ready, frontend POSTs /cctp/receive with the attestation; we
  ///      submit `MessageTransmitterV2.receiveMessage` on Arc on the user's
  ///      behalf (we pay the Arc gas) and the USDC mints to the recipient
  ///      address the user encoded in the burn.
  ///
  /// This is the "Circle Gateway / App Kit Bridge" funding flow stripped to
  /// its CCTP V2 primitive — no Circle Gateway SDK dependency, just raw
  /// IRIS + MessageTransmitterV2. Once Circle Gateway is broadly available
  /// on Arc Testnet via App Kit, we can swap the UI to that drop-in widget;
  /// the backend stays unchanged because Gateway calls into the same CCTP V2
  /// receive on Arc.

  /// CCTP V2 source-chain config — the burn happens on these. Frontend uses
  /// /cctp/burn-config/:chain to surface the right addresses for MetaMask.
  type CctpChain = {
    label: string;
    chainId: number;
    domain: number;
    usdc: `0x${string}`;
    tokenMessenger: `0x${string}`;
    messageTransmitter: `0x${string}`;
    explorer: string;
    finalityMin: number;
  };
  const CCTP_SOURCES: Record<string, CctpChain> = {
    "base-sepolia": {
      label: "Base Sepolia",
      chainId: 84532,
      domain: 6,
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
      messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
      explorer: "https://sepolia.basescan.org",
      finalityMin: 13,
    },
    "ethereum-sepolia": {
      label: "Ethereum Sepolia",
      chainId: 11155111,
      domain: 0,
      usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
      messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
      explorer: "https://sepolia.etherscan.io",
      finalityMin: 19,
    },
    "arbitrum-sepolia": {
      label: "Arbitrum Sepolia",
      chainId: 421614,
      domain: 3,
      usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
      messageTransmitter: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
      explorer: "https://sepolia.arbiscan.io",
      finalityMin: 13,
    },
  };
  /// Arc Testnet's CCTP V2 destination domain — verified on-chain via
  /// MessageTransmitterV2.localDomain() at 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275.
  /// Used as the `destinationDomain` arg in `depositForBurn` on the source chain.
  /// Earlier we had 11 here (wrong — burns went to a different chain's domain
  /// and reverted on Arc with "Invalid destination domain"). The boot-time
  /// self-check below guards against drift.
  const ARC_CCTP_DOMAIN = 26;

  /// Boot-time self-check: confirm the on-chain MessageTransmitterV2.localDomain()
  /// matches our constant. Mismatch → loud [FATAL] log so future redeployments
  /// to a different Arc env (or a Circle redomain) get caught instantly.
  /// Non-crashing — backend keeps serving, but CCTP receives will revert until fixed.
  void (async () => {
    try {
      const onChain = (await clients.publicClient.readContract({
        address: env.ARC_CCTP_MESSAGE_TRANSMITTER as `0x${string}`,
        abi: [{
          type: "function",
          name: "localDomain",
          inputs: [],
          outputs: [{ name: "", type: "uint32" }],
          stateMutability: "view",
        }] as const,
        functionName: "localDomain",
      })) as number;
      if (Number(onChain) !== ARC_CCTP_DOMAIN) {
        console.error(
          `[FATAL] CCTP domain mismatch: ARC_CCTP_DOMAIN=${ARC_CCTP_DOMAIN} but ` +
            `MessageTransmitterV2(${env.ARC_CCTP_MESSAGE_TRANSMITTER}).localDomain()=${onChain}. ` +
            `Cross-chain receives will revert with "Invalid destination domain" until the constant is updated.`,
        );
      } else {
        console.log(`[forum/market-api] CCTP domain self-check OK: Arc localDomain=${onChain}`);
      }
    } catch (err) {
      console.error(
        `[FATAL] CCTP domain self-check failed (RPC unreachable?): ${(err as Error).message}`,
      );
    }
  })();

  /// GET /cctp/burn-config/:chain
  /// Returns everything the frontend needs to ask the user's wallet to burn
  /// USDC on the source chain: contract addresses, domain id, recipient
  /// (encoded as bytes32 on the destination).
  app.get("/cctp/burn-config/:chain", (c) => {
    const chain = c.req.param("chain").toLowerCase();
    const config = CCTP_SOURCES[chain];
    if (!config) {
      throw new HTTPException(404, {
        message: `unknown source chain: ${chain}. supported: ${Object.keys(CCTP_SOURCES).join(", ")}`,
      });
    }
    return c.json({
      source: config,
      destination: {
        label: "Arc Testnet",
        chainId: env.ARC_CHAIN_ID,
        domain: ARC_CCTP_DOMAIN,
        usdc: env.ARC_USDC,
        messageTransmitter: env.ARC_CCTP_MESSAGE_TRANSMITTER,
        tokenMessenger: env.ARC_CCTP_TOKEN_MESSENGER,
        explorer: "https://testnet.arcscan.app",
      },
    });
  });

  /// GET /cctp/sources — list of supported source chains for the UI picker.
  app.get("/cctp/sources", (c) => {
    return c.json({
      sources: Object.entries(CCTP_SOURCES).map(([id, s]) => ({ id, ...s })),
      destination: {
        chainId: env.ARC_CHAIN_ID,
        domain: ARC_CCTP_DOMAIN,
      },
    });
  });

  /// GET /cctp/attestation/:burnTx
  /// Proxies Circle's IRIS attestation API. Returns:
  ///   { status: "pending" } — still waiting for soft finality
  ///   { status: "ready", messages: [{ message, attestation }] } — submit receiveMessage
  ///   { status: "not_found" } — burn tx not seen by IRIS (yet — retry later)
  /// IRIS V2 endpoint shape: GET /v2/messages/{sourceDomain}?transactionHash=<txHash>
  app.get("/cctp/attestation/:burnTx", async (c) => {
    const burnTx = c.req.param("burnTx").toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(burnTx)) {
      throw new HTTPException(400, { message: "burnTx must be 0x + 64 hex" });
    }
    const sourceDomain = c.req.query("sourceDomain");
    if (!sourceDomain || !/^\d+$/.test(sourceDomain)) {
      throw new HTTPException(400, { message: "sourceDomain query param required (numeric)" });
    }
    const url = `${env.CIRCLE_IRIS_API_URL}/v2/messages/${sourceDomain}?transactionHash=${burnTx}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.status === 404) return c.json({ status: "not_found" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new HTTPException(502, { message: `IRIS ${res.status}: ${text.slice(0, 200)}` });
      }
      const data = (await res.json()) as {
        messages?: Array<{ message?: string; attestation?: string; status?: string }>;
      };
      const messages = data.messages ?? [];
      const ready = messages.length > 0 && messages.every((m) => m.attestation && m.attestation !== "PENDING");
      return c.json({
        status: ready ? "ready" : "pending",
        messages: messages.map((m) => ({
          message: m.message ?? null,
          attestation: m.attestation ?? null,
          status: m.status ?? null,
        })),
      });
    } catch (err) {
      if (err instanceof HTTPException) throw err;
      throw new HTTPException(502, { message: `attestation poll failed: ${(err as Error).message}` });
    }
  });

  /// POST /cctp/receive
  /// Submits MessageTransmitterV2.receiveMessage on Arc Testnet. The market-api
  /// treasury wallet pays the Arc gas — this is the custodial part of the flow.
  /// The mint is fully determined by `message` (encoded by Circle on the source
  /// chain), so the recipient address is whatever the user put in their burn —
  /// we cannot redirect the mint. This makes the endpoint safe to expose.
  app.post("/cctp/receive", async (c) => {
    // Treasury pays gas to broadcast the receiveMessage tx. Cap per-IP to
    // prevent DoS / griefing — legitimate CCTP flows complete in seconds,
    // so 5/min is generous for a single user but lethal for a spammer.
    checkRateLimit(c, "cctp.receive", 5, 60_000);
    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      message: z.string().regex(/^0x[a-fA-F0-9]+$/, "message must be 0x hex"),
      attestation: z.string().regex(/^0x[a-fA-F0-9]+$/, "attestation must be 0x hex"),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { message, attestation } = parsed.data;

    const ReceiveAbi = [{
      type: "function",
      name: "receiveMessage",
      inputs: [
        { name: "message", type: "bytes" },
        { name: "attestation", type: "bytes" },
      ],
      outputs: [{ name: "success", type: "bool" }],
      stateMutability: "nonpayable",
    }] as const;

    try {
      const tx = await withChainLock(async () => {
        const h = await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: env.ARC_CCTP_MESSAGE_TRANSMITTER as `0x${string}`,
          abi: ReceiveAbi,
          functionName: "receiveMessage",
          args: [message as `0x${string}`, attestation as `0x${string}`],
        });
        await waitWithRetry(clients.publicClient, h);
        return h;
      });
      return c.json({
        ok: true,
        txHash: tx,
        explorer: `https://testnet.arcscan.app/tx/${tx}`,
      });
    } catch (err) {
      throw new HTTPException(502, { message: `receiveMessage failed: ${(err as Error).message}` });
    }
  });

  /// GET /marketplace/rentals/active
  /// Server-side runner endpoint used by `apps/rental-orchestrator`. Returns
  /// every rental whose window is currently open (starts_at ≤ now < ends_at).
  /// No per-renter enrichment — the orchestrator only needs the renter address,
  /// the rented agent's address, and the rental window so it can dispatch the
  /// agent's strategy from the renter's custodial trader wallet.
  app.get("/marketplace/rentals/active", async (c) => {
    const now = Math.floor(Date.now() / 1000);
    const rows = ((await db.execute(sql`
      SELECT renter, agent_address, starts_at, ends_at
      FROM agent_rentals
      WHERE starts_at <= ${now} AND ends_at > ${now}
      ORDER BY ends_at ASC
    `)) as unknown as {
      renter: string; agent_address: string; starts_at: number; ends_at: number;
    }[]);
    return c.json({
      count: rows.length,
      now,
      rentals: rows.map((r) => ({
        renter: r.renter,
        agentAddress: r.agent_address,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
      })),
    });
  });

  /// GET /marketplace/rentals/:renter
  /// M6 — list active + recent rentals for a renter. Each row carries the
  /// agent's persona details and the 3 most-recent bets so the renter can
  /// see what they're paying for in their "My Rentals" panel.
  app.get("/marketplace/rentals/:renter", async (c) => {
    const renter = c.req.param("renter").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(renter)) {
      throw new HTTPException(400, { message: "invalid renter address" });
    }
    const now = Math.floor(Date.now() / 1000);
    const rentalRows = ((await db.execute(sql`
      SELECT agent_address, duration_hours, price_usdc, starts_at, ends_at, created_at, tx_hash
      FROM agent_rentals
      WHERE renter = ${renter}
      ORDER BY ends_at DESC
      LIMIT 50
    `)) as unknown as {
      agent_address: string; duration_hours: number; price_usdc: string;
      starts_at: number; ends_at: number; created_at: number; tx_hash: string | null;
    }[]);
    const enriched = await Promise.all(rentalRows.map(async (r) => {
      const a = (await db.select().from(agents).where(eq(agents.address, r.agent_address)))[0];
      const recentBets = await db
        .select({
          id: bets.id, marketId: bets.marketId, outcome: bets.outcome,
          costUsdc: bets.costUsdc, marketTxHash: bets.marketTxHash, createdAt: bets.createdAt,
        })
        .from(bets)
        .where(eq(bets.agentAddress, r.agent_address))
        .orderBy(desc(bets.id))
        .limit(3);
      const copyRow = ((await db.execute(sql`
        SELECT active, size_multiplier FROM copy_trades
        WHERE subscriber = ${renter} AND target = ${r.agent_address}
        LIMIT 1
      `)) as unknown as { active: number; size_multiplier: number }[])[0];
      return {
        agentAddress: r.agent_address,
        personaLabel: a?.personaLabel ?? a?.name ?? null,
        strategyId: a?.strategyId ?? null,
        avatarEmoji: a?.avatarEmoji ?? null,
        verified: a?.verified === 1,
        durationHours: r.duration_hours,
        priceUsdc: r.price_usdc,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        createdAt: r.created_at,
        txHash: r.tx_hash,
        isActive: r.ends_at > now,
        secondsRemaining: Math.max(0, r.ends_at - now),
        copyTrade: copyRow ? {
          active: copyRow.active === 1,
          sizeMultiplier: copyRow.size_multiplier,
        } : null,
        recentBets,
      };
    }));
    return c.json({
      renter,
      count: enriched.length,
      active: enriched.filter((r) => r.isActive).length,
      rentals: enriched,
    });
  });

  /// GET /marketplace/earnings/:agent
  /// M6 — owner-side earnings view for a single agent.
  /// Sum of historic rents + active rental count + copy-trade subscriber count.
  app.get("/marketplace/earnings/:agent", async (c) => {
    const agentAddr = c.req.param("agent").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(agentAddr)) {
      throw new HTTPException(400, { message: "invalid agent address" });
    }
    const now = Math.floor(Date.now() / 1000);
    const rentalRows = ((await db.execute(sql`
      SELECT renter, duration_hours, price_usdc, starts_at, ends_at, created_at, tx_hash
      FROM agent_rentals
      WHERE agent_address = ${agentAddr}
      ORDER BY created_at DESC
      LIMIT 100
    `)) as unknown as {
      renter: string; duration_hours: number; price_usdc: string;
      starts_at: number; ends_at: number; created_at: number; tx_hash: string | null;
    }[]);
    let totalRentUsdc = 0n;
    let activeRentals = 0;
    for (const r of rentalRows) {
      totalRentUsdc += BigInt(r.price_usdc);
      if (r.ends_at > now) activeRentals += 1;
    }
    const subRow = ((await db.execute(sql`
      SELECT COUNT(*) as count FROM copy_trades
      WHERE target = ${agentAddr} AND active = 1
    `)) as unknown as { count: number }[])[0];
    const subscriberCount = subRow?.count ?? 0;
    return c.json({
      agent: agentAddr,
      totalRentUsdc: totalRentUsdc.toString(),
      activeRentals,
      historyCount: rentalRows.length,
      subscriberCount,
      rentals: rentalRows.map((r) => ({
        renter: r.renter,
        durationHours: r.duration_hours,
        priceUsdc: r.price_usdc,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        createdAt: r.created_at,
        txHash: r.tx_hash,
        isActive: r.ends_at > now,
      })),
    });
  });

  /// POST /agents/:address/update
  /// M6 — owner-only persona edit. Updates label, strategyId, avatar emoji.
  /// M13 — also updates AI provider/key/baseUrl/model. Empty-string apiKey
  /// clears the stored key (config-pending). Owner is verified by comparing
  /// the supplied identity against agents.owner_identity. Default agents
  /// (no owner) reject all updates.
  app.post("/agents/:address/update", async (c) => {
    const target = c.req.param("address").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(target)) {
      throw new HTTPException(400, { message: "invalid agent address" });
    }
    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      identity: z.string().regex(/^0x[a-fA-F0-9]{40,64}$/),
      personaLabel: z.string().min(2).max(48).optional(),
      strategyId: z.enum(["standard","conservative","contrarian","edge_weighted","copy_oracle","consensus"]).optional(),
      avatarEmoji: z.string().min(1).max(8).optional(),
      aiProvider: z.enum(["claude","openai","gemini","deepseek","xai","mimo","custom"]).optional(),
      /** Supply a non-empty string to rotate the key; supply "" to clear it. */
      aiApiKey: z.string().max(512).optional(),
      aiBaseUrl: z.union([z.string().url().max(256), z.literal("")]).optional(),
      aiModel: z.string().max(128).optional(),
      /** Demo affordance — flip the persona onto the shared MiMo key. */
      useDemoMimoKey: z.boolean().optional(),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { identity, personaLabel, strategyId, avatarEmoji, aiProvider, aiApiKey, aiBaseUrl, aiModel, useDemoMimoKey } = parsed.data;
    const ident = identity.toLowerCase();
    const row = (await db.select().from(agents).where(eq(agents.address, target)))[0];
    if (!row) throw new HTTPException(404, { message: "agent not found" });
    if (!row.ownerIdentity) {
      throw new HTTPException(403, { message: "default agents are not editable" });
    }
    if (row.ownerIdentity !== ident) {
      throw new HTTPException(403, { message: "only the owner identity can update this agent" });
    }
    // P0-B-007 — without auth, anyone could submit `identity: <victim's owner>`
    // and rotate the victim's LLM API key. Require EIP-712 proof of the
    // owner identity (which for spawned agents IS a trader address).
    await requireTraderAuth(c, row.ownerIdentity);
    const updates: Partial<typeof row> = {};
    if (personaLabel !== undefined) {
      updates.personaLabel = personaLabel;
      updates.name = personaLabel;
    }
    if (strategyId !== undefined) {
      const strategy = getStrategy(strategyId);
      if (!strategy) throw new HTTPException(400, { message: `unknown strategy: ${strategyId}` });
      updates.strategyId = strategyId;
    }
    if (avatarEmoji !== undefined) updates.avatarEmoji = avatarEmoji;

    // AI config — provider auto-detected from a non-empty baseUrl when
    // not given explicitly.
    if (aiProvider !== undefined) updates.aiProvider = aiProvider;
    if (aiBaseUrl !== undefined) {
      updates.aiBaseUrl = aiBaseUrl === "" ? null : aiBaseUrl;
      if (aiProvider === undefined && aiBaseUrl !== "") {
        updates.aiProvider = detectProvider(aiBaseUrl);
      }
    }
    if (aiModel !== undefined) updates.aiModel = aiModel === "" ? null : aiModel;
    // Demo toggle takes precedence — flip to shared sentinel, ignore any
    // raw aiApiKey in the same payload. Defense-in-depth: also gate on env.
    if (useDemoMimoKey === true && !!process.env["FORUM_DEMO_MIMO_KEY"]) {
      updates.aiApiKeyEncrypted = "SHARED_DEMO";
      updates.aiKeyIv = null;
      updates.aiKeyAuthTag = null;
      if (updates.aiProvider === undefined) updates.aiProvider = "mimo";
      if (updates.aiBaseUrl === undefined) updates.aiBaseUrl = "https://api.xiaomimimo.com/v1";
      if (updates.aiModel === undefined) updates.aiModel = "mimo-v2.5-pro";
    } else if (aiApiKey !== undefined) {
      if (aiApiKey === "") {
        // Explicit clear — config-pending state.
        updates.aiApiKeyEncrypted = null;
        updates.aiKeyIv = null;
        updates.aiKeyAuthTag = null;
      } else {
        if (aiApiKey.length < 8) {
          throw new HTTPException(400, { message: "aiApiKey must be ≥ 8 chars or empty to clear" });
        }
        try {
          const enc = encryptApiKey(aiApiKey);
          updates.aiApiKeyEncrypted = enc.ciphertext;
          updates.aiKeyIv = enc.iv;
          updates.aiKeyAuthTag = enc.authTag;
        } catch (err) {
          throw new HTTPException(500, { message: `api key encrypt failed: ${(err as Error).message}` });
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ ok: true, noop: true, agent: redactAgent(row) });
    }
    await db.update(agents).set(updates).where(eq(agents.address, target));
    const after = (await db.select().from(agents).where(eq(agents.address, target)))[0];
    return c.json({ ok: true, agent: after ? redactAgent(after) : null });
  });

  /// POST /agents/spawn
  /// User creates a custom agent persona: generates a fresh trader wallet
  /// tied to their identity, registers an agents row with the picked
  /// strategy_id + label. Agent-loop on the next tick picks up the new row
  /// and starts trading per the strategy.
  ///
  /// M13 — optional AI provider config (aiProvider, aiApiKey, aiBaseUrl,
  /// aiModel). When supplied, the apiKey is AES-256-GCM-encrypted under
  /// TRADER_MASTER_KEY before insert. When aiBaseUrl is given without
  /// aiProvider, we auto-detect from URL host (api.openai.com → openai etc.).
  /// Persona spawns with no key are "config-pending" — the persona runner
  /// SKIPS these rows entirely so they never bet until the owner sets a key.
  ///
  /// Demo affordance: when `useDemoMimoKey: true` and FORUM_DEMO_MIMO_KEY is
  /// set in the env, the persona inherits a sentinel "SHARED_DEMO" value
  /// for ai_api_key_encrypted. The runner detects this and substitutes
  /// the env value at call time (rate-limited at 10 forecasts/day per
  /// persona). Lets demos go live without a real API key paste on stage.
  app.post("/agents/spawn", async (c) => {
    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      identity:    z.string().regex(/^0x[a-fA-F0-9]{40,64}$/),
      label:       z.string().min(2).max(48),
      strategyId:  z.enum(["standard","conservative","contrarian","edge_weighted","copy_oracle","consensus"]),
      llmModel:    z.string().max(64).optional(),
      aiProvider:  z.enum(["claude","openai","gemini","deepseek","xai","mimo","custom"]).optional(),
      aiApiKey:    z.string().min(8).max(512).optional(),
      aiBaseUrl:   z.string().url().max(256).optional(),
      aiModel:     z.string().min(1).max(128).optional(),
      /** Demo-only toggle — inherits a shared MiMo key (server-side env). */
      useDemoMimoKey: z.boolean().optional(),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { identity, label, strategyId, llmModel, aiProvider, aiApiKey, aiBaseUrl, aiModel, useDemoMimoKey } = parsed.data;
    const ident = identity.toLowerCase();

    // Spawn flood defense via per-IP rate limit instead of trader auth.
    // The /studio UI flow doesn't currently sign an EIP-712 challenge before
    // spawning, and forcing it for the demo would block the obvious "click
    // spawn" interaction. A 10/minute cap per IP still kills table-flood
    // griefing — a single victim identity costs the attacker 10 IPs/min to
    // saturate, with no impact on legitimate users.
    checkRateLimit(c, "agents.spawn", 10, 60_000);
    const strategy = getStrategy(strategyId);
    if (!strategy) throw new HTTPException(400, { message: `unknown strategy: ${strategyId}` });

    // Shared-demo path takes precedence over a user-supplied aiApiKey to
    // make the demo toggle behave predictably. Only honored when the env
    // var is set on the server — otherwise the toggle was a no-op (UI
    // already hides it but defense-in-depth).
    const demoMimoActive = !!useDemoMimoKey && !!process.env["FORUM_DEMO_MIMO_KEY"];

    // Resolve provider: explicit > detected-from-URL > MiMo (when demo
    // toggle active) > null when no AI hint.
    let resolvedProvider: AiProvider | null = aiProvider ?? null;
    if (!resolvedProvider && aiBaseUrl) resolvedProvider = detectProvider(aiBaseUrl);
    if (!resolvedProvider && demoMimoActive) resolvedProvider = "mimo";

    // Encrypt the API key at rest if supplied. Plaintext NEVER leaves this
    // function — caller only ever sees provider + model in the response.
    let encryptedKey: { ciphertext: string; iv: string; authTag: string } | null = null;
    let sharedDemoSentinel = false;
    if (demoMimoActive) {
      sharedDemoSentinel = true;
    } else if (aiApiKey) {
      try {
        encryptedKey = encryptApiKey(aiApiKey);
      } catch (err) {
        throw new HTTPException(500, { message: `api key encrypt failed: ${(err as Error).message}` });
      }
    }

    // Generate a fresh trader wallet for the new persona — same encryption
    // as /traders/issue.
    const generated = generateTrader();
    const now = Math.floor(Date.now() / 1000);

    // The identity for a spawned agent is its OWN address, so the trader
    // wallet is rentable/sellable as a standalone object. The
    // owner_identity column on the agents row links it back to the user.
    await db.execute(sql`
      INSERT INTO trader_wallets (identity, address, encrypted_privkey, iv, auth_tag, faucet_received, created_at)
      VALUES (${generated.address.toLowerCase()}, ${generated.address.toLowerCase()},
              ${generated.encryptedPrivkey}, ${generated.iv}, ${generated.authTag}, 0, ${now})
      ON CONFLICT(identity) DO NOTHING
    `);

    // Profile hash = sha256(label + strategy + owner) — placeholder until
    // M2 AgentRegistry contract.
    const profileHash = "0x" + createHash("sha256")
      .update(`${label}|${strategyId}|${ident}|${now}`)
      .digest("hex");

    await db.insert(agents).values({
      address: generated.address.toLowerCase(),
      operator: ident,
      profileHash,
      name: label,
      kind: "custom",
      registeredAt: now,
      ownerIdentity: ident,
      personaLabel: label,
      strategyId,
      aiProvider: resolvedProvider,
      // SHARED_DEMO sentinel signals "use FORUM_DEMO_MIMO_KEY at runtime"
      // — the runner detects this exact value and never tries to decrypt it.
      aiApiKeyEncrypted: sharedDemoSentinel ? "SHARED_DEMO" : (encryptedKey?.ciphertext ?? null),
      aiKeyIv: sharedDemoSentinel ? null : (encryptedKey?.iv ?? null),
      aiKeyAuthTag: sharedDemoSentinel ? null : (encryptedKey?.authTag ?? null),
      aiBaseUrl: aiBaseUrl ?? (sharedDemoSentinel ? "https://api.xiaomimimo.com/v1" : null),
      aiModel: aiModel ?? (sharedDemoSentinel ? "mimo-v2.5-pro" : null),
    });

    return c.json({
      ok: true,
      address: generated.address.toLowerCase(),
      ownerIdentity: ident,
      personaLabel: label,
      strategyId,
      strategy: {
        label: strategy.label,
        basedOn: strategy.basedOn,
        llmModel: llmModel ?? aiModel ?? strategy.defaultLlmModel,
      },
      ai: {
        provider: resolvedProvider,
        baseUrl: aiBaseUrl ?? (sharedDemoSentinel ? "https://api.xiaomimimo.com/v1" : null),
        model: aiModel ?? (sharedDemoSentinel ? "mimo-v2.5-pro" : null),
        hasKey: !!encryptedKey || sharedDemoSentinel,
        sharedDemo: sharedDemoSentinel,
      },
      // M13 — persona starts config-pending whenever no key (real or
      // sentinel) is recorded. Runner skips these rows; UI surfaces a pill.
      configPending: !encryptedKey && !sharedDemoSentinel,
      createdAt: now,
    });
  });

  /// GET /agents/owned/:identity
  /// List all agents spawned by a given identity. Used by the "My Agents"
  /// grid on /console. Rows are redacted — the encrypted API key is
  /// stripped and replaced with a boolean `aiHasKey` flag.
  app.get("/agents/owned/:identity", async (c) => {
    const ident = c.req.param("identity").toLowerCase();
    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.ownerIdentity, ident));
    return c.json({ count: rows.length, agents: rows.map(redactAgent) });
  });

  /// POST /agents/:address/verify
  /// Anti-sybil 1-USDC verified badge. The owner pays priceUsdc (default
  /// 1.00 USDC) → market-api treasury, the agent row gains verified=1.
  /// Reuses the same custodial EIP-3009 path as /marketplace/rent.
  app.post("/agents/:address/verify", async (c) => {
    const agentAddr = c.req.param("address").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(agentAddr)) {
      throw new HTTPException(400, { message: "agent address must be 0x + 40 hex" });
    }
    // P0-B-006 — the agent's own custodial wallet pays the 1 USDC verify fee.
    // Without an auth gate, anyone could burn 1 USDC from any agent's balance.
    await requireTraderAuth(c, agentAddr);
    const agentRow = (await db.select().from(agents).where(eq(agents.address, agentAddr)))[0];
    if (!agentRow) throw new HTTPException(404, { message: "agent not found" });
    if (agentRow.verified === 1) return c.json({ ok: true, alreadyVerified: true });

    // The agent's own wallet pays — keeps the verify flow self-contained
    // (no need to know the owner's separate trader wallet). 1 USDC default.
    const priceUsdc = BigInt(1_000_000);
    const walletRow = (await db
      .select()
      .from(traderWallets)
      .where(eq(traderWallets.address, agentAddr)))[0];
    if (!walletRow) {
      throw new HTTPException(400, {
        message: "agent has no managed trader wallet — only spawned agents can be verified in v0.1",
      });
    }
    let traderAccount: ReturnType<typeof privateKeyToAccount>;
    try {
      const pk = decryptTraderPrivkey({
        encryptedPrivkey: walletRow.encryptedPrivkey,
        iv: walletRow.iv,
        authTag: walletRow.authTag,
      });
      traderAccount = privateKeyToAccount(pk);
    } catch (err) {
      throw new HTTPException(500, { message: `agent privkey decrypt failed: ${(err as Error).message}` });
    }

    const balance = (await clients.publicClient.readContract({
      address: env.ARC_USDC as `0x${string}`,
      abi: USDC_ERC20_ABI,
      functionName: "balanceOf",
      args: [traderAccount.address],
    })) as bigint;
    if (balance < priceUsdc) {
      throw new HTTPException(402, {
        message: `insufficient agent balance: ${formatUnits(balance, 6)} USDC, need 1.00`,
      });
    }

    const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);
    const nonceHex = randomNonce();
    const sig = await traderAccount.signTypedData({
      domain: { name: "USDC", version: "2", chainId: env.ARC_CHAIN_ID, verifyingContract: env.ARC_USDC as `0x${string}` },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: traderAccount.address,
        to: clients.account.address,
        value: priceUsdc, validAfter, validBefore,
        nonce: nonceHex as `0x${string}`,
      },
    });
    const r = ("0x" + sig.slice(2, 66)) as `0x${string}`;
    const s = ("0x" + sig.slice(66, 130)) as `0x${string}`;
    const v = parseInt(sig.slice(130, 132), 16);

    const tx = await withChainLock(async () => {
      const h = await clients.walletClient.writeContract({
        chain: arcTestnet,
        account: clients.account,
        address: env.ARC_USDC as `0x${string}`,
        abi: USDC_TRANSFER_WITH_AUTH_ABI,
        functionName: "transferWithAuthorization",
        args: [
          traderAccount.address, clients.account.address,
          priceUsdc, validAfter, validBefore, nonceHex as `0x${string}`,
          v, r, s,
        ],
      });
      await waitWithRetry(clients.publicClient, h);
      return h;
    });

    await db.update(agents).set({ verified: 1 }).where(eq(agents.address, agentAddr));
    return c.json({ ok: true, agentAddress: agentAddr, txHash: tx, priceUsdc: priceUsdc.toString() });
  });

  /// POST /marketplace/list
  /// List an agent for sale. v0.1 records the listing; M1 wires on-chain
  /// ownership transfer via AgentManifest ERC721.
  app.post("/marketplace/list", async (c) => {
    const body = await c.req.json().catch(() => null);
    // Owner-set listing: at least one of buy / rent tier prices must be
    // present. Each rent tier is independently opt-in — if a field is
    // omitted (or "0"/empty), the tier is stored as NULL and the rent
    // button is hidden on /marketplace. All prices are 6-dec USDC base
    // units (string of digits) to match the existing buy_price_usdc
    // shape on agent_listings.
    const OptUsdcBaseUnits = z
      .string()
      .regex(/^[0-9]+$/)
      .optional()
      .nullable();
    const Schema = z.object({
      agentAddress: HexAddress,
      seller: HexAddress,
      buyPriceUsdc: OptUsdcBaseUnits,
      rent6hUsdc: OptUsdcBaseUnits,
      rent24hUsdc: OptUsdcBaseUnits,
      rentWeekUsdc: OptUsdcBaseUnits,
      rentMonthUsdc: OptUsdcBaseUnits,
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { agentAddress, seller } = parsed.data;
    // P0-B-008 — without auth, an attacker could list a victim's agent for
    // 1 wei + immediately self-buy. Require EIP-712 proof of the seller's
    // identity before persisting the listing.
    await requireTraderAuth(c, seller.toLowerCase());
    // "" or "0" → NULL (tier not offered). Only positive base units count.
    const norm = (v: string | null | undefined): string | null => {
      if (v == null || v === "") return null;
      try {
        return BigInt(v) > 0n ? v : null;
      } catch {
        return null;
      }
    };
    const buyPriceUsdc = norm(parsed.data.buyPriceUsdc);
    const rent6hUsdc = norm(parsed.data.rent6hUsdc);
    const rent24hUsdc = norm(parsed.data.rent24hUsdc);
    const rentWeekUsdc = norm(parsed.data.rentWeekUsdc);
    const rentMonthUsdc = norm(parsed.data.rentMonthUsdc);
    if (!buyPriceUsdc && !rent6hUsdc && !rent24hUsdc && !rentWeekUsdc && !rentMonthUsdc) {
      throw new HTTPException(400, {
        message: "must set at least one of buy/rent prices",
      });
    }
    const agentAddr = agentAddress.toLowerCase();
    const sellerAddr = seller.toLowerCase();

    // SECURITY: only the current owner can list. Default agents
    // (owner_identity IS NULL) are protocol-owned and unlistable.
    // See docs/SECURITY_REVIEW.md §CRITICAL.
    const row = (await db.select().from(agents).where(eq(agents.address, agentAddr)))[0];
    if (!row) {
      throw new HTTPException(404, { message: "agent not found" });
    }
    if (!row.ownerIdentity) {
      throw new HTTPException(403, {
        message: "default agents (Oracle/Sage/Hermes/Augur/Mirror) are protocol-owned and cannot be listed for sale",
      });
    }
    if (row.ownerIdentity !== sellerAddr) {
      throw new HTTPException(403, {
        message: "only the agent's current owner can list it for sale",
      });
    }
    // M13 gate — refuse to list a persona that can't actually operate.
    // Renters/buyers should never end up with an agent that won't bet.
    if (!row.aiApiKeyEncrypted) {
      throw new HTTPException(400, {
        message: "Persona has no LLM key configured. Set credentials before listing.",
      });
    }

    // buy_price_usdc is NOT NULL on the table (pre-existing constraint),
    // so for rent-only listings store "0" as a sentinel — frontend
    // detects the rent-only case by inspecting whether all rent tiers
    // are non-null AND treats "0" buy price as "buy disabled".
    const buyPriceForRow = buyPriceUsdc ?? "0";

    const now = Math.floor(Date.now() / 1000);
    await db.execute(sql`
      INSERT INTO agent_listings (
        agent_address, seller, buy_price_usdc,
        rent_6h_usdc, rent_24h_usdc, rent_week_usdc, rent_month_usdc,
        created_at
      )
      VALUES (
        ${agentAddr}, ${sellerAddr}, ${buyPriceForRow},
        ${rent6hUsdc}, ${rent24hUsdc}, ${rentWeekUsdc}, ${rentMonthUsdc},
        ${now}
      )
      ON CONFLICT(agent_address) DO UPDATE SET
        seller = excluded.seller,
        buy_price_usdc = excluded.buy_price_usdc,
        rent_6h_usdc = excluded.rent_6h_usdc,
        rent_24h_usdc = excluded.rent_24h_usdc,
        rent_week_usdc = excluded.rent_week_usdc,
        rent_month_usdc = excluded.rent_month_usdc,
        sold_to = NULL,
        sold_at = NULL
    `);
    return c.json({
      ok: true,
      agentAddress: agentAddr,
      seller: sellerAddr,
      buyPriceUsdc,
      rent6hUsdc,
      rent24hUsdc,
      rentWeekUsdc,
      rentMonthUsdc,
    });
  });

  /// POST /marketplace/buy
  /// M13 — FORK semantics. Buy = clone the seller's persona configuration
  /// (strategy_id, persona_label, avatar_emoji) onto a fresh, isolated
  /// agent row with a NEW server-generated trader wallet. The original
  /// agent stays with the seller (still bettable, still rentable) — only
  /// the LISTING is marked sold. This matches "buy = take a snapshot of
  /// the strategy" and avoids transferring control of a wallet that may
  /// hold USDC balance, claimable winnings, or pending bets.
  ///
  /// What is NOT copied (security):
  ///   • ai_api_key_encrypted / iv / auth_tag — buyer MUST set their own
  ///     LLM credentials via /agents/:address/update. Persona starts
  ///     "config-pending".
  ///   • trader wallet privkey — buyer gets a fresh fork wallet, 0 USDC.
  ///     Buyer must deposit via CCTP or USDC send to the new agent address.
  ///   • bet history, honos score, wins/losses — fresh slate.
  ///
  /// On success:
  ///   1. EIP-3009 USDC broadcast from buyer's trader wallet → seller
  ///   2. agent_listings.sold_to + sold_at set on the ORIGINAL agent's row
  ///      (blocks future buyers from this listing)
  ///   3. New trader_wallets + agents rows inserted for the fork; buyer
  ///      becomes owner_identity of the fork.
  ///
  /// Default agents (Oracle/Sage/Hermes/Augur/Mirror) are protocol-owned
  /// and never listed, so they can't be bought.
  app.post("/marketplace/buy", async (c) => {
    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      agentAddress: HexAddress,
      buyer: HexAddress,
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    }
    const { agentAddress, buyer } = parsed.data;
    const agentAddr = agentAddress.toLowerCase();
    const buyerAddr = buyer.toLowerCase();
    // P0-B-009 — the EIP-3009 signature here moves USDC from the buyer's
    // custodial wallet. Require EIP-712 proof so an attacker can't pick a
    // victim as `buyer` and redirect funds to an attacker-owned listing.
    await requireTraderAuth(c, buyerAddr);

    // 1. Find the open listing — pull seller + price atomically so we don't
    //    race against another concurrent /buy on the same agent.
    const listing = ((await db.execute(sql`
      SELECT seller, buy_price_usdc, sold_to FROM agent_listings WHERE agent_address = ${agentAddr}
    `)) as unknown as { seller: string; buy_price_usdc: string; sold_to: string | null }[])[0];
    if (!listing) {
      throw new HTTPException(404, { message: "agent not listed for sale" });
    }
    if (listing.sold_to !== null) {
      throw new HTTPException(409, {
        message: `agent already sold to ${listing.sold_to}. listings are forever ownership — no resale until current owner re-lists.`,
      });
    }
    if (listing.seller === buyerAddr) {
      throw new HTTPException(400, { message: "you cannot buy your own listing" });
    }

    // SECURITY: defense-in-depth — re-verify the listing seller actually
    // owns this agent right now. /marketplace/list enforces this on
    // creation, but if owner_identity changed between list and buy
    // (e.g. concurrent re-list at a different price) we shouldn't pay
    // the stale seller. See docs/SECURITY_REVIEW.md §CRITICAL.
    const agentRow = (await db.select().from(agents).where(eq(agents.address, agentAddr)))[0];
    if (!agentRow || !agentRow.ownerIdentity) {
      throw new HTTPException(403, { message: "agent has no listable owner" });
    }
    if (agentRow.ownerIdentity !== listing.seller) {
      throw new HTTPException(409, {
        message: "listing seller no longer matches current owner — re-list required",
      });
    }

    // 2. Pull buyer's encrypted trader-wallet privkey.
    const buyerRow = (await db.select().from(traderWallets).where(eq(traderWallets.address, buyerAddr)))[0];
    if (!buyerRow) {
      throw new HTTPException(404, { message: "buyer trader wallet not found — sign in + claim one first" });
    }
    let buyerAccount: ReturnType<typeof privateKeyToAccount>;
    try {
      const pk = decryptTraderPrivkey({
        encryptedPrivkey: buyerRow.encryptedPrivkey, iv: buyerRow.iv, authTag: buyerRow.authTag,
      });
      buyerAccount = privateKeyToAccount(pk);
    } catch (err) {
      throw new HTTPException(500, { message: `buyer privkey decrypt failed: ${(err as Error).message}` });
    }
    if (buyerAccount.address.toLowerCase() !== buyerAddr) {
      throw new HTTPException(500, { message: "buyer privkey/address mismatch" });
    }

    // 3. Balance check before signing.
    const amount = BigInt(listing.buy_price_usdc);
    const balance = (await clients.publicClient.readContract({
      address: env.ARC_USDC as `0x${string}`,
      abi: USDC_ERC20_ABI,
      functionName: "balanceOf",
      args: [buyerAccount.address],
    })) as bigint;
    if (balance < amount) {
      throw new HTTPException(402, {
        message: `insufficient buyer balance: have ${formatUnits(balance, 6)}, need ${formatUnits(amount, 6)} USDC`,
      });
    }

    // 4. Sign EIP-3009 buyer → seller.
    const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);
    const nonceHex = randomNonce();
    const sig = await buyerAccount.signTypedData({
      domain: {
        name: "USDC", version: "2",
        chainId: env.ARC_CHAIN_ID,
        verifyingContract: env.ARC_USDC as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: buyerAccount.address,
        to: listing.seller as `0x${string}`,
        value: amount,
        validAfter, validBefore,
        nonce: nonceHex as `0x${string}`,
      },
    });
    const r = ("0x" + sig.slice(2, 66)) as `0x${string}`;
    const s = ("0x" + sig.slice(66, 130)) as `0x${string}`;
    const v = parseInt(sig.slice(130, 132), 16);

    // 5. Atomic listing reservation BEFORE the broadcast — claim sold_to
    //    first so a concurrent /buy can't double-charge. If the broadcast
    //    later fails we revert the reservation. This eliminates the
    //    previous loss-of-funds race where two concurrent buys both
    //    broadcast USDC but only one won the listing lock.
    const now = Math.floor(Date.now() / 1000);
    const reservedResult = await db.execute(sql`
      UPDATE agent_listings
      SET sold_to = ${buyerAddr}, sold_at = ${now}
      WHERE agent_address = ${agentAddr} AND sold_to IS NULL
      RETURNING agent_address
    `);
    // postgres-js returns the RETURNING rows as an array-like; check length
    // via Array.isArray to dodge the previous "as unknown as { length }" cast
    // that would silently return 0 if the underlying lib reshaped its result.
    const reservedRows = Array.isArray(reservedResult)
      ? (reservedResult as unknown[])
      : [];
    if (reservedRows.length === 0) {
      throw new HTTPException(409, {
        message: "agent just sold to another buyer — try a different listing",
      });
    }

    // 6. Broadcast on Arc — market-api treasury pays Arc gas, USDC moves buyer → seller.
    let buyTx: `0x${string}`;
    try {
      buyTx = await withChainLock(async () => {
        const h = await clients.walletClient.writeContract({
          chain: arcTestnet,
          account: clients.account,
          address: env.ARC_USDC as `0x${string}`,
          abi: USDC_TRANSFER_WITH_AUTH_ABI,
          functionName: "transferWithAuthorization",
          args: [
            buyerAccount.address, listing.seller as `0x${string}`,
            amount, validAfter, validBefore, nonceHex as `0x${string}`,
            v, r, s,
          ],
        });
        await waitWithRetry(clients.publicClient, h);
        return h;
      });
    } catch (err) {
      // Broadcast failed — release the reservation so another buyer can try.
      await db.execute(sql`
        UPDATE agent_listings SET sold_to = NULL, sold_at = NULL
        WHERE agent_address = ${agentAddr} AND sold_to = ${buyerAddr}
      `).catch(() => { /* best-effort rollback */ });
      throw new HTTPException(502, { message: `buy broadcast failed: ${(err as Error).message}` });
    }

    // 7. FORK — mint a fresh trader wallet + insert an isolated agents row
    //    cloning ONLY safe persona fields. NO api key, NO usdc balance,
    //    NO bet history. Buyer must configure + deposit before bets fire.
    //
    // Wrapped in try/catch: USDC already moved at this point, so a DB
    // failure here = orphan tx (buyer paid, fork row never created). We
    // log loud with the buy tx hash so ops can recover manually. The
    // request still returns 500 so the client retries — but the retry
    // will hit the listing-already-sold 409, surfacing the orphan state.
    const forkWallet = generateTrader();
    const forkAddr = forkWallet.address.toLowerCase();
    const forkProfileHash = "0x" + createHash("sha256")
      .update(`${agentAddr}|fork|${buyerAddr}|${now}`)
      .digest("hex");
    try {
      await db.execute(sql`
        INSERT INTO trader_wallets (identity, address, encrypted_privkey, iv, auth_tag, faucet_received, created_at)
        VALUES (${forkAddr}, ${forkAddr},
                ${forkWallet.encryptedPrivkey}, ${forkWallet.iv}, ${forkWallet.authTag}, 0, ${now})
        ON CONFLICT(identity) DO NOTHING
      `);
      await db.insert(agents).values({
        address: forkAddr,
        operator: buyerAddr,
        profileHash: forkProfileHash,
        name: agentRow.name,
        kind: "custom",
        registeredAt: now,
        ownerIdentity: buyerAddr,
        personaLabel: agentRow.personaLabel,
        strategyId: agentRow.strategyId,
        avatarEmoji: agentRow.avatarEmoji,
        // AI config intentionally NULL — buyer sets their own.
        aiProvider: null,
        aiApiKeyEncrypted: null,
        aiKeyIv: null,
        aiKeyAuthTag: null,
        aiBaseUrl: null,
        aiModel: null,
      });
    } catch (forkErr) {
      const rid = c.get("requestId") ?? "no-rid";
      console.error(
        `[marketplace/buy/${rid}] FORK-INSERT-FAILED — USDC already moved.\n` +
          `  buyTx=${buyTx}\n` +
          `  forkAddr=${forkAddr}\n` +
          `  sourceAgent=${agentAddr}\n` +
          `  buyer=${buyerAddr}\n` +
          `  seller=${listing.seller}\n` +
          `  amountUsdcBase=${amount}\n` +
          `  err=${(forkErr as Error).message}\n` +
          `  → NEEDS MANUAL FORK INSERT or REFUND.`,
      );
      throw new HTTPException(500, {
        message: `fork insert failed after USDC transfer. USDC moved to seller. Save this tx for refund: ${buyTx}`,
      });
    }

    return c.json({
      ok: true,
      sourceAgent: agentAddr,
      forkAgent: forkAddr,
      buyer: buyerAddr,
      seller: listing.seller,
      priceUsdc: listing.buy_price_usdc,
      txHash: buyTx,
      explorer: `https://testnet.arcscan.app/tx/${buyTx}`,
      soldAt: now,
      ownership: "fork",
      configPending: true,
      nextSteps: [
        "Deposit USDC into the fork address (CCTP one-click or direct send)",
        "Open Manage → set AI provider + key + model",
      ],
    });
  });

  /// GET /marketplace/listings
  /// List all open agent listings (not yet sold). Joined to `agents` so
  /// the /marketplace UI can render a card without an extra per-agent
  /// fetch (name, persona_label, avatar_emoji, strategy_id, verified).
  ///
  /// M13 — defense in depth: exclude any listing whose underlying persona
  /// has NULL ai_api_key_encrypted (config-pending). UI also filters but
  /// we hide these server-side so a stale client can't surface them.
  app.get("/marketplace/listings", async (c) => {
    const rows = ((await db.execute(sql`
      SELECT l.agent_address, l.seller, l.buy_price_usdc,
             l.rent_6h_usdc, l.rent_24h_usdc, l.rent_week_usdc, l.rent_month_usdc,
             l.created_at,
             a.name, a.persona_label, a.avatar_emoji, a.strategy_id, a.verified
      FROM agent_listings l
      LEFT JOIN agents a ON a.address = l.agent_address
      WHERE l.sold_to IS NULL
        AND a.ai_api_key_encrypted IS NOT NULL
      ORDER BY l.created_at DESC
    `)) as unknown as {
      agent_address: string;
      seller: string;
      buy_price_usdc: string;
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
    }[]);
    return c.json({ count: rows.length, listings: rows });
  });

  // ============================================================
  // M1 Trace Pinning — POST /forecasts/pin + GET /forecasts/:hash
  // ============================================================
  // Every LLM-driven bet can publish the reasoning that produced it. The
  // agent hashes its rationale, POSTs it here, gets a canonical sha256 +
  // (optionally) an Irys gateway URL back, then includes the hash in the
  // BetIntent. The trace itself is queryable forever via /forecasts/:hash.
  //
  // v0.1 stores the rationale in our own SQLite — proves the primitive,
  // gives judges something to inspect during the Agora demo. M1 final
  // upgrades to Irys mainnet pinning so the trace becomes truly
  // permanent + verifiable without trusting our DB.

  const PinForecastBody = z.object({
    agentAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    marketId:     z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    outcome:      z.number().int().min(0).max(1),
    rationale:    z.string().min(1).max(16_000),
    probability:  z.string().regex(/^\d+(\.\d+)?$/).optional(),
    confidence:   z.string().regex(/^\d+(\.\d+)?$/).optional(),
    model:        z.string().max(64).optional(),
    rationaleJson: z.unknown().optional(),
    /** M2.2 — optional client-encrypted payload. When present, `rationale`
     *  above is base64-encoded ciphertext + iv + authTag must accompany.
     *  Server stores the bytes as-is; only the key-holder can decrypt. */
    cipher: z.object({
      alg:     z.literal("aes-256-gcm"),
      iv:      z.string().regex(/^[0-9a-fA-F]{24}$/),         // 12 bytes hex
      authTag: z.string().regex(/^[0-9a-fA-F]{32}$/),         // 16 bytes hex
    }).optional(),
  });

  app.post("/forecasts/pin", async (c) => {
    // Per-IP throttle is the defense here, not trader auth. Reason: this
    // endpoint is called by every reference agent + SDK consumer in the
    // ecosystem, and forcing a signed EIP-712 challenge round-trip would
    // break the agent → market-api flow that already gates the actual
    // bet (which is what moves money). Worst-case abuse is display-only
    // rationale spam, deduped by sha256 of canonical content.
    checkRateLimit(c, "forecasts.pin", 30, 60_000);
    const body = await c.req.json().catch(() => null);
    if (!body) throw new HTTPException(400, { message: "JSON body required" });
    const parsed = PinForecastBody.safeParse(body);
    if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });
    const p = parsed.data;

    // Canonical hash = sha256 of a stable JSON encoding of the *essential*
    // forecast fields. Including the model + agent + market + outcome
    // means two agents stating the same rationale on the same market get
    // distinct trace rows — which is what we want, since the "trace" is
    // (rationale, who said it, about what).
    //
    // When encrypted, `rationale` is base64 ciphertext — the hash still
    // covers exactly what's stored, so anyone can verify the bytes match
    // the on-chain hash without needing to decrypt.
    const canonical = JSON.stringify({
      agent: p.agentAddress.toLowerCase(),
      market: p.marketId.toLowerCase(),
      outcome: p.outcome,
      rationale: p.rationale,
      model: p.model ?? null,
      probability: p.probability ?? null,
      confidence: p.confidence ?? null,
      cipherAlg: p.cipher?.alg ?? null,
      cipherIv: p.cipher?.iv ?? null,
      cipherAuthTag: p.cipher?.authTag ?? null,
    });
    const sha256 = "0x" + createHash("sha256").update(canonical).digest("hex");

    const existing = (await db
      .select()
      .from(forecastTraces)
      .where(eq(forecastTraces.sha256, sha256)))[0];
    if (existing) {
      return c.json({
        sha256, irysId: existing.irysId, irysUrl: existing.irysUrl, deduped: true,
      });
    }

    await db.insert(forecastTraces).values({
      sha256,
      agentAddress: p.agentAddress.toLowerCase(),
      marketId: p.marketId.toLowerCase(),
      outcome: p.outcome,
      probability: p.probability ?? null,
      confidence: p.confidence ?? null,
      rationale: p.rationale,
      rationaleJson: p.rationaleJson != null ? JSON.stringify(p.rationaleJson) : null,
      model: p.model ?? null,
      irysId: null,  // v0.1: DB-only. M1 final pins to Irys here.
      irysUrl: null,
      cipherAlg:     p.cipher?.alg ?? null,
      cipherIv:      p.cipher?.iv ?? null,
      cipherAuthTag: p.cipher?.authTag ?? null,
      createdAt: Math.floor(Date.now() / 1000),
    });

    return c.json({
      sha256, irysId: null, irysUrl: null, deduped: false,
      encrypted: !!p.cipher,
    });
  });

  app.get("/forecasts/:hash", async (c) => {
    const hash = c.req.param("hash").toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(hash)) {
      throw new HTTPException(400, { message: "hash must be 0x + 64 hex" });
    }
    const row = (await db.select().from(forecastTraces).where(eq(forecastTraces.sha256, hash)))[0];
    if (!row) throw new HTTPException(404, { message: "trace not found" });
    return c.json({
      sha256: row.sha256,
      agentAddress: row.agentAddress,
      marketId: row.marketId,
      outcome: row.outcome,
      probability: row.probability,
      confidence: row.confidence,
      rationale: row.rationale,
      rationaleJson: row.rationaleJson ? JSON.parse(row.rationaleJson) : null,
      model: row.model,
      irysId: row.irysId,
      irysUrl: row.irysUrl,
      cipher: row.cipherAlg
        ? { alg: row.cipherAlg, iv: row.cipherIv, authTag: row.cipherAuthTag }
        : null,
      createdAt: row.createdAt,
    });
  });

  /// GET /forecasts/:hash/trail — full lifecycle of a pinned forecast.
  /// Returns an ordered list of milestones: forecast generated → pinned →
  /// every bet that cited this sha256 → resolution if the market resolved.
  /// Powers the /traces/[hash] Forecast Trail timeline component.
  app.get("/forecasts/:hash/trail", async (c) => {
    const hash = c.req.param("hash").toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(hash)) {
      throw new HTTPException(400, { message: "hash must be 0x + 64 hex" });
    }
    const trace = (await db.select().from(forecastTraces).where(eq(forecastTraces.sha256, hash)))[0];
    if (!trace) throw new HTTPException(404, { message: "trace not found" });

    const referencingBets = await db
      .select({
        id: bets.id,
        marketId: bets.marketId,
        agentAddress: bets.agentAddress,
        outcome: bets.outcome,
        costUsdc: bets.costUsdc,
        marketTxHash: bets.marketTxHash,
        createdAt: bets.createdAt,
      })
      .from(bets)
      .where(eq(bets.forecastSha256, hash))
      .orderBy(asc(bets.id));

    const market = (await db.select().from(markets).where(eq(markets.id, trace.marketId)))[0] ?? null;
    const resolution =
      (await db.select().from(resolutions).where(eq(resolutions.marketId, trace.marketId)))[0] ?? null;

    return c.json({
      hash,
      generatedAt: trace.createdAt,
      pinnedToIrys: trace.irysId
        ? { irysId: trace.irysId, irysUrl: trace.irysUrl }
        : null,
      market: market
        ? {
            id: market.id,
            question: market.question,
            phase: market.phase,
            opensAt: market.opensAt,
            closesAt: market.closesAt,
            resolvesAt: market.resolvesAt,
            createdAt: market.createdAt,
          }
        : null,
      bets: referencingBets,
      resolution: resolution
        ? {
            outcome: resolution.outcome,
            txHash: resolution.txHash,
            resolvedAt: resolution.resolvedAt,
            source: resolution.source,
            ecbRate: resolution.ecbRate,
            ecbDate: resolution.ecbDate,
          }
        : null,
    });
  });

  // ============================================================
  // M4 D-5 — Trace Markets v1
  // Meta-bets on agent reasoning win-rates over a rolling time window.
  // "Will Oracle's win-rate be ≥ 60% over next 24h?" Resolved off-chain
  // from bets ⨯ resolutions join; bets themselves settle on-chain in
  // USDC against market-api treasury wallet.
  // ============================================================

  /// Compute the actual win-rate of an agent over a window. Returns
  /// basis points (e.g. 6230 = 62.30%) plus the count of settled bets
  /// that contributed. Used by both /trace-markets/:id/resolve and the
  /// /trace-markets list endpoint to surface "current rate".
  async function computeWinRateBps(targetAgent: string, sinceUnix: number, untilUnix: number): Promise<{
    winRateBps: number; settled: number;
  }> {
    const rows = ((await db.execute(sql`
      SELECT b.outcome, r.outcome AS winning_outcome
      FROM bets b
      INNER JOIN resolutions r ON r.market_id = b.market_id
      WHERE b.agent_address = ${targetAgent}
        AND b.created_at >= ${sinceUnix}
        AND b.created_at < ${untilUnix}
        AND r.outcome != 2
    `)) as unknown as { outcome: number; winning_outcome: number | null }[]);
    if (rows.length === 0) return { winRateBps: 0, settled: 0 };
    const wins = rows.filter((r) => r.outcome === r.winning_outcome).length;
    return { winRateBps: Math.round((wins / rows.length) * 10_000), settled: rows.length };
  }

  /// GET /trace-markets — list all trace markets with current win-rate.
  app.get("/trace-markets", async (c) => {
    const status = c.req.query("status");
    let rows = await db.select().from(traceMarkets);
    // Same time-based gate as /markets — exclude trace markets whose
    // closesAt is past so the UI doesn't list them as bettable.
    const nowSec = Math.floor(Date.now() / 1000);
    if (status === "open") rows = rows.filter((r) => r.phase === 0 && r.closesAt > nowSec);
    else if (status === "resolved") rows = rows.filter((r) => r.phase === 2);
    const enriched = await Promise.all(rows.map(async (m) => {
      const now = Math.floor(Date.now() / 1000);
      const sinceUnix = m.opensAt;
      const untilUnix = m.phase === 2 ? (m.resolvedAt ?? m.closesAt) : Math.min(now, m.closesAt);
      const live = await computeWinRateBps(m.targetAgent, sinceUnix, untilUnix);
      return {
        ...m,
        currentWinRateBps: live.winRateBps,
        currentSettled: live.settled,
      };
    }));
    return c.json({ count: enriched.length, traceMarkets: enriched });
  });

  app.get("/trace-markets/:id", async (c) => {
    const id = c.req.param("id").toLowerCase();
    const row = (await db.select().from(traceMarkets).where(eq(traceMarkets.id, id)))[0];
    if (!row) throw new HTTPException(404, { message: "trace market not found" });
    const now = Math.floor(Date.now() / 1000);
    const untilUnix = row.phase === 2 ? (row.resolvedAt ?? row.closesAt) : Math.min(now, row.closesAt);
    const live = await computeWinRateBps(row.targetAgent, row.opensAt, untilUnix);
    const betsRows = await db.select().from(traceBets).where(eq(traceBets.traceMarketId, id)).orderBy(desc(traceBets.id));

    /// Resolved trace markets MUST surface a validity report — the actual bets
    /// the target agent placed in the window, each joined to its market's
    /// resolution so the user can verify the win-rate themselves. Only fetched
    /// when phase === 2 (post-settlement); open markets don't need this since
    /// `currentWinRateBps` already exposes the live tally.
    let sourceBets: Array<{
      marketId: string;
      agentOutcome: number;
      winningOutcome: number | null;
      isWin: boolean;
      settlementTxHash: string | null;
      createdAt: number;
    }> = [];
    if (row.phase === 2) {
      const joined = (await db.execute(sql`
        SELECT b.market_id, b.outcome AS agent_outcome, b.settlement_tx_hash, b.created_at,
               r.outcome AS winning_outcome
        FROM bets b
        INNER JOIN resolutions r ON r.market_id = b.market_id
        WHERE b.agent_address = ${row.targetAgent}
          AND b.created_at >= ${row.opensAt}
          AND b.created_at < ${untilUnix}
          AND r.outcome != 2
        ORDER BY b.created_at DESC
        LIMIT 100
      `)) as unknown as Array<{
        market_id: string;
        agent_outcome: number;
        settlement_tx_hash: string | null;
        created_at: number;
        winning_outcome: number | null;
      }>;
      sourceBets = joined.map((r) => ({
        marketId: r.market_id,
        agentOutcome: r.agent_outcome,
        winningOutcome: r.winning_outcome,
        isWin: r.agent_outcome === r.winning_outcome,
        settlementTxHash: r.settlement_tx_hash,
        createdAt: r.created_at,
      }));
    }

    return c.json({
      ...row,
      currentWinRateBps: live.winRateBps,
      currentSettled: live.settled,
      /// Count of settled bets that drove the resolution. For open markets this
      /// equals `currentSettled` (live count); resolved markets freeze the final.
      settledBetsConsidered: live.settled,
      bets: betsRows,
      sourceBets,
    });
  });

  /// POST /trace-markets — create. Trusted local caller for v0.1.
  app.post("/trace-markets", async (c) => {
    // Admin-only: scout daemon creates these in response to agent activity.
    // Without the gate any caller can spam meta-markets on any agent.
    requireAdminSecret(c);
    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      targetAgent: HexAddress,
      thresholdBps: z.number().int().min(100).max(9_900),
      windowHours: z.number().int().min(6).max(720),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    const { targetAgent, thresholdBps, windowHours } = parsed.data;
    const now = Math.floor(Date.now() / 1000);
    const closesAt = now + windowHours * 3600;
    const id = keccak256(
      encodePacked(
        ["address", "uint16", "uint64"],
        [targetAgent.toLowerCase() as `0x${string}`, thresholdBps, BigInt(now)],
      ),
    );
    const existing = (await db.select().from(traceMarkets).where(eq(traceMarkets.id, id)))[0];
    if (existing) return c.json({ deduped: true, ...existing });
    await db.insert(traceMarkets).values({
      id,
      targetAgent: targetAgent.toLowerCase(),
      thresholdBps,
      windowHours,
      opensAt: now,
      closesAt,
      createdAt: now,
    });
    return c.json({
      id,
      targetAgent: targetAgent.toLowerCase(),
      thresholdBps,
      windowHours,
      opensAt: now,
      closesAt,
      phase: 0,
    });
  });

  /// POST /trace-markets/:id/bet
  /// Place a USDC bet on whether the target agent will hit the threshold.
  /// Uses the same EIP-3009 custodial path as /traders/:addr/bet — the
  /// bettor's trader wallet pays market-api treasury, recorded in DB.
  app.post("/trace-markets/:id/bet", async (c) => {
    const id = c.req.param("id").toLowerCase();
    // P2-B-001 — strict regex on the path param. Anything past this point may
    // be interpolated into a raw `sql.raw(...)` call (see the UPDATE further
    // down), so we whitelist 0x-hex only before touching the DB.
    if (!/^0x[a-f0-9]+$/.test(id)) {
      throw new HTTPException(400, { message: "trace market id must be lowercase 0x-hex" });
    }
    const body = await c.req.json().catch(() => null);
    const Schema = z.object({
      bettor: HexAddress,
      outcome: z.literal(0).or(z.literal(1)),
      amountUsdc: z.string().regex(/^\d+(\.\d+)?$/),
    });
    const parsed = Schema.safeParse(body);
    if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues.map((i) => i.message).join("; ") });
    const { bettor, outcome, amountUsdc } = parsed.data;

    // P0-B-002 — bettor's privkey is about to be decrypted + signed against.
    // Require an EIP-712 proof from either the bettor's wallet or the bettor
    // address itself (server-side runner path).
    await requireTraderAuth(c, bettor.toLowerCase());

    const market = (await db.select().from(traceMarkets).where(eq(traceMarkets.id, id)))[0];
    if (!market) throw new HTTPException(404, { message: "trace market not found" });
    if (market.phase !== 0) throw new HTTPException(409, { message: "trace market not OPEN" });

    const row = (await db.select().from(traderWallets).where(eq(traderWallets.address, bettor.toLowerCase())))[0];
    if (!row) throw new HTTPException(404, { message: "bettor trader wallet not found" });

    let traderAccount: ReturnType<typeof privateKeyToAccount>;
    try {
      const pk = decryptTraderPrivkey({
        encryptedPrivkey: row.encryptedPrivkey, iv: row.iv, authTag: row.authTag,
      });
      traderAccount = privateKeyToAccount(pk);
    } catch (err) {
      throw new HTTPException(500, { message: `bettor privkey decrypt failed: ${(err as Error).message}` });
    }

    const amount = parseUnits(amountUsdc, 6);
    const balance = (await clients.publicClient.readContract({
      address: env.ARC_USDC as `0x${string}`,
      abi: USDC_ERC20_ABI,
      functionName: "balanceOf",
      args: [traderAccount.address],
    })) as bigint;
    if (balance < amount) {
      throw new HTTPException(402, {
        message: `insufficient balance: have ${formatUnits(balance, 6)}, need ${amountUsdc} USDC`,
      });
    }

    const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);
    const nonceHex = randomNonce();
    const sig = await traderAccount.signTypedData({
      domain: { name: "USDC", version: "2", chainId: env.ARC_CHAIN_ID, verifyingContract: env.ARC_USDC as `0x${string}` },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: traderAccount.address,
        to: clients.account.address,
        value: amount, validAfter, validBefore,
        nonce: nonceHex as `0x${string}`,
      },
    });
    const r = ("0x" + sig.slice(2, 66)) as `0x${string}`;
    const s = ("0x" + sig.slice(66, 130)) as `0x${string}`;
    const v = parseInt(sig.slice(130, 132), 16);

    const tx = await withChainLock(async () => {
      const h = await clients.walletClient.writeContract({
        chain: arcTestnet,
        account: clients.account,
        address: env.ARC_USDC as `0x${string}`,
        abi: USDC_TRANSFER_WITH_AUTH_ABI,
        functionName: "transferWithAuthorization",
        args: [
          traderAccount.address, clients.account.address,
          amount, validAfter, validBefore, nonceHex as `0x${string}`,
          v, r, s,
        ],
      });
      await waitWithRetry(clients.publicClient, h);
      return h;
    });

    const now = Math.floor(Date.now() / 1000);
    await db.insert(traceBets).values({
      traceMarketId: id,
      bettor: bettor.toLowerCase(),
      outcome,
      costUsdc: amount.toString(),
      txHash: tx,
      createdAt: now,
    });

    // Update the trace_markets pool counters. P2-B-001 — column name comes
    // from a fixed two-branch literal (no caller input), and id is regex-
    // validated above, but we still parameterize id + amount via the tagged
    // template so the only un-parameterized piece is the column identifier.
    if (outcome === 1) {
      await db.execute(sql`
        UPDATE trace_markets
           SET yes_pool_usdc = CAST(yes_pool_usdc AS NUMERIC) + ${amount.toString()}
         WHERE id = ${id}
      `);
    } else {
      await db.execute(sql`
        UPDATE trace_markets
           SET no_pool_usdc = CAST(no_pool_usdc AS NUMERIC) + ${amount.toString()}
         WHERE id = ${id}
      `);
    }

    // Broadcast SSE so the TraceMarketLive panel updates without a 6s poll wait.
    bus.emit({
      type: "trace_bet.placed",
      traceMarketId: id,
      bettor: bettor.toLowerCase(),
      outcome,
      costUsdc: amount.toString(),
      txHash: tx,
      ts: now,
    });

    return c.json({
      ok: true,
      traceMarketId: id,
      bettor: bettor.toLowerCase(),
      outcome,
      amountUsdc,
      txHash: tx,
      explorer: `https://testnet.arcscan.app/tx/${tx}`,
    });
  });

  /// POST /trace-markets/:id/resolve
  /// Compute the win-rate over (opensAt, now) and mark the market RESOLVED.
  /// Idempotent — re-running on a RESOLVED market returns existing state.
  /// In production a cron worker would call this at closesAt; for v0.1 a
  /// manual ping triggers it.
  app.post("/trace-markets/:id/resolve", async (c) => {
    // Admin-only: scout/keeper resolves at closesAt. Without this gate an
    // attacker could force early resolution and screw with payouts.
    requireAdminSecret(c);
    const id = c.req.param("id").toLowerCase();
    const market = (await db.select().from(traceMarkets).where(eq(traceMarkets.id, id)))[0];
    if (!market) throw new HTTPException(404, { message: "trace market not found" });
    if (market.phase === 2) {
      return c.json({ alreadyResolved: true, winningOutcome: market.winningOutcome });
    }
    const now = Math.floor(Date.now() / 1000);
    if (now < market.closesAt) {
      throw new HTTPException(409, { message: `not yet closed — closesAt ${market.closesAt}, now ${now}` });
    }
    const live = await computeWinRateBps(market.targetAgent, market.opensAt, market.closesAt);
    const winningOutcome: 0 | 1 | 2 =
      live.settled === 0 ? 2 :
      live.winRateBps >= market.thresholdBps ? 1 : 0;
    await db.update(traceMarkets)
      .set({
        phase: 2,
        winningOutcome,
        resolvedAt: now,
        resolvedWinRateBps: live.winRateBps,
      })
      .where(eq(traceMarkets.id, id))
      ;
    return c.json({
      ok: true,
      id,
      winningOutcome,
      resolvedWinRateBps: live.winRateBps,
      settledBetsConsidered: live.settled,
    });
  });

  // ============================================================
  // MCP (Model Context Protocol) — read-only tools for external agents
  // ============================================================

  const mcpServer = createMcpServer({ env, deployment, clients, db });

  // Mount under /mcp via the Node native req/res pair (MCP SDK requires it).
  // We write directly to `outgoing` and return a sentinel that Hono detects as "already
  // sent" so it doesn't double-write headers. The trick: leave outgoing.headersSent true
  // (set by MCP) and return an empty Response — @hono/node-server skips writing when
  // headersSent is already true.
  app.all("/mcp", async (c) => {
    const { incoming, outgoing } = c.env as {
      incoming: import("node:http").IncomingMessage;
      outgoing: import("node:http").ServerResponse;
    };
    await handleMcpHttp(mcpServer, incoming, outgoing);
    // Wait one tick to let MCP finish flushing if needed, then return a no-op Response.
    return c.body(null);
  });

  // ============================================================
  // Error handler
  // ============================================================

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message, requestId: c.get("requestId") }, err.status);
    }
    // Mutex queue overflow → 503 with Retry-After hint so clients back off
    // gracefully instead of hammering the wedged backend.
    if (err instanceof ChainLockTimeoutError) {
      c.header("Retry-After", "30");
      return c.json({ error: err.message, requestId: c.get("requestId") }, 503);
    }
    // P2-B-005 — generic 500 NO LONGER leaks `err.message`. Full stack goes
    // to the server logs keyed by requestId so on-call can correlate; client
    // gets a stable opaque message + the request id for support tickets.
    const rid = c.get("requestId") ?? "no-rid";
    console.error(`[market-api/${rid}] unhandled error:`, err);
    return c.json({ error: "internal error", requestId: rid }, 500);
  });

  return app;
}
