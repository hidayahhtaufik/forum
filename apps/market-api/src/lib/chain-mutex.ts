/// Process-wide mutex for the market-api wallet's chain writes.
///
/// Why: 5 agents betting concurrently fire 5 × 3 = 15 writeContract calls (settle,
/// approve, buyShares per bet) at the same wallet. Arc Testnet's per-account
/// mempool limit (~16 pending tx) overflows → `txpool is full` rejects new tx,
/// including the next `pnpm market:create` you try to run.
///
/// nonceManager (viem 2.x) prevents nonce *collisions* but does nothing about the
/// burst rate. This mutex serializes the bet flow end-to-end so at most one bet's
/// settle→approve→buyShares cycle is in-flight at a time. Throughput drops (~5-10
/// seconds per bet vs near-instant), but for v0.1 with 5 reference agents it's an
/// acceptable trade for predictable behavior.
///
/// Used by executeBet and any other endpoint that broadcasts from the market-api
/// wallet (createMarket, faucet, withdraw). Lock is FIFO (promise chain).

let queue: Promise<unknown> = Promise.resolve();

/// Caps how long a request can sit in the mutex queue before giving up.
/// 75s = ~2.5× the typical bet (3 sequential Arc Testnet tx × ~10-15s each).
/// Anything queued longer than that — almost always means a previous handler
/// is wedged on a stuck nonce / slow RPC / broken upstream. Bailing out lets
/// the user see a real error instead of a 10-minute spinning request.
const MAX_QUEUE_WAIT_MS = 75_000;

export class ChainLockTimeoutError extends Error {
  constructor() {
    super("market-api chain queue is wedged — try again in 30s");
    this.name = "ChainLockTimeoutError";
  }
}

/// Run `fn` while holding the chain-write lock. Throws propagate; the lock is
/// always released even on failure. If the request waits more than
/// MAX_QUEUE_WAIT_MS for its turn, throws `ChainLockTimeoutError` and skips
/// the work entirely.
export async function withChainLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    // Wait for our turn, but only up to MAX_QUEUE_WAIT_MS — race the previous
    // promise against a timeout that throws so we propagate a real 503.
    await Promise.race([
      previous,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new ChainLockTimeoutError()), MAX_QUEUE_WAIT_MS),
      ),
    ]);
    return await fn();
  } finally {
    release();
  }
}
