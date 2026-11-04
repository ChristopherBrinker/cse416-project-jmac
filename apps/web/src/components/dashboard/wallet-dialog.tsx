"use client";

import { Button } from "@cse416-project-jmac/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@cse416-project-jmac/ui/components/dialog";
import { TriangleAlertIcon, WalletIcon } from "lucide-react";
import { useState } from "react";
import { useConnect, useConnectors } from "wagmi";
import type { Connector } from "wagmi";

import { describeWalletError, evaluationChain } from "@/lib/blockchain";
import { truncateHash } from "@/lib/evaluations";

import type { BlockchainWalletState } from "./use-blockchain-wallet";

const GENERIC_INJECTED_ID = "injected";

function ConnectorList({ onConnected }: { onConnected: () => void }) {
  // Typed as a list because EIP-6963 discovery adds wallets at runtime
  const allConnectors: readonly Connector[] = useConnectors();
  // Prefer named wallets (MetaMask, …) over the generic window.ethereum entry
  const discovered = allConnectors.filter(
    (connector) => connector.id !== GENERIC_INJECTED_ID
  );
  const connectors = discovered.length > 0 ? discovered : allConnectors;
  const { mutateAsync: connect } = useConnect();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectWith = async (connector: Connector) => {
    setPendingId(connector.uid);
    setError(null);
    try {
      await connect({ connector, chainId: evaluationChain.id });
      onConnected();
    } catch (connectError) {
      setError(describeWalletError(connectError));
    }
    setPendingId(null);
  };

  if (connectors.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No browser wallet was detected. Install MetaMask (or another EIP-1193
        wallet), import a disposable Anvil test account into it, then reload
        this page.
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      {connectors.map((connector) => (
        <Button
          key={connector.uid}
          variant="outline"
          disabled={pendingId !== null}
          onClick={() => connectWith(connector)}
        >
          <WalletIcon data-icon="inline-start" />
          {pendingId === connector.uid
            ? "Approve the connection in your wallet…"
            : `Connect ${connector.name}`}
        </Button>
      ))}
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function WrongNetworkNotice({
  walletState,
}: {
  walletState: BlockchainWalletState;
}) {
  const handleSwitch = async () => {
    await walletState.switchToEvaluationChain();
  };
  return (
    <div className="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
      <p className="flex items-center gap-2 text-xs font-medium">
        <TriangleAlertIcon className="size-4" aria-hidden="true" />
        Wrong network
      </p>
      <p className="text-muted-foreground text-xs">
        Your wallet is on chain {walletState.chainId ?? "unknown"}. JMAC only
        supports {evaluationChain.name} (chain {evaluationChain.id}).
      </p>
      <Button size="sm" disabled={walletState.switching} onClick={handleSwitch}>
        {walletState.switching
          ? "Approve the switch in your wallet…"
          : `Switch to ${evaluationChain.name}`}
      </Button>
    </div>
  );
}

export function WalletDialog({
  walletState,
  busy,
}: {
  walletState: BlockchainWalletState;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { address, connected, wrongNetwork } = walletState;
  const close = () => setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={wrongNetwork ? "destructive" : "outline"}
            className="rounded-full"
          />
        }
      >
        <WalletIcon data-icon="inline-start" />
        {address ? truncateHash(address) : "Connect wallet"}
        {wrongNetwork ? " · wrong network" : null}
      </DialogTrigger>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {connected ? "Connected wallet" : "Connect a browser wallet"}
          </DialogTitle>
          <DialogDescription>
            Your wallet signs every funding, refund, and provider verification
            request. JMAC never asks for or stores a private key. Use only
            disposable test funds on {evaluationChain.name}.
          </DialogDescription>
        </DialogHeader>
        {connected && address ? (
          <div className="grid gap-4">
            <p className="font-mono text-xs break-all">{address}</p>
            {wrongNetwork ? (
              <WrongNetworkNotice walletState={walletState} />
            ) : null}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                walletState.disconnect();
                close();
              }}
            >
              Disconnect wallet
            </Button>
            {busy ? (
              <p className="text-muted-foreground text-xs">
                Wait for the pending transaction before disconnecting.
              </p>
            ) : null}
          </div>
        ) : (
          <ConnectorList onConnected={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
