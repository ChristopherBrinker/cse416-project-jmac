"use client";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cse416-project-jmac/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@cse416-project-jmac/ui/components/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@cse416-project-jmac/ui/components/input-group";
import { Progress } from "@cse416-project-jmac/ui/components/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@cse416-project-jmac/ui/components/table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@cse416-project-jmac/ui/components/tabs";
import { cn } from "@cse416-project-jmac/ui/lib/utils";
import { SearchIcon, SearchXIcon } from "lucide-react";
import { useState } from "react";

import type { EvaluationJob, JobFilter } from "@/lib/evaluations";
import {
  formatDateTime,
  formatScore,
  getJobProgress,
  getTopResult,
  matchesFilter,
} from "@/lib/evaluations";

import { JobStatusBadge } from "./status-badge";

const FILTERS: readonly { value: JobFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

const PERCENT = 100;

const isJobFilter = (value: unknown): value is JobFilter =>
  FILTERS.some((filter) => filter.value === value);

const matchesQuery = (job: EvaluationJob, query: string): boolean => {
  if (query === "") {
    return true;
  }
  const haystack = [
    job.name,
    job.id,
    job.benchmark.name,
    job.createdBy,
    ...job.providers.map((result) => `${result.provider} ${result.model}`),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
};

interface JobsPanelProps {
  jobs: EvaluationJob[];
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
}

function JobProgress({ job }: { job: EvaluationJob }) {
  const percent = Math.round(getJobProgress(job) * PERCENT);
  return (
    <div className="flex items-center gap-2">
      <Progress
        value={percent}
        aria-label={`${job.name} progress`}
        className="[&_[data-slot=progress-indicator]]:bg-brand w-20"
      />
      <span className="text-muted-foreground w-8 text-right tabular-nums">
        {percent}%
      </span>
    </div>
  );
}

function TopScore({ job }: { job: EvaluationJob }) {
  const top = getTopResult(job);
  if (!top) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-col">
      <span className="font-medium tabular-nums">{formatScore(top.score)}</span>
      <span className="text-muted-foreground">{top.model}</span>
    </div>
  );
}

function JobsTable({ jobs, selectedJobId, onSelectJob }: JobsPanelProps) {
  return (
    <div className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Evaluation</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead>Top score</TableHead>
            <TableHead className="hidden pr-4 xl:table-cell">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => {
            const isSelected = job.id === selectedJobId;
            return (
              <TableRow
                key={job.id}
                data-state={isSelected ? "selected" : undefined}
                className={cn(
                  "relative cursor-pointer",
                  isSelected && "shadow-[inset_2px_0_0_var(--brand)]"
                )}
              >
                <TableCell className="max-w-0 min-w-56 py-3 pl-4">
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelectJob(job.id)}
                    className="focus-visible:after:ring-ring/50 block w-full text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset"
                  >
                    <span
                      className="block truncate font-medium"
                      title={job.name}
                    >
                      {job.name}
                    </span>
                    <span className="text-muted-foreground block truncate">
                      <span className="font-mono">{job.id}</span> ·{" "}
                      {job.benchmark.name}
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  <JobStatusBadge status={job.status} />
                </TableCell>
                <TableCell>
                  <JobProgress job={job} />
                </TableCell>
                <TableCell>
                  <TopScore job={job} />
                </TableCell>
                <TableCell className="text-muted-foreground hidden pr-4 xl:table-cell">
                  {formatDateTime(job.createdAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function JobsList({ jobs, selectedJobId, onSelectJob }: JobsPanelProps) {
  return (
    <ul className="divide-y md:hidden">
      {jobs.map((job) => {
        const isSelected = job.id === selectedJobId;
        const top = getTopResult(job);
        const percent = Math.round(getJobProgress(job) * PERCENT);
        return (
          <li key={job.id}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelectJob(job.id)}
              className={cn(
                "hover:bg-muted/50 focus-visible:bg-muted/50 flex w-full flex-col gap-2 px-4 py-3 text-left text-xs transition-colors outline-none",
                isSelected && "bg-muted shadow-[inset_2px_0_0_var(--brand)]"
              )}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{job.name}</span>
                  <span className="text-muted-foreground block truncate">
                    {job.benchmark.name}
                  </span>
                </span>
                <JobStatusBadge status={job.status} />
              </span>
              <span className="text-muted-foreground flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    className="bg-muted relative h-1 w-20 overflow-hidden"
                    aria-hidden="true"
                  >
                    <span
                      className="bg-brand absolute inset-y-0 left-0"
                      style={{ width: `${percent}%` }}
                    />
                  </span>
                  <span className="tabular-nums">{percent}% complete</span>
                </span>
                <span className="tabular-nums">
                  {top ? `Top ${formatScore(top.score)}` : "No score yet"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function JobsPanel({
  jobs,
  selectedJobId,
  onSelectJob,
}: JobsPanelProps) {
  const [filter, setFilter] = useState<JobFilter>("all");
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const visibleJobs = jobs.filter(
    (job) => matchesFilter(job, filter) && matchesQuery(job, normalizedQuery)
  );

  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="gap-3 border-b pb-4">
        <div className="space-y-1">
          <CardTitle>Evaluation jobs</CardTitle>
          <CardDescription>
            Select a job to inspect provider results, recovery, and receipts.
          </CardDescription>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={filter}
            onValueChange={(value) => {
              if (isJobFilter(value)) {
                setFilter(value);
              }
            }}
          >
            <TabsList aria-label="Filter jobs by status">
              {FILTERS.map(({ value, label }) => (
                <TabsTrigger key={value} value={value} className="px-2.5">
                  {label}
                  <span className="text-muted-foreground tabular-nums">
                    {jobs.filter((job) => matchesFilter(job, value)).length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <InputGroup className="sm:max-w-64">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Search jobs"
              placeholder="Search jobs, models, benchmarks…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
        </div>
      </CardHeader>

      {visibleJobs.length === 0 ? (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>No matching jobs</EmptyTitle>
            <EmptyDescription>
              Try a different status filter or search term.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <JobsTable
            jobs={visibleJobs}
            selectedJobId={selectedJobId}
            onSelectJob={onSelectJob}
          />
          <JobsList
            jobs={visibleJobs}
            selectedJobId={selectedJobId}
            onSelectJob={onSelectJob}
          />
        </>
      )}
    </Card>
  );
}
