import { WaitForTransactionReceiptTimeoutError } from "viem";
import { createPublicClient, createWalletClient, defineChain, encodePacked, http, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";

import type { Env } from "./env.js";
import type { Deployment } from "./deployment.js";
import { fetchEcbRateForDate, parsePair, type EcbRate } from "./ecb.js";
import { FORUM_RESOLVER_DOMAIN, ForexMarketAbi, RESOLUTION_TYPES, ResolverAbi } from "./chain.js";

type Market = {
  id: `0x${string}`;
  address: `0x${string}`;
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
};

const OUTCOME_NO = 0 as const;
const OUTCOME_YES = 1 as const;
const OUTCOME_INVALID = 2 as const;

/// Long-running worker. Poll market-api for open markets, resolve any past closesAt.
export async function runWorker(env: Env, deployment: Deployment): Promise<{ stop: () => void }> {
  const account = privateKeyToAccount(env.RESOLVER_ADMIN_PRIVATE_KEY as `0x${string}`);

  const arc = defineChain({
    id: env.ARC_CHAIN_ID,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
    rpcUrls: { default: { http: [env.ARC_RPC_URL] } },
    blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
    testnet: true,
  });

  const publicClient = createPublicClient({ chain: arc, transport: http(env.ARC_RPC_URL) });
  const walletClient = createWalletClient({ account, chain: arc, transport: http(env.ARC_RPC_URL) });

  console.log("[resolver] online");
  console.log(`  admin EOA:   ${account.address}`);
  console.log(`  resolver:    ${deployment.resolver}`);
  console.log(`  market-api:  ${env.MARKET_API_URL}`);
  console.log(`  poll:        every ${env.RESOLVER_POLL_INTERVAL_MS / 1000}s`);
  console.log(`  grace:       ${env.RESOLVER_GRACE_MS / 1000}s after closesAt`);

  // Onchain sanity: verify our key matches Resolver.admin().
  try {
    const onchainAdmin = (await publicClient.readContract({
      address: deployment.resolver as `0x${string}`,
      abi: ResolverAbi,
      functionName: "admin",
    })) as `0x${string}`;
    if (onchainAdmin.toLowerCase() !== account.address.toLowerCase()) {
      console.warn(
        `[resolver] WARN: signing key ${account.address} does NOT match Resolver.admin() ${onchainAdmin}. ` +
          `Resolutions will be rejected.`,
      );
    } else {
      console.log("[resolver] admin key verified against on-chain Resolver");
    }
  } catch (err) {
    console.warn(`[resolver] admin check failed (continuing): ${(err as Error).message}`);
  }

  let running = true;
  const inFlight = new Set<string>(); // marketIds currently being resolved (de-dup)

  const tick = async () => {
    // Honour shutdown signal — clearInterval handles future ticks, but a
    // tick already mid-execution would happily keep spawning resolveMarket
    // promises after stop() ran. Guarding here means a graceful shutdown
    // never produces a ghost on-chain resolve.
    if (!running) return;
    try {
      const markets = await fetchOpenMarkets(env.MARKET_API_URL);
      if (!running) return;
      const now = Math.floor(Date.now() / 1000);
      const cutoff = now - Math.ceil(env.RESOLVER_GRACE_MS / 1000);

      for (const m of markets) {
        if (!running) return;
        if (m.phase !== 0) continue;
        if (m.closesAt > cutoff) continue; // not yet past closesAt + grace
        if (inFlight.has(m.id)) continue;

        // Solidity Phase enum (ForexMarket.sol): 0=UNINITIALIZED, 1=OPEN, 2=RESOLVED.
        // There is NO intermediate CLOSED state — markets go OPEN → RESOLVED
        // directly via Resolver.resolve(). Old comment claimed phase=3 was
        // RESOLVED; that was wrong, so this skip-if-already-resolved branch
        // never fired and the resolver kept trying to re-broadcast for
        // already-settled markets.
        const phase = (await publicClient.readContract({
          address: m.address,
          abi: ForexMarketAbi,
          functionName: "phase",
        })) as number;
        if (phase === 2) {
          // On-chain already resolved but DB lags behind (m.phase === 0 still
          // means the notify roundtrip on the original resolve tick failed —
          // typical when Arc RPC dropped the receipt poll and resolver threw
          // before calling /resolution-notify). Auto-heal: ask market-api to
          // re-read on-chain state and update DB. No tx, no signature — just
          // an idempotent DB sync that powers the UI (ResolutionBanner,
          // crab walks-to-FINISH animation, history-page settled count).
          console.log(`[resolver] ${m.id.slice(0, 10)}… resolved on-chain · auto-syncing DB`);
          fetch(`${env.MARKET_API_URL}/admin/sync-market/${m.id}`, {
            method: "POST",
            headers: env.ADMIN_SECRET ? { "x-admin-secret": env.ADMIN_SECRET } : {},
          }).catch((err) => {
            console.warn(`[resolver] sync ${m.id.slice(0, 10)}… failed: ${(err as Error).message}`);
          });
          continue;
        }
        const digest = await readResolutionDigest(publicClient, deployment.resolver as `0x${string}`, m.id);
        if (digest !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
          console.log(`[resolver] ${m.id.slice(0, 10)}… already has resolution digest, skipping`);
          continue;
        }

        inFlight.add(m.id);
        resolveMarket(m, { publicClient, walletClient, account, deployment, env }).finally(() => {
          inFlight.delete(m.id);
        });
      }
    } catch (err) {
      console.error(`[resolver] tick error: ${(err as Error).message}`);
    }
  };

  // Fire immediately, then on interval.
  await tick();
  const handle = setInterval(tick, env.RESOLVER_POLL_INTERVAL_MS);

  return {
    stop: () => {
      running = false;
      clearInterval(handle);
    },
  };
}

async function fetchOpenMarkets(apiURL: string): Promise<Market[]> {
  // Fetch ALL markets (no status filter) and let the resolver tick decide
  // which ones to act on locally. Previously this hit /markets?status=open,
  // but that endpoint was changed to exclude markets whose closesAt is past
  // (so the arena UI doesn't list them as "LIVE"). Side effect: the very
  // markets the resolver NEEDS to settle were filtered out, so resolveMarket
  // never fired and markets stayed DB phase=0 forever. Fetching unfiltered
  // and letting the tick's own `m.phase !== 0 || m.closesAt > cutoff`
  // checks decide what to resolve restores the correct behaviour.
  const res = await fetch(`${apiURL}/markets`, { cache: "no-store" } as RequestInit);
  if (!res.ok) throw new Error(`market-api /markets returned ${res.status}`);
  const j = (await res.json()) as { count: number; markets: Market[] };
  return j.markets ?? [];
}

async function readResolutionDigest(
  client: ReturnType<typeof createPublicClient>,
  resolver: `0x${string}`,
  marketId: `0x${string}`,
): Promise<`0x${string}`> {
  return (await client.readContract({
    address: resolver,
    abi: ResolverAbi,
    functionName: "resolutionDigest",
    args: [marketId],
  })) as `0x${string}`;
}

type ResolveCtx = {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  account: PrivateKeyAccount;
  deployment: Deployment;
  env: Env;
};

async function resolveMarket(market: Market, ctx: ResolveCtx) {
  const tag = `[resolver ${market.id.slice(0, 10)}…]`;
  try {
    // 1. Fetch reference rate for the market's close date. Pair drives which
    // base+symbol pair we ask Frankfurter for — EURUSD stays the original
    // ECB EUR-base rate; CADUSD pulls CAD-base for Stablecorp's QCAD
    // corridor on Arc StableFX.
    const closeDate = new Date(market.closesAt * 1000);
    const { base, symbol } = parsePair(market.pair);
    const ecb = await fetchEcbRateForDate(closeDate, symbol, base);
    console.log(`${tag} reference ${ecb.date} ${base}/${symbol} = ${ecb.rate}`);

    // 2. Compute winning outcome.
    const strike = Number(BigInt(market.strikeWad)) / 1e18;
    const winningOutcome = computeOutcome(ecb.rate, strike, market.comparator);
    console.log(`${tag} strike ${strike} ${market.comparator} rate ${ecb.rate} → ${labelOutcome(winningOutcome)}`);

    // 3. Compose dataHash = keccak256(source, date, rateWad). The source
    // string is the authoritative publication for the pair — "ECB" for
    // EUR pairs (direct ECB attestation via Frankfurter), "BoC" for CAD
    // pairs (Bank of Canada Valet noon rate), "ECB-cross" for derived
    // cross-rates. Hash uses the actual source so any auditor can recompute
    // it from the row + the public publication.
    const rateWad = BigInt(Math.round(ecb.rate * 1e18));
    const dataHash = keccak256(
      encodePacked(["string", "string", "uint256"], [ecb.source, ecb.date, rateWad]),
    );

    // 4. Sign EIP-712 Resolution.
    // P2-C-001: include validBefore — sig expires 1 hour after signing.
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const validBefore = timestamp + BigInt(3600); // 1 hour window
    const sig = (await ctx.account.signTypedData({
      domain: {
        ...FORUM_RESOLVER_DOMAIN,
        chainId: ctx.env.ARC_CHAIN_ID,
        verifyingContract: ctx.deployment.resolver as `0x${string}`,
      },
      types: RESOLUTION_TYPES,
      primaryType: "Resolution",
      message: {
        marketId: market.id,
        winningOutcome,
        dataHash,
        timestamp,
        validBefore,
      },
    })) as `0x${string}`;

    // 5. Submit on-chain with gas-bump retry. Arc Testnet RPC can return
    // "replacement transaction underpriced" when a previous resolve attempt
    // is still stuck in mempool at the default gas price. We retry up to
    // 3 times with 1.5x escalating gas multiplier so the bumped tx is
    // accepted as a valid replacement.
    const txHash = await submitWithGasBump(ctx, {
      address: ctx.deployment.resolver as `0x${string}`,
      abi: ResolverAbi,
      functionName: "resolve",
      args: [
        market.address,
        { marketId: market.id, winningOutcome, dataHash, timestamp, validBefore },
        sig,
      ],
      tag,
    });
    console.log(`${tag} submitted tx ${txHash}`);
    // Retry-with-direct-probe pattern — Arc Testnet RPC sometimes drops the
    // receipt poll even when the tx confirms. Without this the resolver
    // throws WaitForTransactionReceiptTimeoutError, the digest is on-chain
    // (good) but `notify market-api` never runs (bad → DB stuck phase 0).
    const receipt = await waitWithRetry(ctx.publicClient, txHash);
    console.log(`${tag} ✓ resolved in block ${receipt.blockNumber}`);
    console.log(`${tag}   explorer: https://testnet.arcscan.app/tx/${txHash}`);

    // 6. Notify market-api so it can index + sync phase.
    try {
      await fetch(`${ctx.env.MARKET_API_URL}/markets/${market.id}/resolution-notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: market.id,
          winningOutcome,
          dataHash,
          timestamp: Number(timestamp),
          txHash,
          source: ecb.source,
          ecbDate: ecb.date,
          ecbRate: ecb.rate,
        }),
      });
    } catch (err) {
      console.warn(`${tag} notify failed (non-fatal): ${(err as Error).message}`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    // Classify the error so an operator scanning logs can tell at a glance
    // whether to retry, change env, or wait for the chain to drain.
    let kind = "unknown";
    if (/replacement transaction underpriced/i.test(msg)) kind = "gas-bump-exhausted";
    else if (/txpool is full/i.test(msg)) kind = "txpool-full";
    else if (/not confirmed after|timeout/i.test(msg)) kind = "rpc-timeout";
    else if (/HTTP 4\d\d|HTTP 5\d\d/i.test(msg)) kind = "ecb-api";
    else if (/no rate for|no data/i.test(msg)) kind = "ecb-no-rate";
    else if (/invalid signer|verifyMessage|0x190100/i.test(msg)) kind = "admin-key-mismatch";
    else if (/insufficient funds/i.test(msg)) kind = "low-gas-balance";
    console.error(`${tag} resolution failed [${kind}]: ${msg.slice(0, 400)}`);
  }
}

function computeOutcome(rate: number, strike: number, cmp: "GT" | "GTE" | "LT" | "LTE"): 0 | 1 | 2 {
  switch (cmp) {
    case "GT":
      return rate > strike ? OUTCOME_YES : OUTCOME_NO;
    case "GTE":
      return rate >= strike ? OUTCOME_YES : OUTCOME_NO;
    case "LT":
      return rate < strike ? OUTCOME_YES : OUTCOME_NO;
    case "LTE":
      return rate <= strike ? OUTCOME_YES : OUTCOME_NO;
    default:
      return OUTCOME_INVALID;
  }
}

function labelOutcome(o: 0 | 1 | 2): string {
  return o === 1 ? "YES" : o === 0 ? "NO" : "INVALID";
}

/// Resilient receipt-waiter — mirrors apps/market-api/src/lib/wait-with-retry.ts.
/// Arc Testnet RPC sometimes returns stale null on getTransactionReceipt poll
/// even after the tx has confirmed. Short per-attempt window + direct probe
/// + total budget self-heals the common "tx is fine, viem just didn't see it"
/// failure mode that was leaving resolver digests on-chain without DB sync.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function waitWithRetry(publicClient: any, hash: `0x${string}`, totalMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    try {
      return await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    } catch (err) {
      if (!(err instanceof WaitForTransactionReceiptTimeoutError)) throw err;
      const direct = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
      if (direct) return direct;
    }
  }
  throw new Error(`tx ${hash} not confirmed after ${Math.round((Date.now() - start) / 1000)}s`);
}

/// Submit a writeContract call with escalating gas on retry. Arc Testnet
/// returns "replacement transaction underpriced" when a previous attempt
/// is still pending at the same nonce — we self-heal by bumping
/// maxFeePerGas + maxPriorityFeePerGas at 1.5× per retry. Falls back to
/// the wallet client's default gas pricing on the first attempt.
async function submitWithGasBump(
  ctx: ResolveCtx,
  call: {
    address: `0x${string}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    abi: any;
    functionName: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any[];
    tag: string;
  },
): Promise<`0x${string}`> {
  const MAX_ATTEMPTS = 3;
  // Probe current network fees once so each retry escalates from a known
  // baseline rather than guessing absolute numbers per chain.
  let baseFeePerGas = 0n;
  let basePriority = 0n;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fees = await (ctx.publicClient as any).estimateFeesPerGas();
    baseFeePerGas = BigInt(fees.maxFeePerGas ?? 0);
    basePriority = BigInt(fees.maxPriorityFeePerGas ?? 0);
  } catch {
    // RPC eth_feeHistory not available — fall through to default gas
    // (1st attempt). Bumps only kick in on retry.
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Cumulative 1.5× per retry: attempt 1 = base, 2 = 1.5×, 3 = 2.25×.
      // Each retry needs to clear ≥10% over the previous attempt OR the
      // pending mempool tx to be accepted as a replacement, so we ramp
      // exponentially rather than applying the same 1.5× repeatedly
      // (which is what the earlier draft incorrectly did and would have
      // re-hit "underpriced" on every retry).
      const exp = attempt - 1; // 0, 1, 2
      const multiplier = BigInt(Math.pow(15, exp)); // 1, 15, 225
      const divisor = BigInt(Math.pow(10, exp));    // 1, 10, 100
      // Both fees override together or neither, to avoid viem warnings about
      // mixing legacy + EIP-1559 fields. Only override when we have a real
      // base reading from estimateFeesPerGas.
      const haveFees = baseFeePerGas > 0n && basePriority > 0n;
      const overrides: Record<string, bigint> = {};
      if (haveFees && attempt > 1) {
        overrides.maxFeePerGas = (baseFeePerGas * multiplier) / divisor;
        overrides.maxPriorityFeePerGas = (basePriority * multiplier) / divisor;
      }

      if (attempt > 1) {
        console.log(
          `${call.tag} retry ${attempt}/${MAX_ATTEMPTS} with` +
            (overrides.maxFeePerGas
              ? ` maxFee=${overrides.maxFeePerGas} (${Number(multiplier) / Number(divisor)}× base)`
              : " RPC-default gas"),
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txHash = await (ctx.walletClient as any).writeContract({
        chain: undefined,
        account: ctx.account,
        ...call,
        ...overrides,
      });
      return txHash as `0x${string}`;
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message ?? "";
      const isUnderpriced = /replacement transaction underpriced|replacement underpriced/i.test(msg);
      const isTxpoolFull = /txpool is full/i.test(msg);
      if (!isUnderpriced && !isTxpoolFull) throw err;
      console.warn(
        `${call.tag} attempt ${attempt} hit "${isUnderpriced ? "underpriced" : "txpool full"}", bumping gas + retrying`,
      );
      // Brief backoff lets the mempool drain a slot before the next bump.
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  throw new Error(
    `submitWithGasBump exhausted ${MAX_ATTEMPTS} attempts: ${(lastErr as Error)?.message ?? "unknown"}`,
  );
}
