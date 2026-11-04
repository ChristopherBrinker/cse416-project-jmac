"use client";

import { Button } from "@cse416-project-jmac/ui/components/button";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  RefreshCwIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { BlockchainClient } from "@/lib/blockchain";
import { contractAddress, createBlockchainReader } from "@/lib/blockchain";
import type { EvaluationJob } from "@/lib/evaluations";
import { formatWei, getErrorMessage } from "@/lib/evaluations";
import { readSettlementReceipt } from "@/lib/settlement";
import type { SettlementReceipt as Receipt } from "@/lib/settlement";

import { CopyButton } from "./copy-button";
import { useDashboardAction } from "./use-dashboard-action";

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CircleCheckIcon className="mt-px size-4 shrink-0 text-emerald-500" />
      ) : (
        <CircleAlertIcon className="text-destructive mt-px size-4 shrink-0" />
      )}
      <span>{children}</span>
    </li>
  );
}

function Hash({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex items-center gap-1">
        <span className="min-w-0 font-mono break-all">{value}</span>
        <CopyButton value={value} label={label} />
      </dd>
    </div>
  );
}

function ProviderRow({
  label,
  provider,
}: {
  label: string;
  provider: NonNullable<Receipt["providers"]>[number];
}) {
  const state = [
    provider.revealed ? "revealed" : "not revealed",
    provider.claimed ? "paid" : "unpaid",
  ].join(" · ");
  return (
    <div className="space-y-1 rounded-md border p-2">
      <p className="font-medium">
        {label} <span className="text-muted-foreground">({state})</span>
      </p>
      <dl className="space-y-1">
        <Hash label={`${label} wallet`} value={provider.address} />
        <Hash label={`${label} provider ID`} value={provider.providerId} />
        <Hash label={`${label} commitment`} value={provider.commit} />
      </dl>
    </div>
  );
}

function ReceiptChecks({
  receipt,
  score,
}: {
  receipt: Receipt;
  score: number | undefined;
}) {
  const specMatches =
    receipt.expectedSpecHash !== undefined &&
    receipt.expectedSpecHash === receipt.specHash;
  const scoreMatches = score === receipt.accepted?.score;
  return (
    <ul className="space-y-1">
      <Check ok={specMatches}>
        Spec hash recomputed from the benchmark SHA-256 and model ID{" "}
        {specMatches ? "matches the contract" : "does not match the contract"}
      </Check>
      {receipt.accepted ? (
        <>
          <Check ok={receipt.completionTxVerified}>
            {receipt.completionTxVerified
              ? "Completion transaction emitted this job's JobComplete event"
              : "No verified JobComplete transaction recorded yet"}
          </Check>
          <Check ok={scoreMatches}>
            Dashboard score {scoreMatches ? "matches" : "differs from"} the
            on-chain count
          </Check>
        </>
      ) : null}
    </ul>
  );
}

function AcceptedResult({ receipt }: { receipt: Receipt }) {
  if (!receipt.accepted) {
    return null;
  }
  return (
    <p>
      Accepted score{" "}
      <span className="font-semibold tabular-nums">
        {receipt.accepted.correctCount.toString()} /{" "}
        {receipt.itemCount.toString()}
      </span>{" "}
      ({receipt.accepted.score.toFixed(2)}%). Both assigned providers revealed
      the same digest of their ordered predictions and the same count. This
      shows agreement between two providers; it does not prove either ran the
      model honestly.
    </p>
  );
}

function ReceiptHashes({
  job,
  receipt,
}: {
  job: EvaluationJob;
  receipt: Receipt;
}) {
  return (
    <dl className="space-y-2">
      <Hash label="Contract" value={receipt.contract} />
      <div>
        <dt className="text-muted-foreground">Chain ID · price</dt>
        <dd className="mt-1">
          {receipt.chainId} · {formatWei(receipt.price)}
        </dd>
      </div>
      <Hash label="Spec hash" value={receipt.specHash} />
      {receipt.accepted ? (
        <Hash
          label="Accepted output digest"
          value={receipt.accepted.outputDigest}
        />
      ) : null}
      {receipt.completionTx ? (
        <Hash label="Completion transaction" value={receipt.completionTx} />
      ) : null}
      {job.jobFunded_tx ? (
        <Hash label="Funding transaction" value={job.jobFunded_tx} />
      ) : null}
      {job.jobFailed_tx ? (
        <Hash label="Failure transaction" value={job.jobFailed_tx} />
      ) : null}
    </dl>
  );
}

function RefundPanel({
  job,
  receipt,
  client,
  onRefunded,
}: {
  job: EvaluationJob;
  receipt: Receipt;
  client: BlockchainClient | undefined;
  onRefunded: () => Promise<void>;
}) {
  const refund = useDashboardAction();
  const isCreator =
    client?.account.address.toLowerCase() === receipt.creator.toLowerCase();

  const requestRefund = () =>
    refund.run(async () => {
      if (!client) {
        throw new Error("Connect the creator wallet to request a refund.");
      }
      const { request } = await client.publicClient.simulateContract({
        account: client.account,
        address: contractAddress,
        abi: client.abi,
        functionName: "refund",
        args: [String(job._id)],
      });
      const hash = await client.walletClient.writeContract(request);
      const mined = await client.publicClient.waitForTransactionReceipt({
        hash,
      });
      if (mined.status !== "success") {
        throw new Error("The refund transaction reverted.");
      }
      await onRefunded();
    }, "Refund confirmed on-chain.");

  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        variant="outline"
        disabled={!isCreator || refund.pending}
        onClick={requestRefund}
      >
        <Undo2Icon data-icon="inline-start" />
        {refund.pending
          ? "Confirming refund…"
          : `Refund ${formatWei(receipt.price)}`}
      </Button>
      {isCreator ? null : (
        <p className="text-muted-foreground">
          Connect the wallet that funded this job to request its refund.
        </p>
      )}
    </div>
  );
}

const fetchReceipt = async (
  jobId: string,
  modelId: string,
  contentHash: string | undefined,
  completionTx: string | undefined
): Promise<Receipt> => {
  const { publicClient, abi } = await createBlockchainReader();
  return readSettlementReceipt(
    publicClient,
    abi,
    jobId,
    contentHash ? { contentHash, modelId } : undefined,
    completionTx
  );
};

interface SettlementReceiptProps {
  job: EvaluationJob;
  client: BlockchainClient | undefined;
}

// Reads settlement straight from the contract, so the receipt does not rest on Convex records.
// What the receipt proves is stated in docs/m4/protocol.md; keep the wording here in sync.
export function SettlementReceipt({ job, client }: SettlementReceiptProps) {
  const [receipt, setReceipt] = useState<Receipt>();
  const [loadError, setLoadError] = useState<string>();
  const { _id: jobId, modelId, jobComplete_tx: completionTx } = job;
  const contentHash = job.benchmark?.contentHash;

  const reload = async () => {
    try {
      setReceipt(await fetchReceipt(jobId, modelId, contentHash, completionTx));
      setLoadError(undefined);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await fetchReceipt(
          jobId,
          modelId,
          contentHash,
          completionTx
        );
        if (active) {
          setReceipt(next);
          setLoadError(undefined);
        }
      } catch (error) {
        if (active) {
          setLoadError(getErrorMessage(error));
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [jobId, modelId, contentHash, completionTx]);

  if (loadError) {
    return (
      <p className="text-muted-foreground rounded-lg border p-3 text-xs">
        On-chain receipt unavailable: {loadError}
      </p>
    );
  }
  if (!receipt?.exists) {
    return null;
  }

  return (
    <section
      aria-labelledby={`receipt-${job._id}`}
      className="space-y-3 rounded-lg border p-3 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`receipt-${job._id}`} className="text-sm font-medium">
          On-chain settlement · {receipt.status}
        </h3>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Reload on-chain receipt"
          onClick={reload}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      <AcceptedResult receipt={receipt} />
      <ReceiptChecks receipt={receipt} score={job.score} />
      <ReceiptHashes job={job} receipt={receipt} />
      {receipt.providers ? (
        <div className="grid gap-2">
          <ProviderRow label="Provider A" provider={receipt.providers[0]} />
          <ProviderRow label="Provider B" provider={receipt.providers[1]} />
        </div>
      ) : null}
      {receipt.refundable ? (
        <RefundPanel
          job={job}
          receipt={receipt}
          client={client}
          onRefunded={reload}
        />
      ) : null}
    </section>
  );
}
