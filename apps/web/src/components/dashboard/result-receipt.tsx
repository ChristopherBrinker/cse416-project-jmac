import { Badge } from "@cse416-project-jmac/ui/components/badge";
import { useQuery } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Hash } from "viem";

import {
  contractAddress,
  evaluationChain,
  verifyJobCompletion,
} from "@/lib/blockchain";
import type { OnChainJob, OnChainProvider } from "@/lib/blockchain";
import type { EvaluationJob } from "@/lib/evaluations";
import { formatScore } from "@/lib/evaluations";
import { specHash } from "@/lib/settlement";

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

/** Accepted correct count and the item count fixed at assignment. */
const getItemCounts = (chainJob: OnChainJob | undefined) => {
  const revealed = chainJob?.providers.find((provider) => provider.revealed);
  if (!revealed || !chainJob || chainJob.itemCount === 0) {
    return;
  }
  return { correct: revealed.correctCount, total: chainJob.itemCount };
};

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CircleCheckIcon
          className="mt-px size-4 shrink-0 text-emerald-500"
          aria-label="Verified"
        />
      ) : (
        <CircleAlertIcon
          className="text-destructive mt-px size-4 shrink-0"
          aria-label="Not verified"
        />
      )}
      <span>{children}</span>
    </li>
  );
}

const isHash = (value: string | undefined): value is Hash =>
  value?.startsWith("0x") === true;

/** Re-checks the receipt against the contract instead of trusting Convex. */
function ReceiptChecks({
  job,
  chainJob,
}: {
  job: EvaluationJob;
  chainJob: OnChainJob;
}) {
  const [accepted] = chainJob.providers;
  const completionTx = job.jobComplete_tx;
  const { outputDigest, correctCount } = accepted;
  const completion = useQuery({
    queryKey: ["jobCompletion", job._id, completionTx, outputDigest],
    queryFn: () =>
      isHash(completionTx) && outputDigest
        ? verifyJobCompletion(completionTx, job._id, outputDigest, correctCount)
        : false,
    enabled: isHash(completionTx) && outputDigest !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  const specMatches =
    job.benchmark !== undefined &&
    specHash(job.benchmark.contentHash, job.modelId) === chainJob.specHash;
  const onChainScore =
    chainJob.itemCount > 0
      ? (correctCount / chainJob.itemCount) * PERCENT
      : undefined;
  const scoreMatches = onChainScore !== undefined && job.score === onChainScore;

  return (
    <ul className="space-y-1">
      <Check ok={specMatches}>
        Spec hash recomputed from the benchmark SHA-256 and model ID{" "}
        {specMatches ? "matches the contract" : "does not match the contract"}
      </Check>
      <Check ok={completion.data === true}>
        {completion.data === true
          ? "Completion transaction emitted this job's JobComplete event"
          : "No verified JobComplete transaction recorded yet"}
      </Check>
      <Check ok={scoreMatches}>
        Dashboard score {scoreMatches ? "matches" : "differs from"} the on-chain
        count
      </Check>
    </ul>
  );
}

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
  const outputDigest = chainJob?.providers[0].outputDigest;
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
          Scale: the scheduler stores the on-chain correct count divided by the
          item count as a percentage.
        </p>
        <p className="text-muted-foreground mt-1">
          Both assigned providers revealed the same digest of their ordered
          predictions and the same count. This shows agreement between two
          providers; it does not prove either ran the model honestly.
        </p>
      </div>
      {chainJob ? <ReceiptChecks job={job} chainJob={chainJob} /> : null}
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
        {chainJob ? (
          <ReceiptRow label="Spec hash" copyValue={chainJob.specHash}>
            <span className="font-mono">{chainJob.specHash}</span>
          </ReceiptRow>
        ) : null}
        {outputDigest ? (
          <ReceiptRow label="Output digest" copyValue={outputDigest}>
            <span className="font-mono">{outputDigest}</span>
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
        files, or per-item results. The output digest is keyed by a secret
        derived from the benchmark, so it reveals nothing about the predictions.
      </p>
    </section>
  );
}
