/// 400×400 Twitter/X profile avatar. Right-click → save image.
///   Live: forum.auranode.xyz/twitter-avatar
///
/// Twitter crops to a circle, so the design is built circle-safe: big
/// coral coin, crab face front-and-center, no detail near corners.

import { ImageResponse } from "next/og";

export const runtime = "edge";

const CORAL = "#ED8466";
const BONE = "#FAF8F3";
const INK = "#1A1814";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: CORAL,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <svg width="400" height="400" viewBox="0 0 40 40">
          {/* Coin face (already the parent — keep for safety) */}
          <circle cx="20" cy="20" r="18.5" fill={CORAL} />
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
          <circle cx="15.6" cy="11" r="1" fill={INK} />
          <circle cx="24.4" cy="11" r="1" fill={INK} />
          {/* Smile */}
          <path
            d="M 17 24.5 Q 20 27 23 24.5"
            stroke={INK}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
          {/* Cheek blush */}
          <circle cx="12" cy="24" r="1.2" fill="#FFB59E" opacity="0.7" />
          <circle cx="28" cy="24" r="1.2" fill="#FFB59E" opacity="0.7" />
        </svg>
      </div>
    ),
    { width: 400, height: 400 },
  );
}
