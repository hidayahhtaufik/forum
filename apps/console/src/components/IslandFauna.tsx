/// IslandFauna — drop-in animal life layer for any island scene.
///
/// Position-absolute, inset-0, pointer-events-none. Add to a scene
/// with `<IslandFauna scene="beach" />` and you get birds + scuttling
/// crabs + butterflies + jumping fish + falling coconuts appropriate
/// to the scene.
///
/// Variants pick which fauna make sense per scene:
///   - "beach"      — fish jumping, gulls, scuttling sand crabs, butterflies
///   - "arena"      — gulls overhead, no land animals (they'd clutter ropes)
///   - "workshop"   — butterflies + a single curious sand crab on the floor
///   - "marketplace"— butterflies + scuttling crabs near the tents
///   - "lighthouse" — gulls overhead, jumping fish on the horizon
///   - "pulau"      — full mix: gulls, walking crabs, butterflies, falling
///                    coconuts. The dashboard gets the most life.
///
/// All elements absolutely positioned with random offsets driven by the
/// `seed` prop so the same page always renders the same layout (no
/// hydration mismatch) but two adjacent scenes look different.

import type { ReactNode } from "react";

type Scene = "beach" | "arena" | "workshop" | "marketplace" | "lighthouse" | "pulau";

type Props = {
  scene: Scene;
  /** Number of duplicated bird/butterfly/etc loops. 1 = light, 3 = full life. */
  density?: 1 | 2 | 3;
  /** Stable seed for the per-page randomness. Different per scene avoids twinning. */
  seed?: number;
};

export function IslandFauna({ scene, density = 2, seed = 0 }: Props) {
  // The set of layers depends on the scene. Each layer is a self-contained
  // SVG with its own keyframe — they don't interact, so any combination
  // works. Layer order is z-index controlled in CSS.
  const layers: ReactNode[] = [];

  if (scene === "beach" || scene === "lighthouse" || scene === "pulau") {
    layers.push(<JumpingFish key="fish" seed={seed} count={density} />);
  }
  if (scene !== "workshop") {
    layers.push(<FlyingGulls key="gulls" seed={seed + 1} count={density + 1} />);
  }
  if (scene === "beach" || scene === "marketplace" || scene === "pulau" || scene === "workshop") {
    layers.push(<ScuttlingCrabs key="crabs" seed={seed + 2} count={scene === "pulau" ? 3 : 2} />);
  }
  if (scene !== "arena" && scene !== "lighthouse") {
    layers.push(<Butterflies key="butter" seed={seed + 3} count={density} />);
  }
  if (scene === "pulau") {
    layers.push(<FallingCoconuts key="coconut" seed={seed + 4} />);
  }

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 0,
      }}
    >
      {layers}
      <style>{`
        @keyframes fauna-gull-glide {
          0%   { transform: translateX(-12vw) translateY(0); }
          50%  { transform: translateX(56vw) translateY(-6px); }
          100% { transform: translateX(112vw) translateY(0); }
        }
        @keyframes fauna-fish-arc {
          0%, 80%, 100% { transform: translateY(40px) rotate(0); opacity: 0; }
          85%           { transform: translateY(-22px) rotate(-25deg); opacity: 1; }
          92%           { transform: translateY(-30px) rotate(10deg); opacity: 1; }
          97%           { transform: translateY(20px)  rotate(35deg); opacity: 0.6; }
        }
        @keyframes fauna-crab-scuttle {
          0%   { transform: translateX(-8vw); }
          50%  { transform: translateX(48vw); }
          100% { transform: translateX(108vw); }
        }
        @keyframes fauna-crab-step {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50%      { transform: translateY(-2px) rotate(3deg); }
        }
        @keyframes fauna-butterfly-drift {
          0%   { transform: translate(0, 0) rotate(0); }
          25%  { transform: translate(40px, -22px) rotate(-12deg); }
          50%  { transform: translate(80px, 6px) rotate(10deg); }
          75%  { transform: translate(38px, 28px) rotate(-6deg); }
          100% { transform: translate(0, 0) rotate(0); }
        }
        @keyframes fauna-butterfly-flap {
          0%, 100% { transform: scaleX(1); }
          50%      { transform: scaleX(0.4); }
        }
        @keyframes fauna-coconut-fall {
          0%, 70% { transform: translateY(0) rotate(0); opacity: 0; }
          71%     { opacity: 1; }
          85%     { transform: translateY(140px) rotate(120deg); opacity: 1; }
          95%     { transform: translateY(190px) rotate(200deg); opacity: 0.85; }
          100%    { transform: translateY(200px) rotate(220deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

/* ============================================================ */
/* Gulls — V-silhouettes drifting across the sky                  */
/* ============================================================ */
function FlyingGulls({ seed, count }: { seed: number; count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const top = 4 + ((seed * 13 + i * 7) % 18); // 4..22% from top
        const duration = 24 + ((seed + i * 5) % 14); // 24..38s
        const delay = -((seed + i * 11) % duration);
        return (
          <svg
            key={i}
            width="44"
            height="14"
            viewBox="0 0 44 14"
            style={{
              position: "absolute",
              top: `${top}%`,
              left: 0,
              animation: `fauna-gull-glide ${duration}s linear infinite`,
              animationDelay: `${delay}s`,
              opacity: 0.7,
            }}
          >
            <path
              d="M 2 8 Q 8 2 14 7 Q 22 14 30 7 Q 36 2 42 8"
              stroke="var(--color-aureus-ink)"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        );
      })}
    </>
  );
}

/* ============================================================ */
/* Jumping fish — silver arcs out of the water                    */
/* ============================================================ */
function JumpingFish({ seed, count }: { seed: number; count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const left = 8 + ((seed * 11 + i * 23) % 80);
        const bottom = 6 + ((seed + i * 4) % 18);
        const duration = 11 + ((seed + i * 3) % 8);
        const delay = -((seed * 7 + i * 5) % duration);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${left}%`,
              bottom: `${bottom}%`,
              animation: `fauna-fish-arc ${duration}s ease-in-out infinite`,
              animationDelay: `${delay}s`,
            }}
          >
            <svg width="34" height="20" viewBox="0 0 34 20">
              <ellipse cx="14" cy="10" rx="12" ry="5"
                fill="color-mix(in oklch, var(--color-pastel-sky) 50%, var(--color-bone))" />
              <path d="M 24 10 L 32 4 L 32 16 Z" fill="color-mix(in oklch, var(--color-pastel-sky) 50%, var(--color-bone))" />
              <circle cx="8" cy="8" r="1.4" fill="var(--color-aureus-ink)" />
              <path d="M 8 12 Q 12 13 16 12" stroke="var(--color-aureus-ink)" strokeWidth="0.8" fill="none" />
            </svg>
            {/* Splash */}
            <svg
              width="40" height="6" viewBox="0 0 40 6"
              style={{ position: "absolute", left: -3, top: 18, opacity: 0.7 }}
            >
              <ellipse cx="20" cy="3" rx="14" ry="2"
                fill="color-mix(in oklch, var(--color-pastel-sky) 70%, white)" />
            </svg>
          </div>
        );
      })}
    </>
  );
}

/* ============================================================ */
/* Scuttling crabs — small chibi crabs walking across the bottom  */
/* ============================================================ */
function ScuttlingCrabs({ seed, count }: { seed: number; count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const bottom = 3 + ((seed + i * 6) % 10);
        const duration = 28 + ((seed * 3 + i * 9) % 18);
        const delay = -((seed * 13 + i * 7) % duration);
        const size = 22 + ((seed + i * 2) % 10);
        const tint = i % 3 === 0
          ? "var(--color-honos-gold)"
          : i % 3 === 1
            ? "var(--color-tessera-oxblood)"
            : "color-mix(in oklch, var(--color-pastel-peach) 70%, var(--color-tessera-oxblood))";
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              bottom: `${bottom}%`,
              animation: `fauna-crab-scuttle ${duration}s linear infinite`,
              animationDelay: `${delay}s`,
            }}
          >
            <div
              style={{
                animation: `fauna-crab-step 0.4s ease-in-out infinite`,
                transformOrigin: "center bottom",
              }}
            >
              <svg width={size} height={size * 0.7} viewBox="0 0 40 28">
                {/* Claws */}
                <circle cx="8"  cy="12" r="4" fill={tint} />
                <circle cx="32" cy="12" r="4" fill={tint} />
                {/* Body */}
                <ellipse cx="20" cy="16" rx="9" ry="6" fill={tint} />
                {/* Eyes */}
                <circle cx="16" cy="11" r="1.6" fill="#1A1814" />
                <circle cx="24" cy="11" r="1.6" fill="#1A1814" />
                {/* Legs */}
                <path d="M 12 22 L 8 26 M 16 23 L 14 27 M 24 23 L 26 27 M 28 22 L 32 26"
                  stroke={tint} strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ============================================================ */
/* Butterflies — pastel wings drifting in figure-8                */
/* ============================================================ */
function Butterflies({ seed, count }: { seed: number; count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const top = 20 + ((seed * 5 + i * 19) % 50);
        const left = 12 + ((seed + i * 17) % 70);
        const duration = 8 + ((seed + i * 3) % 5);
        const delay = -((seed + i * 9) % duration);
        const wingTint = i % 2 === 0
          ? "color-mix(in oklch, var(--color-honos-gold) 75%, var(--color-on-gold))"
          : "color-mix(in oklch, var(--color-tessera-oxblood) 65%, var(--color-pastel-peach))";
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: `${top}%`,
              left: `${left}%`,
              animation: `fauna-butterfly-drift ${duration}s ease-in-out infinite`,
              animationDelay: `${delay}s`,
            }}
          >
            {/* Two wings — each gets its own flap so they meet in the middle */}
            <svg width="22" height="18" viewBox="0 0 22 18">
              <g style={{ animation: "fauna-butterfly-flap 0.35s ease-in-out infinite", transformOrigin: "11px 9px" }}>
                <ellipse cx="6"  cy="6" rx="5" ry="4" fill={wingTint} opacity="0.85" />
                <ellipse cx="6"  cy="12" rx="4" ry="3" fill={wingTint} opacity="0.75" />
              </g>
              <g style={{ animation: "fauna-butterfly-flap 0.35s ease-in-out infinite reverse", transformOrigin: "11px 9px" }}>
                <ellipse cx="16" cy="6" rx="5" ry="4" fill={wingTint} opacity="0.85" />
                <ellipse cx="16" cy="12" rx="4" ry="3" fill={wingTint} opacity="0.75" />
              </g>
              {/* Body */}
              <line x1="11" y1="3" x2="11" y2="15" stroke="var(--color-aureus-ink)" strokeWidth="1.4" />
              {/* Antennae */}
              <path d="M 11 3 Q 9 0 7 1 M 11 3 Q 13 0 15 1" stroke="var(--color-aureus-ink)" strokeWidth="0.8" fill="none" />
            </svg>
          </div>
        );
      })}
    </>
  );
}

/* ============================================================ */
/* Falling coconuts — palms drop coconuts in dashboard            */
/* ============================================================ */
function FallingCoconuts({ seed }: { seed: number }) {
  // Two coconuts falling from different palm positions
  const positions: Array<{ left: string; top: string; duration: number; delay: number }> = [
    { left: "12%", top: "28%", duration: 17, delay: -((seed * 3) % 17) },
    { left: "82%", top: "32%", duration: 22, delay: -((seed * 7) % 22) },
  ];
  return (
    <>
      {positions.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: p.left,
            top: p.top,
            animation: `fauna-coconut-fall ${p.duration}s ease-in infinite`,
            animationDelay: `${p.delay}s`,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="6" fill="#5A3416" />
            <ellipse cx="5" cy="5" rx="2" ry="1.2" fill="#7A4B22" opacity="0.7" />
          </svg>
        </div>
      ))}
    </>
  );
}
