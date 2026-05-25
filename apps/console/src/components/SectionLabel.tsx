type Props = {
  children: React.ReactNode;
  /// Optional right-side annotation (e.g., "last update: 12s").
  meta?: React.ReactNode;
};

/// Section label: mono uppercase, --bone-dim, anchors a section without competing.
export function SectionLabel({ children, meta }: Props) {
  return (
    <div
      className="mono hairline-bottom"
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 24,
        padding: "0 0 16px",
        marginBottom: 28,
        fontSize: "var(--text-2xs)",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "var(--color-bone-dim)",
      }}
    >
      <span>{children}</span>
      {meta && (
        <span style={{ color: "var(--color-bone-faint)", letterSpacing: "0.08em" }}>
          {meta}
        </span>
      )}
    </div>
  );
}
