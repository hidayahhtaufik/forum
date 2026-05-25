/// Formatting helpers shared across components. Pure functions, no React.

/// Format 6-dec USDC base units into a human-readable USDC string.
/// 1_000_000n → "1.00"; 18_500n → "0.0185".
export function formatUsdc(value: bigint | string | number, opts?: { digits?: 2 | 4 | 6 }): string {
  const digits = opts?.digits ?? 4;
  const n = typeof value === "bigint" ? value : BigInt(value);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  if (digits === 2) {
    const rounded = (frac * 100n) / 1_000_000n;
    return `${whole}.${rounded.toString().padStart(2, "0")}`;
  }
  if (digits === 6) {
    return `${whole}.${frac.toString().padStart(6, "0")}`;
  }
  // digits === 4: typical for bet display
  const rounded = (frac * 10_000n) / 1_000_000n;
  return `${whole}.${rounded.toString().padStart(4, "0")}`;
}

/// "0xabcd…1234" rendering. Always 4 leading + 4 trailing hex.
export function truncAddress(addr: string): string {
  if (typeof addr !== "string" || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/// "0x401f…f136" — same shape, used for tx hashes (full hash is 66 chars).
export function truncHash(hash: string): string {
  if (typeof hash !== "string" || hash.length < 10) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

/// Human-readable relative time. "12s ago" / "4m ago" / "2h ago" / "3d ago".
/// `tsSeconds` is unix-seconds. Past-only — for future timestamps use `timeUntil`
/// or `closesIn` which handles both directions.
export function relativeTime(tsSeconds: number, nowMs: number = Date.now()): string {
  const diffMs = nowMs - tsSeconds * 1000;
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/// "in 29m" / "in 5h" / "in 3d" for future timestamps. Returns "now" within 5s
/// of the target, otherwise "Xm ago" / "Xh ago" / "Xd ago" once past.
/// Designed for `market.closesAt` displays.
export function closesIn(tsSeconds: number, nowMs: number = Date.now()): string {
  const diffSec = Math.floor((tsSeconds * 1000 - nowMs) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 5) return "now";
  const past = diffSec < 0;
  let chunk: string;
  if (abs < 60) chunk = `${abs}s`;
  else if (abs < 3600) chunk = `${Math.floor(abs / 60)}m`;
  else if (abs < 86400) chunk = `${Math.floor(abs / 3600)}h`;
  else chunk = `${Math.floor(abs / 86400)}d`;
  return past ? `${chunk} ago` : `in ${chunk}`;
}

/// Arcscan tx link.
export function arcscanTx(hash: string): string {
  return `https://testnet.arcscan.app/tx/${hash}`;
}

export function arcscanAddress(addr: string): string {
  return `https://testnet.arcscan.app/address/${addr}`;
}

/// Convert decimal-string WAD (1e18) to a number for display. Loses precision for very
/// large values, fine for shares display in 0-100 range.
export function wadToNumber(wad: string | bigint): number {
  const n = typeof wad === "bigint" ? wad : BigInt(wad);
  // Use BigInt division to keep 6 decimal digits of precision.
  const scaled = (n * 1_000_000n) / 10n ** 18n;
  return Number(scaled) / 1_000_000;
}

/// Strike WAD → decimal string with up to 4 dp. "1100000000000000000" → "1.1000".
export function formatStrikeWad(wad: string): string {
  return wadToNumber(wad).toFixed(4);
}
