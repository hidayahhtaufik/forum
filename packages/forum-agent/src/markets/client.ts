import type { Market, SignedQuote, BetIntent, BetReceipt } from "../types.js";
import type { SignedAuthorization } from "../eip3009.js";
import type { Address } from "../types.js";

/// HTTP client for FORUM market-api. Wraps GET/POST endpoints with typed responses.
/// All money values are decimal strings (the API returns bigints as strings to avoid
/// JS number-precision loss); convert via `BigInt(value)` in app code.

export class MarketApiClient {
  readonly baseURL: string;
  readonly fetchImpl: typeof fetch;

  constructor(opts: { baseURL?: string; fetchImpl?: typeof fetch }) {
    this.baseURL = (opts.baseURL ?? "http://127.0.0.1:8403").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async info(): Promise<{
    name: string;
    version: string;
    chainId: number;
    /// Address agents must use as `authorization.to` when signing EIP-3009 USDC transfers.
    payTo: Address;
    facilitator: string;
    contracts: Record<string, Address>;
  }> {
    return await this.getJson("/");
  }

  async health(): Promise<{ ok: boolean; onchain: boolean; totalMarkets: string | null }> {
    return await this.getJson("/health");
  }

  async listMarkets(filter?: { status?: "open" | "closed" | "resolved" }): Promise<Market[]> {
    const qs = filter?.status ? `?status=${filter.status}` : "";
    const res = await this.getJson<{ count: number; markets: Market[] }>(`/markets${qs}`);
    return res.markets;
  }

  async getMarket(id: string): Promise<Market | null> {
    try {
      return await this.getJson<Market>(`/markets/${id}`);
    } catch (err) {
      if (err instanceof MarketApiError && err.status === 404) return null;
      throw err;
    }
  }

  async getQuote(marketId: string, outcome: 0 | 1, sharesWad: bigint): Promise<SignedQuote> {
    const qs = `?outcome=${outcome}&shares=${sharesWad.toString()}`;
    return await this.getJson<SignedQuote>(`/markets/${marketId}/quote${qs}`);
  }

  /// Submit a bet. Body packs the agent's signed BetIntent + EIP-3009 USDC authorization.
  /// On success the server has already settled USDC, called ForexMarket.buyShares, and
  /// minted outcome tokens. Returns the on-chain receipt.
  async placeBet(input: {
    marketId: string;
    intent: BetIntent;
    intentSignature: `0x${string}`;
    authorization: SignedAuthorization;
  }): Promise<BetReceipt> {
    return await this.postJson<BetReceipt>(`/markets/${input.marketId}/bets`, {
      intent: input.intent,
      intentSignature: input.intentSignature,
      authorization: input.authorization,
    });
  }

  /// M1 Trace Pinning. Publish the LLM rationale that produced a bet so the
  /// hash can be referenced from the bet row. v0.1 stores in market-api DB;
  /// M1 final adds an Irys mainnet pin so the trace is permanent.
  async pinForecast(input: {
    agentAddress: `0x${string}`;
    marketId: `0x${string}`;
    outcome: 0 | 1;
    rationale: string;
    probability?: string;
    confidence?: string;
    model?: string;
    rationaleJson?: unknown;
    /** M2.2 encrypted trace. Server stores the bytes as-is; only the
     *  key-holder can decrypt. `rationale` must be the base64-encoded
     *  ciphertext when this is set. */
    cipher?: { alg: "aes-256-gcm"; iv: string; authTag: string };
  }): Promise<{
    sha256: `0x${string}`;
    irysId: string | null;
    irysUrl: string | null;
    deduped: boolean;
    encrypted?: boolean;
  }> {
    return await this.postJson(`/forecasts/pin`, input);
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseURL}${path}`, { method: "GET" });
    return await this.handleResponse<T>(res, path);
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseURL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await this.handleResponse<T>(res, path);
  }

  private async handleResponse<T>(res: Response, path: string): Promise<T> {
    if (!res.ok) {
      let detail = "";
      try {
        const j = await res.json();
        detail = typeof (j as { error?: string }).error === "string" ? (j as { error: string }).error : JSON.stringify(j);
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new MarketApiError(`market-api ${path} ${res.status}: ${detail}`, res.status);
    }
    return (await res.json()) as T;
  }
}

export class MarketApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "MarketApiError";
  }
}
