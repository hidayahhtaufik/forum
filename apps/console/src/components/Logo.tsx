/// FORUM brand mark v2 — chunky cream chibi crab on a coral coin.
/// v1 had too much detail packed into 28px → read as a black blob.
/// v2 = BOLD silhouette, white-on-coral high contrast (Bahama Bucks pattern),
/// recognizable as a crab at 20px and up.
///
/// Composition:
///   - Coin: solid disc, coral in light theme + amber-gold in dark (--color-honos-gold)
///   - Halo ring: faint outer stroke for definition on busy backgrounds
///   - Crab silhouette: CREAM/bg colored (--color-bg / cream) — high contrast pop
///   - Big oval body, two raised round claws, two thick stalk eyes
///   - Black pupils inside white iris dots — eyes "look" at the viewer
///   - Wide smile + cheek blush dots for chibi cuteness
///
/// All theme-aware via CSS vars. Renders crisp from 16px (favicon) to 256px (OG image).

export function Logo({
  size = 28,
  withWordmark = false,
}: {
  size?: number;
  withWordmark?: boolean;
}) {
  if (withWordmark) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
        <LogoGlyph size={size} />
        <span
          className="mono"
          style={{
            fontSize: "var(--text-sm)",
            letterSpacing: "0.18em",
            fontWeight: 500,
            color: "var(--color-bone)",
          }}
        >
          FORUM
        </span>
      </span>
    );
  }
  return <LogoGlyph size={size} />;
}

function LogoGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden
      focusable="false"
      style={{ display: "block" }}
    >
      {/* Coin face */}
      <circle cx="20" cy="20" r="18.5" fill="var(--color-honos-gold)" />
      {/* Subtle inset highlight */}
      <circle
        cx="20"
        cy="18"
        r="17"
        stroke="color-mix(in oklch, white 30%, transparent)"
        strokeWidth="0.6"
        fill="none"
      />
      {/* Outer halo ring */}
      <circle
        cx="20"
        cy="20"
        r="19.4"
        stroke="color-mix(in oklch, var(--color-honos-gold) 70%, transparent)"
        strokeWidth="1"
        fill="none"
      />

      {/* ====== CRAB — cream silhouette over coin ====== */}

      {/* Two raised claws (round, like waving hands) */}
      <circle cx="9.5" cy="17" r="3.6" fill="var(--color-bg)" />
      <circle cx="30.5" cy="17" r="3.6" fill="var(--color-bg)" />
      {/* Pincer slits on each claw */}
      <path d="M 7.2 17 L 9.8 17" stroke="var(--color-honos-gold)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 30.2 17 L 32.8 17" stroke="var(--color-honos-gold)" strokeWidth="1.4" strokeLinecap="round" />

      {/* Body — chunky oval */}
      <ellipse cx="20" cy="23" rx="9" ry="6.5" fill="var(--color-bg)" />

      {/* Eye stalks — thick rounded rects rising from body */}
      <rect x="14.5" y="11" width="2.2" height="6" rx="1.1" fill="var(--color-bg)" />
      <rect x="23.3" y="11" width="2.2" height="6" rx="1.1" fill="var(--color-bg)" />

      {/* Eye whites — round, big enough to read */}
      <circle cx="15.6" cy="11" r="2.2" fill="var(--color-bg)" />
      <circle cx="24.4" cy="11" r="2.2" fill="var(--color-bg)" />
      {/* Pupils */}
      <circle cx="15.6" cy="11" r="1" fill="var(--color-on-gold)" />
      <circle cx="24.4" cy="11" r="1" fill="var(--color-on-gold)" />
      {/* Pupil highlight (the glint that says "alive") */}
      <circle cx="16" cy="10.6" r="0.4" fill="var(--color-bg)" />
      <circle cx="24.8" cy="10.6" r="0.4" fill="var(--color-bg)" />

      {/* Cheek blush */}
      <circle cx="14" cy="24.5" r="1.2" fill="color-mix(in oklch, var(--color-pastel-pink) 80%, var(--color-honos-gold))" />
      <circle cx="26" cy="24.5" r="1.2" fill="color-mix(in oklch, var(--color-pastel-pink) 80%, var(--color-honos-gold))" />

      {/* Smile — happy mouth curve */}
      <path
        d="M 17 24.5 Q 20 27 23 24.5"
        stroke="var(--color-on-gold)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Legs — small dots peeking out below body */}
      <circle cx="13" cy="29" r="0.9" fill="var(--color-bg)" />
      <circle cx="16.5" cy="29.5" r="0.9" fill="var(--color-bg)" />
      <circle cx="23.5" cy="29.5" r="0.9" fill="var(--color-bg)" />
      <circle cx="27" cy="29" r="0.9" fill="var(--color-bg)" />
    </svg>
  );
}
