/// ArenaLobbyBackdrop — calmer arena-on-an-island scene that sits BEHIND the
/// /markets header (not on top of). Two stone gateposts with hanging banners,
/// sand floor with subtle crab tracks, palm trees on the corners of the sand,
/// gentle sky gradient (not the previous nuclear-orange disaster). Designed
/// to be `position: absolute; inset: 0` inside a relative parent so the page
/// header text + chips render in normal flow on top.

export function ArenaLobbyBackdrop() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        zIndex: 0,
        background:
          "linear-gradient(180deg, " +
          "color-mix(in oklch, var(--color-pastel-sky) 65%, var(--color-bg)) 0%, " +
          "color-mix(in oklch, var(--color-pastel-sky) 40%, var(--color-bg)) 55%, " +
          "color-mix(in oklch, var(--color-pastel-sun) 35%, var(--color-bg)) 75%, " +
          "color-mix(in oklch, var(--color-pastel-peach) 40%, var(--color-bg)) 100%)",
      }}
    >
      <svg
        viewBox="0 0 1200 480"
        preserveAspectRatio="xMidYMax meet"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        <defs>
          <linearGradient id="stone-arch-v2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--color-bone) 95%, var(--color-pastel-peach))" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--color-bone) 78%, var(--color-tessera-oxblood))" />
          </linearGradient>
          <linearGradient id="sand-floor-v2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="color-mix(in oklch, var(--color-pastel-sun) 65%, var(--color-pastel-peach))" />
            <stop offset="100%" stopColor="color-mix(in oklch, var(--color-pastel-peach) 75%, var(--color-tessera-oxblood))" />
          </linearGradient>
          <pattern id="banner-stripe-v2" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="3" height="6" fill="var(--color-honos-gold)" />
            <rect x="3" width="3" height="6" fill="var(--color-tessera-oxblood)" />
          </pattern>
        </defs>

        {/* Distant cloud band */}
        <g style={{ animation: "drift-slow 80s linear infinite", opacity: 0.5 }}>
          <ellipse cx="240" cy="50" rx="48" ry="10" fill="color-mix(in oklch, var(--color-raised) 92%, white)" />
          <ellipse cx="280" cy="46" rx="32" ry="8" fill="color-mix(in oklch, var(--color-raised) 92%, white)" />
        </g>
        <g style={{ animation: "drift-slow 110s linear infinite", animationDelay: "-30s", opacity: 0.4 }}>
          <ellipse cx="880" cy="70" rx="58" ry="12" fill="color-mix(in oklch, var(--color-raised) 90%, white)" />
        </g>

        {/* SAND FLOOR — only the lower ~30% so the header has clear sky room */}
        <path d="M 0 360 L 1200 360 L 1200 480 L 0 480 Z" fill="url(#sand-floor-v2)" />
        {/* Footprint trail across the sand */}
        <g fill="color-mix(in oklch, var(--color-tessera-oxblood) 35%, transparent)" opacity="0.45">
          {Array.from({ length: 16 }).map((_, i) => (
            <circle key={i} cx={80 + i * 70} cy={420 + (i % 3) * 6} r="1.4" />
          ))}
        </g>
        {/* Sand dunes (subtle waves on the surface) */}
        <path d="M 0 360 Q 200 354 400 360 T 800 360 T 1200 360"
          stroke="color-mix(in oklch, var(--color-tessera-oxblood) 25%, transparent)"
          strokeWidth="1.2" fill="none" opacity="0.45" />

        {/* LEFT GATEPOST + banner */}
        <g>
          <rect x="130" y="220" width="46" height="160" fill="url(#stone-arch-v2)"
            stroke="color-mix(in oklch, var(--color-tessera-oxblood) 30%, var(--color-bone))" strokeWidth="1.3" />
          {/* Capital + base */}
          <rect x="120" y="210" width="66" height="14" rx="2"
            fill="color-mix(in oklch, var(--color-bone) 78%, var(--color-tessera-oxblood))" />
          <rect x="120" y="378" width="66" height="14" rx="2"
            fill="color-mix(in oklch, var(--color-bone) 78%, var(--color-tessera-oxblood))" />
          {/* Brick lines */}
          {[0, 1, 2, 3, 4].map((i) => (
            <line key={i} x1="130" y1={250 + i * 26} x2="176" y2={250 + i * 26}
              stroke="color-mix(in oklch, var(--color-tessera-oxblood) 35%, transparent)" strokeWidth="0.7" />
          ))}
          {/* Hanging banner */}
          <g style={{ animation: "banner-flap-v2 6s ease-in-out infinite", transformOrigin: "153px 216px" }}>
            <path d="M 134 216 L 134 304 L 144 294 L 153 304 L 162 294 L 172 304 L 172 216 Z"
              fill="url(#banner-stripe-v2)" opacity="0.88" />
            <path d="M 134 216 L 172 216"
              stroke="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" strokeWidth="2" />
          </g>
        </g>

        {/* RIGHT GATEPOST + banner */}
        <g>
          <rect x="1024" y="220" width="46" height="160" fill="url(#stone-arch-v2)"
            stroke="color-mix(in oklch, var(--color-tessera-oxblood) 30%, var(--color-bone))" strokeWidth="1.3" />
          <rect x="1014" y="210" width="66" height="14" rx="2"
            fill="color-mix(in oklch, var(--color-bone) 78%, var(--color-tessera-oxblood))" />
          <rect x="1014" y="378" width="66" height="14" rx="2"
            fill="color-mix(in oklch, var(--color-bone) 78%, var(--color-tessera-oxblood))" />
          {[0, 1, 2, 3, 4].map((i) => (
            <line key={i} x1="1024" y1={250 + i * 26} x2="1070" y2={250 + i * 26}
              stroke="color-mix(in oklch, var(--color-tessera-oxblood) 35%, transparent)" strokeWidth="0.7" />
          ))}
          <g style={{ animation: "banner-flap-v2 6s ease-in-out infinite", animationDelay: "-2s", transformOrigin: "1047px 216px" }}>
            <path d="M 1028 216 L 1028 304 L 1038 294 L 1047 304 L 1056 294 L 1066 304 L 1066 216 Z"
              fill="url(#banner-stripe-v2)" opacity="0.88" />
            <path d="M 1028 216 L 1066 216"
              stroke="color-mix(in oklch, var(--color-tessera-oxblood) 60%, var(--color-bone))" strokeWidth="2" />
          </g>
        </g>

        {/* Palm trees rooted in the sand — anchor at the bottom corners */}
        <PalmTree x={60}  y={380} />
        <PalmTree x={1140} y={380} flip />

        {/* Three flying birds */}
        <g style={{ animation: "drift-slow 70s linear infinite", opacity: 0.55 }}>
          <path d="M 360 110 q 4 -4 8 0 q 4 -4 8 0" stroke="var(--color-aureus-ink)" strokeWidth="1.4" fill="none" />
          <path d="M 420 100 q 4 -4 8 0 q 4 -4 8 0" stroke="var(--color-aureus-ink)" strokeWidth="1.4" fill="none" />
          <path d="M 780 130 q 4 -4 8 0 q 4 -4 8 0" stroke="var(--color-aureus-ink)" strokeWidth="1.4" fill="none" />
        </g>

        <style>{`
          @keyframes banner-flap-v2 {
            0%, 100% { transform: skewX(-2deg); }
            50%      { transform: skewX(4deg); }
          }
        `}</style>
      </svg>
    </div>
  );
}

function PalmTree({ x, y, flip }: { x: number; y: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x}, ${y - 130})${flip ? " scale(-1, 1)" : ""}`}>
      {/* Trunk */}
      <path d="M 0 130 Q 4 70 12 16" stroke="#6B3F1F" strokeWidth="8" fill="none" strokeLinecap="round" />
      {/* Fronds */}
      <path d="M 12 14 Q -20 4 -42 22 Q -2 14 4 32" fill="color-mix(in oklch, var(--color-outcome-yes) 68%, var(--color-aureus-ink))" />
      <path d="M 12 14 Q 44 4 70 22 Q 30 14 20 32" fill="color-mix(in oklch, var(--color-outcome-yes) 60%, var(--color-aureus-ink))" />
      <path d="M 12 14 Q 6 -16 -8 -28 Q 14 -4 22 22" fill="color-mix(in oklch, var(--color-outcome-yes) 72%, var(--color-aureus-ink))" />
      <path d="M 12 14 Q 32 -16 54 -26 Q 30 -2 22 24" fill="color-mix(in oklch, var(--color-outcome-yes) 64%, var(--color-aureus-ink))" />
      {/* Coconut */}
      <circle cx="10" cy="20" r="2.4" fill="#4a2b16" />
    </g>
  );
}
