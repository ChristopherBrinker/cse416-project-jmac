import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@cse416-project-jmac/ui/components/empty";
import { cn } from "@cse416-project-jmac/ui/lib/utils";
import {
  CircleCheckIcon,
  CircleXIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
} from "lucide-react";

import type { EvaluationJob, RecoveryOutcome } from "@/lib/evaluations";
import { formatDateTime } from "@/lib/evaluations";

function OutcomeIcon({ outcome }: { outcome: RecoveryOutcome }) {
  switch (outcome) {
    case "recovered": {
      return <CircleCheckIcon className="size-4 text-emerald-500" />;
    }
    case "in_progress": {
      return (
        <LoaderCircleIcon className="size-4 animate-spin text-amber-500" />
      );
    }
    case "exhausted": {
      return <CircleXIcon className="text-destructive size-4" />;
    }
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unhandled recovery outcome: ${String(exhaustive)}`);
    }
  }
}

const OUTCOME_LABELS: Record<RecoveryOutcome, string> = {
  recovered: "Recovered",
  in_progress: "In progress",
  exhausted: "Retry budget exhausted",
};

export function RecoveryTimeline({ job }: { job: EvaluationJob }) {
  if (job.recoveryAttempts.length === 0) {
    return (
      <Empty className="border py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheckIcon />
          </EmptyMedia>
          <EmptyTitle>No recovery attempts</EmptyTitle>
          <EmptyDescription className="text-xs/relaxed">
            {job.failureReason
              ? "This failure was not retryable, so no recovery was attempted."
              : "Every provider has run without needing a retry."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ol className="space-y-0">
      {job.recoveryAttempts.map((attempt, index) => {
        const provider = job.providers.find(
          (result) => result.id === attempt.providerId
        );
        const isLast = index === job.recoveryAttempts.length - 1;
        return (
          <li key={attempt.id} className="relative flex gap-3 pb-4 last:pb-0">
            {isLast ? null : (
              <span
                className="bg-border absolute top-5 bottom-0 left-2 w-px"
                aria-hidden="true"
              />
            )}
            <span className="bg-card relative mt-0.5 flex size-4 shrink-0">
              <OutcomeIcon outcome={attempt.outcome} />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-medium">
                  Attempt {attempt.attempt} of {attempt.maxAttempts}
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · {provider?.model ?? attempt.providerId}
                  </span>
                </p>
                <time
                  dateTime={attempt.occurredAt}
                  className="text-muted-foreground"
                >
                  {formatDateTime(attempt.occurredAt)}
                </time>
              </div>
              <p>{attempt.reason}</p>
              <p className="text-muted-foreground">{attempt.action}</p>
              <p
                className={cn(
                  "font-medium",
                  attempt.outcome === "recovered" &&
                    "text-emerald-700 dark:text-emerald-400",
                  attempt.outcome === "in_progress" &&
                    "text-amber-700 dark:text-amber-400",
                  attempt.outcome === "exhausted" && "text-destructive"
                )}
              >
                {OUTCOME_LABELS[attempt.outcome]}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
