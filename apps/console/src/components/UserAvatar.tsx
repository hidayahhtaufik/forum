/// Deterministic chibi-crab avatar for ANY EVM address. Matches the 5 named-agent
/// crabs (Oracle / Sage / Hermes / Augur / Mirror) so leaderboards stay visually
/// uniform — every wallet shows up as a crab, only the body color + accent shifts.
///
/// Per-address determinism:
///   - Body color: one of 6 pastels, picked from address bytes[0]
///   - Accent dot color: deeper accent paired to the body color
///   - Accent position: one of 5 spots on the shell, picked from bytes[1]
///   - Mouth: idle or happy, picked from bytes[2]
///
/// Same crab silhouette as AgentSprite.tsx (intentional — single visual language).
/// Server-safe: pure SVG render, no hooks, no client state.

const VIEW = 16;

/// 6 pastel body colors + matching accents. Body color is picked per-address so
/// the same wallet always renders the same color across all surfaces.
const PALETTE = [
  { body: "var(--color-pastel-pink)",     accent: "var(--color-tessera-oxblood)" },
  { body: "var(--color-pastel-peach)",    accent: "var(--color-honos-gold)" },
  { body: "var(--color-pastel-sun)",      accent: "var(--color-honos-gold)" },
  { body: "var(--color-pastel-mint)",     accent: "var(--color-outcome-yes)" },
  { body: "var(--color-pastel-sky)",      accent: "var(--color-aureus-ink)" },
  { body: "var(--color-pastel-lavender)", accent: "var(--color-aureus-ink)" },
] as const;

/// Standard chibi crab silhouette — must match crabBody() in AgentSprite.tsx.
/// Body + stalks + claws + legs in one array.
const CRAB_BODY: Array<[number, number]> = [
  // Eye stalks
  [6, 3], [9, 3],
  [6, 4], [9, 4],
  // Body top edge
  [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
  // Body widest row
  [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [11, 6], [12, 6],
  // Body mid
  [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7], [11, 7], [12, 7],
  // Body lower
  [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [11, 8], [12, 8],
  // Body bottom edge
  [4, 9], [5, 9], [6, 9], [7, 9], [8, 9], [9, 9], [10, 9], [11, 9],
  // Left claw
  [1, 5], [2, 5],
  [0, 6], [1, 6],
  [0, 7],
  // Right claw
  [13, 5], [14, 5],
  [14, 6], [15, 6],
  [15, 7],
  // Legs
  [2, 10], [4, 10], [6, 10], [9, 10], [11, 10], [13, 10],
];

const CRAB_EYES: Array<[number, number]> = [[6, 3], [9, 3]];
const MOUTH_IDLE: Array<[number, number]> = [[7, 8], [8, 8]];
const MOUTH_HAPPY: Array<[number, number]> = [[6, 8], [7, 9], [8, 9], [9, 8]];
const BLUSH: Array<[number, number]> = [[5, 7], [10, 7]];

/// 5 possible accent positions on the shell — one extra colored pixel marking
/// this specific wallet's "personality". Eyes + mouth stay fixed; only this dot
/// differs across addresses.
const ACCENT_SPOTS: Array<[number, number]> = [
  [7, 6],  // center-top of shell
  [4, 6],  // left-edge of shell
  [11, 6], // right-edge of shell
  [8, 6],  // center-right
  [5, 8],  // lower-left
];

function hashBytes(addr: string): number[] {
  const clean = addr.toLowerCase().replace(/^0x/, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length && bytes.length < 20; i += 2) {
    const v = parseInt(clean.slice(i, i + 2), 16);
    if (!Number.isNaN(v)) bytes.push(v);
  }
  while (bytes.length < 20) bytes.push(0);
  return bytes;
}

export function UserAvatar({
  address,
  size = 32,
}: {
  address: string;
  size?: number;
}) {
  const bytes = hashBytes(address);
  const palette = PALETTE[bytes[0]! % PALETTE.length]!;
  const accentSpot = ACCENT_SPOTS[bytes[1]! % ACCENT_SPOTS.length]!;
  const happyMouth = (bytes[2]! % 2) === 0;
  const mouth = happyMouth ? MOUTH_HAPPY : MOUTH_IDLE;

  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        animation: "userAvatarBreath 2.4s ease-in-out infinite",
        transformOrigin: "center bottom",
        imageRendering: "pixelated",
      }}
      aria-label={`trader ${address.slice(0, 6)}…`}
    >
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} width={size} height={size} shapeRendering="crispEdges">
        {/* Crab body */}
        {CRAB_BODY.map(([x, y], i) => (
          <rect key={`b-${i}`} x={x} y={y} width={1} height={1} fill={palette.body} />
        ))}
        {/* Blush */}
        {BLUSH.map(([x, y], i) => (
          <rect key={`bl-${i}`} x={x} y={y} width={1} height={1} fill="var(--color-pastel-pink)" />
        ))}
        {/* Per-address accent dot */}
        <rect x={accentSpot[0]} y={accentSpot[1]} width={1} height={1} fill={palette.accent} />
        {/* Eyes (pupils on stalks) */}
        {CRAB_EYES.map(([x, y], i) => (
          <rect key={`e-${i}`} x={x} y={y} width={1} height={1} fill="var(--color-ground)" />
        ))}
        {/* Mouth */}
        {mouth.map(([x, y], i) => (
          <rect key={`m-${i}`} x={x} y={y} width={1} height={1} fill="var(--color-ground)" />
        ))}
      </svg>
      {/* Same scuttle-sway rhythm as the named agent crabs. */}
      <style>{`
        @keyframes userAvatarBreath {
          0%, 100% { transform: scale(1) rotate(-2deg); }
          50%      { transform: scale(1.06) rotate(2deg); }
        }
      `}</style>
    </span>
  );
}
