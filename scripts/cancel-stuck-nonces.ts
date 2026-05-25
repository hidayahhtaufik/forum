#!/usr/bin/env tsx
/// Cancel-tx sweep for the market-api wallet's stuck pending queue.
///
/// Symptom: every agent bet times out with
///   `tx not confirmed after 3 attempt(s) ... drpc.org`
/// but the wallet's confirmed nonce hasn't moved in 10+ minutes.
///
/// Root cause: drpc admitted dozens of agent-bet txs into its mempool while
/// our priority fee was 1.6 gwei. Validators on a congested Arc Testnet
/// preferred other (higher-bid) traffic, so those low-bid txs sat. Once we
/// bumped to 37 gwei, *new* txs got into the mempool but landed at the END
/// of our personal nonce queue — they can't mine until the older low-bid
/// txs ahead of them mine first. They won't, because they're underpriced.
///
/// This script reads `pending - latest` on Arc, then for every stuck nonce
/// in that range sends a self-transfer with very high priority fee. A
/// validator picking by max-priority will evict the stuck low-bid tx and
/// include the cancel-tx instead, freeing the queue.
///
/// Usage:
///   tsx scripts/cancel-stuck-nonces.ts
///
/// Env required (read from .env):
///   MARKET_API_PRIVATE_KEY  the wallet whose queue we're unblocking
///   ARC_RPC_URL             default https://arc-testnet.drpc.org
///
/// Safety:
/// - The replacement tx has value=0 and data=empty — even if it lands, it
///   only burns gas. No funds move to anyone else.
/// - We do NOT touch any wallet other than MARKET_API_PRIVATE_KEY's owner.
/// - Reads private key from process.env, never logged.

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env["ARC_RPC_URL"] ?? "https://arc-testnet.drpc.org";
const KEY = process.env["MARKET_API_PRIVATE_KEY"];

if (!KEY || !KEY.startsWith("0x") || KEY.length !== 66) {
  console.error("✗ MARKET_API_PRIVATE_KEY missing or malformed in env");
  console.error("  Run with: tsx --env-file=.env scripts/cancel-stuck-nonces.ts");
  process.exit(1);
}

const ARC_CHAIN = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const account = privateKeyToAccount(KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: ARC_CHAIN, transport: http(RPC) });
const walletClient = createWalletClient({ chain: ARC_CHAIN, account, transport: http(RPC) });

async function main() {
  console.log("=== cancel-stuck-nonces ===");
  console.log(`wallet: ${account.address}`);
  console.log(`rpc:    ${RPC}`);

  const [latest, pending, baseGas] = await Promise.all([
    publicClient.getTransactionCount({ address: account.address, blockTag: "latest" }),
    publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
    publicClient.getGasPrice(),
  ]);

  const stuckCount = pending - latest;
  console.log(`confirmed nonce: ${latest}`);
  console.log(`pending nonce:   ${pending}`);
  console.log(`STUCK txs:       ${stuckCount}`);
  console.log(`base gas:        ${baseGas} wei (~${Number(baseGas) / 1e9} gwei)`);

  if (stuckCount === 0) {
    console.log("\n✓ no stuck txs — nothing to do");
    return;
  }
  if (stuckCount > 100) {
    console.error(`✗ refusing — ${stuckCount} stuck txs is more than expected, manual inspection needed`);
    process.exit(2);
  }

  // Bid 10× current base as priority fee — well above the 4× our agents
  // use, so validators preferentially include these cancel-txs over the
  // stuck originals. Cancel-txs are tiny (21000 gas, no data) so the
  // total cost is still <$0.005 per cancel even at this priority.
  const priorityFee = baseGas * 10n;
  const maxFee = baseGas * 15n;
  console.log(`cancel priority: ${priorityFee} wei (~${Number(priorityFee) / 1e9} gwei)`);
  console.log(`cancel maxFee:   ${maxFee} wei (~${Number(maxFee) / 1e9} gwei)`);

  console.log(`\nbroadcasting ${stuckCount} cancel-txs for nonces ${latest}…${pending - 1}…`);
  const hashes: string[] = [];
  for (let n = latest; n < pending; n++) {
    try {
      const hash = await walletClient.sendTransaction({
        chain: ARC_CHAIN,
        account,
        to: account.address, // self
        value: 0n,
        nonce: n,
        maxPriorityFeePerGas: priorityFee,
        maxFeePerGas: maxFee,
        gas: 21000n, // minimum for a value-only EOA transfer
      });
      console.log(`  nonce ${n} → ${hash}`);
      hashes.push(hash);
    } catch (err) {
      // "nonce too low" / "already known" / "replacement transaction underpriced" — log + continue
      console.log(`  nonce ${n} ✗ ${(err as Error).message.split("\n")[0]}`);
    }
  }

  console.log(`\nwaiting up to 90s for chain to process the cancellations…`);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const newLatest = await publicClient.getTransactionCount({ address: account.address, blockTag: "latest" });
    const newPending = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    process.stdout.write(`\r  confirmed: ${newLatest}  pending: ${newPending}  gap: ${newPending - newLatest}  `);
    if (newLatest >= pending) {
      console.log("\n✓ queue fully drained — agents can resume betting");
      break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.log();

  console.log("next: restart market-api so its viem nonceManager re-reads chain state:");
  console.log("  pm2 restart forum-market-api --update-env");
}

main().catch((err) => {
  console.error("\n✗ cancel-stuck-nonces failed:");
  console.error(err);
  process.exit(1);
});
