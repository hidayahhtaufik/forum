import { createPublicClient, createWalletClient, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "./arc.js";
import { ResettableNonceManager } from "./nonce-manager.js";
import type { Env } from "../env.js";

/// Wraps Viem `publicClient` (reads) + `walletClient` (writes signed by MARKET_API key)
/// for the Arc Testnet. Construct once at boot, reuse across requests.

export type Clients = {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  account: ReturnType<typeof privateKeyToAccount>;
  quoteAccount: ReturnType<typeof privateKeyToAccount>;
  /** Exposed so health-check endpoints can inspect nonce state. */
  nonceManager: ResettableNonceManager;
};

/// Operator floor — every chain write bids at LEAST this priority fee, even if
/// 15× base gas would round below it. Demo deadline mode: guaranteed inclusion
/// in the very next block on any healthy validator.
const MIN_PRIORITY_GWEI = 25_000_000_000n;
const INITIAL_MULTIPLIER = 15n;
const MAX_FEE_MULTIPLIER = 20n;

/// Compute aggressive gas params from the current base fee. Used both by the
/// global writeContract wrapper (every chain write across market-api inherits
/// these defaults) AND by callers that need to be explicit (execute-bet.ts,
/// sendWithReplace). Idempotent — re-computing per-call is cheap and stays
/// fresh as the network base fee drifts.
export async function computeAggressiveGas(
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<{ maxPriorityFeePerGas: bigint; maxFeePerGas: bigint }> {
  const baseFee = await publicClient.getGasPrice().catch(() => 20_000_000_000n);
  const proposedPriority = baseFee * INITIAL_MULTIPLIER;
  const maxPriorityFeePerGas = proposedPriority > MIN_PRIORITY_GWEI ? proposedPriority : MIN_PRIORITY_GWEI;
  const proposedMax = baseFee * MAX_FEE_MULTIPLIER;
  const minMax = maxPriorityFeePerGas + baseFee;
  const maxFeePerGas = proposedMax > minMax ? proposedMax : minMax;
  return { maxPriorityFeePerGas, maxFeePerGas };
}

/// Error patterns that indicate the nonce is wrong — the broadcast was
/// rejected before entering the mempool. Catching these lets us auto-reset
/// the nonce manager and retry instead of surfacing a 502 to the user.
const NONCE_ERROR_PATTERNS = [
  "Transaction creation failed",
  "nonce too high",
  "nonce too low",
  "replacement transaction underpriced",
  "already known",
  "NONCE_EXPIRED",
];

function isNonceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return NONCE_ERROR_PATTERNS.some((p) => msg.includes(p));
}

export function makeClients(env: Env): Clients {
  // NO viem nonceManager — we use our own ResettableNonceManager that
  // auto-resets on broadcast failure. See nonce-manager.ts for rationale.
  const account = privateKeyToAccount(env.MARKET_API_PRIVATE_KEY as `0x${string}`);
  const quoteAccount = privateKeyToAccount(env.MARKET_QUOTE_PRIVATE_KEY as `0x${string}`);

  // Build the transport list. If ARC_RPC_URL_FALLBACK is set, wrap both in
  // viem's `fallback` transport: requests try primary first, and on error or
  // timeout automatically retry against the fallback. With drpc free-tier
  // mempools filling up under multi-agent traffic, pairing a paid Alchemy
  // endpoint (primary) with the Arc-published rpc.testnet.arc.network
  // (fallback) keeps writes flowing even when one RPC sheds load.
  // Single-URL setups (just ARC_RPC_URL) still work — fallback() degrades
  // to a plain http() when given a one-element list.
  // 429 backoff — public Arc RPC sheds load aggressively under multi-agent
  // traffic and a single TooManyRequests fails the entire user-facing op
  // (premium-insights, buy-dataset, scout's market create). Adding viem's
  // built-in transport retry on every URL with 250→500→1000ms exponential
  // backoff per attempt absorbs short bursts before the user ever sees an
  // error. retryDelay defaults to 150ms; bumping to 400ms gives the upstream
  // limiter time to refill its bucket between attempts.
  const HTTP_RETRY = { retryCount: 3, retryDelay: 400 } as const;
  const transport = env.ARC_RPC_URL_FALLBACK
    ? fallback(
        [http(env.ARC_RPC_URL, HTTP_RETRY), http(env.ARC_RPC_URL_FALLBACK, HTTP_RETRY)],
        {
          rank: false, // Don't reorder by latency — keep primary first deterministically.
          retryCount: 1, // One retry per attempt before moving to the next transport.
        },
      )
    : http(env.ARC_RPC_URL, HTTP_RETRY);

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport,
  });

  const nonceMgr = new ResettableNonceManager(account.address);

  const rawWalletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport,
  });

  // Wrap walletClient.writeContract + sendTransaction so EVERY chain write —
  // bets, market creates, USDC settles, x402 nanopayment settles, CCTP
  // attestation receives, trader-wallet faucet drops — auto-inherits:
  //   1. Aggressive gas (15× base + 25 gwei floor priority bid)
  //   2. Nonce from our ResettableNonceManager (auto-resets on failure)
  //   3. Auto-retry on nonce errors (one attempt, re-fetches nonce from chain)
  //
  // Callers that explicitly pass nonce / gas overrides still win because the
  // spread runs AFTER the defaults.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walletClient = new Proxy(rawWalletClient as any, {
    get(target, prop, receiver) {
      if (prop === "writeContract") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return async (args: any) => {
          const gas = await computeAggressiveGas(publicClient);

          // If caller already provided a nonce (e.g. sendWithReplace retry),
          // use it directly — don't consume from our manager.
          const callerNonce = args.nonce;
          const nonce = callerNonce ?? await nonceMgr.consume(publicClient);

          try {
            return await target.writeContract({ ...gas, ...args, nonce });
          } catch (err) {
            // If this was a nonce-related RPC rejection and we assigned the
            // nonce (not the caller), reset the manager and retry once with a
            // fresh nonce from the chain.
            if (callerNonce === undefined && isNonceError(err)) {
              nonceMgr.markFailed();
              const freshNonce = await nonceMgr.consume(publicClient);
              console.warn(
                `[nonce-retry] writeContract failed with nonce ${nonce}: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)} — retrying with fresh nonce ${freshNonce}`,
              );
              try {
                return await target.writeContract({ ...gas, ...args, nonce: freshNonce });
              } catch (retryErr) {
                // Retry also failed — mark failed again so next call re-syncs.
                // Log the underlying reason: without it the loop is a black box.
                nonceMgr.markFailed();
                console.error(
                  `[nonce-retry] retry ALSO failed at nonce ${freshNonce}: ${(retryErr instanceof Error ? retryErr.message : String(retryErr)).slice(0, 300)}`,
                );
                throw retryErr;
              }
            }
            // Non-nonce error (contract revert, etc.) — mark failed to
            // reclaim the nonce, then propagate.
            if (callerNonce === undefined) {
              nonceMgr.markFailed();
            }
            throw err;
          }
        };
      }
      if (prop === "sendTransaction") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return async (args: any) => {
          const gas = await computeAggressiveGas(publicClient);
          const callerNonce = args.nonce;
          const nonce = callerNonce ?? await nonceMgr.consume(publicClient);

          try {
            return await target.sendTransaction({ ...gas, ...args, nonce });
          } catch (err) {
            if (callerNonce === undefined && isNonceError(err)) {
              nonceMgr.markFailed();
              const freshNonce = await nonceMgr.consume(publicClient);
              console.warn(
                `[nonce-retry] sendTransaction failed with nonce ${nonce}, retrying with fresh nonce ${freshNonce}`,
              );
              try {
                return await target.sendTransaction({ ...gas, ...args, nonce: freshNonce });
              } catch (retryErr) {
                nonceMgr.markFailed();
                throw retryErr;
              }
            }
            if (callerNonce === undefined) {
              nonceMgr.markFailed();
            }
            throw err;
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as typeof rawWalletClient;

  return { publicClient, walletClient, account, quoteAccount, nonceManager: nonceMgr };
}
