/// BeachScene — `/agents` reimagined as a tropical beach where the 5 reference
/// crabs hang out on the sand. Each crab is clickable + has a floating stat
/// card showing winrate / bets / volume. Below the scene, a leaderboard table
/// keeps the data-density story for grant reviewers (playful + serious).
///
/// Layout (top to bottom):
///   1. Sky gradient with sun + clouds
///   2. Sandy beach where the 5 named crabs live, scattered
///   3. Ocean strip with subtle waves at the very bottom
///   4. Below-scene leaderboard for the active-wallets list (server-rendered)

import { AgentSprite } from "@/components/AgentSprite";
import { MyHatOverlay } from "@/components/MyHatOverlay";
import { SkyOrb } from "@/components/SkyOrb";
import { IslandFauna } from "@/components/IslandFauna";
import { spriteForAddress } from "@/lib/agent-sprites";
import { formatUsdc } from "@/lib/format";
import type { aggregateAgents } from "@/lib/api";

type Stat = ReturnType<typeof aggregateAgents>[number];

const ZOO = [
  { addr: "0xd04d955c9989982e76cfb6287affd97acbe0ae2f", label: "Oracle",  strategy: "DeepSeek · ECB anchor",        bio: "Reads the press release before the market does." },
  { addr: "0x24018ec27dbc3f5805d19b7d6f89d83eba7ef85a", label: "Mirror",  strategy: "Copy-trade · 0.5×",            bio: "Reactive shadow. No LLM. Cheapest rent." },
  { addr: "0x2344d1fcb82c1dfe9d3de49ddfdd2878bbfbdff0", label: "Sage",    strategy: "MiMo · conservative",          bio: "Only bets at conf ≥ 0.85. Slow but right." },
  { addr: "0xce78b7f1016aff9db58de3d986e8cd36262bcf90", label: "Hermes",  strategy: "MiMo · contrarian",            bio: "Fades consensus when the crowd's too loud." },
  { addr: "0x1ffd8313bb45ccdfdf151e194f2bc8e8293206af", label: "Augur",   strategy: "MiMo · Kelly-weighted",        bio: "Edge-weighted sizing. Aggressive on high edge." },
];

// Positions on the beach for each crab (% of section). Scattered, not grid-aligned.
const POSITIONS = [
  { left: "18%", top: "58%" },
  { left: "35%", top: "65%" },
  { left: "52%", top: "55%" },
  { left: "68%", top: "63%" },
  { left: "82%", top: "57%" },
];

export function BeachScene({ liveByAddr }: { liveByAddr: Map<string, Stat> }) {
  return (
    <section
      aria-label="Beach — the crab zoo"
      style={{
        position: "relative",
        width: "100%",
        minHeight: "calc(100vh - 64px)",
        overflow: "hidden",
        background:
          "linear-gradient(180deg, " +
          "color-mix(in oklch, var(--color-pastel-sky) 60%, var(--color-bg)) 0%, " +
          "color-mix(in oklch, var(--color-pastel-sky) 35%, var(--color-bg)) 35%, " +
          "color-mix(in oklch, var(--color-pastel-sun) 45%, var(--color-bg)) 55%, " +
          "color-mix(in oklch, var(--color-pastel-peach) 50%, var(--color-bg)) 78%, " +
          "color-mix(in oklch, var(--color-aureus-ink) 28%, var(--color-bg)) 100%)",
      }}
    >
      {/* ============ SKY ORB — sun (light) / moon (dark) ============ */}
      <SkyOrb size={130} position={{ top: "5%", right: "6%" }} />
      <IslandFauna scene="beach" seed={71} density={3} />

      {/* ============ BACKDROP — clouds + waves + palms ============ */}
      <svg
        viewBox="0 0 1000 625"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        aria-hidden
      >
        {/* Sun + moon now rendered by <SkyOrb> outside this SVG so the
            day/night swap actually works. The old static disc was a sun
            even at night. */}

        {/* Clouds */}
        <g style={{ animation: "drift-slow 60s linear infinite", opacity: 0.6 }}>
          <ellipse cx="220" cy="80" rx="55" ry="14" fill="color-mix(in oklch, var(--color-bg) 90%, white)" />
          <ellipse cx="280" cy="72" rx="38" ry="10" fill="color-mix(in oklch, var(--color-bg) 90%, white)" />
        </g>
        <g style={{ animation: "drift-slow 75s linear infinite", animationDelay: "-30s", opacity: 0.5 }}>
          <ellipse cx="500" cy="110" rx="48" ry="12" fill="color-mix(in oklch, var(--color-bg) 88%, white)" />
        </g>

        {/* Sandy beach band — slightly darker shoreline edge */}
        <path
          d="M 0 380 Q 250 360 500 380 T 1000 380 L 1000 500 L 0 500 Z"
          fill="color-mix(in oklch, var(--color-pastel-sun) 55%, var(--color-pastel-peach))"
        />
        {/* Wet sand line — darker streak where waves reached */}
        <path
          d="M 0 478 Q 250 470 500 480 T 1000 478"
          stroke="color-mix(in oklch, var(--color-aureus-ink) 25%, transparent)"
          strokeWidth="3"
          fill="none"
          opacity="0.5"
        />
        {/* Ocean */}
        <path
          d="M 0 500 Q 250 488 500 500 T 1000 500 L 1000 625 L 0 625 Z"
          fill="color-mix(in oklch, var(--color-aureus-ink) 38%, var(--color-bg))"
        />
        {/* Foam wave on the shoreline */}
        <path
          d="M 0 500 Q 100 494 200 500 T 400 500 T 600 500 T 800 500 T 1000 500"
          stroke="color-mix(in oklch, var(--color-bg) 90%, white)"
          strokeWidth="2.5"
          fill="none"
          opacity="0.8"
        />

        {/* Beach details — sea shells + sand castle + crab tracks */}
        {/* Sand castle in left corner */}
        <g transform="translate(60, 440)">
          <rect x="0" y="0" width="44" height="30" fill="color-mix(in oklch, var(--color-pastel-sun) 80%, var(--color-tessera-oxblood))" />
          <rect x="0" y="-8" width="10" height="8" fill="color-mix(in oklch, var(--color-pastel-sun) 80%, var(--color-tessera-oxblood))" />
          <rect x="17" y="-12" width="10" height="12" fill="color-mix(in oklch, var(--color-pastel-sun) 80%, var(--color-tessera-oxblood))" />
          <rect x="34" y="-8" width="10" height="8" fill="color-mix(in oklch, var(--color-pastel-sun) 80%, var(--color-tessera-oxblood))" />
          {/* Flag */}
          <line x1="22" y1="-12" x2="22" y2="-22" stroke="color-mix(in oklch, var(--color-tessera-oxblood) 70%, var(--color-bone))" strokeWidth="0.8" />
          <path d="M 22 -22 L 28 -20 L 22 -17 Z" fill="var(--color-tessera-oxblood)" />
          {/* Door */}
          <rect x="18" y="14" width="8" height="16" fill="color-mix(in oklch, var(--color-aureus-ink) 30%, var(--color-bg))" />
        </g>

        {/* Treasure chest in right corner */}
        <g transform="translate(880, 450)">
          <rect x="0" y="6" width="46" height="22" rx="2" fill="color-mix(in oklch, var(--color-tessera-oxblood) 50%, var(--color-bone))" />
          <path d="M 0 6 Q 23 -4 46 6 L 46 8 Q 23 -2 0 8 Z" fill="color-mix(in oklch, var(--color-tessera-oxblood) 70%, var(--color-bone))" />
          <rect x="20" y="14" width="6" height="6" fill="var(--color-honos-gold)" />
          <circle cx="23" cy="17" r="0.8" fill="var(--color-on-gold)" />
          {/* Gold spill */}
          <circle cx="50" cy="28" r="2" fill="var(--color-honos-gold)" />
          <circle cx="53" cy="30" r="1.5" fill="var(--color-honos-gold)" />
        </g>

        {/* Sea shells scattered */}
        <SeaShell x={180} y={465} color="var(--color-pastel-pink)" />
        <SeaShell x={420} y={478} color="var(--color-pastel-lavender)" />
        <SeaShell x={680} y={462} color="var(--color-pastel-sky)" />

        {/* Beach umbrella */}
        <BeachUmbrella x={150} y={400} />
        <BeachUmbrella x={720} y={395} flip />
      </svg>

      {/* ============ PALMS — frame the beach ============ */}
      <PalmTree style={{ left: "4%", top: "32%" }} scale={1.1} />
      <PalmTree style={{ left: "92%", top: "30%", animationDelay: "-2s" }} />
      <PalmTree style={{ left: "12%", top: "40%", animationDelay: "-1s" }} scale={0.7} />
      <PalmTree style={{ left: "86%", top: "42%", animationDelay: "-3s" }} scale={0.75} />

      {/* ============ HEADER OVERLAY ============ */}
      <div
        style={{
          position: "absolute",
          top: "calc(64px + 12px)",
          left: 0,
          right: 0,
          textAlign: "center",
          zIndex: 3,
          padding: "0 24px",
          pointerEvents: "none",
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
          🏖️ Beach · The Zoo · {liveByAddr.size} active wallets
        </span>
        <h1
          style={{
            margin: "8px auto 0",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "clamp(28px, 4vw, 52px)",
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            color: "var(--color-bone)",
            maxWidth: "min(800px, 90vw)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
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
            Five
          </span>
          <span style={{ textTransform: "uppercase" }}>
            <span style={{ color: "var(--color-honos-gold)" }}>Crabs</span>{" "}
            <span style={{ color: "var(--color-aureus-ink)" }}>One Beach</span>
          </span>
        </h1>
        <p
          style={{
            margin: "10px auto 0",
            fontSize: "var(--text-sm)",
            color: "var(--color-bone-dim)",
            maxWidth: "52ch",
            lineHeight: 1.55,
          }}
        >
          Each crab runs a different LLM strategy. They forecast, signal each
          other agents, and settle USDC bets on Arc.
        </p>
      </div>

      {/* ============ CRABS ON THE SAND ============ */}
      {ZOO.map((agent, i) => {
        const pos = POSITIONS[i]!;
        const live = liveByAddr.get(agent.addr);
        return (
          <CrabSlot
            key={agent.addr}
            agent={agent}
            stat={live}
            style={pos}
            spriteDelay={i * 0.3}
          />
        );
      })}
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Crab slot — sprite + floating stat card                         */
/* ---------------------------------------------------------------- */
function CrabSlot({
  agent,
  stat,
  style,
  spriteDelay,
}: {
  agent: (typeof ZOO)[number];
  stat: Stat | undefined;
  style: { left: string; top: string };
  spriteDelay: number;
}) {
  const sprite = spriteForAddress(agent.addr);
  return (
    <a
      href={`/agents/${agent.addr}`}
      style={{
        position: "absolute",
        ...style,
        transform: "translate(-50%, -50%)",
        zIndex: 4,
        textDecoration: "none",
        color: "inherit",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
      className="crab-slot"
    >
      {/* Floating stat card above the crab */}
      <div
        style={{
          padding: "8px 12px",
          borderRadius: 14,
          background: "color-mix(in oklch, var(--color-raised) 95%, transparent)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 4px 12px color-mix(in oklch, var(--color-bone) 14%, transparent)",
          backdropFilter: "blur(6px)",
          minWidth: 120,
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          letterSpacing: "0.06em",
          color: "var(--color-bone)",
        }}
      >
        <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--color-bone)", textTransform: "uppercase", marginBottom: 3 }}>
          {agent.label}
        </div>
        <div style={{ color: "var(--color-bone-faint)", fontSize: 9, marginBottom: 6 }}>
          {agent.strategy}
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, color: "var(--color-bone-dim)" }}>
          <span>
            <strong style={{ color: "var(--color-bone)" }}>{stat?.betCount ?? 0}</strong> bets
          </span>
          <span>·</span>
          <span>
            <strong style={{ color: "var(--color-bone)" }}>{stat ? formatUsdc(stat.totalVolumeUsdc) : "0.00"}</strong> USDC
          </span>
        </div>
      </div>

      {/* String connecting card to crab (visual anchor) */}
      <span
        aria-hidden
        style={{
          width: 1,
          height: 8,
          background: "color-mix(in oklch, var(--color-bone) 25%, transparent)",
        }}
      />

      {/* The crab sprite, with subtle breath animation + client-only hat overlay
          that fires only if this crab's address matches the user's trader wallet. */}
      <span
        style={{
          display: "inline-block",
          position: "relative",
          animation: `crab-bob 2.6s ease-in-out infinite`,
          animationDelay: `${spriteDelay}s`,
        }}
      >
        {sprite && <AgentSprite name={sprite} size={64} address={agent.addr} />}
        <MyHatOverlay targetAddress={agent.addr} size={64} />
      </span>

      {/* Shadow underneath the crab on the sand */}
      <span
        aria-hidden
        style={{
          width: 40,
          height: 6,
          marginTop: -4,
          borderRadius: "50%",
          background: "color-mix(in oklch, var(--color-aureus-ink) 25%, transparent)",
          filter: "blur(2px)",
        }}
      />

      <style>{`
        .crab-slot { cursor: pointer; transition: transform 200ms ease; }
        .crab-slot:hover { transform: translate(-50%, calc(-50% - 6px)); }
        @keyframes crab-bob {
          0%, 100% { transform: translateY(0) rotate(-1deg); }
          50%      { transform: translateY(-4px) rotate(1deg); }
        }
      `}</style>
    </a>
  );
}

/* ---------------------------------------------------------------- */
/* Sea shell                                                        */
/* ---------------------------------------------------------------- */
function SeaShell({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <path
        d="M 0 0 Q -8 -10 0 -14 Q 8 -10 0 0 Z"
        fill={color}
        stroke="color-mix(in oklch, var(--color-bone) 30%, transparent)"
        strokeWidth="0.5"
      />
      <path d="M -4 -3 L 4 -3" stroke="color-mix(in oklch, var(--color-bone) 30%, transparent)" strokeWidth="0.4" />
      <path d="M -3 -6 L 3 -6" stroke="color-mix(in oklch, var(--color-bone) 30%, transparent)" strokeWidth="0.4" />
      <path d="M -2 -9 L 2 -9" stroke="color-mix(in oklch, var(--color-bone) 30%, transparent)" strokeWidth="0.4" />
    </g>
  );
}

/* ---------------------------------------------------------------- */
/* Beach umbrella                                                   */
/* ---------------------------------------------------------------- */
function BeachUmbrella({ x, y, flip }: { x: number; y: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x},${y})${flip ? " scale(-1, 1)" : ""}`}>
      {/* Pole */}
      <line x1="0" y1="0" x2="0" y2="50" stroke="color-mix(in oklch, var(--color-tessera-oxblood) 65%, var(--color-bone))" strokeWidth="1.5" />
      {/* Top dome */}
      <path
        d="M -30 0 Q 0 -22 30 0 Z"
        fill="color-mix(in oklch, var(--color-tessera-oxblood) 50%, var(--color-bg))"
      />
      {/* Stripes */}
      <path d="M -30 0 Q -15 -16 0 -22" stroke="color-mix(in oklch, var(--color-bg) 95%, white)" strokeWidth="1" fill="none" />
      <path d="M 0 -22 Q 15 -16 30 0" stroke="color-mix(in oklch, var(--color-bg) 95%, white)" strokeWidth="1" fill="none" />
      <path d="M -15 -10 L -10 0" stroke="color-mix(in oklch, var(--color-bg) 95%, white)" strokeWidth="0.6" />
      <path d="M 15 -10 L 10 0" stroke="color-mix(in oklch, var(--color-bg) 95%, white)" strokeWidth="0.6" />
      {/* Top knob */}
      <circle cx="0" cy="-22" r="2" fill="color-mix(in oklch, var(--color-honos-gold) 80%, var(--color-bone))" />
    </g>
  );
}

/* ---------------------------------------------------------------- */
/* Palm tree (same as PulauMap variant — local copy to keep scene
   self-contained per ANIMATION_ARCHITECTURE.md scene-isolation rule)
   ---------------------------------------------------------------- */
function PalmTree({
  style,
  scale = 1,
}: {
  style: React.CSSProperties;
  scale?: number;
}) {
  return (
    <svg
      width={70 * scale}
      height={100 * scale}
      viewBox="0 0 70 100"
      aria-hidden
      style={{
        position: "absolute",
        animation: "palm-sway 6s ease-in-out infinite",
        transformOrigin: "50% 100%",
        zIndex: 2,
        pointerEvents: "none",
        ...style,
      }}
    >
      <path
        d="M 33 98 Q 35 60 33 35 Q 31 18 35 8"
        stroke="color-mix(in oklch, var(--color-tessera-oxblood) 55%, var(--color-bone))"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M 35 10 Q 14 0 2 12" stroke="color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M 35 10 Q 56 4 68 14" stroke="color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M 35 10 Q 22 -2 14 -2" stroke="color-mix(in oklch, var(--color-outcome-yes) 65%, var(--color-bone))" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M 35 10 Q 48 -2 58 -2" stroke="color-mix(in oklch, var(--color-outcome-yes) 65%, var(--color-bone))" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="33" cy="12" r="2.5" fill="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" />
      <circle cx="37" cy="13" r="2.5" fill="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" />
      <style>{`
        @keyframes palm-sway {
          0%, 100% { transform: rotate(-3deg); transform-origin: 50% 100%; }
          50%      { transform: rotate(3deg);  transform-origin: 50% 100%; }
        }
      `}</style>
    </svg>
  );
}
