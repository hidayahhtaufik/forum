import { serve } from "@hono/node-server";
import { loadEnv } from "./env.js";
import { loadDeployment } from "./deployment.js";
import { makeClients, type Clients } from "./chain/clients.js";
import { openDatabase } from "./db/index.js";
import { createApp } from "./app.js";
import { arcTestnet } from "./chain/arc.js";

/// Boot warmup — sync viem's in-memory nonceManager with the chain by sending
/// a 0-value self-transfer. Required because: after a PM2 restart, viem's
/// nonceManager singleton is fresh and reads its starting nonce from the RPC
/// node that the first tx happens to hit. Arc Testnet RPC is load-balanced, so
/// different nodes can return slightly different `pending` counts, and a stale
/// reply means viem signs tx N while the chain expects N+k — that tx then sits
/// in mempool until it ages out, and EVERY downstream user-facing endpoint
/// (bet/withdraw/claim/bridge mint) times out at the nginx layer.
///
/// The self-transfer:
///   1. Forces viem to consume the nonce it BELIEVES is next, on a tx whose
///      success doesn't matter functionally (it just transfers USDC to self
///      with zero amount).
///   2. Waits up to 30s for that tx to confirm so we know RPC + wallet are
///      both alive before we start accepting user requests.
///   3. Is non-fatal: if Arc RPC is genuinely down, we still boot — the
///      regular endpoints will surface a clearer error than "warmup hung".
async function warmupNonce(clients: Clients): Promise<void> {
  const { publicClient, walletClient, account } = clients;
  try {
    const [confirmed, pending] = await Promise.all([
      publicClient.getTransactionCount({ address: account.address, blockTag: "latest" }),
      publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
    ]);
    console.log(
      `[forum/market-api] warmup: ${account.address} nonce confirmed=${confirmed} pending=${pending}`,
    );
    if (pending > confirmed) {
      console.warn(
        `[forum/market-api] warmup: ${pending - confirmed} pending tx(s) in mempool — they may block new sends`,
      );
    }

    const txHash = await walletClient.sendTransaction({
      account,
      chain: arcTestnet,
      to: account.address,
      value: 0n,
    });
    console.log(`[forum/market-api] warmup tx ${txHash} — waiting up to 30s`);

    await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
    console.log(`[forum/market-api] warmup confirmed · nonce synced with chain`);
  } catch (err) {
    console.warn(`[forum/market-api] warmup failed (non-fatal): ${(err as Error).message}`);
  }
}

async function main() {
  const env = loadEnv();
  const deployment = loadDeployment();

  if (deployment.chainId !== env.ARC_CHAIN_ID) {
    throw new Error(
      `chain mismatch: deployment.chainId=${deployment.chainId} but ARC_CHAIN_ID=${env.ARC_CHAIN_ID}`,
    );
  }

  const clients = makeClients(env);
  const { db, close: closeDb } = await openDatabase(env.DATABASE_URL);

  // Sync nonce BEFORE accepting traffic. Skipped via WARMUP_DISABLE=true so
  // local dev / CI doesn't burn an Arc tx on every restart.
  if (process.env["WARMUP_DISABLE"] !== "true") {
    await warmupNonce(clients);
  }

  const app = createApp({ env, deployment, clients, db });

  const port = env.MARKET_API_PORT ?? env.PORT;
  const server = serve(
    { fetch: app.fetch, port, hostname: env.HOST },
    (info) => {
      console.log(
        `[forum/market-api] listening at http://${info.address}:${info.port}` +
          `\n  factory=${deployment.forexMarketFactory}` +
          `\n  resolver=${deployment.resolver}` +
          `\n  db=${env.DATABASE_URL}`,
      );
    },
  );

  const shutdown = async () => {
    console.log("[forum/market-api] shutting down");
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[forum/market-api] fatal:", err);
  process.exit(1);
});
