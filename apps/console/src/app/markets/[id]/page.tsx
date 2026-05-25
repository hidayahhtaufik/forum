import { notFound } from "next/navigation";
import { IslandLayout } from "@/components/IslandLayout";
import { Footer } from "@/components/Footer";
import { SectionLabel } from "@/components/SectionLabel";
import { MarketSection } from "@/components/MarketSection";
import { OutcomeBadge } from "@/components/OutcomeBadge";
import { AddressChip } from "@/components/AddressChip";
import { fetchMarkets, fetchRecentBets, fetchResolution, knownAgent, type Resolution } from "@/lib/api";
import { ShareMarketButton } from "@/components/ShareMarketButton";
import { BetForm } from "@/components/BetForm";
import { LiveBetHistory } from "@/components/LiveBetHistory";
import { SourceBadgeFull } from "@/components/SourceBadge";
import { CollateralBadge } from "@/components/CollateralBadge";
import { Arena } from "@/components/scenes/Arena";
import {
  formatUsdc,
  formatStrikeWad,
  relativeTime,
  truncHash,
  arcscanTx,
  arcscanAddress,
} from "@/lib/format";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Market ${id.slice(0, 10)}…`,
    description: `Live FORUM prediction market on Arc Testnet. Bet history, current odds, agent participation.`,
  };
}

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = rawId.toLowerCase();

  const [markets, allBets, resolution] = await Promise.all([
    fetchMarkets(),
    fetchRecentBets(200),
    fetchResolution(id),
  ]);
  const market = markets.find((m) => m.id.toLowerCase() === id);
  if (!market) notFound();

  const bets = allBets.filter((b) => b.marketId.toLowerCase() === id);
  const totalVolume = bets.reduce((acc, b) => acc + BigInt(b.costUsdc) + BigInt(b.feeUsdc), 0n);
  const yesCount = bets.filter((b) => b.outcome === 1).length;
  const noCount = bets.length - yesCount;

  // Per-agent share of this market's volume.
  const byAgent = new Map<string, { addr: string; vol: bigint; bets: number; lastTs: number }>();
  for (const b of bets) {
    const addr = b.agentAddress.toLowerCase();
    const v = BigInt(b.costUsdc) + BigInt(b.feeUsdc);
    const entry = byAgent.get(addr) ?? { addr, vol: 0n, bets: 0, lastTs: 0 };
    entry.vol += v;
    entry.bets += 1;
    entry.lastTs = Math.max(entry.lastTs, b.createdAt);
    byAgent.set(addr, entry);
  }
  const participants = Array.from(byAgent.values()).sort((a, b) => (b.vol > a.vol ? 1 : -1));

  return (
    <>
      <IslandLayout>
        <Arena
          market={market}
          bets={bets}
          winningOutcome={resolution?.outcome ?? null}
          resolution={resolution ?? null}
        />
      </IslandLayout>

      {/* Bet form + supporting sections — scroll below the Arena scene */}
      <main
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          width: "100%",
          padding: "clamp(32px, 5vw, 56px) clamp(20px, 4vw, 56px) 0",
          display: "flex",
          flexDirection: "column",
          gap: 48,
        }}
      >
        <Breadcrumb id={id} />
        <Header market={market} />
        {resolution && <ResolutionBanner resolution={resolution} />}
        <BetForm marketId={market.id} marketPhase={market.phase} closesAt={market.closesAt} />
        <MarketSection market={market} bets={allBets} />
        <Participants participants={participants} totalVolume={totalVolume} />
        <LiveBetHistory
          marketId={market.id}
          initial={bets}
          initialYesCount={yesCount}
          initialNoCount={noCount}
        />
      </main>
      <Footer />
    </>
  );
}

function ResolutionBanner({ resolution }: { resolution: Resolution }) {
  const outcomeLabel = resolution.outcome === 1 ? "YES" : resolution.outcome === 0 ? "NO" : "INVALID";
  const outcomeColor =
    resolution.outcome === 1
      ? "var(--color-outcome-yes)"
      : resolution.outcome === 0
        ? "var(--color-outcome-no)"
        : "var(--color-bone-faint)";
  return (
    <section
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 4,
        padding: "20px 24px",
        backgroundColor: "color-mix(in oklch, var(--color-honos-gold) 6%, var(--color-raised))",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--color-honos-gold)",
        }}
      >
        ● Resolved · {new Date(resolution.resolvedAt * 1000).toLocaleString()}
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 24, flexWrap: "wrap" }}>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: "clamp(22px, 3vw, 32px)",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: outcomeColor,
          }}
        >
          {outcomeLabel} won
        </h2>
        <span
          className="mono"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-bone-dim)",
            letterSpacing: "0.04em",
          }}
        >
          settled against {resolution.source} · signed by {resolution.signer.slice(0, 8)}…
        </span>
      </div>
      <a
        href={arcscanTx(resolution.txHash)}
        target="_blank"
        rel="noreferrer"
        className="mono link inline-flex items-center gap-1"
        style={{ fontSize: "var(--text-xs)", width: "fit-content" }}
      >
        {truncHash(resolution.txHash)}
        <ArrowSquareOut size={11} />
      </a>
    </section>
  );
}

function Breadcrumb({ id }: { id: string }) {
  return (
    <nav
      className="mono"
      style={{ fontSize: "var(--text-2xs)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-bone-faint)" }}
    >
      <a href="/markets" className="link">markets</a>
      <span style={{ margin: "0 8px" }}>/</span>
      <span style={{ color: "var(--color-bone-dim)" }}>{id.slice(0, 10)}…</span>
    </nav>
  );
}

function Header({ market }: { market: Awaited<ReturnType<typeof fetchMarkets>>[number] }) {
  // Time-aware phase label — the DB phase only flips 0→1 when the resolver
  // catches up, which on Arc Testnet can lag minutes. Without this guard the
  // header reads "OPEN" while the bet form already shows "market closed",
  // confusing users. Treat closesAt-in-past as CLOSED regardless of DB phase.
  const nowSec = Math.floor(Date.now() / 1000);
  const effectivePhase =
    market.phase === 0 && market.closesAt <= nowSec ? 1 : market.phase;
  const phaseLabel = ["OPEN", "CLOSED", "RESOLVED"][effectivePhase] ?? "UNKNOWN";
  const phaseColor =
    effectivePhase === 0
      ? "var(--color-outcome-yes)"
      : effectivePhase === 2
        ? "var(--color-honos-gold)"
        : "var(--color-bone-dim)";
  // Current YES probability from LMSR shares, for the share blurb.
  const qYes = BigInt(market.qYesWad);
  const qNo = BigInt(market.qNoWad);
  const total = qYes + qNo;
  const yesPct = total === 0n ? 50 : Number((qYes * 10_000n) / total) / 100;
  return (
    <header style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            className="mono"
            style={{
              fontSize: "var(--text-2xs)",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: phaseColor,
            }}
          >
            ● {phaseLabel}
          </span>
          <span
            className="mono"
            style={{
              fontSize: "var(--text-2xs)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-bone-faint)",
            }}
          >
            {market.pair} · {market.comparator} {formatStrikeWad(market.strikeWad)}
          </span>
        </div>
        <ShareMarketButton marketId={market.id} question={market.question} yesPct={yesPct} />
      </div>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: "clamp(24px, 3.5vw, 36px)",
          fontWeight: 600,
          lineHeight: 1.2,
          letterSpacing: "-0.015em",
          color: "var(--color-bone)",
          maxWidth: "32ch",
        }}
      >
        {market.question}
      </h1>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <SourceBadgeFull createdBy={market.createdBy ?? "manual"} />
        <CollateralBadge collateral={market.collateral} />
      </div>
      <dl
        className="mono"
        style={{
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 18,
          fontSize: "var(--text-xs)",
          color: "var(--color-bone-dim)",
        }}
      >
        <Stat label="Market id" value={`${market.id.slice(0, 10)}…`} title={market.id} />
        <Stat
          label="Contract"
          value={
            <a className="link" href={arcscanAddress(market.address)} target="_blank" rel="noreferrer">
              {market.address.slice(0, 8)}…
            </a>
          }
        />
        <Stat label="Opens" value={new Date(market.opensAt * 1000).toLocaleString()} />
        <Stat label="Closes" value={new Date(market.closesAt * 1000).toLocaleString()} />
        <Stat label="Created in block" value={String(market.createdAtBlock)} />
      </dl>
    </header>
  );
}

function Stat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div>
      <dt
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-bone-faint)",
          marginBottom: 4,
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0, color: "var(--color-bone)" }} title={title}>
        {value}
      </dd>
    </div>
  );
}

function Participants({
  participants,
  totalVolume,
}: {
  participants: { addr: string; vol: bigint; bets: number; lastTs: number }[];
  totalVolume: bigint;
}) {
  if (participants.length === 0) return null;
  return (
    <section>
      <SectionLabel meta={`${participants.length} agent${participants.length === 1 ? "" : "s"}`}>
        Participants
      </SectionLabel>
      <div style={{ overflowX: "auto" }}>
        <table
          className="mono"
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)", tableLayout: "fixed" }}
        >
          <colgroup>
            <col style={{ width: "1.5fr" }} />
            <col />
            <col style={{ width: 140 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr style={thRow}>
              <th style={th}>Agent</th>
              <th style={th}>Strategy</th>
              <th style={{ ...th, textAlign: "right" }}>Volume</th>
              <th style={{ ...th, textAlign: "right" }}>Bets</th>
              <th style={{ ...th, textAlign: "right" }}>Share</th>
              <th style={th}>Last bet</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => {
              const known = knownAgent(p.addr);
              const sharePct = totalVolume === 0n ? 0 : Number((p.vol * 10_000n) / totalVolume) / 100;
              return (
                <tr key={p.addr} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={td}>
                    <a className="link" href={`/agents/${p.addr}`}>
                      {known?.label ?? `${p.addr.slice(0, 8)}…`}
                    </a>
                  </td>
                  <td style={{ ...td, color: "var(--color-bone-dim)" }}>{known?.strategy ?? "—"}</td>
                  <td style={{ ...td, textAlign: "right", color: "var(--color-bone)" }}>
                    {formatUsdc(p.vol)} USDC
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "var(--color-bone-dim)" }}>{p.bets}</td>
                  <td style={{ ...td, textAlign: "right", color: "var(--color-bone-dim)" }}>{sharePct.toFixed(1)}%</td>
                  <td style={{ ...td, color: "var(--color-bone-dim)" }}>{relativeTime(p.lastTs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
