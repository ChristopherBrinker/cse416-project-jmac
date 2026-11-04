import { Badge } from "@cse416-project-jmac/ui/components/badge";
import { ReceiptTextIcon, ShieldCheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { contractAddress, evaluationChain } from "@/lib/blockchain";
import type { OnChainJob, OnChainProvider } from "@/lib/blockchain";
import type { EvaluationJob } from "@/lib/evaluations";
import { formatScore } from "@/lib/evaluations";

import { CopyButton } from "./copy-button";

const PERCENT = 100;
const ACCURACY_DIGITS = 3;

function ReceiptRow({
  label,
  children,
  copyValue,
}: {
  label: string;
  children: ReactNode;
  copyValue?: string;
}) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-start gap-1">
        <span className="min-w-0 break-all">{children}</span>
        {copyValue ? <CopyButton value={copyValue} label={label} /> : null}
      </dd>
    </div>
  );
}

function NotRecorded({ owner }: { owner: string }) {
  return (
    <span className="text-muted-foreground italic">
      Not recorded yet ({owner} interface pending)
    </span>
  );
}

/** Correct/total from the revealed per-item vector; only counts are shown. */
const getItemCounts = (chainJob: OnChainJob | undefined) => {
  const revealed = chainJob?.providers.find((provider) => provider.revealed);
  if (!revealed || revealed.result.length === 0) {
    return;
  }
  const correct = revealed.result.filter(Boolean).length;
  return { correct, total: revealed.result.length };
};

export function ProviderStatusList({
  providers,
  showClaims,
}: {
  providers: readonly OnChainProvider[];
  showClaims: boolean;
}) {
  return (
    <ul className="grid gap-2">
      {providers.map((provider, index) => (
        <li
          key={`${provider.providerId}-${provider.address}`}
          className="space-y-1 rounded-lg border p-2"
        >
          <p className="flex flex-wrap items-center gap-2 font-medium">
            Provider {index === 0 ? "A" : "B"}
            <Badge variant="outline">
              {provider.committed ? "Committed" : "No commit"}
            </Badge>
            <Badge variant="outline">
              {provider.revealed ? "Revealed" : "Not revealed"}
            </Badge>
            {showClaims ? (
              <Badge variant={provider.claimed ? "secondary" : "outline"}>
                {provider.claimed ? "Payment claimed" : "Payment unclaimed"}
              </Badge>
            ) : null}
          </p>
          <p className="flex items-center gap-1">
            <span className="text-muted-foreground">ID</span>
            <span className="min-w-0 font-mono break-all">
              {provider.providerId}
            </span>
          </p>
          <p className="flex items-center gap-1">
            <span className="text-muted-foreground">Wallet</span>
            <span className="min-w-0 font-mono break-all">
              {provider.address}
            </span>
            <CopyButton
              value={provider.address}
              label={`Provider ${index === 0 ? "A" : "B"} wallet`}
            />
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Evaluation receipt for an accepted result: everything a result reader needs
 * to trace the score to its benchmark commitment, model, providers, and
 * transactions. It deliberately contains no questions, answer keys,
 * predictions, or per-item correctness.
 */
export function ResultReceipt({
  job,
  chainJob,
}: {
  job: EvaluationJob;
  chainJob: OnChainJob | undefined;
}) {
  const counts = getItemCounts(chainJob);
  const accuracy =
    counts === undefined
      ? job.score === undefined
        ? undefined
        : job.score / PERCENT
      : counts.correct / counts.total;
  const resultCommitment = chainJob?.providers[0].commit;
  const claimedCount =
    chainJob?.providers.filter((provider) => provider.claimed).length ?? 0;

  return (
    <section
      aria-labelledby={`receipt-${job._id}`}
      className="space-y-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id={`receipt-${job._id}`}
          className="flex items-center gap-2 text-sm font-medium"
        >
          <ReceiptTextIcon className="size-4" aria-hidden="true" />
          Evaluation receipt
        </h3>
        <Badge variant="outline" className="gap-1">
          <ShieldCheckIcon aria-hidden="true" />
          Accepted: both providers matched
        </Badge>
      </div>
      <div>
        <p className="text-3xl font-semibold tabular-nums">
          {formatScore(job.score)}
        </p>
        <p className="text-muted-foreground">
          {accuracy === undefined
            ? "Accuracy not reported"
            : `Accuracy ${accuracy.toFixed(ACCURACY_DIGITS)} on the worker's 0–1 scale`}
          {counts
            ? ` · ${counts.correct} of ${counts.total} items correct`
            : ""}
        </p>
        <p className="text-muted-foreground mt-1">
          Scale: workers score accuracy from 0 to 1; the scheduler stores it as
          a percentage (accuracy × 100).
        </p>
      </div>
      <dl className="grid gap-2">
        <ReceiptRow label="Benchmark">
          {job.benchmark
            ? `${job.benchmark.name} v${job.benchmark.version}`
            : job.benchmarkId}
        </ReceiptRow>
        {job.benchmark ? (
          <ReceiptRow
            label="Benchmark SHA-256"
            copyValue={job.benchmark.contentHash}
          >
            <span className="font-mono">{job.benchmark.contentHash}</span>
          </ReceiptRow>
        ) : null}
        <ReceiptRow label="Model">{job.model?.name ?? job.modelId}</ReceiptRow>
        <ReceiptRow label="Model revision">
          <NotRecorded owner="backend" />
        </ReceiptRow>
        <ReceiptRow label="Worker version">
          <NotRecorded owner="worker/backend" />
        </ReceiptRow>
        {resultCommitment ? (
          <ReceiptRow label="Result commitment" copyValue={resultCommitment}>
            <span className="font-mono">{resultCommitment}</span>
          </ReceiptRow>
        ) : null}
        {job.jobComplete_tx ? (
          <ReceiptRow label="Completion tx" copyValue={job.jobComplete_tx}>
            <span className="font-mono">{job.jobComplete_tx}</span>
          </ReceiptRow>
        ) : null}
        <ReceiptRow label="Contract" copyValue={contractAddress}>
          <span className="font-mono">{contractAddress}</span> on{" "}
          {evaluationChain.name} (chain {evaluationChain.id})
        </ReceiptRow>
      </dl>
      {chainJob ? (
        <div className="space-y-2">
          <p className="font-medium">Providers</p>
          <ProviderStatusList providers={chainJob.providers} showClaims />
          <p className="text-muted-foreground">
            The result was accepted when both reveals matched. Provider payment
            claims are separate: {claimedCount} of 2 providers have claimed
            their share so far.
          </p>
        </div>
      ) : null}
      <p className="text-muted-foreground border-t pt-2">
        This receipt contains no benchmark questions, answer keys, prediction
        files, or per-item results.
      </p>
    </section>
  );
}
