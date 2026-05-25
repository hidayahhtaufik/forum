"use client";

/// Chibi crab sprites for the five FORUM agents — Oracle, Sage, Hermes, Augur, Mirror.
/// Each agent is a 16×16 pixel crab: 2 stalk eyes, 2 raised claws, 6 legs at the bottom,
/// blush dots on the body, and a signature accessory (halo / hood / wing / third-eye /
/// mirror-seam) marking identity. Tropical-coherent with the SharkPool visual + Bahama
/// palette per docs/MARKETPLACE.md.
///
/// Animation (Tier A ambient per docs/ANIMATION_ARCHITECTURE.md):
///   - Idle: gentle breathe + ±2° scuttle sway over 2.4s
///   - Signal mood (bet.placed): scale pulse 0.6s × 2
///   - Happy mood (post-bet / post-claim): mouth curves up
///   - Thinking mood: two accent dots pulse above the head
///
/// API unchanged from pre-redesign version — every existing consumer keeps working.

import { useEffect, useState } from "react";
import type { AgentName } from "@/lib/agent-sprites";

export type AgentMood = "idle" | "thinking" | "happy" | "sad" | "signal";

type SpriteDef = {
  /** Pastel fill from globals.css palette */
  bodyColor: string;
  /** Optional accent stroke color */
  accent: string;
  /** Pixel coordinates that compose the sprite — see body of the file for the grid. */
  body: Array<[number, number]>;
  /** Eye positions (drawn as 1×1 dark pixels) */
  eyes: Array<[number, number]>;
  /** Mouth pixels (per mood — idle key is required) */
  mouth: { idle: Array<[number, number]>; happy?: Array<[number, number]>; sad?: Array<[number, number]> };
  /** Signature accessory (halo, hood, smirk, third-eye, mirror — drawn over body) */
  accessory?: Array<{ x: number; y: number; color: string }>;
  /** Eye glow color when thinking (over the dark eyes) */
  thinkingEyeColor?: string;
};

/// Chibi mouth shapes — small, expressive, anchored at row 8 (body mid).
const chibiMouth = {
  idle: [[7, 8], [8, 8]] as Array<[number, number]>,
  happy: [[6, 8], [7, 9], [8, 9], [9, 8]] as Array<[number, number]>, // smile curve
  happyWide: [[5, 8], [6, 9], [7, 9], [8, 9], [9, 9], [10, 8]] as Array<[number, number]>, // grin
  sad: [[6, 9], [7, 8], [8, 8], [9, 9]] as Array<[number, number]>, // frown
};

/// Universal blush dots on body — softens silhouette and adds chibi expression.
function blush(color: string): Array<{ x: number; y: number; color: string }> {
  return [
    { x: 5, y: 7, color },
    { x: 10, y: 7, color },
  ];
}

/// The standard chibi crab silhouette — body + stalks + claws + legs. All 5 agents
/// share this base; per-agent identity comes from bodyColor + accessory layered on top.
function crabBody(): Array<[number, number]> {
  return [
    // Eye stalks (1px wide, rising from body)
    [6, 3], [9, 3],
    [6, 4], [9, 4],
    // Body top edge (narrower)
    [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
    // Body widest row
    [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [11, 6], [12, 6],
    // Body mid (blush overlays at 5,10 — still body color underneath)
    [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7], [11, 7], [12, 7],
    // Body lower (mouth overlay at 7-8 — body color underneath)
    [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [11, 8], [12, 8],
    // Body bottom edge (narrower)
    [4, 9], [5, 9], [6, 9], [7, 9], [8, 9], [9, 9], [10, 9], [11, 9],
    // Left claw — top arm, middle, tip
    [1, 5], [2, 5],
    [0, 6], [1, 6],
    [0, 7],
    // Right claw — mirror of left
    [13, 5], [14, 5],
    [14, 6], [15, 6],
    [15, 7],
    // Legs — 6 little dots underneath body
    [2, 10], [4, 10], [6, 10], [9, 10], [11, 10], [13, 10],
  ];
}

/// 16×16 grid. Coordinates are (col, row), origin top-left.
/// Each crab has: 2 raised claws (cols 0-2 + 13-15, rows 5-7), oval body (cols 3-12,
/// rows 5-9), 2 stalk eyes (col 6 + col 9, rows 3-4), 6 legs (row 10), mouth at
/// row 8 cols 7-8, blush dots at row 7 cols 5+10. Per-agent accessory differs.
const SPRITES: Record<AgentName, SpriteDef> = {
  // Oracle — sun-haloed scholar crab. Gold halo above stalk eyes.
  oracle: {
    bodyColor: "var(--color-pastel-sun)",
    accent: "var(--color-honos-gold)",
    body: crabBody(),
    eyes: [[6, 3], [9, 3]],
    mouth: { idle: chibiMouth.idle, happy: chibiMouth.happy, sad: chibiMouth.sad },
    accessory: [
      // Halo arc — 6 gold pixels above stalks
      { x: 5, y: 1, color: "var(--color-honos-gold)" },
      { x: 6, y: 1, color: "var(--color-honos-gold)" },
      { x: 7, y: 1, color: "var(--color-honos-gold)" },
      { x: 8, y: 1, color: "var(--color-honos-gold)" },
      { x: 9, y: 1, color: "var(--color-honos-gold)" },
      { x: 10, y: 1, color: "var(--color-honos-gold)" },
      { x: 4, y: 2, color: "var(--color-honos-gold)" },
      { x: 11, y: 2, color: "var(--color-honos-gold)" },
      ...blush("var(--color-pastel-pink)"),
    ],
    thinkingEyeColor: "var(--color-honos-gold)",
  },
  // Sage — hooded zen-monk crab. Dark-mint hood covers top of head + stalks.
  sage: {
    bodyColor: "var(--color-pastel-mint)",
    accent: "var(--color-outcome-yes)",
    body: crabBody(),
    eyes: [[6, 3], [9, 3]],
    mouth: { idle: chibiMouth.idle, happy: chibiMouth.happy, sad: chibiMouth.sad },
    accessory: [
      // Hood band over top of body
      { x: 4, y: 5, color: "var(--color-outcome-yes)" },
      { x: 5, y: 5, color: "var(--color-outcome-yes)" },
      { x: 6, y: 5, color: "var(--color-outcome-yes)" },
      { x: 7, y: 5, color: "var(--color-outcome-yes)" },
      { x: 8, y: 5, color: "var(--color-outcome-yes)" },
      { x: 9, y: 5, color: "var(--color-outcome-yes)" },
      { x: 10, y: 5, color: "var(--color-outcome-yes)" },
      { x: 11, y: 5, color: "var(--color-outcome-yes)" },
      // Hood sides (drape down)
      { x: 4, y: 6, color: "var(--color-outcome-yes)" },
      { x: 11, y: 6, color: "var(--color-outcome-yes)" },
      ...blush("var(--color-pastel-pink)"),
    ],
    thinkingEyeColor: "var(--color-outcome-yes)",
  },
  // Hermes — trickster crab with wing-feather accents on the claws.
  hermes: {
    bodyColor: "var(--color-pastel-pink)",
    accent: "var(--color-tessera-oxblood)",
    body: crabBody(),
    eyes: [[6, 3], [9, 3]],
    mouth: { idle: chibiMouth.idle, happy: chibiMouth.happyWide, sad: chibiMouth.sad },
    accessory: [
      // Wing feathers above each claw
      { x: 0, y: 4, color: "var(--color-tessera-oxblood)" },
      { x: 1, y: 4, color: "var(--color-tessera-oxblood)" },
      { x: 14, y: 4, color: "var(--color-tessera-oxblood)" },
      { x: 15, y: 4, color: "var(--color-tessera-oxblood)" },
      // Tiny feather caps above stalks
      { x: 5, y: 2, color: "var(--color-tessera-oxblood)" },
      { x: 10, y: 2, color: "var(--color-tessera-oxblood)" },
      ...blush("var(--color-tessera-oxblood)"), // deeper pink stands out on pastel-pink body
    ],
    thinkingEyeColor: "var(--color-tessera-oxblood)",
  },
  // Augur — seer crab with a third eye on the shell.
  augur: {
    bodyColor: "var(--color-pastel-sky)",
    accent: "var(--color-aureus-ink)",
    body: crabBody(),
    eyes: [[6, 3], [9, 3]],
    mouth: { idle: chibiMouth.idle, happy: chibiMouth.happy, sad: chibiMouth.sad },
    accessory: [
      // Third eye centered on shell
      { x: 7, y: 6, color: "var(--color-aureus-ink)" },
      { x: 8, y: 6, color: "var(--color-bone)" },
      { x: 9, y: 6, color: "var(--color-aureus-ink)" },
      ...blush("var(--color-pastel-pink)"),
    ],
    thinkingEyeColor: "var(--color-aureus-ink)",
  },
  // Mirror — copy-trader crab with a vertical reflection seam down the shell.
  mirror: {
    bodyColor: "var(--color-pastel-lavender)",
    accent: "var(--color-aureus-ink)",
    body: crabBody(),
    eyes: [[6, 3], [9, 3]],
    mouth: { idle: chibiMouth.idle, happy: chibiMouth.happy, sad: chibiMouth.sad },
    accessory: [
      // Vertical mirror seam down shell center
      { x: 8, y: 5, color: "var(--color-aureus-ink)" },
      { x: 8, y: 7, color: "var(--color-aureus-ink)" },
      { x: 8, y: 9, color: "var(--color-aureus-ink)" },
      ...blush("var(--color-pastel-pink)"),
    ],
    thinkingEyeColor: "var(--color-aureus-ink)",
  },
};

/// Subscribe to the global "forum-event" CustomEvent for a given agent address.
/// Returns the agent's live mood, which sequences itself: signal → happy → idle on
/// bet.placed, happy → idle on claim.fired.
function useAgentEmote(address: string | undefined): AgentMood {
  const [mood, setMood] = useState<AgentMood>("idle");
  useEffect(() => {
    if (!address) return;
    const target = address.toLowerCase();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const reset = () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
    };
    const handler = (e: Event) => {
      const event = (e as CustomEvent).detail as
        | { type: string; agentAddress?: string; sender?: string }
        | undefined;
      if (!event) return;
      if (event.type === "bet.placed" && event.agentAddress?.toLowerCase() === target) {
        reset();
        setMood("signal");
        timers.push(setTimeout(() => setMood("happy"), 1200));
        timers.push(setTimeout(() => setMood("idle"), 3500));
      } else if (event.type === "claim.fired" && event.agentAddress?.toLowerCase() === target) {
        reset();
        setMood("happy");
        timers.push(setTimeout(() => setMood("idle"), 3000));
      } else if (event.type === "agent.broadcast" && event.sender?.toLowerCase() === target) {
        // Agent just broadcast — show thinking pulse briefly.
        reset();
        setMood("thinking");
        timers.push(setTimeout(() => setMood("idle"), 2000));
      }
    };
    window.addEventListener("forum-event", handler);
    return () => {
      window.removeEventListener("forum-event", handler);
      reset();
    };
  }, [address]);
  return mood;
}

/// Renders one agent at the given display size. Size is the final CSS pixel width/height;
/// the underlying SVG is always a 16×16 viewBox so output is crisp at any scale.
export function AgentSprite({
  name,
  size = 64,
  mood: explicitMood,
  showOutline = false,
  address,
}: {
  name: AgentName;
  size?: number;
  /** Force a specific mood. When set, overrides SSE-driven emote. */
  mood?: AgentMood;
  /** Render a 1-pixel accent stroke around the silhouette. Default off — at
   *  small sizes (32px) the rendered outline reads as stray dots, so we ship
   *  the silhouette clean and let the pastel body fill carry the shape. */
  showOutline?: boolean;
  /** Agent address. When set, the sprite auto-emotes on bet.placed/claim.fired SSE events. */
  address?: string;
}) {
  const autoMood = useAgentEmote(address);
  const mood: AgentMood = explicitMood ?? autoMood;
  const sprite = SPRITES[name];

  // Pick mouth based on mood. Falls back to idle if mood-specific frame is undefined.
  const mouth =
    (mood === "happy" && sprite.mouth.happy) ||
    (mood === "sad" && sprite.mouth.sad) ||
    sprite.mouth.idle;

  // Eye styling — `thinking` glows in accent color, `sad` uses default but lower row.
  const eyeColor = mood === "thinking" ? sprite.thinkingEyeColor ?? "currentColor" : "var(--color-ground)";
  const eyeFill = mood === "thinking" ? sprite.thinkingEyeColor ?? "var(--color-honos-gold)" : "var(--color-ground)";

  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        animation: mood === "signal" ? "spritePulse 0.6s ease-out 2" : "spriteBreath 2.4s ease-in-out infinite",
        transformOrigin: "center bottom",
        imageRendering: "pixelated",
      }}
      aria-label={`${name} agent sprite`}
    >
      <svg
        viewBox="0 0 16 16"
        width={size}
        height={size}
        shapeRendering="crispEdges"
        style={{ display: "block" }}
      >
        {/* Body pixels */}
        {sprite.body.map(([x, y], i) => (
          <rect key={`body-${i}`} x={x} y={y} width={1} height={1} fill={sprite.bodyColor} />
        ))}

        {/* Outline (thin darker border around body silhouette) */}
        {showOutline && <BodyOutline body={sprite.body} accent={sprite.accent} />}

        {/* Accessory (halo, hood, smirk, third eye, mirror seam) */}
        {sprite.accessory?.map((p, i) => (
          <rect key={`acc-${i}`} x={p.x} y={p.y} width={1} height={1} fill={p.color} />
        ))}

        {/* Eyes — pupils on stalk tops. Sad mood drops the pupil 1 row (looking down). */}
        {mood === "sad"
          ? sprite.eyes.map(([x, y], i) => (
              <rect key={`eye-${i}`} x={x} y={y + 1} width={1} height={1} fill={eyeColor} />
            ))
          : sprite.eyes.map(([x, y], i) => (
              <rect key={`eye-${i}`} x={x} y={y} width={1} height={1} fill={eyeFill} />
            ))}

        {/* Mouth */}
        {mouth.map(([x, y], i) => (
          <rect key={`mouth-${i}`} x={x} y={y} width={1} height={1} fill="var(--color-ground)" />
        ))}

        {/* Thinking ring overlay — pulsing accent dot above head */}
        {mood === "thinking" && (
          <>
            <rect x={7} y={1} width={1} height={1} fill={sprite.thinkingEyeColor ?? sprite.accent}>
              <animate attributeName="opacity" values="0;1;0" dur="1.2s" repeatCount="indefinite" />
            </rect>
            <rect x={8} y={1} width={1} height={1} fill={sprite.thinkingEyeColor ?? sprite.accent}>
              <animate attributeName="opacity" values="0;1;0" dur="1.2s" begin="0.3s" repeatCount="indefinite" />
            </rect>
          </>
        )}
      </svg>

      {/* Inline keyframes — scoped to this <span> so they don't leak into globals.
          spriteBreath = chibi scuttle sway (scale + slight rotation) so the crab feels
          alive even when nothing's happening. spritePulse fires on bet.placed signal. */}
      <style>{`
        @keyframes spriteBreath {
          0%, 100% { transform: scale(1) rotate(-2deg); }
          50%      { transform: scale(1.06) rotate(2deg); }
        }
        @keyframes spritePulse {
          0%   { transform: scale(1) rotate(0); }
          30%  { transform: scale(1.25) rotate(-6deg); }
          60%  { transform: scale(0.96) rotate(6deg); }
          100% { transform: scale(1) rotate(0); }
        }
      `}</style>
    </span>
  );
}

/// Cheap outline: any body pixel adjacent (4-neighbor) to a non-body cell gets a 1-pixel
/// dark border on that side. Built once per render — sprites are small so this is fine.
function BodyOutline({ body, accent }: { body: Array<[number, number]>; accent: string }) {
  const set = new Set(body.map(([x, y]) => `${x},${y}`));
  const edges: Array<{ x: number; y: number }> = [];
  // Treat the boundary as outside. Add a 1-pixel ring around the silhouette.
  for (const [x, y] of body) {
    const neighbors: Array<[number, number]> = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (!set.has(`${nx},${ny}`)) edges.push({ x: nx, y: ny });
    }
  }
  // De-dupe
  const seen = new Set<string>();
  return (
    <>
      {edges
        .filter((e) => {
          const k = `${e.x},${e.y}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((e, i) => (
          <rect key={`edge-${i}`} x={e.x} y={e.y} width={1} height={1} fill={accent} opacity={0.45} />
        ))}
    </>
  );
}

