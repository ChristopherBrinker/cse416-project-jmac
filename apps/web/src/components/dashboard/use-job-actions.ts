"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { Hash } from "viem";

import {
  describeWalletError,
  getOnChainJob,
  isSameAddress,
  waitForTransactionSuccess,
  writeJobTransaction,
} from "@/lib/blockchain";
import type { BlockchainWallet, OnChainJob } from "@/lib/blockchain";
import type { EvaluationJob } from "@/lib/evaluations";
import { getJobLifecycle, isSettledOnChain } from "@/lib/job-lifecycle";

const CHAIN_POLL_INTERVAL_MS = 4000;

export interface JobTransaction {
  hash: Hash;
  confirmed: boolean;
}

export interface JobTransactions {
  funding?: JobTransaction;
  refund?: JobTransaction;
}

type TransactionKind = keyof JobTransactions;

const onChainJobKey = (jobId: string | null) => ["onChainJob", jobId] as const;

/** Polls the contract for a job until its on-chain state is final. */
export function useOnChainJob(jobId: string | null) {
  return useQuery({
    queryKey: onChainJobKey(jobId),
    queryFn: () => getOnChainJob(jobId ?? ""),
    enabled: jobId !== null,
    refetchInterval: (query) =>
      isSettledOnChain(query.state.data) ? false : CHAIN_POLL_INTERVAL_MS,
    retry: 1,
  });
}

const ensureRefundable = (
  job: EvaluationJob,
  chainJob: OnChainJob,
  wallet: BlockchainWallet
) => {
  const { refundAvailable } = getJobLifecycle({
    convexStatus: job.status,
    chainJob,
  });
  if (chainJob.status === "refunded") {
    throw new Error("This job has already been refunded.");
  }
  if (!refundAvailable) {
    throw new Error(
      "This job is not refundable yet. Refunds open after a provider disagreement or once the evaluation deadline passes."
    );
  }
  if (!isSameAddress(chainJob.creator, wallet.address)) {
    throw new Error(
      `Only the wallet that funded this job (${chainJob.creator}) can refund it. Switch to that account in your wallet.`
    );
  }
};

/**
 * Creator-signed funding and refund transactions. Each action re-reads the
 * contract first, simulates the call so reverts appear before the wallet
 * prompt, and only records success after the receipt confirms it.
 */
export function useJobActions(wallet: BlockchainWallet | undefined) {
  const queryClient = useQueryClient();
  const [transactions, setTransactions] = useState<
    Record<string, JobTransactions>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<{
    jobId: string;
    kind: TransactionKind;
  } | null>(null);
  const lock = useRef(false);

  const setTransaction = (
    jobId: string,
    kind: TransactionKind,
    transaction: JobTransaction | undefined
  ) =>
    setTransactions((current) => ({
      ...current,
      [jobId]: { ...current[jobId], [kind]: transaction },
    }));

  const refreshChainJob = async (jobId: string): Promise<OnChainJob> => {
    const chainJob = await getOnChainJob(jobId);
    queryClient.setQueryData(onChainJobKey(jobId), chainJob);
    return chainJob;
  };

  const submit = async (
    jobId: string,
    kind: TransactionKind,
    send: () => Promise<Hash>
  ): Promise<boolean> => {
    // Resume waiting on a submitted transaction instead of sending another
    let hash = transactions[jobId]?.[kind]?.hash;
    if (!hash) {
      const submittedHash = await send();
      hash = submittedHash;
      setTransaction(jobId, kind, { hash: submittedHash, confirmed: false });
    }
    const succeeded = await waitForTransactionSuccess(hash);
    setTransaction(
      jobId,
      kind,
      succeeded ? { hash, confirmed: true } : undefined
    );
    await refreshChainJob(jobId);
    return succeeded;
  };

  const run = async (
    jobId: string,
    kind: TransactionKind,
    action: (activeWallet: BlockchainWallet) => Promise<void>
  ) => {
    if (lock.current) {
      return;
    }
    if (!wallet) {
      toast.error("Connect your wallet on the supported network first.");
      return;
    }
    lock.current = true;
    setBusy({ jobId, kind });
    setErrors((current) => ({ ...current, [jobId]: "" }));
    try {
      await action(wallet);
    } catch (error) {
      const message = describeWalletError(error);
      setErrors((current) => ({ ...current, [jobId]: message }));
      toast.error(message);
    }
    lock.current = false;
    setBusy(null);
  };

  const fund = (job: EvaluationJob) =>
    run(job._id, "funding", async (activeWallet) => {
      const chainJob = await refreshChainJob(job._id);
      if (chainJob.funded) {
        toast.info(
          "This job is already funded on-chain. Waiting for the scheduler to assign providers."
        );
        return;
      }
      const succeeded = await submit(job._id, "funding", () =>
        writeJobTransaction(activeWallet, "fundJob", job._id, job.price)
      );
      if (!succeeded) {
        throw new Error("The funding transaction reverted. You can try again.");
      }
      toast.success(
        "Funding confirmed. Waiting for the scheduler to assign providers."
      );
    });

  const refund = (job: EvaluationJob) =>
    run(job._id, "refund", async (activeWallet) => {
      const chainJob = await refreshChainJob(job._id);
      ensureRefundable(job, chainJob, activeWallet);
      const succeeded = await submit(job._id, "refund", () =>
        writeJobTransaction(activeWallet, "refund", job._id)
      );
      if (!succeeded) {
        throw new Error(
          "The refund transaction reverted, so no funds moved. You can try again."
        );
      }
      toast.success(
        "Refund confirmed. The job price was returned to your wallet."
      );
    });

  return {
    transactions,
    errors,
    busy,
    fund,
    refund,
  };
}
