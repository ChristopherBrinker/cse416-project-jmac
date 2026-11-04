import { cn } from "@cse416-project-jmac/ui/lib/utils";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleXIcon,
} from "lucide-react";

import type { OnChainJob } from "@/lib/blockchain";
import type { JobLifecycle } from "@/lib/job-lifecycle";

import { formatTimeRemaining, PHASE_LABELS } from "./job-presentation";

type StepState = "complete" | "current" | "upcoming" | "error";

interface TimelineStep {
  key: string;
  label: string;
  detail: string;
  state: StepState;
}

const STEP_ICONS = {
  complete: CircleCheckIcon,
  current: CircleDotIcon,
  upcoming: CircleDashedIcon,
  error: CircleXIcon,
} as const;

const STEP_ICON_CLASSES: Record<StepState, string> = {
  complete: "text-emerald-600 dark:text-emerald-400",
  current: "text-brand",
  upcoming: "text-muted-foreground",
  error: "text-destructive",
};

const isOutcomeStage = (lifecycle: JobLifecycle): boolean =>
  ["accepted", "failed", "expired", "refund_pending", "refunded"].includes(
    lifecycle.stage
  );

const FUNDED_STAGES = new Set<JobLifecycle["stage"]>([
  "funding_confirmed",
  "evaluation_pending",
  "accepted",
  "expired",
  "refund_pending",
  "refunded",
]);

/**
 * State for a step the job never visibly reached. Only on-chain evidence
 * marks it as an error; without contract data an accepted job's earlier
 * steps are treated as done and others as unknown.
 */
const unreachedState = (
  lifecycle: JobLifecycle,
  chainJob: OnChainJob | undefined
): StepState => {
  if (!isOutcomeStage(lifecycle)) {
    return "upcoming";
  }
  if (!chainJob) {
    return lifecycle.stage === "accepted" ? "complete" : "upcoming";
  }
  return "error";
};

const getFundingStep = (
  lifecycle: JobLifecycle,
  chainJob: OnChainJob | undefined
): TimelineStep => {
  if (lifecycle.stage === "funding_pending") {
    return {
      key: "funding",
      label: "Funding pending",
      detail:
        "Your funding transaction was submitted and is awaiting confirmation.",
      state: "current",
    };
  }
  const confirmed: TimelineStep = {
    key: "funding",
    label: "Funding confirmed",
    detail: "The job price was sent to the evaluation contract's escrow.",
    state: "complete",
  };
  if (chainJob?.funded) {
    return confirmed;
  }
  if (lifecycle.stage !== "awaiting_funding") {
    if (!chainJob && FUNDED_STAGES.has(lifecycle.stage)) {
      // The scheduler only advances jobs after seeing the funding event
      return confirmed;
    }
    return {
      key: "funding",
      label: chainJob ? "Never funded" : "Funding",
      detail: chainJob
        ? "This job was never funded on-chain, so no escrow exists."
        : "Funding status is unavailable until the contract can be read.",
      state: chainJob ? "error" : "upcoming",
    };
  }
  return {
    key: "funding",
    label: "Fund the job",
    detail: "Send the job price to the contract from your wallet.",
    state: "current",
  };
};

const getAssignmentStep = (
  lifecycle: JobLifecycle,
  chainJob: OnChainJob | undefined
): TimelineStep => {
  const assigned = chainJob?.providers.every((provider) => provider.assigned);
  if (assigned) {
    return {
      key: "assignment",
      label: "Providers assigned",
      detail: "Two distinct approved providers were assigned on-chain.",
      state: "complete",
    };
  }
  const waiting =
    lifecycle.stage === "funding_confirmed" ||
    lifecycle.phase === "awaiting_assignment";
  if (waiting) {
    return {
      key: "assignment",
      label: "Assigning providers",
      detail: PHASE_LABELS.awaiting_assignment,
      state: "current",
    };
  }
  return {
    key: "assignment",
    label: "Provider assignment",
    detail: "The scheduler assigns two providers after funding.",
    state: unreachedState(lifecycle, chainJob),
  };
};

const getEvaluationStep = (
  lifecycle: JobLifecycle,
  chainJob: OnChainJob | undefined
): TimelineStep => {
  const commits =
    chainJob?.providers.filter((provider) => provider.committed).length ?? 0;
  const reveals =
    chainJob?.providers.filter((provider) => provider.revealed).length ?? 0;
  const counts = `Commits ${commits}/2 · Reveals ${reveals}/2`;
  if (
    lifecycle.stage === "evaluation_pending" &&
    lifecycle.phase !== "awaiting_assignment"
  ) {
    const deadline =
      chainJob && lifecycle.phaseDeadline
        ? ` · ${formatTimeRemaining(lifecycle.phaseDeadline, chainJob.chainTime)}`
        : "";
    return {
      key: "evaluation",
      label: "Evaluation pending",
      detail: `${lifecycle.phase ? PHASE_LABELS[lifecycle.phase] : "Providers are evaluating"}. ${counts}${deadline}`,
      state: "current",
    };
  }
  if (reveals === 2) {
    return {
      key: "evaluation",
      label: "Results committed and revealed",
      detail: `${counts}. Each reveal matched its provider's commitment.`,
      state: "complete",
    };
  }
  return {
    key: "evaluation",
    label: "Commit and reveal",
    detail: chainJob?.funded
      ? counts
      : "Providers commit a result hash, then reveal it.",
    state: unreachedState(lifecycle, chainJob),
  };
};

const getOutcomeStep = (lifecycle: JobLifecycle): TimelineStep => {
  if (lifecycle.stage === "accepted") {
    return {
      key: "outcome",
      label: "Accepted result",
      detail: "Both providers revealed identical results.",
      state: "complete",
    };
  }
  if (lifecycle.stage === "expired") {
    return {
      key: "outcome",
      label: "Expired",
      detail:
        "The evaluation missed its deadline. Payment to providers is blocked.",
      state: "error",
    };
  }
  if (isOutcomeStage(lifecycle)) {
    return {
      key: "outcome",
      label: "Failed",
      detail: "No result was accepted. Payment to providers is blocked.",
      state: "error",
    };
  }
  return {
    key: "outcome",
    label: "Outcome",
    detail: "Accepted when both providers reveal matching results.",
    state: "upcoming",
  };
};

const getRefundStep = (lifecycle: JobLifecycle): TimelineStep | null => {
  switch (lifecycle.stage) {
    case "refunded": {
      return {
        key: "refund",
        label: "Refund confirmed",
        detail: "The contract returned the job price to the funding wallet.",
        state: "complete",
      };
    }
    case "refund_pending": {
      return {
        key: "refund",
        label: "Refund pending",
        detail: "Your refund transaction is awaiting confirmation.",
        state: "current",
      };
    }
    case "failed":
    case "expired": {
      return {
        key: "refund",
        label: lifecycle.refundAvailable ? "Refund available" : "No refund due",
        detail: lifecycle.refundAvailable
          ? "The funding wallet can reclaim the job price."
          : "The contract holds no funds for this job.",
        state: lifecycle.refundAvailable ? "current" : "upcoming",
      };
    }
    default: {
      return null;
    }
  }
};

export function JobTimeline({
  lifecycle,
  chainJob,
}: {
  lifecycle: JobLifecycle;
  chainJob: OnChainJob | undefined;
}) {
  const steps = [
    getFundingStep(lifecycle, chainJob),
    getAssignmentStep(lifecycle, chainJob),
    getEvaluationStep(lifecycle, chainJob),
    getOutcomeStep(lifecycle),
    getRefundStep(lifecycle),
  ].filter((step): step is TimelineStep => step !== null);

  return (
    <ol aria-label="Job progress" className="space-y-3">
      {steps.map((step) => {
        const Icon = STEP_ICONS[step.state];
        return (
          <li
            key={step.key}
            aria-current={step.state === "current" ? "step" : undefined}
            className="flex gap-3"
          >
            <Icon
              aria-hidden="true"
              className={cn(
                "mt-0.5 size-4 shrink-0",
                STEP_ICON_CLASSES[step.state]
              )}
            />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">{step.label}</p>
              <p className="text-muted-foreground text-xs">{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
