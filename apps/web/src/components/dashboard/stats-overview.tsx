import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@cse416-project-jmac/ui/components/card";
import { Activity, Gauge, LifeBuoy, ReceiptText } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { EvaluationJob } from "@/lib/evaluations";
import { formatScore, getTopResult } from "@/lib/evaluations";

interface Stat {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
}

const PERCENT = 100;

const computeStats = (jobs: EvaluationJob[]): Stat[] => {
  let running = 0;
  let recovering = 0;
  let queued = 0;
  let completed = 0;
  let topScoreSum = 0;
  let recoveryTotal = 0;
  let recovered = 0;
  let receiptsIssued = 0;
  let receiptsAnchored = 0;

  for (const job of jobs) {
    if (job.status === "running") {
      running += 1;
    } else if (job.status === "recovering") {
      recovering += 1;
    } else if (job.status === "queued") {
      queued += 1;
    } else if (job.status === "completed") {
      completed += 1;
      topScoreSum += getTopResult(job)?.score ?? 0;
    }

    for (const attempt of job.recoveryAttempts) {
      if (attempt.outcome !== "in_progress") {
        recoveryTotal += 1;
      }
      if (attempt.outcome === "recovered") {
        recovered += 1;
      }
    }

    if (job.receipt) {
      receiptsIssued += 1;
      if (job.receipt.status === "anchored") {
        receiptsAnchored += 1;
      }
    }
  }

  const averageTopScore = completed === 0 ? null : topScoreSum / completed;
  const recoveryRate =
    recoveryTotal === 0 ? null : (recovered / recoveryTotal) * PERCENT;

  return [
    {
      label: "Active evaluations",
      value: String(running + recovering + queued),
      detail: `${running} running · ${recovering} recovering · ${queued} queued`,
      icon: Activity,
    },
    {
      label: "Average top score",
      value: averageTopScore === null ? "—" : formatScore(averageTopScore),
      detail: `Across ${completed} completed ${completed === 1 ? "run" : "runs"}`,
      icon: Gauge,
    },
    {
      label: "Recovery success",
      value: recoveryRate === null ? "—" : `${Math.round(recoveryRate)}%`,
      detail: `${recovered} of ${recoveryTotal} resolved attempts recovered`,
      icon: LifeBuoy,
    },
    {
      label: "Receipts anchored",
      value: `${receiptsAnchored}/${receiptsIssued}`,
      detail: `${receiptsIssued - receiptsAnchored} awaiting on-chain anchoring`,
      icon: ReceiptText,
    },
  ];
};

export function StatsOverview({ jobs }: { jobs: EvaluationJob[] }) {
  const stats = computeStats(jobs);

  return (
    <section
      aria-label="Evaluation summary"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {stats.map(({ label, value, detail, icon: Icon }) => (
        <Card key={label} size="sm">
          <CardHeader className="grid-cols-[1fr_auto]">
            <CardTitle className="text-muted-foreground text-xs font-medium">
              {label}
            </CardTitle>
            <Icon className="text-muted-foreground size-4" aria-hidden="true" />
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {value}
            </p>
            <p className="text-muted-foreground">{detail}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
