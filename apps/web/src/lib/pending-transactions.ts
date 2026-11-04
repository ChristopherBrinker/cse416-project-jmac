import type { Hash } from "viem";

import { contractAddress } from "./blockchain";

/**
 * Remembers submitted-but-unconfirmed funding/refund hashes per job so a
 * page reload resumes waiting on them instead of offering a second
 * submission. Browser storage can be unavailable (private mode, blocked
 * site data), so every access is best-effort.
 */
export type PendingKind = "funding" | "refund";
export type PendingTransactions = Record<
  string,
  Partial<Record<PendingKind, Hash>>
>;

const storageKey = () => `jmac:pending-tx:${contractAddress}`;

export const loadPendingTransactions = (): PendingTransactions => {
  try {
    const raw = window.localStorage.getItem(storageKey());
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null
      ? (parsed as PendingTransactions)
      : {};
  } catch {
    return {};
  }
};

const save = (pending: PendingTransactions) => {
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(pending));
  } catch {
    // Best-effort only; the in-memory state still guards this session
  }
};

export const rememberPendingTransaction = (
  jobId: string,
  kind: PendingKind,
  hash: Hash
) => {
  const pending = loadPendingTransactions();
  save({ ...pending, [jobId]: { ...pending[jobId], [kind]: hash } });
};

export const forgetPendingTransaction = (jobId: string, kind: PendingKind) => {
  const pending = loadPendingTransactions();
  const { [kind]: _removed, ...rest } = pending[jobId] ?? {};
  save({ ...pending, [jobId]: rest });
};
