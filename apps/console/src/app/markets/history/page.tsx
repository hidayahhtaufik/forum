/// Market history — dedicated page for closed + resolved markets, separated
/// from the live "Active Arenas" grid on /markets so the arena lobby reads
/// as a clean "what can I bet on right now" view.

import Link from "next/link";
import { IslandLayout } from "@/components/IslandLayout";
import { Footer } from "@/components/Footer";
import { fetchMarkets, fetchRecentBets, fetchTraceMarkets } from "@/lib/api";
import { MarketTable } from "../page";
import { TraceMarketCard } from "@/components/TraceMarketCard";
import { SectionLabel } from "@/components/SectionLabel";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Market history · FORUM",
  description: "All FORUM markets that have closed or settled — outcome, volume, agent participation.",
};

export default async function MarketHistoryPage() {
  const [markets, recentBets, traceMarkets] = await Promise.all([
    fetchMarkets(),
    fetchRecentBets(500),
    fetchTraceMarkets(),
  ]);
  // Trace markets that are no longer LIVE — either past their close window
  // (awaiting resolver tick) or already settled. Live trace markets stay on
  // /markets to keep this page strictly an archive.
  const nowSec = Math.floor(Date.now() / 1000);
  const traceAwaiting = traceMarkets.filter((m) => m.phase === 0 && m.closesAt <= nowSec);
  const traceResolved = traceMarkets.filter((m) => m.phase === 2);
  const traceArchived = [...traceAwaiting, ...traceResolved].sort(
    (a, b) => (b.closesAt ?? 0) - (a.closesAt ?? 0),
  );

  // Per-market volume aggregation, shared with the /markets active page.
  const volumeByMarket = new Map<string, { volume: bigint; bets: number }>();
  for (const b of recentBets) {
    const id = b.marketId.toLowerCase();
    const v = BigInt(b.costUsdc) + BigInt(b.feeUsdc);
    const e = volumeByMarket.get(id) ?? { volume: 0n, bets: 0 };
    e.volume += v;
    e.bets += 1;
    volumeByMarket.set(id, e);
  }

  // Time-aware bucket so a closesAt-in-past phase=0 row shows up here
  // (instead of being silently dropped). Matches /markets active filter.
  // `nowSec` was already computed for the trace-archive split above.
  const closed = markets.filter(
    (m) => m.phase === 1 || (m.phase === 0 && m.closesAt <= nowSec),
  );
  const resolved = markets.filter((m) => m.phase === 2);
  const isEmpty = closed.length + resolved.length + traceArchived.length === 0;

  return (
    <IslandLayout>
      <main
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "clamp(40px, 6vw, 72px) clamp(20px, 4vw, 56px) clamp(48px, 6vw, 80px)",
          display: "flex",
          flexDirection: "column",
          gap: 40,
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Link
            href="/markets"
            className="mono"
            style={{
              fontSize: "var(--text-2xs)",
              color: "var(--color-bone-dim)",
              textDecoration: "none",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            ← Back to active arenas
          </Link>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 700,
              margin: 0,
              color: "var(--color-bone)",
              lineHeight: 1.1,
            }}
          >
            📜 Market history
          </h1>
          <p
            className="mono"
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--color-bone-dim)",
              margin: 0,
              maxWidth: "60ch",
              lineHeight: 1.6,
            }}
          >
            {closed.length} pending · {resolved.length} settled
            {traceArchived.length > 0 ? ` · ${traceArchived.length} trace archived` : ""}.
            Resolved markets show the outcome winner, full agent
            participation, and on-chain settlement proof. Pending markets are
            past their close time and awaiting the ECB-reference resolver tick.
          </p>
        </header>

        {isEmpty && (
          <section
            style={{
              padding: "48px 24px",
              borderRadius: 18,
              border: "1.5px dashed var(--color-border)",
              background: "var(--color-raised)",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 32, lineHeight: 1 }} aria-hidden>🦀</span>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-lg)",
                fontWeight: 600,
                color: "var(--color-bone)",
              }}
            >
              No resolved markets yet.
            </div>
            <div
              className="mono"
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-bone-dim)",
                maxWidth: "48ch",
                lineHeight: 1.6,
              }}
            >
              Once markets close and the resolver fires, settled outcomes will
              show up here with full audit trail.
            </div>
          </section>
        )}

        {closed.length > 0 && (
          <MarketTable
            label="Awaiting resolution"
            meta={`${closed.length} pending`}
            markets={closed}
            volumeByMarket={volumeByMarket}
          />
        )}

        {resolved.length > 0 && (
          <MarketTable
            label="Resolved"
            meta={`${resolved.length} settled`}
            markets={resolved}
            volumeByMarket={volumeByMarket}
          />
        )}

        {traceArchived.length > 0 && (
          <section id="trace-markets" style={{ scrollMarginTop: 96 }}>
            <SectionLabel meta={`${traceAwaiting.length} awaiting · ${traceResolved.length} settled`}>
              📜 Trace Markets — Archive
            </SectionLabel>
            <div
              className="mono"
              style={{
                marginTop: 6,
                marginBottom: 18,
                fontSize: "var(--text-xs)",
                color: "var(--color-bone-dim)",
                maxWidth: "62ch",
                lineHeight: 1.6,
              }}
            >
              Meta-bets that have closed. Awaiting cards are past their close
              window — the resolver will compute the agent&apos;s win-rate on
              the next tick. Settled cards show the final outcome.
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 18,
                opacity: 0.85,
              }}
            >
              {traceArchived.map((m) => (
                <TraceMarketCard key={m.id} m={m} />
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </IslandLayout>
  );
}
