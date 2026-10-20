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
import { WalletIcon } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent } from "react";

import { createBlockchainClient } from "@/lib/blockchain";
import type { BlockchainClient } from "@/lib/blockchain";
import { truncateHash } from "@/lib/evaluations";

import { useDashboardAction } from "./use-dashboard-action";

const PRIVATE_KEY_PATTERN = /^0x[\da-fA-F]{64}$/u;

export function WalletDialog({
  client,
  onConnect,
  onDisconnect,
  busy,
}: {
  client: BlockchainClient | undefined;
  onConnect: (client: BlockchainClient) => void;
  onDisconnect: () => void;
  busy: boolean;
}) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
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
      const connectedClient = await createBlockchainClient(
        privateKey as `0x${string}`
      );
      onConnect(connectedClient);
    }, "Wallet connected");
    setPrivateKey("");
    if (connected) {
      setOpen(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value);
          setPrivateKey("");
        }
      }}
    >
      <DialogTrigger
        render={<Button variant="outline" className="rounded-full" />}
      >
        <WalletIcon data-icon="inline-start" />
        {client ? truncateHash(client.account.address) : "Connect wallet"}
      </DialogTrigger>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {client ? "Funding wallet" : "Connect a funding wallet"}
          </DialogTitle>
          <DialogDescription>
            Use a development wallet private key to fund evaluations on the
            configured Foundry network. The key stays in this page&apos;s memory
            and is cleared when you disconnect or reload.
          </DialogDescription>
        </DialogHeader>
        {client ? (
          <div className="grid gap-4">
            <p className="font-mono text-xs break-all">
              {client.account.address}
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                onDisconnect();
                setOpen(false);
              }}
            >
              Disconnect wallet
            </Button>
          </div>
        ) : (
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
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Connecting…" : "Connect wallet"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
