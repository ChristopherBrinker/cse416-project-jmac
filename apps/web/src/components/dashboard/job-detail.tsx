"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cse416-project-jmac/ui/components/card";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@cse416-project-jmac/ui/components/progress";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@cse416-project-jmac/ui/components/tabs";
import { CircleAlertIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import type { EvaluationJob } from "@/lib/evaluations";
import {
  formatCount,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatScore,
  getJobCost,
  getJobProgress,
  getTopResult,
  isActiveJob,
} from "@/lib/evaluations";

import { CopyButton } from "./copy-button";
import { ProviderResults } from "./provider-results";
import { ReceiptPanel } from "./receipt-panel";
import { RecoveryTimeline } from "./recovery-timeline";
import { JobStatusBadge } from "./status-badge";

const DETAIL_TABS = ["providers", "recovery", "receipt"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

const isDetailTab = (value: unknown): value is DetailTab =>
  DETAIL_TABS.some((tab) => tab === value);

const PERCENT = 100;

function SummaryItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-card space-y-0.5 p-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

const describeTiming = (
  job: EvaluationJob
): { label: string; value: string } => {
  if (job.startedAt && job.completedAt) {
    return {
      label: "Duration",
      value: formatDuration(job.startedAt, job.completedAt),
    };
  }
  if (job.startedAt) {
    return { label: "Started", value: formatDateTime(job.startedAt) };
  }
  return { label: "Queued", value: formatDateTime(job.createdAt) };
};

export function JobDetail({ job }: { job: EvaluationJob }) {
  const [tab, setTab] = useState<DetailTab>("providers");

  const top = getTopResult(job);
  const timing = describeTiming(job);
  const progress = Math.round(getJobProgress(job) * PERCENT);

  return (
    <Card className="gap-4">
      <CardHeader className="gap-2 border-b">
        <div className="flex flex-wrap items-center gap-2">
          <JobStatusBadge status={job.status} />
          <span className="text-muted-foreground flex items-center font-mono">
            {job.id}
            <CopyButton value={job.id} label="Job ID" />
          </span>
        </div>
        <CardTitle className="text-base">{job.name}</CardTitle>
        <CardDescription>
          {job.benchmark.name} v{job.benchmark.version} ·{" "}
          {formatCount(job.benchmark.samples)} private samples · started by{" "}
          {job.createdBy}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="bg-border grid grid-cols-2 gap-px border">
          <SummaryItem label="Top score">
            {top ? (
              <span className="flex items-baseline gap-1.5">
                <span className="text-lg font-semibold tabular-nums">
                  {formatScore(top.score)}
                </span>
                <span className="text-muted-foreground truncate font-normal">
                  {top.model}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground text-lg font-semibold">
                —
              </span>
            )}
          </SummaryItem>
          <SummaryItem label="Spend">
            <span className="text-lg font-semibold tabular-nums">
              {formatCurrency(getJobCost(job))}
            </span>
          </SummaryItem>
          <SummaryItem label={timing.label}>{timing.value}</SummaryItem>
          <SummaryItem label="Created">
            {formatDateTime(job.createdAt)}
          </SummaryItem>
        </dl>

        {isActiveJob(job) ? (
          <Progress
            value={progress}
            className="[&_[data-slot=progress-indicator]]:bg-brand"
          >
            <ProgressLabel className="text-muted-foreground">
              Samples graded across providers
            </ProgressLabel>
            <ProgressValue />
          </Progress>
        ) : null}

        {job.failureReason ? (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/5 text-destructive flex gap-2 border p-3"
          >
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <p>{job.failureReason}</p>
          </div>
        ) : null}

        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (isDetailTab(value)) {
              setTab(value);
            }
          }}
          className="gap-3"
        >
          <TabsList className="w-full">
            <TabsTrigger value="providers">
              Providers
              <span className="text-muted-foreground tabular-nums">
                {job.providers.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="recovery">
              Recovery
              <span className="text-muted-foreground tabular-nums">
                {job.recoveryAttempts.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="receipt">Receipt</TabsTrigger>
          </TabsList>
          <TabsContent value="providers">
            <ProviderResults job={job} />
          </TabsContent>
          <TabsContent value="recovery">
            <RecoveryTimeline job={job} />
          </TabsContent>
          <TabsContent value="receipt">
            <ReceiptPanel job={job} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
