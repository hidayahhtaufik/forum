"use client";

import { useDynamicContext, DynamicWidget } from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import { signerFromDynamic } from "@/lib/auth";
import { useEffect, useState } from "react";
import { SectionLabel } from "@/components/SectionLabel";
import { OutcomeBadge } from "@/components/OutcomeBadge";
import { TraderPanel } from "@/components/TraderPanel";
import { MyAgentsGrid } from "@/components/MyAgentsGrid";
import { MyRentalsPanel } from "@/components/MyRentalsPanel";
import { CrabProfileHero } from "@/components/scenes/CrabProfileHero";
import { useTrader } from "@/lib/useTrader";
import { claimMarket, type ClaimResult } from "@/lib/trader";
import {
  formatUsdc,
  relativeTime,
  truncHash,
  arcscanTx,
} from "@/lib/format";
import type { AgentProfile, Bet, Market } from "@/lib/api";
import { ArrowSquareOut } from "@phosphor-icons/react";

const API = process.env.NEXT_PUBLIC_MARKET_API_URL ?? "http://127.0.0.1:8403";

export function ConsoleView() {
  const { user, primaryWallet } = useDynamicContext();
  const { trader } = useTrader();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Activity now keys off the FORUM trader wallet (where all human bets land).
  const addr = trader?.address?.toLowerCase() ?? null;

  useEffect(() => {
    if (!addr) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${API}/agents/${addr}`, { cache: "no-store" }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<AgentProfile>;
      }),
      fetch(`${API}/markets`, { cache: "no-store" }).then(async (res) => {
        if (!res.ok) return { markets: [] as Market[] };
        return (await res.json()) as { markets: Market[] };
      }),
    ])
      .then(([p, mk]) => {
        if (cancelled) return;
        setProfile(p);
        setMarkets(mk.markets ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addr]);

  const claimable = profile ? buildClaimables(profile, markets) : [];

  if (!user && !primaryWallet) {
    return <SignInPrompt />;
  }

  return (
    <>
      {/* Crab profile hero — customize hat + mood, see stats at a glance */}
      <CrabProfileHero profile={profile} />

    <main
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        width: "100%",
        padding: "clamp(32px, 5vw, 56px) clamp(20px, 4vw, 56px) 0",
        display: "flex",
        flexDirection: "column",
        gap: 56,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span
          className="mono"
          style={{
            fontSize: "var(--text-2xs)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--color-bone-faint)",
          }}
        >
          Console · signed in
        </span>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: "clamp(22px, 3vw, 32px)",
            fontWeight: 600,
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            color: "var(--color-bone)",
          }}
        >
          Your agents live here.
        </h1>
        <p style={{ margin: 0, color: "var(--color-bone-dim)", fontSize: "var(--text-sm)", maxWidth: "58ch" }}>
          v0.1 surfaces your wallet identity and the activity of any FORUM agent that bets from this address.
          Agent spawn UI, budget controls, and live-log streaming land in v0.2.
        </p>
        <div style={{ marginTop: 8 }}>
          <DynamicWidget />
        </div>
      </header>

      <section>
        <SectionLabel meta={loading ? "loading…" : undefined}>FORUM wallet</SectionLabel>
        <TraderPanel />
      </section>

      <MyAgentsGrid />

      <MyRentalsPanel />

      {profile && (
        <section>
          <SectionLabel>Lifetime stats</SectionLabel>
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: 4,
              padding: "16px 20px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 18,
            }}
          >
            <Cell label="Bets settled" value={String(profile.betCount)} />
            <Cell label="YES / NO" value={`${profile.yesCount} / ${profile.noCount}`} />
            <Cell label="Volume" value={`${formatUsdc(BigInt(profile.totalVolumeUsdc))} USDC`} />
            <Cell label="Chain" value="Arc Testnet · 5042002" />
          </div>
        </section>
      )}

      {addr && claimable.length > 0 && <Claimables claimable={claimable} addr={addr} primaryWallet={primaryWallet} />}

      {addr && (
        <section style={{ marginBottom: 32 }}>
          <SectionLabel>Activity from your FORUM wallet</SectionLabel>
          {error ? (
            <p
              className="mono"
              style={{
                color: "var(--color-tessera-oxblood)",
                fontSize: "var(--text-xs)",
                padding: "24px 0",
                margin: 0,
                textAlign: "center",
              }}
            >
              failed to load activity: {error}
            </p>
          ) : !profile || profile.bets.length === 0 ? (
            <EmptyActivity />
          ) : (
            <BetTable bets={profile.bets} />
          )}
        </section>
      )}
    </main>
    </>
  );
}

type ClaimableRow = {
  marketId: string;
  marketAddress: string;
  outcome: 0 | 1;
  question: string;
  stakeUsdc: bigint;
};

function buildClaimables(profile: AgentProfile, markets: Market[]): ClaimableRow[] {
  const byMarket = new Map<string, Market>(markets.map((m) => [m.id.toLowerCase(), m]));
  const rows = new Map<string, ClaimableRow>();
  for (const b of profile.bets) {
    const m = byMarket.get(b.marketId.toLowerCase());
    if (!m || m.phase !== 2) continue;
    if (m.winningOutcome !== b.outcome) continue;
    const key = `${m.id}-${b.outcome}`;
    const stake = BigInt(b.costUsdc);
    const existing = rows.get(key);
    if (existing) {
      existing.stakeUsdc += stake;
    } else {
      rows.set(key, {
        marketId: m.id,
        marketAddress: m.address,
        outcome: b.outcome,
        question: m.question,
        stakeUsdc: stake,
      });
    }
  }
  return Array.from(rows.values());
}

function Claimables({ claimable, addr, primaryWallet }: { claimable: ClaimableRow[]; addr: string; primaryWallet: unknown }) {
  // Filter out rows that are already known-claimed (from localStorage cache).
  // This keeps the section accurate even after page refresh.
  const STORAGE_KEY = `forum-claimed-${addr.toLowerCase()}`;

  type RowStateMap = Record<
    string,
    { status: "idle" | "busy" | "done" | "error"; result?: ClaimResult; error?: string }
  >;

  // Hydrate from localStorage on first render (client-only). Done rows survive refresh.
  const [rowState, setRowState] = useState<RowStateMap>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as Record<string, ClaimResult | { alreadyClaimed: true }>;
      const hydrated: RowStateMap = {};
      for (const [marketId, val] of Object.entries(cached)) {
        if ("alreadyClaimed" in val) {
          hydrated[marketId] = { status: "done", result: { txHash: "", claimedUsdc: "0", explorer: "" } as ClaimResult };
        } else {
          hydrated[marketId] = { status: "done", result: val };
        }
      }
      setRowState(hydrated);
    } catch {
      // localStorage unavailable / parse error — silent fallback
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [STORAGE_KEY]);

  const persistClaimed = (marketId: string, value: ClaimResult | { alreadyClaimed: true }) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const cached = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      cached[marketId] = value;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
    } catch {
      // noop
    }
  };

  // Only show rows that haven't been claimed yet.
  const unclaimed = claimable.filter((r) => rowState[r.marketId]?.status !== "done");
  const total = unclaimed.reduce((acc, r) => acc + r.stakeUsdc, 0n);

  // Don't render the section at all if everything's been claimed.
  if (unclaimed.length === 0) return null;

  const handleClaim = async (marketId: string) => {
    setRowState((prev) => ({ ...prev, [marketId]: { status: "busy" } }));
    try {
      // P0-B-005 — server now requires an EIP-712 sig from the connected
      // Dynamic wallet before topping up gas + broadcasting claim().
      if (!primaryWallet || !isEthereumWallet(primaryWallet as Parameters<typeof isEthereumWallet>[0])) {
        throw new Error("Connect an Ethereum wallet to claim winnings");
      }
      const signer = await signerFromDynamic(primaryWallet as Parameters<typeof signerFromDynamic>[0]);
      const result = await claimMarket({ traderAddress: addr, marketId, signer });
      setRowState((prev) => ({ ...prev, [marketId]: { status: "done", result } }));
      // Persist either the success receipt or the "already claimed" marker
      // (server returns txHash="" when shares=0, i.e. already-claimed path).
      if (result.txHash) {
        persistClaimed(marketId, result);
      } else {
        persistClaimed(marketId, { alreadyClaimed: true });
      }
    } catch (err) {
      setRowState((prev) => ({
        ...prev,
        [marketId]: { status: "error", error: (err as Error).message },
      }));
    }
  };

  return (
    <section>
      <SectionLabel meta={`${unclaimed.length} unclaimed`}>Claim available</SectionLabel>
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 4,
          padding: "20px 24px",
          backgroundColor: "color-mix(in oklch, var(--color-honos-gold) 6%, var(--color-raised))",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(20px, 2.6vw, 28px)",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--color-honos-gold)",
            }}
          >
            ≈ {formatUsdc(total)} USDC
          </span>
          <span
            className="mono"
            style={{
              fontSize: "var(--text-2xs)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--color-bone-faint)",
            }}
          >
            in winning shares across {unclaimed.length} market{unclaimed.length === 1 ? "" : "s"}
          </span>
        </div>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {unclaimed.map((c) => {
            const state = rowState[c.marketId] ?? { status: "idle" };
            return (
              <li
                key={`${c.marketId}-${c.outcome}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 14,
                  alignItems: "center",
                  paddingTop: 10,
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <a className="link" href={`/markets/${c.marketId}`} style={{ fontSize: "var(--text-sm)" }}>
                  {c.question.slice(0, 70)}{c.question.length > 70 ? "…" : ""}
                </a>
                <span
                  className="mono"
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--color-bone)",
                    letterSpacing: "0.02em",
                  }}
                >
                  {c.outcome === 1 ? "YES" : "NO"} · {formatUsdc(c.stakeUsdc)} USDC
                </span>
                <ClaimRowAction state={state} marketId={c.marketId} onClaim={handleClaim} />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/// Per-row claim button + status. State machine:
///   idle  → "claim" gold button
///   busy  → "claiming…" disabled
///   done  → "✓ X USDC · tx" green link (or "already claimed" if shares=0)
///   error → "✗ msg · retry" red, click to retry
function ClaimRowAction({
  state,
  marketId,
  onClaim,
}: {
  state: { status: "idle" | "busy" | "done" | "error"; result?: ClaimResult; error?: string };
  marketId: string;
  onClaim: (m: string) => void;
}) {
  if (state.status === "busy") {
    return (
      <span className="mono" style={{ fontSize: "var(--text-2xs)", color: "var(--color-honos-gold)" }}>
        claiming…
      </span>
    );
  }
  if (state.status === "done" && state.result) {
    const r = state.result;
    if (!r.txHash) {
      // shares=0 path — trader already claimed (or never owned shares)
      return (
        <span className="mono" style={{ fontSize: "var(--text-2xs)", color: "var(--color-bone-dim)" }}>
          ✓ already claimed
        </span>
      );
    }
    const usdc = Number(r.claimedUsdc) / 1_000_000;
    return (
      <a
        className="mono link"
        href={r.explorer ?? "#"}
        target="_blank"
        rel="noreferrer"
        style={{
          fontSize: "var(--text-2xs)",
          color: "var(--color-outcome-yes)",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        ✓ {usdc.toFixed(4)} USDC · {r.txHash.slice(0, 6)}…{r.txHash.slice(-4)}
        <ArrowSquareOut size={10} />
      </a>
    );
  }
  if (state.status === "error") {
    return (
      <button
        type="button"
        onClick={() => onClaim(marketId)}
        className="mono"
        title={state.error}
        style={{
          background: "transparent",
          color: "var(--color-tessera-oxblood)",
          border: "1px solid var(--color-tessera-oxblood)",
          borderRadius: 3,
          padding: "4px 10px",
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.04em",
          cursor: "pointer",
        }}
      >
        ✗ retry
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onClaim(marketId)}
      className="mono"
      style={{
        background: "var(--color-honos-gold)",
        color: "var(--color-on-gold)",
        border: "1px solid var(--color-honos-gold)",
        borderRadius: 3,
        padding: "5px 14px",
        fontSize: "var(--text-2xs)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      Claim
    </button>
  );
}

function SignInPrompt() {
  return (
    <section
      style={{
        position: "relative",
        width: "100%",
        minHeight: "calc(100vh - 200px)",
        padding: "clamp(96px, 10vw, 140px) clamp(20px, 4vw, 56px) clamp(64px, 8vw, 100px)",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "linear-gradient(180deg, " +
          "color-mix(in oklch, var(--color-pastel-sky) 60%, var(--color-bg)) 0%, " +
          "color-mix(in oklch, var(--color-pastel-sky) 35%, var(--color-bg)) 50%, " +
          "color-mix(in oklch, var(--color-pastel-sun) 45%, var(--color-bg)) 75%, " +
          "color-mix(in oklch, var(--color-pastel-peach) 50%, var(--color-bg)) 100%)",
      }}
    >
      {/* Island scene backdrop */}
      <svg
        viewBox="0 0 1200 700"
        preserveAspectRatio="xMidYMax meet"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }}
        aria-hidden
      >
        {/* Drifting clouds */}
        <g style={{ animation: "drift-slow 80s linear infinite", opacity: 0.55 }}>
          <ellipse cx="220" cy="80" rx="50" ry="11" fill="color-mix(in oklch, var(--color-raised) 92%, white)" />
          <ellipse cx="260" cy="74" rx="34" ry="9"  fill="color-mix(in oklch, var(--color-raised) 92%, white)" />
        </g>
        <g style={{ animation: "drift-slow 110s linear infinite", animationDelay: "-30s", opacity: 0.45 }}>
          <ellipse cx="920" cy="100" rx="58" ry="12" fill="color-mix(in oklch, var(--color-raised) 90%, white)" />
        </g>

        {/* Ocean ring (faint) */}
        <ellipse cx="600" cy="600" rx="640" ry="120"
          fill="color-mix(in oklch, var(--color-pastel-sky) 45%, transparent)" opacity="0.6" />

        {/* Island */}
        <ellipse cx="600" cy="600" rx="500" ry="90"
          fill="url(#signin-island-fill)" />
        <defs>
          <radialGradient id="signin-island-fill" cx="0.5" cy="0.5" r="0.7">
            <stop offset="0%"  stopColor="color-mix(in oklch, var(--color-pastel-sun) 65%, var(--color-raised))" />
            <stop offset="80%" stopColor="color-mix(in oklch, var(--color-pastel-peach) 55%, var(--color-raised))" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--color-pastel-peach) 35%, var(--color-bg))" />
          </radialGradient>
        </defs>

        {/* Sandy shoreline dashed line */}
        <ellipse cx="600" cy="600" rx="450" ry="70"
          fill="none"
          stroke="color-mix(in oklch, var(--color-honos-gold) 50%, transparent)"
          strokeWidth="1.6" strokeDasharray="4 5" opacity="0.6" />

        {/* Palm trees flanking the island */}
        <g transform="translate(160, 530)">
          <path d="M 0 80 Q 5 40 12 10" stroke="#6B3F1F" strokeWidth="8" fill="none" strokeLinecap="round" />
          <path d="M 12 10 Q -22 -4 -46 16 Q -4 6 4 26" fill="color-mix(in oklch, var(--color-outcome-yes) 65%, var(--color-aureus-ink))" />
          <path d="M 12 10 Q 46 -4 70 16 Q 30 6 22 26"  fill="color-mix(in oklch, var(--color-outcome-yes) 58%, var(--color-aureus-ink))" />
          <path d="M 12 10 Q 6 -20 -8 -32 Q 14 -8 22 14" fill="color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-aureus-ink))" />
          <path d="M 12 10 Q 32 -20 54 -28 Q 30 -4 22 16" fill="color-mix(in oklch, var(--color-outcome-yes) 62%, var(--color-aureus-ink))" />
          <circle cx="10" cy="16" r="2.4" fill="#4a2b16" />
        </g>
        <g transform="translate(1040, 530) scale(-1, 1)">
          <path d="M 0 80 Q 5 40 12 10" stroke="#6B3F1F" strokeWidth="8" fill="none" strokeLinecap="round" />
          <path d="M 12 10 Q -22 -4 -46 16 Q -4 6 4 26" fill="color-mix(in oklch, var(--color-outcome-yes) 65%, var(--color-aureus-ink))" />
          <path d="M 12 10 Q 46 -4 70 16 Q 30 6 22 26"  fill="color-mix(in oklch, var(--color-outcome-yes) 58%, var(--color-aureus-ink))" />
          <path d="M 12 10 Q 6 -20 -8 -32 Q 14 -8 22 14" fill="color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-aureus-ink))" />
          <path d="M 12 10 Q 32 -20 54 -28 Q 30 -4 22 16" fill="color-mix(in oklch, var(--color-outcome-yes) 62%, var(--color-aureus-ink))" />
          <circle cx="10" cy="16" r="2.4" fill="#4a2b16" />
        </g>

        {/* Welcome sign post on the sand */}
        <g transform="translate(560, 570)">
          {/* Post */}
          <rect x="38" y="20" width="6" height="40" fill="#7A4B22" />
          {/* Sign board */}
          <rect x="0" y="0" width="82" height="26" rx="3"
            fill="color-mix(in oklch, var(--color-bone) 92%, var(--color-pastel-peach))"
            stroke="color-mix(in oklch, var(--color-tessera-oxblood) 50%, transparent)"
            strokeWidth="1.4" />
          <text x="41" y="17" textAnchor="middle"
            fontFamily="ui-monospace" fontWeight="700" fontSize="10" letterSpacing="1.5"
            fill="var(--color-tessera-oxblood)">CONSOLE</text>
          {/* Tiny crab on top of sign */}
          <circle cx="14" cy="-2" r="3" fill="var(--color-honos-gold)" />
        </g>

        {/* Footprint trail leading to the sign */}
        <g fill="color-mix(in oklch, var(--color-tessera-oxblood) 35%, transparent)" opacity="0.5">
          <circle cx="430" cy="640" r="1.4" />
          <circle cx="455" cy="636" r="1.4" />
          <circle cx="480" cy="640" r="1.4" />
          <circle cx="505" cy="636" r="1.4" />
          <circle cx="530" cy="640" r="1.4" />
          <circle cx="555" cy="636" r="1.4" />
        </g>

        {/* Birds */}
        <g style={{ animation: "drift-slow 75s linear infinite", opacity: 0.55 }}>
          <path d="M 360 140 q 4 -4 8 0 q 4 -4 8 0" stroke="var(--color-aureus-ink)" strokeWidth="1.4" fill="none" />
          <path d="M 720 120 q 4 -4 8 0 q 4 -4 8 0" stroke="var(--color-aureus-ink)" strokeWidth="1.4" fill="none" />
        </g>
      </svg>

      {/* Foreground content card */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 540,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          padding: "32px 28px",
          borderRadius: 20,
          background: "color-mix(in oklch, var(--color-raised) 92%, transparent)",
          border: "1.5px solid var(--color-border)",
          boxShadow: "0 12px 32px color-mix(in oklch, var(--color-aureus-ink) 22%, transparent)",
          backdropFilter: "blur(8px)",
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: "var(--text-2xs)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--color-bone-dim)",
          }}
        >
          🦀 Your Crab · Authentication Required
        </span>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: "clamp(28px, 4vw, 42px)",
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
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
              fontSize: "0.6em",
              color: "var(--color-aureus-ink)",
            }}
          >
            sign in to claim
          </span>
          <span style={{ textTransform: "uppercase" }}>
            <span style={{ color: "var(--color-honos-gold)" }}>Your</span>{" "}
            <span style={{ color: "var(--color-aureus-ink)" }}>Crab</span>
          </span>
        </h1>
        <p style={{ margin: 0, color: "var(--color-bone-dim)", fontSize: "var(--text-sm)", lineHeight: 1.6 }}>
          FORUM uses Dynamic.xyz for MPC-managed embedded wallets. Sign in
          with email, passkey, or any EVM wallet — we&apos;ll spin up a fresh
          trader wallet and link any past bets from the address.
        </p>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
          <DynamicWidget />
        </div>
        <p
          className="mono"
          style={{
            margin: 0,
            fontSize: "10px",
            letterSpacing: "0.10em",
            color: "var(--color-bone-faint)",
          }}
        >
          🔒 no private keys leave your device · MPC-managed via Dynamic
        </p>
      </div>
    </section>
  );
}

function EmptyActivity() {
  return (
    <div
      style={{
        border: "1px dashed var(--color-border)",
        borderRadius: 4,
        padding: "32px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <p style={{ margin: 0, color: "var(--color-bone)", fontSize: "var(--text-sm)" }}>
        No bets from your FORUM wallet yet.
      </p>
      <p
        className="mono"
        style={{ margin: 0, color: "var(--color-bone-faint)", fontSize: "var(--text-xs)", lineHeight: 1.6 }}
      >
        Claim the 1 USDC faucet above, then place a bet on any open market.
        Or run your own agent via the SDK — see <a className="link" href="/docs">/docs</a>.
      </p>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-bone-faint)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ color: "var(--color-bone)", fontSize: "var(--text-sm)" }}>{value}</div>
    </div>
  );
}

function BetTable({ bets }: { bets: Bet[] }) {
  return (
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
          <col style={{ width: 130 }} />
        </colgroup>
        <thead>
          <tr
            style={{
              textAlign: "left",
              color: "var(--color-bone-faint)",
              fontSize: "var(--text-2xs)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            <th style={{ padding: "8px 12px 14px", fontWeight: 400 }}>When</th>
            <th style={{ padding: "8px 12px 14px", fontWeight: 400 }}>Market</th>
            <th style={{ padding: "8px 12px 14px", fontWeight: 400, textAlign: "center" }}>Side</th>
            <th style={{ padding: "8px 12px 14px", fontWeight: 400, textAlign: "right" }}>Cost</th>
            <th style={{ padding: "8px 12px 14px", fontWeight: 400 }}>Tx</th>
          </tr>
        </thead>
        <tbody>
          {bets.map((b) => (
            <tr key={b.id} style={{ borderTop: "1px solid var(--color-border)" }}>
              <td style={{ padding: "10px 12px", color: "var(--color-bone-faint)" }}>
                {relativeTime(b.createdAt)}
              </td>
              <td style={{ padding: "10px 12px" }}>
                <a className="link" href={`/markets/${b.marketId}`}>
                  {b.marketId.slice(0, 10)}…
                </a>
              </td>
              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                <OutcomeBadge outcome={b.outcome} />
              </td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--color-bone)" }}>
                {formatUsdc(b.costUsdc)}
              </td>
              <td style={{ padding: "10px 12px" }}>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
