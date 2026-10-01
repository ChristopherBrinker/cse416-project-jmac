"use client";

import { Button } from "@cse416-project-jmac/ui/components/button";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";

interface CopyButtonProps {
  value: string;
  label: string;
}

export function CopyButton({ value, label }: CopyButtonProps) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Copy ${label.toLowerCase()}`}
      onClick={copy}
    >
      <CopyIcon />
    </Button>
  );
}
