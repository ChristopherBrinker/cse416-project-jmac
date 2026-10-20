"use client";

import { Button } from "@cse416-project-jmac/ui/components/button";
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
  formatWei,
  matchesFilter,
  truncateHash,
} from "@/lib/evaluations";

import { JobStatusBadge } from "./status-badge";

const FILTERS: readonly { value: JobFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "created", label: "Funding" },
  { value: "active", label: "Active" },
  { value: "succeeded", label: "Completed" },
  { value: "failed", label: "Failed" },
];
const isJobFilter = (value: unknown): value is JobFilter =>
  FILTERS.some((filter) => filter.value === value);

interface JobsPanelProps {
  jobs: EvaluationJob[];
  selectedJobId: string | null;
  onSelectJob: (jobId: string) => void;
  loading: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function JobsPanel({
  jobs,
  selectedJobId,
  onSelectJob,
  loading,
  canLoadMore,
  loadingMore,
  onLoadMore,
}: JobsPanelProps) {
  const [filter, setFilter] = useState<JobFilter>("all");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleJobs = jobs.filter(
    (job) =>
      matchesFilter(job, filter) &&
      [
        job._id,
        job.benchmarkId,
        job.modelId,
        job.benchmark?.name,
        job.model?.name,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
  );

  return (
    <Card className="min-w-0 gap-0 rounded-xl pb-0">
      <CardHeader className="gap-3 border-b pb-4">
        <div className="space-y-1">
          <CardTitle>Evaluation jobs</CardTitle>
          <CardDescription>
            Select a job to view its status, score, and funding details.
          </CardDescription>
        </div>
        <div className="min-w-0 overflow-x-auto">
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
        </div>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search jobs"
            placeholder="Search loaded jobs, models, benchmarks…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
      </CardHeader>
      {loading ? (
        <output className="text-muted-foreground px-4 py-12 text-center">
          Loading evaluations…
        </output>
      ) : null}
      {!loading && visibleJobs.length === 0 ? (
        <Empty className="py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>
              {jobs.length === 0 ? "No evaluations yet" : "No matching jobs"}
            </EmptyTitle>
            <EmptyDescription>
              {jobs.length === 0
                ? "Upload a benchmark and create your first evaluation."
                : "Try another filter or search term, or load more jobs."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {visibleJobs.length > 0 ? (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Evaluation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead className="pr-4">Funding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleJobs.map((job) => {
                  const selected = job._id === selectedJobId;
                  return (
                    <TableRow
                      key={job._id}
                      data-state={selected ? "selected" : undefined}
                      className={cn(
                        "relative cursor-pointer",
                        selected && "shadow-[inset_2px_0_0_var(--brand)]"
                      )}
                    >
                      <TableCell className="max-w-0 min-w-40 py-3 pl-4">
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => onSelectJob(job._id)}
                          className="focus-visible:after:ring-ring/50 block w-full text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset"
                        >
                          <span className="block truncate font-medium">
                            {job.model?.name ?? truncateHash(job.modelId)}
                          </span>
                          <span className="text-muted-foreground block truncate">
                            {job.benchmark?.name ?? job.benchmarkId}
                          </span>
                          <span className="text-muted-foreground block truncate font-mono">
                            {truncateHash(job._id)}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {job.score ?? "—"}
                      </TableCell>
                      <TableCell className="pr-4 whitespace-nowrap tabular-nums">
                        {formatWei(job.price)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <ul className="divide-y md:hidden">
            {visibleJobs.map((job) => (
              <li key={job._id}>
                <button
                  type="button"
                  aria-pressed={job._id === selectedJobId}
                  onClick={() => onSelectJob(job._id)}
                  className={cn(
                    "hover:bg-muted/50 focus-visible:bg-muted/50 flex w-full flex-col gap-2 px-4 py-3 text-left text-xs outline-none",
                    job._id === selectedJobId &&
                      "bg-muted shadow-[inset_2px_0_0_var(--brand)]"
                  )}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {job.model?.name ?? truncateHash(job.modelId)}
                      </span>
                      <span className="text-muted-foreground block truncate">
                        {job.benchmark?.name ?? job.benchmarkId}
                      </span>
                    </span>
                    <JobStatusBadge status={job.status} />
                  </span>
                  <span className="text-muted-foreground flex flex-wrap justify-between gap-2">
                    <span>
                      {formatWei(job.price)} · Score {job.score ?? "—"}
                    </span>
                    <span>{formatDateTime(job._creationTime)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4">
        <p className="text-muted-foreground text-xs">
          {jobs.length} jobs loaded · Filters and totals use loaded jobs.
        </p>
        {canLoadMore || loadingMore ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more jobs"}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
