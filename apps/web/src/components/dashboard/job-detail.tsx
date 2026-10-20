"use client";

import { Button } from "@cse416-project-jmac/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cse416-project-jmac/ui/components/card";
import { CircleCheckIcon, WalletIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { EvaluationJob } from "@/lib/evaluations";
import { formatDateTime, formatWei } from "@/lib/evaluations";

import { CopyButton } from "./copy-button";
import { JobStatusBadge } from "./status-badge";

export interface FundingTransaction {
  hash: `0x${string}`;
  confirmed: boolean;
}

function SummaryItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-card min-w-0 space-y-0.5 p-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

interface JobDetailProps {
  job: EvaluationJob;
  walletConnected: boolean;
  funding: boolean;
  fundingBusy: boolean;
  transaction: FundingTransaction | undefined;
  error: string | undefined;
  onFund: () => Promise<void>;
}

function FundingPanel({
  job,
  walletConnected,
  funding,
  fundingBusy,
  transaction,
  onFund,
}: Omit<JobDetailProps, "error">) {
  return (
    <div className="bg-muted/50 space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">
        {transaction?.confirmed ? "Funding confirmed" : "Fund this evaluation"}
      </p>
      <p className="text-muted-foreground text-xs">
        {transaction?.confirmed
          ? "The transaction is confirmed on-chain. Waiting for the scheduler to update this job in Convex."
          : "Send the job's funding price to the evaluation contract. Network gas is additional. Providers are assigned after funding."}
      </p>
      <Button
        className="w-full"
        disabled={!walletConnected || fundingBusy || transaction?.confirmed}
        onClick={onFund}
      >
        <WalletIcon data-icon="inline-start" />
        {funding
          ? "Confirming funding…"
          : transaction?.confirmed
            ? "Waiting for job update…"
            : transaction
              ? "Check funding transaction"
              : `Fund job · ${formatWei(job.price)}`}
      </Button>
      {!walletConnected && !transaction?.confirmed ? (
        <p className="text-muted-foreground text-xs">
          Connect a wallet above to fund this job.
        </p>
      ) : null}
    </div>
  );
}

export function JobDetail({
  job,
  transaction,
  error,
  ...fundingProps
}: JobDetailProps) {
  return (
    <Card className="min-w-0 gap-4 rounded-xl">
      <CardHeader className="gap-2 border-b">
        <div className="flex flex-wrap items-center gap-2">
          <JobStatusBadge status={job.status} />
          <span className="text-muted-foreground flex min-w-0 items-center font-mono">
            <span className="min-w-0 break-all">{job._id}</span>
            <CopyButton value={job._id} label="Job ID" />
          </span>
        </div>
        <CardTitle className="text-base">
          {job.model?.name ?? "Model evaluation"}
        </CardTitle>
        <CardDescription>
          {job.benchmark
            ? `${job.benchmark.name} v${job.benchmark.version} by ${job.benchmark.ownerName}`
            : `Benchmark ${job.benchmarkId}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="bg-border grid grid-cols-2 gap-px overflow-hidden rounded-lg border">
          <SummaryItem label="Score">
            <span className="text-lg font-semibold tabular-nums">
              {job.score ?? "—"}
            </span>
          </SummaryItem>
          <SummaryItem label="Funding price">
            <span className="text-lg font-semibold tabular-nums">
              {formatWei(job.price)}
            </span>
          </SummaryItem>
          <SummaryItem label="Created">
            {formatDateTime(job._creationTime)}
          </SummaryItem>
          <SummaryItem label="Status updated">
            {formatDateTime(job.statusTime)}
          </SummaryItem>
        </dl>
        {job.status === "created" ? (
          <FundingPanel job={job} transaction={transaction} {...fundingProps} />
        ) : null}
        {transaction ? (
          <div className="space-y-2 rounded-lg border p-3 text-xs">
            <p className="flex items-center gap-2 font-medium">
              {transaction.confirmed ? (
                <CircleCheckIcon className="size-4 text-emerald-500" />
              ) : null}
              {transaction.confirmed
                ? "Funding transaction confirmed"
                : "Funding transaction submitted"}
            </p>
            <p className="flex items-center gap-1">
              <span className="min-w-0 font-mono break-all">
                {transaction.hash}
              </span>
              <CopyButton
                value={transaction.hash}
                label="Funding transaction hash"
              />
            </p>
          </div>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="text-destructive rounded-lg border p-3 text-xs"
          >
            {error}
          </p>
        ) : null}
        <dl className="space-y-3 border-t pt-4 text-xs">
          <div>
            <dt className="text-muted-foreground">Benchmark ID</dt>
            <dd className="mt-1 flex items-center gap-1">
              <span className="min-w-0 font-mono break-all">
                {job.benchmarkId}
              </span>
              <CopyButton value={job.benchmarkId} label="Benchmark ID" />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="mt-1 break-all">{job.model?.name ?? job.modelId}</dd>
          </div>
          {job.benchmark ? (
            <>
              <div>
                <dt className="text-muted-foreground">Description</dt>
                <dd className="mt-1">{job.benchmark.description}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Benchmark SHA-256</dt>
                <dd className="mt-1 flex items-center gap-1">
                  <span className="min-w-0 font-mono break-all">
                    {job.benchmark.contentHash}
                  </span>
                  <CopyButton
                    value={job.benchmark.contentHash}
                    label="Benchmark content hash"
                  />
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        {job.status === "funded" ? (
          <p className="text-muted-foreground text-xs">
            Funding received. This view updates automatically as the scheduler
            reports evaluation status.
          </p>
        ) : null}
        {job.status === "failed" ? (
          <p className="text-destructive text-xs">
            This evaluation failed. No failure details were returned for this
            job.
          </p>
        ) : null}
        {job.status === "succeeded" && job.score === undefined ? (
          <p className="text-muted-foreground text-xs">
            Evaluation completed. No score has been reported yet.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
