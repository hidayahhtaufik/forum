"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "@phosphor-icons/react";

/// Tiny light/dark toggle. Icon shows the CURRENT mode (sun = currently light,
/// moon = currently dark). Click flips. Persists to localStorage under
/// `forum-theme`. Pre-hydration script in layout.tsx sets the initial
/// data-theme attribute from the same key, so no flash on first paint.
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    const current = (document.documentElement.getAttribute("data-theme") ?? "light") as "dark" | "light";
    setTheme(current);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("forum-theme", next);
    } catch {
      // noop
    }
  };

  if (theme === null) {
    return <span style={{ display: "inline-block", width: 36, height: 36 }} />;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Currently ${theme} · click for ${theme === "dark" ? "light" : "dark"}`}
      style={{
        background: "color-mix(in oklch, var(--color-raised) 92%, transparent)",
        border: "1.5px solid var(--color-border)",
        borderRadius: 999,
        width: 36,
        height: 36,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: theme === "light" ? "var(--color-honos-gold)" : "var(--color-pastel-sky)",
        cursor: "pointer",
        transition: "transform 200ms var(--ease-out-quart), background 200ms ease",
        backdropFilter: "blur(8px)",
        boxShadow: "0 2px 8px color-mix(in oklch, var(--color-aureus-ink) 15%, transparent)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.08)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      {/* Icon shows CURRENT mode (per user spec: light → sun, dark → moon) */}
      {theme === "light" ? <Sun size={18} weight="fill" /> : <Moon size={18} weight="fill" />}
    </button>
  );
}
