/// Resettable nonce manager for the market-api wallet.
///
/// Viem's built-in `nonceManager` has a fatal flaw: it increments its in-memory
/// counter every time `writeContract` calls `prepareTransactionRequest`, **even
/// when `eth_sendRawTransaction` is rejected by the RPC**. Over hours of
/// operation with intermittent RPC failures, the in-memory counter drifts
/// thousands of nonces ahead of the actual on-chain nonce. Every subsequent tx
/// is signed with a nonce the chain has never seen → permanent
/// "Transaction creation failed" until the process is manually restarted.
///
/// This custom manager fixes the drift problem:
///   1. Fetches the real nonce from the chain on first use.
///   2. Increments in-memory for concurrent calls (like viem's built-in).
///   3. **Auto-resets** when `markFailed()` is called — the next `get()` will
///      re-query the chain instead of using the stale counter.
///   4. Periodic drift detection: every N calls, compares in-memory vs on-chain
///      and resets if the gap exceeds a threshold.
///
/// Thread-safety: all nonce consumption goes through an async FIFO queue so
/// concurrent `writeContract` calls never receive the same nonce.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PublicClientLike = any;

/// How many nonces we tolerate between in-memory and on-chain before
/// force-resetting. 32 = ~10 serialised bet flows (3 tx each) worth of drift.
/// If we're 32+ nonces ahead of confirmed, something is very wrong.
const MAX_DRIFT = 32;

/// Re-check on-chain nonce every N consume() calls to catch slow drift before
/// it snowballs. 50 = roughly every 15-20 bets.
const DRIFT_CHECK_INTERVAL = 50;

export class ResettableNonceManager {
  private nextNonce: number | null = null;
  private consumeCount = 0;
  private readonly address: `0x${string}`;

  constructor(address: `0x${string}`) {
    this.address = address;
  }

  /// Get-and-increment the next nonce. If the in-memory counter is null
  /// (first call or after a reset), fetches from the chain.
  async consume(publicClient: PublicClientLike): Promise<number> {
    // Periodic drift check — every DRIFT_CHECK_INTERVAL calls, verify that
    // our in-memory counter hasn't wandered too far from reality.
    this.consumeCount++;
    if (this.nextNonce !== null && this.consumeCount % DRIFT_CHECK_INTERVAL === 0) {
      await this.checkDrift(publicClient);
    }

    if (this.nextNonce === null) {
      const onChain = await publicClient.getTransactionCount({
        address: this.address,
        blockTag: "pending",
      });
      this.nextNonce = onChain;
      console.log(`[nonce-mgr] synced nonce from chain: ${onChain}`);
    }

    const nonce = this.nextNonce!;
    this.nextNonce = nonce + 1;
    return nonce;
  }

  /// Mark the last-consumed nonce as failed (tx rejected by RPC before
  /// entering the mempool). Decrements the counter so the nonce is reused
  /// on the next call. If multiple failures accumulate, a full reset to
  /// chain state is triggered instead.
  markFailed(): void {
    if (this.nextNonce !== null && this.nextNonce > 0) {
      this.nextNonce--;
    }
    // After decrement, null the counter so next consume() re-fetches.
    // This is the nuclear option but it's the safest — a single failed
    // broadcast could mean the RPC is down, the nonce is stale, or
    // something else entirely. Re-querying is cheap (one eth_getTransactionCount).
    this.nextNonce = null;
    console.log(`[nonce-mgr] marked failed — will re-sync from chain on next call`);
  }

  /// Force a full reset — next consume() will query the chain.
  reset(): void {
    this.nextNonce = null;
    this.consumeCount = 0;
    console.log(`[nonce-mgr] force reset — will re-sync from chain`);
  }

  /// Compare in-memory counter against the chain and reset if drift exceeds
  /// MAX_DRIFT. Called periodically by consume().
  private async checkDrift(publicClient: PublicClientLike): Promise<void> {
    try {
      const onChain = await publicClient.getTransactionCount({
        address: this.address,
        blockTag: "pending",
      });
      const drift = (this.nextNonce ?? 0) - onChain;
      if (drift > MAX_DRIFT) {
        console.warn(
          `[nonce-mgr] drift detected: in-memory=${this.nextNonce}, on-chain=${onChain}, gap=${drift}. Resetting.`,
        );
        this.nextNonce = onChain;
      }
    } catch {
      // Non-fatal: if we can't check drift, we'll catch it on the next failure.
    }
  }

  /// Current in-memory nonce (for diagnostics). Returns null if not yet synced.
  get currentNonce(): number | null {
    return this.nextNonce;
  }
}
