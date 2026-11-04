import type { OnChainJob } from "@/lib/blockchain";
import type { EvaluationPhase, JobStage } from "@/lib/job-lifecycle";

export const STAGE_LABELS: Record<JobStage, string> = {
  awaiting_funding: "Awaiting funding",
  funding_pending: "Funding pending",
  funding_confirmed: "Funding confirmed",
  evaluation_pending: "Evaluation pending",
  accepted: "Accepted result",
  failed: "Failed",
  expired: "Expired",
  refund_pending: "Refund pending",
  refunded: "Refund confirmed",
};

export const PHASE_LABELS: Record<EvaluationPhase, string> = {
  awaiting_assignment: "Waiting for the scheduler to assign two providers",
  awaiting_commits: "Waiting for both providers to commit result hashes",
  awaiting_reveals: "Waiting for both providers to reveal their results",
};

const SECONDS_PER_MINUTE = 60;

export const formatTimeRemaining = (
  deadline: number,
  chainTime: number
): string => {
  const remaining = deadline - chainTime;
  if (remaining <= 0) {
    return "deadline passed";
  }
  const minutes = Math.floor(remaining / SECONDS_PER_MINUTE);
  const seconds = remaining % SECONDS_PER_MINUTE;
  return minutes > 0 ? `${minutes}m ${seconds}s left` : `${seconds}s left`;
};

const countProviders = (
  chainJob: OnChainJob,
  key: "committed" | "revealed"
): number => chainJob.providers.filter((provider) => provider[key]).length;

interface FailureExplanation {
  title: string;
  detail: string;
}

const DISAGREEMENT_DETAIL =
  "Both providers revealed results that matched their own commitments but not each other, so the contract blocked payment. No score was accepted.";

/** Both reveals without a Complete status means they disagreed, even after a refund. */
const providersDisagreed = (chainJob: OnChainJob): boolean =>
  chainJob.status === "failed" ||
  (chainJob.status === "refunded" &&
    chainJob.providers.every((provider) => provider.revealed));

const explainFundedFailure = (
  failureReason: string | undefined,
  chainJob: OnChainJob
): FailureExplanation => {
  const [providerA, providerB] = chainJob.providers;
  if (!(providerA.assigned && providerB.assigned)) {
    return {
      title: failureReason ?? "Provider assignment failed",
      detail:
        "Two providers were not assigned before the commit deadline, so no evaluation ran.",
    };
  }
  const commits = countProviders(chainJob, "committed");
  if (commits < 2) {
    return {
      title: failureReason ?? "Timed out",
      detail: `Only ${commits} of 2 providers committed a result before the commit deadline.`,
    };
  }
  return {
    title: failureReason ?? "Timed out",
    detail: `Only ${countProviders(chainJob, "revealed")} of 2 providers revealed a result before the reveal deadline.`,
  };
};

/**
 * Explains why a job did not produce an accepted result, preferring the
 * scheduler's recorded reason and falling back to on-chain evidence. Never
 * makes an escrow claim without a successful contract read.
 */
export const explainFailure = (
  failureReason: string | undefined,
  chainJob?: OnChainJob
): FailureExplanation => {
  const title = failureReason ?? "Evaluation failed";
  const reported = failureReason
    ? "The scheduler reported this reason."
    : "No failure reason was reported.";
  if (!chainJob) {
    return {
      title,
      detail: `${reported} Escrow status is unavailable until the contract can be read.`,
    };
  }
  if (providersDisagreed(chainJob)) {
    return {
      title: failureReason ?? "Providers disagreed on results",
      detail: DISAGREEMENT_DETAIL,
    };
  }
  if (chainJob.funded) {
    return explainFundedFailure(failureReason, chainJob);
  }
  return {
    title,
    detail: `${reported} This job was never funded on-chain, so the contract holds no funds for it.`,
  };
};
