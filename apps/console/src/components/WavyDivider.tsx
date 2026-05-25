/// Organic curved section divider — Bahama-Bucks style. SVG path with a soft
/// asymmetric wave. Flips upside-down via `flip` prop so adjacent sections can
/// share a continuous curve. Uses a fill color from the design tokens so a
/// theme swap propagates automatically.
///
/// Usage:
///   <WavyDivider />          // wave bulging down, fills with --color-raised
///   <WavyDivider flip />     // wave bulging up
///   <WavyDivider fill="var(--color-pastel-mint)" tone={0.3} />

type Props = {
  flip?: boolean;
  /** Tailwind-token color string. Defaults to a faint mint paper above bg. */
  fill?: string;
  /** Mix amount with transparent (0..1). 1 = solid fill. */
  tone?: number;
  /** Pixel height of the wave band. */
  height?: number;
};

export function WavyDivider({ flip = false, fill, tone = 0.55, height = 90 }: Props) {
  const color = fill ?? "var(--color-pastel-mint)";
  // color-mix percentage from tone (clamped 0..100)
  const mix = Math.max(0, Math.min(100, Math.round(tone * 100)));
  const computed = `color-mix(in oklch, ${color} ${mix}%, transparent)`;

  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        width: "100%",
        height,
        transform: flip ? "scaleY(-1)" : undefined,
        pointerEvents: "none",
        lineHeight: 0,
      }}
    >
      <svg
        viewBox="0 0 1440 90"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ display: "block" }}
      >
        {/* Asymmetric wave — looks hand-drawn, not engineered. Two control
            points per segment so the crest sits left of center. */}
        <path
          d="M0,30 C220,80 420,0 720,40 C980,72 1180,18 1440,52 L1440,90 L0,90 Z"
          fill={computed}
        />
        {/* A second, fainter wave shifted right — depth without busyness. */}
        <path
          d="M0,55 C240,90 520,30 760,60 C1020,90 1240,40 1440,72 L1440,90 L0,90 Z"
          fill={`color-mix(in oklch, ${color} ${Math.round(mix * 0.5)}%, transparent)`}
        />
      </svg>
    </div>
  );
}
