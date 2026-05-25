/// FX reference rate fetcher. Pair-aware source dispatch so each market
/// resolves against the authoritative central-bank publication for its
/// quote currency:
///
///   EUR pairs (EUR/USD, EUR/CAD, EUR/JPY) →
///     ECB Statistical Data Warehouse via Frankfurter
///       (api.frankfurter.app — public, no auth, ECB-derived)
///   CAD pairs (CAD/USD, USD/CAD) →
///     Bank of Canada Valet API
///       (bankofcanada.ca/valet — official, no auth, FXUSDCAD series)
///
/// Anything else falls back to Frankfurter's cross-rate calculation —
/// still ECB-derived data, just computed from EUR-base rates. Tagged as
/// "ECB-cross" in the source field so the compliance audit page can
/// distinguish direct attestation from derived attestation.
///
/// Shared with examples/forum-oracle.

export type EcbRate = {
  date: string;   // YYYY-MM-DD
  base: string;   // "EUR" | "CAD" | ...
  symbol: string; // "USD" | "EUR" | ...
  rate: number;
  /// Which authoritative publication this rate was sourced from.
  /// Persisted to resolutions.source so the audit trail records it.
  source: "ECB" | "BoC" | "ECB-cross";
};

/// Source classifier — picks the authoritative publication for the pair.
/// Resolver writes the result to resolutions.source so audit consumers
/// can tell direct attestation (ECB / BoC) from cross-derived (ECB-cross).
export function sourceForPair(base: string, symbol: string): "ECB" | "BoC" | "ECB-cross" {
  const b = base.toUpperCase();
  const s = symbol.toUpperCase();
  if (b === "EUR" || s === "EUR") return "ECB";     // ECB publishes EUR-base directly
  if (b === "CAD" || s === "CAD") return "BoC";     // Bank of Canada publishes USDCAD directly
  return "ECB-cross";                               // Frankfurter computes cross-rate from EUR-base
}

/// Frankfurter mirror of ECB Statistical Data Warehouse. Direct attestation
/// when one of {base, symbol} is EUR; otherwise the API computes a cross
/// rate from EUR-base data — flagged "ECB-cross" by sourceForPair.
async function fetchFrankfurterLatest(symbol: string, base: string): Promise<EcbRate> {
  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`fetchFrankfurterLatest: HTTP ${res.status}`);
  const json = (await res.json()) as { date: string; base: string; rates: Record<string, number> };
  const rate = json.rates?.[symbol];
  if (typeof rate !== "number") throw new Error(`fetchFrankfurterLatest: no rate for ${base}/${symbol}`);
  return { date: json.date, base: json.base, symbol, rate, source: sourceForPair(base, symbol) };
}

async function fetchFrankfurterForDate(date: Date, symbol: string, base: string): Promise<EcbRate> {
  const iso = date.toISOString().slice(0, 10);
  const url = `https://api.frankfurter.app/${iso}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    if (res.status === 404 || res.status === 422) return fetchFrankfurterLatest(symbol, base);
    throw new Error(`fetchFrankfurterForDate: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { date: string; base: string; rates: Record<string, number> };
  const rate = json.rates?.[symbol];
  if (typeof rate !== "number") throw new Error(`fetchFrankfurterForDate: no rate for ${base}/${symbol}`);
  return { date: json.date, base: json.base, symbol, rate, source: sourceForPair(base, symbol) };
}

/// Bank of Canada Valet API — official Canadian noon-rate publication.
/// FXUSDCAD = how many CAD per USD (the market convention "USD/CAD"
/// quote). For CAD/USD we invert: 1/FXUSDCAD. Free, no auth, no rate limit.
/// https://www.bankofcanada.ca/valet/docs
async function fetchBocLatest(symbol: string, base: string): Promise<EcbRate> {
  const url = `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`fetchBocLatest: HTTP ${res.status}`);
  const json = (await res.json()) as {
    observations?: Array<{ d: string; FXUSDCAD?: { v: string } }>;
  };
  const obs = json.observations?.[0];
  const raw = obs?.FXUSDCAD?.v;
  if (!obs || !raw) throw new Error("fetchBocLatest: empty observations");
  const usdcad = Number(raw);
  if (!Number.isFinite(usdcad) || usdcad <= 0) throw new Error(`fetchBocLatest: bad rate ${raw}`);
  // BoC publishes FXUSDCAD (USD/CAD). Invert when the FORUM market is CAD/USD.
  const rate =
    base.toUpperCase() === "CAD" && symbol.toUpperCase() === "USD"
      ? 1 / usdcad
      : usdcad;
  return { date: obs.d, base: base.toUpperCase(), symbol: symbol.toUpperCase(), rate, source: "BoC" };
}

async function fetchBocForDate(date: Date, symbol: string, base: string): Promise<EcbRate> {
  const iso = date.toISOString().slice(0, 10);
  const url = `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=${iso}&end_date=${iso}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    // Weekend / holiday — BoC noon rate only publishes Mon-Fri. Fall through
    // to the latest observation (same posture as the Frankfurter fallback).
    if (res.status === 404) return fetchBocLatest(symbol, base);
    throw new Error(`fetchBocForDate: HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    observations?: Array<{ d: string; FXUSDCAD?: { v: string } }>;
  };
  const obs = json.observations?.[0];
  if (!obs) return fetchBocLatest(symbol, base); // empty array for non-publish days
  const raw = obs.FXUSDCAD?.v;
  if (!raw) throw new Error("fetchBocForDate: missing FXUSDCAD value");
  const usdcad = Number(raw);
  if (!Number.isFinite(usdcad) || usdcad <= 0) throw new Error(`fetchBocForDate: bad rate ${raw}`);
  const rate =
    base.toUpperCase() === "CAD" && symbol.toUpperCase() === "USD"
      ? 1 / usdcad
      : usdcad;
  return { date: obs.d, base: base.toUpperCase(), symbol: symbol.toUpperCase(), rate, source: "BoC" };
}

/// Pair-aware reference fetcher. ECB pairs go through Frankfurter, CAD
/// pairs go through Bank of Canada's Valet API. Other crosses fall back
/// to Frankfurter cross-rate and are tagged "ECB-cross".
export async function fetchEcbRateLatest(symbol: string = "USD", base: string = "EUR"): Promise<EcbRate> {
  const source = sourceForPair(base, symbol);
  return source === "BoC"
    ? fetchBocLatest(symbol, base)
    : fetchFrankfurterLatest(symbol, base);
}

export async function fetchEcbRateForDate(
  date: Date,
  symbol: string = "USD",
  base: string = "EUR",
): Promise<EcbRate> {
  const source = sourceForPair(base, symbol);
  return source === "BoC"
    ? fetchBocForDate(date, symbol, base)
    : fetchFrankfurterForDate(date, symbol, base);
}

/// Parse FORUM's market `pair` field (e.g. "EURUSD", "CADUSD") into the
/// (base, symbol) tuple the Frankfurter API expects. Unknown formats
/// throw — markets always come from a curated keeper/scout dictionary.
export function parsePair(pair: string): { base: string; symbol: string } {
  const normalized = pair.toUpperCase().replace(/[\/\s_-]/g, "");
  if (normalized.length !== 6) {
    throw new Error(`parsePair: expected 6-char pair (e.g. EURUSD), got "${pair}"`);
  }
  return { base: normalized.slice(0, 3), symbol: normalized.slice(3) };
}
