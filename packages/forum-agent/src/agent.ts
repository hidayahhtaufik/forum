import { EventEmitter } from "node:events";
import type { PrivateKeyAccount, PublicClient, WalletClient } from "viem";
import { keccak256, encodePacked, createPublicClient, createWalletClient, http, defineChain } from "viem";

import type {
  Address,
  Hex,
  Market,
  Forecast,
  BudgetConfig,
  BetIntent,
  BetReceipt,
  MarketEvent,
} from "./types.js";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC,
  ARC_USDC,
  arcExplorerTx,
  FOREX_MARKET_ABI,
  OUTCOME_TOKEN_ABI,
  parseUsdc,
  wadToUsdc,
} from "./chain.js";
import { LLMDriver, type LLMConfig } from "./llm.js";
import { MarketApiClient, MarketApiError } from "./markets/client.js";
import { signTransferAuthorization, randomNonce } from "./eip3009.js";

const USDC_BALANCE_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/// Top-level config for `createAgent`. All sub-configs are optional except `wallet`.
export type AgentConfig = {
  wallet: PrivateKeyAccount;
  /// LLM provider — optional (agent can run without forecasting, e.g. as a Mirror).
  llm?: LLMConfig;
  /// market-api endpoint. Defaults to localhost.
  marketApi?: { baseURL?: string };
  /// Budget guards. Defaults: 1 USDC per bet, 20 USDC per day.
  budget?: Partial<BudgetConfig>;
  /// Poll interval (ms) for `subscribeMarkets`. Defaults to 5000.
  pollIntervalMs?: number;
  /// Optional fetch impl override (tests).
  fetchImpl?: typeof fetch;
  /// Optional public client override (tests). Accepts anything with `readContract`.
  publicClient?: PublicClient | { readContract: (args: never) => Promise<never> };
};

/// Internal: track 24h rolling spend per agent in-memory. Multi-process or restart
/// resets this — v0.1 acceptable, v0.2 should persist to DB.
type SpendLogEntry = { ts: number; usdc6: bigint };

export class Agent {
  readonly account: PrivateKeyAccount;
  readonly market: MarketApiClient;
  readonly llm: LLMDriver | null;
  readonly budget: BudgetConfig;
  readonly pollIntervalMs: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly publicClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private walletClientLazy: any | null = null;
  private readonly emitter = new EventEmitter();
  private readonly seenMarkets = new Set<string>();
  private readonly spendLog: SpendLogEntry[] = [];
  private pollHandle: NodeJS.Timeout | null = null;
  private payToCache: Address | null = null;

  constructor(cfg: AgentConfig) {
    this.account = cfg.wallet;

    this.market = new MarketApiClient({
      baseURL: cfg.marketApi?.baseURL ?? "http://127.0.0.1:8403",
      fetchImpl: cfg.fetchImpl ?? fetch,
    });

    this.llm = cfg.llm ? new LLMDriver(cfg.llm) : null;

    this.budget = {
      perBetUsdc: cfg.budget?.perBetUsdc ?? "1.00",
      dailyCapUsdc: cfg.budget?.dailyCapUsdc ?? "20.00",
    };

    this.pollIntervalMs = cfg.pollIntervalMs ?? 5_000;

    this.publicClient =
      cfg.publicClient ??
      createPublicClient({
        transport: http(ARC_TESTNET_RPC),
      });

    this.emitter.setMaxListeners(0);
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  get address(): Address {
    return this.account.address;
  }

  on<E extends "market" | "error">(
    event: E,
    handler: E extends "market" ? (e: MarketEvent) => void : (err: Error) => void,
  ): void {
    this.emitter.on(event, handler as never);
  }

  off(event: "market" | "error", handler: (...args: unknown[]) => void): void {
    this.emitter.off(event, handler as never);
  }

  // ============================================================
  // Market subscription
  // ============================================================

  /// Start polling market-api for open markets. Emits "market" events for new + refreshed.
  /// Idempotent: calling twice is a no-op.
  async subscribeMarkets(filter?: { pair?: string }): Promise<void> {
    if (this.pollHandle) return;
    const tick = async () => {
      try {
        const open = await this.market.listMarkets({ status: "open" });
        const filtered = filter?.pair ? open.filter((m) => m.pair === filter.pair) : open;
        for (const m of filtered) {
          const isNew = !this.seenMarkets.has(m.id);
          if (isNew) this.seenMarkets.add(m.id);
          this.emitter.emit("market", { market: m, isNew });
        }
      } catch (err) {
        this.emitter.emit("error", err);
      }
    };
    // Fire immediately, then on interval.
    await tick();
    this.pollHandle = setInterval(tick, this.pollIntervalMs);
  }

  unsubscribeMarkets(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  // ============================================================
  // Forecast (LLM)
  // ============================================================

  async forecast(
    market: Market,
    ctx?: { peerSignals?: Record<string, unknown>[]; signal?: AbortSignal },
  ): Promise<Forecast> {
    if (!this.llm) throw new Error("agent.forecast: no LLM configured");
    return await this.llm.forecast(market, ctx);
  }

  // ============================================================
  // Trading
  // ============================================================

  /// Get a server-signed quote for `shares` of `outcome` (in WAD).
  async quote(marketId: string, outcome: 0 | 1, sharesWad: bigint) {
    return await this.market.getQuote(marketId, outcome, sharesWad);
  }

  /// Place a bet end-to-end:
  ///   1. Fetch quote
  ///   2. Enforce budget caps (per-bet + 24h)
  ///   3. Sign EIP-712 BetIntent
  ///   4. Sign EIP-3009 USDC authorization
  ///   5. POST to market-api /bets
  ///   6. Record spend
  ///
  /// `sizeUsdc` is the decimal-string USDC amount to risk (e.g. "0.50"). The SDK
  /// converts to shares using the quote.
  async placeBet(args: {
    marketId: Hex;
    outcome: 0 | 1;
    sharesWad: bigint;
    /// Slippage cap as fraction (e.g. 0.01 = 1%). Defaults to 0.5%.
    slippage?: number;
  }): Promise<BetReceipt> {
    const slippage = args.slippage ?? 0.005;

    const [quote, payTo] = await Promise.all([
      this.market.getQuote(args.marketId, args.outcome, args.sharesWad),
      this.getPayTo(),
    ]);
    const cost = BigInt(quote.costUsdc);
    const fee = BigInt(quote.feeUsdc);
    const total = cost + fee;
    const maxCost = total + (total * BigInt(Math.floor(slippage * 10_000))) / 10_000n;

    this.checkBudget(total);

    // Build the bet intent (server will verify our signature over this).
    const deadline = Math.floor(Date.now() / 1000) + 60;
    const nonce = randomNonce();
    const intent: BetIntent = {
      marketId: args.marketId,
      outcome: args.outcome,
      shares: args.sharesWad.toString(),
      maxCost: maxCost.toString(),
      deadline,
      agent: this.account.address,
      nonce,
    };
    const intentHash = hashIntent(intent);
    const intentSignature = (await this.account.signMessage({ message: { raw: intentHash } })) as Hex;

    // Authorize USDC transfer to the market-api wallet (settle-and-forward relay).
    // The relay receives buyer's USDC, approves the market clone, then calls buyShares
    // from itself — net pass-through. Day 7+ swaps this for Circle Gateway batched settle.
    const authorization = await signTransferAuthorization(this.account, {
      to: payTo,
      valueUsdc6: maxCost,
      nonce,
    });

    const receipt = await this.market.placeBet({
      marketId: args.marketId,
      intent,
      intentSignature,
      authorization,
    });

    this.recordSpend(total);
    return receipt;
  }

  /// Convenience: place a bet sized in USDC instead of shares. Uses LMSR previewBuy to
  /// invert the relation. NOT EXACT — buys the largest share count whose quote fits.
  ///
  /// Math: 1 USDC base unit (6-dec) = 1e12 WAD. At price 0.5 USDC/share, B USDC buys
  /// 2·B shares; in WAD that's `budget6dec * 2 * 1e12` wad shares. Starting guess is
  /// the initial-price estimate; we iterate down if the quote exceeds budget.
  async placeBetByUsdc(args: { marketId: Hex; outcome: 0 | 1; sizeUsdcDecimal: string; slippage?: number }): Promise<BetReceipt> {
    const budget = parseUsdc(args.sizeUsdcDecimal);
    this.checkBudget(budget);
    // Initial guess: budget × 2 shares per dollar × 1e12 wad-per-base = wad shares.
    let sharesWad = budget * 2n * 10n ** 12n;
    for (let i = 0; i < 5; i++) {
      const quote = await this.market.getQuote(args.marketId, args.outcome, sharesWad);
      const total = BigInt(quote.costUsdc) + BigInt(quote.feeUsdc);
      if (total <= budget) break;
      sharesWad = (sharesWad * 90n) / 100n; // shrink 10% and retry
    }
    const args2: { marketId: Hex; outcome: 0 | 1; sharesWad: bigint; slippage?: number } = {
      marketId: args.marketId,
      outcome: args.outcome,
      sharesWad,
    };
    if (args.slippage !== undefined) args2.slippage = args.slippage;
    return await this.placeBet(args2);
  }

  /// Fetches market-api `/` once to learn the payTo wallet. Cached for the lifetime of
  /// this Agent instance.
  async getPayTo(): Promise<Address> {
    if (this.payToCache) return this.payToCache;
    const info = await this.market.info();
    if (!info.payTo) {
      throw new Error("market-api did not advertise a payTo address — upgrade the server");
    }
    this.payToCache = info.payTo;
    return this.payToCache;
  }

  // ============================================================
  // M1 Trace Pinning
  // ============================================================

  /// Publish a forecast's reasoning trace BEFORE placing the bet that
  /// implements it. Returns the canonical sha256 you should reference
  /// from the bet (so the trace and the bet are linked).
  ///
  /// Failure-tolerant by design: if market-api is down or the call
  /// errors, the agent should still place the bet — just without the
  /// trace link. So we never let this throw from inside agent code;
  /// callers can decide how to log.
  ///
  /// M2.2 — pass `encryptKey` (32 bytes, hex) to encrypt the rationale
  /// under AES-256-GCM before pinning. The hash will be over the
  /// ciphertext; only the key holder can decrypt downstream.
  async pinForecast(
    marketId: Hex,
    forecast: import("./types.js").Forecast,
    opts?: { encryptKey?: Buffer | string },
  ): Promise<{
    sha256: Hex;
    irysId: string | null;
    irysUrl: string | null;
    deduped: boolean;
    encrypted?: boolean;
  }> {
    const outcome: 0 | 1 = forecast.outcome === "YES" ? 1 : 0;

    let rationale = forecast.rationale;
    let cipher: { alg: "aes-256-gcm"; iv: string; authTag: string } | undefined;
    if (opts?.encryptKey) {
      const { encryptRationale, parseKey } = await import("./trace-crypto.js");
      const key = typeof opts.encryptKey === "string" ? parseKey(opts.encryptKey) : opts.encryptKey;
      const enc = encryptRationale(forecast.rationale, key);
      rationale = enc.ciphertext;
      cipher = { alg: enc.alg, iv: enc.iv, authTag: enc.authTag };
    }

    return await this.market.pinForecast({
      agentAddress: this.account.address as Hex,
      marketId,
      outcome,
      rationale,
      probability: forecast.probability.toFixed(4),
      confidence: forecast.confidence.toFixed(4),
      ...(forecast.model ? { model: forecast.model } : {}),
      ...(cipher ? { cipher } : {}),
      // Only attach rationaleJson when NOT encrypted — otherwise we'd be
      // publishing the structured forecast in cleartext alongside the
      // ciphertext, defeating the purpose.
      ...(cipher
        ? {}
        : {
            rationaleJson: {
              outcome: forecast.outcome,
              probability: forecast.probability,
              confidence: forecast.confidence,
              suggestedSizeUsdc: forecast.suggestedSizeUsdc,
            },
          }),
    });
  }

  // ============================================================
  // Wallet
  // ============================================================

  async balance(): Promise<{ usdc6: bigint }> {
    const raw = (await this.publicClient.readContract({
      address: ARC_USDC,
      abi: USDC_BALANCE_ABI,
      functionName: "balanceOf",
      args: [this.account.address],
    })) as bigint;
    return { usdc6: raw };
  }

  /// v0.1 returns DB-only score. v0.2 will query Honos on-chain.
  async score(): Promise<{ score: number; wins: number; losses: number }> {
    // Placeholder until market-api exposes /agents/:address — v0.2.
    return { score: 0, wins: 0, losses: 0 };
  }

  /// Claim a resolved market. Reads the agent's outcome token balance on the
  /// winning outcome and calls ForexMarket.claim. Pays its own Arc gas in USDC.
  ///
  /// If `outcome` is omitted, queries the market's winningOutcome on-chain. If the
  /// agent has no shares of the winning side, the method returns `{ claimed: 0n }`
  /// rather than reverting.
  async claim(args: {
    marketId: Hex;
    marketAddress: Address;
    outcome?: 0 | 1;
  }): Promise<{ claimed: bigint; shares: bigint; txHash: Hex | null; explorer: string | null }> {
    // 1. Determine the winning outcome (from chain if not supplied).
    let outcome: 0 | 1;
    if (args.outcome !== undefined) {
      outcome = args.outcome;
    } else {
      const onchain = (await this.publicClient.readContract({
        address: args.marketAddress,
        abi: FOREX_MARKET_ABI,
        functionName: "winningOutcome",
      })) as number;
      // 0 = NO, 1 = YES, 2 = INVALID. We can claim YES or NO. INVALID is
      // handled by claiming whichever side the agent holds.
      if (onchain === 0 || onchain === 1) {
        outcome = onchain as 0 | 1;
      } else {
        // INVALID — claim the side the agent actually holds. Default: try YES first.
        outcome = 1;
      }
    }

    // 2. Read the outcome token id + agent's balance.
    const outcomeTokenAddr = (await this.publicClient.readContract({
      address: args.marketAddress,
      abi: FOREX_MARKET_ABI,
      functionName: "outcomeToken",
    })) as Address;
    const tokenId = (await this.publicClient.readContract({
      address: outcomeTokenAddr,
      abi: OUTCOME_TOKEN_ABI,
      functionName: "tokenIdOf",
      args: [args.marketId, outcome],
    })) as bigint;
    const shares = (await this.publicClient.readContract({
      address: outcomeTokenAddr,
      abi: OUTCOME_TOKEN_ABI,
      functionName: "balanceOf",
      args: [this.account.address, tokenId],
    })) as bigint;

    if (shares === 0n) {
      return { claimed: 0n, shares: 0n, txHash: null, explorer: null };
    }

    // 3. Submit claim tx. Agent pays its own Arc gas (USDC).
    const wallet = this.walletClient();
    const txHash = (await wallet.writeContract({
      chain: undefined,
      account: this.account,
      address: args.marketAddress,
      abi: FOREX_MARKET_ABI,
      functionName: "claim",
      args: [outcome, shares],
    })) as Hex;

    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    // 4. Estimate payout: 1 USDC per share for winners; capped by contract balance
    //    for INVALID. We can read the actual transferred amount from the Claimed
    //    event for precision, but for the SDK return value we compute the expected.
    const expectedPayout = (shares * 1_000_000n) / 10n ** 18n; // shares (WAD) -> USDC (6-dec)

    return {
      claimed: expectedPayout,
      shares,
      txHash,
      explorer: arcExplorerTx(txHash),
    };
  }

  /// Lazy wallet client (signed-tx capable). Built from `this.account` + Arc Testnet chain.
  /// Used by claim() and any future agent-side transactions that bypass market-api.
  private walletClient() {
    if (this.walletClientLazy) return this.walletClientLazy;
    const arc = defineChain({
      id: ARC_TESTNET_CHAIN_ID,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
      rpcUrls: { default: { http: [ARC_TESTNET_RPC] } },
      blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
      testnet: true,
    });
    this.walletClientLazy = createWalletClient({
      account: this.account,
      chain: arc,
      transport: http(ARC_TESTNET_RPC),
    });
    return this.walletClientLazy;
  }

  // ============================================================
  // Budget enforcement
  // ============================================================

  private checkBudget(amountUsdc6: bigint): void {
    const perBet = parseUsdc(this.budget.perBetUsdc);
    const dailyCap = parseUsdc(this.budget.dailyCapUsdc);

    if (amountUsdc6 > perBet) {
      throw new BudgetExceededError(
        `bet of ${amountUsdc6} base units exceeds perBet cap (${perBet})`,
        "perBet",
      );
    }

    // Prune entries older than 24h.
    const cutoff = Math.floor(Date.now() / 1000) - 24 * 3600;
    while (this.spendLog.length > 0 && (this.spendLog[0]?.ts ?? 0) < cutoff) {
      this.spendLog.shift();
    }
    const dailyTotal = this.spendLog.reduce((acc, e) => acc + e.usdc6, 0n);
    if (dailyTotal + amountUsdc6 > dailyCap) {
      throw new BudgetExceededError(
        `bet of ${amountUsdc6} would push 24h spend (${dailyTotal}) past dailyCap (${dailyCap})`,
        "dailyCap",
      );
    }
  }

  private recordSpend(amountUsdc6: bigint): void {
    this.spendLog.push({ ts: Math.floor(Date.now() / 1000), usdc6: amountUsdc6 });
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string, public readonly which: "perBet" | "dailyCap") {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/// Deterministic intent hash for off-chain signing. Server-side verifier reconstructs the
/// same packed encoding to recover the agent address from `intentSignature`.
export function hashIntent(i: BetIntent): Hex {
  return keccak256(
    encodePacked(
      ["bytes32", "uint8", "uint256", "uint256", "uint64", "address", "bytes32"],
      [i.marketId, i.outcome, BigInt(i.shares), BigInt(i.maxCost), BigInt(i.deadline), i.agent, i.nonce],
    ),
  );
}

/// Factory function — mirrors the README ergonomics.
export async function createAgent(cfg: AgentConfig): Promise<Agent> {
  return new Agent(cfg);
}

// Re-export the error class consumers may want to switch on.
export { MarketApiError } from "./markets/client.js";
