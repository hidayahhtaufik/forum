"use client";

/// MyHatOverlay — client-side hat overlay that renders the user's customized
/// hat (from localStorage forum-crab-hat) ABOVE any AgentSprite that matches
/// their trader wallet address. Applies the customization globally without
/// touching server-rendered pages.
///
/// Usage:
///   <div style={{ position: "relative" }}>
///     <AgentSprite name="..." size={64} />
///     <MyHatOverlay targetAddress="0x..." size={64} />
///   </div>
///
/// If `targetAddress` doesn't match the user's wallet, renders nothing.

import { useEffect, useState } from "react";
import { useTrader } from "@/lib/useTrader";

type Hat = "none" | "strawhat" | "crown" | "pirate" | "wreath";

export function MyHatOverlay({
  targetAddress,
  size = 64,
}: {
  targetAddress: string;
  size?: number;
}) {
  const { trader } = useTrader();
  const [hat, setHat] = useState<Hat>("none");

  useEffect(() => {
    try {
      const h = localStorage.getItem("forum-crab-hat") as Hat | null;
      if (h && ["strawhat", "crown", "pirate", "wreath"].includes(h)) setHat(h);
    } catch { /* noop */ }
  }, []);

  const myAddr = trader?.address?.toLowerCase() ?? null;
  const match = myAddr && targetAddress.toLowerCase() === myAddr;
  if (!match || hat === "none") return null;

  const hatSize = size * 0.7;
  return (
    <div
      style={{
        position: "absolute",
        top: -hatSize * 0.35,
        left: "50%",
        transform: "translateX(-50%)",
        pointerEvents: "none",
        zIndex: 2,
      }}
      aria-hidden
    >
      <HatSVG hat={hat} size={hatSize} />
    </div>
  );
}

function HatSVG({ hat, size }: { hat: Hat; size: number }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 100 60">
      {hat === "strawhat" && (
        <g>
          <ellipse cx="50" cy="48" rx="46" ry="8" fill="color-mix(in oklch, var(--color-pastel-sun) 80%, var(--color-tessera-oxblood))" />
          <path d="M 22 48 Q 50 18 78 48 Z" fill="color-mix(in oklch, var(--color-pastel-sun) 85%, var(--color-tessera-oxblood))" />
          <path d="M 24 44 Q 50 38 76 44" stroke="var(--color-tessera-oxblood)" strokeWidth="5" fill="none" />
        </g>
      )}
      {hat === "crown" && (
        <g>
          <rect x="20" y="40" width="60" height="12" fill="var(--color-honos-gold)" stroke="color-mix(in oklch, var(--color-honos-gold) 60%, var(--color-on-gold))" strokeWidth="1.5" />
          <path d="M 20 40 L 24 28 L 32 38 L 40 22 L 50 38 L 60 22 L 68 38 L 76 28 L 80 40 Z" fill="var(--color-honos-gold)" stroke="color-mix(in oklch, var(--color-honos-gold) 50%, var(--color-on-gold))" strokeWidth="1.5" />
          <circle cx="32" cy="46" r="2.5" fill="var(--color-tessera-oxblood)" />
          <circle cx="50" cy="46" r="3" fill="var(--color-outcome-yes)" />
          <circle cx="68" cy="46" r="2.5" fill="var(--color-aureus-ink)" />
        </g>
      )}
      {hat === "pirate" && (
        <g>
          <path d="M 12 50 L 50 22 L 88 50 L 76 44 L 50 36 L 24 44 Z" fill="color-mix(in oklch, var(--color-bone) 90%, transparent)" stroke="color-mix(in oklch, var(--color-bone-faint) 50%, transparent)" strokeWidth="1.5" />
          <circle cx="50" cy="40" r="4" fill="white" />
          <circle cx="48" cy="40" r="0.8" fill="black" />
          <circle cx="52" cy="40" r="0.8" fill="black" />
        </g>
      )}
      {hat === "wreath" && (
        <g>
          <ellipse cx="50" cy="46" rx="34" ry="6" stroke="color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" strokeWidth="6" fill="none" />
          <ellipse cx="22" cy="42" rx="4" ry="2" fill="color-mix(in oklch, var(--color-outcome-yes) 75%, var(--color-bone))" />
          <ellipse cx="78" cy="42" rx="4" ry="2" fill="color-mix(in oklch, var(--color-outcome-yes) 75%, var(--color-bone))" />
          <circle cx="50" cy="32" r="3" fill="var(--color-tessera-oxblood)" />
        </g>
      )}
    </svg>
  );
}
