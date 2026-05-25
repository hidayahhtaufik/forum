#!/usr/bin/env tsx
/// Walk every market in market-api, read on-chain phase + winningOutcome DIRECTLY
/// (not trusting DB), find each agent's winning bets, claim winnings. Idempotent —
/// safe to re-run. Bypasses market-api's resolution state in case notify failed.
///
/// Usage (from repo root):
///   pnpm claim:all
///
/// Env required:
///   ARC_RPC_URL                 default https://rpc.testnet.arc.network
///   MARKET_API_URL              default http://127.0.0.1:8403
///   ORACLE/MIRROR/SAGE/HERMES/AUGUR_PRIVATE_KEY
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { createAgent, formatUsdc } from "../packages/forum-agent/dist/index.js";

const FOREX_MARKET_ABI = [
  { type: "function", name: "phase", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "winningOutcome", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const;

const REPO_ROOT = (() => {
  try {
    return pathResolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  } catch {
    return process.cwd();
  }
})();

type AgentSpec = {
  name: "oracle" | "mirror" | "sage" | "hermes" | "augur";
  envKey: string;
};

const AGENTS: AgentSpec[] = [
  { name: "oracle", envKey: "ORACLE_PRIVATE_KEY" },
  { name: "mirror", envKey: "MIRROR_PRIVATE_KEY" },
  { name: "sage",   envKey: "SAGE_PRIVATE_KEY"   },
  { name: "hermes", envKey: "HERMES_PRIVATE_KEY" },
  { name: "augur",  envKey: "AUGUR_PRIVATE_KEY"  },
];

type Bet = {
  id: number;
  marketId: string;
  agentAddress: string;
  outcome: 0 | 1;
  sharesWad: string;
  costUsdc: string;
};

type Market = {
  id: string;
  address: string;
  phase: 0 | 1 | 2;
  winningOutcome: 0 | 1 | 2 | null;
  question: string;
};

async function main() {
  const API = process.env["MARKET_API_URL"] ?? "http://127.0.0.1:8403";
  console.log("=== FORUM claim-all ===");
  console.log(`market-api: ${API}\n`);

  // Verify env presence early
  for (const a of AGENTS) {
    if (!process.env[a.envKey]) {
      console.error(`✗ missing env: ${a.envKey}`);
      process.exit(1);
    }
  }

  // 1. Fetch market list from market-api (just to get IDs + clone addresses)
  const marketsRes = await fetch(`${API}/markets`);
  if (!marketsRes.ok) {
    console.error(`✗ market-api /markets returned ${marketsRes.status}`);
    process.exit(1);
  }
  const { markets } = (await marketsRes.json()) as { markets: Market[] };
  console.log(`  ${markets.length} markets total — checking on-chain phase…\n`);

  // 2. For each market, read on-chain phase + winningOutcome (bypass DB).
  //    market-api's `phase` field may be stale if notify failed.
  const RPC = process.env["ARC_RPC_URL"] ?? "https://rpc.testnet.arc.network";
  const arc = defineChain({
    id: 5042002, name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
    rpcUrls: { default: { http: [RPC] } },
    testnet: true,
  });
  const pub = createPublicClient({ chain: arc, transport: http(RPC) });

  const resolvedMarkets: Market[] = [];
  for (const m of markets) {
    try {
      const [phase, winningOutcome] = await Promise.all([
        pub.readContract({ address: m.address as Address, abi: FOREX_MARKET_ABI, functionName: "phase" }),
        pub.readContract({ address: m.address as Address, abi: FOREX_MARKET_ABI, functionName: "winningOutcome" }),
      ]);
      const phaseNum = Number(phase);
      const winNum = Number(winningOutcome);
      console.log(`  ${m.id.slice(0, 10)}… phase=${phaseNum} winningOutcome=${winNum}`);
      // Contract Phase enum: 0=UNINITIALIZED, 1=OPEN, 2=CLOSED, 3=RESOLVED.
      if (phaseNum === 3) {
        resolvedMarkets.push({ ...m, phase: 2, winningOutcome: winNum as 0 | 1 | 2 });
      }
    } catch (err) {
      console.log(`  ${m.id.slice(0, 10)}… read failed: ${(err as Error).message.slice(0, 80)}`);
    }
  }

  console.log(`\n  ${resolvedMarkets.length} markets resolved on-chain\n`);

  if (resolvedMarkets.length === 0) {
    console.log("nothing to claim — no resolved markets on-chain yet.");
    return;
  }

  // 2. Build a map: agent address (lowercase) → recent bets
  const betsRes = await fetch(`${API}/bets/recent?limit=500`);
  if (!betsRes.ok) {
    console.error(`✗ market-api /bets/recent returned ${betsRes.status}`);
    process.exit(1);
  }
  const { bets } = (await betsRes.json()) as { bets: Bet[] };
  console.log(`  ${bets.length} bets in recent history\n`);

  const summary: SummaryRow[] = [];

  for (const a of AGENTS) {
    const account = privateKeyToAccount(process.env[a.envKey] as Hex);
    const addrLower = account.address.toLowerCase();

    // Find resolved markets this agent bet on with the WINNING outcome
    const winningBets = bets.filter((b) => {
      if (b.agentAddress.toLowerCase() !== addrLower) return false;
      const m = resolvedMarkets.find((mm) => mm.id.toLowerCase() === b.marketId.toLowerCase());
      if (!m) return false;
      return m.winningOutcome === b.outcome;
    });

    // Dedupe by marketId (one claim per market, not per bet)
    const winningMarketIds = Array.from(new Set(winningBets.map((b) => b.marketId.toLowerCase())));

    if (winningMarketIds.length === 0) {
      console.log(`▶ ${a.name.padEnd(7)} no winning bets — skipping`);
      summary.push({ name: a.name, action: "skip", reason: "no winning bets" });
      continue;
    }

    // Init agent SDK once per agent
    const agent = await createAgent({
      wallet: account,
      budget: { perBetUsdc: "0", dailyCapUsdc: "0" },
    });

    for (const marketId of winningMarketIds) {
      const market = resolvedMarkets.find((m) => m.id.toLowerCase() === marketId)!;
      console.log(`▶ ${a.name.padEnd(7)} claiming ${marketId.slice(0, 10)}… (${market.question.slice(0, 50)}…)`);
      try {
        const r = await agent.claim({
          marketId: marketId as Hex,
          marketAddress: market.address as Address,
        });
        if (r.claimed === 0n) {
          console.log(`  ↳ no shares (already claimed or zero balance)`);
          summary.push({ name: a.name, action: "already-claimed", marketId });
        } else {
          console.log(`  ↳ ✓ claimed ${formatUsdc(r.claimed)} USDC · tx ${r.txHash}`);
          console.log(`  ↳   explorer: ${r.explorer ?? "(n/a)"}`);
          summary.push({
            name: a.name,
            action: "claimed",
            marketId,
            claimedUsdc: formatUsdc(r.claimed),
            txHash: r.txHash ?? null,
          });
        }
      } catch (err) {
        const msg = (err as Error).message.slice(0, 200);
        console.log(`  ↳ ✗ ${msg}`);
        summary.push({ name: a.name, action: "error", marketId, error: msg });
      }
    }
  }

  // Final summary
  console.log("\n=== summary ===");
  for (const r of summary) {
    if (r.action === "claimed") {
      console.log(`  ${r.name.padEnd(7)} CLAIMED ${r.claimedUsdc} USDC — ${r.marketId.slice(0, 10)}… — ${r.txHash?.slice(0, 12)}…`);
    } else if (r.action === "already-claimed") {
      console.log(`  ${r.name.padEnd(7)} (already) — ${r.marketId.slice(0, 10)}…`);
    } else if (r.action === "skip") {
      console.log(`  ${r.name.padEnd(7)} skipped — ${r.reason}`);
    } else if (r.action === "error") {
      console.log(`  ${r.name.padEnd(7)} ERROR  — ${r.marketId.slice(0, 10)}… — ${r.error}`);
    }
  }
}

type SummaryRow =
  | { name: string; action: "claimed"; marketId: string; claimedUsdc: string; txHash: string | null }
  | { name: string; action: "already-claimed"; marketId: string }
  | { name: string; action: "skip"; reason: string }
  | { name: string; action: "error"; marketId: string; error: string };

main().catch((err) => {
  console.error("\n✗ claim-all failed:");
  console.error(err);
  process.exit(1);
});
