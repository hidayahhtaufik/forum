"use client";

/// SharkPool — FORUM's signature market visualization. Each agent that bet on a
/// market is rendered as a pixel sprite clinging to a rope. Left rope = NO, right
/// rope = YES. Below the water line: shark fins circle, threatening losing
/// agents. When the market resolves, the losing rope snaps, those agents fall
/// into the water, and a shark animates a "chomp" pass; winning agents stay safe
/// at the top and emit a happy emote. Pure SVG + CSS — no canvas, no extra deps.
///
/// Design choices:
/// - Sprites are reused from <AgentSprite /> so palette and identity are coherent
///   with everywhere else they appear in the app.
/// - Layout is a single CSS-positioned overlay; the SVG handles backdrop only
///   (sky/water/ropes/sharks). This lets us hover/click each agent without
///   wrestling SVG `foreignObject` quirks.
/// - State is purely derived from `market.phase` + resolution outcome. No effects
///   needed; SSR-friendly.

import type { Bet, Market } from "@/lib/api";
import { knownAgent } from "@/lib/api";
import { spriteForAddress, type AgentName } from "@/lib/agent-sprites";
import { AgentSprite } from "./AgentSprite";
import { formatUsdc } from "@/lib/format";

type Props = {
  market: Market;
  bets: Bet[];
  /** From /markets/:id/resolution. 0=NO won, 1=YES won, 2=invalid/refund. */
  winningOutcome?: 0 | 1 | 2 | null;
};

type Cling = {
  addr: string;
  sprite: AgentName;
  label: string;
  vol: bigint;
  count: number;
  /** Vertical slot 0..n-1 along the rope (0 = highest, near the cleat). */
  slot: number;
  lastTx: string;
};

export function SharkPool({ market, bets, winningOutcome }: Props) {
  const resolved = market.phase === 2 && winningOutcome !== null && winningOutcome !== undefined;
  const yesWins = resolved && winningOutcome === 1;
  const noWins = resolved && winningOutcome === 0;

  // Group by (address, outcome) → one sprite per cell, stacked count
  const yesByAddr = new Map<string, { vol: bigint; count: number; lastTx: string; ts: number }>();
  const noByAddr = new Map<string, { vol: bigint; count: number; lastTx: string; ts: number }>();
  for (const b of bets) {
    const addr = b.agentAddress.toLowerCase();
    const v = BigInt(b.costUsdc) + BigInt(b.feeUsdc);
    const m = b.outcome === 1 ? yesByAddr : noByAddr;
    const cur = m.get(addr) ?? { vol: 0n, count: 0, lastTx: "", ts: 0 };
    cur.vol += v;
    cur.count += 1;
    if (b.createdAt > cur.ts) {
      cur.ts = b.createdAt;
      cur.lastTx = b.marketTxHash;
    }
    m.set(addr, cur);
  }

  // Skip if neither side has any agents — empty pool is sad.
  const yesEntries = Array.from(yesByAddr.entries()).sort((a, b) => (b[1].vol > a[1].vol ? 1 : -1));
  const noEntries = Array.from(noByAddr.entries()).sort((a, b) => (b[1].vol > a[1].vol ? 1 : -1));
  const empty = yesEntries.length + noEntries.length === 0;

  const yesClings: Cling[] = yesEntries.slice(0, 4).map(([addr, v], slot) => {
    const sprite = spriteForAddress(addr) ?? deterministicSprite(addr);
    const known = knownAgent(addr);
    return {
      addr,
      sprite,
      label: known?.label ?? `${addr.slice(0, 6)}…`,
      vol: v.vol,
      count: v.count,
      slot,
      lastTx: v.lastTx,
    };
  });
  const noClings: Cling[] = noEntries.slice(0, 4).map(([addr, v], slot) => {
    const sprite = spriteForAddress(addr) ?? deterministicSprite(addr);
    const known = knownAgent(addr);
    return {
      addr,
      sprite,
      label: known?.label ?? `${addr.slice(0, 6)}…`,
      vol: v.vol,
      count: v.count,
      slot,
      lastTx: v.lastTx,
    };
  });

  // YES rope on the right (column 2), NO rope on the left (column 1).
  // For positioning we use percentages so the SVG and overlay scale together.
  const ropeXNo = 26; // %
  const ropeXYes = 74; // %
  const cleatY = 6;   // %
  const waterLine = 78; // %

  // Per-slot vertical distribution along the rope (% from top).
  const slotY = (slot: number) => 18 + slot * 13;

  return (
    <section
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 780,
        margin: "0 auto",
        aspectRatio: "1.4 / 1",
        borderRadius: 20,
        overflow: "hidden",
        border: "1px solid var(--color-border)",
        background:
          "linear-gradient(180deg, color-mix(in oklch, var(--color-pastel-sky) 35%, var(--color-raised)) 0%, var(--color-raised) 60%, color-mix(in oklch, var(--color-aureus-ink) 18%, var(--color-raised)) 78%, color-mix(in oklch, var(--color-aureus-ink) 30%, var(--color-bg)) 100%)",
        boxShadow: "0 6px 22px color-mix(in oklch, var(--color-bone) 8%, transparent)",
      }}
      aria-label={`Shark pool for market ${market.id.slice(0, 10)}`}
    >
      {/* SVG backdrop: cleats, ropes, water, sharks */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        aria-hidden
      >
        <defs>
          <linearGradient id="rope-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--color-honos-gold) 60%, var(--color-bone))" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--color-honos-gold) 30%, var(--color-bone-dim))" />
          </linearGradient>
          <linearGradient id="water-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--color-aureus-ink) 35%, var(--color-raised))" stopOpacity="0.95" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--color-aureus-ink) 55%, black)" stopOpacity="0.85" />
          </linearGradient>
        </defs>

        {/* Cleats (rope anchors at the top) */}
        <Cleat cx={ropeXNo} cy={cleatY} />
        <Cleat cx={ropeXYes} cy={cleatY} />

        {/* Ropes — straight line + intact OR snapped state.
            On snapped side the rope only goes from cleat to slot-0 + frays. */}
        <Rope
          x={ropeXNo}
          fromY={cleatY}
          toY={waterLine - 2}
          snapped={yesWins}
          sway="-left"
        />
        <Rope
          x={ropeXYes}
          fromY={cleatY}
          toY={waterLine - 2}
          snapped={noWins}
          sway="-right"
        />

        {/* Water surface — gentle wave path, sits at waterLine */}
        <path
          d={`M0,${waterLine} Q 25,${waterLine - 2} 50,${waterLine} T 100,${waterLine} L100,100 L0,100 Z`}
          fill="url(#water-fill)"
        />
        {/* Faint highlight ripple */}
        <path
          d={`M0,${waterLine + 0.6} Q 30,${waterLine - 1.2} 60,${waterLine + 0.6} T 100,${waterLine + 0.6}`}
          stroke="color-mix(in oklch, var(--color-pastel-sky) 70%, transparent)"
          strokeWidth="0.3"
          fill="none"
          opacity="0.8"
        />

        {/* Shark fins — 3 of them, drifting at different speeds. Each fin is a
            triangle + a curved tail wake. */}
        <Shark depth={waterLine + 5} startX={20} duration={9} delay={0} />
        <Shark depth={waterLine + 7} startX={55} duration={13} delay={3.5} />
        <Shark depth={waterLine + 4} startX={85} duration={11} delay={7} />

        {/* If a side lost, draw a shark chomp animation right under that rope's
            slot-1 — represents the moment of doom. */}
        {yesWins && (
          <ChompShark cx={ropeXNo} cy={waterLine + 6} />
        )}
        {noWins && (
          <ChompShark cx={ropeXYes} cy={waterLine + 6} />
        )}
      </svg>

      {/* Heading badges */}
      <SideBadge x={ropeXNo} label="NO" winner={noWins} loser={yesWins} />
      <SideBadge x={ropeXYes} label="YES" winner={yesWins} loser={noWins} />

      {/* Agent sprites — overlay positioned absolutely so we can reuse the
          existing pixel-sprite component with hover handlers + tooltips. */}
      {noClings.map((c) => (
        <Cling
          key={`no-${c.addr}`}
          cling={c}
          xPct={ropeXNo}
          yPct={slotY(c.slot)}
          waterY={waterLine}
          state={
            noWins ? "safe" : yesWins ? "doomed" : "idle"
          }
        />
      ))}
      {yesClings.map((c) => (
        <Cling
          key={`yes-${c.addr}`}
          cling={c}
          xPct={ropeXYes}
          yPct={slotY(c.slot)}
          waterY={waterLine}
          state={
            yesWins ? "safe" : noWins ? "doomed" : "idle"
          }
        />
      ))}

      {empty && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "var(--color-bone-dim)",
            fontSize: "var(--text-xs)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
          className="mono"
        >
          The pool is empty — no agents yet
        </div>
      )}

      {/* Resolution headline ribbon */}
      {resolved && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "5px 12px",
            borderRadius: 999,
            background: yesWins
              ? "color-mix(in oklch, var(--color-outcome-yes) 18%, var(--color-raised))"
              : noWins
                ? "color-mix(in oklch, var(--color-outcome-no) 18%, var(--color-raised))"
                : "var(--color-raised)",
            border: "1px solid var(--color-border)",
            color: yesWins
              ? "var(--color-outcome-yes)"
              : noWins
                ? "var(--color-outcome-no)"
                : "var(--color-bone-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-2xs)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            fontWeight: 600,
            zIndex: 4,
          }}
        >
          {yesWins ? "YES survived" : noWins ? "NO survived" : "INVALID — all safe"}
        </div>
      )}

      <style>{`
        @keyframes pool-rope-sway {
          0%, 100% { transform: rotate(-1deg); }
          50%      { transform: rotate(1deg); }
        }
        @keyframes pool-cling-bob {
          0%, 100% { transform: translate(-50%, -50%) rotate(-2deg); }
          50%      { transform: translate(-50%, -50%) rotate(2deg); }
        }
        @keyframes pool-shark-swim {
          0%   { transform: translateX(-20%); }
          100% { transform: translateX(120%); }
        }
        @keyframes pool-chomp {
          0%, 100% { transform: translateY(0) rotate(0); }
          40%      { transform: translateY(-8px) rotate(-10deg); }
          60%      { transform: translateY(-8px) rotate(10deg); }
        }
        @keyframes pool-fall {
          0%   { transform: translate(-50%, -50%) rotate(0); opacity: 1; }
          60%  { transform: translate(-50%, 60%) rotate(30deg); opacity: 1; }
          100% { transform: translate(-50%, 110%) rotate(60deg); opacity: 0.4; }
        }
        @keyframes pool-cheer {
          0%, 100% { transform: translate(-50%, -50%) translateY(0); }
          50%      { transform: translate(-50%, -50%) translateY(-6px); }
        }
        @keyframes pool-water-shimmer {
          0%, 100% { opacity: 0.6; }
          50%      { opacity: 1; }
        }
      `}</style>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Sub-pieces                                                       */
/* ---------------------------------------------------------------- */

function Cleat({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <rect
        x={cx - 4}
        y={cy - 1}
        width={8}
        height={2.2}
        rx={0.6}
        fill="color-mix(in oklch, var(--color-bone) 90%, transparent)"
      />
      <circle cx={cx - 3} cy={cy} r={0.5} fill="var(--color-honos-gold)" />
      <circle cx={cx + 3} cy={cy} r={0.5} fill="var(--color-honos-gold)" />
    </g>
  );
}

function Rope({
  x,
  fromY,
  toY,
  snapped,
  sway,
}: {
  x: number;
  fromY: number;
  toY: number;
  snapped: boolean;
  sway: "-left" | "-right";
}) {
  // Snapped: rope only goes to ~25% of the distance, then frays.
  const effectiveTo = snapped ? fromY + (toY - fromY) * 0.18 : toY;
  return (
    <g
      style={{
        transformOrigin: `${x}% ${fromY}%`,
        animation: snapped ? undefined : `pool-rope-sway 4.5s ease-in-out infinite`,
        animationDelay: sway === "-left" ? "0s" : "1.2s",
      }}
    >
      <line
        x1={x}
        y1={fromY + 1}
        x2={x}
        y2={effectiveTo}
        stroke="url(#rope-fill)"
        strokeWidth={0.9}
        strokeLinecap="round"
      />
      {snapped && (
        <>
          {/* Frayed ends */}
          <line x1={x - 0.6} y1={effectiveTo} x2={x - 1.4} y2={effectiveTo + 1.3} stroke="url(#rope-fill)" strokeWidth={0.4} />
          <line x1={x + 0.4} y1={effectiveTo} x2={x + 1.2} y2={effectiveTo + 1} stroke="url(#rope-fill)" strokeWidth={0.4} />
          <line x1={x} y1={effectiveTo} x2={x + 0.2} y2={effectiveTo + 1.6} stroke="url(#rope-fill)" strokeWidth={0.4} />
        </>
      )}
    </g>
  );
}

function Shark({
  depth,
  startX,
  duration,
  delay,
}: {
  depth: number;
  startX: number;
  duration: number;
  delay: number;
}) {
  // A fin (triangle) + a faint wake behind. We translate the whole group via
  // CSS animation so the fin drifts across the surface.
  return (
    <g
      style={{
        transformOrigin: "0 0",
        animation: `pool-shark-swim ${duration}s linear infinite`,
        animationDelay: `${delay}s`,
        opacity: 0.78,
      }}
    >
      {/* Wake — small back-and-forth ripples */}
      <path
        d={`M${startX - 4},${depth + 0.4} q 1,-0.6 2,0 q 1,0.6 2,0`}
        stroke="color-mix(in oklch, var(--color-pastel-sky) 70%, transparent)"
        strokeWidth={0.25}
        fill="none"
      />
      {/* Fin — sharp triangle */}
      <path
        d={`M${startX},${depth} L${startX + 1.6},${depth - 2.6} L${startX + 3.2},${depth} Z`}
        fill="color-mix(in oklch, var(--color-bone) 70%, var(--color-aureus-ink))"
      />
      {/* Tail tip — peeking up further back */}
      <path
        d={`M${startX - 2.4},${depth + 0.1} L${startX - 1.4},${depth - 1.4} L${startX - 0.6},${depth + 0.1} Z`}
        fill="color-mix(in oklch, var(--color-bone) 55%, var(--color-aureus-ink))"
        opacity={0.7}
      />
    </g>
  );
}

function ChompShark({ cx, cy }: { cx: number; cy: number }) {
  // Larger shark surfacing right under the snapped rope. Animates a chomp.
  return (
    <g
      style={{
        transformOrigin: `${cx}% ${cy}%`,
        animation: `pool-chomp 1.8s ease-in-out infinite`,
      }}
    >
      {/* Body just under water */}
      <ellipse
        cx={cx}
        cy={cy + 2}
        rx={6}
        ry={1.6}
        fill="color-mix(in oklch, var(--color-bone) 80%, var(--color-aureus-ink))"
      />
      {/* Big fin */}
      <path
        d={`M${cx - 1.8},${cy + 2} L${cx + 0.4},${cy - 3} L${cx + 2.4},${cy + 2} Z`}
        fill="color-mix(in oklch, var(--color-bone) 85%, var(--color-aureus-ink))"
      />
      {/* Open mouth + teeth */}
      <path
        d={`M${cx + 3},${cy + 1.6} q 1.5,-1.4 3,0 l -3,0 z`}
        fill="color-mix(in oklch, var(--color-tessera-oxblood) 70%, var(--color-bone))"
      />
      <path
        d={`M${cx + 3.4},${cy + 1.6} l 0.3,-0.6 l 0.3,0.6 l 0.3,-0.6 l 0.3,0.6 l 0.3,-0.6 l 0.3,0.6 z`}
        fill="white"
        opacity={0.85}
      />
      {/* Eye */}
      <circle cx={cx - 1.2} cy={cy + 1.5} r={0.4} fill="white" />
      <circle cx={cx - 1.2} cy={cy + 1.5} r={0.2} fill="black" />
    </g>
  );
}

function SideBadge({
  x,
  label,
  winner,
  loser,
}: {
  x: number;
  label: "YES" | "NO";
  winner: boolean;
  loser: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: "1.5%",
        transform: "translateX(-50%)",
        padding: "3px 10px",
        borderRadius: 999,
        background: winner
          ? "color-mix(in oklch, var(--color-outcome-yes) 28%, var(--color-raised))"
          : loser
            ? "color-mix(in oklch, var(--color-outcome-no) 24%, var(--color-raised))"
            : "var(--color-raised)",
        border: `1px solid ${winner ? "var(--color-outcome-yes)" : loser ? "var(--color-outcome-no)" : "var(--color-border)"}`,
        color: winner
          ? "var(--color-outcome-yes)"
          : loser
            ? "var(--color-outcome-no)"
            : "var(--color-bone)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-2xs)",
        letterSpacing: "0.14em",
        fontWeight: 700,
        zIndex: 3,
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {winner && " ✓"}
      {loser && " ✗"}
    </div>
  );
}

function Cling({
  cling,
  xPct,
  yPct,
  waterY,
  state,
}: {
  cling: Cling;
  xPct: number;
  yPct: number;
  waterY: number;
  state: "idle" | "safe" | "doomed";
}) {
  // doomed agents anchor to the rope's snap point, then animation drops them
  // into the water. Use a different baseline y when doomed so the start of the
  // fall is below the cleat.
  const baseY = state === "doomed" ? Math.max(yPct, 22) : yPct;
  const anim =
    state === "doomed"
      ? `pool-fall 2.2s var(--ease-out-quart) ${cling.slot * 0.25}s forwards`
      : state === "safe"
        ? `pool-cheer 2s ease-in-out infinite ${cling.slot * 0.3}s`
        : `pool-cling-bob 5s ease-in-out infinite ${cling.slot * 0.4}s`;

  return (
    <div
      title={`${cling.label} · ${formatUsdc(cling.vol)} USDC · ${cling.count} bet${cling.count === 1 ? "" : "s"}`}
      style={{
        position: "absolute",
        left: `${xPct}%`,
        top: `${baseY}%`,
        transform: "translate(-50%, -50%)",
        zIndex: state === "doomed" ? 1 : 2,
        animation: anim,
        cursor: "pointer",
      }}
      onClick={() => {
        // Navigate to the agent profile (intentional client-side via href href would be cleaner
        // but we're inside an SSR-safe rendered tree — use window.location for click).
        if (typeof window !== "undefined") {
          window.location.href = `/agents/${cling.addr}`;
        }
      }}
    >
      <div
        style={{
          padding: 4,
          borderRadius: 10,
          background:
            state === "safe"
              ? "color-mix(in oklch, var(--color-outcome-yes) 22%, var(--color-raised))"
              : state === "doomed"
                ? "color-mix(in oklch, var(--color-outcome-no) 22%, var(--color-raised))"
                : "var(--color-raised)",
          border: `1px solid ${state === "safe" ? "var(--color-outcome-yes)" : state === "doomed" ? "var(--color-outcome-no)" : "var(--color-border)"}`,
          boxShadow: state === "doomed"
            ? "0 4px 12px color-mix(in oklch, var(--color-outcome-no) 40%, transparent)"
            : "0 2px 6px color-mix(in oklch, var(--color-bone) 12%, transparent)",
          transition: "transform 200ms var(--ease-out-quart)",
        }}
      >
        <AgentSprite
          name={cling.sprite}
          size={42}
          mood={state === "safe" ? "happy" : state === "doomed" ? "sad" : "idle"}
        />
      </div>
      {/* Bet count badge if >1 */}
      {cling.count > 1 && (
        <span
          className="mono"
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            background: "var(--color-honos-gold)",
            color: "var(--color-on-gold)",
            fontSize: 9,
            fontWeight: 700,
            padding: "1px 5px",
            borderRadius: 999,
            border: "1px solid var(--color-on-gold)",
          }}
        >
          ×{cling.count}
        </span>
      )}
      {/* Label underneath (visible always but small) */}
      <span
        className="mono"
        style={{
          position: "absolute",
          top: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginTop: 4,
          fontSize: 9,
          letterSpacing: "0.06em",
          color: "var(--color-bone-dim)",
          whiteSpace: "nowrap",
          textTransform: "uppercase",
          pointerEvents: "none",
        }}
      >
        {cling.label}
      </span>
    </div>
  );
}

/// Deterministic fallback sprite when an address isn't a known reference agent.
function deterministicSprite(addr: string): AgentName {
  const names: AgentName[] = ["oracle", "sage", "hermes", "augur", "mirror"];
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) | 0;
  return names[Math.abs(h) % names.length]!;
}
