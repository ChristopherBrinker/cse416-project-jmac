"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  useConnection,
  useDisconnect,
  useSwitchChain,
  useWalletClient,
} from "wagmi";

import {
  createBrowserWallet,
  describeWalletError,
  evaluationChain,
} from "@/lib/blockchain";
import { truncateHash } from "@/lib/evaluations";

/**
 * The connected browser wallet (MetaMask or another injected EIP-1193
 * provider) via wagmi. The app never sees a private key: every transaction and
 * signature is approved in the wallet. `wallet` is only defined when the
 * wallet is connected to the supported network.
 */
export function useBlockchainWallet() {
  const connection = useConnection();
  const { mutate: disconnectWallet } = useDisconnect();
  const { mutateAsync: switchChain, isPending: switching } = useSwitchChain();
  const onEvaluationChain = connection.chainId === evaluationChain.id;
  const { data: walletClient } = useWalletClient({
    chainId: evaluationChain.id,
    query: { enabled: connection.isConnected && onEvaluationChain },
  });
  const wallet =
    connection.isConnected && onEvaluationChain && walletClient
      ? createBrowserWallet(walletClient)
      : undefined;

  // Tell the user when the wallet switches accounts or disconnects underneath
  // the page, since pending refund/funding checks depend on the address.
  const previousAddress = useRef(connection.address);
  useEffect(() => {
    const previous = previousAddress.current;
    previousAddress.current = connection.address;
    if (!previous || previous === connection.address) {
      return;
    }
    if (connection.address) {
      toast.info(
        `Wallet account changed to ${truncateHash(connection.address)}.`
      );
    } else {
      toast.info("Wallet disconnected.");
    }
  }, [connection.address]);

  const switchToEvaluationChain = async (): Promise<boolean> => {
    try {
      await switchChain({ chainId: evaluationChain.id });
      return true;
    } catch (error) {
      toast.error(describeWalletError(error));
      return false;
    }
  };

  return {
    wallet,
    connected: connection.isConnected,
    connecting: connection.isConnecting || connection.isReconnecting,
    address: connection.address,
    chainId: connection.chainId,
    wrongNetwork: connection.isConnected && !onEvaluationChain,
    switching,
    switchToEvaluationChain,
    disconnect: () => disconnectWallet(),
  };
}

export type BlockchainWalletState = ReturnType<typeof useBlockchainWallet>;
