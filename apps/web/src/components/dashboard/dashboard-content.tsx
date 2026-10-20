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
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { contractAddress, getJobFundingStatus } from "@/lib/blockchain";
import type { BlockchainClient } from "@/lib/blockchain";
import type { Benchmark, EvaluationJob } from "@/lib/evaluations";
import { getErrorMessage } from "@/lib/evaluations";

import { BackendStatus } from "./backend-status";
import { BenchmarkUploadDialog } from "./benchmark-upload-dialog";
import { JobDetail } from "./job-detail";
import type { FundingStatus, FundingTransaction } from "./job-detail";
import { JobsPanel } from "./jobs-panel";
import { NewEvaluationDialog } from "./new-evaluation-dialog";
import { ProvidersPanel } from "./providers-panel";
import { StatsOverview } from "./stats-overview";
import { WalletDialog } from "./wallet-dialog";

const STACKED_LAYOUT_QUERY = "(max-width: 1023px)";

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
  const [blockchainClient, setBlockchainClient] = useState<BlockchainClient>();
  const [fundingJobId, setFundingJobId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<
    Record<string, FundingTransaction | undefined>
  >({});
  const [fundingErrors, setFundingErrors] = useState<Record<string, string>>(
    {}
  );
  const [fundingStatuses, setFundingStatuses] = useState<
    Record<string, FundingStatus>
  >({});
  const fundingLock = useRef(false);
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
  const createdJobId =
    selectedJob?.status === "created" ? selectedJob._id : null;

  useEffect(() => {
    if (!createdJobId) {
      return;
    }
    let active = true;
    const checkFunding = async () => {
      try {
        const funded = await getJobFundingStatus(createdJobId);
        if (active) {
          setFundingStatuses((current) => ({
            ...current,
            [createdJobId]: funded ? "funded" : "unfunded",
          }));
          setFundingErrors((current) => ({ ...current, [createdJobId]: "" }));
        }
      } catch (error) {
        if (active) {
          setFundingStatuses((current) => ({
            ...current,
            [createdJobId]: "error",
          }));
          setFundingErrors((current) => ({
            ...current,
            [createdJobId]: getErrorMessage(error),
          }));
        }
      }
    };
    void checkFunding();
    return () => {
      active = false;
    };
  }, [createdJobId]);

  const selectJob = (jobId: string) => {
    setSelectedJobId(jobId);
    if (window.matchMedia(STACKED_LAYOUT_QUERY).matches) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  const fundJob = async (job: EvaluationJob) => {
    if (
      fundingLock.current ||
      job.status !== "created" ||
      transactions[job._id]?.confirmed ||
      fundingStatuses[job._id] === "funded"
    ) {
      return;
    }
    fundingLock.current = true;
    setFundingJobId(job._id);
    setFundingErrors((current) => ({ ...current, [job._id]: "" }));
    try {
      const funded = await getJobFundingStatus(job._id);
      setFundingStatuses((current) => ({
        ...current,
        [job._id]: funded ? "funded" : "unfunded",
      }));
      if (funded) {
        toast.info(
          "This job is already funded on-chain. Waiting for the scheduler to update it."
        );
      } else if (blockchainClient && fundingStatuses[job._id] === "unfunded") {
        let hash = transactions[job._id]?.hash;
        if (!hash) {
          const { request } =
            await blockchainClient.publicClient.simulateContract({
              account: blockchainClient.account,
              address: contractAddress,
              abi: blockchainClient.abi,
              functionName: "fundJob",
              args: [String(job._id)],
              value: job.price,
            });
          const submittedHash =
            await blockchainClient.walletClient.writeContract(request);
          hash = submittedHash;
          setTransactions((current) => ({
            ...current,
            [job._id]: { hash: submittedHash, confirmed: false },
          }));
        }
        const receipt =
          await blockchainClient.publicClient.waitForTransactionReceipt({
            hash,
          });
        if (receipt.status === "success") {
          setFundingStatuses((current) => ({
            ...current,
            [job._id]: "funded",
          }));
          setTransactions((current) => ({
            ...current,
            [job._id]: { hash, confirmed: true },
          }));
          toast.success(
            "Funding confirmed. Waiting for the scheduler to update the job."
          );
        } else {
          const message =
            "The funding transaction reverted. You can try again.";
          setTransactions((current) => ({ ...current, [job._id]: undefined }));
          setFundingErrors((current) => ({ ...current, [job._id]: message }));
          toast.error(message);
        }
      }
    } catch (error) {
      const message = getErrorMessage(error);
      setFundingErrors((current) => ({ ...current, [job._id]: message }));
      toast.error(message);
    }
    fundingLock.current = false;
    setFundingJobId(null);
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
            client={blockchainClient}
            onConnect={setBlockchainClient}
            onDisconnect={() => setBlockchainClient(undefined)}
            busy={fundingJobId !== null}
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
                <JobDetail
                  job={selectedJob}
                  walletConnected={Boolean(blockchainClient)}
                  funding={fundingJobId === selectedJob._id}
                  fundingBusy={fundingJobId !== null}
                  fundingStatus={fundingStatuses[selectedJob._id] ?? "checking"}
                  transaction={transactions[selectedJob._id]}
                  error={fundingErrors[selectedJob._id]}
                  onFund={() => fundJob(selectedJob)}
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
          <ProvidersPanel models={models ?? []} />
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
