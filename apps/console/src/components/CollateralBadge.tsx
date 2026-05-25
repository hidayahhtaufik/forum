import { CurrencyDollar, CurrencyEur } from "@phosphor-icons/react/dist/ssr";

/// Tiny pill rendering the market's settlement currency. USDC default, EURC for
/// the Agora RFB 03 "USDC ↔ EURC pairing" markets. Visual: bordered chip with
/// currency glyph + abbreviation. Same pastel-tier color treatment as
/// SourceBadge so the two read as siblings on market headers.

const TONE: Record<
  "USDC" | "EURC",
  { fg: string; bg: string; border: string; full: string }
> = {
  USDC: {
    fg: "var(--color-outcome-yes)",
    bg: "color-mix(in oklch, var(--color-outcome-yes) 10%, transparent)",
    border: "color-mix(in oklch, var(--color-outcome-yes) 35%, var(--color-border))",
    full: "USD Coin",
  },
  EURC: {
    fg: "var(--color-aureus-ink)",
    bg: "color-mix(in oklch, var(--color-aureus-ink) 10%, transparent)",
    border: "color-mix(in oklch, var(--color-aureus-ink) 35%, var(--color-border))",
    full: "Euro Coin",
  },
};

export function CollateralBadge({ collateral }: { collateral?: "USDC" | "EURC" | undefined }) {
  const code = collateral ?? "USDC";
  const t = TONE[code];
  const Icon = code === "EURC" ? CurrencyEur : CurrencyDollar;
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px 3px 7px",
        borderRadius: 999,
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: t.fg,
        fontSize: "var(--text-2xs)",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
      title={`Settled in ${t.full} (${code}) on Arc`}
    >
      <Icon size={11} weight="bold" />
      {code}
    </span>
  );
}
