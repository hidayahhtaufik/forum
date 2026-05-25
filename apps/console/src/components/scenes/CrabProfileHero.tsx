"use client";

/// CrabProfileHero — top section of `/console`. Pokemon-style profile card
/// where the user customizes THEIR crab. v0.1: hat customization (5 options),
/// stored in localStorage. Stats + wallet info displayed alongside.
///
/// Inserts ABOVE the existing ConsoleView content — the wallet operations
/// (faucet/deposit/withdraw), bet history, and claimables UI stays untouched
/// below this hero. Safe additive change.

import { useEffect, useState } from "react";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useTrader } from "@/lib/useTrader";
import { spriteForAddress, type AgentName } from "@/lib/agent-sprites";
import { AgentSprite } from "@/components/AgentSprite";
import { formatUsdc, truncAddress } from "@/lib/format";
import type { AgentProfile } from "@/lib/api";

type Hat = "none" | "strawhat" | "crown" | "pirate" | "wreath";
type Mood = "idle" | "happy" | "cool";

const STORAGE_HAT = "forum-crab-hat";
const STORAGE_MOOD = "forum-crab-mood";

export function CrabProfileHero({ profile }: { profile: AgentProfile | null }) {
  const { user } = useDynamicContext();
  const { trader } = useTrader();
  const [hat, setHat] = useState<Hat>("none");
  const [mood, setMood] = useState<Mood>("idle");

  // Load saved customization on mount
  useEffect(() => {
    try {
      const h = localStorage.getItem(STORAGE_HAT) as Hat | null;
      const m = localStorage.getItem(STORAGE_MOOD) as Mood | null;
      if (h && HATS.some((x) => x.id === h)) setHat(h);
      if (m && MOODS.some((x) => x.id === m)) setMood(m);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const saveHat = (next: Hat) => {
    setHat(next);
    try {
      localStorage.setItem(STORAGE_HAT, next);
    } catch {
      /* noop */
    }
  };
  const saveMood = (next: Mood) => {
    setMood(next);
    try {
      localStorage.setItem(STORAGE_MOOD, next);
    } catch {
      /* noop */
    }
  };

  // Pick a sprite for this user's address. Deterministic from address bytes,
  // so the same wallet always gets the same base crab look.
  const baseAddr = trader?.address?.toLowerCase() ?? "0x0";
  const baseSprite =
    spriteForAddress(baseAddr) ?? deterministicSprite(baseAddr);

  // Stats from profile (server-fetched)
  const betCount = profile?.betCount ?? 0;
  const yesCount = profile?.yesCount ?? 0;
  const noCount = profile?.noCount ?? 0;
  const totalVolume = profile?.totalVolumeUsdc ?? "0";

  if (!user) {
    return null; // SignInPrompt below handles unauthed state
  }

  return (
    <section
      style={{
        position: "relative",
        width: "100%",
        padding: "clamp(40px, 6vw, 72px) clamp(20px, 4vw, 56px)",
        background:
          "linear-gradient(180deg, " +
          "color-mix(in oklch, var(--color-pastel-sky) 35%, var(--color-bg)) 0%, " +
          "color-mix(in oklch, var(--color-pastel-peach) 30%, var(--color-bg)) 100%)",
        overflow: "hidden",
      }}
      aria-label="Your crab profile"
    >
      {/* Header strip */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <span
          className="mono"
          style={{
            fontSize: "var(--text-2xs)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--color-bone-dim)",
          }}
        >
          🦀 My Agents & Wallet · Customize, Stake, Claim
        </span>
        <h1
          style={{
            margin: "8px auto 0",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "clamp(28px, 4vw, 48px)",
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            color: "var(--color-bone)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-script)",
              fontWeight: 500,
              fontSize: "0.6em",
              color: "var(--color-aureus-ink)",
            }}
          >
            My
          </span>
          <span style={{ textTransform: "uppercase" }}>
            <span style={{ color: "var(--color-honos-gold)" }}>Agents</span>{" "}
            <span style={{ color: "var(--color-aureus-ink)" }}>& Wallet</span>
          </span>
        </h1>
      </div>

      {/* Profile card */}
      <div
        style={{
          maxWidth: 980,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 32,
          alignItems: "center",
          padding: "32px",
          borderRadius: 24,
          background: "color-mix(in oklch, var(--color-raised) 92%, transparent)",
          border: "1.5px solid var(--color-border)",
          boxShadow: "0 6px 20px color-mix(in oklch, var(--color-bone) 10%, transparent)",
          backdropFilter: "blur(6px)",
        }}
        className="profile-card"
      >
        {/* Left: Big crab portrait + hat overlay */}
        <div
          style={{
            position: "relative",
            width: 200,
            height: 220,
            display: "grid",
            placeItems: "center",
            background: "color-mix(in oklch, var(--color-pastel-sun) 25%, var(--color-bg))",
            borderRadius: 20,
            border: "1.5px solid var(--color-border)",
          }}
        >
          {/* Hat overlay — positioned above the crab head */}
          <div
            style={{
              position: "absolute",
              top: 14,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 2,
              pointerEvents: "none",
            }}
          >
            <HatRenderer hat={hat} size={120} />
          </div>
          <AgentSprite name={baseSprite} size={160} mood={mood === "cool" ? "thinking" : mood === "happy" ? "happy" : "idle"} />
          {/* Sunglasses overlay if mood=cool */}
          {mood === "cool" && (
            <div
              style={{
                position: "absolute",
                top: "33%",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 3,
                pointerEvents: "none",
              }}
            >
              <Sunglasses size={84} />
            </div>
          )}
        </div>

        {/* Right: Identity + stats + pickers */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Identity */}
          <div>
            <div
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--color-bone-faint)",
                marginBottom: 4,
              }}
            >
              Your wallet
            </div>
            <div
              className="mono"
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                color: "var(--color-bone)",
              }}
            >
              {trader?.address ? truncAddress(trader.address) : "—"}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-bone-dim)", marginTop: 2 }}>
              {user?.email ?? user?.userId ?? ""}
            </div>
          </div>

          {/* Stat grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              padding: "14px 0",
              borderTop: "1px solid var(--color-border)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <Stat label="Bets" value={String(betCount)} />
            <Stat label="YES" value={String(yesCount)} accent="yes" />
            <Stat label="NO" value={String(noCount)} accent="no" />
            <Stat label="Volume" value={`${formatUsdc(BigInt(totalVolume))}`} suffix="USDC" />
          </div>

          {/* Hat picker */}
          <div>
            <div
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--color-bone-faint)",
                marginBottom: 8,
              }}
            >
              Hat
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {HATS.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => saveHat(h.id)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    background: hat === h.id ? "color-mix(in oklch, var(--color-honos-gold) 22%, var(--color-raised))" : "transparent",
                    border: `1.5px solid ${hat === h.id ? "var(--color-honos-gold)" : "var(--color-border)"}`,
                    color: hat === h.id ? "var(--color-honos-gold)" : "var(--color-bone)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 180ms ease",
                  }}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mood picker */}
          <div>
            <div
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--color-bone-faint)",
                marginBottom: 8,
              }}
            >
              Mood
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {MOODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => saveMood(m.id)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    background: mood === m.id ? "color-mix(in oklch, var(--color-aureus-ink) 18%, var(--color-raised))" : "transparent",
                    border: `1.5px solid ${mood === m.id ? "var(--color-aureus-ink)" : "var(--color-border)"}`,
                    color: mood === m.id ? "var(--color-aureus-ink)" : "var(--color-bone)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 180ms ease",
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 700px) {
          .profile-card {
            grid-template-columns: 1fr !important;
            justify-items: center;
          }
        }
      `}</style>
    </section>
  );
}

const HATS: { id: Hat; label: string }[] = [
  { id: "none", label: "no hat" },
  { id: "strawhat", label: "straw hat" },
  { id: "crown", label: "crown" },
  { id: "pirate", label: "pirate" },
  { id: "wreath", label: "wreath" },
];

const MOODS: { id: Mood; label: string }[] = [
  { id: "idle", label: "neutral" },
  { id: "happy", label: "happy" },
  { id: "cool", label: "shades 😎" },
];

/* ---------------------------------------------------------------- */
/* Hat renderer — pick the SVG based on selected hat                 */
/* ---------------------------------------------------------------- */
function HatRenderer({ hat, size }: { hat: Hat; size: number }) {
  if (hat === "none") return null;
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 100 60" aria-hidden>
      {hat === "strawhat" && (
        <g>
          {/* Wide brim */}
          <ellipse cx="50" cy="48" rx="46" ry="8" fill="color-mix(in oklch, var(--color-pastel-sun) 80%, var(--color-tessera-oxblood))" />
          {/* Top dome */}
          <path d="M 22 48 Q 50 18 78 48 Z" fill="color-mix(in oklch, var(--color-pastel-sun) 85%, var(--color-tessera-oxblood))" />
          {/* Band */}
          <path d="M 24 44 Q 50 38 76 44" stroke="var(--color-tessera-oxblood)" strokeWidth="5" fill="none" />
        </g>
      )}
      {hat === "crown" && (
        <g>
          {/* Crown base */}
          <rect x="20" y="40" width="60" height="12" fill="var(--color-honos-gold)" stroke="color-mix(in oklch, var(--color-honos-gold) 60%, var(--color-on-gold))" strokeWidth="1.5" />
          {/* Five spikes */}
          <path d="M 20 40 L 24 28 L 32 38 L 40 22 L 50 38 L 60 22 L 68 38 L 76 28 L 80 40 Z"
            fill="var(--color-honos-gold)" stroke="color-mix(in oklch, var(--color-honos-gold) 50%, var(--color-on-gold))" strokeWidth="1.5" />
          {/* Jewels */}
          <circle cx="32" cy="46" r="2.5" fill="var(--color-tessera-oxblood)" />
          <circle cx="50" cy="46" r="3" fill="var(--color-outcome-yes)" />
          <circle cx="68" cy="46" r="2.5" fill="var(--color-aureus-ink)" />
        </g>
      )}
      {hat === "pirate" && (
        <g>
          {/* Tricorn shape */}
          <path d="M 12 50 L 50 22 L 88 50 L 76 44 L 50 36 L 24 44 Z"
            fill="color-mix(in oklch, var(--color-bone) 90%, transparent)"
            stroke="color-mix(in oklch, var(--color-bone-faint) 50%, transparent)" strokeWidth="1.5" />
          {/* Skull + crossbones (simplified) */}
          <circle cx="50" cy="40" r="4" fill="white" />
          <circle cx="48" cy="40" r="0.8" fill="black" />
          <circle cx="52" cy="40" r="0.8" fill="black" />
          <rect x="46" y="43" width="8" height="1.5" fill="white" />
          <path d="M 46 44 L 52 47 M 54 44 L 48 47" stroke="white" strokeWidth="1" />
        </g>
      )}
      {hat === "wreath" && (
        <g>
          {/* Circular wreath */}
          <ellipse cx="50" cy="46" rx="34" ry="6" stroke="color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" strokeWidth="6" fill="none" />
          {/* Leaves accent */}
          <ellipse cx="22" cy="42" rx="4" ry="2" fill="color-mix(in oklch, var(--color-outcome-yes) 75%, var(--color-bone))" transform="rotate(-30 22 42)" />
          <ellipse cx="34" cy="38" rx="4" ry="2" fill="color-mix(in oklch, var(--color-outcome-yes) 75%, var(--color-bone))" transform="rotate(-20 34 38)" />
          <ellipse cx="50" cy="36" rx="4" ry="2" fill="color-mix(in oklch, var(--color-outcome-yes) 75%, var(--color-bone))" />
          <ellipse cx="66" cy="38" rx="4" ry="2" fill="color-mix(in oklch, var(--color-outcome-yes) 75%, var(--color-bone))" transform="rotate(20 66 38)" />
          <ellipse cx="78" cy="42" rx="4" ry="2" fill="color-mix(in oklch, var(--color-outcome-yes) 75%, var(--color-bone))" transform="rotate(30 78 42)" />
          {/* Berry */}
          <circle cx="50" cy="32" r="3" fill="var(--color-tessera-oxblood)" />
        </g>
      )}
    </svg>
  );
}

function Sunglasses({ size }: { size: number }) {
  return (
    <svg width={size} height={size * 0.4} viewBox="0 0 100 40" aria-hidden>
      <rect x="6" y="10" width="36" height="20" rx="3" fill="color-mix(in oklch, var(--color-on-gold) 95%, transparent)" stroke="var(--color-bone)" strokeWidth="1.5" />
      <rect x="58" y="10" width="36" height="20" rx="3" fill="color-mix(in oklch, var(--color-on-gold) 95%, transparent)" stroke="var(--color-bone)" strokeWidth="1.5" />
      <path d="M 42 18 L 58 18" stroke="var(--color-bone)" strokeWidth="2" />
      <path d="M 14 15 L 22 14" stroke="white" strokeWidth="1.5" opacity="0.6" />
      <path d="M 66 15 L 74 14" stroke="white" strokeWidth="1.5" opacity="0.6" />
    </svg>
  );
}

function Stat({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: "yes" | "no";
}) {
  const color = accent === "yes" ? "var(--color-outcome-yes)" : accent === "no" ? "var(--color-outcome-no)" : "var(--color-bone)";
  return (
    <div style={{ textAlign: "center" }}>
      <div className="mono" style={{ fontSize: 9, letterSpacing: "0.14em", color: "var(--color-bone-faint)", textTransform: "uppercase", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-base)", fontWeight: 700, color }}>
        {value}
        {suffix && <span style={{ fontSize: 10, marginLeft: 3, color: "var(--color-bone-dim)" }}>{suffix}</span>}
      </div>
    </div>
  );
}

function deterministicSprite(addr: string): AgentName {
  const names: AgentName[] = ["oracle", "sage", "hermes", "augur", "mirror"];
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) | 0;
  return names[Math.abs(h) % names.length]!;
}
