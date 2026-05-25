"use client";

import { useEffect } from "react";

/// P2-F-001 — CSP-compliant theme bootstrap.
///
/// The previous approach injected an inline `<script>` via `dangerouslySetInnerHTML`
/// to set `data-theme` before paint. Under the new CSP (P1-F-001) `script-src`
/// allows `'unsafe-inline'` for Dynamic's SDK runtime, so the inline script
/// would still technically work — but the audit recommends moving it out of
/// the HTML stream entirely so we can tighten CSP later without churning
/// layout.tsx.
///
/// Trade-off: `<html data-theme="light">` is the SSR default. Dark-mode users
/// see a brief light flash on first visit until this effect runs. Acceptable
/// per the audit ("recommend the effect approach"). The flash is bounded to
/// the first paint after hydration — subsequent navigations within the SPA
/// preserve the attribute.
export function ThemeBootstrap() {
  useEffect(() => {
    try {
      const t = window.localStorage.getItem("forum-theme");
      const next = t === "dark" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
    } catch {
      // localStorage can throw in private mode — leave SSR default "light" alone.
    }
  }, []);

  return null;
}
