"use client";

import { Button } from "@cse416-project-jmac/ui/components/button";
import { Checkbox } from "@cse416-project-jmac/ui/components/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@cse416-project-jmac/ui/components/dialog";
import { Input } from "@cse416-project-jmac/ui/components/input";
import { Label } from "@cse416-project-jmac/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cse416-project-jmac/ui/components/select";
import { PlayIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent } from "react";

import { formatCount } from "@/lib/evaluations";
import {
  BENCHMARKS,
  PROVIDER_MODELS,
  getBenchmark,
} from "@/lib/mock-evaluations";
import type { NewEvaluationInput } from "@/lib/mock-evaluations";

const DEFAULT_BENCHMARK_ID = BENCHMARKS[0].id;
const DEFAULT_PROVIDER_IDS: readonly string[] = [
  "openai-gpt-4.1",
  "anthropic-claude-sonnet-4",
];

const BENCHMARK_ITEMS = BENCHMARKS.map((benchmark) => ({
  value: benchmark.id,
  label: `${benchmark.name} v${benchmark.version}`,
}));

interface FormErrors {
  name?: string;
  providers?: string;
}

interface NewEvaluationDialogProps {
  onCreate: (input: NewEvaluationInput) => void;
}

export function NewEvaluationDialog({ onCreate }: NewEvaluationDialogProps) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [benchmarkId, setBenchmarkId] = useState<string>(DEFAULT_BENCHMARK_ID);
  const [providerIds, setProviderIds] = useState<string[]>([
    ...DEFAULT_PROVIDER_IDS,
  ]);
  const [issueReceipt, setIssueReceipt] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});

  const benchmark = getBenchmark(benchmarkId);
  const sampleTotal = (benchmark?.samples ?? 0) * providerIds.length;

  const resetForm = () => {
    setName("");
    setBenchmarkId(DEFAULT_BENCHMARK_ID);
    setProviderIds([...DEFAULT_PROVIDER_IDS]);
    setIssueReceipt(true);
    setErrors({});
  };

  const toggleProvider = (providerId: string, checked: boolean) => {
    setProviderIds((current) =>
      checked
        ? [...current, providerId]
        : current.filter((id) => id !== providerId)
    );
    setErrors((current) => ({ ...current, providers: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const providers = PROVIDER_MODELS.filter((model) =>
      providerIds.includes(model.id)
    );

    const nextErrors: FormErrors = {};
    if (trimmedName === "") {
      nextErrors.name = "Give this evaluation a name.";
    }
    if (providers.length === 0) {
      nextErrors.providers = "Select at least one provider.";
    }
    if (!benchmark || nextErrors.name || nextErrors.providers) {
      setErrors(nextErrors);
      return;
    }

    onCreate({ name: trimmedName, benchmark, providers, issueReceipt });
    setOpen(false);
    resetForm();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetForm();
        }
      }}
    >
      <DialogTrigger render={<Button size="lg" />}>
        <PlusIcon data-icon="inline-start" />
        New evaluation
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Start a new evaluation</DialogTitle>
            <DialogDescription>
              Samples stay inside the private worker pool. Only scores and the
              signed result digest leave the enclave.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-name`}>Name</Label>
            <Input
              id={`${fieldId}-name`}
              value={name}
              placeholder="e.g. Support triage · October candidate"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={
                errors.name ? `${fieldId}-name-error` : undefined
              }
              onChange={(event) => {
                setName(event.target.value);
                setErrors((current) => ({ ...current, name: undefined }));
              }}
            />
            {errors.name ? (
              <p id={`${fieldId}-name-error`} className="text-destructive">
                {errors.name}
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-benchmark`}>Benchmark suite</Label>
            <Select
              items={BENCHMARK_ITEMS}
              value={benchmarkId}
              onValueChange={(value) => {
                if (value) {
                  setBenchmarkId(value);
                }
              }}
            >
              <SelectTrigger id={`${fieldId}-benchmark`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BENCHMARK_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {benchmark ? (
              <p className="text-muted-foreground">
                {benchmark.description} {formatCount(benchmark.samples)}{" "}
                samples.
              </p>
            ) : null}
          </div>

          <fieldset
            className="grid gap-2"
            aria-describedby={
              errors.providers ? `${fieldId}-providers-error` : undefined
            }
          >
            <legend className="mb-2 text-xs">Providers</legend>
            <div className="bg-border grid gap-px border sm:grid-cols-2">
              {PROVIDER_MODELS.map((model) => (
                <Label
                  key={model.id}
                  className="bg-popover hover:bg-muted/60 cursor-pointer items-start gap-2.5 p-2.5 leading-normal"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={providerIds.includes(model.id)}
                    onCheckedChange={(checked) =>
                      toggleProvider(model.id, checked)
                    }
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{model.provider}</span>
                    <span className="text-muted-foreground block truncate font-mono">
                      {model.model}
                    </span>
                  </span>
                </Label>
              ))}
            </div>
            {errors.providers ? (
              <p id={`${fieldId}-providers-error`} className="text-destructive">
                {errors.providers}
              </p>
            ) : null}
          </fieldset>

          <Label className="cursor-pointer items-start gap-2.5 leading-normal">
            <Checkbox
              className="mt-0.5"
              checked={issueReceipt}
              onCheckedChange={setIssueReceipt}
            />
            <span>
              <span className="block font-medium">Issue a signed receipt</span>
              <span className="text-muted-foreground block">
                Anchor the result digest on Base Sepolia when the run completes.
              </span>
            </span>
          </Label>

          <DialogFooter className="items-center sm:justify-between">
            <p className="text-muted-foreground tabular-nums">
              {formatCount(sampleTotal)} samples across {providerIds.length}{" "}
              {providerIds.length === 1 ? "provider" : "providers"}
            </p>
            <div className="flex gap-2">
              <DialogClose render={<Button type="button" variant="outline" />}>
                Cancel
              </DialogClose>
              <Button type="submit">
                <PlayIcon data-icon="inline-start" />
                Start evaluation
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
