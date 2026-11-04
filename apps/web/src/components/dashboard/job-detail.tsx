"use client";

import { Button } from "@cse416-project-jmac/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cse416-project-jmac/ui/components/card";
import { TriangleAlertIcon, WalletIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { EvaluationJob } from "@/lib/evaluations";
import { formatDateTime, formatScore, formatWei } from "@/lib/evaluations";

import { CopyButton } from "./copy-button";
import { JobStatusBadge } from "./status-badge";

export interface JobTransaction {
  hash: `0x${string}`;
  confirmed: boolean;
}
export type FundingTransaction = JobTransaction;

export type FundingStatus = "checking" | "unfunded" | "funded" | "error";

const FAILURE_EXPLANATIONS: Record<string, string> = {
  "Timed out":
    "At least one assigned provider did not commit or reveal its result before the deadline.",
  "Providers disagreed on results":
    "Both providers revealed results, but they did not match, so no score could be verified.",
  "Provider assignment failed":
    "Providers could not be assigned to this job after it was funded.",
};

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

interface FundingPanelProps {
  job: EvaluationJob;
  walletConnected: boolean;
  funding: boolean;
  fundingBusy: boolean;
  fundingStatus: FundingStatus;
  transaction: FundingTransaction | undefined;
  onFund: () => Promise<void>;
}

interface JobDetailProps extends FundingPanelProps {
  error: string | undefined;
}

function FundingPanel({
  job,
  walletConnected,
  funding,
  fundingBusy,
  fundingStatus,
  transaction,
  onFund,
}: FundingPanelProps) {
  const fundedOnChain = transaction?.confirmed || fundingStatus === "funded";
  const checkingFunding = fundingStatus === "checking";
  const needsFundingCheck = fundingStatus === "error";
  return (
    <div className="bg-muted/50 space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">
        {fundedOnChain ? "Funding confirmed" : "Fund this evaluation"}
      </p>
      <p className="text-muted-foreground text-xs">
        {fundedOnChain
          ? "The transaction is confirmed on-chain. Waiting for the scheduler to update this job in Convex."
          : "Send the job's funding price to the evaluation contract. Network gas is additional. Providers are assigned after funding."}
      </p>
      <Button
        className="w-full"
        disabled={
          (!walletConnected && !needsFundingCheck) ||
          fundingBusy ||
          fundedOnChain ||
          checkingFunding
        }
        onClick={onFund}
      >
        <WalletIcon data-icon="inline-start" />
        {checkingFunding
          ? "Checking on-chain funding…"
          : funding
            ? "Confirming funding…"
            : fundedOnChain
              ? "Waiting for job update…"
              : needsFundingCheck
                ? "Check funding status"
                : transaction
                  ? "Check funding transaction"
                  : `Fund job · ${formatWei(job.price)}`}
      </Button>
      {!walletConnected && !fundedOnChain ? (
        <p className="text-muted-foreground text-xs">
          Connect a wallet above to fund this job.
        </p>
      ) : null}
    </div>
  );
}

function FailurePanel({
  failureReason,
}: {
  failureReason: string | undefined;
}) {
  const explanation = failureReason
    ? FAILURE_EXPLANATIONS[failureReason]
    : undefined;
  return (
    <div className="border-destructive/30 bg-destructive/5 space-y-1 rounded-lg border p-3">
      <p className="text-destructive flex items-center gap-2 text-sm font-medium">
        <TriangleAlertIcon className="size-4" aria-hidden="true" />
        {failureReason ?? "Evaluation failed"}
      </p>
      <p className="text-muted-foreground text-xs">
        {explanation ??
          (failureReason
            ? "The scheduler reported this reason for the failure."
            : "No failure reason was reported for this job.")}
      </p>
    </div>
  );
}

interface TransactionRow {
  label: string;
  hash: string;
  pending?: boolean;
}

const getTransactionRows = (
  job: EvaluationJob,
  fundingTransaction: JobTransaction | undefined
): TransactionRow[] => {
  const rows: TransactionRow[] = [];
  const fundingHash = job.jobFunded_tx ?? fundingTransaction?.hash;
  if (fundingHash) {
    rows.push({
      label: "Funded",
      hash: fundingHash,
      pending: !job.jobFunded_tx && !fundingTransaction?.confirmed,
    });
  }
  if (job.jobComplete_tx) {
    rows.push({ label: "Completed", hash: job.jobComplete_tx });
  }
  if (job.jobFailed_tx) {
    rows.push({ label: "Failed", hash: job.jobFailed_tx });
  }
  return rows;
};

function TransactionsList({ rows }: { rows: TransactionRow[] }) {
  return (
    <div className="space-y-2 rounded-lg border p-3 text-xs">
      <p className="font-medium">Transactions</p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">
          No on-chain transactions have been recorded for this job yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={`${row.label}-${row.hash}`} className="space-y-0.5">
              <p className="text-muted-foreground">
                {row.label}
                {row.pending ? " · awaiting confirmation" : null}
              </p>
              <p className="flex items-center gap-1">
                <span className="min-w-0 font-mono break-all">{row.hash}</span>
                <CopyButton
                  value={row.hash}
                  label={`${row.label} transaction hash`}
                />
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function JobDetail({
  job,
  transaction,
  error,
  ...fundingProps
}: JobDetailProps) {
  const transactionRows = getTransactionRows(job, transaction);
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
              {formatScore(job.score)}
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
        {job.status === "failed" ? (
          <FailurePanel failureReason={job.failureReason} />
        ) : null}
        <TransactionsList rows={transactionRows} />
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
        {job.status === "succeeded" && job.score === undefined ? (
          <p className="text-muted-foreground text-xs">
            Evaluation completed. No score has been reported yet.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
