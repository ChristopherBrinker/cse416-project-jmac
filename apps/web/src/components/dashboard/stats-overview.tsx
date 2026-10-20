import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@cse416-project-jmac/ui/components/card";
import { Activity, CircleCheck, CircleX, Wallet } from "lucide-react";

import type { EvaluationJob } from "@/lib/evaluations";

export function StatsOverview({
  jobs,
  loading,
}: {
  jobs: EvaluationJob[];
  loading: boolean;
}) {
  const stats = [
    {
      label: "Awaiting funding",
      status: "created",
      detail: "Connect a wallet to start these jobs",
      icon: Wallet,
    },
    {
      label: "Active evaluations",
      status: "funded",
      detail: "Funded and awaiting results",
      icon: Activity,
    },
    {
      label: "Completed evaluations",
      status: "succeeded",
      detail: "Evaluations completed successfully",
      icon: CircleCheck,
    },
    {
      label: "Failed evaluations",
      status: "failed",
      detail: "Evaluations reported as failed",
      icon: CircleX,
    },
  ];
  return (
    <section
      aria-label="Evaluation summary"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {stats.map(({ label, status, detail, icon: Icon }) => (
        <Card key={status} size="sm" className="rounded-xl">
          <CardHeader className="grid-cols-[1fr_auto]">
            <CardTitle className="text-muted-foreground text-xs font-medium">
              {label}
            </CardTitle>
            <Icon className="text-muted-foreground size-4" aria-hidden="true" />
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {loading
                ? "—"
                : jobs.filter((job) => job.status === status).length}
            </p>
            <p className="text-muted-foreground">{detail}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
