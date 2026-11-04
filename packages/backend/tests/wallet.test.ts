import { describe, expect, test } from "bun:test";

import { privateKeyToAccount } from "viem/accounts";

import {
  buildChallengeMessage,
  checkChallengeUsable,
  createNonce,
  normalizeWalletAddress,
  verifyChallengeSignature,
  WALLET_CHALLENGE_TTL_MS,
} from "../convex/lib/wallet";
import type { WalletChallenge } from "../convex/lib/wallet";

// Well-known Anvil development keys; they only hold disposable test funds.
const owner = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);
const other = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
);
const ISSUED_AT = Date.UTC(2026, 10, 4, 12);
const USER_ID = "user-1";

const makeChallenge = (
  overrides: Partial<WalletChallenge> = {}
): WalletChallenge => {
  const nonce = "00112233445566778899aabbccddeeff";
  const expiresAt = ISSUED_AT + WALLET_CHALLENGE_TTL_MS;
  return {
    userId: USER_ID,
    walletAddress: owner.address,
    nonce,
    message: buildChallengeMessage({
      userId: USER_ID,
      walletAddress: owner.address,
      nonce,
      issuedAt: ISSUED_AT,
      expiresAt,
    }),
    expiresAt,
    used: false,
    ...overrides,
  };
};

describe("buildChallengeMessage", () => {
  test("binds account, wallet, chain, nonce, and expiry", () => {
    const { message } = makeChallenge();
    expect(message).toContain(`Account: ${USER_ID}`);
    expect(message).toContain(`Wallet: ${owner.address}`);
    expect(message).toContain("Chain ID: 31337");
    expect(message).toContain("Nonce: 00112233445566778899aabbccddeeff");
    expect(message).toContain("Expiration Time: 2026-11-04T12:05:00.000Z");
  });
});

describe("createNonce", () => {
  test("produces distinct 128-bit hex nonces", () => {
    const first = createNonce();
    expect(first).toMatch(/^[\da-f]{32}$/u);
    expect(createNonce()).not.toBe(first);
  });
});

describe("normalizeWalletAddress", () => {
  test("checksums valid addresses and rejects invalid ones", () => {
    expect(normalizeWalletAddress(owner.address.toLowerCase())).toBe(
      owner.address
    );
    expect(normalizeWalletAddress("0x1234")).toBeNull();
  });
});

describe("checkChallengeUsable", () => {
  test("accepts a fresh challenge for its owner", () => {
    expect(checkChallengeUsable(makeChallenge(), USER_ID, ISSUED_AT)).toEqual({
      ok: true,
    });
  });

  test("rejects another account's challenge", () => {
    expect(checkChallengeUsable(makeChallenge(), "user-2", ISSUED_AT).ok).toBe(
      false
    );
  });

  test("rejects reuse", () => {
    const result = checkChallengeUsable(
      makeChallenge({ used: true }),
      USER_ID,
      ISSUED_AT
    );
    expect(result).toEqual({
      ok: false,
      error: "This wallet challenge was already used. Request a new one.",
    });
  });

  test("rejects an expired challenge", () => {
    const result = checkChallengeUsable(
      makeChallenge(),
      USER_ID,
      ISSUED_AT + WALLET_CHALLENGE_TTL_MS + 1
    );
    expect(result.ok).toBe(false);
  });
});

describe("verifyChallengeSignature", () => {
  test("accepts the challenged wallet's signature", async () => {
    const challenge = makeChallenge();
    const signature = await owner.signMessage({ message: challenge.message });
    expect(await verifyChallengeSignature(challenge, signature)).toEqual({
      ok: true,
    });
  });

  test("rejects a signature from a different wallet", async () => {
    const challenge = makeChallenge();
    const signature = await other.signMessage({ message: challenge.message });
    const result = await verifyChallengeSignature(challenge, signature);
    expect(result.ok).toBe(false);
  });

  test("rejects a signature over a different nonce", async () => {
    const challenge = makeChallenge();
    const replayed = makeChallenge({ nonce: "ff" });
    const signature = await owner.signMessage({
      message: buildChallengeMessage({
        userId: USER_ID,
        walletAddress: owner.address,
        nonce: "ffffffffffffffffffffffffffffffff",
        issuedAt: ISSUED_AT,
        expiresAt: replayed.expiresAt,
      }),
    });
    const result = await verifyChallengeSignature(challenge, signature);
    expect(result.ok).toBe(false);
  });

  test("rejects malformed signatures", async () => {
    expect(await verifyChallengeSignature(makeChallenge(), "0xdead")).toEqual({
      ok: false,
      error: "Invalid signature format",
    });
  });
});
