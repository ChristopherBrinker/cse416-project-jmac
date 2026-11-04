// ox (viem's core) imports secp256k1 statically; viem's own verifyMessage
// loads it with a dynamic import(), which the Convex runtime rejects.
import { Hex, PersonalMessage, Secp256k1, Signature } from "ox";
import { getAddress, isAddress } from "viem";

/**
 * Wallet ownership challenges. A user proves control of a provider wallet by
 * signing a server-issued message (EIP-191 personal_sign) that binds their
 * account, the wallet, the supported chain, a random nonce, and an expiry.
 * Each challenge is single-use; this module holds the pure parts so they can
 * be unit-tested outside Convex.
 */

export const WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const SUPPORTED_CHAIN_ID = 31_337;
const NONCE_BYTES = 16;
const SIGNATURE_PATTERN = /^0x[\da-fA-F]{130}$/u;

export interface WalletChallenge {
  userId: string;
  walletAddress: string;
  nonce: string;
  message: string;
  expiresAt: number;
  used: boolean;
}

export type ChallengeCheck = { ok: true } | { ok: false; error: string };

export const normalizeWalletAddress = (address: string): string | null =>
  isAddress(address, { strict: false }) ? getAddress(address) : null;

export const createNonce = (): string => {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
};

export const buildChallengeMessage = ({
  userId,
  walletAddress,
  nonce,
  issuedAt,
  expiresAt,
}: {
  userId: string;
  walletAddress: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}): string =>
  [
    "JMAC provider wallet verification",
    "",
    "Sign this message to prove you control this wallet. Signing is free and does not send a transaction.",
    "",
    `Account: ${userId}`,
    `Wallet: ${walletAddress}`,
    `Chain ID: ${SUPPORTED_CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(expiresAt).toISOString()}`,
  ].join("\n");

/** Checks everything except the signature, which needs async recovery. */
export const checkChallengeUsable = (
  challenge: WalletChallenge,
  userId: string,
  now: number
): ChallengeCheck => {
  if (challenge.userId !== userId) {
    return { ok: false, error: "Wallet challenge not found" };
  }
  if (challenge.used) {
    return {
      ok: false,
      error: "This wallet challenge was already used. Request a new one.",
    };
  }
  if (now > challenge.expiresAt) {
    return {
      ok: false,
      error: "This wallet challenge expired. Request a new one.",
    };
  }
  return { ok: true };
};

export const verifyChallengeSignature = async (
  challenge: WalletChallenge,
  signature: string
): Promise<ChallengeCheck> => {
  if (!SIGNATURE_PATTERN.test(signature)) {
    return { ok: false, error: "Invalid signature format" };
  }
  try {
    const recovered = Secp256k1.recoverAddress({
      payload: PersonalMessage.getSignPayload(
        Hex.fromString(challenge.message)
      ),
      signature: Signature.fromHex(signature as `0x${string}`),
    });
    return recovered.toLowerCase() === challenge.walletAddress.toLowerCase()
      ? { ok: true }
      : {
          ok: false,
          error: "The signature does not match the challenged wallet",
        };
  } catch {
    return { ok: false, error: "The signature could not be verified" };
  }
};
