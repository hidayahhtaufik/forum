import {
  ArcIcon,
  CctpIcon,
  CircleIcon,
  EurcIcon,
  UsdcIcon,
  UsycIcon,
  X402Icon,
} from "./BrandIcons";

/// Thin pill row showing the Circle / Arc stack the platform integrates with.
/// Designed to drop in just under the PulauMap hero so first-glance viewers
/// see the credentials before scrolling into RevenueStats.

type Badge = {
  label: string;
  Icon: (p: { size?: number }) => React.JSX.Element;
  tint: string;
};

const BADGES: Badge[] = [
  { label: "Arc Testnet",  Icon: ArcIcon,    tint: "var(--color-pastel-lavender)" },
  { label: "USDC",         Icon: UsdcIcon,   tint: "var(--color-pastel-mint)" },
  { label: "EURC",         Icon: EurcIcon,   tint: "var(--color-pastel-sky)" },
  { label: "USYC",         Icon: UsycIcon,   tint: "var(--color-pastel-peach)" },
  { label: "CCTP V2",      Icon: CctpIcon,   tint: "var(--color-pastel-pink)" },
  { label: "x402",         Icon: X402Icon,   tint: "var(--color-pastel-sun)" },
  { label: "EIP-3009",     Icon: CircleIcon, tint: "var(--color-pastel-mint)" },
];

export function HeroBadges() {
  return (
    <section
      aria-label="Circle and Arc stack"
      style={{
        padding: "clamp(16px, 2.5vw, 28px) clamp(20px, 4vw, 56px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--color-bone-faint)",
        }}
      >
        Powered by the Circle stack on Arc
      </span>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          justifyContent: "center",
          maxWidth: 920,
        }}
      >
        {BADGES.map(({ label, Icon, tint }) => (
          <span
            key={label}
            className="mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: "var(--text-xs)",
              letterSpacing: "0.06em",
              color: "var(--color-bone)",
              background: `color-mix(in oklch, ${tint} 35%, var(--color-raised))`,
              border: `1px solid color-mix(in oklch, ${tint} 60%, var(--color-border))`,
            }}
          >
            <Icon size={14} />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}
