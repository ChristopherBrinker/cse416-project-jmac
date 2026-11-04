"use client";

import { useState } from "react";
import { useConnection, useDisconnect, useWalletClient } from "wagmi";

import { createBrowserWallet, evaluationChain } from "@/lib/blockchain";
import type { BlockchainWallet } from "@/lib/blockchain";

/**
 * Combines the two ways to sign transactions: a pasted development private key
 * and a browser wallet (MetaMask or another injected provider) via wagmi.
 * Connecting one method disconnects the other so only one wallet is active.
 */
export function useBlockchainWallet() {
  const [privateKeyWallet, setPrivateKeyWallet] = useState<BlockchainWallet>();
  const connection = useConnection();
  const { mutate: disconnectBrowser } = useDisconnect();
  const onEvaluationChain = connection.chainId === evaluationChain.id;
  const { data: browserWalletClient } = useWalletClient({
    chainId: evaluationChain.id,
    query: { enabled: connection.isConnected && onEvaluationChain },
  });
  const browserWallet =
    connection.isConnected && onEvaluationChain && browserWalletClient
      ? createBrowserWallet(browserWalletClient)
      : undefined;

  const connectPrivateKey = (wallet: BlockchainWallet) => {
    if (connection.isConnected) {
      disconnectBrowser();
    }
    setPrivateKeyWallet(wallet);
  };
  const disconnect = () => {
    setPrivateKeyWallet(undefined);
    if (connection.isConnected) {
      disconnectBrowser();
    }
  };

  return {
    wallet: privateKeyWallet ?? browserWallet,
    browserConnected: connection.isConnected,
    browserAddress: connection.address,
    browserWrongChain: connection.isConnected && !onEvaluationChain,
    clearPrivateKey: () => setPrivateKeyWallet(undefined),
    connectPrivateKey,
    disconnect,
  };
}

export type BlockchainWalletState = ReturnType<typeof useBlockchainWallet>;
