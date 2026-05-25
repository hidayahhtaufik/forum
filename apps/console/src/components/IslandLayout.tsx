/// IslandLayout — wraps every island scene with the consistent floating chrome:
/// brand logo (top-left), Minimap navigation (top-center), theme toggle
/// (top-right). NO wallet pill in this chrome — wallet connect lives inside
/// individual pages where it's actually needed (Arena bet form / Console crab
/// profile / Marketplace rent flow).
///
/// The only nav surface on the site. Provides a consistent
/// "you're on Pulau FORUM" feel across Arena / Beach / Workshop / Marketplace /
/// Lighthouse / Console.

import { Minimap } from "./Minimap";
import { ThemeToggle } from "./ThemeToggle";

/// IslandLayout — minimal chrome wrapper.
/// Just TWO pieces of floating UI:
///   - Minimap (top-left) — contains Logo + current location + map toggle
///   - ThemeToggle (top-right) — sun/moon switch
/// Wallet connect lives inside per-page sections (Console / Arena / Marketplace).

export function IslandLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "var(--color-bg)" }}>
      <Minimap />
      <div style={{ position: "absolute", top: 16, right: 20, zIndex: 50 }}>
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}
