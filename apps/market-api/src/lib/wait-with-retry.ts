import type { Hash, TransactionReceipt } from "viem";
import { WaitForTransactionReceiptTimeoutError } from "viem";

/// Loose duck-typed shape of viem's publicClient — the parameterized
/// PublicClient<T,U,V,W> from viem requires specific generics that change
/// based on chain + account config, and we don't want consumers to thread
/// those generics through. Both methods we need are stable.
type PublicClientLike = {
  waitForTransactionReceipt: (args: {
    hash: Hash;
    timeout?: number;
    pollingInterval?: number;
  }) => Promise<TransactionReceipt>;
  getTransactionReceipt: (args: { hash: Hash }) => Promise<TransactionReceipt>;
};

/// Resilient wrapper around viem's waitForTransactionReceipt.
///
/// Arc Testnet RPC sometimes returns a stale `null` for `eth_getTransactionReceipt`
/// even after a tx has confirmed, OR the validator includes the tx in a block
/// that the RPC node we polled hasn't ingested yet. In both cases viem's stock
/// `waitForTransactionReceipt` throws a `WaitForTransactionReceiptTimeoutError`
/// at the deadline even though the tx is actually fine.
///
/// This helper:
///   1. Calls waitForTransactionReceipt with a SHORT per-attempt timeout (default
///      30s) so we fail-fast and re-poll rather than holding the user's HTTP
///      request open on a single slow eth_getTransactionReceipt cycle.
///   2. On timeout, directly probes via `getTransactionReceipt` once — covers
///      the "RPC was just behind" case without paying another 30s wait.
///   3. Retries up to `totalTimeoutMs` (default 120s). Each retry starts a fresh
///      waitForTransactionReceipt poll, so transient RPC-node lag self-heals.
///   4. Throws a clear domain error after the total budget elapses — caller can
///      surface "tx submitted but not yet confirmed" to the user instead of
///      raw viem stack traces.
///
/// Trade-off: this doesn't replace the underlying tx with bumped gas — if the
/// validator legitimately won't include the tx (e.g. fee too low), the retry
/// won't help. For that we'd need a re-broadcast helper. Most production
/// dropouts on Arc Testnet are RPC-node-lag-not-validator-rejection, so this
/// covers the common case cheaply.
export async function waitWithRetry(
  publicClient: PublicClientLike,
  hash: Hash,
  opts: { perAttemptMs?: number; totalTimeoutMs?: number } = {},
): Promise<TransactionReceipt> {
  const perAttemptMs = opts.perAttemptMs ?? 30_000;
  const totalTimeoutMs = opts.totalTimeoutMs ?? 120_000;
  const start = Date.now();
  let attempts = 0;

  while (Date.now() - start < totalTimeoutMs) {
    attempts++;
    const remaining = totalTimeoutMs - (Date.now() - start);
    const attemptTimeout = Math.min(perAttemptMs, remaining);
    try {
      return await publicClient.waitForTransactionReceipt({
        hash,
        timeout: attemptTimeout,
      });
    } catch (err) {
      if (!(err instanceof WaitForTransactionReceiptTimeoutError)) throw err;
      // Direct probe — some RPC nodes return the receipt on getTransactionReceipt
      // even when the polling-based waitForTransactionReceipt times out.
      const direct = await publicClient
        .getTransactionReceipt({ hash })
        .catch(() => null);
      if (direct) return direct;
      // else fall through and try another wait window if budget allows
    }
  }

  throw new Error(
    `tx ${hash} not confirmed after ${attempts} attempt(s) over ${Math.round(
      (Date.now() - start) / 1000,
    )}s — Arc RPC may be slow, try again`,
  );
}
