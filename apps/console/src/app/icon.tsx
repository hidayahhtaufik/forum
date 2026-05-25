/// Dynamically-generated favicon. Replaces the old static favicon.svg.
/// Renders the same chibi crab from components/Logo.tsx as a 32×32 PNG via
/// Next.js's `ImageResponse`. This way the browser-tab icon always matches
/// the in-app logo without us juggling separate PNG/ICO files.

import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#ED8466",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Coin face */}
          <circle cx="20" cy="20" r="18.5" fill="#ED8466" />
          {/* Crab claws */}
          <circle cx="9.5" cy="17" r="3.6" fill="#FAF8F3" />
          <circle cx="30.5" cy="17" r="3.6" fill="#FAF8F3" />
          {/* Body */}
          <ellipse cx="20" cy="23" rx="9" ry="6.5" fill="#FAF8F3" />
          {/* Eye stalks */}
          <rect x="14.5" y="11" width="2.2" height="6" rx="1.1" fill="#FAF8F3" />
          <rect x="23.3" y="11" width="2.2" height="6" rx="1.1" fill="#FAF8F3" />
          {/* Eye whites */}
          <circle cx="15.6" cy="11" r="2.2" fill="#FAF8F3" />
          <circle cx="24.4" cy="11" r="2.2" fill="#FAF8F3" />
          {/* Pupils */}
          <circle cx="15.6" cy="11" r="1" fill="#1A1814" />
          <circle cx="24.4" cy="11" r="1" fill="#1A1814" />
          {/* Smile */}
          <path
            d="M 17 24.5 Q 20 27 23 24.5"
            stroke="#1A1814"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    {
      ...size,
    },
  );
}
