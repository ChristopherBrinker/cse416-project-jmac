"use client";

import { Button } from "@cse416-project-jmac/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@cse416-project-jmac/ui/components/dialog";
import { Input } from "@cse416-project-jmac/ui/components/input";
import { Label } from "@cse416-project-jmac/ui/components/label";
import { UploadIcon } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

import { CopyButton } from "./copy-button";
import { useDashboardAction } from "./use-dashboard-action";

export function BenchmarkUploadDialog() {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [benchmarkId, setBenchmarkId] = useState<string | null>(null);
  const { pending, error, run } = useDashboardAction();
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("benchmark");
    const succeeded = await run(async () => {
      if (!(file instanceof File) || file.size === 0) {
        throw new Error("Choose a non-empty benchmark JSON file.");
      }
      try {
        JSON.parse(await file.text());
      } catch {
        throw new Error("The benchmark file must contain valid JSON.");
      }
      const token = await authClient.convex.token();
      if (!token.data?.token) {
        throw new Error(
          "Your session expired. Sign in again to upload a benchmark."
        );
      }
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/benchmark/upload`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token.data.token}`,
          },
          body: file,
        }
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          body &&
            typeof body === "object" &&
            "error" in body &&
            typeof body.error === "string"
            ? body.error
            : "Could not upload the benchmark."
        );
      }
      if (
        !body ||
        typeof body !== "object" ||
        !("benchmarkId" in body) ||
        typeof body.benchmarkId !== "string"
      ) {
        throw new Error("The upload response did not include a benchmark ID.");
      }
      setBenchmarkId(body.benchmarkId);
    }, "Benchmark uploaded. It is ready to select in a new evaluation.");
    if (succeeded) {
      form.reset();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value);
          setBenchmarkId(null);
        }
      }}
    >
      <DialogTrigger
        render={<Button variant="outline" className="rounded-full" />}
      >
        <UploadIcon data-icon="inline-start" />
        Upload benchmark
      </DialogTrigger>
      <DialogContent className="rounded-xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a benchmark</DialogTitle>
          <DialogDescription>
            Upload a JSON benchmark with schema_version 1.0.0, name,
            description, version, and an items array. Each item needs item_id,
            prompt, choices, and a zero-based correct_choice.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={upload} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={fieldId}>Benchmark JSON</Label>
            <Input
              id={fieldId}
              name="benchmark"
              type="file"
              accept="application/json,.json"
              required
              disabled={pending}
            />
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
          {benchmarkId ? (
            <output className="bg-muted block rounded-lg p-3 text-xs">
              <p className="font-medium">Benchmark uploaded</p>
              <p className="mt-1 flex items-center gap-1">
                <span className="min-w-0 font-mono break-all">
                  {benchmarkId}
                </span>
                <CopyButton value={benchmarkId} label="Benchmark ID" />
              </p>
              <p className="text-muted-foreground mt-1">
                Choose it by name in New evaluation.
              </p>
            </output>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Uploading…" : "Upload benchmark"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
