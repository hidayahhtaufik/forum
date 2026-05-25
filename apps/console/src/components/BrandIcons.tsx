/// Custom inline-SVG icons for the Circle / Arc stack we integrate with.
/// Monochrome by default so they pick up `currentColor` and fit the
/// surrounding text/badge. Each icon is hand-drawn to be recognizable
/// without infringing on official brand assets.

type IconProps = { size?: number; className?: string; title?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": true as const,
});

export function ArcIcon({ size = 18, className, title }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 14.5c2.3-3 4.6-5 7-5s4.7 2 7 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="9.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function CircleIcon({ size = 18, className, title }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function UsdcIcon({ size = 18, className, title }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 7v1.2M12 15.8V17M9.5 14.4c.4.8 1.3 1.4 2.5 1.4 1.4 0 2.5-.7 2.5-2 0-1.2-.9-1.7-2.5-2-1.6-.3-2.5-.8-2.5-2 0-1.3 1.1-2 2.5-2 1.2 0 2.1.6 2.5 1.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EurcIcon({ size = 18, className, title }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M15.2 9.4c-.6-.9-1.7-1.4-2.9-1.4-2.2 0-3.9 1.7-3.9 4s1.7 4 3.9 4c1.2 0 2.3-.5 2.9-1.4M7.5 11h6M7.5 13h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function UsycIcon({ size = 18, className, title }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 8l2.5 4L8 16M16 8l-2.5 4L16 16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 7v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CctpIcon({ size = 18, className, title }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      {title ? <title>{title}</title> : null}
      <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9 10.5h6M15 13.5H9M14 9.2l1.5 1.3-1.5 1.3M10 14.8L8.5 13.5l1.5-1.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function X402Icon({ size = 18, className, title }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      {title ? <title>{title}</title> : null}
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.5" />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontSize="6"
        fontFamily="ui-monospace, monospace"
        fontWeight="700"
        fill="currentColor"
      >
        402
      </text>
    </svg>
  );
}

export function CheckIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path
        d="M5 12l4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
