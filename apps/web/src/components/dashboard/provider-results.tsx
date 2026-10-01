import { Badge } from "@cse416-project-jmac/ui/components/badge";

import type { EvaluationJob, ProviderResult } from "@/lib/evaluations";
import {
  formatCount,
  formatCurrency,
  formatLatency,
  formatScore,
  getTopResult,
} from "@/lib/evaluations";

import { ProviderStatusBadge } from "./status-badge";

const byScoreDescending = (a: ProviderResult, b: ProviderResult): number =>
  (b.score ?? -1) - (a.score ?? -1);

export function ProviderResults({ job }: { job: EvaluationJob }) {
  const top = getTopResult(job);
  const results = job.providers.toSorted(byScoreDescending);

  return (
    <ul className="divide-y border">
      {results.map((result) => (
        <li key={result.id} className="space-y-2 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-medium">
                {result.provider}
                {top?.id === result.id ? (
                  <Badge
                    variant="outline"
                    className="border-brand/30 text-brand h-4 px-1 text-[10px]"
                  >
                    Top
                  </Badge>
                ) : null}
              </p>
              <p className="text-muted-foreground truncate font-mono">
                {result.model}
              </p>
            </div>
            <ProviderStatusBadge status={result.status} />
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-muted relative h-1.5 flex-1 overflow-hidden">
              <div
                className="bg-brand absolute inset-y-0 left-0"
                style={{ width: `${result.score ?? 0}%` }}
              />
            </div>
            <span className="w-10 text-right text-sm font-semibold tabular-nums">
              {result.score === null ? "—" : formatScore(result.score)}
            </span>
          </div>

          <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            <div className="flex gap-1">
              <dt>p50</dt>
              <dd className="text-foreground tabular-nums">
                {result.p50LatencyMs === null
                  ? "—"
                  : formatLatency(result.p50LatencyMs)}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Cost</dt>
              <dd className="text-foreground tabular-nums">
                {formatCurrency(result.costUsd)}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Samples</dt>
              <dd className="text-foreground tabular-nums">
                {formatCount(result.samplesCompleted)} /{" "}
                {formatCount(job.benchmark.samples)}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
