#!/usr/bin/env tsx
/// FORUM M3+M4 e2e dogfood
///
/// Exercises the full M3 marketplace + M4 trace-markets pipeline at the
/// HTTP level against a running market-api. No smart-contract calls, no
/// LLM calls — just the user-facing flow:
///
///   1. POST /traders/issue user-a + user-b              (two identities)
///   2. POST /traders/:addr/faucet for both              (drip 1 USDC each)
///   3. POST /agents/spawn (owned by user-a)             (fresh persona)
///   4. POST /marketplace/rent (user-b rents user-a's agent)
///       → broadcasts EIP-3009 user-b → agent (0.10 USDC)
///       → inserts copy_trade row so user-b auto-mirrors
///   5. GET /agents/owned/:userA                          (verify ownership)
///   6. POST /trace-markets (meta-bet on the spawned agent)
///   7. POST /trace-markets/:id/bet from user-b           (0.05 USDC YES)
///   8. GET /trace-markets/:id                            (verify pool ↑)
///
/// Prints a labeled summary table at the end so failures are obvious.
///
/// Run from repo root:
///   pnpm tsx scripts/e2e-m3-m4.ts
///
/// Env:
///   MARKET_API_URL   defaults http://127.0.0.1:8403

const API = process.env["MARKET_API_URL"] ?? "http://127.0.0.1:8403";

type Json = Record<string, unknown>;

async function http<T = Json>(
  method: "GET" | "POST",
  path: string,
  body?: Json,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const err = (parsed as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(`${method} ${path} → ${err}`);
  }
  return parsed as T;
}

function tag(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

function step(label: string): void {
  console.log(`\n──── ${label} ────`);
}

function ok(line: string): void {
  console.log(`  ✓ ${line}`);
}

async function main(): Promise<void> {
  console.log(`FORUM M3+M4 e2e — API ${API}\n`);

  // ------------------------------------------------------------------
  // 1. Issue two identities
  // ------------------------------------------------------------------
  step("1/8 issue user-a + user-b trader wallets");
  const userA = await http<{ address: string; isNew: boolean }>(
    "POST",
    "/traders/issue",
    { identity: tag("e2e-user-a") },
  );
  ok(`user-a address ${userA.address}`);

  const userB = await http<{ address: string; isNew: boolean }>(
    "POST",
    "/traders/issue",
    { identity: tag("e2e-user-b") },
  );
  ok(`user-b address ${userB.address}`);

  // ------------------------------------------------------------------
  // 2. Faucet both (1 USDC each)
  // ------------------------------------------------------------------
  step("2/8 faucet 1 USDC to each");
  const faucetA = await http<{ txHash: string }>(
    "POST",
    `/traders/${userA.address}/faucet`,
  );
  ok(`user-a faucet tx ${faucetA.txHash}`);

  const faucetB = await http<{ txHash: string }>(
    "POST",
    `/traders/${userB.address}/faucet`,
  );
  ok(`user-b faucet tx ${faucetB.txHash}`);

  // ------------------------------------------------------------------
  // 3. Spawn an agent owned by user-a
  // ------------------------------------------------------------------
  step("3/8 spawn agent (owned by user-a, strategy=standard)");
  const spawned = await http<{
    address: string;
    ownerIdentity: string;
    personaLabel: string;
    strategyId: string;
  }>("POST", "/agents/spawn", {
    identity: userA.address,
    label: `E2E Agent ${Date.now().toString(36)}`,
    strategyId: "standard",
  });
  ok(`agent ${spawned.address} owner=${spawned.ownerIdentity}`);
  ok(`label "${spawned.personaLabel}" strategy=${spawned.strategyId}`);

  // ------------------------------------------------------------------
  // 4. user-b rents the agent — REAL USDC payment
  // ------------------------------------------------------------------
  step("4/8 user-b rents the agent for 6h (priceUsdc=0.10)");
  const rent = await http<{ txHash?: string; endsAt?: number }>(
    "POST",
    "/marketplace/rent",
    {
      renter: userB.address,
      agentAddress: spawned.address,
      durationHours: 6,
      priceUsdc: "100000", // 0.10 USDC base units
      sizeMultiplier: 0.25,
    },
  );
  ok(`rent tx ${rent.txHash ?? "(none returned)"}`);

  // ------------------------------------------------------------------
  // 5. user-a's owned-agents grid should include the spawned agent
  // ------------------------------------------------------------------
  step("5/8 verify /agents/owned/<user-a> lists spawned agent");
  const owned = await http<{ count: number; agents: Array<{ address: string }> }>(
    "GET",
    `/agents/owned/${userA.address}`,
  );
  const found = owned.agents.find((a) => a.address.toLowerCase() === spawned.address.toLowerCase());
  if (!found) {
    throw new Error(
      `owned list does not contain spawned agent ${spawned.address} (count=${owned.count})`,
    );
  }
  ok(`owned grid contains spawned agent (${owned.count} total)`);

  // ------------------------------------------------------------------
  // 6. Create a trace market on the spawned agent (50% / 24h)
  // ------------------------------------------------------------------
  step("6/8 create trace market (threshold=5000bps, window=24h)");
  const tm = await http<{ id: string; targetAgent: string }>(
    "POST",
    "/trace-markets",
    {
      targetAgent: spawned.address,
      thresholdBps: 5000,
      windowHours: 24,
    },
  );
  ok(`trace market ${tm.id}`);
  ok(`target ${tm.targetAgent}`);

  // ------------------------------------------------------------------
  // 7. user-b places a YES meta-bet for 0.05 USDC
  // ------------------------------------------------------------------
  step("7/8 user-b places YES meta-bet (0.05 USDC)");
  const bet = await http<{ txHash?: string; amountUsdc?: string }>(
    "POST",
    `/trace-markets/${tm.id}/bet`,
    {
      bettor: userB.address,
      outcome: 1,
      amountUsdc: "0.05",
    },
  );
  ok(`bet tx ${bet.txHash ?? "(none returned)"}`);

  // ------------------------------------------------------------------
  // 8. Verify pool counter updated
  // ------------------------------------------------------------------
  step("8/8 verify trace-market YES pool reflects bet");
  const after = await http<{
    yesPoolUsdc: string;
    noPoolUsdc: string;
    bets: Array<{ bettor: string; outcome: number; costUsdc: string }>;
  }>("GET", `/trace-markets/${tm.id}`);
  const yes = BigInt(after.yesPoolUsdc);
  const expected = BigInt(50_000); // 0.05 USDC
  if (yes < expected) {
    throw new Error(
      `YES pool ${yes} < expected ${expected} (no=${after.noPoolUsdc}, bets=${after.bets.length})`,
    );
  }
  ok(`YES pool ${(Number(yes) / 1e6).toFixed(2)} USDC (${after.bets.length} bet${after.bets.length === 1 ? "" : "s"})`);

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("  M3+M4 e2e: PASS");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  user-a         ${userA.address}`);
  console.log(`  user-b         ${userB.address}`);
  console.log(`  spawned agent  ${spawned.address}`);
  console.log(`  trace market   ${tm.id}`);
  console.log(`  rent tx        ${rent.txHash ?? "—"}`);
  console.log(`  trace bet tx   ${bet.txHash ?? "—"}`);
  console.log(`  YES pool       ${(Number(after.yesPoolUsdc) / 1e6).toFixed(2)} USDC`);
  console.log(`  NO pool        ${(Number(after.noPoolUsdc) / 1e6).toFixed(2)} USDC`);
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(`\n✗ e2e FAILED: ${(err as Error).message}\n`);
  process.exit(1);
});
