/// `/protocol/stats` — Lighthouse destination. Shows treasury, fees, volume,
/// market counts — the proof of "real protocol on Arc". Linked from PulauMap
/// Lighthouse + Treasury cards. v0.1 reuses RevenueStats; M1 adds an interactive
/// treasury dashboard with timeseries + flow viz.

import { IslandLayout } from "@/components/IslandLayout";
import { Footer } from "@/components/Footer";
import { RevenueStats } from "@/components/RevenueStats";
import { USYCYieldCard } from "@/components/USYCYieldCard";
import { IslandFauna } from "@/components/IslandFauna";
import { SkyOrb } from "@/components/SkyOrb";
import { fetchProtocolStats, fetchInfo } from "@/lib/api";
import { arcscanAddress } from "@/lib/format";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Protocol stats · Lighthouse",
  description: "FORUM protocol stats — treasury balance, accrued fees, volume, market counts. Verifiable on Arcscan.",
};

export default async function ProtocolStatsPage() {
  const [stats, info] = await Promise.all([fetchProtocolStats(), fetchInfo()]);

  return (
    <IslandLayout>
      <LighthouseBackdrop />
      <IslandFauna scene="lighthouse" seed={43} />
      <main
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "clamp(32px, 4vw, 56px) clamp(20px, 4vw, 56px) clamp(32px, 5vw, 64px)",
          display: "flex",
          flexDirection: "column",
          gap: 56,
          position: "relative",
        }}
      >
        <LighthouseDeckAmbient />
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 56 }}>
          {stats && <RevenueStats stats={stats} />}
          {stats && <USYCYieldCard treasuryBalance6dp={stats.treasuryBalance} />}
          {info && <ContractsStrip contracts={info.contracts} />}
          {!stats && <EmptyState />}
        </div>
      </main>
      <Footer />
    </IslandLayout>
  );
}

/* ---------------------------------------------------------------- */
/* LighthouseBackdrop — full-bleed Lighthouse observation deck intro */
/* Sits above the stats content. Sky+sea horizon + rotating beam +   */
/* telescope + compass + map scrolls. Sets the "watch tower" tone.   */
/* ---------------------------------------------------------------- */
function LighthouseBackdrop() {
  return (
    <section
      style={{
        position: "relative",
        width: "100%",
        minHeight: "calc(100vh - 64px)",
        padding: "clamp(40px, 5vw, 72px) clamp(20px, 4vw, 56px) clamp(48px, 6vw, 80px)",
        background:
          "linear-gradient(180deg, " +
          "color-mix(in oklch, var(--color-pastel-sky) 55%, var(--color-bg)) 0%, " +
          "color-mix(in oklch, var(--color-pastel-peach) 25%, var(--color-bg)) 60%, " +
          "color-mix(in oklch, var(--color-aureus-ink) 20%, var(--color-bg)) 100%)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
      aria-label="Lighthouse intro"
    >
      {/* Sky orb — sun in light mode, moon+stars in dark mode. Consistent
          with every other island page. Anchored upper-left so it doesn't
          collide with the lighthouse structure that lives top-right. */}
      <SkyOrb size={110} position={{ top: "8%", left: "6%" }} />

      {/* Distant sea horizon — faint wave layers */}
      <svg
        viewBox="0 0 1200 400"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        aria-hidden
      >
        {/* Faint legacy sun-on-horizon retained as deep-glow hint behind
            the SkyOrb (much smaller, so the SkyOrb reads as the primary). */}
        <circle cx="200" cy="290" r="22"
          fill="color-mix(in oklch, var(--color-honos-gold) 70%, var(--color-bg))"
          opacity="0.25" />
        {/* Horizon line — raised from y=290 to y=270 to shrink the empty gap */}
        <line x1="0" y1="270" x2="1200" y2="270"
          stroke="color-mix(in oklch, var(--color-aureus-ink) 30%, transparent)"
          strokeWidth="1" opacity="0.4" />

        {/* Small distant island / rock outcrop — sits on the horizon */}
        <g opacity="0.55">
          <path d="M 740 270 Q 760 248 780 252 Q 800 244 820 254 Q 840 250 860 270 Z"
            fill="color-mix(in oklch, var(--color-aureus-ink) 45%, var(--color-pastel-sky))" />
          {/* Tiny palm silhouette on the island */}
          <path d="M 790 252 Q 791 244 794 238" stroke="color-mix(in oklch, var(--color-aureus-ink) 60%, transparent)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d="M 794 238 Q 786 234 780 238" stroke="color-mix(in oklch, var(--color-aureus-ink) 55%, transparent)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d="M 794 238 Q 802 234 808 238" stroke="color-mix(in oklch, var(--color-aureus-ink) 55%, transparent)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </g>

        {/* Sailing ship silhouette — mid-distance, just under horizon line.
            Two sails + flag, small enough to read as "far away". */}
        <g opacity="0.7" style={{ animation: "ship-bob 8s ease-in-out infinite", transformOrigin: "560px 268px" }}>
          {/* Hull */}
          <path d="M 530 270 Q 540 282 580 282 Q 595 282 600 270 Z"
            fill="color-mix(in oklch, var(--color-tessera-oxblood) 65%, var(--color-aureus-ink))" />
          {/* Mast */}
          <line x1="560" y1="270" x2="560" y2="232" stroke="color-mix(in oklch, var(--color-aureus-ink) 70%, var(--color-bone))" strokeWidth="1.2" />
          {/* Mainsail */}
          <path d="M 560 234 L 580 268 L 560 268 Z"
            fill="color-mix(in oklch, var(--color-bone) 88%, var(--color-pastel-peach))" />
          {/* Jib */}
          <path d="M 560 240 L 545 268 L 560 268 Z"
            fill="color-mix(in oklch, var(--color-bone) 80%, var(--color-pastel-sun))" />
          {/* Flag */}
          <path d="M 560 232 L 568 230 L 560 236 Z" fill="var(--color-honos-gold)" />
        </g>

        {/* Buoy — bobbing red+white striped, ocean classic */}
        <g style={{ animation: "buoy-bob 4s ease-in-out infinite", transformOrigin: "320px 296px" }}>
          {/* Top sphere */}
          <circle cx="320" cy="290" r="4" fill="var(--color-tessera-oxblood)" />
          {/* Body — alternating stripes */}
          <rect x="316" y="293" width="8" height="3" fill="var(--color-bone)" />
          <rect x="316" y="296" width="8" height="3" fill="var(--color-tessera-oxblood)" />
          <rect x="316" y="299" width="8" height="3" fill="var(--color-bone)" />
          {/* Base ring */}
          <ellipse cx="320" cy="302" rx="5" ry="1.5" fill="color-mix(in oklch, var(--color-aureus-ink) 50%, var(--color-bone))" />
          {/* Tiny ripple around base */}
          <ellipse cx="320" cy="304" rx="9" ry="1.5" fill="none" stroke="color-mix(in oklch, var(--color-pastel-sky) 60%, transparent)" strokeWidth="0.6" opacity="0.7" />
        </g>

        {/* Drifting waves — moved up to match raised horizon */}
        <g style={{ animation: "drift-slow 50s linear infinite", opacity: 0.5 }}>
          <path d="M 0 300 Q 100 294 200 300 T 400 300 T 600 300 T 800 300 T 1000 300 T 1200 300"
            stroke="color-mix(in oklch, var(--color-pastel-sky) 80%, transparent)" strokeWidth="1.5" fill="none" />
        </g>
        <g style={{ animation: "drift-slow 70s linear infinite", animationDelay: "-20s", opacity: 0.4 }}>
          <path d="M 0 322 Q 80 314 160 322 T 320 322 T 480 322 T 640 322 T 800 322 T 960 322 T 1120 322"
            stroke="color-mix(in oklch, var(--color-pastel-sky) 70%, transparent)" strokeWidth="1.5" fill="none" />
        </g>

        {/* Two jumping fish near the horizon (mid + right) */}
        <g style={{ animation: "fish-jump-a 6s ease-in-out infinite", transformOrigin: "420px 296px" }} opacity="0.75">
          <path d="M 414 296 Q 420 288 426 296 Q 430 298 432 296 L 432 300 Q 430 298 426 300 Q 420 308 414 300 Z"
            fill="color-mix(in oklch, var(--color-pastel-sky) 65%, var(--color-aureus-ink))" />
          <circle cx="418" cy="294" r="0.8" fill="var(--color-aureus-ink)" />
        </g>
        <g style={{ animation: "fish-jump-b 7.5s ease-in-out infinite", animationDelay: "-3s", transformOrigin: "660px 300px" }} opacity="0.75">
          <path d="M 654 300 Q 660 292 666 300 Q 670 302 672 300 L 672 304 Q 670 302 666 304 Q 660 312 654 304 Z"
            fill="color-mix(in oklch, var(--color-pastel-mint) 60%, var(--color-aureus-ink))" />
          <circle cx="658" cy="298" r="0.8" fill="var(--color-aureus-ink)" />
        </g>
        <g style={{ animation: "fish-jump-a 9s ease-in-out infinite", animationDelay: "-5s", transformOrigin: "880px 304px" }} opacity="0.7">
          <path d="M 874 304 Q 880 296 886 304 Q 890 306 892 304 L 892 308 Q 890 306 886 308 Q 880 316 874 308 Z"
            fill="color-mix(in oklch, var(--color-pastel-peach) 55%, var(--color-aureus-ink))" />
          <circle cx="878" cy="302" r="0.8" fill="var(--color-aureus-ink)" />
        </g>

        {/* Three seagulls in V-formation, upper sky */}
        <g opacity="0.6" style={{ animation: "drift-slow 90s linear infinite" }}>
          <path d="M 460 110 q 5 -5 10 0 q 5 -5 10 0" stroke="var(--color-aureus-ink)" strokeWidth="1.4" fill="none" />
          <path d="M 490 130 q 4 -4 8 0 q 4 -4 8 0" stroke="var(--color-aureus-ink)" strokeWidth="1.3" fill="none" />
          <path d="M 430 130 q 4 -4 8 0 q 4 -4 8 0" stroke="var(--color-aureus-ink)" strokeWidth="1.3" fill="none" />
        </g>

        {/* Lighthouse beam — rotates slowly, sweeps across sky */}
        <g style={{ transformOrigin: "1050px 240px", animation: "beam-sweep 18s linear infinite", opacity: 0.4 }}>
          <path d="M 1050 240 L 200 80 L 1050 80 Z"
            fill="color-mix(in oklch, var(--color-honos-gold) 65%, transparent)" />
        </g>

        {/* Anchor on sand foreground — bottom-left, partly buried */}
        <g transform="translate(120 354) rotate(-12)" opacity="0.7">
          {/* Shank */}
          <line x1="0" y1="0" x2="0" y2="28" stroke="color-mix(in oklch, var(--color-aureus-ink) 60%, var(--color-bone))" strokeWidth="2.2" strokeLinecap="round" />
          {/* Ring */}
          <circle cx="0" cy="-3" r="3" fill="none" stroke="color-mix(in oklch, var(--color-aureus-ink) 60%, var(--color-bone))" strokeWidth="1.6" />
          {/* Stock (crossbar) */}
          <line x1="-9" y1="4" x2="9" y2="4" stroke="color-mix(in oklch, var(--color-aureus-ink) 60%, var(--color-bone))" strokeWidth="1.8" strokeLinecap="round" />
          {/* Curved flukes at bottom */}
          <path d="M -12 26 Q -10 32 -2 30 M 12 26 Q 10 32 2 30"
            stroke="color-mix(in oklch, var(--color-aureus-ink) 60%, var(--color-bone))" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M -14 24 L -12 26 M 14 24 L 12 26"
            stroke="color-mix(in oklch, var(--color-aureus-ink) 60%, var(--color-bone))" strokeWidth="2" strokeLinecap="round" />
          {/* Couple of shells near the anchor */}
          <path d="M 22 30 Q 26 24 30 30 Q 26 32 22 30 Z" fill="color-mix(in oklch, var(--color-pastel-peach) 80%, var(--color-bone))" opacity="0.85" />
          <path d="M 32 36 Q 35 32 38 36 Q 35 38 32 36 Z" fill="color-mix(in oklch, var(--color-pastel-sun) 80%, var(--color-bone))" opacity="0.85" />
        </g>
      </svg>

      {/* Lighthouse silhouette — top-right corner, the actual structure */}
      <svg width="120" height="240" viewBox="0 0 120 240" aria-hidden
        style={{ position: "absolute", top: "12%", right: "6%", opacity: 0.95 }}>
        {/* Rocky base */}
        <path d="M 5 230 L 30 200 L 90 200 L 115 230 Z"
          fill="color-mix(in oklch, var(--color-tessera-oxblood) 40%, var(--color-bone))" />
        {/* Tower */}
        <path d="M 35 200 L 45 80 L 75 80 L 85 200 Z"
          fill="color-mix(in oklch, var(--color-raised) 70%, var(--color-bone))" />
        {/* Red stripes */}
        <rect x="40" y="100" width="40" height="14" fill="var(--color-tessera-oxblood)" />
        <rect x="38" y="140" width="44" height="14" fill="var(--color-tessera-oxblood)" />
        <rect x="36" y="180" width="48" height="14" fill="var(--color-tessera-oxblood)" />
        {/* Walkway */}
        <rect x="32" y="76" width="56" height="6" fill="color-mix(in oklch, var(--color-bone) 70%, var(--color-aureus-ink))" />
        <line x1="36" y1="76" x2="36" y2="68" stroke="color-mix(in oklch, var(--color-bone) 70%, transparent)" strokeWidth="1.5" />
        <line x1="60" y1="76" x2="60" y2="64" stroke="color-mix(in oklch, var(--color-bone) 70%, transparent)" strokeWidth="1.5" />
        <line x1="84" y1="76" x2="84" y2="68" stroke="color-mix(in oklch, var(--color-bone) 70%, transparent)" strokeWidth="1.5" />
        {/* Lamp room */}
        <rect x="42" y="44" width="36" height="20"
          fill="var(--color-honos-gold)" />
        <circle cx="60" cy="54" r="5" fill="var(--color-on-gold)" />
        {/* Roof */}
        <path d="M 38 44 L 60 20 L 82 44 Z"
          fill="color-mix(in oklch, var(--color-tessera-oxblood) 70%, var(--color-bone))" />
        <rect x="58" y="14" width="4" height="6" fill="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" />
        {/* Lantern beam dots (suggests the rotating light) */}
        <circle cx="60" cy="54" r="12" fill="color-mix(in oklch, var(--color-honos-gold) 50%, transparent)" opacity="0.5" />
      </svg>

      {/* Telescope on tripod — moved inward toward the headline tableau */}
      <svg width="100" height="120" viewBox="0 0 100 120" aria-hidden
        style={{ position: "absolute", top: "38%", left: "18%", opacity: 0.85 }}>
        {/* Tripod legs */}
        <line x1="40" y1="60" x2="20" y2="115" stroke="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" strokeWidth="3" strokeLinecap="round" />
        <line x1="50" y1="60" x2="50" y2="115" stroke="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" strokeWidth="3" strokeLinecap="round" />
        <line x1="60" y1="60" x2="80" y2="115" stroke="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" strokeWidth="3" strokeLinecap="round" />
        {/* Telescope body — angled toward sky */}
        <g transform="rotate(-20, 50, 50)">
          <rect x="20" y="42" width="60" height="14" rx="3"
            fill="color-mix(in oklch, var(--color-bone) 65%, var(--color-aureus-ink))" />
          <rect x="78" y="40" width="8" height="18" rx="2"
            fill="color-mix(in oklch, var(--color-bone) 80%, var(--color-aureus-ink))" />
          <circle cx="22" cy="49" r="3" fill="color-mix(in oklch, var(--color-aureus-ink) 60%, black)" />
        </g>
      </svg>

      {/* Compass — moved inward to form a desk-of-tools tableau near center */}
      <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden
        style={{ position: "absolute", bottom: "22%", left: "30%", opacity: 0.85 }}>
        <circle cx="40" cy="40" r="34"
          fill="color-mix(in oklch, var(--color-bg) 90%, white)"
          stroke="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" strokeWidth="3" />
        <circle cx="40" cy="40" r="26"
          fill="none" stroke="color-mix(in oklch, var(--color-aureus-ink) 40%, transparent)" strokeWidth="0.6" />
        {/* N S E W marks */}
        <text x="40" y="18" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="ui-monospace" fill="var(--color-tessera-oxblood)">N</text>
        <text x="40" y="68" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="ui-monospace" fill="var(--color-bone-dim)">S</text>
        <text x="66" y="44" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="ui-monospace" fill="var(--color-bone-dim)">E</text>
        <text x="14" y="44" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="ui-monospace" fill="var(--color-bone-dim)">W</text>
        {/* Pointer */}
        <path d="M 40 14 L 36 40 L 44 40 Z"
          fill="var(--color-tessera-oxblood)" />
        <path d="M 40 66 L 36 40 L 44 40 Z"
          fill="color-mix(in oklch, var(--color-bone) 60%, var(--color-aureus-ink))" />
        <circle cx="40" cy="40" r="2.5" fill="var(--color-honos-gold)" />
      </svg>

      {/* Map scroll — moved inward into the desk-of-tools tableau */}
      <svg width="140" height="100" viewBox="0 0 140 100" aria-hidden
        style={{ position: "absolute", bottom: "22%", right: "24%", opacity: 0.85, transform: "rotate(-5deg)" }}>
        <rect x="14" y="20" width="112" height="60" rx="2"
          fill="color-mix(in oklch, var(--color-bg) 95%, white)"
          stroke="color-mix(in oklch, var(--color-tessera-oxblood) 35%, var(--color-bone))" strokeWidth="1" />
        <ellipse cx="14" cy="50" rx="3.5" ry="30" fill="color-mix(in oklch, var(--color-tessera-oxblood) 30%, var(--color-bg))" />
        <ellipse cx="126" cy="50" rx="3.5" ry="30" fill="color-mix(in oklch, var(--color-tessera-oxblood) 30%, var(--color-bg))" />
        {/* Trade-route line + X marks */}
        <path d="M 24 35 L 50 45 L 78 38 L 110 60" stroke="var(--color-tessera-oxblood)" strokeWidth="1.2" fill="none" strokeDasharray="3 2" />
        <text x="24" y="38" fontSize="8" fontFamily="ui-monospace" fill="var(--color-tessera-oxblood)">×</text>
        <text x="110" y="64" fontSize="8" fontFamily="ui-monospace" fill="var(--color-tessera-oxblood)">×</text>
        <text x="62" y="72" fontSize="6" fontFamily="ui-monospace" fill="var(--color-aureus-ink)" opacity="0.7">FORUM ROUTE</text>
      </svg>

      {/* Header content — sits high, matches Marketplace/Beach baseline */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 32,
          textAlign: "center",
          alignItems: "center",
          maxWidth: "min(640px, 90vw)",
          margin: "0 auto",
          position: "relative",
          zIndex: 1,
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
          🗼 Lighthouse · The Watchtower · audit-ready
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
            From the
          </span>
          <span
            style={{
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              textShadow:
                "0 2px 14px color-mix(in oklch, var(--color-bg) 70%, transparent), 0 1px 0 color-mix(in oklch, var(--color-bg) 50%, transparent)",
            }}
          >
            <span style={{ color: "var(--color-honos-gold)" }}>Lighthouse</span>{" "}
            <span style={{ color: "var(--color-aureus-ink)" }}>on Watch</span>
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
          Treasury, fees, volume, markets — every USDC flow on Arcscan.
        </p>
      </div>

      <style>{`
        @keyframes beam-sweep {
          0%, 100% { transform: rotate(-25deg); }
          50%      { transform: rotate(25deg); }
        }
        @keyframes ship-bob {
          0%, 100% { transform: translateY(0) rotate(-1deg); }
          50%      { transform: translateY(-3px) rotate(1deg); }
        }
        @keyframes buoy-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-2px); }
        }
        @keyframes fish-jump-a {
          0%, 78%, 100% { transform: translateY(8px) rotate(0); opacity: 0; }
          82%           { transform: translateY(-6px) rotate(-22deg); opacity: 0.9; }
          88%           { transform: translateY(-12px) rotate(6deg); opacity: 1; }
          94%           { transform: translateY(6px) rotate(24deg); opacity: 0.5; }
        }
        @keyframes fish-jump-b {
          0%, 80%, 100% { transform: translateY(8px) rotate(0); opacity: 0; }
          84%           { transform: translateY(-8px) rotate(-18deg); opacity: 0.9; }
          90%           { transform: translateY(-14px) rotate(10deg); opacity: 1; }
          96%           { transform: translateY(4px) rotate(22deg); opacity: 0.5; }
        }
      `}</style>
    </section>
  );
}

// Old Header() — superseded by LighthouseBackdrop. Kept for backward-compat;
// renders nothing if called (no consumers remain).
function Header() {
  return (
    <header style={{ display: "none" }} aria-hidden>
      <span
        className="mono"
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--color-bone-dim)",
        }}
      >
        🗼 Lighthouse · Protocol Stats
      </span>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "clamp(32px, 5vw, 52px)",
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
            fontSize: "0.55em",
            color: "var(--color-aureus-ink)",
          }}
        >
          From the
        </span>
        <span style={{ textTransform: "uppercase" }}>
          <span style={{ color: "var(--color-honos-gold)" }}>Lighthouse</span>{" "}
          <span style={{ color: "var(--color-aureus-ink)" }}>You can see</span>
        </span>
      </h1>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: "var(--text-base)",
          color: "var(--color-bone-dim)",
          maxWidth: "56ch",
          lineHeight: 1.55,
        }}
      >
        Treasury balance, accrued fees, settled volume, market counts.
        Every USDC flow lives on Arcscan — verifiable, public, audit-ready.
      </p>
    </header>
  );
}

function ContractsStrip({ contracts }: { contracts: Record<string, string> }) {
  const entries = Object.entries(contracts).filter(([, addr]) => addr && addr !== "0x0000000000000000000000000000000000000000");
  if (entries.length === 0) return null;
  return (
    <section>
      <div
        className="mono"
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--color-bone-faint)",
          marginBottom: 18,
        }}
      >
        On-chain contracts (Arc Testnet)
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {entries.map(([name, addr]) => (
          <a
            key={name}
            href={arcscanAddress(addr)}
            target="_blank"
            rel="noreferrer"
            className="mono"
            style={{
              padding: "12px 14px",
              border: "1.5px solid var(--color-border)",
              borderRadius: 12,
              background: "var(--color-raised)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              textDecoration: "none",
              color: "var(--color-bone)",
              transition: "border-color 180ms ease, transform 180ms ease",
            }}
          >
            <span style={{ fontSize: "10px", letterSpacing: "0.12em", color: "var(--color-bone-faint)", textTransform: "uppercase" }}>
              {name}
            </span>
            <span style={{ fontSize: "var(--text-xs)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {addr.slice(0, 10)}…{addr.slice(-6)}
              <ArrowSquareOut size={11} />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section
      style={{
        border: "1px dashed var(--color-border)",
        borderRadius: 16,
        padding: "48px 24px",
        textAlign: "center",
        background: "var(--color-raised)",
      }}
    >
      <p style={{ margin: 0, color: "var(--color-bone)", fontSize: "var(--text-sm)" }}>
        Stats are being collected. Check back in a moment.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/* LighthouseDeckAmbient — twilight-watchtower ambient over the      */
/* stats grid. Adds: 2 distant palm silhouettes (low opacity),       */
/* 2 cool-tinted twilight clouds (mint / sky), 2 seagulls (V-shape),  */
/* 1 jumping fish near the bottom, and a soft horizontal sweep beam   */
/* anchored to the right edge.  All position-absolute, pointer-events */
/* disabled, low opacity so the audit-grid stays readable above.      */
/* ---------------------------------------------------------------- */
function LighthouseDeckAmbient() {
  return (
    <div
      aria-hidden
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}
    >
      {/* Soft horizontal sweep beam — anchored to the lighthouse on the
          right edge, rotates slowly across the deck for a twilight feel */}
      <div
        style={{
          position: "absolute",
          top: "8%",
          right: "-15%",
          width: "60%",
          height: 70,
          background:
            "linear-gradient(90deg, " +
            "color-mix(in oklch, var(--color-honos-gold) 35%, transparent) 0%, " +
            "color-mix(in oklch, var(--color-honos-gold) 12%, transparent) 60%, " +
            "transparent 100%)",
          transformOrigin: "100% 50%",
          animation: "lighthouse-beam-rotate 22s ease-in-out infinite",
          opacity: 0.55,
          filter: "blur(6px)",
        }}
      />

      {/* Cool twilight clouds — mint + sky pastel, drifting */}
      <svg
        width="160"
        height="44"
        viewBox="0 0 160 44"
        style={{
          position: "absolute",
          top: "4%",
          left: "10%",
          opacity: 0.5,
          animation: "lighthouse-cloud-drift 52s linear infinite",
        }}
      >
        <ellipse cx="46" cy="22" rx="36" ry="10" fill="color-mix(in oklch, var(--color-pastel-mint) 50%, var(--color-bone))" />
        <ellipse cx="84" cy="18" rx="26" ry="7" fill="color-mix(in oklch, var(--color-pastel-mint) 50%, var(--color-bone))" />
      </svg>
      <svg
        width="130"
        height="40"
        viewBox="0 0 130 40"
        style={{
          position: "absolute",
          top: "16%",
          left: "44%",
          opacity: 0.45,
          animation: "lighthouse-cloud-drift 64s linear infinite",
          animationDelay: "-26s",
        }}
      >
        <ellipse cx="42" cy="22" rx="30" ry="8" fill="color-mix(in oklch, var(--color-pastel-sky) 55%, var(--color-bone))" />
        <ellipse cx="70" cy="18" rx="20" ry="6" fill="color-mix(in oklch, var(--color-pastel-sky) 55%, var(--color-bone))" />
      </svg>

      {/* Two seagulls — high in the sky, V-shape outline */}
      <svg
        width="38"
        height="14"
        viewBox="0 0 38 14"
        style={{
          position: "absolute",
          top: "10%",
          left: "26%",
          opacity: 0.55,
          animation: "lighthouse-gull-glide 38s linear infinite",
        }}
      >
        <path d="M 2 8 Q 7 2 12 7 Q 19 13 26 7 Q 31 2 36 8" stroke="var(--color-aureus-ink)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
      <svg
        width="32"
        height="12"
        viewBox="0 0 38 14"
        style={{
          position: "absolute",
          top: "6%",
          left: "60%",
          opacity: 0.5,
          animation: "lighthouse-gull-glide 46s linear infinite",
          animationDelay: "-18s",
        }}
      >
        <path d="M 2 8 Q 7 2 12 7 Q 19 13 26 7 Q 31 2 36 8" stroke="var(--color-aureus-ink)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>

      {/* Distant palm silhouettes — bottom corners, very low opacity */}
      <svg
        width="60"
        height="120"
        viewBox="0 0 60 120"
        style={{ position: "absolute", bottom: "4%", left: "3%", opacity: 0.32 }}
      >
        <path d="M 30 120 Q 28 80 32 40 Q 34 18 36 8" stroke="color-mix(in oklch, var(--color-aureus-ink) 60%, transparent)" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M 36 8 Q 14 0 4 12" stroke="color-mix(in oklch, var(--color-aureus-ink) 55%, transparent)" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 36 8 Q 50 0 60 12" stroke="color-mix(in oklch, var(--color-aureus-ink) 55%, transparent)" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 36 8 Q 22 -2 14 -6" stroke="color-mix(in oklch, var(--color-aureus-ink) 50%, transparent)" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 36 8 Q 44 -2 54 -6" stroke="color-mix(in oklch, var(--color-aureus-ink) 50%, transparent)" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>
      <svg
        width="44"
        height="90"
        viewBox="0 0 60 120"
        style={{ position: "absolute", bottom: "3%", left: "12%", opacity: 0.28 }}
      >
        <path d="M 30 120 Q 28 80 32 40 Q 34 18 36 8" stroke="color-mix(in oklch, var(--color-aureus-ink) 60%, transparent)" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M 36 8 Q 14 0 4 12" stroke="color-mix(in oklch, var(--color-aureus-ink) 55%, transparent)" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 36 8 Q 50 0 60 12" stroke="color-mix(in oklch, var(--color-aureus-ink) 55%, transparent)" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 36 8 Q 44 -2 54 -6" stroke="color-mix(in oklch, var(--color-aureus-ink) 50%, transparent)" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>

      {/* Jumping fish near the bottom — small splash on the left */}
      <svg
        width="40"
        height="26"
        viewBox="0 0 40 26"
        style={{
          position: "absolute",
          bottom: "7%",
          left: "40%",
          opacity: 0.7,
          animation: "lighthouse-fish-arc 21s ease-in-out infinite",
        }}
      >
        <ellipse cx="16" cy="14" rx="10" ry="4" fill="color-mix(in oklch, var(--color-pastel-sky) 60%, var(--color-bone))" />
        <path d="M 24 14 L 32 8 L 32 20 Z" fill="color-mix(in oklch, var(--color-pastel-sky) 60%, var(--color-bone))" />
        <circle cx="11" cy="12" r="1.2" fill="var(--color-aureus-ink)" />
      </svg>

      <style>{`
        @keyframes lighthouse-beam-rotate {
          0%, 100% { transform: rotate(-6deg); opacity: 0.55; }
          50%      { transform: rotate(8deg);  opacity: 0.72; }
        }
        @keyframes lighthouse-cloud-drift {
          0%   { transform: translateX(0); }
          100% { transform: translateX(70px); }
        }
        @keyframes lighthouse-gull-glide {
          0%   { transform: translateX(-10vw); }
          100% { transform: translateX(50vw); }
        }
        @keyframes lighthouse-fish-arc {
          0%, 82%, 100% { transform: translateY(24px) rotate(0); opacity: 0; }
          86%           { transform: translateY(-8px) rotate(-22deg); opacity: 1; }
          92%           { transform: translateY(-16px) rotate(8deg); opacity: 1; }
          97%           { transform: translateY(10px) rotate(28deg); opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}
