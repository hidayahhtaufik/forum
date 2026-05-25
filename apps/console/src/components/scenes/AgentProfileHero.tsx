"use client";

/// AgentProfileHero — `/agents/[id]` hero card, modeled on CrabProfileHero
/// (the `/console` "My Agents & Wallet" surface) so the public agent page
/// has the same warmth/branding as the user's own console.
///
/// Read-only: customization controls (hat + mood) live on `/console` for
/// the user's own wallet. This page just renders the agent's identity,
/// sprite, address, lifetime stats, and (if the user happens to BE this
/// agent — same address) their saved hat/mood overlay so the look stays
/// consistent across PulauMap, Beach, Arena, Console, and this profile.

import { useEffect, useState } from "react";
import { spriteForAddress, type AgentName } from "@/lib/agent-sprites";
import { AgentSprite } from "@/components/AgentSprite";
import { useTrader } from "@/lib/useTrader";
import { formatUsdc, truncAddress, arcscanAddress } from "@/lib/format";
import { ArrowSquareOut } from "@phosphor-icons/react";
import type { AgentProfile } from "@/lib/api";

type Hat = "none" | "strawhat" | "crown" | "pirate" | "wreath";
type Mood = "idle" | "happy" | "cool";

export function AgentProfileHero({
  profile,
  label,
  strategy,
  avatarEmoji,
}: {
  profile: AgentProfile;
  label: string | null;
  strategy: string | null;
  avatarEmoji?: string | null;
}) {
  const { trader } = useTrader();
  const [hat, setHat] = useState<Hat>("none");
  const [mood, setMood] = useState<Mood>("idle");

  // If the viewed agent IS the user's wallet, read their saved customization.
  // Otherwise leave defaults (no hat, idle).
  const isOwn = trader?.address?.toLowerCase() === profile.address.toLowerCase();

  useEffect(() => {
    if (!isOwn) return;
    try {
      const h = localStorage.getItem("forum-crab-hat") as Hat | null;
      const m = localStorage.getItem("forum-crab-mood") as Mood | null;
      if (h && ["none","strawhat","crown","pirate","wreath"].includes(h)) setHat(h);
      if (m && ["idle","happy","cool"].includes(m)) setMood(m);
    } catch {}
  }, [isOwn]);

  const spriteName = spriteForAddress(profile.address) ?? deterministicSprite(profile.address);
  const winRate =
    profile.betCount === 0
      ? null
      : ((Math.max(profile.yesCount, profile.noCount) / profile.betCount) * 100).toFixed(0);

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
      aria-label="Agent profile"
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
          {avatarEmoji ?? "🦀"} Agent Profile · {strategy ?? "Autonomous Trader"}
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
            {isOwn ? "you are" : "Meet"}
          </span>
          <span style={{ textTransform: "uppercase" }}>
            <span style={{ color: "var(--color-honos-gold)" }}>
              {label ?? truncAddress(profile.address)}
            </span>
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
        className="agent-hero-card"
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
          {avatarEmoji ? (
            // M6 — owner-picked emoji wins. Big single-glyph render so the
            // chosen avatar shows everywhere it appears, matching MyRentals
            // cards + Workshop preview.
            <span
              aria-label={`avatar ${avatarEmoji}`}
              style={{
                fontSize: 128,
                lineHeight: 1,
                display: "block",
                filter: "drop-shadow(0 4px 8px color-mix(in oklch, var(--color-bone) 18%, transparent))",
              }}
            >
              {avatarEmoji}
            </span>
          ) : (
            <>
              {isOwn && hat !== "none" && (
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
              )}
              <AgentSprite
                name={spriteName}
                size={160}
                mood={mood === "cool" ? "thinking" : mood === "happy" ? "happy" : "idle"}
              />
              {isOwn && mood === "cool" && (
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
            </>
          )}
        </div>

        {/* Right: Identity + stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
              Wallet address {isOwn && "· yours"}
            </div>
            <a
              href={arcscanAddress(profile.address)}
              target="_blank"
              rel="noreferrer"
              className="mono"
              style={{
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                color: "var(--color-bone)",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {truncAddress(profile.address)}
              <ArrowSquareOut size={11} />
            </a>
            {strategy && (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--color-bone-dim)", marginTop: 4 }}>
                {strategy}
              </div>
            )}
          </div>

          {/* Honos reputation badge — only when there's at least one settled bet. */}
          {profile.honos && profile.honos.settled > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "12px 14px",
                borderRadius: 12,
                background: "color-mix(in oklch, var(--color-honos-gold) 12%, transparent)",
                border: "1.5px solid var(--color-honos-gold)",
              }}
            >
              <span style={{ fontSize: 26 }}>🏆</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                <span
                  className="mono"
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "var(--color-bone-faint)",
                  }}
                >
                  Honos reputation · v0.1
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 700,
                    fontSize: "var(--text-base)",
                    color: "var(--color-honos-gold)",
                  }}
                >
                  Score {profile.honos.score}
                  {profile.honos.rank !== null && (
                    <span style={{ color: "var(--color-bone-dim)", fontWeight: 500, marginLeft: 8 }}>
                      · rank {profile.honos.rank} of {profile.honos.rankOf}
                    </span>
                  )}
                </span>
              </div>
              <div
                className="mono"
                style={{
                  textAlign: "right",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  color: "var(--color-bone-dim)",
                }}
              >
                <div>{profile.honos.wins}W · {profile.honos.losses}L</div>
                <div style={{ color: profile.honos.winRate && profile.honos.winRate >= 0.5
                  ? "var(--color-outcome-yes)"
                  : "var(--color-outcome-no)" }}>
                  {profile.honos.winRate !== null
                    ? `${Math.round(profile.honos.winRate * 100)}% win`
                    : "—"}
                </div>
              </div>
            </div>
          )}

          {/* Stat grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 12,
              padding: "14px 0",
              borderTop: "1px solid var(--color-border)",
              borderBottom: "1px solid var(--color-border)",
            }}
            className="agent-hero-stats"
          >
            <Stat label="Bets" value={String(profile.betCount)} />
            <Stat label="YES" value={String(profile.yesCount)} accent="yes" />
            <Stat label="NO" value={String(profile.noCount)} accent="no" />
            <Stat label="Volume" value={formatUsdc(BigInt(profile.totalVolumeUsdc))} suffix="USDC" />
            {winRate && Number(winRate) >= 50 ? (
              <Stat label="Win rate" value={`${winRate}%`} accent="yes" />
            ) : (
              <Stat label="Win rate" value={winRate ? `${winRate}%` : "—"} />
            )}
          </div>

          {isOwn ? (
            <p
              className="mono"
              style={{
                margin: 0,
                fontSize: "var(--text-2xs)",
                color: "var(--color-bone-dim)",
                lineHeight: 1.6,
              }}
            >
              This is your wallet. Customize hat &amp; mood on the{" "}
              <a href="/console" className="link" style={{ color: "var(--color-honos-gold)" }}>
                Console
              </a>{" "}
              — changes appear here too.
            </p>
          ) : (
            <p
              className="mono"
              style={{
                margin: 0,
                fontSize: "var(--text-2xs)",
                color: "var(--color-bone-dim)",
                lineHeight: 1.6,
              }}
            >
              Public agent profile. Lifetime activity below — every bet is a
              real Arc Testnet tx. Spawn your own from{" "}
              <a href="/docs" className="link" style={{ color: "var(--color-aureus-ink)" }}>
                Workshop
              </a>
              .
            </p>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 700px) {
          .agent-hero-card {
            grid-template-columns: 1fr !important;
            justify-items: center;
          }
          .agent-hero-stats {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      `}</style>
    </section>
  );
}

/* ---------------- helpers ---------------- */

function deterministicSprite(addr: string): AgentName {
  const names: AgentName[] = ["oracle", "sage", "hermes", "augur", "mirror"];
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) | 0;
  return names[Math.abs(h) % names.length]!;
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
  const color =
    accent === "yes"
      ? "var(--color-outcome-yes)"
      : accent === "no"
        ? "var(--color-outcome-no)"
        : "var(--color-bone)";
  return (
    <div style={{ textAlign: "center" }}>
      <div
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: "0.14em",
          color: "var(--color-bone-faint)",
          textTransform: "uppercase",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-base)",
          fontWeight: 700,
          color,
        }}
      >
        {value}
        {suffix && (
          <span style={{ fontSize: 10, marginLeft: 3, color: "var(--color-bone-dim)" }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function HatRenderer({ hat, size }: { hat: Hat; size: number }) {
  if (hat === "none") return null;
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 100 60" aria-hidden>
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
          <rect x="46" y="43" width="8" height="1.5" fill="white" />
          <path d="M 46 44 L 52 47 M 54 44 L 48 47" stroke="white" strokeWidth="1" />
        </g>
      )}
      {hat === "wreath" && (
        <g>
          <ellipse cx="50" cy="46" rx="34" ry="6" stroke="color-mix(in oklch, var(--color-outcome-yes) 70%, var(--color-bone))" strokeWidth="6" fill="none" />
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
    </svg>
  );
}
