import type { Hash, TransactionReceipt } from "viem";
import { WaitForTransactionReceiptTimeoutError } from "viem";

/// Resilient broadcast-and-confirm with stuck-tx replacement.
///
/// Standard `walletClient.writeContract(args)` + `waitForTransactionReceipt`
/// fails closed when a tx broadcasts but never gets included — typical on
/// flaky public testnet RPCs where validators drop underpriced txs silently.
/// User then sees a 502 from the route handler, has to retry from the UI,
/// and meanwhile the wallet's local nonce manager has incremented so the
/// retry collides with the original (now-stuck) tx in the mempool.
///
/// `sendWithReplace` wraps the broadcast + confirm cycle:
///   1. Calls `submit(retry)` to broadcast. Caller assembles their own
///      writeContract args; helper just passes back optional `nonce` and
///      `priorityFeeWei` overrides for replacement attempts.
///   2. Waits up to `perAttemptMs` (default 45s) for receipt.
///   3. On timeout, pins the actual on-chain nonce of the original tx,
///      bumps gas by `gasBumpFactor` (default 25% > the EIP-1559 minimum
///      12.5%), and re-calls `submit` — same nonce, higher fee. The fresh
///      broadcast replaces the stuck one in mempool on validators that
///      respect fee replacement.
///   4. Repeats up to `maxAttempts` (default 3). Worst case ~135s total.
///
/// Throws a domain error after the attempt budget — caller surfaces a
/// clean message ("network busy, retry in a moment") instead of raw viem.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PublicClientLike = any;

export type SubmitArgs = {
  /** First call: undefined → let viem's nonceManager pick. Retries: pinned
   *  to the nonce the original broadcast used, so re-submission counts as
   *  a replacement instead of a new queued tx. viem's writeContract expects
   *  a plain number here, not bigint. */
  nonce: number | undefined;
  /** First call: undefined → use viem's default fee estimation. Retries:
   *  computed from the chain's current base fee × `gasBumpFactor`. Pass to
   *  writeContract as `maxPriorityFeePerGas` (and at least double for the
   *  `maxFeePerGas` cap). */
  priorityFeeWei: bigint | undefined;
  /** Attempt number, 0-indexed. Useful for logging the retry path. */
  attempt: number;
};

export async function sendWithReplace<TReceipt extends TransactionReceipt = TransactionReceipt>(
  publicClient: PublicClientLike,
  submit: (args: SubmitArgs) => Promise<Hash>,
  opts: {
    perAttemptMs?: number;
    maxAttempts?: number;
    gasBumpFactor?: number;
    label?: string;
  } = {},
): Promise<TReceipt> {
  const perAttemptMs = opts.perAttemptMs ?? 45_000;
  const maxAttempts = opts.maxAttempts ?? 3;
  const gasBumpFactor = opts.gasBumpFactor ?? 1.25;
  const label = opts.label ?? "tx";

  let pinnedNonce: number | undefined;
  let lastHash: Hash | undefined;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Compute priority fee for THIS attempt. MAX-PRIORITY mode from the start:
    // even the first attempt bids 15× the current base fee as priority. This
    // guarantees inclusion in the very next block on any healthy validator
    // (Alchemy paid + Arc public both honour the bid), so there's no first-
    // attempt "wait 45s to see if it lands". Subsequent attempts bump
    // cumulatively (15× × 1.5^attempt) so a network spike doesn't trap us.
    //
    // Per-tx cost at ~20 gwei base: 15× = 300 gwei priority. A bet flow tx
    // burns ~21k-100k gas, so worst-case ~0.03 USDC per tx, ~0.10 USDC for
    // the full settle+approve+buyShares trio. The 2% protocol fee on every
    // bet ≥ ~5 USDC covers it; the demo's smaller-bet pattern eats a bit of
    // treasury (~50 USDC starting balance), acceptable for "no waiting".
    let priorityFeeWei: bigint;
    const baseFee = await publicClient
      .getGasPrice()
      .catch(() => 20_000_000_000n); // 20 gwei fallback
    const initialMultiplier = 15n;
    // 25 gwei minimum floor — operator-requested. Validators on a quiet chain
    // (low base fee) still want meaningful priority; the floor guarantees
    // inclusion even when 15×base would round low.
    const MIN_PRIORITY_GWEI = 25_000_000_000n;
    if (attempt === 0) {
      const proposed = baseFee * initialMultiplier;
      priorityFeeWei = proposed > MIN_PRIORITY_GWEI ? proposed : MIN_PRIORITY_GWEI;
    } else {
      const retryMultiplier = Math.pow(gasBumpFactor, attempt);
      const proposed = (baseFee * initialMultiplier * BigInt(Math.ceil(retryMultiplier * 100))) / 100n;
      priorityFeeWei = proposed > MIN_PRIORITY_GWEI ? proposed : MIN_PRIORITY_GWEI;
    }

    let hash: Hash;
    try {
      hash = await submit({ nonce: pinnedNonce, priorityFeeWei, attempt });
    } catch (err) {
      // Broadcast itself failed (likely simulation revert). Bumping gas
      // won't help — bubble up immediately so the caller surfaces a real
      // error message instead of a generic retry-loop timeout.
      throw err;
    }
    lastHash = hash;
    if (attempt > 0) {
      console.log(`[${label}] replacement attempt ${attempt} broadcast as ${hash}`);
    }

    // Pin the nonce viem actually used on the FIRST broadcast — every
    // subsequent retry must reuse it to count as a replacement.
    if (pinnedNonce === undefined) {
      const submitted = await publicClient.getTransaction({ hash }).catch(() => null);
      if (submitted?.nonce !== undefined) pinnedNonce = Number(submitted.nonce);
    }

    try {
      const receipt = (await publicClient.waitForTransactionReceipt({
        hash,
        timeout: perAttemptMs,
      })) as TReceipt;
      return receipt;
    } catch (err) {
      if (!(err instanceof WaitForTransactionReceiptTimeoutError)) throw err;
      // Cheap direct probe — covers the RPC-node-lag case for free.
      const direct = (await publicClient
        .getTransactionReceipt({ hash })
        .catch(() => null)) as TReceipt | null;
      if (direct) return direct;
      lastErr = err;
      console.warn(`[${label}] attempt ${attempt + 1}/${maxAttempts} timed out · bumping gas + replacing`);
      // Continue to next loop iteration with bumped fee + same nonce
    }
  }

  throw new Error(
    `${label}: tx not confirmed after ${maxAttempts} attempt(s)` +
      (lastHash ? ` · last hash ${lastHash}` : "") +
      (lastErr instanceof Error ? ` · ${lastErr.message}` : ""),
  );
}
