export type JobStatus =
  | "queued"
  | "running"
  | "recovering"
  | "completed"
  | "failed";

export type ProviderRunStatus =
  | "pending"
  | "running"
  | "retrying"
  | "passed"
  | "failed";

export type RecoveryOutcome = "recovered" | "in_progress" | "exhausted";

export type ReceiptStatus = "signed" | "anchored";

export interface Benchmark {
  id: string;
  name: string;
  version: string;
  samples: number;
  description: string;
}

export interface ProviderModel {
  id: string;
  provider: string;
  model: string;
}

export interface ProviderResult extends ProviderModel {
  status: ProviderRunStatus;
  /** Benchmark score from 0 to 100, or null until samples have been graded. */
  score: number | null;
  p50LatencyMs: number | null;
  costUsd: number;
  samplesCompleted: number;
}

export interface RecoveryAttempt {
  id: string;
  providerId: string;
  attempt: number;
  maxAttempts: number;
  reason: string;
  action: string;
  outcome: RecoveryOutcome;
  occurredAt: string;
}

export interface Receipt {
  id: string;
  status: ReceiptStatus;
  resultDigest: string;
  signer: string;
  network: string;
  txHash: string | null;
  blockNumber: number | null;
  issuedAt: string;
}

export interface EvaluationJob {
  id: string;
  name: string;
  benchmark: Benchmark;
  status: JobStatus;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  issueReceipt: boolean;
  providers: ProviderResult[];
  recoveryAttempts: RecoveryAttempt[];
  receipt: Receipt | null;
}

export type JobFilter = "all" | "active" | "completed" | "failed";

const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set([
  "queued",
  "running",
  "recovering",
]);

export const isActiveJob = (job: EvaluationJob): boolean =>
  ACTIVE_STATUSES.has(job.status);

export const matchesFilter = (
  job: EvaluationJob,
  filter: JobFilter
): boolean => {
  switch (filter) {
    case "all": {
      return true;
    }
    case "active": {
      return isActiveJob(job);
    }
    case "completed": {
      return job.status === "completed";
    }
    case "failed": {
      return job.status === "failed";
    }
    default: {
      const exhaustive: never = filter;
      throw new Error(`Unhandled job filter: ${String(exhaustive)}`);
    }
  }
};

export type ScoredResult = ProviderResult & { score: number };

const isScored = (result: ProviderResult): result is ScoredResult =>
  result.score !== null;

export const getTopResult = (job: EvaluationJob): ScoredResult | null => {
  let top: ScoredResult | null = null;
  for (const result of job.providers) {
    if (isScored(result) && (top === null || result.score > top.score)) {
      top = result;
    }
  }
  return top;
};

/** Fraction of all provider samples completed, from 0 to 1. */
export const getJobProgress = (job: EvaluationJob): number => {
  const total = job.benchmark.samples * job.providers.length;
  if (total === 0) {
    return 0;
  }
  let completed = 0;
  for (const result of job.providers) {
    completed += result.samplesCompleted;
  }
  return completed / total;
};

export const getJobCost = (job: EvaluationJob): number => {
  let cost = 0;
  for (const result of job.providers) {
    cost += result.costUsd;
  }
  return cost;
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export const formatDateTime = (iso: string): string =>
  `${dateTimeFormatter.format(new Date(iso))} UTC`;

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

export const formatDuration = (startIso: string, endIso: string): string => {
  const minutes = Math.round(
    (Date.parse(endIso) - Date.parse(startIso)) / MS_PER_MINUTE
  );
  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainder = minutes % MINUTES_PER_HOUR;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export const formatCurrency = (value: number): string =>
  currencyFormatter.format(value);

const MS_PER_SECOND = 1000;

export const formatLatency = (ms: number): string =>
  ms < MS_PER_SECOND ? `${ms} ms` : `${(ms / MS_PER_SECOND).toFixed(1)} s`;

const integerFormatter = new Intl.NumberFormat("en-US");

export const formatCount = (value: number): string =>
  integerFormatter.format(value);

export const formatScore = (score: number): string => score.toFixed(1);

const HASH_EDGE_LENGTH = 6;
const HASH_PREFIX_PATTERN = /^(?:0x|sha256:)/u;

export const truncateHash = (hash: string): string => {
  const prefix = HASH_PREFIX_PATTERN.exec(hash)?.[0] ?? "";
  const body = hash.slice(prefix.length);
  if (body.length <= HASH_EDGE_LENGTH * 2) {
    return hash;
  }
  return `${prefix}${body.slice(0, HASH_EDGE_LENGTH)}…${body.slice(-HASH_EDGE_LENGTH)}`;
};
