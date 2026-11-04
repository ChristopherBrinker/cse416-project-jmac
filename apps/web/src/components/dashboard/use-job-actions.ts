"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { WaitForTransactionReceiptTimeoutError } from "viem";
import type { Hash } from "viem";

import {
  describeWalletError,
  getOnChainJob,
  getTransactionOutcome,
  isSameAddress,
  waitForTransactionSuccess,
  writeJobTransaction,
} from "@/lib/blockchain";
import type { BlockchainWallet, OnChainJob } from "@/lib/blockchain";
import type { EvaluationJob } from "@/lib/evaluations";
import {
  getJobLifecycle,
  hasTimedOut,
  isSettledOnChain,
} from "@/lib/job-lifecycle";
import {
  forgetPendingTransaction,
  loadPendingTransactions,
  rememberPendingTransaction,
} from "@/lib/pending-transactions";

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

/**
 * Only jobs that providers or the scheduler can still move need polling:
 * open escrow before its deadline, and completed jobs awaiting claims.
 * Unfunded, failed, and expired jobs change only through the creator's own
 * funding/refund (refreshed explicitly), a Convex status change (part of
 * the query key), or another tab (refetched on window focus).
 */
const needsPolling = (chainJob: OnChainJob | undefined): boolean => {
  if (!chainJob) {
    return true;
  }
  if (chainJob.status === "open") {
    return chainJob.funded && !hasTimedOut(chainJob);
  }
  return chainJob.status === "complete" && !isSettledOnChain(chainJob);
};

export function useOnChainJob(jobId: string | null, convexStatus: string) {
  return useQuery({
    queryKey: [...onChainJobKey(jobId), convexStatus],
    queryFn: () => getOnChainJob(jobId ?? ""),
    enabled: jobId !== null,
    refetchInterval: (query) =>
      needsPolling(query.state.data) ? CHAIN_POLL_INTERVAL_MS : false,
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
    // Update every cached variant (the key also carries the Convex status)
    queryClient.setQueriesData({ queryKey: onChainJobKey(jobId) }, chainJob);
    return chainJob;
  };

  // After a reload, restore submitted-but-unconfirmed transactions and
  // settle any that were mined while the page was closed.
  useEffect(() => {
    let active = true;
    const reconcile = async () => {
      const stored = Object.entries(loadPendingTransactions()).flatMap(
        ([jobId, kinds]) =>
          (["funding", "refund"] as const).flatMap((kind) => {
            const hash = kinds[kind];
            return hash ? [{ jobId, kind, hash }] : [];
          })
      );
      if (!active || stored.length === 0) {
        return;
      }
      setTransactions((current) => {
        const next = { ...current };
        for (const { jobId, kind, hash } of stored) {
          next[jobId] = { ...next[jobId], [kind]: { hash, confirmed: false } };
        }
        return next;
      });
      await Promise.all(
        stored.map(async ({ jobId, kind, hash }) => {
          try {
            const outcome = await getTransactionOutcome(hash);
            if (!active || outcome === "unknown") {
              return;
            }
            forgetPendingTransaction(jobId, kind);
            setTransactions((current) => ({
              ...current,
              [jobId]: {
                ...current[jobId],
                [kind]:
                  outcome === "success" ? { hash, confirmed: true } : undefined,
              },
            }));
            await queryClient.invalidateQueries({
              queryKey: onChainJobKey(jobId),
            });
          } catch {
            // Leave it pending; the action resumes waiting on click
          }
        })
      );
    };
    void reconcile();
    return () => {
      active = false;
    };
  }, [queryClient]);

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
      rememberPendingTransaction(jobId, kind, submittedHash);
      setTransaction(jobId, kind, { hash: submittedHash, confirmed: false });
    }
    let succeeded: boolean;
    try {
      succeeded = await waitForTransactionSuccess(hash);
    } catch (error) {
      if (error instanceof WaitForTransactionReceiptTimeoutError) {
        // Never mined (e.g. dropped, or the chain was reset): allow a retry
        forgetPendingTransaction(jobId, kind);
        setTransaction(jobId, kind, undefined);
        throw new Error(
          "The transaction was not confirmed in time and may have been dropped. Check your wallet's activity, then try again.",
          { cause: error }
        );
      }
      throw error;
    }
    forgetPendingTransaction(jobId, kind);
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
