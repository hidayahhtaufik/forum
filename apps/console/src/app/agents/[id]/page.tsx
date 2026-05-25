import { notFound } from "next/navigation";
import { IslandLayout } from "@/components/IslandLayout";
import { Footer } from "@/components/Footer";
import { SectionLabel } from "@/components/SectionLabel";
import { OutcomeBadge } from "@/components/OutcomeBadge";
import { fetchAgentProfile, fetchForecastTrace, fetchMarkets, knownAgent, type Market } from "@/lib/api";
import {
  formatUsdc,
  relativeTime,
  truncHash,
  arcscanTx,
  arcscanAddress,
  truncAddress,
} from "@/lib/format";
import { ArrowSquareOut, Copy } from "@phosphor-icons/react/dist/ssr";
import { AgentSprite } from "@/components/AgentSprite";
import { MyHatOverlay } from "@/components/MyHatOverlay";
import { spriteForAddress } from "@/lib/agent-sprites";
import { AgentProfileHero } from "@/components/scenes/AgentProfileHero";
import { OwnerEditLink } from "@/components/OwnerEditLink";
import { PremiumInsights } from "@/components/PremiumInsights";

const STRATEGY_LABEL_FALLBACK: Record<string, string> = {
  standard: "Standard Forecaster",
  conservative: "Conservative",
  contrarian: "Contrarian",
  edge_weighted: "Edge-Weighted",
  copy_oracle: "Copy Oracle",
};
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const known = knownAgent(id);
  return {
    title: known ? `${known.label} — agent profile` : `Agent ${id.slice(0, 10)}…`,
    description: known
      ? `${known.label} (${known.strategy}) — lifetime activity on FORUM`
      : `Agent profile and lifetime betting activity on FORUM.`,
  };
}

export default async function AgentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = rawId.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(id)) notFound();

  const [profile, markets] = await Promise.all([fetchAgentProfile(id), fetchMarkets()]);
  if (!profile) notFound();

  const known = knownAgent(id);
  const marketById = new Map<string, Market>(markets.map((m: Market) => [m.id.toLowerCase(), m]));

  return (
    <IslandLayout>
      <AgentProfileHero
        profile={profile}
        label={profile.persona?.personaLabel ?? profile.persona?.name ?? known?.label ?? null}
        strategy={
          profile.persona?.strategyId
            ? STRATEGY_LABEL_FALLBACK[profile.persona.strategyId] ?? profile.persona.strategyId
            : known?.strategy ?? null
        }
        avatarEmoji={profile.persona?.avatarEmoji ?? null}
      />
      <main
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          width: "100%",
          padding: "clamp(32px, 4vw, 56px) clamp(20px, 4vw, 56px) 0",
          display: "flex",
          flexDirection: "column",
          gap: 56,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Breadcrumb id={id} />
          <OwnerEditLink
            agentAddress={id}
            ownerIdentity={profile.persona?.ownerIdentity ?? null}
          />
        </div>
        <OwnerEarningsPanel
          agentAddress={id}
          ownerIdentity={profile.persona?.ownerIdentity ?? null}
        />
        <PremiumInsights
          agentAddress={id}
          ownerIdentity={profile.persona?.ownerIdentity ?? null}
        />
        <ReasoningArchive profile={profile} marketById={marketById} />
        <Settlements profile={profile} marketById={marketById} />
        <Activity profile={profile} marketById={marketById} />
      </main>
      <Footer />
    </IslandLayout>
  );
}

function Breadcrumb({ id }: { id: string }) {
  return (
    <nav
      className="mono"
      style={{
        fontSize: "var(--text-2xs)",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--color-bone-faint)",
      }}
    >
      <a href="/" className="link">forum</a>
      <span style={{ margin: "0 8px" }}>/</span>
      <span style={{ color: "var(--color-bone-dim)" }}>agent · {id.slice(0, 10)}…</span>
    </nav>
  );
}

function Header({
  profile,
  label,
  strategy,
}: {
  profile: Awaited<ReturnType<typeof fetchAgentProfile>>;
  label: string | null;
  strategy: string | null;
}) {
  if (!profile) return null;
  return (
    <header style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        {(() => {
          const spriteName = spriteForAddress(profile.address);
          if (spriteName) {
            return (
              <div
                style={{
                  position: "relative",
                  width: 96,
                  height: 96,
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  display: "grid",
                  placeItems: "center",
                  backgroundColor: "var(--color-raised)",
                }}
              >
                <AgentSprite name={spriteName} size={80} address={profile.address} />
                <MyHatOverlay targetAddress={profile.address} size={80} />
              </div>
            );
          }
          // Unknown agent — fall back to the original mono-letter mark
          return (
            <div
              aria-hidden
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                border: "1px solid var(--color-border)",
                display: "grid",
                placeItems: "center",
                backgroundColor: "var(--color-raised)",
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: "var(--text-base)",
                  fontWeight: 500,
                  color: "var(--color-honos-gold)",
                  letterSpacing: "0.04em",
                }}
              >
                {(label ?? profile.address.slice(2, 4)).slice(0, 3).toUpperCase()}
              </span>
            </div>
          );
        })()}
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: "clamp(20px, 2.8vw, 32px)",
              fontWeight: 600,
              lineHeight: 1.1,
              color: "var(--color-bone)",
              letterSpacing: "-0.01em",
              textTransform: "uppercase",
            }}
          >
            {label ?? truncAddress(profile.address)}
          </h1>
          {strategy && (
            <p
              className="mono"
              style={{
                margin: "4px 0 0",
                fontSize: "var(--text-2xs)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--color-bone-faint)",
              }}
            >
              {strategy}
            </p>
          )}
        </div>
      </div>
      <a
        href={arcscanAddress(profile.address)}
        target="_blank"
        rel="noreferrer"
        className="mono link inline-flex items-center gap-1"
        style={{ fontSize: "var(--text-xs)", width: "fit-content" }}
      >
        {profile.address}
        <ArrowSquareOut size={11} />
      </a>
    </header>
  );
}

function Stats({ profile }: { profile: NonNullable<Awaited<ReturnType<typeof fetchAgentProfile>>> }) {
  const winRate =
    profile.betCount === 0
      ? null
      : (Math.max(profile.yesCount, profile.noCount) / profile.betCount) * 100;
  return (
    <section>
      <SectionLabel>Lifetime</SectionLabel>
      <dl
        className="mono"
        style={{
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 0,
          border: "1px solid var(--color-border)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <StatCell label="Total bets" value={String(profile.betCount)} />
        <StatCell
          label="Direction split"
          value={
            <>
              <span style={{ color: "var(--color-outcome-yes)" }}>{profile.yesCount}</span>
              <span style={{ color: "var(--color-bone-faint)", margin: "0 4px" }}>·</span>
              <span style={{ color: "var(--color-outcome-no)" }}>{profile.noCount}</span>
            </>
          }
        />
        <StatCell label="Volume" value={`${formatUsdc(BigInt(profile.totalVolumeUsdc))} USDC`} />
        <StatCell
          label="Skew"
          value={
            winRate === null
              ? "—"
              : `${winRate.toFixed(0)}% one-sided`
          }
        />
        <StatCell
          label="First bet"
          value={profile.firstBetAt ? new Date(profile.firstBetAt * 1000).toLocaleDateString() : "—"}
        />
        <StatCell
          label="Last bet"
          value={profile.lastBetAt ? relativeTime(profile.lastBetAt) : "—"}
        />
      </dl>
    </section>
  );
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ padding: "14px 16px", borderRight: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)" }}>
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
      <dd style={{ margin: 0, color: "var(--color-bone)", fontSize: "var(--text-sm)" }}>{value}</dd>
    </div>
  );
}

function Settlements({
  profile,
  marketById,
}: {
  profile: NonNullable<Awaited<ReturnType<typeof fetchAgentProfile>>>;
  marketById: Map<string, Market>;
}) {
  const settled = profile.bets
    .map((b) => {
      const m = marketById.get(b.marketId.toLowerCase());
      if (!m || m.phase !== 2) return null;
      const status: "won" | "lost" | "invalid" =
        m.winningOutcome === 2 ? "invalid" : m.winningOutcome === b.outcome ? "won" : "lost";
      return { bet: b, market: m, status };
    })
    .filter((x): x is { bet: typeof profile.bets[number]; market: Market; status: "won" | "lost" | "invalid" } => x !== null);

  if (settled.length === 0) return null;

  const won = settled.filter((s) => s.status === "won").length;
  const lost = settled.filter((s) => s.status === "lost").length;
  const invalid = settled.filter((s) => s.status === "invalid").length;

  return (
    <section>
      <SectionLabel meta={`${won}W · ${lost}L${invalid ? ` · ${invalid} INV` : ""}`}>
        Settlements
      </SectionLabel>
      <div style={{ overflowX: "auto" }}>
        <table
          className="mono"
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)", tableLayout: "fixed" }}
        >
          <colgroup>
            <col />
            <col style={{ width: 78 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr style={thRow}>
              <th style={th}>Market</th>
              <th style={{ ...th, textAlign: "center" }}>Bet</th>
              <th style={{ ...th, textAlign: "center" }}>Result</th>
              <th style={{ ...th, textAlign: "right" }}>Stake</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {settled.map((s) => {
              const color =
                s.status === "won"
                  ? "var(--color-outcome-yes)"
                  : s.status === "lost"
                    ? "var(--color-outcome-no)"
                    : "var(--color-bone-faint)";
              const label = s.status === "won" ? "WON" : s.status === "lost" ? "LOST" : "INVALID";
              return (
                <tr key={s.bet.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={td}>
                    <a className="link" href={`/markets/${s.bet.marketId}`}>
                      {s.market.question.slice(0, 60) + (s.market.question.length > 60 ? "…" : "")}
                    </a>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <OutcomeBadge outcome={s.bet.outcome} />
                  </td>
                  <td style={{ ...td, textAlign: "center", color: "var(--color-bone-dim)" }}>
                    {s.market.winningOutcome === 1 ? "YES" : s.market.winningOutcome === 0 ? "NO" : "INV"}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "var(--color-bone)" }}>
                    {formatUsdc(s.bet.costUsdc)} USDC
                  </td>
                  <td style={{ ...td, color, letterSpacing: "0.08em" }}>● {label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Activity({
  profile,
  marketById,
}: {
  profile: NonNullable<Awaited<ReturnType<typeof fetchAgentProfile>>>;
  marketById: Map<string, Market>;
}) {
  if (profile.bets.length === 0) {
    return (
      <section style={{ marginBottom: 32 }}>
        <SectionLabel>Activity</SectionLabel>
        <p
          className="mono"
          style={{
            color: "var(--color-bone-faint)",
            fontSize: "var(--text-xs)",
            textAlign: "center",
            padding: "32px 0",
            margin: 0,
          }}
        >
          no bets yet.
        </p>
      </section>
    );
  }
  return (
    <section style={{ marginBottom: 32 }}>
      <SectionLabel meta={`${profile.bets.length} bet${profile.bets.length === 1 ? "" : "s"}`}>
        Activity
      </SectionLabel>
      <div style={{ overflowX: "auto" }}>
        <table
          className="mono"
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)", tableLayout: "fixed" }}
        >
          <colgroup>
            <col style={{ width: 84 }} />
            <col />
            <col style={{ width: 78 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 130 }} />
          </colgroup>
          <thead>
            <tr style={thRow}>
              <th style={th}>When</th>
              <th style={th}>Market</th>
              <th style={{ ...th, textAlign: "center" }}>Side</th>
              <th style={{ ...th, textAlign: "right" }}>Cost</th>
              <th style={{ ...th, textAlign: "right" }}>Fee</th>
              <th style={th}>Tx</th>
            </tr>
          </thead>
          <tbody>
            {profile.bets.map((b) => {
              const market = marketById.get(b.marketId.toLowerCase());
              return (
                <tr key={b.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={{ ...td, color: "var(--color-bone-faint)" }}>{relativeTime(b.createdAt)}</td>
                  <td style={td}>
                    <a className="link" href={`/markets/${b.marketId}`}>
                      {market ? market.question.slice(0, 50) + (market.question.length > 50 ? "…" : "") : `${b.marketId.slice(0, 10)}…`}
                    </a>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <OutcomeBadge outcome={b.outcome} />
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "var(--color-bone)" }}>
                    {formatUsdc(b.costUsdc)}
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "var(--color-bone-dim)" }}>
                    {formatUsdc(b.feeUsdc)}
                  </td>
                  <td style={td}>
                    <a
                      className="link inline-flex items-center gap-1"
                      href={arcscanTx(b.marketTxHash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {truncHash(b.marketTxHash)}
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

/// ReasoningArchive — last N forecast traces this agent published. The
/// M1 user-facing payoff for the profile page: visitors see not just
/// "this agent placed bets" but "here's WHY, in their own words."
///
/// Fetches each trace from market-api on the server so we can render the
/// rationale snippet inline. Hard-capped at 10 to keep render cheap.
async function ReasoningArchive({
  profile,
  marketById,
}: {
  profile: NonNullable<Awaited<ReturnType<typeof fetchAgentProfile>>>;
  marketById: Map<string, Market>;
}) {
  const withTrace = profile.bets.filter((b) => !!b.forecastSha256).slice(0, 10);
  if (withTrace.length === 0) return null;

  const traces = await Promise.all(
    withTrace.map(async (b) => {
      const t = await fetchForecastTrace(b.forecastSha256!).catch(() => null);
      return t ? { bet: b, trace: t } : null;
    }),
  );
  const resolved = traces.filter((x): x is NonNullable<typeof x> => x !== null);
  if (resolved.length === 0) return null;

  return (
    <section>
      <SectionLabel meta={`${resolved.length} pinned`}>Reasoning archive · trace pinning</SectionLabel>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {resolved.map(({ bet, trace }) => {
          const market = marketById.get(bet.marketId.toLowerCase());
          const outcomeColor = trace.outcome === 1 ? "var(--color-outcome-yes)" : "var(--color-outcome-no)";
          return (
            <a
              key={bet.id}
              href={`/traces/${trace.sha256}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "14px 16px",
                borderRadius: 10,
                background: "color-mix(in oklch, var(--color-raised) 70%, transparent)",
                border: "1px solid var(--color-border)",
                textDecoration: "none",
                color: "var(--color-bone)",
                transition: "border-color 180ms ease, transform 180ms ease",
              }}
              className="trace-card"
            >
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: outcomeColor,
                    fontWeight: 700,
                  }}
                >
                  ● {trace.outcome === 1 ? "YES" : "NO"} {trace.confidence ? `· ${Math.round(Number(trace.confidence) * 100)}% conf` : ""}
                </span>
                <span className="mono" style={{ fontSize: 9, color: "var(--color-bone-faint)" }}>
                  {relativeTime(trace.createdAt)}
                </span>
              </header>
              <p
                style={{
                  margin: 0,
                  fontSize: "var(--text-xs)",
                  lineHeight: 1.55,
                  color: "var(--color-bone-dim)",
                  display: "-webkit-box",
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {trace.rationale}
              </p>
              <footer
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 10,
                  color: "var(--color-bone-faint)",
                }}
                className="mono"
              >
                <span style={{ color: "var(--color-honos-gold)" }}>{trace.model ?? "heuristic"}</span>
                <span>{market?.question.slice(0, 26) ?? "—"}{(market?.question.length ?? 0) > 26 ? "…" : ""}</span>
              </footer>
            </a>
          );
        })}
      </div>
      <style>{`
        .trace-card:hover { border-color: var(--color-honos-gold); transform: translateY(-2px); }
      `}</style>
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
