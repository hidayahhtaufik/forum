import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import type { Clients } from "../chain/clients.js";
import type { DB } from "../db/index.js";
import type { Env } from "../env.js";
import { markets, bets, type Market } from "../db/schema-pg.js";
import { ForexMarketAbi } from "../chain/abi/forex-market.js";
import { arcTestnet } from "../chain/arc.js";
import { bus } from "../event-bus.js";
import { withChainLock } from "./chain-mutex.js";

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
] as const;

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

export type ExecuteBetArgs = {
  market: Market;
  intent: {
    marketId: `0x${string}`;
    outcome: 0 | 1;
    shares: string;
    maxCost: string;
    deadline: number;
    agent: `0x${string}`;
    nonce: `0x${string}`;
  };
  intentHash: `0x${string}`;
  authorization: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    nonce: `0x${string}`;
    v: number;
    r: `0x${string}`;
    s: `0x${string}`;
  };
  /** M1 — optional sha256 of an already-pinned forecast trace. When set,
   *  the bet row links to the trace so /traces/<hash> + bet history pill
   *  light up automatically. */
  forecastSha256?: string;
};

export type ExecuteBetResult = {
  marketId: string;
  marketAddress: string;
  outcome: 0 | 1;
  shares: string;
  costUsdc: string;
  feeUsdc: string;
  txHash: `0x${string}`;
  settlementTxHash: `0x${string}`;
  blockNumber: number;
  explorer: string;
};

/// Runs the on-chain settle → approve → buyShares sequence for a validated bet
/// payload, then persists the bet row and emits an SSE event.
///
/// Both the human /bets endpoint and the custodial /traders/:addr/bet endpoint
/// share this flow — the only difference is who signs intent + EIP-3009
/// (caller's wallet vs server-held trader privkey).
export async function executeBet(
  deps: { env: Env; clients: Clients; db: DB },
  args: ExecuteBetArgs,
): Promise<ExecuteBetResult> {
  // Hold the chain lock for the entire bet flow. See chain-mutex.ts for why —
  // concurrent multi-agent bets would otherwise overflow Arc's per-account
  // mempool (~16 pending tx limit) and trigger `txpool is full` rejections.
  return withChainLock(() => executeBetUnlocked(deps, args));
}

async function executeBetUnlocked(
  deps: { env: Env; clients: Clients; db: DB },
  args: ExecuteBetArgs,
): Promise<ExecuteBetResult> {
  const { env, clients, db } = deps;
  const { market, intent, intentHash, authorization } = args;

  // 1) Re-quote on-chain (don't trust caller-supplied cost) + verify maxCost.
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
  if (authorization.value < totalNeeded) {
    throw new HTTPException(400, {
      message: `authorization.value ${authorization.value} < required ${totalNeeded}`,
    });
  }

  // MAX-PRIORITY gas mode — "no waiting" bet confirmation. Demo-window agents
  // fire bets back-to-back across 9 personas; even Alchemy's paid mempool gets
  // sticky if we bid below the top of the pending queue. Bidding 15× base as
  // priority fee + 20× as max fee cap guarantees inclusion in the very next
  // block on any healthy validator — at ~20 gwei base that's 300 gwei priority
  // / 400 gwei max. Per-tx gas cost is still <$0.02 USDC on Arc (21k-95k gas
  // typical), so a 0.25 USDC bet costs ~$0.02 to settle, total ~$0.27 — well
  // within demo budget. Trade-off: burns more treasury per bet (still fee-
  // positive — 2% protocol fee covers it) but every bet lands on the next
  // block, no retries, no perceived latency.
  const baseGasPrice = await clients.publicClient.getGasPrice().catch(() => 20_000_000_000n);
  // 25 gwei minimum floor — operator-requested guarantee. If Arc's base ever
  // sags below ~1.7 gwei the 15× multiplier alone wouldn't clear 25 gwei, but
  // validators on a quiet chain still want a meaningful priority bid. The
  // floor keeps every bet broadcast above 25 gwei priority no matter what.
  const MIN_PRIORITY_GWEI = 25_000_000_000n;
  const priorityFee = baseGasPrice * 15n > MIN_PRIORITY_GWEI ? baseGasPrice * 15n : MIN_PRIORITY_GWEI;
  const maxFee = baseGasPrice * 20n > priorityFee + baseGasPrice ? baseGasPrice * 20n : priorityFee + baseGasPrice;
  const gasOverride = { maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee };

  // 2) Settle USDC via transferWithAuthorization — buyer's USDC lands in market-api wallet.
  let settleTx: `0x${string}`;
  try {
    settleTx = await clients.walletClient.writeContract({
      chain: arcTestnet,
      account: clients.account,
      address: env.ARC_USDC as `0x${string}`,
      abi: USDC_TRANSFER_WITH_AUTH_ABI,
      functionName: "transferWithAuthorization",
      args: [
        authorization.from,
        authorization.to,
        authorization.value,
        authorization.validAfter,
        authorization.validBefore,
        authorization.nonce,
        authorization.v,
        authorization.r,
        authorization.s,
      ],
      ...gasOverride,
    });
    await clients.publicClient.waitForTransactionReceipt({
      hash: settleTx,
      timeout: 90_000,
      pollingInterval: 1_500,
    });
  } catch (err) {
    throw new HTTPException(502, { message: `USDC settle failed: ${(err as Error).message}` });
  }

  // 3) Approve the clone to pull totalNeeded from market-api wallet.
  try {
    const approveTx = await clients.walletClient.writeContract({
      chain: arcTestnet,
      account: clients.account,
      address: env.ARC_USDC as `0x${string}`,
      abi: USDC_APPROVE_ABI,
      functionName: "approve",
      args: [market.address as `0x${string}`, totalNeeded],
      ...gasOverride,
    });
    await clients.publicClient.waitForTransactionReceipt({
      hash: approveTx,
      timeout: 90_000,
      pollingInterval: 1_500,
    });
  } catch (err) {
    throw new HTTPException(502, { message: `approve failed: ${(err as Error).message}` });
  }

  // 4) Call ForexMarket.buyShares — clone pulls funds, mints outcome tokens to intent.agent.
  let buyTx: `0x${string}`;
  let buyReceipt: Awaited<ReturnType<typeof clients.publicClient.waitForTransactionReceipt>>;
  try {
    buyTx = await clients.walletClient.writeContract({
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
        intent.agent,
        intentHash,
      ],
      ...gasOverride,
    });
    buyReceipt = await clients.publicClient.waitForTransactionReceipt({
      hash: buyTx,
      timeout: 90_000,
      pollingInterval: 1_500,
    });
  } catch (err) {
    throw new HTTPException(502, { message: `buyShares reverted: ${(err as Error).message}` });
  }

  // 5) Persist + emit.
  const now = Math.floor(Date.now() / 1000);
  await db.insert(bets)
    .values({
      marketId: market.id,
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
      ...(args.forecastSha256 ? { forecastSha256: args.forecastSha256.toLowerCase() } : {}),
    });

  bus.emit({
    type: "bet.placed",
    marketId: market.id,
    agentAddress: intent.agent.toLowerCase(),
    outcome: intent.outcome,
    sharesWad: intent.shares,
    costUsdc: cost.toString(),
    feeUsdc: fee.toString(),
    txHash: buyTx.toLowerCase(),
    ts: now,
  });

  // 6) Best-effort: sync qYes/qNo back into DB so consumers see fresh prices.
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
      .where(eq(markets.id, market.id))
      ;
  } catch {
    // non-fatal: indexer worker (v0.2) is the real fix
  }

  return {
    marketId: market.id,
    marketAddress: market.address,
    outcome: intent.outcome,
    shares: intent.shares,
    costUsdc: cost.toString(),
    feeUsdc: fee.toString(),
    txHash: buyTx,
    settlementTxHash: settleTx,
    blockNumber: Number(buyReceipt.blockNumber),
    explorer: `https://testnet.arcscan.app/tx/${buyTx}`,
  };
}
