#!/usr/bin/env -S node --experimental-strip-types
/// seed-demo-markets — populate the live API with a diverse set of open
/// markets so the Arena lobby is never empty for the demo + Discord seeding
/// window. Hits POST /markets which is gated only by being a "trusted local
/// caller" (per app.ts:624) — run this from the VPS shell.
///
/// Usage on VPS:
///   cd ~/forum-arc
///   pnpm tsx scripts/seed-demo-markets.ts
///   # or with custom API:
///   MARKET_API_URL=http://127.0.0.1:8403 pnpm tsx scripts/seed-demo-markets.ts
///
/// Each market gets:
///   - a different EUR/USD strike + comparator
///   - a different close window (6h, 12h, 24h, 48h, 1 week)
///   - alternating USDC + EURC collateral (showcases Stable FX pairing)
///   - 5 USDC subsidy locked in LMSR pool (refunded on resolve)
///
/// Idempotent — if a market id (keccak of question + closesAt) already
/// exists, server returns 409 and we skip.

type MarketSeed = {
  question: string;
  pair: string;
  strikeWad: string;
  comparator: "GT" | "GTE" | "LT" | "LTE";
  bWad: string;
  opensAt: number;
  closesAt: number;
  subsidyUsdc: string;
  createdBy: string;
  collateral: "USDC" | "EURC";
};

const API = process.env.MARKET_API_URL ?? "http://127.0.0.1:8403";
const NOW = Math.floor(Date.now() / 1000);
const HOUR = 3_600;

// Subsidy lowered 5_000_000 → 1_000_000 (5 USDC → 1 USDC per market) so the
// market-api operator wallet (treasury) survives seeding 5 markets without
// draining.
//
// ALL markets are USDC for now. EURC subsidy requires the operator wallet
// to hold EURC, which it doesn't by default — the first attempt failed with
// "ERC20: transfer amount exceeds balance" exactly because of that. Fund
// the operator with EURC via faucet.circle.com → its address from /info,
// then add EURC markets back in a follow-up commit.
//
// bWad bumped down too (100e18 → 50e18) — still plenty of LMSR depth for
// the demo and halves the gas cost per createMarket.
const SUBSIDY_USDC = "1000000";    // 1 USDC
const B_WAD        = "50000000000000000000"; // 50 USDC

const SEEDS: MarketSeed[] = [
  {
    question: `Will EUR/USD ≥ 1.18 at ${iso(NOW + 24 * HOUR)}?`,
    pair: "EURUSD", strikeWad: "1180000000000000000", comparator: "GTE",
    bWad: B_WAD, opensAt: NOW, closesAt: NOW + 24 * HOUR,
    subsidyUsdc: SUBSIDY_USDC, createdBy: "manual", collateral: "USDC",
  },
  {
    question: `Will EUR/USD ≤ 1.15 at ${iso(NOW + 12 * HOUR)}?`,
    pair: "EURUSD", strikeWad: "1150000000000000000", comparator: "LTE",
    bWad: B_WAD, opensAt: NOW, closesAt: NOW + 12 * HOUR,
    subsidyUsdc: SUBSIDY_USDC, createdBy: "manual", collateral: "USDC",
  },
  {
    question: `Will EUR/USD ≥ 1.20 at ${iso(NOW + 48 * HOUR)}?`,
    pair: "EURUSD", strikeWad: "1200000000000000000", comparator: "GTE",
    bWad: B_WAD, opensAt: NOW, closesAt: NOW + 48 * HOUR,
    subsidyUsdc: SUBSIDY_USDC, createdBy: "manual", collateral: "USDC",
  },
  {
    question: `Will EUR/USD ≥ 1.17 at ${iso(NOW + 6 * HOUR)}?`,
    pair: "EURUSD", strikeWad: "1170000000000000000", comparator: "GTE",
    bWad: B_WAD, opensAt: NOW, closesAt: NOW + 6 * HOUR,
    subsidyUsdc: SUBSIDY_USDC, createdBy: "manual", collateral: "USDC",
  },
  {
    question: `Will EUR/USD ≤ 1.10 at ${iso(NOW + 7 * 24 * HOUR)}?`,
    pair: "EURUSD", strikeWad: "1100000000000000000", comparator: "LTE",
    bWad: B_WAD, opensAt: NOW, closesAt: NOW + 7 * 24 * HOUR,
    subsidyUsdc: SUBSIDY_USDC, createdBy: "manual", collateral: "USDC",
  },
];

function iso(epoch: number): string {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

async function postMarket(seed: MarketSeed): Promise<"ok" | "skip" | "fail"> {
  const res = await fetch(`${API}/markets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(seed),
  });
  const text = await res.text();
  if (res.ok) {
    const json = JSON.parse(text) as { txHash?: string; id?: string };
    console.log(`✓ ${seed.collateral.padEnd(4)} ${seed.comparator} ${(Number(seed.strikeWad) / 1e18).toFixed(2)} · closes in ${((seed.closesAt - NOW) / HOUR).toFixed(0)}h`);
    console.log(`   tx ${json.txHash ?? "(no tx field)"}  id ${json.id?.slice(0, 18) ?? "(no id)"}…`);
    return "ok";
  }
  if (res.status === 409) {
    console.log(`⊙ skip — already exists: ${seed.question.slice(0, 50)}…`);
    return "skip";
  }
  console.log(`✗ FAIL ${res.status} — ${seed.question.slice(0, 50)}…`);
  console.log(`   ${text.slice(0, 280)}`);
  // Common signals — give the user a one-line hint instead of just the
  // raw error.
  if (text.includes("transfer amount exceeds balance")) {
    console.log(`   ↳ Operator wallet is out of ${seed.collateral}. Send testnet ${seed.collateral} to it or lower subsidyUsdc.`);
  } else if (text.includes("Timed out while waiting")) {
    console.log(`   ↳ Tx broadcast but never confirmed (most likely reverted on-chain). Check Arcscan with the hash above.`);
  }
  return "fail";
}

async function main() {
  console.log(`[seed] target ${API}`);
  console.log(`[seed] ${SEEDS.length} markets to create (USDC-only, ${SUBSIDY_USDC} subsidy each)`);

  // Pre-flight — surface the operator wallet's USDC + EURC balance so the
  // user sees up front whether they have headroom for the subsidies.
  try {
    const info = await fetch(`${API}/`).then((r) => r.json() as Promise<{ payTo?: string }>);
    if (info.payTo) {
      console.log(`[seed] operator wallet ${info.payTo}`);
    }
  } catch { /* non-fatal */ }
  console.log();

  let success = 0, failed = 0, skipped = 0;
  for (const seed of SEEDS) {
    try {
      const status = await postMarket(seed);
      if (status === "ok") success++;
      else if (status === "skip") skipped++;
      else {
        failed++;
        // Bail on first hard failure — usually means operator out of USDC
        // or contract revert. No point spamming the chain.
        console.log();
        console.log(`[seed] bailing after first hard failure — fix the cause then re-run.`);
        break;
      }
    } catch (err) {
      console.log(`✗ EXCEPTION — ${(err as Error).message}`);
      failed++;
      break;
    }
    // Give the on-chain mutex room: each market is 2 sequential txs
    // (approve + createMarket), so 5s between calls is comfortable.
    await new Promise((r) => setTimeout(r, 5_000));
  }
  console.log();
  const open = await fetch(`${API}/markets?status=open`).then((r) => r.json() as Promise<{ count: number }>);
  console.log(`[seed] ${success} created · ${skipped} already existed · ${failed} failed`);
  console.log(`[seed] ${open.count} open markets now visible at /markets`);
}

main().catch((err) => {
  console.error("[seed] fatal:", err);
  process.exit(1);
});
