"use client";

/// Arena — `/markets/[id]` signature scene, fully redesigned per user spec.
///
/// New layout:
///   - START bridge on the LEFT — agents wait here before betting
///   - Vertical ropes in the middle, hanging from a top beam (YES side + NO side)
///   - FINISH bridge on the RIGHT — agents land here when their side wins
///   - Water at the bottom with circling sharks
///
/// Flow:
///   1. Market open, user not bet — user's crab idle on START bridge
///   2. User bets YES/NO — crab jumps onto chosen-side rope, hangs vertically
///   3. While open — ropes sway up/down with LMSR-implied probability
///      (price chip updates realtime via SSE bet.placed events)
///   4. Multiple bets per side distribute across multiple ropes (max 3 per rope)
///   5. Resolved (winning side) — winners slide off rope, walk to FINISH bridge
///   6. Resolved (losing side) — rope SNAPS from cleat, crabs fall into water,
///      chomp shark surfaces for the kill animation

import { useEffect, useState } from "react";
import type { Bet, Market, Resolution } from "@/lib/api";
import { knownAgent } from "@/lib/api";
import { spriteForAddress, type AgentName } from "@/lib/agent-sprites";
import { AgentSprite } from "../AgentSprite";
import { MyHatOverlay } from "../MyHatOverlay";
import { formatUsdc, truncHash, arcscanTx } from "@/lib/format";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { SkyOrb } from "../SkyOrb";

type Props = {
  market: Market;
  bets: Bet[];
  winningOutcome?: 0 | 1 | 2 | null;
  /** Resolution metadata for trusted-source banner */
  resolution?: Resolution | null;
};

type Walker = {
  addr: string;
  sprite: AgentName;
  label: string;
  vol: bigint;
  count: number;
  outcome: 0 | 1;
  ropeIndex: number;
  slot: number;
  lastTx: string;
  /** Wall-clock ms of the most recent SSE bet arrival for this walker.
   *  Used to trigger the START → rope walk-in animation. 0 = historical. */
  freshAt: number;
};

const MAX_PER_ROPE = 3;

export function Arena({ market, bets: initialBets, winningOutcome, resolution }: Props) {
  const [bets, setBets] = useState<Bet[]>(initialBets);
  // freshness map: `${addrLower}-${outcome}` → wall-clock ms of last SSE arrival.
  // Drives the START → rope walk-in animation only for genuinely new bets,
  // so initial historical bets render straight to their hanging position.
  const [freshness, setFreshness] = useState<Record<string, number>>({});

  // Keep state in sync with server prop refreshes
  useEffect(() => {
    setBets((prev) => {
      const seen = new Set(initialBets.map((b) => `${b.marketTxHash}-${b.agentAddress}`));
      const extras = prev.filter((b) => !seen.has(`${b.marketTxHash}-${b.agentAddress}`));
      return [...initialBets, ...extras];
    });
  }, [initialBets]);

  // SSE — append bet.placed events that match this market
  useEffect(() => {
    const marketIdLower = market.id.toLowerCase();
    const handler = (e: Event) => {
      const event = (e as CustomEvent).detail as
        | { type: string; marketId?: string; agentAddress?: string; outcome?: 0 | 1;
            sharesWad?: string; costUsdc?: string; feeUsdc?: string; txHash?: string;
            blockNumber?: number; createdAt?: number }
        | undefined;
      if (!event || event.type !== "bet.placed") return;
      if (event.marketId?.toLowerCase() !== marketIdLower) return;
      if (!event.agentAddress) return;
      const key = `${event.txHash ?? ""}-${event.agentAddress}`;
      setBets((prev) => {
        if (prev.some((b) => `${b.marketTxHash}-${b.agentAddress}` === key)) return prev;
        const synthetic: Bet = {
          id: Date.now(),
          marketId: event.marketId!,
          agentAddress: event.agentAddress!,
          outcome: (event.outcome ?? 1) as 0 | 1,
          sharesWad: event.sharesWad ?? "0",
          costUsdc: event.costUsdc ?? "0",
          feeUsdc: event.feeUsdc ?? "0",
          marketTxHash: event.txHash ?? "",
          blockNumber: event.blockNumber ?? 0,
          createdAt: event.createdAt ?? Math.floor(Date.now() / 1000),
        };
        return [synthetic, ...prev];
      });
      // Mark this walker fresh so it animates from START → rope position.
      const freshKey = `${event.agentAddress!.toLowerCase()}-${event.outcome ?? 1}`;
      setFreshness((prev) => ({ ...prev, [freshKey]: Date.now() }));
    };
    window.addEventListener("forum-event", handler);
    return () => window.removeEventListener("forum-event", handler);
  }, [market.id]);

  // Freshness sweep — drop entries older than 6s so the map can't grow
  // unbounded over a long /markets/[id] session. Runs every 4s, no-ops
  // when the map is empty. Bounded memory: O(unique walkers active in
  // the last 6 seconds).
  useEffect(() => {
    const tick = setInterval(() => {
      setFreshness((prev) => {
        const cutoff = Date.now() - 6_000;
        let changed = false;
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v >= cutoff) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 4_000);
    return () => clearInterval(tick);
  }, []);

  const resolved = market.phase === 2 && winningOutcome !== null && winningOutcome !== undefined;
  const yesWins = resolved && winningOutcome === 1;
  const noWins  = resolved && winningOutcome === 0;

  // Group bets by (address, outcome). Each (addr, outcome) = ONE walker.
  const groupBy = (outcome: 0 | 1) => {
    const map = new Map<string, { vol: bigint; count: number; firstTs: number; lastTx: string }>();
    for (const b of bets) {
      if (b.outcome !== outcome) continue;
      const addr = b.agentAddress.toLowerCase();
      const v = BigInt(b.costUsdc) + BigInt(b.feeUsdc);
      const cur = map.get(addr) ?? { vol: 0n, count: 0, firstTs: b.createdAt, lastTx: b.marketTxHash };
      cur.vol += v;
      cur.count += 1;
      if (b.createdAt < cur.firstTs) cur.firstTs = b.createdAt;
      cur.lastTx = b.marketTxHash;
      map.set(addr, cur);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].firstTs - b[1].firstTs);
  };

  const buildWalkers = (
    entries: [string, { vol: bigint; count: number; firstTs: number; lastTx: string }][],
    outcome: 0 | 1,
  ): Walker[] => {
    return entries.map(([addr, v], i) => {
      const sprite = spriteForAddress(addr) ?? deterministicSprite(addr);
      const known = knownAgent(addr);
      return {
        addr,
        sprite,
        label: known?.label ?? `${addr.slice(0, 6)}…`,
        vol: v.vol,
        count: v.count,
        outcome,
        ropeIndex: Math.floor(i / MAX_PER_ROPE),
        slot: i % MAX_PER_ROPE,
        lastTx: v.lastTx,
        freshAt: freshness[`${addr}-${outcome}`] ?? 0,
      };
    });
  };

  const yesWalkers = buildWalkers(groupBy(1), 1);
  const noWalkers = buildWalkers(groupBy(0), 0);

  // Total stake → live price (LMSR-style)
  const yesVol = yesWalkers.reduce((a, w) => a + w.vol, 0n);
  const noVol = noWalkers.reduce((a, w) => a + w.vol, 0n);
  const totalVol = yesVol + noVol;
  const yesProb = totalVol === 0n ? 0.5 : Number((yesVol * 10_000n) / totalVol) / 10_000;

  // How many ropes per side
  const yesRopes = Math.max(1, Math.ceil(yesWalkers.length / MAX_PER_ROPE));
  const noRopes = Math.max(1, Math.ceil(noWalkers.length / MAX_PER_ROPE));

  return (
    <section
      aria-label={`Arena — ${market.question}`}
      style={{
        position: "relative",
        width: "100%",
        minHeight: "calc(100vh - 64px)",
        overflow: "hidden",
        background:
          "linear-gradient(180deg, " +
          "color-mix(in oklch, var(--color-pastel-sky) 75%, var(--color-bg)) 0%, " +
          "color-mix(in oklch, var(--color-pastel-sky) 45%, var(--color-bg)) 50%, " +
          "color-mix(in oklch, var(--color-aureus-ink) 28%, var(--color-bg)) 65%, " +
          "color-mix(in oklch, var(--color-aureus-ink) 50%, var(--color-bg)) 100%)",
      }}
    >
      {/* ===== Sky orb — sun in light mode, moon+stars in dark mode =====
          Pushed further right + smaller so it never collides with the
          arena flag/bunting decorations on the left edge. */}
      <SkyOrb size={100} position={{ top: "3%", right: "3%" }} />

      {/* ===== Backdrop SVG ===== */}
      <svg
        viewBox="0 0 1000 600"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        aria-hidden
      >
        {/* Sun + moon now lives in <SkyOrb> above this SVG — the old
            primitive circle was stacking with SkyOrb and looked like two
            suns. Drifting clouds remain. */}

        {/* Drifting clouds */}
        <g style={{ animation: "drift-slow 50s linear infinite", opacity: 0.6 }}>
          <ellipse cx="380" cy="60" rx="44" ry="11" fill="color-mix(in oklch, var(--color-bg) 92%, white)" />
          <ellipse cx="430" cy="55" rx="32" ry="9" fill="color-mix(in oklch, var(--color-bg) 92%, white)" />
        </g>
        <g style={{ animation: "drift-slow 65s linear infinite", animationDelay: "-25s", opacity: 0.5 }}>
          <ellipse cx="780" cy="78" rx="48" ry="12" fill="color-mix(in oklch, var(--color-bg) 90%, white)" />
        </g>

        {/* TOP BEAM (cleats spanning the arena center) */}
        <rect x="220" y="92" width="560" height="14" rx="2"
          fill="color-mix(in oklch, var(--color-tessera-oxblood) 50%, var(--color-bone))" />
        {/* Plank lines on the beam */}
        {[0.15, 0.3, 0.45, 0.55, 0.7, 0.85].map((p, i) => (
          <line key={i}
            x1={220 + 560 * p} y1="92"
            x2={220 + 560 * p} y2="106"
            stroke="color-mix(in oklch, var(--color-tessera-oxblood) 70%, transparent)"
            strokeWidth="0.6" />
        ))}

        {/* START BRIDGE (left) */}
        <Bridge x={20} y={300} width={170} label="START" />

        {/* FINISH BRIDGE (right) */}
        <Bridge x={810} y={300} width={170} label="FINISH"
          winnerCount={yesWins ? yesWalkers.length : noWins ? noWalkers.length : 0} />

        {/* WATER */}
        <path
          d={`M 0 380 Q 250 372 500 380 T 1000 380 L 1000 600 L 0 600 Z`}
          fill="color-mix(in oklch, var(--color-aureus-ink) 35%, var(--color-bg))"
        />
        <path
          d={`M 0 388 Q 250 380 500 388 T 1000 388`}
          stroke="color-mix(in oklch, var(--color-pastel-sky) 65%, transparent)"
          strokeWidth="2" fill="none" opacity="0.6"
        />

        {/* SHARKS — drift across water */}
        {[
          { x: 250, depth: 460, dur: 12, delay: 0 },
          { x: 520, depth: 490, dur: 16, delay: 4 },
          { x: 780, depth: 470, dur: 14, delay: 8 },
        ].map((s, i) => (
          <g key={i} style={{
            animation: `drift-slow ${s.dur}s linear infinite`,
            animationDelay: `${s.delay}s`,
            opacity: 0.8,
          }}>
            <path d={`M${s.x},${s.depth} L${s.x + 6},${s.depth - 16} L${s.x + 13},${s.depth} Z`}
              fill="color-mix(in oklch, var(--color-bone) 80%, var(--color-aureus-ink))" />
            <path d={`M${s.x - 11},${s.depth + 1} L${s.x - 6},${s.depth - 7} L${s.x - 1},${s.depth + 1} Z`}
              fill="color-mix(in oklch, var(--color-bone) 60%, var(--color-aureus-ink))" opacity="0.7" />
          </g>
        ))}

        {/* ROPES — vertical, hanging from the top beam.
            Length = live price. Winning side rope is SHORT (crab safe up
            high). Losing side rope is LONG (crab hangs near water/sharks).
            Plus a continuous bob so it feels like a moving chart. */}
        {Array.from({ length: yesRopes }, (_, i) => {
          // priceLevel 0..1: higher = better for YES = shorter rope
          const priceLevel = noWins ? 0 : yesProb;
          const x = 280 + i * 50;
          return (
            <VerticalRope
              key={`yes-rope-${i}`}
              x={x}
              topY={106}
              bottomY={370}
              snapped={noWins}
              priceLevel={priceLevel}
              accent="yes"
              ropeSeed={i}
            />
          );
        })}
        {Array.from({ length: noRopes }, (_, i) => {
          const priceLevel = yesWins ? 0 : 1 - yesProb;
          const x = 720 - i * 50;
          return (
            <VerticalRope
              key={`no-rope-${i}`}
              x={x}
              topY={106}
              bottomY={370}
              snapped={yesWins}
              priceLevel={priceLevel}
              accent="no"
              ropeSeed={i + 5}
            />
          );
        })}

        {/* Side labels — YES on left ropes, NO on right ropes */}
        <rect x="225" y="125" width="60" height="22" rx="11"
          fill="color-mix(in oklch, var(--color-outcome-yes) 25%, var(--color-raised))"
          stroke="var(--color-outcome-yes)" strokeWidth="1.5" />
        <text x="255" y="140" textAnchor="middle"
          fontFamily="ui-monospace" fontWeight="700" fontSize="11" letterSpacing="2"
          fill="var(--color-outcome-yes)">YES</text>
        <rect x="715" y="125" width="60" height="22" rx="11"
          fill="color-mix(in oklch, var(--color-outcome-no) 25%, var(--color-raised))"
          stroke="var(--color-outcome-no)" strokeWidth="1.5" />
        <text x="745" y="140" textAnchor="middle"
          fontFamily="ui-monospace" fontWeight="700" fontSize="11" letterSpacing="2"
          fill="var(--color-outcome-no)">NO</text>

        {/* CHOMP SHARK when rope snaps — surfaces under losing-side ropes.
            eatenCount = unique losers on the side that lost. */}
        {(yesWins || noWins) && (
          <ChompShark
            cx={yesWins ? 720 : 280}
            cy={420}
            outcome={yesWins ? "no-lost" : "yes-lost"}
            eatenCount={yesWins ? noWalkers.length : yesWalkers.length}
          />
        )}

        {/* LIVING SHARKS — patrol the water during OPEN markets. Two is
            plenty visually; three was extra GPU work for diminishing return. */}
        {!resolved && (
          <>
            <JumpingShark cx={360} delay={0} duration={13} />
            <JumpingShark cx={640} delay={6} duration={15} flip />
          </>
        )}
      </svg>

      {/* ===== HTML OVERLAYS ===== */}

      {/* Headline */}
      <div style={{ position: "absolute", top: 90, left: 0, right: 0, textAlign: "center", zIndex: 4, padding: "0 24px", pointerEvents: "none" }}>
        <span className="mono" style={{
          fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
          color: "var(--color-bone-dim)", display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          <span aria-hidden style={{
            width: 6, height: 6, borderRadius: "50%",
            background: resolved ? "var(--color-honos-gold)" : "var(--color-outcome-yes)",
            boxShadow: !resolved ? "0 0 6px color-mix(in oklch, var(--color-outcome-yes) 70%, transparent)" : undefined,
          }} />
          {resolved ? `Resolved · ${yesWins ? "YES" : noWins ? "NO" : "INVALID"} won` : "Live · Tightrope active"}
        </span>
        <h2 style={{
          margin: "4px auto 0", fontFamily: "var(--font-display)",
          fontSize: "clamp(14px, 1.8vw, 20px)", fontWeight: 700,
          color: "var(--color-bone)", lineHeight: 1.2, maxWidth: "62ch",
        }}>
          {market.question.length > 80 ? market.question.slice(0, 77) + "…" : market.question}
        </h2>
      </div>

      {/* Live price chip — below headline */}
      <div style={{
        position: "absolute", top: 160, left: "50%", transform: "translateX(-50%)",
        padding: "6px 16px", borderRadius: 999,
        background: "color-mix(in oklch, var(--color-raised) 95%, transparent)",
        border: "1px solid var(--color-border)", backdropFilter: "blur(8px)",
        display: "inline-flex", alignItems: "center", gap: 12, zIndex: 4,
        fontFamily: "var(--font-mono)",
      }}>
        <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
          <span style={{ fontSize: 8, letterSpacing: "0.18em", color: "var(--color-outcome-yes)", fontWeight: 700 }}>YES</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-outcome-yes)" }}>{(yesProb * 100).toFixed(0)}¢</span>
        </span>
        <span aria-hidden style={{ width: 1, height: 22, background: "var(--color-border)" }} />
        <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
          <span style={{ fontSize: 8, letterSpacing: "0.18em", color: "var(--color-outcome-no)", fontWeight: 700 }}>NO</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-outcome-no)" }}>{((1 - yesProb) * 100).toFixed(0)}¢</span>
        </span>
      </div>

      {/* Crabs ON the YES ropes */}
      {yesWalkers.map((w) => (
        <RopeWalker
          key={`yes-${w.addr}`}
          walker={w}
          ropeCount={yesRopes}
          state={yesWins ? "safe" : noWins ? "doomed" : "hanging"}
          ropePriceLevel={noWins ? 0 : yesProb}
        />
      ))}
      {/* Crabs ON the NO ropes */}
      {noWalkers.map((w) => (
        <RopeWalker
          key={`no-${w.addr}`}
          walker={w}
          ropeCount={noRopes}
          state={noWins ? "safe" : yesWins ? "doomed" : "hanging"}
          ropePriceLevel={yesWins ? 0 : 1 - yesProb}
        />
      ))}

      {/* Empty state — no bets yet */}
      {yesWalkers.length + noWalkers.length === 0 && !resolved && (
        <div style={{
          position: "absolute", top: "55%", left: "50%", transform: "translate(-50%, -50%)",
          padding: "12px 20px", borderRadius: 999,
          background: "color-mix(in oklch, var(--color-raised) 90%, transparent)",
          border: "1.5px solid var(--color-border)", backdropFilter: "blur(6px)",
          fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--color-bone-dim)", zIndex: 3,
          pointerEvents: "none",
        }}>
          Place a bet to step onto the rope
        </div>
      )}

      {/* Trusted-source receipt — appears when resolved */}
      {resolved && resolution && (
        <div style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          padding: "12px 18px", borderRadius: 16,
          background: "color-mix(in oklch, var(--color-raised) 94%, transparent)",
          border: "1.5px solid var(--color-honos-gold)",
          backdropFilter: "blur(8px)", zIndex: 4,
          display: "flex", flexDirection: "column", gap: 6,
          fontFamily: "var(--font-mono)",
          minWidth: 320,
          maxWidth: "min(560px, 90vw)",
        }}>
          <span style={{
            fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase",
            color: "var(--color-honos-gold)", fontWeight: 700,
          }}>
            ✓ Verified resolution · Trusted source
          </span>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: "var(--text-xs)", color: "var(--color-bone-dim)" }}>
            <span><strong style={{ color: "var(--color-bone)" }}>Source:</strong> {resolution.source}</span>
            {resolution.ecbRate && (
              <span><strong style={{ color: "var(--color-bone)" }}>Rate:</strong> {resolution.ecbRate}</span>
            )}
            {resolution.ecbDate && (
              <span><strong style={{ color: "var(--color-bone)" }}>Date:</strong> {resolution.ecbDate}</span>
            )}
          </div>
          <a href={arcscanTx(resolution.txHash)} target="_blank" rel="noreferrer"
            className="link"
            style={{
              fontSize: "var(--text-xs)", color: "var(--color-aureus-ink)",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
            tx {truncHash(resolution.txHash)} <ArrowSquareOut size={11} />
          </a>
        </div>
      )}

      <style>{`
        @keyframes hang-sway {
          0%, 100% { transform: rotate(-3deg); }
          50%      { transform: rotate(3deg); }
        }
        @keyframes walker-walk-in {
          0%   { transform: translate(calc(-50% + var(--walk-dx)), 4px) scaleX(-1); opacity: 0; }
          15%  { opacity: 1; }
          55%  { transform: translate(calc(-50% - 16px), -2px) scaleX(-1); }
          70%  { transform: translate(-50%, -8px) scaleX(1); }
          85%  { transform: translate(-50%, 2px) scaleX(1); }
          100% { transform: translate(-50%, 0) scaleX(1); }
        }
        @keyframes walker-cheer {
          0%, 100% { transform: translate(-50%, 0) translateY(0); }
          50%      { transform: translate(-50%, 0) translateY(-10px); }
        }
        @keyframes walker-fall {
          0%   { transform: translate(-50%, 0) rotate(0); opacity: 1; }
          40%  { transform: translate(-50%, 50%) rotate(45deg); opacity: 1; }
          100% { transform: translate(-50%, 220%) rotate(180deg); opacity: 0.15; }
        }
        @keyframes rope-snap-anim {
          0%   { transform: translateY(0) rotate(0); opacity: 1; }
          15%  { transform: translateY(2px) rotate(-1deg); opacity: 1; }
          100% { transform: translateY(60px) rotate(-15deg); opacity: 0.5; }
        }
        @keyframes price-sway {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
        /* chart-bob — bigger amplitude (±18px) gives the rope a "live price
           ticker" feel. Each rope picks its own duration so neighbours don't
           oscillate in sync. */
        @keyframes chart-bob {
          0%   { transform: translateY(0); }
          25%  { transform: translateY(-14px); }
          50%  { transform: translateY(8px); }
          75%  { transform: translateY(-6px); }
          100% { transform: translateY(0); }
        }
        /* shark-jump — leaps from below the water line up toward the lowest
           crab on a rope, snaps teeth at the apex, falls back. ~12s cycle
           with ~70% of the cycle spent below water so the leap is a
           punctuation moment, not constant chaos. */
        @keyframes shark-jump {
          0%, 70%, 100% { transform: translateY(0)   rotate(0deg); }
          78%           { transform: translateY(-140px) rotate(-8deg); }
          82%           { transform: translateY(-160px) rotate(-4deg); }
          90%           { transform: translateY(-60px)  rotate(12deg); }
        }
        @keyframes shark-chomp {
          0%, 100% { transform: scaleY(1); }
          50%      { transform: scaleY(0.4); }
        }
        @keyframes splash-pulse {
          0%, 100% { opacity: 0; transform: scale(0.8); }
          75%, 85% { opacity: 1; transform: scale(1.1); }
        }
        @keyframes chomp-rise {
          0%   { transform: translateY(40px); opacity: 0; }
          40%  { transform: translateY(0); opacity: 1; }
          70%  { transform: translateY(-3px) rotate(-6deg); }
          100% { transform: translateY(0) rotate(0); opacity: 1; }
        }
      `}</style>
    </section>
  );
}

/* ================================================================ */
/* Bridge — START or FINISH, with wooden plank look                   */
/* ================================================================ */
function Bridge({
  x, y, width, label, winnerCount = 0,
}: {
  x: number; y: number; width: number; label: string; winnerCount?: number;
}) {
  return (
    <g>
      {/* Bridge label above */}
      <text
        x={x + width / 2} y={y - 16}
        textAnchor="middle"
        fontFamily="ui-monospace" fontWeight="700"
        fontSize="13" letterSpacing="2.5"
        fill="var(--color-bone)"
      >
        {label}
      </text>
      {winnerCount > 0 && (
        <g>
          {/* Pushed higher so the pill clears the FINISH label below.
              Old y-38 overlapped the text glyph by ~7px. */}
          <rect x={x + width / 2 - 32} y={y - 60} width={64} height={18} rx="9"
            fill="var(--color-honos-gold)"
            stroke="var(--color-on-gold)" strokeWidth="1" opacity="0.96" />
          <text x={x + width / 2} y={y - 47} textAnchor="middle"
            fontFamily="ui-monospace" fontWeight="700" fontSize="11"
            fill="var(--color-on-gold)">
            ★ {winnerCount} safe
          </text>
        </g>
      )}
      {/* Plank surface */}
      <rect x={x} y={y} width={width} height={16} rx="2"
        fill="color-mix(in oklch, var(--color-pastel-peach) 75%, var(--color-tessera-oxblood))"
        stroke="color-mix(in oklch, var(--color-tessera-oxblood) 50%, transparent)" strokeWidth="1.5" />
      {/* Plank lines */}
      {[0.2, 0.4, 0.6, 0.8].map((p, i) => (
        <line key={i}
          x1={x + width * p} y1={y}
          x2={x + width * p} y2={y + 16}
          stroke="color-mix(in oklch, var(--color-tessera-oxblood) 40%, transparent)" strokeWidth="0.5" />
      ))}
      {/* Posts */}
      <rect x={x + 8} y={y + 16} width="4" height="60"
        fill="color-mix(in oklch, var(--color-tessera-oxblood) 55%, var(--color-bone))" />
      <rect x={x + width - 12} y={y + 16} width="4" height="60"
        fill="color-mix(in oklch, var(--color-tessera-oxblood) 55%, var(--color-bone))" />
    </g>
  );
}

/* ================================================================ */
/* VerticalRope — hangs from top beam down to ~water-level            */
/* ================================================================ */
function VerticalRope({
  x, topY, bottomY, snapped, priceLevel, accent, ropeSeed = 0,
}: {
  x: number;
  topY: number;
  bottomY: number;
  snapped: boolean;
  /** 0..1 — live probability for this rope's side. Higher = rope retracts UP
   *  (crab safer). Lower = rope extends DOWN (crab dangling near sharks). */
  priceLevel: number;
  accent: "yes" | "no";
  /** Stable per-rope seed for staggered bob timing. */
  ropeSeed?: number;
}) {
  const stroke = accent === "yes"
    ? "color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))"
    : "color-mix(in oklch, var(--color-outcome-no) 70%, var(--color-bone))";

  // Map priceLevel 0..1 to a rope length. priceLevel=1 → rope at 60% of full
  // length (crab high up); priceLevel=0 → rope at 100% (crab near water).
  // Clamp so a rope is never shorter than ~120px.
  const fullLen = bottomY - topY;
  const minLen  = fullLen * 0.45;
  const dynLen  = minLen + (1 - priceLevel) * (fullLen - minLen);
  const dynBottom = topY + dynLen;

  // Bob params — each rope gets its own duration & delay so the wall of
  // ropes doesn't oscillate in sync. Looks like a live price feed.
  const duration = 5 + (ropeSeed % 4) * 1.2;
  const delay = -((ropeSeed * 0.7) % duration);

  if (!snapped) {
    return (
      <g
        style={{
          animation: `chart-bob ${duration}s ease-in-out infinite`,
          animationDelay: `${delay}s`,
          transformOrigin: `${x}px ${topY}px`,
          transition: "transform 800ms cubic-bezier(.22,.61,.36,1)",
        }}
      >
        {/* Cleat at top */}
        <circle cx={x} cy={topY} r="4" fill="var(--color-honos-gold)" />
        {/* Shadow rope */}
        <line x1={x + 1} y1={topY + 2} x2={x + 1} y2={dynBottom}
          stroke="color-mix(in oklch, black 50%, transparent)" strokeWidth="5"
          opacity="0.2" strokeLinecap="round"
          style={{ transition: "y2 900ms cubic-bezier(.22,.61,.36,1)" }} />
        {/* Main rope */}
        <line x1={x} y1={topY} x2={x} y2={dynBottom}
          stroke={stroke} strokeWidth="4" strokeLinecap="round"
          style={{ transition: "y2 900ms cubic-bezier(.22,.61,.36,1)" }} />
        {/* Rope twist pattern (density follows current length) */}
        {Array.from({ length: 22 }, (_, i) => {
          const yp = topY + (dynLen / 22) * (i + 0.5);
          return (
            <line key={i}
              x1={x - 2.5} y1={yp - 2.5}
              x2={x + 2.5} y2={yp + 2.5}
              stroke="color-mix(in oklch, black 30%, transparent)"
              strokeWidth="1" opacity="0.45" strokeLinecap="round"
              style={{ transition: "y1 900ms, y2 900ms" }} />
          );
        })}
        {/* Price tick at the bottom of the rope (mini chart marker) */}
        <circle cx={x} cy={dynBottom} r="3" fill={stroke}
          style={{ transition: "cy 900ms cubic-bezier(.22,.61,.36,1)" }} />
      </g>
    );
  }

  // Snapped — rope detached, hangs limp
  const breakY = topY + (bottomY - topY) * 0.25;
  return (
    <g style={{ animation: "rope-snap-anim 0.6s var(--ease-out-quart) forwards", transformOrigin: `${x}px ${topY}px` }}>
      <circle cx={x} cy={topY} r="4" fill="var(--color-honos-gold)" opacity="0.4" />
      <path
        d={`M ${x} ${topY} Q ${x - 8} ${breakY - 10} ${x - 18} ${breakY}`}
        stroke={stroke} strokeWidth="4" fill="none" strokeLinecap="round"
      />
      {/* Frayed ends */}
      <line x1={x - 18} y1={breakY} x2={x - 24} y2={breakY + 4} stroke={stroke} strokeWidth="1.5" />
      <line x1={x - 18} y1={breakY} x2={x - 14} y2={breakY + 6} stroke={stroke} strokeWidth="1.5" />
    </g>
  );
}

/* ================================================================ */
/* JumpingShark — patrols the water and periodically leaps up toward  */
/* the ropes to threaten the dangling crabs. Pure decoration but sells */
/* the "high stakes" narrative during OPEN markets.                   */
/* ================================================================ */
function JumpingShark({
  cx, delay = 0, duration = 12, flip = false,
}: {
  cx: number;
  /** Negative animation delay so the cycle starts mid-stream — staggers
   *  multiple sharks so they don't all leap at once. */
  delay?: number;
  /** Seconds for one full cycle (leap + cool-down). */
  duration?: number;
  /** Mirror the sprite so half the sharks face the other way. */
  flip?: boolean;
}) {
  // Real-shark blue — teal body with pale-sky belly. Was bone-cream which
  // read as a pink fish in light mode.
  const fill = "color-mix(in oklch, var(--color-aureus-ink) 85%, var(--color-pastel-sky))";
  const belly = "color-mix(in oklch, var(--color-pastel-sky) 60%, var(--color-bone))";

  return (
    <g
      style={{
        // Anchor under the water line so the leap rises FROM the water.
        transform: `translate(${cx}px, 460px)`,
        animation: `shark-jump ${duration}s ease-in-out infinite`,
        animationDelay: `${-Math.abs(delay)}s`,
      }}
    >
      {/* Water splash that pulses on leap-out */}
      <g style={{
        transform: "translate(0, 8px)",
        animation: `splash-pulse ${duration}s ease-in-out infinite`,
        animationDelay: `${-Math.abs(delay)}s`,
        transformOrigin: "0 0",
      }}>
        <ellipse cx="0" cy="0" rx="28" ry="6"
          fill="color-mix(in oklch, var(--color-pastel-sky) 60%, white)" opacity="0.85" />
        <path d="M -14 0 Q -8 -10 -2 -2"
          stroke="color-mix(in oklch, var(--color-pastel-sky) 80%, white)"
          strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 14 0 Q 8 -10 2 -2"
          stroke="color-mix(in oklch, var(--color-pastel-sky) 80%, white)"
          strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 0 -2 Q 0 -16 4 -22"
          stroke="color-mix(in oklch, var(--color-pastel-sky) 75%, white)"
          strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>

      <g transform={flip ? "scale(-1, 1)" : undefined}>
        {/* Shadow under shark */}
        <ellipse cx="2" cy="22" rx="32" ry="3" fill="black" opacity="0.18" />

        {/* Tail fluke (back of shark) */}
        <path d="M -34 0 L -50 -14 L -44 0 L -50 14 Z" fill={fill} />

        {/* Torpedo body */}
        <path d="M -34 0 Q -26 -22 6 -20 Q 28 -16 34 0 Q 28 16 6 20 Q -26 22 -34 0 Z"
          fill={fill} />
        {/* Belly */}
        <path d="M -28 4 Q -10 22 22 18 Q 30 12 30 6 Q 12 16 -22 12 Z"
          fill={belly} />

        {/* Dorsal fin */}
        <path d="M -8 -20 L -2 -36 L 6 -20 Z" fill={fill} />
        {/* Pectoral fin */}
        <path d="M 2 12 L 14 24 L 18 14 Z" fill={fill} />

        {/* Gills */}
        <path d="M -12 -6 L -10 6" stroke="color-mix(in oklch, black 50%, transparent)"
          strokeWidth="1" opacity="0.4" />
        <path d="M -7 -6 L -5 6" stroke="color-mix(in oklch, black 50%, transparent)"
          strokeWidth="1" opacity="0.4" />

        {/* Eye */}
        <circle cx="20" cy="-6" r="3.5" fill="white" />
        <circle cx="21" cy="-6" r="2" fill="#1A1814" />
        <circle cx="22" cy="-7" r="0.8" fill="white" />

        {/* Open mouth with chomping teeth */}
        <g style={{
          transformOrigin: "30px 4px",
          animation: `shark-chomp ${duration / 3}s ease-in-out infinite`,
        }}>
          <path d="M 22 2 L 36 -2 L 36 10 L 22 8 Z" fill="#1A1814" />
          {/* Top teeth */}
          <path d="M 24 2 L 25 5 L 26 2 L 27 5 L 28 2 L 29 5 L 30 2 L 31 5 L 32 2 L 33 5 L 34 2 Z"
            fill="white" />
          {/* Bottom teeth */}
          <path d="M 24 8 L 25 5 L 26 8 L 27 5 L 28 8 L 29 5 L 30 8 L 31 5 L 32 8 L 33 5 L 34 8 Z"
            fill="white" />
        </g>
      </g>
    </g>
  );
}

/* ================================================================ */
/* ChompShark — surfaces below the snapped rope to eat losers         */
/* ================================================================ */
function ChompShark({
  cx, cy, outcome, eatenCount,
}: {
  cx: number; cy: number;
  outcome: "yes-lost" | "no-lost";
  eatenCount: number;
}) {
  // Same shark anatomy as JumpingShark — no more bargain-bin geometry.
  // Renders flipped if the LOSING side is YES (left side of arena) so the
  // shark always faces toward the losers.
  const facingLeft = outcome === "yes-lost";
  // Real-shark blue — was oxblood/peach which read as a purple-pink fish.
  const fill = "color-mix(in oklch, var(--color-aureus-ink) 88%, var(--color-pastel-sky))";
  const belly = "color-mix(in oklch, var(--color-pastel-sky) 55%, var(--color-bone))";

  return (
    <g style={{ animation: "chomp-rise 1.4s var(--ease-out-quart) forwards" }}>
      {/* Wake spray under the shark */}
      <ellipse cx={cx} cy={cy + 24} rx="48" ry="5"
        fill="color-mix(in oklch, var(--color-pastel-sky) 70%, white)" opacity="0.55" />
      <path d={`M ${cx - 30} ${cy + 22} Q ${cx - 22} ${cy + 12} ${cx - 14} ${cy + 18}`}
        stroke="color-mix(in oklch, var(--color-pastel-sky) 70%, white)"
        strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d={`M ${cx + 30} ${cy + 22} Q ${cx + 22} ${cy + 12} ${cx + 14} ${cy + 18}`}
        stroke="color-mix(in oklch, var(--color-pastel-sky) 70%, white)"
        strokeWidth="2" fill="none" strokeLinecap="round" />

      <g
        transform={`translate(${cx}, ${cy})`}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      >
        <g transform={facingLeft ? "scale(-1, 1)" : undefined}>
          {/* Drop shadow under the shark */}
          <ellipse cx="2" cy="22" rx="40" ry="3" fill="black" opacity="0.2" />

          {/* Tail fluke at back */}
          <path d="M -42 0 L -60 -18 L -54 0 L -60 18 Z" fill={fill} />

          {/* Torpedo body */}
          <path
            d="M -42 0 Q -32 -26 8 -22 Q 32 -18 42 0 Q 32 18 8 22 Q -32 26 -42 0 Z"
            fill={fill}
          />
          {/* Belly contrast */}
          <path
            d="M -32 6 Q -10 24 26 20 Q 36 12 36 6 Q 12 16 -26 14 Z"
            fill={belly}
          />

          {/* Dorsal fin */}
          <path d="M -8 -22 L 0 -40 L 8 -22 Z" fill={fill} />
          {/* Pectoral fin */}
          <path d="M 4 14 L 18 28 L 22 16 Z" fill={fill} />

          {/* Gills */}
          <path d="M -14 -6 L -12 6" stroke="black" strokeWidth="1" opacity="0.35" />
          <path d="M -9 -6 L -7 6" stroke="black" strokeWidth="1" opacity="0.35" />
          <path d="M -4 -6 L -2 6" stroke="black" strokeWidth="1" opacity="0.3" />

          {/* Eye — angry */}
          <circle cx="24" cy="-7" r="4" fill="white" />
          <circle cx="25" cy="-6" r="2.2" fill="#1A1814" />
          <circle cx="26" cy="-7" r="0.8" fill="white" />
          {/* Angry eyebrow */}
          <path d="M 20 -12 L 28 -9" stroke="#1A1814" strokeWidth="1.6" strokeLinecap="round" />

          {/* Wide open mouth full of teeth */}
          <path d="M 24 0 L 42 -4 L 42 12 L 24 10 Z" fill="#3a0d10" />
          {/* Top jaw teeth (sharp triangles) */}
          <path d="M 25 0 L 26 4 L 27 0 L 28 4 L 29 0 L 30 4 L 31 0 L 32 4 L 33 0 L 34 4 L 35 0 L 36 4 L 37 0 L 38 4 L 39 0 L 40 4 L 41 0 Z" fill="white" />
          {/* Bottom jaw teeth */}
          <path d="M 25 10 L 26 6 L 27 10 L 28 6 L 29 10 L 30 6 L 31 10 L 32 6 L 33 10 L 34 6 L 35 10 L 36 6 L 37 10 L 38 6 L 39 10 L 40 6 L 41 10 Z" fill="white" />
          {/* Blood drip */}
          <circle cx="36" cy="14" r="1.6" fill="var(--color-tessera-oxblood)" />
          <circle cx="38" cy="16" r="1" fill="var(--color-tessera-oxblood)" opacity="0.7" />
        </g>
      </g>

      {/* Label — "N eaten" instead of the confusing "NO eaten" */}
      <g transform={`translate(${cx}, ${cy - 48})`}>
        <rect x="-44" y="-12" width="88" height="22" rx="11"
          fill="color-mix(in oklch, var(--color-tessera-oxblood) 18%, var(--color-raised))"
          stroke="var(--color-tessera-oxblood)" strokeWidth="1.4" />
        <text x="0" y="4" textAnchor="middle"
          fontFamily="ui-monospace" fontWeight="700" fontSize="11" letterSpacing="2"
          fill="var(--color-tessera-oxblood)">
          {eatenCount > 0
            ? `${eatenCount} eaten`
            : "no losers"}
        </text>
      </g>
    </g>
  );
}

/* ================================================================ */
/* RopeWalker — a crab clinging to a vertical rope                    */
/* ================================================================ */
function RopeWalker({
  walker, ropeCount, state, ropePriceLevel = 0.5,
}: {
  walker: Walker;
  ropeCount: number;
  state: "hanging" | "safe" | "doomed";
  /** Same priceLevel passed to VerticalRope. Lets each walker ride the
   *  rope's CURRENT length so they stay attached as the rope retracts /
   *  extends with the live price. Default 0.5 = neutral. */
  ropePriceLevel?: number;
}) {
  // Compute X position based on outcome + rope index.
  // YES ropes are at x=280, 330, 380... (left center). NO ropes are at x=720, 670, 620...
  const ropeX = walker.outcome === 1
    ? 280 + walker.ropeIndex * 50
    : 720 - walker.ropeIndex * 50;
  // % of viewBox 1000
  const xPct = (ropeX / 1000) * 100;

  // Rope spans viewBox y=106 → dynBottom. Match VerticalRope's math so the
  // walker sits ON the rope rather than at a static slot %. fullLen=264,
  // minLen=0.45*fullLen, dynBottom = topY + minLen + (1-price)*(fullLen-minLen).
  const ROPE_TOP_VB = 106;
  const ROPE_FULL_VB = 264;
  const ropeMinLen = ROPE_FULL_VB * 0.45;
  const dynLenVb = ropeMinLen + (1 - ropePriceLevel) * (ROPE_FULL_VB - ropeMinLen);
  const dynBottomVb = ROPE_TOP_VB + dynLenVb;
  // Convert to vb% (viewBox is 1000×600 → y% = vbY / 6).
  const ropeTopPct = ROPE_TOP_VB / 6;            // 17.66%
  const ropeBottomPct = dynBottomVb / 6;
  // Distribute up-to-3 crabs evenly along the rope. With MAX_PER_ROPE=3 the
  // fractions are 0.25, 0.5, 0.75 — first crab high, third crab at the tip.
  const slotFrac = (walker.slot + 1) / (MAX_PER_ROPE + 1);
  const yPct = ropeTopPct + (ropeBottomPct - ropeTopPct) * slotFrac;

  if (state === "safe") {
    // Move to FINISH bridge (right side); spread vertically across 3 slots
    const finishX = 88 + (walker.slot % 3) * 1.5; // % position around finish bridge
    const finishY = 50 - (walker.slot % 3) * 2;
    return (
      <div
        title={`${walker.label} · ${formatUsdc(walker.vol)} USDC · ${walker.count} bet${walker.count === 1 ? "" : "s"}`}
        style={{
          position: "absolute",
          left: `${finishX}%`,
          top: `${finishY}%`,
          transform: "translate(-50%, 0)",
          animation: "walker-cheer 1.4s ease-in-out infinite",
          animationDelay: `${walker.slot * 0.2}s`,
          zIndex: 5,
          cursor: "pointer",
          transition: "left 1.5s ease, top 1.5s ease",
        }}
        onClick={() => { if (typeof window !== "undefined") window.location.href = `/agents/${walker.addr}`; }}
      >
        <div style={{ position: "relative", padding: 3 }}>
          <AgentSprite name={walker.sprite} size={36} mood="happy" />
          <MyHatOverlay targetAddress={walker.addr} size={36} />
        </div>
      </div>
    );
  }

  if (state === "doomed") {
    return (
      <div
        title={`${walker.label} · eaten`}
        style={{
          position: "absolute",
          left: `${xPct}%`,
          top: `${yPct}%`,
          transform: "translate(-50%, 0)",
          animation: `walker-fall 1.8s var(--ease-out-quart) ${walker.slot * 0.18}s forwards`,
          zIndex: 2,
        }}
      >
        <div style={{ position: "relative", padding: 3 }}>
          <AgentSprite name={walker.sprite} size={36} mood="sad" />
          <MyHatOverlay targetAddress={walker.addr} size={36} />
        </div>
      </div>
    );
  }

  // hanging — clinging to the vertical rope. Fresh walkers (just placed a
  // bet via SSE) get a walk-in animation that slides them from the START
  // bridge over to the rope, with a little hop on landing. Older bets
  // render straight to their hanging position.
  const isFresh = walker.freshAt > 0 && Date.now() - walker.freshAt < 4500;
  // START bridge sits at ~14% of the viewBox on the LEFT for both outcomes.
  // dx is therefore always negative — walkers slide in from the left.
  const walkInDx = -Math.max(40, (xPct - 14) * 8);

  return (
    <div
      title={`${walker.label} · ${formatUsdc(walker.vol)} USDC · ${walker.count} bet${walker.count === 1 ? "" : "s"}`}
      style={{
        position: "absolute",
        left: `${xPct}%`,
        top: `${yPct}%`,
        zIndex: 3,
        cursor: "pointer",
        transition: "top 900ms cubic-bezier(.22,.61,.36,1)",
      }}
      onClick={() => { if (typeof window !== "undefined") window.location.href = `/agents/${walker.addr}`; }}
    >
      <div
        style={{
          transform: "translate(-50%, 0)",
          animation: isFresh
            ? `walker-walk-in 1.4s var(--ease-out-quart, ease-out) both`
            : undefined,
          // CSS variables let the keyframe read per-walker walk distance.
          ["--walk-dx" as string]: `${walkInDx}px`,
        }}
      >
        <div
          style={{
            transformOrigin: "50% 0%",
            animation: `hang-sway 3.5s ease-in-out infinite`,
            animationDelay: isFresh ? "1.5s" : `${walker.slot * 0.3}s`,
          }}
        >
          {/* Tiny grip lines — claws reaching up to rope */}
          <svg width="36" height="6" viewBox="0 0 36 6" aria-hidden style={{ display: "block", marginBottom: -2 }}>
            <line x1="14" y1="6" x2="16" y2="0" stroke="color-mix(in oklch, var(--color-bone) 70%, transparent)" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="22" y1="6" x2="20" y2="0" stroke="color-mix(in oklch, var(--color-bone) 70%, transparent)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div style={{ position: "relative", padding: 3 }}>
            <AgentSprite name={walker.sprite} size={32} mood={isFresh ? "happy" : "idle"} />
            <MyHatOverlay targetAddress={walker.addr} size={32} />
          </div>
          {walker.count > 1 && (
            <span className="mono" style={{
              position: "absolute", top: 4, right: -4,
              background: "var(--color-honos-gold)", color: "var(--color-on-gold)",
              fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 999,
            }}>×{walker.count}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function deterministicSprite(addr: string): AgentName {
  const names: AgentName[] = ["oracle", "sage", "hermes", "augur", "mirror"];
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) | 0;
  return names[Math.abs(h) % names.length]!;
}
