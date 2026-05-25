#!/usr/bin/env tsx
/// Create a fresh prediction market without spawning agents.
/// Useful when you want a clean market to play with (manual betting, demos).
///
/// Usage:
///   pnpm market:create                              # default EUR/USD USDC 30-min market
///   DEMO_DURATION_SEC=600 pnpm market:create        # 10-minute market
///   DEMO_STRIKE=1.12 pnpm market:create             # custom strike (else current spot from real source)
///   DEMO_COLLATERAL=EURC pnpm market:create         # EURC-collateralized
///   DEMO_PAIR=CADUSD pnpm market:create             # Canadian dollar — StableFX QCAD corridor (BoC Valet API)
///
/// Env required:
///   MARKET_API_URL    default http://127.0.0.1:8403
///   RUNNER_AUTH_SECRET (POST /markets is admin-gated after the recent
///                      hardening — pull it from the same .env the keeper
///                      uses, or paste manually before running)
///
/// Markets are indexed into market-api's DB the moment they're created.
import { parseUnits } from "viem";

const API = process.env["MARKET_API_URL"] ?? "http://127.0.0.1:8403";
const DURATION = Number(process.env["DEMO_DURATION_SEC"] ?? "1800"); // 30 min default
const SUBSIDY = parseUnits(process.env["DEMO_SUBSIDY_USDC"] ?? "0.50", 6);
const B_WAD = parseUnits(process.env["DEMO_B_WAD"] ?? "100", 18);
const PAIR = (process.env["DEMO_PAIR"] ?? "EURUSD").toUpperCase();
const EXPLICIT_STRIKE = process.env["DEMO_STRIKE"];

/// Fetch the current real reference rate for the pair from the
/// authoritative source (ECB via Frankfurter for EUR pairs, Bank of
/// Canada Valet for CAD pairs). Returns the strike as "spot ± random
/// pip offset" so the resulting market is non-trivial — without
/// jitter, daily-fix rate = strike at create AND at close, and
/// GTE always resolves YES. ±50 pips centers the prediction space
/// around the current spot with realistic uncertainty either side.
async function fetchCurrentSpot(pair: string): Promise<string> {
  if (pair.length !== 6) return "1.00";
  const base = pair.slice(0, 3);
  const symbol = pair.slice(3);
  let spot: number | null = null;
  try {
    if (base === "CAD" && symbol === "USD") {
      const r = await fetch("https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1");
      const j = (await r.json()) as { observations?: Array<{ FXUSDCAD?: { v: string } }> };
      const usdcad = Number(j.observations?.[0]?.FXUSDCAD?.v);
      if (Number.isFinite(usdcad) && usdcad > 0) spot = 1 / usdcad;
    }
    if (spot === null) {
      const r = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=${symbol}`);
      const j = (await r.json()) as { rates?: Record<string, number> };
      const rate = j.rates?.[symbol];
      if (typeof rate === "number" && rate > 0) spot = rate;
    }
  } catch {
    /* fall through to default */
  }
  if (spot === null) {
    console.warn(`fetchCurrentSpot: no rate for ${pair}, defaulting to 1.00`);
    return "1.00";
  }
  // ±50 pip jitter so the market isn't a trivial GTE-strike == spot.
  const pipsOffset = Math.floor((Math.random() * 2 - 1) * 50);
  const offset = pipsOffset * 0.0001;
  const strike = Math.round((spot + offset) * 10_000) / 10_000;
  return strike.toFixed(4);
}

/// Format a unix timestamp as "23 May 14:23 UTC" — replaces the
/// previous Date.toISOString() ".000Z" suffix that was leaking into
/// market.question strings and making the UI look like a Postgres log.
function formatMarketCloseLabel(unix: number): string {
  const d = new Date(unix * 1000);
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${dd} ${mon} ${hh}:${mm} UTC`;
}
const COLLATERAL = (process.env["DEMO_COLLATERAL"] ?? "USDC").toUpperCase() as "USDC" | "EURC";
if (COLLATERAL !== "USDC" && COLLATERAL !== "EURC") {
  console.error(`DEMO_COLLATERAL must be USDC or EURC, got: ${COLLATERAL}`);
  process.exit(1);
}

/// Human-readable label for a 6-char pair code. Falls back to the raw
/// code if we don't have a labelled entry (custom pair).
function labelPair(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)}/${code.slice(3)}`;
}

async function main() {
  const STRIKE = EXPLICIT_STRIKE ?? (await fetchCurrentSpot(PAIR));
  const opensAt = Math.floor(Date.now() / 1000);
  const closesAt = opensAt + DURATION;
  const question = `Will ${labelPair(PAIR)} ≥ ${STRIKE} by ${formatMarketCloseLabel(closesAt)}?`;
  const strikeWad = parseUnits(STRIKE, 18).toString();

  console.log("=== FORUM market-create ===");
  console.log(`api:        ${API}`);
  console.log(`pair:       ${labelPair(PAIR)}${PAIR === "CADUSD" ? "  (Stablecorp QCAD ↔ USDC, StableFX corridor)" : ""}`);
  console.log(`question:   ${question}`);
  console.log(`opens:      ${new Date(opensAt * 1000).toLocaleString()}`);
  console.log(`closes:     ${new Date(closesAt * 1000).toLocaleString()} (in ${Math.floor(DURATION / 60)}m)`);
  console.log(`strike:     GTE ${STRIKE}${EXPLICIT_STRIKE ? "" : "  (current spot from real source)"}`);
  console.log(`collateral: ${COLLATERAL}`);
  console.log(`subsidy:    ${Number(SUBSIDY) / 1_000_000} ${COLLATERAL}`);
  console.log();
  console.log("▶ creating market …");

  const runnerSecret = process.env["RUNNER_AUTH_SECRET"];
  if (!runnerSecret) {
    console.error(
      "✗ RUNNER_AUTH_SECRET missing — POST /markets is admin-gated.\n" +
        "  Source the same .env keeper/scout/translator use, or paste manually.",
    );
    process.exit(1);
  }
  const res = await fetch(`${API}/markets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-runner-secret": runnerSecret,
    },
    body: JSON.stringify({
      question,
      pair: PAIR,
      strikeWad,
      comparator: "GTE",
      bWad: B_WAD.toString(),
      opensAt,
      closesAt,
      subsidyUsdc: SUBSIDY.toString(),
      collateral: COLLATERAL,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`✗ failed: ${res.status} ${text}`);
    process.exit(1);
  }

  const data = (await res.json()) as {
    marketId: string;
    marketAddress: string;
    txHash: string;
    blockNumber: number;
    explorer: string;
  };

  console.log("✓ created");
  console.log(`  market id:  ${data.marketId}`);
  console.log(`  clone:      ${data.marketAddress}`);
  console.log(`  block:      ${data.blockNumber}`);
  console.log(`  tx:         ${data.txHash}`);
  console.log(`  explorer:   ${data.explorer}`);
  console.log();
  console.log("View it at:");
  console.log(`  https://forum.auranode.xyz/markets/${data.marketId}`);
}

main().catch((err) => {
  console.error("\n✗ market-create failed:");
  console.error(err);
  process.exit(1);
});
