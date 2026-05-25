import { describe, it, expect } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { signTransferAuthorization, decodeRsv, randomNonce } from "../src/eip3009.js";
import { TRANSFER_WITH_AUTHORIZATION_TYPES, USDC_EIP712_DOMAIN } from "../src/chain.js";

describe("signTransferAuthorization", () => {
  it("produces a signature recoverable to the signer", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = randomNonce();
    const auth = await signTransferAuthorization(account, {
      to: "0x58CDa47b1Ad044757B44046718eD64036583F2A3",
      valueUsdc6: 1_000_000n,
      nonce,
    });

    const recovered = await recoverTypedDataAddress({
      domain: USDC_EIP712_DOMAIN,
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from,
        to: auth.to,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce,
      },
      signature: auth.signature,
    });

    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("rejects non-32-byte nonce", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await expect(
      signTransferAuthorization(account, {
        to: "0x58CDa47b1Ad044757B44046718eD64036583F2A3",
        valueUsdc6: 1n,
        nonce: "0xdeadbeef" as `0x${string}`,
      }),
    ).rejects.toThrow(/nonce/);
  });

  it("defaults validBefore to 7 days from now", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nowSec = Math.floor(Date.now() / 1000);
    const auth = await signTransferAuthorization(account, {
      to: "0x58CDa47b1Ad044757B44046718eD64036583F2A3",
      valueUsdc6: 1n,
      nonce: randomNonce(),
    });
    // Within +/- 5s of (now + 7 days).
    expect(auth.validBefore).toBeGreaterThan(nowSec + 7 * 24 * 3600 - 5);
    expect(auth.validBefore).toBeLessThan(nowSec + 7 * 24 * 3600 + 5);
  });

  it("rejects validBefore <= validAfter", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await expect(
      signTransferAuthorization(account, {
        to: "0x58CDa47b1Ad044757B44046718eD64036583F2A3",
        valueUsdc6: 1n,
        nonce: randomNonce(),
        validAfter: 1_000,
        validBefore: 999,
      }),
    ).rejects.toThrow(/validBefore/);
  });
});

describe("decodeRsv", () => {
  it("normalizes legacy v=0/1 to 27/28", () => {
    // Fake signature with v=00 at the end. We append a no-op 0x00 byte.
    const fakeSig = ("0x" + "ab".repeat(64) + "00") as `0x${string}`;
    const { v } = decodeRsv(fakeSig);
    expect(v).toBe(27);
  });

  it("preserves modern v=27/28", () => {
    const fakeSig = ("0x" + "ab".repeat(64) + "1c") as `0x${string}`;
    const { v } = decodeRsv(fakeSig);
    expect(v).toBe(28);
  });

  it("rejects wrong-length signatures", () => {
    expect(() => decodeRsv("0xdeadbeef")).toThrow(/65 bytes/);
  });
});

describe("randomNonce", () => {
  it("returns 0x + 64 hex", () => {
    const n = randomNonce();
    expect(n).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("returns distinct values", () => {
    const a = randomNonce();
    const b = randomNonce();
    expect(a).not.toBe(b);
  });
});
