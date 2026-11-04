"use client";

import { Button } from "@cse416-project-jmac/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cse416-project-jmac/ui/components/card";
import { TriangleAlertIcon, Undo2Icon, WalletIcon } from "lucide-react";
import type { ReactNode } from "react";

import { isSameAddress } from "@/lib/blockchain";
import type { OnChainJob } from "@/lib/blockchain";
import type { EvaluationJob } from "@/lib/evaluations";
import {
  formatDateTime,
  formatScore,
  formatWei,
  truncateHash,
} from "@/lib/evaluations";
import type { JobLifecycle } from "@/lib/job-lifecycle";

import { CopyButton } from "./copy-button";
import { explainFailure } from "./job-presentation";
import { JobTimeline } from "./job-timeline";
import { ProviderStatusList, ResultReceipt } from "./result-receipt";
import { JobStageBadge } from "./status-badge";
import type { JobTransactions } from "./use-job-actions";

export interface WalletSummary {
  address: string | undefined;
  ready: boolean;
  wrongNetwork: boolean;
}

interface JobDetailProps {
  job: EvaluationJob;
  lifecycle: JobLifecycle;
  chainJob: OnChainJob | undefined;
  chainError: string | undefined;
  wallet: WalletSummary;
  transactions: JobTransactions | undefined;
  busyKind: "funding" | "refund" | undefined;
  actionsBusy: boolean;
  error: string | undefined;
  onFund: () => Promise<void>;
  onRefund: () => Promise<void>;
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

const actionLabel = (busy: boolean, pending: boolean, idle: string) => {
  if (pending) {
    return "Waiting for confirmation…";
  }
  return busy ? "Approve in your wallet…" : idle;
};

const walletHint = (wallet: WalletSummary, action: string): string | null => {
  if (wallet.wrongNetwork) {
    return `Switch your wallet to the supported network to ${action}.`;
  }
  if (!wallet.ready) {
    return `Connect your browser wallet above to ${action}.`;
  }
  return null;
};

function FundingPanel({
  job,
  lifecycle,
  wallet,
  busy,
  actionsBusy,
  onFund,
}: Pick<
  JobDetailProps,
  "job" | "lifecycle" | "wallet" | "actionsBusy" | "onFund"
> & {
  busy: boolean;
}) {
  const pending = lifecycle.stage === "funding_pending";
  const hint = walletHint(wallet, "fund this job");
  return (
    <div className="bg-muted/50 space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">Fund this evaluation</p>
      <p className="text-muted-foreground text-xs">
        Your wallet sends {formatWei(job.price)} to the evaluation contract,
        which holds it in escrow. Network gas is additional. Providers are paid
        only if both return matching results; otherwise you can refund.
      </p>
      <Button
        className="w-full"
        disabled={!wallet.ready || actionsBusy}
        onClick={onFund}
      >
        <WalletIcon data-icon="inline-start" />
        {actionLabel(busy, pending, `Fund job · ${formatWei(job.price)}`)}
      </Button>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

const refundBlocker = (
  chainJob: OnChainJob | undefined,
  wallet: WalletSummary
): string | null => {
  const walletMessage = walletHint(wallet, "request the refund");
  if (walletMessage) {
    return walletMessage;
  }
  if (
    chainJob &&
    wallet.address &&
    !isSameAddress(chainJob.creator, wallet.address)
  ) {
    return `Only the funding wallet ${truncateHash(chainJob.creator)} can refund this job. Switch to that account in your wallet.`;
  }
  return null;
};

function OutcomePanel({
  job,
  lifecycle,
  chainJob,
  wallet,
  busy,
  actionsBusy,
  onRefund,
}: Pick<
  JobDetailProps,
  "job" | "lifecycle" | "chainJob" | "wallet" | "actionsBusy" | "onRefund"
> & { busy: boolean }) {
  const failure = explainFailure(job.failureReason, chainJob);
  const blocker = lifecycle.refundAvailable
    ? refundBlocker(chainJob, wallet)
    : null;
  const pending = lifecycle.stage === "refund_pending";
  return (
    <div className="space-y-3">
      <div className="border-destructive/30 bg-destructive/5 space-y-1 rounded-lg border p-3">
        <p className="text-destructive flex items-center gap-2 text-sm font-medium">
          <TriangleAlertIcon className="size-4" aria-hidden="true" />
          {lifecycle.stage === "expired" ? "Expired: " : null}
          {failure.title}
        </p>
        <p className="text-muted-foreground text-xs">{failure.detail}</p>
      </div>
      {lifecycle.refundAvailable || pending ? (
        <div className="bg-muted/50 space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Refund available</p>
          <p className="text-muted-foreground text-xs">
            Return the {formatWei(chainJob?.price ?? job.price)} escrow to the
            funding wallet. The contract allows exactly one refund per job.
          </p>
          <Button
            className="w-full"
            variant="outline"
            disabled={actionsBusy || blocker !== null}
            onClick={onRefund}
          >
            <Undo2Icon data-icon="inline-start" />
            {actionLabel(busy, pending, "Refund job")}
          </Button>
          {blocker ? (
            <p className="text-muted-foreground text-xs">{blocker}</p>
          ) : null}
        </div>
      ) : null}
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
  transactions: JobTransactions | undefined
): TransactionRow[] => {
  const rows: TransactionRow[] = [];
  const funding = transactions?.funding;
  const fundingHash = job.jobFunded_tx ?? funding?.hash;
  if (fundingHash) {
    rows.push({
      label: "Funded",
      hash: fundingHash,
      pending: !job.jobFunded_tx && !funding?.confirmed,
    });
  }
  if (job.jobComplete_tx) {
    rows.push({ label: "Completed", hash: job.jobComplete_tx });
  }
  if (job.jobFailed_tx) {
    rows.push({ label: "Failed", hash: job.jobFailed_tx });
  }
  if (transactions?.refund) {
    rows.push({
      label: "Refund",
      hash: transactions.refund.hash,
      pending: !transactions.refund.confirmed,
    });
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

const showsProviders = (
  lifecycle: JobLifecycle,
  chainJob: OnChainJob | undefined
): chainJob is OnChainJob =>
  lifecycle.stage !== "accepted" &&
  chainJob?.providers.some((provider) => provider.assigned) === true;

export function JobDetail({
  job,
  lifecycle,
  chainJob,
  chainError,
  wallet,
  transactions,
  busyKind,
  actionsBusy,
  error,
  onFund,
  onRefund,
}: JobDetailProps) {
  const canFund =
    lifecycle.stage === "awaiting_funding" ||
    lifecycle.stage === "funding_pending";
  // Keep the failure explanation visible after the refund confirms
  const isFailure = [
    "failed",
    "expired",
    "refund_pending",
    "refunded",
  ].includes(lifecycle.stage);
  return (
    <Card className="min-w-0 gap-4 rounded-xl">
      <CardHeader className="gap-2 border-b">
        <div className="flex flex-wrap items-center gap-2">
          <JobStageBadge stage={lifecycle.stage} />
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
          <SummaryItem label="Scheduler status">
            <span className="capitalize">{job.status}</span>
            <span className="text-muted-foreground block text-xs font-normal">
              Updated {formatDateTime(job.statusTime)}
            </span>
          </SummaryItem>
        </dl>
        <JobTimeline lifecycle={lifecycle} chainJob={chainJob} />
        {chainError ? (
          <p
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs"
          >
            Could not read this job from the contract: {chainError}
          </p>
        ) : null}
        {canFund ? (
          <FundingPanel
            job={job}
            lifecycle={lifecycle}
            wallet={wallet}
            busy={busyKind === "funding"}
            actionsBusy={actionsBusy}
            onFund={onFund}
          />
        ) : null}
        {isFailure ? (
          <OutcomePanel
            job={job}
            lifecycle={lifecycle}
            chainJob={chainJob}
            wallet={wallet}
            busy={busyKind === "refund"}
            actionsBusy={actionsBusy}
            onRefund={onRefund}
          />
        ) : null}
        {lifecycle.stage === "accepted" ? (
          <ResultReceipt job={job} chainJob={chainJob} />
        ) : null}
        {showsProviders(lifecycle, chainJob) ? (
          <div className="space-y-2 text-xs">
            <p className="font-medium">Assigned providers</p>
            <ProviderStatusList
              providers={chainJob.providers}
              showClaims={false}
            />
          </div>
        ) : null}
        <TransactionsList rows={getTransactionRows(job, transactions)} />
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
      </CardContent>
    </Card>
  );
}
