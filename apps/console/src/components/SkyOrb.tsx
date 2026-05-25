/// SkyOrb — real sun (light mode) / real moon + stars (dark mode) sky element.
/// Renders BOTH SVGs and lets `[data-theme]` CSS in globals.css hide the
/// inactive one. Works on any server-rendered island scene without needing
/// the client-side theme state.
///
/// Usage:
///   <SkyOrb position="top-right" size={140} />
///
/// CSS in globals.css already toggles visibility via:
///   [data-theme="light"] [data-sky="moon"]  { display: none; }
///   [data-theme="dark"]  [data-sky="sun"]   { display: none; }

type Props = {
  size?: number;
  /** Optional absolute-position override; defaults to top-right of the parent. */
  position?: { top?: string | number; left?: string | number; right?: string | number; bottom?: string | number };
  /** Z-index — default 0 so the orb sits BEHIND interactive elements. */
  zIndex?: number;
};

export function SkyOrb({ size = 140, position, zIndex = 0 }: Props) {
  const wrapStyle: React.CSSProperties = {
    position: "absolute",
    top: position?.top ?? "6%",
    right: position?.right ?? "8%",
    left: position?.left,
    bottom: position?.bottom,
    width: size,
    height: size,
    pointerEvents: "none",
    zIndex,
  };

  return (
    <div style={wrapStyle} aria-hidden>
      <Sun size={size} />
      <Moon size={size} />
    </div>
  );
}

/* ---------------- Sun (light mode) ---------------- */

function Sun({ size }: { size: number }) {
  return (
    <svg
      data-sky="sun"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ position: "absolute", inset: 0, animation: "sun-rotate 60s linear infinite" }}
    >
      {/* Outer halo */}
      <circle cx="50" cy="50" r="40" fill="#FFEFA3" opacity="0.32" />
      {/* Glow ring */}
      <circle cx="50" cy="50" r="32" fill="#FFD24B" opacity="0.55" />
      {/* Solid sun */}
      <circle cx="50" cy="50" r="22" fill="#F8B23A" />
      {/* Highlight */}
      <ellipse cx="44" cy="44" rx="6" ry="4" fill="#FFE69A" opacity="0.7" />
      {/* 12 rays */}
      <g stroke="#F2A024" strokeWidth="2.4" strokeLinecap="round">
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 30 * Math.PI) / 180;
          const x1 = 50 + Math.cos(angle) * 30;
          const y1 = 50 + Math.sin(angle) * 30;
          const x2 = 50 + Math.cos(angle) * 40;
          const y2 = 50 + Math.sin(angle) * 40;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>
      {/* Smile + dots so it reads as a friendly crab-island sun */}
      <circle cx="44" cy="48" r="1.4" fill="#7A4B12" />
      <circle cx="56" cy="48" r="1.4" fill="#7A4B12" />
      <path d="M 44 55 Q 50 60 56 55" stroke="#7A4B12" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------- Moon + stars (dark mode) ---------------- */

function Moon({ size }: { size: number }) {
  return (
    <svg
      data-sky="moon"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ position: "absolute", inset: 0 }}
    >
      <defs>
        <radialGradient id="moon-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#F4F0E3" stopOpacity="0.5" />
          <stop offset="60%" stopColor="#F4F0E3" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#F4F0E3" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Soft halo */}
      <circle cx="50" cy="50" r="42" fill="url(#moon-glow)" />
      {/* Moon body */}
      <circle cx="50" cy="50" r="24" fill="#F4F0E3" />
      {/* Crescent shadow — gives "real moon" look without going full crescent */}
      <circle cx="58" cy="48" r="22" fill="#1A1814" opacity="0.22" />
      {/* Craters */}
      <circle cx="44" cy="46" r="2.6" fill="#1A1814" opacity="0.15" />
      <circle cx="48" cy="56" r="1.8" fill="#1A1814" opacity="0.13" />
      <circle cx="39" cy="54" r="1.5" fill="#1A1814" opacity="0.12" />
      <circle cx="52" cy="42" r="1.2" fill="#1A1814" opacity="0.12" />
      {/* Sleepy crab face — eyes closed, smile */}
      <path d="M 42 48 Q 44 47 46 48" stroke="#1A1814" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M 54 48 Q 56 47 58 48" stroke="#1A1814" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M 46 56 Q 50 58 54 56" stroke="#1A1814" strokeWidth="1.4" fill="none" strokeLinecap="round" />

      {/* Stars scattered around the moon */}
      <g fill="#F4F0E3" style={{ animation: "twinkle 4s ease-in-out infinite" }}>
        <Star cx={14} cy={18} size={2.2} />
        <Star cx={86} cy={28} size={1.6} />
        <Star cx={8} cy={62} size={1.4} />
        <Star cx={92} cy={70} size={2.0} />
        <Star cx={22} cy={86} size={1.8} />
        <Star cx={78} cy={88} size={1.2} />
      </g>
    </svg>
  );
}

function Star({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  return (
    <path
      d={`M ${cx} ${cy - size} L ${cx + size * 0.3} ${cy - size * 0.3} L ${cx + size} ${cy} L ${cx + size * 0.3} ${cy + size * 0.3} L ${cx} ${cy + size} L ${cx - size * 0.3} ${cy + size * 0.3} L ${cx - size} ${cy} L ${cx - size * 0.3} ${cy - size * 0.3} Z`}
    />
  );
}
