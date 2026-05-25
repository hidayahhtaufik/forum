"use client";

/// DocsShell — GitBook-style layout: left sidebar nav + main content +
/// right "On this page" mini-toc. Sticky sidebar, scroll-spy highlights
/// active section via IntersectionObserver on h2 anchors inside the
/// main element.
///
/// Sections are addressed by HTML id on the wrapping element. Pass the
/// nav tree as `sections` and render the section bodies as children.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CaretRight, List, X, BookOpenText } from "@phosphor-icons/react";

export type NavItem = {
  id: string;
  label: string;
  badge?: string;
  children?: NavItem[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export function DocsShell({
  groups,
  children,
}: {
  groups: NavGroup[];
  children: React.ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const allItems = useMemo(() => {
    const items: NavItem[] = [];
    for (const g of groups) {
      for (const i of g.items) {
        items.push(i);
        if (i.children) items.push(...i.children);
      }
    }
    return items;
  }, [groups]);

  // Scroll-spy: which top-level section is currently most in view?
  useEffect(() => {
    if (typeof window === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length > 0 && visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-12% 0px -50% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const it of allItems) {
      const el = document.getElementById(it.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [allItems]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(220px, 260px) minmax(0, 1fr)",
        maxWidth: 1240,
        margin: "0 auto",
        padding: "clamp(20px, 3vw, 32px) clamp(20px, 4vw, 56px) clamp(48px, 5vw, 80px)",
        gap: "clamp(24px, 4vw, 56px)",
        position: "relative",
      }}
      className="docs-shell"
    >
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setMobileOpen((s) => !s)}
        aria-label="Toggle docs nav"
        className="docs-mobile-toggle mono"
        style={{
          display: "none",
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 30,
          padding: "12px 16px",
          borderRadius: 999,
          border: "1.5px solid var(--color-honos-gold)",
          background: "var(--color-honos-gold)",
          color: "var(--color-aureus-ink)",
          fontWeight: 600,
          fontSize: "var(--text-xs)",
          letterSpacing: "0.08em",
          alignItems: "center",
          gap: 6,
          boxShadow: "0 6px 20px color-mix(in oklch, var(--color-honos-gold) 32%, transparent)",
        }}
      >
        {mobileOpen ? <X size={14} weight="fill" /> : <List size={14} weight="fill" />}
        {mobileOpen ? "CLOSE" : "DOCS"}
      </button>

      {/* Left sidebar */}
      <aside
        className={mobileOpen ? "docs-sidebar docs-sidebar-open" : "docs-sidebar"}
        style={{
          position: "sticky",
          top: 96,
          alignSelf: "start",
          maxHeight: "calc(100vh - 120px)",
          overflowY: "auto",
          paddingRight: 8,
        }}
      >
        <div
          className="mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: "var(--text-2xs)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--color-bone-faint)",
            paddingBottom: 16,
            borderBottom: "1px solid var(--color-border)",
            width: "100%",
          }}
        >
          <BookOpenText size={12} weight="duotone" color="var(--color-honos-gold)" />
          FORUM Docs
        </div>

        <nav style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 22 }}>
          {groups.map((g) => (
            <div key={g.label}>
              <div
                className="mono"
                style={{
                  fontSize: "var(--text-2xs)",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--color-bone-dim)",
                  marginBottom: 8,
                }}
              >
                {g.label}
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                {g.items.map((item) => (
                  <SidebarItem
                    key={item.id}
                    item={item}
                    activeId={activeId}
                    onNavigate={() => setMobileOpen(false)}
                  />
                ))}
              </ul>
            </div>
          ))}

          <div
            className="mono"
            style={{
              fontSize: "var(--text-2xs)",
              color: "var(--color-bone-faint)",
              borderTop: "1px solid var(--color-border)",
              paddingTop: 12,
            }}
          >
            <Link href="/" style={{ color: "var(--color-bone-dim)", textDecoration: "none" }}>
              ← back to forum.auranode.xyz
            </Link>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <article
        style={{
          minWidth: 0,
          maxWidth: 760,
        }}
      >
        {children}
      </article>

      <style>{`
        @media (max-width: 900px) {
          .docs-shell { grid-template-columns: 1fr !important; }
          .docs-sidebar {
            position: fixed !important;
            top: 64px !important;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 25;
            padding: 24px 20px !important;
            background: var(--color-bg);
            border-right: none;
            transform: translateY(110%);
            transition: transform 220ms ease;
            max-height: none !important;
          }
          .docs-sidebar-open {
            transform: translateY(0) !important;
          }
          .docs-mobile-toggle {
            display: inline-flex !important;
          }
        }
      `}</style>
    </div>
  );
}

function SidebarItem({
  item,
  activeId,
  onNavigate,
}: {
  item: NavItem;
  activeId: string | null;
  onNavigate: () => void;
}) {
  const isActive = activeId === item.id;
  return (
    <li>
      <a
        href={`#${item.id}`}
        onClick={onNavigate}
        className="mono"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderRadius: 6,
          fontSize: "var(--text-xs)",
          color: isActive ? "var(--color-honos-gold)" : "var(--color-bone-dim)",
          background: isActive
            ? "color-mix(in oklch, var(--color-honos-gold) 12%, transparent)"
            : "transparent",
          textDecoration: "none",
          fontWeight: isActive ? 600 : 400,
          transition: "background 120ms ease, color 120ms ease",
          borderLeft: isActive
            ? "2px solid var(--color-honos-gold)"
            : "2px solid transparent",
        }}
      >
        {isActive && <CaretRight size={10} weight="fill" />}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.label}
        </span>
        {item.badge && (
          <span
            style={{
              fontSize: "var(--text-2xs)",
              padding: "1px 5px",
              borderRadius: 999,
              background: "color-mix(in oklch, var(--color-honos-gold) 16%, transparent)",
              color: "var(--color-honos-gold)",
              letterSpacing: "0.04em",
            }}
          >
            {item.badge}
          </span>
        )}
      </a>
      {item.children && item.children.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "2px 0 0 12px", display: "flex", flexDirection: "column", gap: 2 }}>
          {item.children.map((c) => (
            <SidebarItem key={c.id} item={c} activeId={activeId} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </li>
  );
}
