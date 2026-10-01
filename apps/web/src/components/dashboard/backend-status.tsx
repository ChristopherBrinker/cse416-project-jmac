"use client";

import { api } from "@cse416-project-jmac/backend/convex/_generated/api";
import { cn } from "@cse416-project-jmac/ui/lib/utils";
import { useConvexAuth, useQuery } from "convex/react";

type ConnectionState = "connecting" | "loading" | "connected" | "failed";

const STATE_STYLES: Record<ConnectionState, { label: string; dot: string }> = {
  connecting: { label: "Connecting…", dot: "bg-muted-foreground/60" },
  loading: { label: "Loading backend…", dot: "bg-amber-500" },
  connected: { label: "Backend connected", dot: "bg-emerald-500" },
  failed: { label: "Backend auth failed", dot: "bg-destructive" },
};

export function BackendStatus() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const privateData = useQuery(
    api.privateData.get,
    isAuthenticated ? {} : "skip"
  );

  let state: ConnectionState = "failed";
  let message =
    "Convex authentication failed. Check the Better Auth integration configuration.";
  if (isLoading) {
    state = "connecting";
    message = "Connecting authentication…";
  } else if (isAuthenticated && privateData) {
    state = "connected";
    ({ message } = privateData);
  } else if (isAuthenticated) {
    state = "loading";
    message = "Loading private data…";
  }

  const { label, dot } = STATE_STYLES[state];

  return (
    <output
      aria-live="polite"
      title={`Convex: ${message}`}
      className="text-muted-foreground inline-flex h-9 items-center gap-2 border px-2.5 text-xs"
    >
      <span className={cn("size-1.5 shrink-0", dot)} aria-hidden="true" />
      {label}
      <span className="sr-only">. {message}</span>
    </output>
  );
}
