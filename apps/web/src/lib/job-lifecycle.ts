import type { OnChainJob } from "./blockchain";

/**
 * User-facing job stages. Convex records the scheduler's view of a job; the
 * contract is authoritative for escrow, so on-chain state wins whenever it is
 * available.
 */
export type JobStage =
  | "awaiting_funding"
  | "funding_pending"
  | "funding_confirmed"
  | "evaluation_pending"
  | "accepted"
  | "failed"
  | "expired"
  | "refund_pending"
  | "refunded";

export type EvaluationPhase =
  | "awaiting_assignment"
  | "awaiting_commits"
  | "awaiting_reveals";

export interface PendingTransaction {
  confirmed: boolean;
}

export interface LifecycleInput {
  convexStatus: string;
  chainJob: OnChainJob | undefined;
  fundingTransaction?: PendingTransaction;
  refundTransaction?: PendingTransaction;
}

export interface JobLifecycle {
  stage: JobStage;
  phase?: EvaluationPhase;
  /** Unix seconds when the current evaluation phase closes. */
  phaseDeadline?: number;
  /** True only when the contract would accept a refund from the creator. */
  refundAvailable: boolean;
}

/** Mirrors Evaluation.sol `hasTimedOut` for an open job. */
export const hasTimedOut = (chainJob: OnChainJob): boolean => {
  const [providerA, providerB] = chainJob.providers;
  const bothCommitted = providerA.committed && providerB.committed;
  const deadline = bothCommitted
    ? chainJob.revealDeadline
    : chainJob.commitDeadline;
  return chainJob.chainTime > deadline;
};

const getEvaluationPhase = (
  chainJob: OnChainJob
): Pick<JobLifecycle, "phase" | "phaseDeadline"> => {
  const [providerA, providerB] = chainJob.providers;
  if (!(providerA.assigned && providerB.assigned)) {
    return {
      phase: "awaiting_assignment",
      phaseDeadline: chainJob.commitDeadline,
    };
  }
  if (!(providerA.committed && providerB.committed)) {
    return {
      phase: "awaiting_commits",
      phaseDeadline: chainJob.commitDeadline,
    };
  }
  return { phase: "awaiting_reveals", phaseDeadline: chainJob.revealDeadline };
};

const getOpenJobLifecycle = (
  convexStatus: string,
  chainJob: OnChainJob
): JobLifecycle => {
  if (hasTimedOut(chainJob)) {
    return {
      stage: convexStatus === "failed" ? "failed" : "expired",
      refundAvailable: true,
    };
  }
  const evaluationPhase = getEvaluationPhase(chainJob);
  if (
    convexStatus === "created" &&
    evaluationPhase.phase === "awaiting_assignment"
  ) {
    return { stage: "funding_confirmed", refundAvailable: false };
  }
  return {
    stage: "evaluation_pending",
    ...evaluationPhase,
    refundAvailable: false,
  };
};

const getConvexOnlyLifecycle = ({
  convexStatus,
  fundingTransaction,
}: LifecycleInput): JobLifecycle => {
  if (convexStatus === "succeeded") {
    return { stage: "accepted", refundAvailable: false };
  }
  if (convexStatus === "failed") {
    return { stage: "failed", refundAvailable: false };
  }
  if (convexStatus === "funded") {
    return { stage: "evaluation_pending", refundAvailable: false };
  }
  if (fundingTransaction) {
    return {
      stage: fundingTransaction.confirmed
        ? "funding_confirmed"
        : "funding_pending",
      refundAvailable: false,
    };
  }
  return { stage: "awaiting_funding", refundAvailable: false };
};

export const getJobLifecycle = (input: LifecycleInput): JobLifecycle => {
  const { convexStatus, chainJob, refundTransaction } = input;
  if (chainJob?.status === "refunded") {
    return { stage: "refunded", refundAvailable: false };
  }
  if (refundTransaction && !refundTransaction.confirmed) {
    return { stage: "refund_pending", refundAvailable: false };
  }
  if (chainJob?.status === "complete") {
    return { stage: "accepted", refundAvailable: false };
  }
  if (chainJob?.status === "failed") {
    return { stage: "failed", refundAvailable: true };
  }
  if (chainJob?.funded) {
    return getOpenJobLifecycle(convexStatus, chainJob);
  }
  if (chainJob && convexStatus === "failed") {
    // Failed before any escrow existed, so there is nothing to refund
    return { stage: "failed", refundAvailable: false };
  }
  return getConvexOnlyLifecycle(input);
};

/** Jobs whose on-chain state can no longer change need no polling. */
export const isSettledOnChain = (chainJob: OnChainJob | undefined): boolean =>
  chainJob?.status === "refunded" ||
  (chainJob?.status === "complete" &&
    chainJob.providers.every((provider) => provider.claimed));
