/// PulauMap — landing dashboard for `/`. Top-down tropical island with 6 clickable
/// locations linking to the rest of FORUM. Per docs/ANIMATION_ARCHITECTURE.md: this
/// is a "scene" — composes dumb sprites + subscribes to the SSE event bus, owns the
/// choreography. No new keyframes here — all ambient motion comes from the global
/// vocabulary in globals.css (wiggle-soft, drift-slow, float-soft).
///
/// 6 destinations on the island:
///   🏟️  Arena         → /markets         top-center, the biggest building
///   🗼  Lighthouse    → /protocol/stats  top-right, tall tower
///   📚  Library       → /docs            mid-left, scroll/book
///   🏦  Treasury      → /protocol/stats  center, golden coin pile
///   🛒  Pasar Crab    → /marketplace     mid-right, market stalls
///   🏖️  Beach         → /agents          bottom-center, sandy shore + crab tracks
///
/// Existing `<Hero />` lives untouched in components/Hero.tsx — rollback is one-line.

import Link from "next/link";
import { SkyOrb } from "@/components/SkyOrb";
import { IslandFauna } from "@/components/IslandFauna";
import type { Market, Bet } from "@/lib/api";
import { formatUsdc, relativeTime } from "@/lib/format";

type Props = {
  markets: Market[];
  recentBets: Bet[];
};

export function PulauMap({ markets, recentBets }: Props) {
  const openMarkets = markets.filter((m) => m.phase === 0).length;
  const totalBets = recentBets.length;
  const lastBetTs = recentBets[0]?.createdAt ?? 0;
  const lastBetRel = lastBetTs > 0 ? relativeTime(lastBetTs) : null;
  const totalVolume = recentBets.reduce(
    (acc, b) => acc + BigInt(b.costUsdc) + BigInt(b.feeUsdc),
    0n,
  );

  return (
    <section
      aria-label="FORUM Island — interactive map dashboard"
      data-pulau-map="root"
      style={{
        position: "relative",
        width: "100%",
        minHeight: "calc(100vh - 64px)",
        overflow: "hidden",
        background:
          "linear-gradient(180deg, " +
          "color-mix(in oklch, var(--color-pastel-sky) 55%, var(--color-bg)) 0%, " +
          "color-mix(in oklch, var(--color-pastel-sky) 35%, var(--color-bg)) 30%, " +
          "color-mix(in oklch, var(--color-aureus-ink) 18%, var(--color-bg)) 70%, " +
          "color-mix(in oklch, var(--color-aureus-ink) 30%, var(--color-bg)) 100%)",
      }}
    >
      {/* ============ SKY ORB — real sun (light) / moon+stars (dark) ============ */}
      <SkyOrb size={150} position={{ top: "4%", right: "6%" }} />
      <IslandFauna scene="pulau" seed={101} density={3} />

      {/* ============ BACKDROP — water + island + waves ============ */}
      <svg
        viewBox="0 0 1000 625"
        preserveAspectRatio="xMidYMid slice"
        data-pulau-map="decor"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        aria-hidden
      >
        <defs>
          <radialGradient id="island-fill" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--color-pastel-sun) 60%, var(--color-raised))" />
            <stop offset="70%" stopColor="color-mix(in oklch, var(--color-pastel-peach) 50%, var(--color-raised))" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--color-pastel-peach) 40%, var(--color-raised))" />
          </radialGradient>
          <linearGradient id="wave-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--color-pastel-sky) 70%, transparent)" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--color-pastel-sky) 30%, transparent)" />
          </linearGradient>
        </defs>

        {/* Distant clouds — drift across the top */}
        <g style={{ animation: "drift-slow 24s linear infinite", opacity: 0.55 }}>
          <ellipse cx="180" cy="60" rx="42" ry="10" fill="color-mix(in oklch, var(--color-raised) 90%, white)" />
          <ellipse cx="220" cy="55" rx="32" ry="8" fill="color-mix(in oklch, var(--color-raised) 90%, white)" />
        </g>
        <g style={{ animation: "drift-slow 32s linear infinite", animationDelay: "-12s", opacity: 0.45 }}>
          <ellipse cx="700" cy="80" rx="48" ry="11" fill="color-mix(in oklch, var(--color-raised) 88%, white)" />
          <ellipse cx="745" cy="75" rx="28" ry="7" fill="color-mix(in oklch, var(--color-raised) 88%, white)" />
        </g>

        {/* Sandy shoals — outer faint ring around the island, suggests shallow water */}
        <ellipse
          cx="500"
          cy="340"
          rx="430"
          ry="240"
          fill="color-mix(in oklch, var(--color-pastel-sky) 32%, transparent)"
          opacity="0.6"
        />

        {/* Island silhouette — irregular blob, sand fill */}
        <path
          d="M 220,260 Q 180,200 240,170 Q 320,130 440,160 Q 560,140 660,160 Q 780,150 820,230 Q 880,300 830,400 Q 800,490 680,510 Q 550,540 410,520 Q 280,510 200,460 Q 120,400 160,330 Q 180,290 220,260 Z"
          fill="url(#island-fill)"
        />

        {/* Beach edge — slightly darker sand line just inside the silhouette */}
        <path
          d="M 240,280 Q 210,220 260,200 Q 330,170 440,190 Q 560,170 660,190 Q 770,180 800,250 Q 850,310 800,390 Q 770,470 670,490 Q 550,520 410,500 Q 290,490 220,450 Q 150,400 180,340 Q 200,310 240,280 Z"
          fill="none"
          stroke="color-mix(in oklch, var(--color-honos-gold) 35%, transparent)"
          strokeWidth="2"
          strokeDasharray="3 4"
          opacity="0.5"
        />

        {/* Wave ripples around the island — three drifting rings */}
        <g style={{ animation: "drift-slow 18s linear infinite" }}>
          <path
            d="M 40,360 Q 90,340 140,360 T 240,360"
            stroke="url(#wave-fill)"
            strokeWidth="2"
            fill="none"
            opacity="0.65"
          />
          <path
            d="M 780,400 Q 830,380 880,400 T 980,400"
            stroke="url(#wave-fill)"
            strokeWidth="2"
            fill="none"
            opacity="0.6"
          />
        </g>
        <g style={{ animation: "drift-slow 22s linear infinite", animationDelay: "-7s" }}>
          <path
            d="M 60,500 Q 110,480 160,500 T 260,500"
            stroke="url(#wave-fill)"
            strokeWidth="1.5"
            fill="none"
            opacity="0.45"
          />
          <path
            d="M 720,540 Q 770,520 820,540 T 920,540"
            stroke="url(#wave-fill)"
            strokeWidth="1.5"
            fill="none"
            opacity="0.45"
          />
        </g>

        {/* Walking crabs on the beach — 4 of them at very slow paces (relaxed island feel) */}
        <g style={{ animation: "walkAcross 60s linear infinite" }}>
          <PixelCrab x={300} y={485} scale={0.9} />
        </g>
        <g style={{ animation: "walkAcross 48s linear infinite", animationDelay: "-24s" }}>
          <PixelCrab x={600} y={500} scale={0.7} />
        </g>
        <g style={{ animation: "walkAcross 72s linear infinite", animationDelay: "-18s" }}>
          <PixelCrab x={180} y={420} scale={0.6} />
        </g>
        <g style={{ animation: "walkAcross 56s linear infinite", animationDelay: "-36s" }}>
          <PixelCrab x={720} y={430} scale={0.8} />
        </g>

        {/* Jumping fish — lazy lazy lazy. Visible for only a small window of
            the cycle so they feel like rare splashes, and the jump arc itself
            stretches over multiple seconds. */}
        <g style={{ animation: "fishJump 28s ease-in-out infinite" }}>
          <FishSilhouette x={140} y={560} color="var(--color-pastel-sky)" />
        </g>
        <g style={{ animation: "fishJump 36s ease-in-out infinite", animationDelay: "-12s" }}>
          <FishSilhouette x={520} y={580} color="var(--color-pastel-peach)" />
        </g>
        <g style={{ animation: "fishJump 24s ease-in-out infinite", animationDelay: "-18s" }}>
          <FishSilhouette x={860} y={560} color="var(--color-pastel-mint)" />
        </g>

        {/* Sail boat far in the distance — drifts slowly along the horizon */}
        <g style={{ animation: "drift-slow 90s linear infinite", opacity: 0.7 }}>
          <SailBoat x={-100} y={385} />
        </g>

        {/* Flowers/coral clusters scattered on the sand */}
        <FlowerCluster x={420} y={465} color="var(--color-pastel-pink)" />
        <FlowerCluster x={580} y={490} color="var(--color-pastel-sun)" />
        <FlowerCluster x={760} y={478} color="var(--color-pastel-lavender)" />
        <FlowerCluster x={290} y={445} color="var(--color-pastel-peach)" />

        {/* Seagulls — gliding slowly across the sky */}
        <g style={{ animation: "birdFly 65s linear infinite", animationDelay: "0s" }}>
          <Seagull x={-50} y={90} />
        </g>
        <g style={{ animation: "birdFly 80s linear infinite", animationDelay: "-35s" }}>
          <Seagull x={-50} y={150} scale={0.8} />
        </g>

        {/* Butterflies — slower, calmer flutter */}
        <g style={{ animation: "butterflyHover 9s ease-in-out infinite" }}>
          <Butterfly x={100} y={320} color="var(--color-pastel-pink)" />
        </g>
        <g style={{ animation: "butterflyHover 11s ease-in-out infinite", animationDelay: "-3s" }}>
          <Butterfly x={250} y={420} color="var(--color-pastel-lavender)" />
        </g>

        {/* Inline scene-specific keyframes — choreography-specific, allowed per
            ANIMATION_ARCHITECTURE.md exception clause */}
        <style>{`
          @keyframes fishJump {
            /* Hidden 90% of the cycle, jump unfolds slowly over 10%
               (≈3 seconds at 28s base duration). */
            0%, 90%, 100% { transform: translateY(0) scaleY(1); opacity: 0; }
            91%           { transform: translateY(0) scaleY(1); opacity: 1; }
            93%           { transform: translateY(-12px) scaleY(0.97) rotate(-8deg); opacity: 1; }
            95%           { transform: translateY(-24px) scaleY(0.94) rotate(-2deg); opacity: 1; }
            97%           { transform: translateY(-30px) scaleY(0.92) rotate(6deg); opacity: 0.95; }
            99%           { transform: translateY(-12px) scaleY(0.96) rotate(14deg); opacity: 0.6; }
            100%          { transform: translateY(0) scaleY(1) rotate(20deg); opacity: 0; }
          }
          @keyframes birdFly {
            0%   { transform: translateX(0); }
            100% { transform: translateX(1100px); }
          }
          @keyframes butterflyHover {
            0%, 100% { transform: translate(0, 0) rotate(-8deg); }
            25%      { transform: translate(8px, -10px) rotate(8deg); }
            50%      { transform: translate(0, -16px) rotate(-4deg); }
            75%      { transform: translate(-8px, -8px) rotate(6deg); }
          }
        `}</style>
      </svg>

      {/* ============ PALM TREES — corner ambient + clusters ============ */}
      <PalmTree style={{ left: "8%", top: "44%", animationDelay: "0s" }} />
      <PalmTree style={{ left: "88%", top: "52%", animationDelay: "-2s" }} scale={1.15} />
      <PalmTree style={{ left: "20%", top: "70%", animationDelay: "-1s" }} scale={0.85} />
      <PalmTree style={{ left: "82%", top: "78%", animationDelay: "-3.5s" }} scale={0.7} />
      <PalmTree style={{ left: "5%", top: "68%", animationDelay: "-2.8s" }} scale={0.65} />
      <PalmTree style={{ left: "32%", top: "38%", animationDelay: "-4s" }} scale={0.55} />
      <PalmTree style={{ left: "70%", top: "32%", animationDelay: "-1.5s" }} scale={0.6} />

      {/* ============ HEADER OVERLAY ============ */}
      <div
        style={{
          position: "absolute",
          top: "3%",
          left: "50%",
          transform: "translateX(-50%)",
          textAlign: "center",
          zIndex: 3,
          maxWidth: "min(640px, 90vw)",
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: "var(--text-2xs)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--color-bone-dim)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--color-outcome-yes)",
              boxShadow: "0 0 8px color-mix(in oklch, var(--color-outcome-yes) 70%, transparent)",
            }}
          />
          Live · Arc Testnet · FORUM Island
        </span>
        <h1
          style={{
            margin: "8px 0 0",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "clamp(22px, 3vw, 40px)",
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
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
              fontSize: "0.7em",
              color: "var(--color-aureus-ink)",
              letterSpacing: "0",
              lineHeight: 1,
            }}
          >
            Welcome to
          </span>
          <span style={{ textTransform: "uppercase" }}>
            <span style={{ color: "var(--color-honos-gold)" }}>FORUM</span>{" "}
            <span style={{ color: "var(--color-aureus-ink)" }}>Island</span>
          </span>
        </h1>
        <p
          className="mono"
          style={{
            margin: "6px auto 0",
            fontSize: "var(--text-xs)",
            letterSpacing: "0.04em",
            color: "var(--color-bone-faint)",
            maxWidth: "44ch",
          }}
        >
          5 AI crabs trade Stable FX on Arc. Tap any place to enter.
        </p>
      </div>

      {/* ============ LOCATION BUTTONS ============ */}
      <div data-pulau-map="locations" style={{ display: "contents" }}>
        <Location href="/markets" left="50%" top="32%" label="Arena" sublabel={`${openMarkets} open`} accent="coral" Icon={ArenaIcon} />
        <Location href="/protocol/stats" left="83%" top="24%" label="Lighthouse" sublabel="protocol stats" accent="gold" Icon={LighthouseIcon} />
        <Location href="/docs" left="17%" top="42%" label="Workshop" sublabel="docs · SDK" accent="ink" Icon={WorkshopHutIcon} />
        {/* Treasury is a passive display — Lighthouse already routes to /protocol/stats. */}
        <TreasuryDisplay left="50%" top="55%" usdc={formatUsdc(totalVolume)} />
        <Location href="/marketplace" left="74%" top="62%" label="Marketplace" sublabel="rent · buy · sell" accent="coral" Icon={PasarIcon} />
        <Location href="/agents" left="38%" top="76%" label="Beach" sublabel="5 agents · leaderboard" accent="mint" Icon={BeachIcon} />
      </div>

      {/* ============ LIVE STATS BANNER (bottom) ============ */}
      <div
        style={{
          position: "absolute",
          bottom: "4%",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 24,
          padding: "8px 16px",
          borderRadius: 999,
          background: "color-mix(in oklch, var(--color-raised) 85%, transparent)",
          border: "1px solid var(--color-border)",
          backdropFilter: "blur(8px)",
          zIndex: 3,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.06em",
          color: "var(--color-bone-dim)",
        }}
      >
        <span><strong style={{ color: "var(--color-bone)" }}>{totalBets}</strong> bets</span>
        <span aria-hidden style={{ opacity: 0.4 }}>·</span>
        <span><strong style={{ color: "var(--color-bone)" }}>{openMarkets}</strong> open markets</span>
        {lastBetRel && (
          <>
            <span aria-hidden style={{ opacity: 0.4 }}>·</span>
            <span>last bet {lastBetRel}</span>
          </>
        )}
      </div>

      {/* ============ SCOPED KEYFRAMES — Tier A ambient only ============
          These are component-scoped because they're choreography-specific to PulauMap
          (walking crab path, palm sway from base). Per ANIMATION_ARCHITECTURE.md, any
          REUSABLE Tier A keyframe must be in globals.css; these are intentionally local. */}
      <style>{`
        @keyframes walkAcross {
          0%   { transform: translateX(-40px); }
          50%  { transform: translateX(180px); }
          50.01% { transform: translateX(180px) scaleX(-1); }
          100% { transform: translateX(-40px) scaleX(-1); }
        }
        @keyframes palmSway {
          0%, 100% { transform: rotate(-3deg); transform-origin: 50% 100%; }
          50%      { transform: rotate(3deg);  transform-origin: 50% 100%; }
        }
      `}</style>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* Location button — clickable destination on the island             */
/* ---------------------------------------------------------------- */
function Location({
  href,
  left,
  top,
  label,
  sublabel,
  accent,
  Icon,
}: {
  href: string;
  left: string;
  top: string;
  label: string;
  sublabel: string;
  accent: "coral" | "gold" | "ink" | "mint";
  Icon: React.ComponentType<{ size?: number }>;
}) {
  const tone = {
    coral: { fg: "var(--color-honos-gold)",     bg: "color-mix(in oklch, var(--color-honos-gold) 18%, var(--color-raised))" },
    gold:  { fg: "var(--color-honos-gold-dim)", bg: "color-mix(in oklch, var(--color-honos-gold) 12%, var(--color-raised))" },
    ink:   { fg: "var(--color-aureus-ink)",     bg: "color-mix(in oklch, var(--color-aureus-ink) 16%, var(--color-raised))" },
    mint:  { fg: "var(--color-outcome-yes)",    bg: "color-mix(in oklch, var(--color-outcome-yes) 16%, var(--color-raised))" },
  }[accent];

  return (
    <Link
      href={href}
      data-pulau-map="location"
      style={{
        position: "absolute",
        left,
        top,
        transform: "translate(-50%, -50%)",
        zIndex: 4,
        textDecoration: "none",
      }}
      className="map-location"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: "10px 14px",
          borderRadius: 14,
          background: tone.bg,
          border: `1.5px solid ${tone.fg}`,
          boxShadow: "0 4px 12px color-mix(in oklch, var(--color-bone) 14%, transparent)",
          transition: "transform 200ms var(--ease-out-quart), box-shadow 200ms var(--ease-out-quart)",
          minWidth: 96,
        }}
      >
        <Icon size={36} />
        <span
          className="mono"
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: "var(--color-bone)",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <span
          className="mono"
          style={{
            fontSize: "10px",
            letterSpacing: "0.04em",
            color: "var(--color-bone-dim)",
            whiteSpace: "nowrap",
          }}
        >
          {sublabel}
        </span>
      </div>
      <style>{`
        .map-location > div { transform-origin: center; }
        .map-location:hover > div {
          transform: translateY(-4px) scale(1.04);
          box-shadow: 0 8px 20px color-mix(in oklch, ${tone.fg} 35%, transparent);
        }
      `}</style>
    </Link>
  );
}

/* ---------------------------------------------------------------- */
/* Treasury display — passive (non-clickable) treasure-chest stat     */
/* card on the island. Lighthouse already routes to /protocol/stats;  */
/* this just shows the live treasury balance as a "harta karun" sit-  */
/* on-the-island stat without competing for navigation.               */
/* ---------------------------------------------------------------- */
function TreasuryDisplay({ left, top, usdc }: { left: string; top: string; usdc: string }) {
  return (
    <div
      data-pulau-map="location"
      aria-label="Treasury balance"
      style={{
        position: "absolute",
        left,
        top,
        transform: "translate(-50%, -50%)",
        zIndex: 4,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "10px 14px",
        borderRadius: 14,
        background: "color-mix(in oklch, var(--color-honos-gold) 10%, var(--color-raised))",
        border: "1.5px dashed color-mix(in oklch, var(--color-honos-gold) 60%, var(--color-bone))",
        boxShadow: "0 4px 12px color-mix(in oklch, var(--color-honos-gold) 22%, transparent)",
        minWidth: 96,
        animation: "treasure-bob 4.5s ease-in-out infinite",
      }}
    >
      <TreasuryIcon size={40} />
      <span
        className="mono"
        style={{
          fontSize: "var(--text-xs)",
          fontWeight: 700,
          letterSpacing: "0.06em",
          color: "var(--color-bone)",
          textTransform: "uppercase",
        }}
      >
        Treasury
      </span>
      <span
        className="mono"
        style={{
          fontSize: "10px",
          letterSpacing: "0.04em",
          color: "var(--color-honos-gold)",
          whiteSpace: "nowrap",
          fontWeight: 600,
        }}
      >
        {usdc} USDC · USYC yield
      </span>
      <style>{`
        @keyframes treasure-bob {
          0%, 100% { transform: translate(-50%, -50%) translateY(0); }
          50%      { transform: translate(-50%, -50%) translateY(-3px); }
        }
      `}</style>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Palm tree — trunk + 4 fronds, swaying from the base                */
/* ---------------------------------------------------------------- */
function PalmTree({
  style,
  scale = 1,
}: {
  style: React.CSSProperties;
  scale?: number;
}) {
  return (
    <svg
      width={60 * scale}
      height={90 * scale}
      viewBox="0 0 60 90"
      aria-hidden
      style={{
        position: "absolute",
        animation: "palmSway 5s ease-in-out infinite",
        transformOrigin: "50% 100%",
        zIndex: 2,
        pointerEvents: "none",
        ...style,
      }}
    >
      {/* Trunk */}
      <path
        d="M 28 88 Q 30 60 28 40 Q 26 25 30 12"
        stroke="color-mix(in oklch, var(--color-tessera-oxblood) 55%, var(--color-bone))"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* 4 fronds spreading out */}
      <path d="M 30 14 Q 14 6 4 16" stroke="color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M 30 14 Q 48 8 56 18" stroke="color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M 30 14 Q 20 2  12 0"  stroke="color-mix(in oklch, var(--color-outcome-yes) 65%, var(--color-bone))" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M 30 14 Q 40 2  50 0"  stroke="color-mix(in oklch, var(--color-outcome-yes) 65%, var(--color-bone))" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Coconuts */}
      <circle cx="28" cy="16" r="2" fill="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" />
      <circle cx="32" cy="17" r="2" fill="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" />
    </svg>
  );
}

/* ---------------------------------------------------------------- */
/* Seagull — small bird gliding across the sky                       */
/* ---------------------------------------------------------------- */
function Seagull({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      {/* Two-arc wing silhouette — classic seagull shape */}
      <path
        d="M 0 4 Q 6 0 12 4 Q 14 5 16 4 Q 22 0 28 4"
        stroke="color-mix(in oklch, var(--color-bone) 80%, var(--color-aureus-ink))"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}

/* ---------------------------------------------------------------- */
/* Fish silhouette — arcs up out of water, then back in              */
/* ---------------------------------------------------------------- */
function FishSilhouette({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      {/* Body */}
      <ellipse cx="0" cy="0" rx="5" ry="2.5" fill={color} />
      {/* Tail */}
      <path d="M 5 0 L 9 -3 L 9 3 Z" fill={color} />
      {/* Eye */}
      <circle cx="-2" cy="-0.5" r="0.5" fill="var(--color-bone)" />
      {/* Water splash droplets around */}
      <circle cx="-7" cy="2" r="0.5" fill="color-mix(in oklch, var(--color-pastel-sky) 80%, transparent)" />
      <circle cx="-5" cy="4" r="0.4" fill="color-mix(in oklch, var(--color-pastel-sky) 70%, transparent)" />
    </g>
  );
}

/* ---------------------------------------------------------------- */
/* Butterfly — small fluttering ambient near the palms                */
/* ---------------------------------------------------------------- */
function Butterfly({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      {/* Body */}
      <rect x="-0.4" y="-2" width="0.8" height="4" fill="color-mix(in oklch, var(--color-bone) 80%, transparent)" />
      {/* Left wing */}
      <ellipse cx="-3" cy="-1" rx="3" ry="2" fill={color} opacity="0.85" />
      <ellipse cx="-2.5" cy="1.5" rx="2" ry="1.5" fill={color} opacity="0.8" />
      {/* Right wing */}
      <ellipse cx="3" cy="-1" rx="3" ry="2" fill={color} opacity="0.85" />
      <ellipse cx="2.5" cy="1.5" rx="2" ry="1.5" fill={color} opacity="0.8" />
      {/* Antennae */}
      <line x1="0" y1="-2" x2="-1" y2="-3.5" stroke="color-mix(in oklch, var(--color-bone) 80%, transparent)" strokeWidth="0.3" />
      <line x1="0" y1="-2" x2="1" y2="-3.5" stroke="color-mix(in oklch, var(--color-bone) 80%, transparent)" strokeWidth="0.3" />
    </g>
  );
}

/* ---------------------------------------------------------------- */
/* Sail boat — small triangular sail drifting on horizon             */
/* ---------------------------------------------------------------- */
function SailBoat({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`}>
      {/* Hull */}
      <path
        d="M -8 0 L 12 0 L 10 4 L -6 4 Z"
        fill="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))"
      />
      {/* Mast */}
      <line x1="2" y1="-1" x2="2" y2="-14" stroke="color-mix(in oklch, var(--color-bone) 90%, transparent)" strokeWidth="0.6" />
      {/* Sail */}
      <path d="M 2 -14 L 2 -1 L 10 -1 Z" fill="color-mix(in oklch, var(--color-bg) 95%, white)" />
      <path d="M 2 -14 L 2 -1 L -5 -2 Z" fill="color-mix(in oklch, var(--color-pastel-peach) 80%, white)" opacity="0.9" />
    </g>
  );
}

/* ---------------------------------------------------------------- */
/* Flower cluster — small 3-bloom decoration on sand                */
/* ---------------------------------------------------------------- */
function FlowerCluster({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      {/* Stem */}
      <line x1="0" y1="0" x2="0" y2="-6" stroke="color-mix(in oklch, var(--color-outcome-yes) 65%, var(--color-bone))" strokeWidth="0.6" />
      <line x1="-4" y1="1" x2="-4" y2="-4" stroke="color-mix(in oklch, var(--color-outcome-yes) 65%, var(--color-bone))" strokeWidth="0.5" />
      <line x1="4" y1="1" x2="4" y2="-3" stroke="color-mix(in oklch, var(--color-outcome-yes) 65%, var(--color-bone))" strokeWidth="0.5" />
      {/* Blooms — 4 petals around a center */}
      {[[0, -6], [-4, -4], [4, -3]].map(([cx, cy], i) => (
        <g key={i} transform={`translate(${cx},${cy})`}>
          <circle cx="0" cy="-1.5" r="1.2" fill={color} />
          <circle cx="1.4" cy="0" r="1.2" fill={color} />
          <circle cx="0" cy="1.4" r="1.2" fill={color} />
          <circle cx="-1.4" cy="0" r="1.2" fill={color} />
          <circle cx="0" cy="0" r="0.8" fill="var(--color-honos-gold)" />
        </g>
      ))}
    </g>
  );
}

/* ---------------------------------------------------------------- */
/* Tiny crab — used for the "walking on beach" ambient. Simplified    */
/* version of the full AgentSprite — just silhouette, no accessory.   */
/* ---------------------------------------------------------------- */
function PixelCrab({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      {/* Body */}
      <ellipse cx="8" cy="6" rx="6" ry="3" fill="color-mix(in oklch, var(--color-honos-gold) 80%, var(--color-on-gold))" />
      {/* Claws */}
      <circle cx="2" cy="4" r="2" fill="color-mix(in oklch, var(--color-honos-gold) 80%, var(--color-on-gold))" />
      <circle cx="14" cy="4" r="2" fill="color-mix(in oklch, var(--color-honos-gold) 80%, var(--color-on-gold))" />
      {/* Stalks */}
      <rect x="6" y="1" width="0.8" height="2.5" fill="color-mix(in oklch, var(--color-honos-gold) 80%, var(--color-on-gold))" />
      <rect x="9.2" y="1" width="0.8" height="2.5" fill="color-mix(in oklch, var(--color-honos-gold) 80%, var(--color-on-gold))" />
      {/* Eye pupils */}
      <circle cx="6.4" cy="1.2" r="0.7" fill="var(--color-on-gold)" />
      <circle cx="9.6" cy="1.2" r="0.7" fill="var(--color-on-gold)" />
    </g>
  );
}

/* ---------------------------------------------------------------- */
/* Location icon components — kept tiny and inline. Each ~36×36 SVG   */
/* ---------------------------------------------------------------- */

function ArenaIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
      {/* Colosseum-style: 2 levels of arches */}
      <rect x="3" y="22" width="30" height="9" rx="1.5" fill="var(--color-honos-gold)" />
      <rect x="3" y="14" width="30" height="9" rx="1.5" fill="color-mix(in oklch, var(--color-honos-gold) 75%, var(--color-bone))" />
      <rect x="3" y="6" width="30" height="9" rx="1.5" fill="color-mix(in oklch, var(--color-honos-gold) 60%, var(--color-bone))" />
      {/* Arches */}
      {[6, 13, 20, 27].map((x) => (
        <ellipse key={`a1-${x}`} cx={x} cy="29" rx="2" ry="2.5" fill="var(--color-raised)" />
      ))}
      {[6, 13, 20, 27].map((x) => (
        <ellipse key={`a2-${x}`} cx={x} cy="21" rx="2" ry="2.5" fill="var(--color-raised)" />
      ))}
      {/* Flag */}
      <line x1="18" y1="6" x2="18" y2="1" stroke="var(--color-bone)" strokeWidth="1" />
      <path d="M 18 2 L 22 3 L 18 4 Z" fill="var(--color-tessera-oxblood)" />
    </svg>
  );
}

function LighthouseIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
      {/* Base */}
      <path d="M 12 32 L 24 32 L 22 12 L 14 12 Z" fill="color-mix(in oklch, var(--color-raised) 60%, var(--color-bone))" />
      {/* Stripes */}
      <rect x="14" y="14" width="8" height="3" fill="var(--color-tessera-oxblood)" />
      <rect x="14" y="22" width="8" height="3" fill="var(--color-tessera-oxblood)" />
      {/* Lamp room */}
      <rect x="13" y="6" width="10" height="6" fill="var(--color-honos-gold)" />
      <circle cx="18" cy="9" r="2" fill="var(--color-on-gold)" />
      {/* Roof */}
      <path d="M 12 6 L 18 1 L 24 6 Z" fill="color-mix(in oklch, var(--color-tessera-oxblood) 70%, var(--color-bone))" />
      {/* Light beams */}
      <path d="M 18 9 L 4 5 L 4 13 Z" fill="var(--color-honos-gold)" opacity="0.25" />
      <path d="M 18 9 L 32 5 L 32 13 Z" fill="var(--color-honos-gold)" opacity="0.25" />
    </svg>
  );
}

function WorkshopHutIcon({ size = 36 }: { size?: number }) {
  // Tropical builder's hut — wooden stilts + palm-leaf thatched roof + blueprint
  // peeking out the doorway. Replaces the greek-pillar library which felt off
  // on a tropical island.
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
      {/* Stilts */}
      <rect x="7" y="22" width="2" height="10" fill="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" />
      <rect x="27" y="22" width="2" height="10" fill="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" />
      {/* Floor platform */}
      <rect x="5" y="20" width="26" height="3" fill="color-mix(in oklch, var(--color-tessera-oxblood) 45%, var(--color-bone))" />
      {/* Hut walls (wooden) */}
      <rect x="8" y="11" width="20" height="11" fill="color-mix(in oklch, var(--color-pastel-peach) 65%, var(--color-tessera-oxblood))" />
      {/* Wall plank lines */}
      <line x1="13" y1="11" x2="13" y2="22" stroke="color-mix(in oklch, var(--color-tessera-oxblood) 50%, var(--color-bone))" strokeWidth="0.5" />
      <line x1="18" y1="11" x2="18" y2="22" stroke="color-mix(in oklch, var(--color-tessera-oxblood) 50%, var(--color-bone))" strokeWidth="0.5" />
      <line x1="23" y1="11" x2="23" y2="22" stroke="color-mix(in oklch, var(--color-tessera-oxblood) 50%, var(--color-bone))" strokeWidth="0.5" />
      {/* Doorway with blueprint peeking out */}
      <rect x="15" y="14" width="6" height="8" fill="color-mix(in oklch, var(--color-aureus-ink) 28%, var(--color-raised))" />
      <rect x="16" y="17" width="4" height="4" fill="color-mix(in oklch, var(--color-aureus-ink) 55%, var(--color-pastel-sky))" />
      {/* Palm-leaf thatched roof */}
      <path d="M 4 11 L 18 3 L 32 11 Z" fill="color-mix(in oklch, var(--color-outcome-yes) 60%, var(--color-tessera-oxblood))" />
      <path d="M 4 11 L 10 11 L 8 8 Z" fill="color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" />
      <path d="M 26 11 L 32 11 L 28 8 Z" fill="color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" />
      <path d="M 13 8 L 16 5 L 18 8 Z" fill="color-mix(in oklch, var(--color-outcome-yes) 80%, var(--color-bone))" />
      <path d="M 18 8 L 20 5 L 23 8 Z" fill="color-mix(in oklch, var(--color-outcome-yes) 80%, var(--color-bone))" />
      {/* Tools rack on side (hammer + screwdriver silhouette) */}
      <rect x="29" y="13" width="0.6" height="4" fill="color-mix(in oklch, var(--color-bone) 70%, transparent)" />
      <rect x="28" y="12" width="2" height="1.5" fill="color-mix(in oklch, var(--color-bone) 80%, transparent)" />
    </svg>
  );
}

function TreasuryIcon({ size = 36 }: { size?: number }) {
  // "Harta karun" — proper pirate treasure chest with overflowing coins + gems.
  // Wood plank body + brass bands + open lid showing the loot inside.
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
      {/* Ground shadow */}
      <ellipse cx="18" cy="32" rx="14" ry="2" fill="color-mix(in oklch, var(--color-aureus-ink) 40%, transparent)" opacity="0.25" />
      {/* Coins spilling out front */}
      <circle cx="9" cy="29" r="2" fill="var(--color-honos-gold)" />
      <circle cx="12" cy="30" r="1.6" fill="color-mix(in oklch, var(--color-honos-gold) 85%, var(--color-on-gold))" />
      <circle cx="26" cy="29.5" r="1.8" fill="var(--color-honos-gold)" />
      <circle cx="29" cy="30" r="1.4" fill="color-mix(in oklch, var(--color-honos-gold) 85%, var(--color-on-gold))" />
      {/* Chest body (back panel — wooden) */}
      <rect x="6" y="17" width="24" height="13" rx="1.2" fill="#7A4B22" />
      {/* Plank lines */}
      <line x1="6" y1="21" x2="30" y2="21" stroke="#5A3416" strokeWidth="0.4" />
      <line x1="6" y1="25" x2="30" y2="25" stroke="#5A3416" strokeWidth="0.4" />
      {/* Brass bands */}
      <rect x="6" y="20" width="24" height="1.4" fill="var(--color-honos-gold)" />
      <rect x="6" y="27" width="24" height="1.4" fill="var(--color-honos-gold)" />
      {/* Lock */}
      <rect x="16" y="22.5" width="4" height="3.5" rx="0.6" fill="var(--color-honos-gold)" stroke="#8B6A1F" strokeWidth="0.3" />
      <circle cx="18" cy="24" r="0.5" fill="#3A2407" />
      {/* Open lid — tilted back, showing inside */}
      <path d="M 5 17 L 6 11 L 30 11 L 31 17 Z"
        fill="#8B5A2A" />
      <path d="M 6 11 L 30 11" stroke="#5A3416" strokeWidth="0.5" />
      {/* Brass band on lid */}
      <path d="M 5.6 14 L 30.4 14" stroke="var(--color-honos-gold)" strokeWidth="1.4" />
      {/* Loot inside chest (above lock line) */}
      <circle cx="10" cy="17" r="2" fill="var(--color-honos-gold)" />
      <circle cx="13" cy="16.5" r="1.6" fill="color-mix(in oklch, var(--color-honos-gold) 80%, var(--color-on-gold))" />
      <circle cx="22" cy="17" r="1.8" fill="var(--color-honos-gold)" />
      <circle cx="25" cy="16.5" r="1.4" fill="color-mix(in oklch, var(--color-honos-gold) 80%, var(--color-on-gold))" />
      {/* Gem on top of loot */}
      <path d="M 17 14 L 19 14 L 20 16 L 18 18 L 16 16 Z"
        fill="color-mix(in oklch, var(--color-pastel-sky) 60%, white)"
        stroke="var(--color-aureus-ink)" strokeWidth="0.3" />
      {/* Sparkle */}
      <circle cx="17.5" cy="15" r="0.5" fill="white" />
      {/* Top sparkles around the chest */}
      <g fill="var(--color-honos-gold)" opacity="0.9">
        <circle cx="4" cy="8" r="0.6" />
        <circle cx="32" cy="9" r="0.5" />
        <circle cx="18" cy="6" r="0.7" />
      </g>
    </svg>
  );
}

function PasarIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
      {/* Stall awning — striped */}
      <path d="M 3 12 L 33 12 L 30 6 L 6 6 Z" fill="var(--color-tessera-oxblood)" />
      <path d="M 9 6 L 12 12" stroke="var(--color-raised)" strokeWidth="1" />
      <path d="M 15 6 L 18 12" stroke="var(--color-raised)" strokeWidth="1" />
      <path d="M 21 6 L 24 12" stroke="var(--color-raised)" strokeWidth="1" />
      <path d="M 27 6 L 30 12" stroke="var(--color-raised)" strokeWidth="1" />
      {/* Stall counter */}
      <rect x="4" y="12" width="28" height="5" fill="color-mix(in oklch, var(--color-honos-gold) 50%, var(--color-bone))" />
      {/* Items on counter (crab silhouettes) */}
      <circle cx="11" cy="22" r="3" fill="color-mix(in oklch, var(--color-honos-gold) 70%, var(--color-on-gold))" />
      <circle cx="18" cy="22" r="3" fill="color-mix(in oklch, var(--color-pastel-mint) 60%, var(--color-bone))" />
      <circle cx="25" cy="22" r="3" fill="color-mix(in oklch, var(--color-pastel-sky) 60%, var(--color-bone))" />
      {/* Hanging price tag */}
      <line x1="18" y1="12" x2="18" y2="14" stroke="var(--color-bone-dim)" strokeWidth="0.5" />
      <path d="M 16 14 L 20 14 L 21 17 L 17 18 L 15 16 Z" fill="var(--color-bg)" stroke="var(--color-bone-dim)" strokeWidth="0.4" />
      <text x="18" y="17" textAnchor="middle" fontSize="3" fill="var(--color-bone)" fontFamily="ui-monospace">$</text>
    </svg>
  );
}

function BeachIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden>
      {/* Sand */}
      <ellipse cx="18" cy="26" rx="16" ry="6" fill="color-mix(in oklch, var(--color-pastel-sun) 80%, var(--color-bone))" />
      {/* Wave line */}
      <path d="M 2 18 Q 9 14 18 18 T 34 18" stroke="color-mix(in oklch, var(--color-pastel-sky) 80%, var(--color-bone))" strokeWidth="1.5" fill="none" />
      <path d="M 2 22 Q 9 18 18 22 T 34 22" stroke="color-mix(in oklch, var(--color-pastel-sky) 60%, var(--color-bone))" strokeWidth="1" fill="none" opacity="0.7" />
      {/* Crab tracks */}
      <g fill="var(--color-bone-dim)" opacity="0.4">
        <circle cx="8" cy="29" r="0.6" />
        <circle cx="11" cy="29" r="0.6" />
        <circle cx="14" cy="29" r="0.6" />
        <circle cx="17" cy="30" r="0.6" />
        <circle cx="20" cy="30" r="0.6" />
        <circle cx="23" cy="30" r="0.6" />
      </g>
      {/* Tiny crab silhouette */}
      <ellipse cx="26" cy="28" rx="3" ry="1.6" fill="var(--color-honos-gold)" />
      <circle cx="23" cy="27.5" r="1" fill="var(--color-honos-gold)" />
      <circle cx="29" cy="27.5" r="1" fill="var(--color-honos-gold)" />
    </svg>
  );
}
