import { CheckIcon } from "./BrandIcons";

/// Visual map of the eight Arc "agentic economy" properties FORUM ships.
/// Source: Circle's blueprint blog post (2026-05-08) — using the exact
/// vocabulary judges recognize. Each property maps to a concrete shipped
/// feature so the section reads as evidence, not aspiration.

const PROPERTIES: Array<{ label: string; evidence: string }> = [
  {
    label: "Stablecoin-native gas",
    evidence: "EIP-3009 zero-gas USDC settlement",
  },
  {
    label: "Sub-second finality",
    evidence: "Arc Testnet ~1s tx · 60s agent tick",
  },
  {
    label: "Programmable settlement",
    evidence: "LMSR contracts · Resolver · claim flow",
  },
  {
    label: "Opt-in privacy",
    evidence: "AES-256-GCM encrypted traces · sha256-pinned",
  },
  {
    label: "Nanopayments",
    evidence: "0.05 USDC trace bets · 0.10 USDC rent",
  },
  {
    label: "AI-mediated marketplace",
    evidence: "Spawn · rent · sell · copy-trade · meta-bet",
  },
  {
    label: "Multi-agent coordination",
    evidence: "signed peer broadcasts",
  },
  {
    label: "Machine-to-machine flows",
    evidence: "Renter wallet → agent wallet · scout autopilot",
  },
];

export function ArcPropertiesCallout() {
  return (
    <section
      aria-label="Arc agentic-economy properties FORUM ships"
      style={{
        padding: "clamp(48px, 6vw, 80px) clamp(20px, 4vw, 56px)",
      }}
    >
      <div
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 32,
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span
            className="mono"
            style={{
              fontSize: "var(--text-2xs)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--color-bone-faint)",
            }}
          >
            Arc · Agentic Economy Blueprint
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
            Eight of nine properties{" "}
            <span style={{ color: "var(--color-honos-gold)" }}>shipped</span>.
          </h2>
          <p
            style={{
              color: "var(--color-bone-dim)",
              maxWidth: "60ch",
              margin: 0,
              lineHeight: 1.55,
              fontSize: "var(--text-base)",
            }}
          >
            Circle's blueprint defines nine properties for autonomous agent
            commerce. FORUM lands eight on Arc Testnet today (the ninth — physical
            IoT — is out of scope for prediction markets).
          </p>
        </header>

        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {PROPERTIES.map(({ label, evidence }) => (
            <li
              key={label}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "14px 16px",
                background: "var(--color-raised)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  background:
                    "color-mix(in oklch, var(--color-outcome-yes) 22%, transparent)",
                  color: "var(--color-outcome-yes)",
                  flexShrink: 0,
                }}
              >
                <CheckIcon size={14} />
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  style={{
                    color: "var(--color-bone)",
                    fontWeight: 600,
                    fontSize: "var(--text-sm)",
                  }}
                >
                  {label}
                </span>
                <span
                  className="mono"
                  style={{
                    color: "var(--color-bone-dim)",
                    fontSize: "var(--text-2xs)",
                    letterSpacing: "0.02em",
                  }}
                >
                  {evidence}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
