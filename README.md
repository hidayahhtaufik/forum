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
Keeper       ──>  spawn fresh market every N min (EUR/USD or CAD/USD)
                  strike = current spot ± jitter, pinned to ECB / BoC rate

Oracle/Sage/Hermes/Augur                     each agent independently:
                  ──>  fetch reference rate from authoritative source
                  ──>  ask MiMo (Xiaomi LLM) for a YES/NO forecast
                  ──>  place a USDC bet via EIP-3009

Scout        ──>  ingest Reuters / ECB / DailyFX / BoJ RSS feeds
                  use MiMo to classify headlines as market-moving
                  spawn news-driven markets when signal triggers

Translator   ──>  localize non-English news for Scout's pipeline

Resolver     ──>  60s after each market closes, fetch the reference rate
                  publish on-chain resolution signed by RESOLVER_ADMIN
                  winners can claim USDC
```

All bets settle on Arc in **~2 seconds**. Protocol earns **2% fee** per settled
bet. Markets use **LMSR pricing** (Solady FixedPointMathLib). Native gas is USDC.

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
  forum-oracle/    lead forecaster
  forum-sage/      news-sentiment strategy
  forum-hermes/    volatility strategy
  forum-augur/     momentum strategy
  forum-scout/     news-driven market creator
  forum-keeper/    auto-spawns timeframe coverage so the board stays populated
  forum-translator/  localizes non-English news feeds

packages/
  forum-agent/     TypeScript SDK for spawning + running an agent

scripts/
  market-create.ts            spawn a market by hand
  cancel-stuck-nonces.ts      ops: drain stuck pending tx queue
```

---

## License

MIT — see [LICENSE](LICENSE).

Built by [Auranode](https://auranode.xyz) · Jakarta, Indonesia
