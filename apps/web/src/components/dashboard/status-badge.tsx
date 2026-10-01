import { Badge } from "@cse416-project-jmac/ui/components/badge";
import { cn } from "@cse416-project-jmac/ui/lib/utils";

import type {
  JobStatus,
  ProviderRunStatus,
  ReceiptStatus,
} from "@/lib/evaluations";

type Tone = "neutral" | "brand" | "warning" | "success" | "danger";

const TONE_CLASSES: Record<Tone, { badge: string; dot: string }> = {
  neutral: {
    badge: "border-border bg-muted/60 text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
  brand: {
    badge: "border-brand/25 bg-brand/10 text-brand",
    dot: "bg-brand",
  },
  warning: {
    badge:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  success: {
    badge:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  danger: {
    badge: "border-destructive/30 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
};

interface StatusPresentation {
  label: string;
  tone: Tone;
  live: boolean;
}

const jobStatusPresentation = (status: JobStatus): StatusPresentation => {
  switch (status) {
    case "queued": {
      return { label: "Queued", tone: "neutral", live: false };
    }
    case "running": {
      return { label: "Running", tone: "brand", live: true };
    }
    case "recovering": {
      return { label: "Recovering", tone: "warning", live: true };
    }
    case "completed": {
      return { label: "Completed", tone: "success", live: false };
    }
    case "failed": {
      return { label: "Failed", tone: "danger", live: false };
    }
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled job status: ${String(exhaustive)}`);
    }
  }
};

const providerStatusPresentation = (
  status: ProviderRunStatus
): StatusPresentation => {
  switch (status) {
    case "pending": {
      return { label: "Pending", tone: "neutral", live: false };
    }
    case "running": {
      return { label: "Running", tone: "brand", live: true };
    }
    case "retrying": {
      return { label: "Retrying", tone: "warning", live: true };
    }
    case "passed": {
      return { label: "Passed", tone: "success", live: false };
    }
    case "failed": {
      return { label: "Failed", tone: "danger", live: false };
    }
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled provider status: ${String(exhaustive)}`);
    }
  }
};

const receiptStatusPresentation = (
  status: ReceiptStatus
): StatusPresentation => {
  switch (status) {
    case "signed": {
      return { label: "Signed · anchoring", tone: "warning", live: true };
    }
    case "anchored": {
      return { label: "Anchored on-chain", tone: "success", live: false };
    }
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled receipt status: ${String(exhaustive)}`);
    }
  }
};

function StatusPill({
  presentation,
  className,
}: {
  presentation: StatusPresentation;
  className?: string;
}) {
  const tone = TONE_CLASSES[presentation.tone];
  return (
    <Badge variant="outline" className={cn(tone.badge, className)}>
      <span className="relative flex size-1.5" aria-hidden="true">
        {presentation.live ? (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping opacity-60",
              tone.dot
            )}
          />
        ) : null}
        <span className={cn("relative inline-flex size-1.5", tone.dot)} />
      </span>
      {presentation.label}
    </Badge>
  );
}

export function JobStatusBadge({
  status,
  className,
}: {
  status: JobStatus;
  className?: string;
}) {
  return (
    <StatusPill
      presentation={jobStatusPresentation(status)}
      className={className}
    />
  );
}

export function ProviderStatusBadge({ status }: { status: ProviderRunStatus }) {
  return <StatusPill presentation={providerStatusPresentation(status)} />;
}

export function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  return <StatusPill presentation={receiptStatusPresentation(status)} />;
}
