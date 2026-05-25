"use client";

/// PremiumInsights — Circle Nanopayments showcase widget for /agents/[id].
/// Three states:
///   1. LOCKED   — teaser + "Unlock for 0.001 USDC" button (x402 gated)
///   2. UNLOCKING — animated 3-step progress (402 → sign → settle)
///   3. UNLOCKED — premium grid + settlement tx link
///
/// On the second click for the same agent within a session, the in-memory
/// cache short-circuits the network call so the buyer isn't double-charged.

import { useEffect, useRef, useState } from "react";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { useTrader } from "@/lib/useTrader";
import { unlockInsights, type PremiumInsights as PremiumInsightsPayload } from "@/lib/trader";
import { signerFromDynamic } from "@/lib/auth";
import { arcscanTx, formatUsdc, truncHash, relativeTime } from "@/lib/format";
import { ArrowSquareOut, Lock, Sparkle, CheckCircle } from "@phosphor-icons/react";
import { CircleIcon, X402Icon } from "./BrandIcons";

type Props = {
  agentAddress: string;
  ownerIdentity: string | null;
};

type Stage = "negotiate" | "sign" | "settle";

const STAGE_LABEL: Record<Stage, string> = {
  negotiate: "Negotiating 402",
  sign: "Signing EIP-712",
  settle: "Settling on Arc",
};

export function PremiumInsights({ agentAddress, ownerIdentity }: Props) {
  const { trader } = useTrader();
  const { primaryWallet } = useDynamicContext();
  const [unlocked, setUnlocked] = useState<{
    insights: PremiumInsightsPayload;
    settlementTxHash: string | null;
    arcscanUrl: string | null;
    ownerFreePass: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("negotiate");
  const cacheRef = useRef<Map<string, NonNullable<typeof unlocked>>>(new Map());

  const isOwner =
    !!ownerIdentity && !!trader?.address && trader.address.toLowerCase() === ownerIdentity.toLowerCase();

  // Reset cache + state when agent changes (e.g. SPA nav).
  useEffect(() => {
    setUnlocked(null);
    setError(null);
  }, [agentAddress]);

  const onUnlock = async () => {
    if (!trader?.address) {
      setError("Sign in first — Premium Insights needs your FORUM trader wallet to sign the EIP-712 payment.");
      return;
    }
    // In-memory cache hit: re-render without re-paying.
    const cached = cacheRef.current.get(agentAddress.toLowerCase());
    if (cached) {
      setUnlocked(cached);
      return;
    }
    setError(null);
    setBusy(true);
    setStage("negotiate");
    // Walk through the visible 402 → sign → settle micro-animation in parallel
    // with the real network call. Even if the call resolves fast, the user
    // sees the three steps light up so the Circle integration story lands.
    const stageTimer1 = setTimeout(() => setStage("sign"), 280);
    const stageTimer2 = setTimeout(() => setStage("settle"), 560);
    try {
      // Auth gate — server bills 0.001 USDC from the trader wallet and
      // requires the EIP-712 sig before decrypting the trader privkey.
      if (!primaryWallet || !isEthereumWallet(primaryWallet)) {
        throw new Error("Connect an Ethereum wallet to authorize this unlock");
      }
      const signer = await signerFromDynamic(primaryWallet);
      const result = await unlockInsights({
        traderAddress: trader.address,
        targetAgent: agentAddress,
        signer,
      });
      const payload = {
        insights: result.insights,
        settlementTxHash: result.settlementTxHash,
        arcscanUrl: result.arcscanUrl,
        ownerFreePass: result.ownerFreePass,
      };
      cacheRef.current.set(agentAddress.toLowerCase(), payload);
      setUnlocked(payload);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      setBusy(false);
    }
  };

  // Owner free-pass — auto-fetch on mount so owners always see their stats.
  useEffect(() => {
    if (!isOwner || !trader?.address || unlocked || busy) return;
    void onUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, trader?.address]);

  if (unlocked) {
    return (
      <UnlockedView
        insights={unlocked.insights}
        settlementTxHash={unlocked.settlementTxHash}
        arcscanUrl={unlocked.arcscanUrl}
        ownerFreePass={unlocked.ownerFreePass}
      />
    );
  }

  if (busy) {
    return (
      <section style={shellLocked}>
        <Header />
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", padding: "20px 0" }}>
          <Spinner />
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center" }}>
            {(["negotiate", "sign", "settle"] as Stage[]).map((s, i) => {
              const active = stage === s;
              const done =
                (s === "negotiate" && (stage === "sign" || stage === "settle")) ||
                (s === "sign" && stage === "settle");
              return (
                <div key={s} style={stepRow}>
                  <span
                    style={{
                      ...stepDot,
                      backgroundColor: done
                        ? "var(--color-outcome-yes)"
                        : active
                          ? "var(--color-honos-gold)"
                          : "var(--color-border)",
                    }}
                  />
                  <span
                    className="mono"
                    style={{
                      fontSize: "var(--text-2xs)",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: done || active ? "var(--color-bone)" : "var(--color-bone-faint)",
                    }}
                  >
                    {i + 1}. {STAGE_LABEL[s]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section style={shellLocked}>
      <Header />
      <div style={teaserRow}>
        {["Win rate · 24h/7d/lifetime", "P&L breakdown", "Signal correlation", "Latest forecasts", "Win/loss streak"].map(
          (l) => (
            <span key={l} className="mono" style={teaserChip}>
              <Lock size={10} weight="fill" /> {l}
            </span>
          ),
        )}
      </div>
      <button type="button" onClick={onUnlock} disabled={busy} style={unlockButton}>
        <Sparkle size={14} weight="fill" />
        Unlock for 0.001 USDC
      </button>
      {error && (
        <p className="mono" style={errorStyle}>
          ✗ {error}
        </p>
      )}
      <Footer />
    </section>
  );
}

function Header() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          className="mono"
          style={{
            fontSize: "var(--text-2xs)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--color-bone-faint)",
          }}
        >
          Premium Insights
        </span>
        <span style={poweredPill}>
          <CircleIcon size={11} /> powered by Circle Nanopayments
        </span>
      </div>
      <span
        className="mono"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--color-honos-gold)",
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.08em",
        }}
      >
        <X402Icon size={13} /> x402 · EIP-3009
      </span>
    </div>
  );
}

function Footer() {
  return (
    <p
      className="mono"
      style={{
        margin: 0,
        fontSize: "var(--text-2xs)",
        color: "var(--color-bone-faint)",
        lineHeight: 1.5,
      }}
    >
      Pay-per-view via x402 · settles on Arc in &lt;1s · gasless USDC EIP-3009 (the
      same primitive Circle Nanopayments runs on)
    </p>
  );
}

function UnlockedView({
  insights,
  settlementTxHash,
  arcscanUrl,
  ownerFreePass,
}: {
  insights: PremiumInsightsPayload;
  settlementTxHash: string | null;
  arcscanUrl: string | null;
  ownerFreePass: boolean;
}) {
  const pnl = BigInt(insights.pnlUsdc);
  const pnlColor =
    pnl > 0n ? "var(--color-outcome-yes)" : pnl < 0n ? "var(--color-outcome-no)" : "var(--color-bone)";
  const pnlPrefix = pnl > 0n ? "+" : "";
  const streakColor =
    insights.streak > 0
      ? "var(--color-outcome-yes)"
      : insights.streak < 0
        ? "var(--color-outcome-no)"
        : "var(--color-bone-faint)";
  const streakLabel =
    insights.streak === 0
      ? "—"
      : insights.streak > 0
        ? `${insights.streak}W`
        : `${Math.abs(insights.streak)}L`;
  return (
    <section style={shellUnlocked}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            className="mono"
            style={{
              fontSize: "var(--text-2xs)",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--color-honos-gold)",
            }}
          >
            <CheckCircle size={11} weight="fill" style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Premium Insights · Unlocked
          </span>
          <span style={poweredPill}>
            <CircleIcon size={11} /> Circle Nanopayments
          </span>
        </div>
        {ownerFreePass && (
          <span className="mono" style={ownerBadge}>
            ★ Free for owner
          </span>
        )}
      </div>
      <div style={statGrid}>
        <StatCard
          label="Win rate · all-time"
          value={
            insights.winRateAllTime !== null
              ? `${(insights.winRateAllTime * 100).toFixed(1)}%`
              : "—"
          }
          sub={`${insights.honos.wins}W · ${insights.honos.losses}L`}
        />
        <StatCard
          label="Win rate · 7d"
          value={insights.winRate7d !== null ? `${(insights.winRate7d * 100).toFixed(1)}%` : "—"}
          sub="last week"
        />
        <StatCard
          label="Win rate · 24h"
          value={insights.winRate24h !== null ? `${(insights.winRate24h * 100).toFixed(1)}%` : "—"}
          sub="last day"
        />
        <StatCard
          label="P&L · realized"
          value={`${pnlPrefix}${formatUsdc(pnl < 0n ? -pnl : pnl)} USDC`}
          valueColor={pnlColor}
        />
        <StatCard
          label="Signal correlation"
          value={
            insights.signalCorrelation !== null
              ? `${(insights.signalCorrelation * 100).toFixed(1)}%`
              : "—"
          }
          sub="picks matching winning outcome"
        />
        <StatCard
          label="Current streak"
          value={streakLabel}
          valueColor={streakColor}
        />
      </div>

      {insights.pnlByMarket.length > 0 && (
        <div style={subSection}>
          <span className="mono" style={subSectionLabel}>P&L breakdown · top markets</span>
          <ul style={pnlList}>
            {insights.pnlByMarket.map((row) => {
              const v = BigInt(row.pnlUsdc);
              const col = v > 0n ? "var(--color-outcome-yes)" : v < 0n ? "var(--color-outcome-no)" : "var(--color-bone)";
              const pfx = v > 0n ? "+" : "";
              return (
                <li key={row.marketId} style={pnlRow}>
                  <a className="link mono" href={`/markets/${row.marketId}`} style={{ fontSize: "var(--text-xs)" }}>
                    {row.marketId.slice(0, 12)}…
                  </a>
                  <span className="mono" style={{ color: col, fontSize: "var(--text-xs)" }}>
                    {pfx}
                    {formatUsdc(v < 0n ? -v : v)} USDC
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {insights.latestForecasts.length > 0 && (
        <div style={subSection}>
          <span className="mono" style={subSectionLabel}>Latest forecasts</span>
          <div style={{ display: "grid", gap: 8 }}>
            {insights.latestForecasts.map((f) => {
              const outcomeColor = f.outcome === 1 ? "var(--color-outcome-yes)" : "var(--color-outcome-no)";
              return (
                <a
                  key={f.sha256}
                  href={`/traces/${f.sha256}`}
                  style={traceCard}
                >
                  <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: outcomeColor,
                        fontWeight: 700,
                      }}
                    >
                      ● {f.outcome === 1 ? "YES" : "NO"}
                      {f.confidence ? ` · ${Math.round(Number(f.confidence) * 100)}% conf` : ""}
                    </span>
                    <span className="mono" style={{ fontSize: 9, color: "var(--color-bone-faint)" }}>
                      {relativeTime(f.createdAt)}
                    </span>
                  </header>
                  <p style={traceSnippet}>{f.rationaleSnippet}</p>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {settlementTxHash && (
        <div style={settlementFooter}>
          <span className="mono" style={{ fontSize: "var(--text-2xs)", color: "var(--color-bone-faint)" }}>
            Settled 0.001 USDC · tx
          </span>
          <a
            className="mono link inline-flex items-center gap-1"
            href={arcscanUrl ?? arcscanTx(settlementTxHash)}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: "var(--text-2xs)" }}
          >
            {truncHash(settlementTxHash)}
            <ArrowSquareOut size={10} />
          </a>
        </div>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div style={statCard}>
      <span
        className="mono"
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--color-bone-faint)",
        }}
      >
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: "var(--text-lg)",
          fontWeight: 500,
          color: valueColor ?? "var(--color-bone)",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </span>
      {sub && (
        <span
          className="mono"
          style={{
            fontSize: "var(--text-2xs)",
            color: "var(--color-bone-faint)",
          }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div
      style={{
        width: 22,
        height: 22,
        border: "2px solid color-mix(in oklch, var(--color-honos-gold) 30%, transparent)",
        borderTopColor: "var(--color-honos-gold)",
        borderRadius: "50%",
        animation: "spin 700ms linear infinite",
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Styles — match the rest of /agents/[id]: 1px border, raised
// background, mono labels. Locked state gets a subtle gold
// gradient so the Circle integration visually pops on the page.
// ────────────────────────────────────────────────────────────

const shellLocked: React.CSSProperties = {
  border: "1px solid color-mix(in oklch, var(--color-honos-gold) 32%, var(--color-border))",
  borderRadius: 8,
  padding: "20px 24px",
  background:
    "linear-gradient(180deg, color-mix(in oklch, var(--color-honos-gold) 8%, var(--color-raised)) 0%, var(--color-raised) 100%)",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const shellUnlocked: React.CSSProperties = {
  border: "1px solid color-mix(in oklch, var(--color-honos-gold) 28%, var(--color-border))",
  borderRadius: 8,
  padding: "20px 24px",
  background: "var(--color-raised)",
  display: "flex",
  flexDirection: "column",
  gap: 18,
};

const poweredPill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 10px",
  borderRadius: 999,
  background: "color-mix(in oklch, var(--color-honos-gold) 14%, transparent)",
  color: "var(--color-honos-gold)",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.08em",
  border: "1px solid color-mix(in oklch, var(--color-honos-gold) 30%, transparent)",
};

const teaserRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const teaserChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 10px",
  borderRadius: 999,
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  fontSize: 11,
  color: "var(--color-bone-dim)",
  letterSpacing: "0.04em",
};

const unlockButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "12px 18px",
  borderRadius: 4,
  background: "var(--color-honos-gold)",
  color: "var(--color-on-gold)",
  border: "1px solid var(--color-honos-gold)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  cursor: "pointer",
  letterSpacing: "0.04em",
  width: "fit-content",
  transition: "filter 120ms ease",
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-xs)",
  color: "var(--color-tessera-oxblood)",
  lineHeight: 1.5,
};

const statGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 10,
};

const statCard: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "12px 14px",
  borderRadius: 4,
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
};

const subSection: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const subSectionLabel: React.CSSProperties = {
  fontSize: "var(--text-2xs)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-bone-faint)",
};

const pnlList: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const pnlRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "6px 10px",
  borderRadius: 3,
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
};

const traceCard: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "10px 12px",
  borderRadius: 6,
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  textDecoration: "none",
  color: "var(--color-bone)",
};

const traceSnippet: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-xs)",
  lineHeight: 1.55,
  color: "var(--color-bone-dim)",
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const settlementFooter: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  paddingTop: 8,
  borderTop: "1px solid var(--color-border)",
};

const stepRow: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const stepDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  transition: "background-color 180ms ease",
};

const ownerBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 10px",
  borderRadius: 999,
  background: "color-mix(in oklch, var(--color-honos-gold) 18%, transparent)",
  color: "var(--color-honos-gold)",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.08em",
  border: "1px solid color-mix(in oklch, var(--color-honos-gold) 40%, transparent)",
};
