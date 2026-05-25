import { createPublicClient, createWalletClient, fallback, http, nonceManager } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "./arc.js";
import type { Env } from "../env.js";

/// Wraps Viem `publicClient` (reads) + `walletClient` (writes signed by MARKET_API key)
/// for the Arc Testnet. Construct once at boot, reuse across requests.

export type Clients = {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  account: ReturnType<typeof privateKeyToAccount>;
  quoteAccount: ReturnType<typeof privateKeyToAccount>;
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

export function makeClients(env: Env): Clients {
  // viem's nonceManager tracks the next nonce in-memory and increments atomically
  // per writeContract call. Without this, concurrent writes (5 agents betting on
  // the same market in parallel) all fetch the same "next nonce" from RPC and
  // collide → "replacement transaction underpriced". Required for the multi-agent
  // demo scenario.
  const account = privateKeyToAccount(env.MARKET_API_PRIVATE_KEY as `0x${string}`, { nonceManager });
  const quoteAccount = privateKeyToAccount(env.MARKET_QUOTE_PRIVATE_KEY as `0x${string}`);

  // Build the transport list. If ARC_RPC_URL_FALLBACK is set, wrap both in
  // viem's `fallback` transport: requests try primary first, and on error or
  // timeout automatically retry against the fallback. With drpc free-tier
  // mempools filling up under multi-agent traffic, pairing a paid Alchemy
  // endpoint (primary) with the Arc-published rpc.testnet.arc.network
  // (fallback) keeps writes flowing even when one RPC sheds load.
  // Single-URL setups (just ARC_RPC_URL) still work — fallback() degrades
  // to a plain http() when given a one-element list.
  const transport = env.ARC_RPC_URL_FALLBACK
    ? fallback([http(env.ARC_RPC_URL), http(env.ARC_RPC_URL_FALLBACK)], {
        rank: false, // Don't reorder by latency — keep primary first deterministically.
        retryCount: 1, // One retry per attempt before moving to the next transport.
      })
    : http(env.ARC_RPC_URL);

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport,
  });

  const rawWalletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport,
  });

  // Wrap walletClient.writeContract + sendTransaction so EVERY chain write —
  // bets, market creates, USDC settles, x402 nanopayment settles, CCTP
  // attestation receives, trader-wallet faucet drops — auto-inherits the
  // 15× base + 25 gwei floor priority bid. Callers that explicitly pass
  // maxPriorityFeePerGas/maxFeePerGas (sendWithReplace's per-retry bumps,
  // execute-bet's pre-computed override) still win because the spread runs
  // AFTER the defaults. No per-call-site sed needed; one wrapper covers
  // all 17 writeContract sites in app.ts plus the trader-wallet path.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walletClient = new Proxy(rawWalletClient as any, {
    get(target, prop, receiver) {
      if (prop === "writeContract") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return async (args: any) => {
          const gas = await computeAggressiveGas(publicClient);
          return target.writeContract({ ...gas, ...args });
        };
      }
      if (prop === "sendTransaction") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return async (args: any) => {
          const gas = await computeAggressiveGas(publicClient);
          return target.sendTransaction({ ...gas, ...args });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as typeof rawWalletClient;

  return { publicClient, walletClient, account, quoteAccount };
}
