#!/usr/bin/env tsx
/// M8 — Demo: pay-per-call agent insights via x402 + EIP-3009.
///
/// Walks the full x402 negotiation flow against /agents/:addr/insights:
///   1. GET → 402 Payment Required + EIP-712 typed-data payment intent
///   2. Sign EIP-3009 transferWithAuthorization (the same primitive
///      Circle Nanopayments runs on)
///   3. Resend with X-PAYMENT header → 200 + premium payload
///
/// Run from repo root:
///   BUYER_PRIVATE_KEY=0x... \
///   AGENT_ADDRESS=0xd04d...ae2f \
///   pnpm tsx scripts/x402-buy-insights.ts
///
/// Buyer wallet needs at least 0.001 USDC on Arc Testnet to settle.

import { privateKeyToAccount } from "viem/accounts";

const API = process.env["MARKET_API_URL"] ?? "http://127.0.0.1:8403";
const AGENT = process.env["AGENT_ADDRESS"];
const PRIVKEY = process.env["BUYER_PRIVATE_KEY"];

if (!AGENT || !/^0x[a-fA-F0-9]{40}$/.test(AGENT)) {
  console.error("AGENT_ADDRESS env var required (0x + 40 hex)");
  process.exit(1);
}
if (!PRIVKEY || !/^0x[a-fA-F0-9]{64}$/.test(PRIVKEY)) {
  console.error("BUYER_PRIVATE_KEY env var required (0x + 64 hex)");
  process.exit(1);
}

const buyer = privateKeyToAccount(PRIVKEY as `0x${string}`);
console.log(`x402 demo — buyer ${buyer.address}, agent ${AGENT}`);

type X402Challenge = {
  x402: {
    scheme: "exact";
    network: "arc-testnet";
    maxAmountRequired: string;
    asset: `0x${string}`;
    payTo: `0x${string}`;
    extra: {
      validAfter: number;
      validBefore: number;
      nonce: `0x${string}`;
      typedData: {
        domain: {
          name: string;
          version: string;
          chainId: number;
          verifyingContract: `0x${string}`;
        };
        primaryType: "TransferWithAuthorization";
        types: {
          TransferWithAuthorization: Array<{ name: string; type: string }>;
        };
        message: {
          to: `0x${string}`;
          value: string;
          validAfter: string;
          validBefore: string;
          nonce: `0x${string}`;
        };
      };
    };
  };
};

async function main(): Promise<void> {
  // Step 1 — Probe with no payment → expect 402
  console.log(`\n[1/3] GET /agents/${AGENT}/insights (no payment)`);
  const probe = await fetch(`${API}/agents/${AGENT}/insights`);
  if (probe.status !== 402) {
    console.error(`✗ expected 402, got ${probe.status}`);
    const body = await probe.text();
    console.error(body);
    process.exit(2);
  }
  const challengeJson = (await probe.json()) as X402Challenge;
  const challenge = challengeJson.x402;
  if (!challenge || challenge.scheme !== "exact") {
    console.error("✗ malformed x402 challenge");
    process.exit(2);
  }
  console.log(`  ✓ 402 Payment Required`);
  console.log(`  ✓ price ${Number(challenge.maxAmountRequired) / 1e6} USDC → ${challenge.payTo}`);

  // Step 2 — Sign the EIP-712 typed data the server told us to sign.
  console.log(`\n[2/3] Sign EIP-3009 TransferWithAuthorization`);
  const td = challenge.extra.typedData;
  const message = {
    from: buyer.address,
    to: td.message.to,
    value: BigInt(td.message.value),
    validAfter: BigInt(td.message.validAfter),
    validBefore: BigInt(td.message.validBefore),
    nonce: td.message.nonce,
  };
  const sig = await buyer.signTypedData({
    domain: td.domain,
    types: td.types,
    primaryType: td.primaryType,
    message,
  });
  const r = ("0x" + sig.slice(2, 66)) as `0x${string}`;
  const s = ("0x" + sig.slice(66, 130)) as `0x${string}`;
  const v = parseInt(sig.slice(130, 132), 16);
  console.log(`  ✓ signed (v=${v}, r=${r.slice(0, 10)}…, s=${s.slice(0, 10)}…)`);

  const payload = {
    from: buyer.address,
    validAfter: td.message.validAfter,
    validBefore: td.message.validBefore,
    nonce: td.message.nonce,
    v,
    r,
    s,
  };
  const xPayment = Buffer.from(JSON.stringify(payload)).toString("base64");

  // Step 3 — Resend with X-PAYMENT header.
  console.log(`\n[3/3] GET /agents/${AGENT}/insights (X-PAYMENT)`);
  const paid = await fetch(`${API}/agents/${AGENT}/insights`, {
    headers: { "X-PAYMENT": xPayment },
  });
  if (!paid.ok) {
    console.error(`✗ expected 200, got ${paid.status}`);
    const body = await paid.text();
    console.error(body);
    process.exit(3);
  }
  const insights = (await paid.json()) as {
    settledTx: string | null;
    persona: { personaLabel?: string | null; strategyId?: string | null };
    honos: { winRate: number | null; rank: number | null; settled: number };
    stats: { totalBets: number; totalVolumeUsdc: string };
  };
  console.log(`  ✓ 200 OK — paid, settled on Arc`);
  if (insights.settledTx) {
    console.log(`  ✓ settle tx ${insights.settledTx}`);
    console.log(`    arcscan: https://testnet.arcscan.app/tx/${insights.settledTx}`);
  }

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`  M8 e2e: PASS`);
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`  persona      ${insights.persona.personaLabel ?? "(unnamed)"} · ${insights.persona.strategyId ?? "—"}`);
  console.log(`  honos rank   ${insights.honos.rank ?? "—"} · win-rate ${insights.honos.winRate ?? "—"} · settled ${insights.honos.settled}`);
  console.log(`  bets         ${insights.stats.totalBets} · volume ${Number(insights.stats.totalVolumeUsdc) / 1e6} USDC`);
  console.log(`════════════════════════════════════════════════════════════\n`);
}

main().catch((err) => {
  console.error(`\n✗ x402 demo FAILED: ${(err as Error).message}`);
  process.exit(1);
});
