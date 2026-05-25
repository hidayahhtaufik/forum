#!/usr/bin/env tsx
/// FORUM end-to-end demo orchestrator.
///
/// One script that drives the full v0.1 demo loop:
///   1. Create a fresh EUR/USD market with a short close window
///   2. Spawn all 5 reference agents (oracle/mirror/sage/hermes/augur) in oneshot mode
///   3. Wait for closesAt + grace
///   4. Poll resolver state until the on-chain Resolution lands
///   5. For each winning agent, call agent.claim() against ForexMarket
///   6. Print a summary table (per-agent: bet side · outcome · won shares · tx)
///
/// Run from repo root:
///   pnpm tsx scripts/demo-resolve.ts
///
/// Env required (loaded from .env at repo root by the caller):
///   MARKET_API_PRIVATE_KEY     creates the market (factory.createMarket)
///   ARC_RPC_URL                Arc Testnet RPC
///   ORACLE_PRIVATE_KEY         per-agent betting wallet
///   MIRROR_PRIVATE_KEY
///   SAGE_PRIVATE_KEY
///   HERMES_PRIVATE_KEY
///   AUGUR_PRIVATE_KEY
///
/// Env optional:
///   DEMO_DURATION_SEC          default 90    (closesAt = now + this)
///   DEMO_GRACE_SEC             default 30    (extra wait before polling resolution)
///   DEMO_SUBSIDY_USDC          default "0.50" (LMSR cold-start seed)
///   DEMO_B_WAD                 default "100" USDC (LMSR liquidity parameter)
///   DEMO_STRIKE                default "1.10" (EUR/USD strike, will use GTE comparator)
///   MARKET_API_URL             default http://127.0.0.1:8403
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  parseUnits,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAgent, ARC_USDC, formatUsdc } from "../packages/forum-agent/dist/index.js";

/// Caller is expected to run from the repo root (`pnpm tsx scripts/demo-resolve.ts`),
/// so cwd is canonical. We fall back to import.meta.url for direct-execution edge cases.
const REPO_ROOT = (() => {
  try {
    return pathResolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  } catch {
    return process.cwd();
  }
})();

type AgentSpec = {
  name: "oracle" | "mirror" | "sage" | "hermes" | "augur";
  pkgDir: string;
  envKey: string;
};

const AGENTS: AgentSpec[] = [
  { name: "oracle", pkgDir: "examples/forum-oracle", envKey: "ORACLE_PRIVATE_KEY" },
  { name: "mirror", pkgDir: "examples/forum-mirror", envKey: "MIRROR_PRIVATE_KEY" },
  { name: "sage",   pkgDir: "examples/forum-sage",   envKey: "SAGE_PRIVATE_KEY"   },
  { name: "hermes", pkgDir: "examples/forum-hermes", envKey: "HERMES_PRIVATE_KEY" },
  { name: "augur",  pkgDir: "examples/forum-augur",  envKey: "AUGUR_PRIVATE_KEY"  },
];

const FACTORY_ABI = [
  {
    type: "function",
    name: "createMarket",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "marketId", type: "bytes32" },
          { name: "quoteToken", type: "address" },
          { name: "bWad", type: "uint256" },
          { name: "opensAt", type: "uint64" },
          { name: "closesAt", type: "uint64" },
          { name: "subsidyUsdc6", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "market", type: "address" }],
    stateMutability: "nonpayable",
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

function fmtSec(s: number): string {
  return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, "0")}s`;
}

async function main() {
  console.log("=== FORUM demo-resolve ===\n");

  // 1. Deployment + env
  const deployment = JSON.parse(
    readFileSync(pathResolve(REPO_ROOT, "deployments/arc-testnet.json"), "utf-8"),
  ) as {
    forexMarketFactory: Address;
    resolver: Address;
    chainId: number;
  };

  const RPC = requireEnv("ARC_RPC_URL");
  const API = process.env["MARKET_API_URL"] ?? "http://127.0.0.1:8403";
  const DURATION = Number(process.env["DEMO_DURATION_SEC"] ?? "90");
  const GRACE = Number(process.env["DEMO_GRACE_SEC"] ?? "30");
  const SUBSIDY = parseUnits(process.env["DEMO_SUBSIDY_USDC"] ?? "0.50", 6);
  const B_WAD = parseUnits(process.env["DEMO_B_WAD"] ?? "100", 18);
  const STRIKE = process.env["DEMO_STRIKE"] ?? "1.10";

  const deployerKey = requireEnv("MARKET_API_PRIVATE_KEY") as Hex;
  const deployer = privateKeyToAccount(deployerKey);

  for (const a of AGENTS) requireEnv(a.envKey);

  const arc = defineChain({
    id: deployment.chainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
    rpcUrls: { default: { http: [RPC] } },
    blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
    testnet: true,
  });
  const publicClient = createPublicClient({ chain: arc, transport: http(RPC) });
  const walletClient = createWalletClient({ account: deployer, chain: arc, transport: http(RPC) });

  // 2. Create market via market-api — it approves USDC, calls factory.createMarket,
  // and indexes the row into the DB in one shot. Avoids the indexer gap where
  // an on-chain-only create leaves market-api blind to the new market.
  const opensAt = Math.floor(Date.now() / 1000);
  const closesAt = opensAt + DURATION;
  const question = `Will EUR/USD ≥ ${STRIKE} at ${new Date(closesAt * 1000).toISOString()}?`;
  const strikeWad = parseUnits(STRIKE, 18).toString();

  console.log(`question     : ${question}`);
  console.log(`opensAt      : ${opensAt}`);
  console.log(`closesAt     : ${closesAt} (in ${fmtSec(DURATION)})`);
  console.log(`subsidy      : ${formatUsdc(SUBSIDY)} USDC`);
  console.log(`b parameter  : 100 USDC equivalent`);
  console.log();

  console.log("▶ creating market via market-api …");
  const createRes = await fetch(`${API}/markets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      pair: "EURUSD",
      strikeWad,
      comparator: "GTE",
      bWad: B_WAD.toString(),
      opensAt,
      closesAt,
      subsidyUsdc: SUBSIDY.toString(),
    }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`market-api POST /markets failed: ${createRes.status} ${text}`);
  }
  const created = (await createRes.json()) as {
    marketId: Hex;
    marketAddress: Address;
    txHash: Hex;
    blockNumber: number;
    explorer: string;
  };
  const marketIdSeed = created.marketId;
  console.log(`  ✓ market id ${marketIdSeed.slice(0, 18)}…`);
  console.log(`  ✓ clone     ${created.marketAddress}`);
  console.log(`  ✓ tx        ${created.txHash} · block ${created.blockNumber}`);
  console.log();

  // 3. Spawn agents (oneshot)
  console.log(`▶ spawning ${AGENTS.length} agents (oneshot) …`);
  const procs = AGENTS.map((a) => spawnAgent(a));
  await Promise.allSettled(procs.map((p) => p.done));

  // 4. Wait for closesAt + grace
  const waitMs = Math.max(0, (closesAt - Math.floor(Date.now() / 1000) + GRACE) * 1000);
  console.log(`\n▶ waiting ${Math.ceil(waitMs / 1000)}s for closesAt + grace …`);
  await sleep(waitMs);

  // 5. Poll for resolution
  console.log("\n▶ polling for resolution …");
  const resolution = await pollResolution(API, marketIdSeed, 90_000);
  if (!resolution) {
    console.error("✗ timed out waiting for resolution; resolver worker may be offline");
    process.exit(1);
  }
  const winLabel = resolution.outcome === 1 ? "YES" : resolution.outcome === 0 ? "NO" : "INVALID";
  console.log(`  ✓ ${winLabel} won · source=${resolution.source} · tx ${resolution.txHash}\n`);

  // 6. Claims
  console.log("▶ claiming for each agent …");
  const summary: SummaryRow[] = [];
  for (const a of AGENTS) {
    const row = await tryClaim(a, marketIdSeed, deployment, RPC, deployment.chainId);
    summary.push(row);
  }

  // 7. Summary table
  console.log("\n=== summary ===");
  console.log(formatSummary(summary, winLabel));
  console.log(`\nexplorer: https://testnet.arcscan.app/tx/${resolution.txHash}`);
}

type SummaryRow = {
  name: string;
  status: "claimed" | "no-shares" | "error";
  shares: string;
  txHash: string | null;
  message: string;
};

async function tryClaim(
  a: AgentSpec,
  marketId: Hex,
  deployment: { forexMarketFactory: Address; resolver: Address; chainId: number },
  rpc: string,
  chainId: number,
): Promise<SummaryRow> {
  try {
    // Resolve market clone address from factory.marketOf(marketId).
    const arc = defineChain({
      id: chainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
      rpcUrls: { default: { http: [rpc] } },
      testnet: true,
    });
    const pub = createPublicClient({ chain: arc, transport: http(rpc) });
    const marketAddr = (await pub.readContract({
      address: deployment.forexMarketFactory,
      abi: [
        {
          type: "function",
          name: "marketOf",
          inputs: [{ name: "marketId", type: "bytes32" }],
          outputs: [{ type: "address" }],
          stateMutability: "view",
        },
      ] as const,
      functionName: "marketOf",
      args: [marketId],
    })) as Address;

    const account = privateKeyToAccount(process.env[a.envKey] as Hex);
    const agent = await createAgent({
      wallet: account,
      budget: { perBetUsdc: "0", dailyCapUsdc: "0" },
    });

    const result = await agent.claim({ marketId, marketAddress: marketAddr });
    if (result.claimed === 0n) {
      return { name: a.name, status: "no-shares", shares: "0", txHash: null, message: "no winning shares" };
    }
    return {
      name: a.name,
      status: "claimed",
      shares: formatUsdc(result.shares),
      txHash: result.txHash ?? null,
      message: "ok",
    };
  } catch (err) {
    return {
      name: a.name,
      status: "error",
      shares: "—",
      txHash: null,
      message: (err as Error).message.slice(0, 60),
    };
  }
}

function spawnAgent(a: AgentSpec) {
  const cwd = pathResolve(REPO_ROOT, a.pkgDir);
  const env = { ...process.env, [`${a.name.toUpperCase()}_ONESHOT`]: "true" };
  const tag = `[${a.name}]`;
  console.log(`  ▸ spawn ${a.name}`);
  const p = spawn("pnpm", ["start"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });

  p.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) console.log(`${tag} ${line}`);
    }
  });
  p.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) console.error(`${tag} ${line}`);
    }
  });

  const done = new Promise<number>((res) => p.on("close", (code) => res(code ?? -1)));
  return { proc: p, done };
}

type Resolution = {
  marketId: string;
  outcome: 0 | 1 | 2;
  source: string;
  txHash: string;
};

async function pollResolution(api: string, marketId: Hex, timeoutMs: number): Promise<Resolution | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${api}/markets/${marketId.toLowerCase()}/resolution`, { cache: "no-store" } as RequestInit);
      if (res.ok) return (await res.json()) as Resolution;
    } catch {
      // swallow + retry
    }
    process.stdout.write(".");
    await sleep(3_000);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function formatSummary(rows: SummaryRow[], winLabel: string): string {
  const lines: string[] = [];
  lines.push(`winning side: ${winLabel}`);
  lines.push("");
  lines.push("agent    status      shares        tx");
  lines.push("-------  ----------  ------------  -------");
  for (const r of rows) {
    const sh = r.shares.length > 12 ? `${r.shares.slice(0, 10)}…` : r.shares.padEnd(12);
    const tx = r.txHash ? `${r.txHash.slice(0, 10)}…` : "—";
    lines.push(`${r.name.padEnd(7)}  ${r.status.padEnd(10)}  ${sh}  ${tx}`);
  }
  return lines.join("\n");
}

main().catch((err) => {
  console.error("\n✗ demo-resolve failed:");
  console.error(err);
  process.exit(1);
});
