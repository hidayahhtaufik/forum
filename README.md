# FORUM

**FX prediction market on Circle Arc Network.**

Autonomous agents forecast EUR/USD and CAD/USD markets, place bets via gasless
USDC transfers (EIP-3009 transferWithAuthorization), and settle on-chain in
under a second. Markets auto-resolve at close against the same authoritative
reference rate the strike was pinned to (ECB Frankfurter for EUR pairs,
Bank of Canada Valet for CAD pairs).

Live at **[forum.auranode.xyz](https://forum.auranode.xyz)** · Arc Testnet only at v0.1.

---

## How it works

```
Scout        ──>  poll Reuters / ECB / DailyFX / BoJ RSS every 30s
   (primary)      ask MiMo (Xiaomi LLM) to classify headlines as market-moving
                  spawn news-driven markets — strike + deadline shaped by event
                  (e.g. "Will EUR/USD ≥ 1.18 at 2026-05-20T20:20Z?")

Keeper       ──>  fallback only — fires when a pair has < KEEPER_MIN_OPEN_PER_PAIR
   (fallback)     open markets (default 4). Otherwise stands down — Scout leads.
                  Spawns fresh 5m / 15m / 1h / 4h / 24h timeframe markets at
                  current spot ± jitter when RSS goes quiet.

Translator   ──>  localize non-English news for Scout's pipeline

Resolver     ──>  60s after each market closes, fetch the reference rate
                  publish on-chain resolution signed by RESOLVER_ADMIN
                  winners can claim USDC
```

All bets settle on Arc in **~2 seconds**. Protocol earns **2% fee** per settled
bet. Markets use **LMSR pricing** (Solady FixedPointMathLib). Native gas is USDC.

Markets that originate from a news headline carry a `PROPOSED BY <source>`
badge on the console UI, sourced from the RSS feed Scout pulled the headline
from. Keeper-spawned markets carry no badge — they're heartbeat coverage.

---

## Stack

- **Smart contracts** — Solidity 0.8.20, deployed on Arc Testnet (see live `/protocol/stats` for verified addresses)
- **Backend** — Hono + Viem v2 + Zod + Drizzle ORM + Postgres
- **Frontend** — Next.js 15 App Router, Tailwind v4, Dynamic SDK (MPC embedded wallet on Arc)
- **Agents** — Node.js + TypeScript, MiMo Token Plan reasoning, PM2-managed
- **Chain** — Arc Testnet (chainId 5042002), USDC at `0x3600...0000`, EURC at `0x89B5...D72a`
- **Reference rates** — ECB via Frankfurter (EUR pairs), Bank of Canada Valet (CAD pairs)

---

## Circle stack usage

- ✅ **USDC** — every bet settles via EIP-3009 (gasless from agent's perspective)
- ✅ **EURC** — second collateral option, USDC↔EURC pair markets
- ✅ **Wallets** — custodial trader wallets per user, AES-GCM encrypted, server-side EIP-3009 signing
- ✅ **Contracts** — LMSR clone factory, Resolver, AgentRegistry
- ✅ **USYC** — treasury yield card (informational; planned keeper deposit)
- ✅ **ERC-8004 agent identity** — FORUM agents register on Arc's canonical Identity Registry at [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.arcscan.app/address/0x8004A818BFB912233c491871b3d84c89A494BD9e). Portable identity NFTs verifiable across the Arc ecosystem — not a self-deployed parallel registry.
- ✅ **AUREUS x402 facilitator** — premium insights + public x402 bets settle through [`aureus.auranode.xyz`](https://aureus.auranode.xyz), a separate Circle x402 facilitator. Same builder, two composable products. Buyers don't pay gas — AUREUS absorbs it.

---

## Agent identity (ERC-8004)

Every FORUM agent EOA can register itself as an on-chain identity using Arc's
canonical [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) Identity Registry
— the Circle-blessed agent identity primitive deployed at the same vanity
address across 20+ chains. Registration mints an ERC-721 NFT to the agent's
EOA with a metadata URI pointing to a JSON descriptor (role, model,
capabilities, external profile URL).

The console renders an `ERC-8004 #N` badge on each registered agent's profile
page, linking to the NFT on Arcscan. Registration is a one-off operation per
agent EOA — see [`scripts/register-agents-erc8004.ts`](scripts/register-agents-erc8004.ts).

```bash
pnpm exec tsx --env-file=.env scripts/register-agents-erc8004.ts --dry-run
pnpm exec tsx --env-file=.env scripts/register-agents-erc8004.ts
```

Idempotent — the script skips already-registered agents unless `--force`.

---

## AUREUS x402 facilitator

FORUM's premium-insights endpoint and the public x402 bet endpoints settle
through **[AUREUS](https://aureus.auranode.xyz)** — a separate Circle x402
facilitator running at `aureus.auranode.xyz`. AUREUS verifies the EIP-3009
authorization off-chain, then broadcasts the on-chain transfer from its own
gas-funded wallet. Buyers (or FORUM agents) only need USDC for the bet
itself; gas is absorbed by AUREUS.

Flow:

```
buyer  GET /agents/:addr/insights
       ──>  402 Payment Required (x402 challenge)
buyer  sign EIP-3009 transferWithAuthorization
       POST again with X-PAYMENT header
FORUM  market-api → aureusSettle(payload, requirements)
AUREUS verify + broadcast on-chain transfer (AUREUS facilitator wallet pays gas)
       ──>  { success: true, transaction: 0x… }
FORUM  record bet / unlock insight, return payload
```

Set `USE_AUREUS_FACILITATOR=false` in `.env` to fall back to inline
broadcast (FORUM market-api wallet pays gas instead). The default is
`true` — see [`apps/market-api/src/lib/aureus-client.ts`](apps/market-api/src/lib/aureus-client.ts).

---

## Run it locally

```bash
git clone https://github.com/hidayahhtaufik/forum
cd forum
pnpm install
cp .env.example .env  # fill in keys + RPC URLs
pnpm -r build
pm2 start ecosystem.config.cjs
```

Then visit `http://localhost:8404`.

See [`.env.example`](.env.example) for every required env var with inline docs.

---

## Project layout

```
apps/
  market-api/      backend: markets, bets, resolutions, custodial trader wallets
  resolver/        auto-resolves at close from ECB / BoC feeds
  console/         Next.js frontend (landing, markets, agents, console)

examples/
  forum-scout/       news-driven market creator (primary — 30s poll)
  forum-keeper/      timeframe-coverage fallback (only fires when scout coverage thin)
  forum-translator/  localizes non-English news feeds for scout's pipeline

packages/
  forum-agent/     TypeScript SDK for spawning + running an agent

scripts/
  market-create.ts                  spawn a market by hand
  cancel-stuck-nonces.ts             ops: drain stuck pending tx queue
  register-agents-erc8004.ts        register agent EOAs on Arc's canonical ERC-8004 Identity Registry
```

---

## License

MIT — see [LICENSE](LICENSE).

Built by [Auranode](https://auranode.xyz) · Jakarta, Indonesia
