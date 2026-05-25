"use client";

/// Console-side EIP-712 challenge-response client for the auth gate that
/// landed with the SECURITY_AUDIT P0-B fixes. Every privileged trader
/// endpoint (bet, withdraw, claim, unlock-insights, plus
/// marketplace list/buy/rent and agent verify/update) requires:
///
///   X-Auth-Nonce: <0x32-byte nonce from /auth/challenge>
///   X-Auth-Signature: <0x65-byte EIP-712 signature>
///
/// Flow per privileged call:
///   1. POST /auth/challenge body={identity:traderAddress} → {nonce, expiresAt}
///   2. Sign the AuthChallenge typedData with the connected Dynamic wallet
///      (which is what /traders/issue bound as owner_wallet on first login).
///   3. Caller fires the privileged endpoint with both headers attached.

const API = process.env.NEXT_PUBLIC_MARKET_API_URL ?? "http://127.0.0.1:8403";

export type Signer = {
  /** EIP-712 typed-data signer — viem-compatible. Dynamic's primaryWallet
   *  connector exposes this via its EVM wallet shape. */
  signTypedData: (args: {
    domain: { name: string; version: string; chainId: number };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<string>;
  /** Connected wallet address — must match owner_wallet on the trader row. */
  address: string;
};

/// Arc Testnet chain id. Embedded so signerFromDynamic can force the wallet
/// onto Arc before returning — otherwise viem's signTypedData rejects with
/// "chainId should be same as current chainId" when the Dynamic wallet is
/// still on its default chain (e.g. mainnet) at signing time.
const ARC_CHAIN_ID = 5042002;

/// Build a Signer from a Dynamic primaryWallet. Throws when the wallet isn't
/// Ethereum-capable (e.g. a Solana wallet). Caller is responsible for the
/// isEthereumWallet check before invoking, so the type error message can be
/// pinned to that callsite. Typed `unknown` here because Dynamic + viem
/// expose strongly-typed generic signTypedData fns that don't quite line up
/// with our minimal interface — we just need the duck-typed call to work.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function signerFromDynamic(primaryWallet: any): Promise<Signer> {
  if (!primaryWallet) throw new Error("Wallet not connected");
  if (typeof primaryWallet.getWalletClient !== "function") {
    throw new Error("Wallet does not support EVM signing");
  }

  // Make sure the wallet is on Arc before we read the walletClient — Dynamic
  // populates wc.chain from the active network, so switching first ensures
  // viem signs with chainId=5042002 (matching the market-api auth domain).
  if (typeof primaryWallet.switchNetwork === "function") {
    try {
      await primaryWallet.switchNetwork(ARC_CHAIN_ID);
    } catch {
      // Embedded MPC wallets may not support switchNetwork — fall through
      // and let the downstream signTypedData call surface a clearer error.
    }
  }

  let wc: any;
  try {
    wc = await primaryWallet.getWalletClient();
  } catch (err) {
    throw new Error(`Wallet client failed: ${(err as Error).message ?? "unknown"}`);
  }
  if (!wc?.account) throw new Error("Wallet has no active account. Try reconnecting.");
  return {
    address: wc.account.address,
    signTypedData: (args) => wc.signTypedData(args) as Promise<string>,
  };
}

type ChallengeResponse = {
  identity: string;
  nonce: string;
  expiresAt: number;
  chainId: number;
};

/// Fetch a fresh nonce + the typed-data envelope, then sign with the supplied
/// wallet. Returns the headers the privileged endpoint expects.
///
/// `primaryWallet` is the Dynamic primaryWallet object; we use it to switch
/// to the server's expected chainId before signing so viem doesn't reject
/// with "chainId should be same as current chainId" (which fires when the
/// Dynamic wallet is connected to e.g. mainnet while we're signing Arc data).
export async function buildAuthHeaders(args: {
  traderAddress: string;
  signer: Signer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  primaryWallet?: any;
}): Promise<{ "X-Auth-Nonce": string; "X-Auth-Signature": string }> {
  const cRes = await fetch(`${API}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: args.traderAddress }),
  });
  if (!cRes.ok) {
    const text = await cRes.text().catch(() => "");
    throw new Error(`auth challenge failed: ${cRes.status} ${text.slice(0, 200)}`);
  }
  const c = (await cRes.json()) as ChallengeResponse;

  if (args.primaryWallet?.switchNetwork) {
    try {
      await args.primaryWallet.switchNetwork(c.chainId);
    } catch (err) {
      throw new Error(
        `Please switch wallet to Arc Testnet (chain ${c.chainId}). ${(err as Error).message ?? ""}`,
      );
    }
  }

  const signature = await args.signer.signTypedData({
    domain: { name: "FORUM market-api", version: "1", chainId: c.chainId },
    types: {
      AuthChallenge: [
        { name: "identity", type: "address" },
        { name: "nonce", type: "bytes32" },
        { name: "expiresAt", type: "uint256" },
      ],
    },
    primaryType: "AuthChallenge",
    message: {
      identity: args.traderAddress.toLowerCase(),
      nonce: c.nonce,
      expiresAt: c.expiresAt,
    },
  });

  return {
    "X-Auth-Nonce": c.nonce,
    "X-Auth-Signature": signature,
  };
}
