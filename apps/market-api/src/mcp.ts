import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Env } from "./env.js";
import type { Deployment } from "./deployment.js";
import type { Clients } from "./chain/clients.js";
import type { DB } from "./db/index.js";
import { ForexMarketAbi } from "./chain/abi/forex-market.js";
import { markets } from "./db/schema-pg.js";

/// FORUM MCP server — exposes read-only tools so external agents (Claude Code, Cursor,
/// Codex, custom MCP clients) can discover markets and quote bets without integrating
/// our SDK.
///
/// Writes (place_bet) are intentionally NOT here — handling private keys via MCP is a
/// foot-gun. Agents that want to bet should sign locally and POST to /markets/:id/bets.
///
/// Transport: Streamable HTTP at /mcp on the same Hono server.

export type McpDeps = {
  env: Env;
  deployment: Deployment;
  clients: Clients;
  db: DB;
};

export function createMcpServer(deps: McpDeps): McpServer {
  const { env, deployment, clients, db } = deps;

  const server = new McpServer({
    name: "forum-market-api",
    version: "0.1.0",
  });

  // ============================================================
  // Tools
  // ============================================================

  server.registerTool(
    "list_markets",
    {
      description:
        "List FORUM prediction markets. Optionally filter by status (open/closed/resolved) or pair (e.g. EURUSD).",
      inputSchema: {
        status: z.enum(["open", "closed", "resolved"]).optional(),
        pair: z.string().optional(),
      },
    },
    async ({ status, pair }) => {
      let rows = await db.select().from(markets);
      if (status === "open") rows = rows.filter((r) => r.phase === 0);
      else if (status === "closed") rows = rows.filter((r) => r.phase === 1);
      else if (status === "resolved") rows = rows.filter((r) => r.phase === 2);
      if (pair) rows = rows.filter((r) => r.pair === pair);

      const summary = rows.map((m) => ({
        id: m.id,
        question: m.question,
        pair: m.pair,
        comparator: m.comparator,
        strikeWad: m.strikeWad,
        closesAt: m.closesAt,
        phase: ["OPEN", "CLOSED", "RESOLVED"][m.phase] ?? "UNKNOWN",
        winningOutcome: m.winningOutcome,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: summary.length, markets: summary }, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_market",
    {
      description: "Get full state of a single FORUM market by its bytes32 marketId.",
      inputSchema: {
        marketId: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "marketId must be 0x + 64 hex"),
      },
    },
    async ({ marketId }) => {
      const m = (await db.select().from(markets).where(eq(markets.id, marketId.toLowerCase())))[0];
      if (!m) {
        return {
          isError: true,
          content: [{ type: "text", text: `market not found: ${marketId}` }],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(m, null, 2) }] };
    },
  );

  server.registerTool(
    "get_quote",
    {
      description:
        "Get an on-chain LMSR price quote for buying outcome shares. Returns cost in 6-dec USDC base units. Does NOT sign or place a bet.",
      inputSchema: {
        marketId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
        outcome: z.union([z.literal(0), z.literal(1)]).describe("0=NO, 1=YES"),
        sharesWad: z.string().regex(/^\d+$/).describe("Shares to buy in WAD (1e18 = 1 share)"),
      },
    },
    async ({ marketId, outcome, sharesWad }) => {
      const m = (await db.select().from(markets).where(eq(markets.id, marketId.toLowerCase())))[0];
      if (!m) {
        return {
          isError: true,
          content: [{ type: "text", text: `market not found: ${marketId}` }],
        };
      }
      try {
        const costUsdc = (await clients.publicClient.readContract({
          address: m.address as `0x${string}`,
          abi: ForexMarketAbi,
          functionName: "previewBuy",
          args: [outcome, BigInt(sharesWad)],
        })) as bigint;
        const feeUsdc = (costUsdc * 200n) / 10_000n;
        const total = costUsdc + feeUsdc;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  marketId,
                  marketAddress: m.address,
                  outcome,
                  sharesWad,
                  costUsdc: costUsdc.toString(),
                  feeUsdc: feeUsdc.toString(),
                  totalUsdc: total.toString(),
                  note: "USDC values are in 6-decimal base units (1_000_000 = 1.00 USDC). To place a bet, agents must POST a signed intent + EIP-3009 authorization to /markets/:id/bets (not available via MCP).",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `previewBuy reverted: ${(err as Error).message}` }],
        };
      }
    },
  );

  server.registerTool(
    "get_service_info",
    {
      description:
        "Get FORUM service metadata: chain id, contract addresses, payTo wallet (for EIP-3009 authorizations), Circle Gateway facilitator URL.",
      inputSchema: {},
    },
    async () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                name: "FORUM market-api",
                version: "0.1.0",
                chainId: env.ARC_CHAIN_ID,
                payTo: clients.account.address,
                facilitator: env.CIRCLE_GATEWAY_FACILITATOR_URL,
                contracts: {
                  forexMarketFactory: deployment.forexMarketFactory,
                  outcomeToken: deployment.outcomeToken,
                  resolver: deployment.resolver,
                  agentRegistry: deployment.agentRegistry,
                },
                bettingNote:
                  "To place a bet, sign EIP-712 intent + EIP-3009 transferWithAuthorization (to=payTo) and POST to /markets/:id/bets. See docs/INTEROP.md for multi-language quickstart.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ============================================================
  // Resources (read-only data discovery)
  // ============================================================

  server.registerResource(
    "markets-index",
    "forum://markets",
    {
      title: "Open FORUM markets",
      description: "Live list of open prediction markets on FORUM.",
      mimeType: "application/json",
    },
    async () => {
      const open = await db.select().from(markets).where(eq(markets.phase, 0));
      return {
        contents: [
          {
            uri: "forum://markets",
            mimeType: "application/json",
            text: JSON.stringify(open, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "market-by-id",
    new ResourceTemplate("forum://markets/{id}", { list: undefined }),
    {
      title: "Single FORUM market",
      description: "Full state of one FORUM market addressed by bytes32 id.",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const m = (await db
        .select()
        .from(markets)
        .where(eq(markets.id, String(id).toLowerCase())))[0];
      if (!m) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `market not found: ${id}`,
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(m, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

/// Single-session HTTP transport bridge. For multi-client production, we'd manage
/// per-client sessions keyed on `Mcp-Session-Id`. v0.1: one transport per request,
/// stateless mode (sessionIdGenerator omitted).
export async function handleMcpHttp(server: McpServer, req: IncomingMessage, res: ServerResponse) {
  // Stateless: no sessionIdGenerator. Each request opens + closes its own transport.
  // Cast through `any` because the SDK's TS types fight with `exactOptionalPropertyTypes`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transport = new StreamableHTTPServerTransport({} as any);
  res.on("close", () => transport.close());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await server.connect(transport as any);
  await transport.handleRequest(req, res);
}
