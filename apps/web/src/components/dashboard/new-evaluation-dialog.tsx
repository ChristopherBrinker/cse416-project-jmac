"use client";

import { api } from "@cse416-project-jmac/backend/convex/_generated/api";
import type { Id } from "@cse416-project-jmac/backend/convex/_generated/dataModel";
import { Button } from "@cse416-project-jmac/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@cse416-project-jmac/ui/components/dialog";
import { Input } from "@cse416-project-jmac/ui/components/input";
import { Label } from "@cse416-project-jmac/ui/components/label";
import { useMutation, useQuery } from "convex/react";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import type { Benchmark, Model } from "@/lib/evaluations";
import { truncateHash } from "@/lib/evaluations";

import { useDashboardAction } from "./use-dashboard-action";

interface SelectionProps {
  group: string;
  checked: boolean;
  onSelect: () => void;
}

function BenchmarkOption({
  item,
  group,
  checked,
  onSelect,
}: SelectionProps & { item: Benchmark }) {
  return (
    <label
      aria-label={item.name}
      className="hover:bg-muted/60 has-checked:bg-muted flex cursor-pointer items-start gap-3 rounded-md p-2 text-xs"
    >
      <input
        type="radio"
        name={group}
        value={item._id}
        checked={checked}
        onChange={onSelect}
        className="accent-brand mt-0.5"
      />
      <span className="min-w-0 space-y-1">
        <span className="block font-medium">
          {item.name} v{item.version}
        </span>
        <span className="text-muted-foreground block">
          By {item.ownerName} · {item.description}
        </span>
        <span
          className="text-muted-foreground block font-mono break-all"
          title={item.contentHash}
        >
          SHA-256: {truncateHash(item.contentHash)}
        </span>
        <span className="text-muted-foreground block font-mono break-all">
          {item._id}
        </span>
      </span>
    </label>
  );
}

function ModelOption({
  item,
  group,
  checked,
  onSelect,
}: SelectionProps & { item: Model }) {
  return (
    <label
      aria-label={item.name}
      className="hover:bg-muted/60 has-checked:bg-muted flex cursor-pointer items-start gap-3 rounded-md p-2 text-xs"
    >
      <input
        type="radio"
        name={group}
        value={item._id}
        checked={checked}
        onChange={onSelect}
        className="accent-brand mt-0.5"
      />
      <span className="min-w-0">
        <span className="block font-medium">{item.name}</span>
        <span className="text-muted-foreground block font-mono break-all">
          {item._id}
        </span>
      </span>
    </label>
  );
}

const optionalSearch = (value: string): string | undefined =>
  value.trim() || undefined;

const preventSearchSubmit = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") {
    event.preventDefault();
  }
};

export function NewEvaluationDialog({
  onCreate,
}: {
  onCreate: (jobId: Id<"jobs">) => void;
}) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [version, setVersion] = useState("");
  const [modelName, setModelName] = useState("");
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const benchmarks: Benchmark[] | undefined = useQuery(
    api.benchmark.getBenchmarks,
    open
      ? {
          name: optionalSearch(name),
          ownerName: optionalSearch(ownerName),
          version: optionalSearch(version),
        }
      : "skip"
  );
  const models = useQuery(
    api.model.getModels,
    open ? { name: optionalSearch(modelName) } : "skip"
  );
  const createJob = useMutation(api.job.createJob);
  const { pending, error, reset, run } = useDashboardAction();

  const close = () => {
    setOpen(false);
    setBenchmark(null);
    setModel(null);
    setName("");
    setOwnerName("");
    setVersion("");
    setModelName("");
    reset();
  };
  const changeOpen = (value: boolean) => {
    if (pending) {
      return;
    }
    if (value) {
      setOpen(true);
      return;
    }
    close();
  };
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!benchmark || !model) {
      return;
    }
    const succeeded = await run(async () => {
      const result = await createJob({
        benchmarkId: benchmark._id,
        modelId: model._id,
      });
      if (!result.success || !result.jobId) {
        throw new Error(result.error ?? "Could not create the evaluation.");
      }
      onCreate(result.jobId);
    }, "Evaluation created. Fund it to start the run.");
    if (succeeded) {
      close();
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        render={<Button className="w-fit rounded-full px-4" size="lg" />}
      >
        <PlusIcon data-icon="inline-start" />
        New evaluation
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto rounded-xl sm:max-w-2xl">
        <form onSubmit={create} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Start a new evaluation</DialogTitle>
            <DialogDescription>
              Choose a benchmark and a model. Create the job, then fund it from
              the job details to begin evaluation.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="grid min-w-0 gap-3" disabled={pending}>
            <legend className="mb-2 text-sm font-medium">
              1. Choose a benchmark
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="grid gap-1">
                <Label htmlFor={`${fieldId}-name`}>Benchmark name</Label>
                <Input
                  id={`${fieldId}-name`}
                  type="search"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={preventSearchSubmit}
                  placeholder="Search benchmarks…"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${fieldId}-owner`}>Owner</Label>
                <Input
                  id={`${fieldId}-owner`}
                  value={ownerName}
                  onChange={(event) => setOwnerName(event.target.value)}
                  onKeyDown={preventSearchSubmit}
                  placeholder="Exact owner name"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${fieldId}-version`}>Version</Label>
                <Input
                  id={`${fieldId}-version`}
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  onKeyDown={preventSearchSubmit}
                  placeholder="Exact version"
                />
              </div>
            </div>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-2">
              {benchmarks === undefined ? (
                <output className="text-muted-foreground p-2">
                  Loading benchmarks…
                </output>
              ) : null}
              {benchmarks?.length === 0 ? (
                <p className="text-muted-foreground p-2">
                  No benchmarks found. Try another search or upload a benchmark.
                </p>
              ) : null}
              {benchmarks?.map((item) => (
                <BenchmarkOption
                  key={item._id}
                  item={item}
                  group={`${fieldId}-benchmark`}
                  checked={benchmark?._id === item._id}
                  onSelect={() => setBenchmark(item)}
                />
              ))}
            </div>
            {benchmark ? (
              <p className="text-brand">
                Selected: {benchmark.name} v{benchmark.version} by{" "}
                {benchmark.ownerName}
              </p>
            ) : null}
            <p className="text-muted-foreground">
              Showing up to 20 matches. Refine your search to find a specific
              benchmark.
            </p>
          </fieldset>
          <fieldset className="grid gap-3" disabled={pending}>
            <legend className="mb-2 text-sm font-medium">
              2. Choose a model
            </legend>
            <div className="grid gap-1">
              <Label htmlFor={`${fieldId}-model`}>Model name</Label>
              <Input
                id={`${fieldId}-model`}
                type="search"
                value={modelName}
                onChange={(event) => setModelName(event.target.value)}
                onKeyDown={preventSearchSubmit}
                placeholder="Search models…"
              />
            </div>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border p-2">
              {models === undefined ? (
                <output className="text-muted-foreground p-2">
                  Loading models…
                </output>
              ) : null}
              {models?.length === 0 ? (
                <p className="text-muted-foreground p-2">
                  No models found. Try a different search.
                </p>
              ) : null}
              {models?.map((item) => (
                <ModelOption
                  key={item._id}
                  item={item}
                  group={`${fieldId}-model`}
                  checked={model?._id === item._id}
                  onSelect={() => setModel(item)}
                />
              ))}
            </div>
            {model ? (
              <p className="text-brand">Selected: {model.name}</p>
            ) : null}
            <p className="text-muted-foreground">
              Showing up to 20 matches. Providers are assigned after funding.
            </p>
          </fieldset>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="items-center sm:justify-between">
            <p className="text-muted-foreground">
              {benchmark && model
                ? "Ready to create. The job will show its funding price."
                : "Select a benchmark and a model to continue."}
            </p>
            <Button type="submit" disabled={pending || !benchmark || !model}>
              {pending ? "Creating…" : "Create evaluation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
