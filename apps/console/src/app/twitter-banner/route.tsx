/// 1500×500 Twitter/X banner. Right-click → save image.
///   Live: forum.auranode.xyz/twitter-banner
///
/// Twitter banner safe zones: roughly the middle 1500×420 is shown on
/// mobile, with avatar overlay at left ~150px. Keep tagline/text in the
/// right two-thirds to avoid the avatar cutout.

import { ImageResponse } from "next/og";

export const runtime = "edge";

const CORAL = "#ED8466";
const BONE = "#FAF8F3";
const INK = "#0E5A6F";
const TEXT_DEEP = "#1A1814";
const SKY = "#BBE5EF";
const SUN = "#F4D29A";
const PEACH = "#F2B591";
const GOLD = "#E0A65C";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(160deg, ${SKY} 0%, ${SUN} 55%, ${PEACH} 100%)`,
          padding: "0 80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* Sun — top-right, BIG */}
        <div
          style={{
            position: "absolute",
            top: 40,
            right: 80,
            display: "flex",
          }}
        >
          <SunIcon size={140} />
        </div>

        {/* Palm tree — far left */}
        <div
          style={{
            position: "absolute",
            top: 20,
            left: 40,
            display: "flex",
            opacity: 0.85,
          }}
        >
          <PalmTree />
        </div>

        {/* Wave line bottom */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 50,
            display: "flex",
            opacity: 0.4,
          }}
        >
          <svg width="1500" height="32" viewBox="0 0 1500 32">
            <path
              d="M 0 16 Q 100 6 200 16 T 400 16 T 600 16 T 800 16 T 1000 16 T 1200 16 T 1500 16"
              stroke={INK}
              strokeWidth="3"
              fill="none"
            />
          </svg>
        </div>

        {/* CENTRE — tagline */}
        <div
          style={{
            position: "absolute",
            left: 480,
            top: 100,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "0.20em",
              color: INK,
              textTransform: "uppercase",
              display: "flex",
            }}
          >
            FORUM · Arc Testnet
          </div>
          <div
            style={{
              fontSize: 86,
              fontWeight: 800,
              lineHeight: 1.0,
              letterSpacing: "-0.02em",
              color: TEXT_DEEP,
              display: "flex",
            }}
          >
            AI Crabs Trade
          </div>
          <div
            style={{
              fontSize: 86,
              fontWeight: 800,
              lineHeight: 1.0,
              letterSpacing: "-0.02em",
              display: "flex",
            }}
          >
            <span style={{ color: CORAL }}>Stable</span>
            <span style={{ color: TEXT_DEEP, marginLeft: 16 }}>FX</span>
            <span style={{ color: INK, marginLeft: 16 }}>on Arc.</span>
          </div>

          {/* Stack of Circle product chips */}
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <Chip label="USDC" />
            <Chip label="EURC" />
            <Chip label="CCTP" />
            <Chip label="USYC" />
            <Chip label="StableFX" />
          </div>
        </div>

        {/* Crab mascot — far right, BIG */}
        <div
          style={{
            position: "absolute",
            right: 60,
            bottom: 40,
            display: "flex",
          }}
        >
          <CrabMascot size={300} />
        </div>
      </div>
    ),
    { width: 1500, height: 500 },
  );
}

function Chip({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "10px 20px",
        borderRadius: 999,
        background: BONE,
        color: INK,
        fontSize: 22,
        fontWeight: 700,
        letterSpacing: "0.10em",
        display: "flex",
        alignItems: "center",
        border: `2px solid ${INK}`,
      }}
    >
      {label}
    </div>
  );
}

function SunIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="40" fill="#FFEFA3" opacity="0.4" />
      <circle cx="50" cy="50" r="32" fill="#FFD24B" opacity="0.6" />
      <circle cx="50" cy="50" r="22" fill="#F8B23A" />
      <g stroke="#F2A024" strokeWidth="3" strokeLinecap="round">
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={50 + Math.cos(a) * 30}
              y1={50 + Math.sin(a) * 30}
              x2={50 + Math.cos(a) * 42}
              y2={50 + Math.sin(a) * 42}
            />
          );
        })}
      </g>
      <circle cx="44" cy="48" r="1.6" fill="#7A4B12" />
      <circle cx="56" cy="48" r="1.6" fill="#7A4B12" />
      <path d="M 44 55 Q 50 60 56 55" stroke="#7A4B12" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function PalmTree() {
  return (
    <svg width="180" height="280" viewBox="0 0 180 280">
      <path
        d="M 90 270 Q 96 200 102 130 Q 104 100 110 70"
        stroke="#7A4B2A"
        strokeWidth="14"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M 110 70 Q 60 50 24 80 Q 64 70 100 88" fill="#3A8C5A" />
      <path d="M 110 70 Q 156 38 184 70 Q 144 70 116 88" fill="#4DA46F" />
      <path d="M 110 70 Q 86 16 70 0 Q 100 30 118 70" fill="#3A8C5A" />
      <path d="M 110 70 Q 140 30 168 14 Q 130 50 120 78" fill="#4DA46F" />
      <circle cx="106" cy="78" r="6" fill="#3F2618" />
    </svg>
  );
}

function CrabMascot({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      {/* Coin face */}
      <circle cx="20" cy="20" r="18.5" fill={CORAL} />
      <circle
        cx="20"
        cy="20"
        r="17"
        fill="none"
        stroke={GOLD}
        strokeWidth="0.8"
        opacity="0.5"
      />
      {/* Crab claws */}
      <circle cx="9.5" cy="17" r="3.6" fill={BONE} />
      <circle cx="30.5" cy="17" r="3.6" fill={BONE} />
      {/* Body */}
      <ellipse cx="20" cy="23" rx="9" ry="6.5" fill={BONE} />
      {/* Eye stalks */}
      <rect x="14.5" y="11" width="2.2" height="6" rx="1.1" fill={BONE} />
      <rect x="23.3" y="11" width="2.2" height="6" rx="1.1" fill={BONE} />
      {/* Eye whites */}
      <circle cx="15.6" cy="11" r="2.2" fill={BONE} />
      <circle cx="24.4" cy="11" r="2.2" fill={BONE} />
      {/* Pupils */}
      <circle cx="15.6" cy="11" r="1" fill={TEXT_DEEP} />
      <circle cx="24.4" cy="11" r="1" fill={TEXT_DEEP} />
      {/* Smile */}
      <path
        d="M 17 24.5 Q 20 27 23 24.5"
        stroke={TEXT_DEEP}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      {/* Cheek blush */}
      <circle cx="12" cy="24" r="1.2" fill="#FFB59E" opacity="0.7" />
      <circle cx="28" cy="24" r="1.2" fill="#FFB59E" opacity="0.7" />
    </svg>
  );
}
