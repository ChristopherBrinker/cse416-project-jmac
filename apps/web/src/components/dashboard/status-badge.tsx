import { Badge } from "@cse416-project-jmac/ui/components/badge";
import { cn } from "@cse416-project-jmac/ui/lib/utils";

const PRESENTATIONS: Record<string, { label: string; className: string }> = {
  created: {
    label: "Awaiting funding",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  funded: {
    label: "Funded",
    className: "border-brand/25 bg-brand/10 text-brand",
  },
  succeeded: {
    label: "Completed",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  failed: {
    label: "Failed",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

export function JobStatusBadge({ status }: { status: string }) {
  const presentation = PRESENTATIONS[status];
  return (
    <Badge variant="outline" className={cn(presentation?.className)}>
      <span className="size-1.5 bg-current" aria-hidden="true" />
      {presentation?.label ?? status}
    </Badge>
  );
}
