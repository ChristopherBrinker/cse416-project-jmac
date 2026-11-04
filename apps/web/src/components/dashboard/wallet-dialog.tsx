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
import { Input } from "@cse416-project-jmac/ui/components/input";
import { Label } from "@cse416-project-jmac/ui/components/label";
import { Separator } from "@cse416-project-jmac/ui/components/separator";
import { KeyRoundIcon, WalletIcon } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useConnect, useConnectors, useSwitchChain } from "wagmi";
import type { Connector } from "wagmi";

import { createPrivateKeyWallet, evaluationChain } from "@/lib/blockchain";
import { truncateHash } from "@/lib/evaluations";

import type { BlockchainWalletState } from "./use-blockchain-wallet";
import { useDashboardAction } from "./use-dashboard-action";

const PRIVATE_KEY_PATTERN = /^0x[\da-fA-F]{64}$/u;
const SOURCE_LABELS = {
  browser: "Browser wallet",
  privateKey: "Private key",
} as const;

function BrowserWalletOptions({
  walletState,
  onConnected,
}: {
  walletState: BlockchainWalletState;
  onConnected: () => void;
}) {
  // Typed as a list because EIP-6963 discovery adds wallets at runtime
  const connectors: readonly Connector[] = useConnectors();
  const { mutateAsync: connect } = useConnect();
  const { mutateAsync: switchChain } = useSwitchChain();
  const { pending, error, run } = useDashboardAction();

  if (walletState.browserWrongChain) {
    return (
      <div className="grid gap-2">
        <p className="text-muted-foreground text-xs">
          {walletState.browserAddress
            ? `${truncateHash(walletState.browserAddress)} is connected to another network.`
            : "Your browser wallet is connected to another network."}{" "}
          Switch to {evaluationChain.name} (chain {evaluationChain.id}) to fund
          and refund evaluations.
        </p>
        <Button
          disabled={pending}
          onClick={async () => {
            const switched = await run(async () => {
              await switchChain({ chainId: evaluationChain.id });
            }, `Switched to ${evaluationChain.name}`);
            if (switched) {
              onConnected();
            }
          }}
        >
          {pending ? "Switching…" : `Switch to ${evaluationChain.name}`}
        </Button>
        {error ? (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {connectors.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No browser wallet was detected. Install MetaMask or another browser
          wallet, or connect with a private key below.
        </p>
      ) : (
        connectors.map((connector) => (
          <Button
            key={connector.uid}
            variant="outline"
            disabled={pending}
            onClick={async () => {
              const connected = await run(async () => {
                walletState.clearPrivateKey();
                await connect({ connector, chainId: evaluationChain.id });
              }, `${connector.name} connected`);
              if (connected) {
                onConnected();
              }
            }}
          >
            <WalletIcon data-icon="inline-start" />
            {pending ? "Waiting for wallet…" : `Connect ${connector.name}`}
          </Button>
        ))
      )}
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PrivateKeyForm({
  walletState,
  onConnected,
}: {
  walletState: BlockchainWalletState;
  onConnected: () => void;
}) {
  const fieldId = useId();
  const [privateKey, setPrivateKey] = useState("");
  const { pending, error, run } = useDashboardAction();
  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const connected = await run(async () => {
      if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
        throw new Error(
          "Enter a private key with 0x followed by 64 hexadecimal characters."
        );
      }
      const wallet = await createPrivateKeyWallet(privateKey as `0x${string}`);
      walletState.connectPrivateKey(wallet);
    }, "Wallet connected");
    setPrivateKey("");
    if (connected) {
      onConnected();
    }
  };

  return (
    <form onSubmit={connect} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={fieldId}>Private key</Label>
        <Input
          id={fieldId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={privateKey}
          onChange={(event) => setPrivateKey(event.target.value)}
          placeholder="0x…"
          required
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          The key stays in this page&apos;s memory and is cleared when you
          disconnect or reload.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="outline" disabled={pending}>
        <KeyRoundIcon data-icon="inline-start" />
        {pending ? "Connecting…" : "Connect with private key"}
      </Button>
    </form>
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
  const { wallet } = walletState;
  const close = () => setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="outline" className="rounded-full" />}
      >
        <WalletIcon data-icon="inline-start" />
        {wallet ? truncateHash(wallet.address) : "Connect wallet"}
      </DialogTrigger>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {wallet ? "Funding wallet" : "Connect a funding wallet"}
          </DialogTitle>
          <DialogDescription>
            Fund and refund evaluations on the configured {evaluationChain.name}{" "}
            network with a browser wallet such as MetaMask, or with a
            development wallet private key.
          </DialogDescription>
        </DialogHeader>
        {wallet ? (
          <div className="grid gap-4">
            <div className="grid gap-1">
              <p className="text-muted-foreground text-xs">
                {SOURCE_LABELS[wallet.source]}
              </p>
              <p className="font-mono text-xs break-all">{wallet.address}</p>
            </div>
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
          </div>
        ) : (
          <div className="grid gap-4">
            <BrowserWalletOptions
              walletState={walletState}
              onConnected={close}
            />
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-muted-foreground text-xs">or</span>
              <Separator className="flex-1" />
            </div>
            <PrivateKeyForm walletState={walletState} onConnected={close} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
