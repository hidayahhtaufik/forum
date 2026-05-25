import { CaretUp, CaretDown } from "@phosphor-icons/react/dist/ssr";

type Props = {
  outcome: 0 | 1;
  /// Optional percentage to suffix (e.g. "50.2%").
  pct?: string;
  size?: "sm" | "md";
};

export function OutcomeBadge({ outcome, pct, size = "sm" }: Props) {
  const isYes = outcome === 1;
  const color = isYes ? "var(--color-outcome-yes)" : "var(--color-outcome-no)";
  const label = isYes ? "YES" : "NO";
  const Icon = isYes ? CaretUp : CaretDown;

  return (
    <span
      className="mono inline-flex items-center gap-1 rounded-sm"
      style={{
        backgroundColor: isYes
          ? "color-mix(in oklch, var(--color-outcome-yes) 12%, transparent)"
          : "color-mix(in oklch, var(--color-outcome-no) 12%, transparent)",
        color,
        padding: size === "md" ? "3px 8px" : "2px 6px",
        fontSize: size === "md" ? "var(--text-sm)" : "var(--text-xs)",
        fontWeight: 500,
        lineHeight: 1,
      }}
    >
      <Icon size={size === "md" ? 14 : 11} weight="fill" aria-hidden />
      <span>{label}</span>
      {pct && <span className="opacity-70">{pct}</span>}
    </span>
  );
}
