"use client";

/// ShareMarketButton — Twitter/X intent + clipboard copy, surfaced at the
/// top of /markets/[id]. Lets users brag about their pick in one click,
/// which is the single highest-leverage move for hackathon-window traction
/// (30% of the Agora score is "Traction"). The OG image route makes the
/// unfurl rich; this gives users the "share" CTA that actually fires.

import { useState } from "react";
import { ShareNetwork, Check, Copy, TwitterLogo } from "@phosphor-icons/react";

export function ShareMarketButton({
  marketId,
  question,
  yesPct,
}: {
  marketId: string;
  question: string;
  yesPct: number;
}) {
  const [copied, setCopied] = useState(false);

  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/markets/${marketId}`
      : `https://forum.auranode.xyz/markets/${marketId}`;

  const blurb = `${question} — YES ${yesPct.toFixed(0)}% / NO ${(100 - yesPct).toFixed(0)}% on @forum_arc 🦀`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard might be blocked on http — non-fatal
    }
  };

  const onTweet = () => {
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(blurb)}&url=${encodeURIComponent(url)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  };

  const onNativeShare = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "FORUM market", text: blurb, url });
        return;
      } catch {
        // user cancelled — fall through to copy
      }
    }
    copyLink();
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: 4,
        borderRadius: 999,
        background: "color-mix(in oklch, var(--color-raised) 92%, transparent)",
        border: "1px solid var(--color-border)",
      }}
    >
      <button
        type="button"
        onClick={onTweet}
        className="mono"
        title="Tweet this market"
        style={btnStyle}
      >
        <TwitterLogo size={14} weight="fill" />
        <span style={{ letterSpacing: "0.06em" }}>Tweet</span>
      </button>
      <button
        type="button"
        onClick={copyLink}
        className="mono"
        title="Copy market link"
        style={btnStyle}
        aria-live="polite"
      >
        {copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
        <span style={{ letterSpacing: "0.06em" }}>{copied ? "Copied" : "Copy link"}</span>
      </button>
      <button
        type="button"
        onClick={onNativeShare}
        className="mono"
        title="Share via system sheet"
        style={{ ...btnStyle, background: "var(--color-honos-gold)", color: "var(--color-on-gold)", border: "1px solid var(--color-honos-gold)" }}
      >
        <ShareNetwork size={14} weight="bold" />
        <span style={{ letterSpacing: "0.06em" }}>Share</span>
      </button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--color-border)",
  color: "var(--color-bone)",
  fontSize: "var(--text-2xs)",
  fontWeight: 600,
  cursor: "pointer",
};
