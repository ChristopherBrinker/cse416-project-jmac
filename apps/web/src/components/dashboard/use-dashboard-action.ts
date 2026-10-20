"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/evaluations";

export function useDashboardAction() {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (
    action: () => Promise<void>,
    successMessage: string
  ): Promise<boolean> => {
    if (inFlight.current) {
      return false;
    }
    inFlight.current = true;
    setPending(true);
    setActionError(null);
    let succeeded = false;
    try {
      await action();
      toast.success(successMessage);
      succeeded = true;
    } catch (error) {
      const message = getErrorMessage(error);
      setActionError(message);
      toast.error(message);
    }
    inFlight.current = false;
    setPending(false);
    return succeeded;
  };
  return { pending, error: actionError, run };
}
