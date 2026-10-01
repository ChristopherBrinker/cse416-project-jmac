"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { formatCount } from "@/lib/evaluations";
import { MOCK_EVALUATION_JOBS, createQueuedJob } from "@/lib/mock-evaluations";
import type { NewEvaluationInput } from "@/lib/mock-evaluations";

import { BackendStatus } from "./backend-status";
import { JobDetail } from "./job-detail";
import { JobsPanel } from "./jobs-panel";
import { NewEvaluationDialog } from "./new-evaluation-dialog";
import { StatsOverview } from "./stats-overview";

const STACKED_LAYOUT_QUERY = "(max-width: 1023px)";

export default function DashboardContent() {
  const { data: session } = authClient.useSession();
  const [jobs, setJobs] = useState(MOCK_EVALUATION_JOBS);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    MOCK_EVALUATION_JOBS[0]?.id ?? null
  );
  const detailRef = useRef<HTMLElement>(null);

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;

  const selectJob = (jobId: string) => {
    setSelectedJobId(jobId);
    if (window.matchMedia(STACKED_LAYOUT_QUERY).matches) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const createEvaluation = (input: NewEvaluationInput) => {
    const createdBy = session?.user.name || "You";
    const job = createQueuedJob(input, createdBy);
    setJobs((current) => [job, ...current]);
    setSelectedJobId(job.id);
    toast.success("Evaluation queued", {
      description: `${job.name} · ${formatCount(input.benchmark.samples * input.providers.length)} samples across ${input.providers.length} ${input.providers.length === 1 ? "provider" : "providers"}`,
    });
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Evaluations</h1>
          <p className="text-muted-foreground text-sm">
            Benchmark models on private datasets and verify every result.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BackendStatus />
          <NewEvaluationDialog onCreate={createEvaluation} />
        </div>
      </div>

      <StatsOverview jobs={jobs} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
        <JobsPanel
          jobs={jobs}
          selectedJobId={selectedJobId}
          onSelectJob={selectJob}
        />
        <section
          ref={detailRef}
          aria-label="Job details"
          className="scroll-mt-20 lg:sticky lg:top-20"
        >
          {selectedJob ? <JobDetail job={selectedJob} /> : null}
        </section>
      </div>
    </main>
  );
}
