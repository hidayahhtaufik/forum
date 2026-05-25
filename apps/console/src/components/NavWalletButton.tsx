"use client";

import { useDynamicContext, DynamicWidget } from "@dynamic-labs/sdk-react-core";

/// Compact wallet button for the top nav. When disconnected → "connect" CTA.
/// When connected → renders Dynamic's full widget wrapped in our themed
/// container (mint pill in light, dark pill in dark) so the white default
/// widget background doesn't stick out on island scenes.
///
/// Mounted in Nav across all pages because root layout now wraps DynamicProvider.
export function NavWalletButton() {
  const { user, primaryWallet, setShowAuthFlow } = useDynamicContext();

  if (user && primaryWallet) {
    // Wrap in a themed container that absorbs the widget's white background.
    // mix-blend-multiply over our mint paper bg = tinted-to-theme automatically.
    return (
      <div
        style={{
          padding: 2,
          borderRadius: 999,
          background: "color-mix(in oklch, var(--color-raised) 95%, transparent)",
          border: "1px solid var(--color-border)",
          display: "inline-flex",
          alignItems: "center",
          // mix-blend-mode lets the widget's white background pick up the mint
          // tint from our container so it visually blends with the page bg
          // instead of looking like a stuck-on white sticker.
          mixBlendMode: "multiply",
        }}
        className="nav-wallet-wrap"
      >
        <DynamicWidget />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setShowAuthFlow(true)}
      className="mono"
      style={{
        background: "var(--color-honos-gold)",
        color: "var(--color-on-gold)",
        border: "1px solid var(--color-honos-gold)",
        borderRadius: 4,
        padding: "6px 14px",
        fontSize: "var(--text-xs)",
        letterSpacing: "0.06em",
        fontWeight: 500,
        cursor: "pointer",
        transition: "opacity 120ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
    >
      connect
    </button>
  );
}
