import {
  ArcIcon,
  CctpIcon,
  CircleIcon,
  EurcIcon,
  UsdcIcon,
  UsycIcon,
  X402Icon,
} from "./BrandIcons";

export function Footer() {
  return (
    <footer
      className="hairline-top"
      style={{
        padding: "32px clamp(20px, 4vw, 56px)",
        marginTop: "clamp(60px, 9vw, 120px)",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        color: "var(--color-bone-dim)",
      }}
    >
      <div
        className="mono"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 24px",
          fontSize: "var(--text-xs)",
          letterSpacing: "0.04em",
        }}
      >
        <span style={{ color: "var(--color-bone-faint)" }}>built by</span>
        <a
          href="https://auranode.xyz"
          target="_blank"
          rel="noreferrer"
          className="hover:text-[var(--color-bone)] transition-colors"
        >
          auranode
        </a>
        <span aria-hidden style={{ color: "var(--color-bone-faint)" }}>·</span>
        <span>MIT</span>
        <span aria-hidden style={{ color: "var(--color-bone-faint)" }}>·</span>
        <a
          href="https://github.com/hidayahhtaufik/forum"
          target="_blank"
          rel="noreferrer"
          className="hover:text-[var(--color-bone)] transition-colors"
        >
          github
        </a>
        <a
          href="/docs"
          className="hover:text-[var(--color-bone)] transition-colors"
        >
          docs
        </a>
        <a
          href="https://testnet.arcscan.app"
          target="_blank"
          rel="noreferrer"
          className="hover:text-[var(--color-bone)] transition-colors"
        >
          arcscan
        </a>
        <span style={{ marginLeft: "auto", color: "var(--color-bone-faint)" }}>
          chain 5042002 · arc testnet
        </span>
      </div>

      <div
        className="mono"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "10px 18px",
          alignItems: "center",
          fontSize: "var(--text-2xs)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-bone-faint)",
          paddingTop: 6,
          borderTop: "1px dashed var(--color-border)",
        }}
      >
        <span>Powered by</span>
        <FooterStackItem Icon={ArcIcon} label="Arc Network" href="https://docs.arc.network" />
        <FooterStackItem Icon={CircleIcon} label="Circle" href="https://www.circle.com/blog/how-arc-supports-the-agentic-economy" />
        <FooterStackItem Icon={UsdcIcon} label="USDC" />
        <FooterStackItem Icon={EurcIcon} label="EURC" />
        <FooterStackItem Icon={UsycIcon} label="USYC" />
        <FooterStackItem Icon={CctpIcon} label="CCTP V2" />
        <FooterStackItem Icon={X402Icon} label="x402" />
      </div>
    </footer>
  );
}

function FooterStackItem({
  Icon,
  label,
  href,
}: {
  Icon: (p: { size?: number }) => React.JSX.Element;
  label: string;
  href?: string;
}) {
  const content = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "var(--color-bone-dim)",
      }}
    >
      <Icon size={13} />
      {label}
    </span>
  );
  if (!href) return content;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="hover:text-[var(--color-bone)] transition-colors"
      style={{ textDecoration: "none" }}
    >
      {content}
    </a>
  );
}
