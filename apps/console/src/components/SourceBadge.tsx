import { Bank, Buildings, Globe, Newspaper, PaperPlaneTilt, User } from "@phosphor-icons/react/dist/ssr";

/// Visual badge that surfaces which source proposed a market — central bank
/// press release, trusted wire, Telegram channel, manual admin, etc. Lets users
/// judge market credibility at a glance.
///
/// `createdBy` value conventions (set by forum-scout or POST /markets caller):
///   "manual"               — admin / user (pnpm market:create)
///   "scout:ecb"            — European Central Bank press feed (TIER 1)
///   "scout:fed"            — US Federal Reserve press feed (TIER 1)
///   "scout:boe"            — Bank of England news feed (TIER 1)
///   "scout:bis"            — Bank for International Settlements speeches (TIER 1)
///   "scout:bbc"            — BBC Business (TIER 2)
///   "scout:investing"      — Investing.com FX news (TIER 2)
///   "scout:reuters"        — Reuters business wire (TIER 2)
///   "scout:tg:<channel>"   — public Telegram channel
///   "scout:other"          — uncategorised RSS source (low trust)

const SOURCE_META: Record<
  string,
  {
    label: string;
    tier: "official" | "trusted" | "social" | "manual";
    icon: typeof Bank;
  }
> = {
  manual: { label: "Manual", tier: "manual", icon: User },
  "scout:ecb": { label: "ECB Press", tier: "official", icon: Bank },
  "scout:fed": { label: "Federal Reserve", tier: "official", icon: Bank },
  "scout:boe": { label: "Bank of England", tier: "official", icon: Bank },
  "scout:bis": { label: "BIS Speeches", tier: "official", icon: Buildings },
  "scout:bbc": { label: "BBC Business", tier: "trusted", icon: Newspaper },
  "scout:investing": { label: "Investing.com", tier: "trusted", icon: Newspaper },
  "scout:reuters": { label: "Reuters", tier: "trusted", icon: Newspaper },
  "scout:other": { label: "Open feed", tier: "social", icon: Globe },
};

function metaForCreatedBy(createdBy: string): {
  label: string;
  tier: "official" | "trusted" | "social" | "manual";
  icon: typeof Bank;
} {
  if (SOURCE_META[createdBy]) return SOURCE_META[createdBy]!;
  // Telegram dynamic — scout:tg:<channel>
  if (createdBy.startsWith("scout:tg:")) {
    return {
      label: `t.me/${createdBy.replace(/^scout:tg:/, "")}`,
      tier: "social",
      icon: PaperPlaneTilt,
    };
  }
  // Generic scout fallback
  if (createdBy.startsWith("scout:")) {
    return { label: createdBy.replace(/^scout:/, ""), tier: "social", icon: Globe };
  }
  return { label: createdBy, tier: "manual", icon: User };
}

const TIER_COLORS = {
  official: {
    fg: "var(--color-outcome-yes)",
    bg: "color-mix(in oklch, var(--color-outcome-yes) 12%, transparent)",
    border: "color-mix(in oklch, var(--color-outcome-yes) 40%, var(--color-border))",
    note: "trusted · official",
  },
  trusted: {
    fg: "var(--color-honos-gold)",
    bg: "color-mix(in oklch, var(--color-honos-gold) 10%, transparent)",
    border: "color-mix(in oklch, var(--color-honos-gold) 35%, var(--color-border))",
    note: "trusted wire",
  },
  social: {
    fg: "var(--color-aureus-ink)",
    bg: "color-mix(in oklch, var(--color-aureus-ink) 10%, transparent)",
    border: "color-mix(in oklch, var(--color-aureus-ink) 30%, var(--color-border))",
    note: "social signal",
  },
  manual: {
    fg: "var(--color-bone-dim)",
    bg: "transparent",
    border: "var(--color-border)",
    note: "human-created",
  },
} as const;

/// Compact pill — for inline use in tables or row lists.
export function SourceBadge({ createdBy }: { createdBy: string }) {
  const meta = metaForCreatedBy(createdBy);
  const c = TIER_COLORS[meta.tier];
  const Icon = meta.icon;
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px 3px 7px",
        borderRadius: 999,
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.fg,
        fontSize: "var(--text-2xs)",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
      title={`Proposed by ${meta.label} · ${c.note}`}
    >
      <Icon size={11} weight="fill" />
      {meta.label}
    </span>
  );
}

/// Full-width banner — for market detail header, gives the credibility note inline.
export function SourceBadgeFull({ createdBy }: { createdBy: string }) {
  const meta = metaForCreatedBy(createdBy);
  const c = TIER_COLORS[meta.tier];
  const Icon = meta.icon;
  return (
    <div
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        borderRadius: 4,
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.fg,
        fontSize: "var(--text-2xs)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      <Icon size={13} weight="fill" />
      <span>Proposed by</span>
      <span style={{ fontWeight: 600, letterSpacing: "0.04em" }}>{meta.label}</span>
      <span style={{ color: "var(--color-bone-faint)", marginLeft: 4 }}>· {c.note}</span>
    </div>
  );
}

/// Footer-style "trust strip" — shows the registered source roster on landing
/// (or wherever the protocol's credibility statement lives).
export function SourceTrustStrip() {
  const sources = ["scout:ecb", "scout:fed", "scout:boe", "scout:bis", "scout:bbc"];
  return (
    <div
      className="mono"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: "var(--text-2xs)", letterSpacing: "0.12em", color: "var(--color-bone-faint)", textTransform: "uppercase" }}>
        Trusted sources
      </span>
      {sources.map((s) => (
        <SourceBadge key={s} createdBy={s} />
      ))}
    </div>
  );
}
