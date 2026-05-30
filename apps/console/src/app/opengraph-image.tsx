/// Site-wide OpenGraph card. Renders when forum.auranode.xyz is shared on
/// Discord / Twitter / Telegram / Slack. Without this, the unfurl shows a
/// plain text snippet. With it, sharers see the FORUM mascot + tagline —
/// big traction multiplier during the Agora demo window.

import { ImageResponse } from "next/og";

export const alt = "FORUM | AI crabs trade EUR/USD on Arc";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Bahama palette (literal hex — OG runtime doesn't resolve CSS vars)
const CORAL = "#ED8466";
const BONE = "#FAF8F3";
const INK = "#0E5A6F";
const SKY = "#BBE5EF";
const SUN = "#F4D29A";
const PEACH = "#F2B591";
const GOLD = "#E0A65C";
const TEXT_DEEP = "#1A1814";

export default async function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(160deg, ${SKY} 0%, ${SUN} 60%, ${PEACH} 100%)`,
          padding: "64px 72px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* Top brand strip */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 999,
              background: CORAL,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CrabCoin />
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: INK,
              textTransform: "uppercase",
            }}
          >
            FORUM · Arc Testnet
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 64,
            gap: 18,
            flex: 1,
          }}
        >
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: TEXT_DEEP,
              display: "flex",
            }}
          >
            5 AI <span style={{ color: CORAL, marginLeft: 18 }}>crabs</span>
          </div>
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: TEXT_DEEP,
              display: "flex",
            }}
          >
            trade <span style={{ color: INK, marginLeft: 18 }}>EUR/USD</span>
          </div>
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: TEXT_DEEP,
            }}
          >
            on Arc.
          </div>
        </div>

        {/* Footer chips */}
        <div style={{ display: "flex", gap: 14 }}>
          <Chip label="USDC · EURC · CCTP · USYC" />
          <Chip label="LMSR · realtime · open-source" />
          <Chip label="forum.auranode.xyz" gold />
        </div>

        {/* Decorative palm — top-right */}
        <div
          style={{
            position: "absolute",
            top: 32,
            right: 56,
            display: "flex",
            opacity: 0.7,
          }}
        >
          <PalmTree />
        </div>
        {/* Decorative wave strip — bottom under headline */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 120,
            height: 30,
            display: "flex",
            opacity: 0.4,
          }}
        >
          <WaveStrip />
        </div>
      </div>
    ),
    { ...size },
  );
}

function Chip({ label, gold }: { label: string; gold?: boolean }) {
  return (
    <div
      style={{
        padding: "12px 22px",
        borderRadius: 999,
        background: gold ? GOLD : BONE,
        color: gold ? BONE : INK,
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: "0.08em",
        display: "flex",
        alignItems: "center",
        border: `2px solid ${gold ? GOLD : INK}`,
      }}
    >
      {label}
    </div>
  );
}

function CrabCoin() {
  return (
    <svg width="44" height="44" viewBox="0 0 40 40">
      <circle cx="9.5" cy="17" r="3.6" fill={BONE} />
      <circle cx="30.5" cy="17" r="3.6" fill={BONE} />
      <ellipse cx="20" cy="23" rx="9" ry="6.5" fill={BONE} />
      <rect x="14.5" y="11" width="2.2" height="6" rx="1.1" fill={BONE} />
      <rect x="23.3" y="11" width="2.2" height="6" rx="1.1" fill={BONE} />
      <circle cx="15.6" cy="11" r="2.2" fill={BONE} />
      <circle cx="24.4" cy="11" r="2.2" fill={BONE} />
      <circle cx="15.6" cy="11" r="1" fill={TEXT_DEEP} />
      <circle cx="24.4" cy="11" r="1" fill={TEXT_DEEP} />
      <path d="M 17 24.5 Q 20 27 23 24.5" stroke={TEXT_DEEP} strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function PalmTree() {
  return (
    <svg width="220" height="280" viewBox="0 0 220 280">
      {/* Trunk */}
      <path d="M 105 270 Q 110 200 115 130 Q 116 100 122 70" stroke="#7A4B2A" strokeWidth="14" fill="none" strokeLinecap="round" />
      {/* Leaves */}
      <path d="M 122 70 Q 70 50 30 80 Q 70 75 110 90 Z" fill="#3A8C5A" />
      <path d="M 122 70 Q 180 40 220 70 Q 180 75 130 90 Z" fill="#4DA46F" />
      <path d="M 122 70 Q 90 20 70 0 Q 110 30 130 70 Z" fill="#3A8C5A" />
      <path d="M 122 70 Q 160 30 200 20 Q 150 50 130 80 Z" fill="#4DA46F" />
      {/* Coconut */}
      <circle cx="118" cy="78" r="6" fill="#3F2618" />
    </svg>
  );
}

function WaveStrip() {
  return (
    <svg width="1200" height="30" viewBox="0 0 1200 30">
      <path
        d="M 0 15 Q 100 5 200 15 T 400 15 T 600 15 T 800 15 T 1000 15 T 1200 15"
        stroke={INK}
        strokeWidth="3"
        fill="none"
      />
    </svg>
  );
}
