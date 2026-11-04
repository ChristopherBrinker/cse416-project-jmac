"use client";

import { api } from "@cse416-project-jmac/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { useState } from "react";

import { describeWalletError } from "@/lib/blockchain";
import type { BlockchainWallet } from "@/lib/blockchain";

export type RegistrationStep = "idle" | "challenge" | "signing" | "verifying";

type CreateChallenge = ReturnType<
  typeof useMutation<typeof api.provider.createWalletChallenge>
>;
type RegisterProvider = ReturnType<
  typeof useMutation<typeof api.provider.register>
>;

const registerWithSignedChallenge = async (
  wallet: BlockchainWallet,
  createChallenge: CreateChallenge,
  registerProvider: RegisterProvider,
  onStep: (step: RegistrationStep) => void
) => {
  onStep("challenge");
  const challenge = await createChallenge({ walletAddress: wallet.address });
  if (!challenge.success) {
    throw new Error(challenge.error);
  }
  onStep("signing");
  const signature = await wallet.walletClient.signMessage({
    account: wallet.walletClient.account,
    message: challenge.message,
  });
  onStep("verifying");
  const result = await registerProvider({
    challengeId: challenge.challengeId,
    signature,
  });
  if (!result.success) {
    throw new Error(result.error);
  }
};

/**
 * Registers a provider for the connected wallet by proving ownership: the
 * backend issues a single-use, expiring challenge, the wallet signs it, and
 * the backend verifies the signature before storing the address.
 */
export function useProviderRegistration(wallet: BlockchainWallet | undefined) {
  const createChallenge = useMutation(api.provider.createWalletChallenge);
  const registerProvider = useMutation(api.provider.register);
  const [step, setStep] = useState<RegistrationStep>("idle");
  const [error, setError] = useState<string | null>(null);

  const register = async (): Promise<boolean> => {
    if (!wallet || step !== "idle") {
      return false;
    }
    setError(null);
    let succeeded = false;
    try {
      await registerWithSignedChallenge(
        wallet,
        createChallenge,
        registerProvider,
        setStep
      );
      succeeded = true;
    } catch (registrationError) {
      setError(describeWalletError(registrationError));
    }
    setStep("idle");
    return succeeded;
  };

  return { step, error, register };
}
