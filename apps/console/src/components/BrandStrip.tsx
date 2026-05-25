import { ArcIcon, CctpIcon, CircleIcon } from "./BrandIcons";

/// Three-column "built on" strip. Each cell pairs an icon with a one-line
/// claim that maps to a real shipped feature. Designed to anchor the landing
/// after the PulauMap so judges quickly see the chain + Circle stack story.

type Cell = {
  Icon: (p: { size?: number }) => React.JSX.Element;
  title: string;
  body: string;
  accent: string;
};

const CELLS: Cell[] = [
  {
    Icon: ArcIcon,
    title: "Built on Arc Network",
    body: "Stablecoin-native L1. USDC gas, deterministic sub-second finality, opt-in privacy.",
    accent: "var(--color-pastel-lavender)",
  },
  {
    Icon: CircleIcon,
    title: "Powered by Circle",
    body: "USDC settled · EURC collateral · USYC yield surface · CCTP V2 bridge · Brand Kit. Five Circle integrations.",
    accent: "var(--color-pastel-mint)",
  },
  {
    Icon: CctpIcon,
    title: "Cross-chain liquidity",
    body: "Fund your agent from Base via CCTP V2 burn-and-mint, ~12s settlement on Arc.",
    accent: "var(--color-pastel-sky)",
  },
];

export function BrandStrip() {
  return (
    <section
      aria-label="Stack credentials"
      style={{
        padding: "clamp(40px, 6vw, 80px) clamp(20px, 4vw, 56px)",
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span
            className="mono"
            style={{
              fontSize: "var(--text-2xs)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--color-bone-faint)",
            }}
          >
            The agentic economy stack
          </span>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              color: "var(--color-bone)",
              fontSize: "clamp(28px, 4vw, 44px)",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Built on Arc.{" "}
            <span style={{ color: "var(--color-honos-gold)" }}>Powered by Circle</span>.
          </h2>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {CELLS.map(({ Icon, title, body, accent }) => (
            <article
              key={title}
              style={{
                padding: 20,
                background: "var(--color-raised)",
                border: "1px solid var(--color-border)",
                borderRadius: 16,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: `color-mix(in oklch, ${accent} 35%, var(--color-bg))`,
                  border: `1px solid color-mix(in oklch, ${accent} 60%, var(--color-border))`,
                  color: "var(--color-bone)",
                }}
              >
                <Icon size={22} />
              </span>
              <h3
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-lg)",
                  fontWeight: 600,
                  color: "var(--color-bone)",
                  margin: 0,
                  letterSpacing: "-0.01em",
                }}
              >
                {title}
              </h3>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--color-bone-dim)",
                  margin: 0,
                  lineHeight: 1.55,
                }}
              >
                {body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
