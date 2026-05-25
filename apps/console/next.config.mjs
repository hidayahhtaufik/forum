import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// P1-F-001 — Content-Security-Policy + transport-security headers applied to
// every route. Allow-listed hosts cover Dynamic.xyz (wallet SDK + WebSocket),
// Arc Testnet RPC, Circle's IRIS attestation sandbox, and our own market-api.
// `script-src 'unsafe-inline'` is needed for the theme-bootstrap inline script
// in layout.tsx (P2-F-001) and Dynamic's runtime; `'unsafe-eval'` covers the
// dev/turbopack runtime and Dynamic's wallet bundles. `frame-ancestors 'none'`
// blocks the clickjacking risk on Withdraw / Bridge buttons.
const CSP = [
  "default-src 'self'",
  // Dynamic SDK ships across .dynamic.xyz, .dynamiclabs.com, .dynamicauth.com,
  // AND dynamic-static-assets.com (wallet-book CDN). Missing any one of them
  // breaks login or wallet picker. Be generous on script + connect.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.dynamic.xyz https://*.dynamiclabs.com https://*.dynamicauth.com https://dynamic-static-assets.com https://*.dynamic-static-assets.com",
  "style-src 'self' 'unsafe-inline' https://*.dynamic.xyz https://*.dynamicauth.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://*.dynamic.xyz https://*.dynamicauth.com https://dynamic-static-assets.com https://*.dynamic-static-assets.com",
  "connect-src 'self' https://api.forum.auranode.xyz https://*.dynamic.xyz https://*.dynamiclabs.com https://*.dynamicauth.com https://dynamic-static-assets.com https://*.dynamic-static-assets.com https://rpc.testnet.arc.network https://iris-api-sandbox.circle.com https://ethereum-sepolia-rpc.publicnode.com https://sepolia.base.org https://sepolia-rollup.arbitrum.io https://sepolia.basescan.org https://sepolia.etherscan.io https://sepolia.arbiscan.io wss://*.dynamic.xyz wss://*.dynamicauth.com wss://*.dynamiclabs.com",
  "frame-src 'self' https://*.dynamic.xyz https://*.dynamicauth.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Note: standalone output removed for simpler PM2 deployment via `next start`.
  // outputFileTracingRoot still pins the monorepo root so Next doesn't get
  // confused by stray lockfiles higher up.
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react", "recharts"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
