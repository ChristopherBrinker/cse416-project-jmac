"use client";

import { api } from "@cse416-project-jmac/backend/convex/_generated/api";
import type { Id } from "@cse416-project-jmac/backend/convex/_generated/dataModel";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@cse416-project-jmac/ui/components/tabs";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { useRef, useState } from "react";

import { describeWalletError } from "@/lib/blockchain";
import type { Benchmark, EvaluationJob } from "@/lib/evaluations";
import { getJobLifecycle } from "@/lib/job-lifecycle";

import { BackendStatus } from "./backend-status";
import { BenchmarkUploadDialog } from "./benchmark-upload-dialog";
import { JobDetail } from "./job-detail";
import { JobsPanel } from "./jobs-panel";
import { NewEvaluationDialog } from "./new-evaluation-dialog";
import { ProvidersPanel } from "./providers-panel";
import { StatsOverview } from "./stats-overview";
import { useBlockchainWallet } from "./use-blockchain-wallet";
import type { BlockchainWalletState } from "./use-blockchain-wallet";
import { useJobActions, useOnChainJob } from "./use-job-actions";
import { WalletDialog, WrongNetworkNotice } from "./wallet-dialog";

const STACKED_LAYOUT_QUERY = "(max-width: 1023px)";

function SelectedJobDetail({
  job,
  walletState,
  actions,
}: {
  job: EvaluationJob;
  walletState: BlockchainWalletState;
  actions: ReturnType<typeof useJobActions>;
}) {
  const chainQuery = useOnChainJob(job._id, job.status);
  const transactions = actions.transactions[job._id];
  const lifecycle = getJobLifecycle({
    convexStatus: job.status,
    chainJob: chainQuery.data,
    fundingTransaction: transactions?.funding,
    refundTransaction: transactions?.refund,
  });
  return (
    <JobDetail
      job={job}
      lifecycle={lifecycle}
      chainJob={chainQuery.data}
      chainError={
        chainQuery.error ? describeWalletError(chainQuery.error) : undefined
      }
      wallet={{
        address: walletState.address,
        ready: walletState.wallet !== undefined,
        wrongNetwork: walletState.wrongNetwork,
      }}
      transactions={transactions}
      busyKind={actions.busy?.jobId === job._id ? actions.busy.kind : undefined}
      actionsBusy={actions.busy !== null}
      error={actions.errors[job._id] || undefined}
      onFund={() => actions.fund(job)}
      onRefund={() => actions.refund(job)}
    />
  );
}

function LiveDashboard() {
  const benchmarks: Benchmark[] | undefined = useQuery(
    api.benchmark.getBenchmarks,
    {}
  );
  const models = useQuery(api.model.getModels, {});
  const { results, status, loadMore } = usePaginatedQuery(
    api.job.getUserJobs,
    {},
    { initialNumItems: 10 }
  );
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [section, setSection] = useState("evaluations");
  const walletState = useBlockchainWallet();
  const actions = useJobActions(walletState.wallet);
  const detailRef = useRef<HTMLElement>(null);
  const jobs: EvaluationJob[] = results.map((job) => ({
    ...job,
    benchmark: benchmarks?.find(
      (benchmark) => benchmark._id === job.benchmarkId
    ),
    model: models?.find((model) => model._id === job.modelId),
  }));
  const selectedJob =
    jobs.find((job) => job._id === selectedJobId) ?? jobs[0] ?? null;

  const selectJob = (jobId: string) => {
    setSelectedJobId(jobId);
    if (window.matchMedia(STACKED_LAYOUT_QUERY).matches) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Evaluations</h1>
          <p className="text-muted-foreground text-sm">
            Benchmark models on private datasets and track every evaluation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WalletDialog
            walletState={walletState}
            busy={actions.busy !== null}
          />
          <BenchmarkUploadDialog />
          <NewEvaluationDialog
            onCreate={(jobId: Id<"jobs">) => {
              setSelectedJobId(jobId);
              setSection("evaluations");
            }}
          />
        </div>
      </div>
      {walletState.wrongNetwork ? (
        <WrongNetworkNotice walletState={walletState} />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackendStatus />
        <p className="text-muted-foreground text-xs">
          Live evaluation data · Totals reflect loaded jobs
        </p>
      </div>
      <StatsOverview jobs={jobs} loading={status === "LoadingFirstPage"} />
      <Tabs value={section} onValueChange={setSection} className="gap-4">
        <TabsList aria-label="Dashboard sections">
          <TabsTrigger value="evaluations">Evaluations</TabsTrigger>
          <TabsTrigger value="providers">My providers</TabsTrigger>
        </TabsList>
        <TabsContent value="evaluations">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
            <JobsPanel
              jobs={jobs}
              selectedJobId={selectedJob?._id ?? null}
              onSelectJob={selectJob}
              loading={status === "LoadingFirstPage"}
              canLoadMore={status === "CanLoadMore"}
              loadingMore={status === "LoadingMore"}
              onLoadMore={() => loadMore(10)}
            />
            <section
              ref={detailRef}
              aria-label="Job details"
              className="min-w-0 scroll-mt-20 lg:sticky lg:top-20"
            >
              {selectedJob ? (
                <SelectedJobDetail
                  key={selectedJob._id}
                  job={selectedJob}
                  walletState={walletState}
                  actions={actions}
                />
              ) : (
                <div className="text-muted-foreground rounded-xl border p-8 text-center text-sm">
                  Select an evaluation to view its details.
                </div>
              )}
            </section>
          </div>
        </TabsContent>
        <TabsContent value="providers">
          <ProvidersPanel models={models ?? []} walletState={walletState} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

export default function DashboardContent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading) {
    return (
      <main className="text-muted-foreground mx-auto w-full max-w-7xl px-4 py-12 text-center">
        <output>Connecting to your evaluations…</output>
      </main>
    );
  }
  if (!isAuthenticated) {
    return (
      <main className="mx-auto w-full max-w-7xl space-y-3 px-4 py-12">
        <h1 className="text-2xl font-semibold">Session unavailable</h1>
        <p className="text-muted-foreground text-sm">
          Your evaluations could not be loaded. Refresh the page or sign in
          again.
        </p>
      </main>
    );
  }
  return <LiveDashboard />;
}
