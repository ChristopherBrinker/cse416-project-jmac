"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  getOnChainJob,
  isSameAddress,
  waitForTransactionSuccess,
  writeJobTransaction,
} from "@/lib/blockchain";
import type { BlockchainWallet, OnChainJob } from "@/lib/blockchain";
import { getErrorMessage } from "@/lib/evaluations";

import type { JobTransaction, RefundState } from "./job-detail";

const deriveRefundStatus = (
  chainJob: OnChainJob | undefined,
  checkError: string | undefined
): RefundState["status"] => {
  if (!chainJob) {
    return checkError ? "error" : "checking";
  }
  if (chainJob.status === "refunded") {
    return "refunded";
  }
  if (!chainJob.funded || chainJob.status === "complete") {
    return "unavailable";
  }
  return "refundable";
};

type RefundCheck = { chainJob: OnChainJob } | { error: string };

const fetchRefundCheck = async (jobId: string): Promise<RefundCheck> => {
  try {
    return { chainJob: await getOnChainJob(jobId) };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
};

/**
 * Tracks on-chain refund state for failed jobs and calls the contract's
 * `refund` function from the connected wallet. Only the wallet that funded
 * the job can refund it.
 */
export function useJobRefund(
  wallet: BlockchainWallet | undefined,
  failedJobId: string | null
) {
  const [chainJobs, setChainJobs] = useState<Record<string, OnChainJob>>({});
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});
  const [transactions, setTransactions] = useState<
    Record<string, JobTransaction | undefined>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refundingJobId, setRefundingJobId] = useState<string | null>(null);
  const refundLock = useRef(false);

  const applyCheck = (jobId: string, result: RefundCheck) => {
    if ("chainJob" in result) {
      setChainJobs((current) => ({ ...current, [jobId]: result.chainJob }));
    }
    setCheckErrors((current) => ({
      ...current,
      [jobId]: "error" in result ? result.error : "",
    }));
  };

  useEffect(() => {
    if (!failedJobId) {
      return;
    }
    let active = true;
    const checkRefund = async () => {
      const result = await fetchRefundCheck(failedJobId);
      if (!active) {
        return;
      }
      if ("chainJob" in result) {
        const { chainJob } = result;
        setChainJobs((current) => ({ ...current, [failedJobId]: chainJob }));
      }
      setCheckErrors((current) => ({
        ...current,
        [failedJobId]: "error" in result ? result.error : "",
      }));
    };
    void checkRefund();
    return () => {
      active = false;
    };
  }, [failedJobId]);

  const recordError = (jobId: string, message: string) => {
    setErrors((current) => ({ ...current, [jobId]: message }));
    toast.error(message);
  };

  const submitRefund = async (
    jobId: string,
    refundWallet: BlockchainWallet
  ) => {
    const chainJob = await getOnChainJob(jobId);
    setChainJobs((current) => ({ ...current, [jobId]: chainJob }));
    if (chainJob.status === "refunded") {
      toast.info("This job has already been refunded.");
      return;
    }
    if (!isSameAddress(chainJob.creator, refundWallet.address)) {
      throw new Error(
        `Only the wallet that funded this job (${chainJob.creator}) can refund it.`
      );
    }
    let hash = transactions[jobId]?.hash;
    if (!hash) {
      const submittedHash = await writeJobTransaction(
        refundWallet,
        "refund",
        jobId
      );
      hash = submittedHash;
      setTransactions((current) => ({
        ...current,
        [jobId]: { hash: submittedHash, confirmed: false },
      }));
    }
    const succeeded = await waitForTransactionSuccess(hash);
    if (!succeeded) {
      setTransactions((current) => ({ ...current, [jobId]: undefined }));
      recordError(jobId, "The refund transaction reverted. You can try again.");
      return;
    }
    setTransactions((current) => ({
      ...current,
      [jobId]: { hash, confirmed: true },
    }));
    setChainJobs((current) => ({
      ...current,
      [jobId]: { ...chainJob, status: "refunded" },
    }));
    toast.success(
      "Refund confirmed. The job price was returned to your wallet."
    );
  };

  const refund = async (jobId: string) => {
    if (refundLock.current) {
      return;
    }
    if (deriveRefundStatus(chainJobs[jobId], checkErrors[jobId]) === "error") {
      setCheckErrors((current) => ({ ...current, [jobId]: "" }));
      applyCheck(jobId, await fetchRefundCheck(jobId));
      return;
    }
    if (!wallet) {
      return;
    }
    refundLock.current = true;
    setRefundingJobId(jobId);
    setErrors((current) => ({ ...current, [jobId]: "" }));
    try {
      await submitRefund(jobId, wallet);
    } catch (error) {
      recordError(jobId, getErrorMessage(error));
    }
    refundLock.current = false;
    setRefundingJobId(null);
  };

  const getRefundState = (jobId: string): RefundState => {
    const chainJob = chainJobs[jobId];
    return {
      status: deriveRefundStatus(chainJob, checkErrors[jobId]),
      creator: chainJob?.creator,
      transaction: transactions[jobId],
      error: errors[jobId] || checkErrors[jobId] || undefined,
    };
  };

  return { refundingJobId, getRefundState, refund };
}
