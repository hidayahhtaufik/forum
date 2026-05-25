"use client";

/// Minimap — collapsible LEFT-side navigation panel. Default state = collapsed
/// (just an icon trigger). Click to expand the full island map with all 7
/// destinations. Position: top-left, below the Logo.
///
/// Replaces the previous top-center floating minimap which was visually weird
/// and ate horizontal space on every page.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CaretRight, CaretLeft } from "@phosphor-icons/react";
import { Logo } from "./Logo";

type Location = {
  href: string;
  label: string;
  short: string;
  /** Position on the minimap island, as % of viewBox 200x140 */
  x: number;
  y: number;
  matches: (path: string) => boolean;
};

const LOCATIONS: Location[] = [
  { href: "/",                       label: "Dashboard",    short: "🗺️",  x: 100, y: 12,  matches: (p) => p === "/" },
  { href: "/markets",                label: "Arena",        short: "🏟️",  x: 100, y: 56,  matches: (p) => p.startsWith("/markets") },
  { href: "/protocol/stats",         label: "Lighthouse",   short: "🗼",   x: 170, y: 50,  matches: (p) => p.startsWith("/protocol") },
  { href: "/docs",                   label: "Workshop",     short: "🛠️",  x: 38,  y: 56,  matches: (p) => p.startsWith("/docs") },
  { href: "/marketplace",            label: "Marketplace",  short: "🛒",  x: 155, y: 92,  matches: (p) => p.startsWith("/marketplace") },
  { href: "/agents",                 label: "Beach",        short: "🏖️",  x: 70,  y: 102, matches: (p) => p.startsWith("/agents") },
  { href: "/console",                label: "Your Crab",    short: "🦀",  x: 115, y: 108, matches: (p) => p.startsWith("/console") },
];

export function Minimap() {
  const pathname = usePathname() ?? "/";
  const current = LOCATIONS.find((l) => l.matches(pathname));
  const [open, setOpen] = useState(false);

  // Auto-collapse when navigating
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!open) {
    // COLLAPSED — single pill containing Logo + current location.
    // Combines what used to be 2 separate pills (Logo + Minimap) into one.
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open island map · currently at ${current?.label ?? "Pulau FORUM"}`}
        title={`Island map · You are at ${current?.label ?? "Pulau FORUM"}`}
        style={{
          position: "absolute",
          top: 16,
          left: 20,
          zIndex: 50,
          padding: "8px 14px 8px 8px",
          borderRadius: 999,
          background: "color-mix(in oklch, var(--color-raised) 92%, transparent)",
          border: "1.5px solid var(--color-border)",
          backdropFilter: "blur(8px)",
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          color: "var(--color-bone)",
          boxShadow: "0 4px 12px color-mix(in oklch, var(--color-aureus-ink) 18%, transparent)",
          transition: "transform 180ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateX(2px)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "translateX(0)"; }}
      >
        <Logo size={28} />
        <span aria-hidden style={{
          width: 1, height: 18, background: "var(--color-border)", margin: "0 2px",
        }} />
        <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
          {current?.short ?? "🗺️"}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            color: "var(--color-bone)",
            fontWeight: 600,
          }}
        >
          {current?.label ?? "Island"}
        </span>
        <CaretRight size={14} weight="bold" />
      </button>
    );
  }

  // EXPANDED — full minimap panel
  return (
    <>
      {/* Backdrop dimmer */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in oklch, var(--color-aureus-ink) 30%, transparent)",
          backdropFilter: "blur(2px)",
          zIndex: 49,
          cursor: "pointer",
        }}
      />
      <nav
        aria-label="Island navigation"
        style={{
          position: "absolute",
          top: 16,
          left: 20,
          zIndex: 50,
          padding: 16,
          borderRadius: 20,
          background: "color-mix(in oklch, var(--color-raised) 96%, transparent)",
          border: "1.5px solid var(--color-border)",
          backdropFilter: "blur(8px)",
          boxShadow: "0 8px 28px color-mix(in oklch, var(--color-aureus-ink) 28%, transparent)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: 260,
        }}
      >
        {/* Header with FORUM brand */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Logo size={24} />
            <span
              className="mono"
              style={{
                fontSize: 11,
                letterSpacing: "0.18em",
                color: "var(--color-bone)",
                fontWeight: 700,
              }}
            >
              FORUM · Island
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close map"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-bone-dim)",
              cursor: "pointer",
              padding: 4,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <CaretLeft size={14} weight="bold" />
          </button>
        </div>

        {/* Mini island visualization — every coloured dot is a clickable hotspot */}
        <svg
          width="220"
          height="148"
          viewBox="0 0 200 140"
          role="img"
          aria-label="Pulau FORUM map. Click a location dot to navigate."
          style={{ display: "block", overflow: "visible" }}
        >
          {/* Water */}
          <ellipse cx="100" cy="70" rx="94" ry="60"
            fill="color-mix(in oklch, var(--color-pastel-sky) 35%, var(--color-bg))" />
          {/* Island */}
          <ellipse cx="100" cy="70" rx="76" ry="46"
            fill="color-mix(in oklch, var(--color-pastel-sun) 60%, var(--color-bg))" />
          {/* Dotted path */}
          <ellipse cx="100" cy="70" rx="62" ry="34"
            fill="none"
            stroke="color-mix(in oklch, var(--color-honos-gold) 55%, transparent)"
            strokeWidth="1.2"
            strokeDasharray="3 3" />

          {/* Location hotspots — each dot is a Link with hover scale + glow + tooltip */}
          {LOCATIONS.map((loc) => {
            const isCurrent = current?.href === loc.href;
            return (
              <Link key={loc.href} href={loc.href} aria-label={`Go to ${loc.label}`}>
                <g
                  className="minimap-hotspot"
                  style={{
                    cursor: "pointer",
                    transformBox: "fill-box",
                    transformOrigin: "center",
                  }}
                >
                  {/* Native SVG tooltip for accessibility */}
                  <title>{loc.label}</title>
                  {/* Invisible hit-target — wider than the visible dot for easier clicking */}
                  <circle cx={loc.x} cy={loc.y} r={10} fill="transparent" />
                  {/* Glow halo — only visible on hover (and always on the current dot) */}
                  <circle
                    className="minimap-glow"
                    cx={loc.x}
                    cy={loc.y}
                    r={11}
                    fill={isCurrent ? "var(--color-honos-gold)" : "var(--color-bone)"}
                    opacity={isCurrent ? 0.28 : 0}
                    style={{
                      filter: "blur(3px)",
                      transition: "opacity 160ms ease",
                      pointerEvents: "none",
                    }}
                  />
                  {/* Visible dot */}
                  <circle
                    className="minimap-dot"
                    cx={loc.x}
                    cy={loc.y}
                    r={isCurrent ? 7 : 5}
                    fill={isCurrent ? "var(--color-honos-gold)" : "color-mix(in oklch, var(--color-aureus-ink) 60%, var(--color-raised))"}
                    stroke={isCurrent ? "var(--color-on-gold)" : "transparent"}
                    strokeWidth="1.5"
                    style={{
                      transition: "r 160ms ease, transform 160ms ease",
                      animation: isCurrent ? "minimap-current-pulse 1.6s ease-in-out infinite" : undefined,
                      transformBox: "fill-box",
                      transformOrigin: "center",
                    }}
                  />
                </g>
              </Link>
            );
          })}
        </svg>
        <style>{`
          .minimap-hotspot:hover .minimap-dot {
            transform: scale(1.35);
          }
          .minimap-hotspot:hover .minimap-glow {
            opacity: 0.55 !important;
          }
          @keyframes minimap-current-pulse {
            0%, 100% { transform: scale(1);    opacity: 1;   }
            50%      { transform: scale(1.15); opacity: 0.8; }
          }
        `}</style>

        {/* Locations list — buttons */}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {LOCATIONS.map((loc) => {
            const isCurrent = current?.href === loc.href;
            return (
              <li key={loc.href}>
                <Link
                  href={loc.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: isCurrent
                      ? "color-mix(in oklch, var(--color-honos-gold) 16%, transparent)"
                      : "transparent",
                    border: `1px solid ${isCurrent ? "var(--color-honos-gold)" : "transparent"}`,
                    textDecoration: "none",
                    color: isCurrent ? "var(--color-honos-gold)" : "var(--color-bone)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    transition: "background 150ms ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = "color-mix(in oklch, var(--color-aureus-ink) 10%, transparent)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span aria-hidden style={{ fontSize: 16 }}>{loc.short}</span>
                  <span>{loc.label}</span>
                  {isCurrent && <span aria-hidden style={{ marginLeft: "auto", fontSize: 10 }}>● here</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
