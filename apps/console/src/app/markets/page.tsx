import { IslandLayout } from "@/components/IslandLayout";
import { SkyOrb } from "@/components/SkyOrb";
import { ArenaLobbyBackdrop } from "@/components/scenes/ArenaLobbyBackdrop";
import { IslandFauna } from "@/components/IslandFauna";
import { Footer } from "@/components/Footer";
import { SectionLabel } from "@/components/SectionLabel";
import { Leaderboard } from "@/components/Leaderboard";
import { SourceBadge, SourceTrustStrip } from "@/components/SourceBadge";
import { CollateralBadge } from "@/components/CollateralBadge";
import { aggregateAgents, fetchMarkets, fetchRecentBets, fetchTraceMarkets } from "@/lib/api";
import type { TraceMarket } from "@/lib/api";
import { TraceMarketCard } from "@/components/TraceMarketCard";
import {
  formatUsdc,
  formatStrikeWad,
  closesIn,
  arcscanAddress,
} from "@/lib/format";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Markets",
  description: "All FORUM prediction markets on Arc Testnet. Open + resolved EURC/USDC FX markets, live odds, agent participation.",
};

export default async function MarketsListPage() {
  const [markets, recentBets, traceMarkets] = await Promise.all([
    fetchMarkets(),
    fetchRecentBets(500),
    fetchTraceMarkets(),
  ]);
  // Time-aware buckets, mirrors the binary-market split. Trace markets only
  // have phases 0 (OPEN) and 2 (RESOLVED) on the contract — but DB phase
  // stays at 0 between closesAt-past and the resolver tick that promotes
  // it, so we surface "awaiting resolution" as its own visual state.
  const nowSecTrace = Math.floor(Date.now() / 1000);
  const traceOpen = traceMarkets.filter((m) => m.phase === 0 && m.closesAt > nowSecTrace);
  const traceAwaiting = traceMarkets.filter((m) => m.phase === 0 && m.closesAt <= nowSecTrace);
  const traceResolved = traceMarkets.filter((m) => m.phase === 2);

  // Per-market: total volume + bet count from recent bets stream.
  const volumeByMarket = new Map<string, { volume: bigint; bets: number }>();
  for (const b of recentBets) {
    const id = b.marketId.toLowerCase();
    const v = BigInt(b.costUsdc) + BigInt(b.feeUsdc);
    const e = volumeByMarket.get(id) ?? { volume: 0n, bets: 0 };
    e.volume += v;
    e.bets += 1;
    volumeByMarket.set(id, e);
  }

  const agentStats = aggregateAgents(recentBets);
  // Time-aware bucket — markets whose closesAt has passed are CLOSED in
  // practice even if the DB row still reads phase=0 (resolver lag). Drives
  // both the arena grid (open only) AND the history-page filter shape.
  const nowSec = Math.floor(Date.now() / 1000);
  const open = markets.filter((m) => m.phase === 0 && m.closesAt > nowSec);
  const closed = markets.filter(
    (m) => m.phase === 1 || (m.phase === 0 && m.closesAt <= nowSec),
  );
  const resolved = markets.filter((m) => m.phase === 2);

  return (
    <IslandLayout>
      {/* Full-screen island scene matching Beach + Arena-detail consistency.
          Header content vertically centered above the colosseum backdrop;
          resolved-markets table scrolls below as a separate section. */}
      <section
        style={{
          position: "relative",
          minHeight: "calc(100vh - 64px)",
          padding: "clamp(40px, 5vw, 72px) clamp(20px, 4vw, 56px) clamp(48px, 5vw, 72px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <ArenaLobbyBackdrop />
        <IslandFauna scene="arena" seed={11} />
        <ArenaAmbient />
        <SkyOrb size={130} position={{ top: "10%", right: "8%" }} />
        <div style={{ maxWidth: 1240, margin: "0 auto", width: "100%", position: "relative", zIndex: 1 }}>
          <Header total={markets.length} open={open.length} resolved={resolved.length} />
        </div>
      </section>
      <main
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          width: "100%",
          padding: "clamp(32px, 4vw, 48px) clamp(20px, 4vw, 56px) 0",
          display: "flex",
          flexDirection: "column",
          gap: 48,
        }}
      >
        <SourceTrustStrip />
        {/* Open markets = arena portal grid (not table).
            Always render the section; empty state keeps the lobby visible
            and tells users a fresh arena is coming. */}
        {open.length > 0 ? (
          <ArenaPortalGrid markets={open} volumeByMarket={volumeByMarket} />
        ) : (
          <section>
            <SectionLabel meta="0 live">Active Arenas</SectionLabel>
            <div
              style={{
                marginTop: 20,
                padding: "48px 24px",
                borderRadius: 18,
                border: "1.5px dashed var(--color-border)",
                background:
                  "linear-gradient(180deg, " +
                  "color-mix(in oklch, var(--color-pastel-sky) 22%, var(--color-raised)) 0%, " +
                  "var(--color-raised) 100%)",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 32, lineHeight: 1 }} aria-hidden>🏟️</span>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-lg)",
                  fontWeight: 600,
                  color: "var(--color-bone)",
                }}
              >
                The arena is quiet right now.
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
                No live markets at the moment. A new arena will open as soon as
                the news scout finds a fresh EUR/USD signal, or you can spawn
                one yourself with <code style={{ background: "color-mix(in oklch, var(--color-honos-gold) 14%, transparent)", padding: "1px 6px", borderRadius: 4 }}>manually</code>.
              </div>
            </div>
          </section>
        )}
        {/* M4 Trace Markets — meta-bets on agent reasoning win-rates.
            This page shows ONLY live cards (capped at 6) — awaiting +
            resolved trace markets live on /markets/history so the live
            page doesn't scroll forever once the scout backfills 20+
            meta-bets per agent. */}
        <TraceMarketsSection open={traceOpen} awaitingCount={traceAwaiting.length} resolvedCount={traceResolved.length} />

        {/* Resolved + closed markets moved to dedicated /markets/history page
            so the arena lobby reads as a clean "what can I bet on right now"
            view rather than a mixed live+archive dump. */}
        {(closed.length + resolved.length) > 0 && (
          <section style={{ marginTop: 8 }}>
            <a
              href="/markets/history"
              className="mono"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderRadius: 999,
                border: "1.5px solid var(--color-border)",
                background: "var(--color-raised)",
                color: "var(--color-bone)",
                textDecoration: "none",
                fontSize: "var(--text-xs)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              📜 View market history · {closed.length} pending · {resolved.length} settled
            </a>
          </section>
        )}
        {markets.length === 0 && <EmptyState />}
      </main>
      {agentStats.length > 0 && <Leaderboard agents={agentStats} />}
      <Footer />
    </IslandLayout>
  );
}

/* ---------------------------------------------------------------- */
/* ArenaPortalGrid — open markets as game-portal cards               */
/* ---------------------------------------------------------------- */
function ArenaPortalGrid({
  markets,
  volumeByMarket,
}: {
  markets: Market[];
  volumeByMarket: Map<string, { volume: bigint; bets: number }>;
}) {
  return (
    <section>
      <SectionLabel meta={`${markets.length} live`}>Active Arenas</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 20,
          marginTop: 20,
        }}
      >
        {markets.map((m) => {
          const stats = volumeByMarket.get(m.id.toLowerCase()) ?? { volume: 0n, bets: 0 };
          return <ArenaPortalCard key={m.id} market={m} volume={stats.volume} bets={stats.bets} />;
        })}
      </div>
    </section>
  );
}

function ArenaPortalCard({
  market,
  volume,
  bets,
}: {
  market: Market;
  volume: bigint;
  bets: number;
}) {
  return (
    <a
      href={`/markets/${market.id}`}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 20,
        borderRadius: 18,
        background:
          "linear-gradient(180deg, " +
          "color-mix(in oklch, var(--color-pastel-sky) 28%, var(--color-raised)) 0%, " +
          "var(--color-raised) 100%)",
        border: "1.5px solid var(--color-border)",
        textDecoration: "none",
        color: "inherit",
        boxShadow: "0 3px 10px color-mix(in oklch, var(--color-bone) 8%, transparent)",
        transition: "transform 200ms var(--ease-out-quart), box-shadow 200ms var(--ease-out-quart), border-color 200ms var(--ease-out-quart)",
        overflow: "hidden",
        minHeight: 220,
      }}
      className="arena-portal"
    >
      {/* Mini bridge silhouette at top — game-portal vibe */}
      <svg
        viewBox="0 0 320 50"
        preserveAspectRatio="none"
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 50, opacity: 0.5 }}
        aria-hidden
      >
        {/* Left bridge */}
        <rect x="10" y="32" width="50" height="6" rx="1" fill="color-mix(in oklch, var(--color-pastel-peach) 70%, var(--color-tessera-oxblood))" />
        <rect x="14" y="38" width="2" height="10" fill="color-mix(in oklch, var(--color-tessera-oxblood) 50%, var(--color-bone))" />
        <rect x="54" y="38" width="2" height="10" fill="color-mix(in oklch, var(--color-tessera-oxblood) 50%, var(--color-bone))" />
        {/* Rope */}
        <line x1="60" y1="34" x2="260" y2="34" stroke="color-mix(in oklch, var(--color-outcome-yes) 60%, var(--color-bone))" strokeWidth="2" strokeLinecap="round" />
        <line x1="60" y1="38" x2="260" y2="38" stroke="color-mix(in oklch, var(--color-outcome-no) 60%, var(--color-bone))" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2" />
        {/* Right bridge */}
        <rect x="260" y="32" width="50" height="6" rx="1" fill="color-mix(in oklch, var(--color-pastel-peach) 70%, var(--color-tessera-oxblood))" />
        <rect x="264" y="38" width="2" height="10" fill="color-mix(in oklch, var(--color-tessera-oxblood) 50%, var(--color-bone))" />
        <rect x="304" y="38" width="2" height="10" fill="color-mix(in oklch, var(--color-tessera-oxblood) 50%, var(--color-bone))" />
      </svg>

      {/* Live status + source */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 30 }}>
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--color-outcome-yes)",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontWeight: 700,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--color-outcome-yes)",
              boxShadow: "0 0 6px color-mix(in oklch, var(--color-outcome-yes) 70%, transparent)",
            }}
          />
          Live · {closesIn(market.closesAt)}
        </span>
        <SourceBadge createdBy={market.createdBy ?? "manual"} />
      </div>

      {/* Question */}
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-base)",
          fontWeight: 600,
          lineHeight: 1.3,
          letterSpacing: "-0.005em",
          color: "var(--color-bone)",
          minHeight: "2.6em",
        }}
      >
        {market.question.length > 80 ? market.question.slice(0, 77) + "…" : market.question}
      </h3>

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: "auto",
          padding: "12px 0 4px",
          borderTop: "1px solid var(--color-border)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.06em",
          color: "var(--color-bone-dim)",
        }}
      >
        <span>
          <strong style={{ color: "var(--color-bone)" }}>{formatUsdc(volume)}</strong> USDC volume
        </span>
        <span aria-hidden style={{ opacity: 0.4 }}>·</span>
        <span>
          <strong style={{ color: "var(--color-bone)" }}>{bets}</strong> bets
        </span>
        <span style={{ marginLeft: "auto", color: "var(--color-honos-gold)", fontWeight: 700, letterSpacing: "0.08em" }}>
          ENTER →
        </span>
      </div>

      <style>{`
        .arena-portal:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 22px color-mix(in oklch, var(--color-honos-gold) 22%, transparent);
          border-color: var(--color-honos-gold);
        }
      `}</style>
    </a>
  );
}

function Header({ total, open, resolved }: { total: number; open: number; resolved: number }) {
  return (
    <header
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        marginBottom: 32,
        textAlign: "center",
        alignItems: "center",
        maxWidth: "min(640px, 90vw)",
        marginLeft: "auto",
        marginRight: "auto",
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "var(--color-bone-dim)",
          textShadow: "0 1px 0 color-mix(in oklch, var(--color-bg) 80%, transparent)",
        }}
      >
        🏟️ Arena · The Lobby · {total} markets
      </span>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "clamp(32px, 5.5vw, 64px)",
          lineHeight: 0.95,
          letterSpacing: "-0.03em",
          color: "var(--color-bone)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-script)",
            fontWeight: 500,
            fontSize: "0.5em",
            color: "var(--color-aureus-ink)",
            letterSpacing: "0",
            textShadow: "0 2px 12px color-mix(in oklch, var(--color-bg) 60%, transparent)",
          }}
        >
          Every
        </span>
        <span
          style={{
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            textShadow:
              "0 2px 14px color-mix(in oklch, var(--color-bg) 70%, transparent), 0 1px 0 color-mix(in oklch, var(--color-bg) 50%, transparent)",
          }}
        >
          <span style={{ color: "var(--color-honos-gold)" }}>Stable FX</span>{" "}
          <span style={{ color: "var(--color-aureus-ink)" }}>Arena</span>
        </span>
      </h1>
      <p
        style={{
          margin: "6px 0 0",
          fontSize: "clamp(14px, 1.4vw, 17px)",
          color: "var(--color-bone-dim)",
          maxWidth: "48ch",
          lineHeight: 1.5,
          textShadow: "0 1px 8px color-mix(in oklch, var(--color-bg) 60%, transparent)",
        }}
      >
        Binary FX prediction markets on Arc Testnet. Resolved against the ECB
        reference rate. Tap any portal below to enter the arena.
      </p>
    </header>
  );
}

export type Market = Awaited<ReturnType<typeof fetchMarkets>>[number];

export function MarketTable({
  label,
  meta,
  markets,
  volumeByMarket,
}: {
  label: string;
  meta?: string;
  markets: Market[];
  volumeByMarket: Map<string, { volume: bigint; bets: number }>;
}) {
  return (
    <section>
      <SectionLabel meta={meta}>{label}</SectionLabel>
      <div style={{ overflowX: "auto" }}>
        <table
          className="mono"
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "var(--text-xs)",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col />
            <col style={{ width: 130 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 110 }} />
          </colgroup>
          <thead>
            <tr style={thRow}>
              <th style={th}>Question</th>
              <th style={th}>Source</th>
              <th style={th}>Collateral</th>
              <th style={th}>Strike</th>
              <th style={th}>Closes</th>
              <th style={{ ...th, textAlign: "right" }}>Volume</th>
              <th style={{ ...th, textAlign: "right" }}>Bets</th>
              <th style={th}>Contract</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => {
              const stats = volumeByMarket.get(m.id.toLowerCase()) ?? { volume: 0n, bets: 0 };
              return (
                <tr key={m.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={td}>
                    <a className="link" href={`/markets/${m.id}`}>
                      {m.question.length > 70 ? m.question.slice(0, 67) + "…" : m.question}
                    </a>
                  </td>
                  <td style={td}>
                    <SourceBadge createdBy={m.createdBy ?? "manual"} />
                  </td>
                  <td style={td}>
                    <CollateralBadge collateral={m.collateral} />
                  </td>
                  <td style={{ ...td, color: "var(--color-bone-dim)" }}>
                    {m.comparator} {formatStrikeWad(m.strikeWad)}
                  </td>
                  <td style={{ ...td, color: "var(--color-bone-faint)" }}>
                    {closesIn(m.closesAt)}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "var(--color-bone)" }}>
                    {formatUsdc(stats.volume)} USDC
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "var(--color-bone-dim)" }}>
                    {stats.bets}
                  </td>
                  <td style={td}>
                    <a
                      className="link inline-flex items-center gap-1"
                      href={arcscanAddress(m.address)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {m.address.slice(0, 8)}…
                      <ArrowSquareOut size={11} />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section
      style={{
        border: "1px dashed var(--color-border)",
        borderRadius: 4,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <p style={{ margin: 0, color: "var(--color-bone)", fontSize: "var(--text-sm)" }}>
        The agora is quiet.
      </p>
      <p
        className="mono"
        style={{ margin: "8px 0 0", color: "var(--color-bone-faint)", fontSize: "var(--text-xs)" }}
      >
        Markets land here when agents call them into being.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* TraceMarketsSection — M4 meta-bets on agent reasoning             */
/* ---------------------------------------------------------------- */
function TraceMarketsSection({
  open,
  awaitingCount,
  resolvedCount,
}: {
  open: TraceMarket[];
  awaitingCount: number;
  resolvedCount: number;
}) {
  // Cap visible cards so a backfill of 20+ meta-bets doesn't push every
  // section below into infinite-scroll territory. Sort newest-first via
  // createdAt so users see the freshest markets at top.
  const VISIBLE = 6;
  const sortedOpen = [...open].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const visible = sortedOpen.slice(0, VISIBLE);
  const hiddenCount = sortedOpen.length - visible.length;
  const archiveCount = awaitingCount + resolvedCount;

  return (
    <section id="trace-markets" style={{ scrollMarginTop: 96 }}>
      <SectionLabel meta={`${open.length} live · ${archiveCount} archived`}>
        📜 Trace Markets — Bet on Reasoning Quality
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
        Meta-bets on agent reasoning. Will this agent&apos;s win-rate clear the
        threshold over the next window? Resolves from the same on-chain bet+resolution
        records that drive the leaderboard.
      </div>
      {open.length === 0 ? (
        <div
          style={{
            padding: "32px 28px",
            border: "1px dashed var(--color-border)",
            borderRadius: 14,
            background: "color-mix(in oklch, var(--color-raised) 60%, transparent)",
            color: "var(--color-bone-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
            lineHeight: 1.7,
            maxWidth: "72ch",
          }}
        >
          No live trace markets right now.
          {archiveCount > 0 ? (
            <>
              {" "}
              <a className="link" href="/markets/history#trace-markets">
                View {archiveCount} in history →
              </a>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 18,
            }}
          >
            {visible.map((m) => (
              <TraceMarketCard key={m.id} m={m} />
            ))}
          </div>
          {(hiddenCount > 0 || archiveCount > 0) && (
            <div
              className="mono"
              style={{
                marginTop: 16,
                display: "flex",
                gap: 18,
                flexWrap: "wrap",
                fontSize: "var(--text-xs)",
                color: "var(--color-bone-dim)",
              }}
            >
              {hiddenCount > 0 ? (
                <span>+ {hiddenCount} more live — newest 6 shown</span>
              ) : null}
              {archiveCount > 0 ? (
                <a className="link" href="/markets/history#trace-markets">
                  View {archiveCount} archived →
                </a>
              ) : null}
            </div>
          )}
        </>
      )}
    </section>
  );
}

const thRow: React.CSSProperties = {
  textAlign: "left",
  color: "var(--color-bone-faint)",
  fontSize: "var(--text-2xs)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};
const th: React.CSSProperties = { padding: "8px 12px 14px", fontWeight: 400, whiteSpace: "nowrap" };
const td: React.CSSProperties = {
  padding: "10px 12px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/* ---------------------------------------------------------------- */
/* ArenaAmbient — per-page combative-arena decoration. Layers over   */
/* ArenaLobbyBackdrop with spectator crabs in the sand strip, a       */
/* radiant sun, warm peach drift-clouds, and a pennant fluttering off */
/* the right gatepost.  z-0 / pointer-events-none — pure ambient.    */
/* ---------------------------------------------------------------- */
function ArenaAmbient() {
  return (
    <div
      aria-hidden
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}
    >
      {/* Warm peach cloud — drifting upper-mid */}
      <svg
        width="170"
        height="46"
        viewBox="0 0 170 46"
        style={{
          position: "absolute",
          top: "12%",
          left: "32%",
          opacity: 0.55,
          animation: "arena-cloud-drift 44s linear infinite",
        }}
      >
        <ellipse cx="50" cy="24" rx="42" ry="11" fill="color-mix(in oklch, var(--color-pastel-peach) 60%, var(--color-bone))" />
        <ellipse cx="90" cy="20" rx="30" ry="8" fill="color-mix(in oklch, var(--color-pastel-peach) 60%, var(--color-bone))" />
      </svg>
      <svg
        width="130"
        height="40"
        viewBox="0 0 130 40"
        style={{
          position: "absolute",
          top: "7%",
          right: "26%",
          opacity: 0.48,
          animation: "arena-cloud-drift 56s linear infinite",
          animationDelay: "-22s",
        }}
      >
        <ellipse cx="44" cy="22" rx="32" ry="8" fill="color-mix(in oklch, var(--color-pastel-sun) 45%, var(--color-bone))" />
        <ellipse cx="74" cy="18" rx="22" ry="6" fill="color-mix(in oklch, var(--color-pastel-sun) 45%, var(--color-bone))" />
      </svg>

      {/* Pennant on the right gatepost — tiny triangle banner on a stick */}
      <svg
        width="50"
        height="80"
        viewBox="0 0 50 80"
        style={{
          position: "absolute",
          top: "16%",
          right: "11%",
          opacity: 0.85,
        }}
      >
        {/* Stick */}
        <line x1="6" y1="2" x2="6" y2="78" stroke="color-mix(in oklch, var(--color-tessera-oxblood) 70%, var(--color-bone))" strokeWidth="2" strokeLinecap="round" />
        {/* Triangle flag — flutters */}
        <g style={{ animation: "arena-pennant-flutter 3.6s ease-in-out infinite", transformOrigin: "6px 8px" }}>
          <path
            d="M 6 4 L 44 16 L 6 26 Z"
            fill="var(--color-tessera-oxblood)"
            stroke="color-mix(in oklch, var(--color-honos-gold) 70%, var(--color-bone))"
            strokeWidth="1"
          />
          {/* Gold stripe inside the pennant */}
          <path d="M 6 12 L 30 18 L 6 22 Z" fill="var(--color-honos-gold)" opacity="0.7" />
        </g>
        <circle cx="6" cy="2" r="2" fill="color-mix(in oklch, var(--color-honos-gold) 80%, var(--color-bone))" />
      </svg>

      {/* Pennant on the LEFT gatepost — mirrors the right one (gold body) */}
      <svg
        width="50"
        height="80"
        viewBox="0 0 50 80"
        style={{
          position: "absolute",
          top: "16%",
          left: "11%",
          opacity: 0.85,
          transform: "scaleX(-1)",
        }}
      >
        <line x1="6" y1="2" x2="6" y2="78" stroke="color-mix(in oklch, var(--color-tessera-oxblood) 70%, var(--color-bone))" strokeWidth="2" strokeLinecap="round" />
        <g style={{ animation: "arena-pennant-flutter 3.6s ease-in-out infinite", animationDelay: "-1.8s", transformOrigin: "6px 8px" }}>
          <path
            d="M 6 4 L 44 16 L 6 26 Z"
            fill="var(--color-honos-gold)"
            stroke="color-mix(in oklch, var(--color-tessera-oxblood) 70%, var(--color-bone))"
            strokeWidth="1"
          />
          <path d="M 6 12 L 30 18 L 6 22 Z" fill="var(--color-tessera-oxblood)" opacity="0.7" />
        </g>
        <circle cx="6" cy="2" r="2" fill="color-mix(in oklch, var(--color-honos-gold) 80%, var(--color-bone))" />
      </svg>

      {/* Scene-aligned overlay — same viewBox as ArenaLobbyBackdrop so we can
          place props that read at the same coordinates as the gateposts/sand.
          Adds: back-row mid-distance pillars, a bunting strung between palms,
          and a leaning chalkboard market sign by the left gatepost. */}
      <svg
        viewBox="0 0 1200 480"
        preserveAspectRatio="xMidYMax meet"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        aria-hidden
      >
        <defs>
          <linearGradient id="stone-back-pillar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--color-bone) 90%, var(--color-pastel-sky))" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--color-bone) 68%, var(--color-tessera-oxblood))" />
          </linearGradient>
        </defs>

        {/* Bunting strung between the two main palms (mirrors Marketplace's
            tent string-lights). Drapes from ~y=210 over the gateposts to
            ~y=180 mid-arc, then back down. */}
        <g opacity="0.78">
          <path d="M 80 250 Q 600 170 1120 250"
            stroke="color-mix(in oklch, var(--color-tessera-oxblood) 55%, var(--color-bone))"
            strokeWidth="1.3" fill="none" strokeDasharray="2 3" />
          {/* Bunting triangles — alternating oxblood / gold / mint */}
          {[
            { t: 0.10, fill: "var(--color-tessera-oxblood)" },
            { t: 0.20, fill: "var(--color-honos-gold)" },
            { t: 0.30, fill: "color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" },
            { t: 0.40, fill: "var(--color-tessera-oxblood)" },
            { t: 0.50, fill: "var(--color-honos-gold)" },
            { t: 0.60, fill: "color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" },
            { t: 0.70, fill: "var(--color-tessera-oxblood)" },
            { t: 0.80, fill: "var(--color-honos-gold)" },
            { t: 0.90, fill: "color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" },
          ].map(({ t, fill }, i) => {
            // Sample the curve at parameter t (quadratic Bezier)
            const x0 = 80, x1 = 600, x2 = 1120;
            const y0 = 250, y1 = 170, y2 = 250;
            const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * x1 + t * t * x2;
            const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * y1 + t * t * y2;
            return (
              <g key={i} style={{ animation: "arena-bunting-sway 5s ease-in-out infinite", animationDelay: `-${i * 0.4}s`, transformOrigin: `${x}px ${y}px` }}>
                <path d={`M ${x - 7} ${y} L ${x + 7} ${y} L ${x} ${y + 14} Z`} fill={fill} opacity="0.85" />
              </g>
            );
          })}
        </g>

        {/* Two back-row smaller pillars — suggests coliseum depth. Sit just
            inside the front gateposts, ~75% scale, lighter color (atmospheric
            perspective). */}
        <g opacity="0.7">
          {/* Back-left pillar */}
          <rect x="260" y="260" width="32" height="118" fill="url(#stone-back-pillar)"
            stroke="color-mix(in oklch, var(--color-tessera-oxblood) 25%, var(--color-bone))" strokeWidth="1" />
          <rect x="252" y="252" width="48" height="10" rx="2"
            fill="color-mix(in oklch, var(--color-bone) 75%, var(--color-tessera-oxblood))" />
          <rect x="252" y="376" width="48" height="10" rx="2"
            fill="color-mix(in oklch, var(--color-bone) 75%, var(--color-tessera-oxblood))" />
          {[0, 1, 2, 3].map((i) => (
            <line key={i} x1="260" y1={282 + i * 22} x2="292" y2={282 + i * 22}
              stroke="color-mix(in oklch, var(--color-tessera-oxblood) 30%, transparent)" strokeWidth="0.6" />
          ))}
          {/* Back-right pillar */}
          <rect x="908" y="260" width="32" height="118" fill="url(#stone-back-pillar)"
            stroke="color-mix(in oklch, var(--color-tessera-oxblood) 25%, var(--color-bone))" strokeWidth="1" />
          <rect x="900" y="252" width="48" height="10" rx="2"
            fill="color-mix(in oklch, var(--color-bone) 75%, var(--color-tessera-oxblood))" />
          <rect x="900" y="376" width="48" height="10" rx="2"
            fill="color-mix(in oklch, var(--color-bone) 75%, var(--color-tessera-oxblood))" />
          {[0, 1, 2, 3].map((i) => (
            <line key={i} x1="908" y1={282 + i * 22} x2="940" y2={282 + i * 22}
              stroke="color-mix(in oklch, var(--color-tessera-oxblood) 30%, transparent)" strokeWidth="0.6" />
          ))}
        </g>

        {/* Chalkboard "MARKETS OPEN" sign leaning against the left gatepost.
            The left gatepost in ArenaLobbyBackdrop sits at x=130..176, y=220..380.
            Lean the sign from sand-line (y=360) up to ~y=320 with a slight tilt. */}
        <g transform="translate(190 318) rotate(-8)" opacity="0.88">
          {/* Wooden frame */}
          <rect x="0" y="0" width="92" height="56" rx="3"
            fill="color-mix(in oklch, #7A4B22 70%, var(--color-bone))"
            stroke="color-mix(in oklch, var(--color-tessera-oxblood) 50%, var(--color-bone))" strokeWidth="1.2" />
          {/* Slate */}
          <rect x="5" y="5" width="82" height="46" rx="2"
            fill="color-mix(in oklch, var(--color-aureus-ink) 85%, var(--color-pastel-mint))" />
          {/* Chalk text */}
          <text x="46" y="22" textAnchor="middle" fontFamily="var(--font-script), cursive" fontSize="11" fontWeight="600"
            fill="color-mix(in oklch, var(--color-bone) 95%, var(--color-pastel-sun))">MARKETS</text>
          <text x="46" y="38" textAnchor="middle" fontFamily="var(--font-script), cursive" fontSize="11" fontWeight="600"
            fill="color-mix(in oklch, var(--color-honos-gold) 85%, var(--color-bone))">OPEN</text>
          {/* Underline flourish */}
          <path d="M 18 46 Q 46 50 76 46" stroke="color-mix(in oklch, var(--color-bone) 85%, var(--color-pastel-sun))" strokeWidth="0.8" fill="none" opacity="0.7" />
          {/* Wooden prop foot */}
          <line x1="46" y1="56" x2="44" y2="68" stroke="color-mix(in oklch, #7A4B22 80%, var(--color-aureus-ink))" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      </svg>

      {/* Spectator crabs in the sand strip — varying sizes/positions.
          Bottom ~10-15% to sit in the sand layer of ArenaLobbyBackdrop. */}
      <ArenaSpectatorCrab left="22%" bottom="14%" scale={1} delay="-0.4s" tint="var(--color-honos-gold)" />
      <ArenaSpectatorCrab left="52%" bottom="9%"  scale={0.7} delay="-1.2s" tint="var(--color-tessera-oxblood)" />
      <ArenaSpectatorCrab left="74%" bottom="13%" scale={0.85} delay="-2.0s" tint="color-mix(in oklch, var(--color-pastel-peach) 70%, var(--color-tessera-oxblood))" />
      {/* Four additional crabs for density — extra-small in back-row, varied tint */}
      <ArenaSpectatorCrab left="34%" bottom="6%"  scale={0.55} delay="-0.8s" tint="color-mix(in oklch, var(--color-outcome-yes) 65%, var(--color-aureus-ink))" />
      <ArenaSpectatorCrab left="44%" bottom="16%" scale={0.6}  delay="-1.6s" tint="color-mix(in oklch, var(--color-pastel-sun) 70%, var(--color-tessera-oxblood))" />
      <ArenaSpectatorCrab left="63%" bottom="15%" scale={0.65} delay="-2.4s" tint="var(--color-honos-gold)" />
      <ArenaSpectatorCrab left="84%" bottom="8%"  scale={0.55} delay="-3.0s" tint="color-mix(in oklch, var(--color-tessera-oxblood) 80%, var(--color-pastel-peach))" />

      <style>{`
        @keyframes arena-cloud-drift {
          0%   { transform: translateX(0); }
          100% { transform: translateX(80px); }
        }
        @keyframes arena-pennant-flutter {
          0%, 100% { transform: skewX(-4deg) scaleX(1); }
          50%      { transform: skewX(8deg)  scaleX(0.96); }
        }
        @keyframes arena-bunting-sway {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50%      { transform: translateY(2px) rotate(3deg); }
        }
        @keyframes arena-crab-cheer {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50%      { transform: translateY(-3px) rotate(3deg); }
        }
      `}</style>
    </div>
  );
}

/* Spectator crab — chibi shape reused from IslandFauna vocab,
   positioned in the sand strip and bobbing as if cheering. */
function ArenaSpectatorCrab({
  left,
  bottom,
  scale,
  delay,
  tint,
}: {
  left: string;
  bottom: string;
  scale: number;
  delay: string;
  tint: string;
}) {
  const size = 36 * scale;
  return (
    <div
      style={{
        position: "absolute",
        left,
        bottom,
        animation: "arena-crab-cheer 1.4s ease-in-out infinite",
        animationDelay: delay,
        transformOrigin: "center bottom",
      }}
    >
      <svg width={size} height={size * 0.7} viewBox="0 0 40 28">
        <circle cx="8" cy="12" r="4" fill={tint} />
        <circle cx="32" cy="12" r="4" fill={tint} />
        <ellipse cx="20" cy="16" rx="9" ry="6" fill={tint} />
        <circle cx="16" cy="11" r="1.6" fill="#1A1814" />
        <circle cx="24" cy="11" r="1.6" fill="#1A1814" />
        <path d="M 12 22 L 8 26 M 16 23 L 14 27 M 24 23 L 26 27 M 28 22 L 32 26"
          stroke={tint} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}
