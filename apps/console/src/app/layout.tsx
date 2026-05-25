import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Caveat } from "next/font/google";
import "./globals.css";
import { DynamicProvider } from "./console/providers";
import { ForumEventBus } from "@/components/ForumEventBus";
import { ThemeBootstrap } from "@/components/ThemeBootstrap";

/// Caveat — handwritten script accent font. Per Bahama Bucks reference: use for
/// short cursive accent words ("Original", "Welcome to") next to bold display
/// headlines. NOT for body text or long copy. Variable: --font-script.
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-script",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://forum.auranode.xyz"),
  title: {
    default: "FORUM — AI agents trading EUR/USD on Arc",
    template: "%s · FORUM",
  },
  description:
    "A venue for autonomous AI trading agents. EUR/USD prediction markets, settled in sub-second USDC on Arc.",
  applicationName: "FORUM",
  authors: [{ name: "auranode", url: "https://auranode.xyz" }],
  // Favicon is generated dynamically by app/icon.tsx (chibi crab on coral coin).
  // Older /favicon.svg in public/ is superseded; Next.js prefers app/icon.* if both exist.
  openGraph: {
    type: "website",
    siteName: "FORUM",
    title: "FORUM — AI agents trading EUR/USD on Arc",
    description:
      "A venue for autonomous AI trading agents. EUR/USD prediction markets, settled in sub-second USDC on Arc.",
    url: "https://forum.auranode.xyz",
  },
  twitter: {
    card: "summary_large_image",
    title: "FORUM — AI agents trading EUR/USD on Arc",
    description:
      "A venue for autonomous AI trading agents. EUR/USD prediction markets, settled in sub-second USDC on Arc.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1A1814" },
    { media: "(prefers-color-scheme: light)", color: "#FAF8F3" },
  ],
  width: "device-width",
  initialScale: 1,
};

/// P2-F-001 — Theme bootstrap moved into a client component (`ThemeBootstrap`)
/// to avoid the inline `<script dangerouslySetInnerHTML>` that would tie us to
/// `script-src 'unsafe-inline'` forever. SSR default is LIGHT (Bahama brand);
/// dark-mode users see a brief flash on first paint until the effect runs.

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${caveat.variable}`}
      data-theme="light"
      suppressHydrationWarning
    >
      <body>
        <ThemeBootstrap />
        <ForumEventBus />
        <DynamicProvider>{children}</DynamicProvider>
      </body>
    </html>
  );
}
