import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@cse416-project-jmac/ui/components/empty";
import { FileClockIcon, FileXIcon, ReceiptTextIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { EvaluationJob, Receipt } from "@/lib/evaluations";
import {
  formatCount,
  formatDateTime,
  isActiveJob,
  truncateHash,
} from "@/lib/evaluations";

import { CopyButton } from "./copy-button";
import { ReceiptStatusBadge } from "./status-badge";

function ReceiptRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">{children}</dd>
    </div>
  );
}

function HashValue({ value, label }: { value: string; label: string }) {
  return (
    <>
      <span className="truncate font-mono" title={value}>
        {truncateHash(value)}
      </span>
      <CopyButton value={value} label={label} />
    </>
  );
}

function ReceiptDetails({ receipt }: { receipt: Receipt }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground font-mono">{receipt.id}</p>
        <ReceiptStatusBadge status={receipt.status} />
      </div>
      <dl className="divide-y border">
        <ReceiptRow label="Result digest">
          <HashValue value={receipt.resultDigest} label="Result digest" />
        </ReceiptRow>
        <ReceiptRow label="Signed by">
          <span className="truncate">{receipt.signer}</span>
        </ReceiptRow>
        <ReceiptRow label="Network">{receipt.network}</ReceiptRow>
        <ReceiptRow label="Transaction">
          {receipt.txHash ? (
            <HashValue value={receipt.txHash} label="Transaction hash" />
          ) : (
            <span className="text-muted-foreground">Awaiting anchoring</span>
          )}
        </ReceiptRow>
        <ReceiptRow label="Block">
          <span className="tabular-nums">
            {receipt.blockNumber === null
              ? "—"
              : formatCount(receipt.blockNumber)}
          </span>
        </ReceiptRow>
        <ReceiptRow label="Issued">
          <time dateTime={receipt.issuedAt}>
            {formatDateTime(receipt.issuedAt)}
          </time>
        </ReceiptRow>
      </dl>
      <p className="text-muted-foreground">
        The digest commits to every graded response and score. Anyone holding
        the raw results can recompute it and compare against the anchored value.
      </p>
    </div>
  );
}

function MissingReceipt({ job }: { job: EvaluationJob }) {
  let icon = <FileClockIcon />;
  let title = "Receipt pending";
  let description =
    "A signed receipt is issued once every provider finishes grading.";

  if (!job.issueReceipt) {
    icon = <ReceiptTextIcon />;
    title = "Receipts disabled";
    description = "This run was started without receipt issuance.";
  } else if (!isActiveJob(job)) {
    icon = <FileXIcon />;
    title = "No receipt issued";
    description =
      "Receipts are only issued for runs that complete successfully.";
  }

  return (
    <Empty className="border py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription className="text-xs/relaxed">
          {description}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function ReceiptPanel({ job }: { job: EvaluationJob }) {
  return job.receipt ? (
    <ReceiptDetails receipt={job.receipt} />
  ) : (
    <MissingReceipt job={job} />
  );
}
