#!/usr/bin/env tsx
/// Force-sync every market's DB phase from on-chain. Use when the resolver
/// submitted a Resolution on-chain but the notify-webhook to market-api
/// failed (transient outage, schema mismatch, etc).
///
/// Idempotent — safe to re-run. Reads each market's phase + winningOutcome
/// from the ForexMarket clone and updates market-api's DB if it lags.
///
/// Usage:
///   pnpm sync:markets

const API = process.env["MARKET_API_URL"] ?? "http://127.0.0.1:8403";

type Market = { id: string; phase: 0 | 1 | 2; winningOutcome: 0 | 1 | 2 | null };

async function main() {
  console.log("=== FORUM sync-markets ===");
  console.log(`api: ${API}\n`);

  const res = await fetch(`${API}/markets`);
  if (!res.ok) {
    console.error(`✗ /markets returned ${res.status}`);
    process.exit(1);
  }
  const { markets } = (await res.json()) as { markets: Market[] };
  console.log(`  ${markets.length} markets in DB\n`);

  let updated = 0;
  for (const m of markets) {
    const syncRes = await fetch(`${API}/admin/sync-market/${m.id.toLowerCase()}`, { method: "POST" });
    if (!syncRes.ok) {
      console.log(`  ✗ ${m.id.slice(0, 12)}… sync failed: ${syncRes.status}`);
      continue;
    }
    const r = (await syncRes.json()) as {
      onchainPhase: number;
      onchainWinningOutcome: number;
      dbPhase: number;
      updated: boolean;
    };
    const flag = r.updated ? "UPDATED" : "in-sync";
    const out = r.onchainPhase === 3 ? `→ winner=${r.onchainWinningOutcome === 1 ? "YES" : r.onchainWinningOutcome === 0 ? "NO" : "INV"}` : "";
    console.log(`  ${flag.padEnd(8)} ${m.id.slice(0, 12)}… onchain=${r.onchainPhase} db=${r.dbPhase} ${out}`);
    if (r.updated) updated++;
  }

  console.log(`\n✓ done · ${updated} markets updated`);
}

main().catch((err) => {
  console.error("\n✗ sync-markets failed:");
  console.error(err);
  process.exit(1);
});
