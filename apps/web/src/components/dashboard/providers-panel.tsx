"use client";

import { api } from "@cse416-project-jmac/backend/convex/_generated/api";
import { Badge } from "@cse416-project-jmac/ui/components/badge";
import { Button } from "@cse416-project-jmac/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cse416-project-jmac/ui/components/card";
import { Input } from "@cse416-project-jmac/ui/components/input";
import { Label } from "@cse416-project-jmac/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@cse416-project-jmac/ui/components/select";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { EyeIcon, EyeOffIcon, ServerIcon } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { isAddress } from "viem";

import type { Model, Provider } from "@/lib/evaluations";
import { formatDateTime } from "@/lib/evaluations";

import { CopyButton } from "./copy-button";
import { useDashboardAction } from "./use-dashboard-action";

function WorkerSecret({ secret }: { secret: string }) {
  const [showSecret, setShowSecret] = useState(false);
  return (
    <div>
      <dt className="text-muted-foreground">Worker secret</dt>
      <dd className="mt-1 flex items-center gap-1">
        <span className="min-w-0 font-mono break-all">
          {showSecret ? secret : "••••••••••••••••"}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={showSecret ? "Hide worker secret" : "Show worker secret"}
          aria-pressed={showSecret}
          onClick={() => setShowSecret(!showSecret)}
        >
          {showSecret ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
        {showSecret ? (
          <CopyButton value={secret} label="Worker secret" />
        ) : null}
      </dd>
    </div>
  );
}

const modelLabel = (id: string, models: Model[]): string =>
  models.find((model) => model._id === id)?.name ?? id;

const unsupportedModels = (
  models: Model[] | undefined,
  provider: Provider
): Model[] =>
  (models ?? []).filter((model) => !provider.models.includes(model._id));

function ProviderCard({
  provider,
  models,
}: {
  provider: Provider;
  models: Model[];
}) {
  const fieldId = useId();
  const [maxJobs, setMaxJobs] = useState(String(provider.maxJobs));
  const [modelName, setModelName] = useState("");
  const [modelId, setModelId] = useState<string | null>(null);
  const searchedModels = useQuery(api.model.getModels, {
    name: modelName.trim() || undefined,
  });
  const setStatus = useMutation(api.provider.setStatus);
  const setMaxJobsMutation = useMutation(api.provider.setMaxJobs);
  const addModel = useMutation(api.provider.addModelSupport);
  const removeModel = useMutation(api.provider.removeModelSupport);
  const { pending, error, run } = useDashboardAction();
  const offline = provider.status === "offline";
  const availableModels = unsupportedModels(searchedModels, provider);
  const modelItems = availableModels.map((model) => ({
    value: model._id,
    label: model.name,
  }));

  const saveCapacity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(async () => {
      const capacity = Number(maxJobs);
      if (
        maxJobs.trim() === "" ||
        !Number.isInteger(capacity) ||
        capacity < 0 ||
        capacity > 20
      ) {
        throw new Error("Capacity must be a whole number between 0 and 20.");
      }
      const result = await setMaxJobsMutation({
        providerId: provider._id,
        newMaxJobs: BigInt(capacity),
      });
      if (!result.success) {
        throw new Error(result.error);
      }
    }, "Provider capacity updated");
  };
  const updateStatus = async (newStatus: "ready" | "offline") => {
    await run(async () => {
      const result = await setStatus({ providerId: provider._id, newStatus });
      if (!result.success) {
        throw new Error(result.error);
      }
    }, `Provider is now ${newStatus}`);
  };
  const supportModel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const model = availableModels.find((item) => item._id === modelId);
    if (!model) {
      return;
    }
    const succeeded = await run(async () => {
      const result = await addModel({
        providerId: provider._id,
        modelId: model._id,
      });
      if (!result.success) {
        throw new Error(result.error);
      }
    }, "Model support added");
    if (succeeded) {
      setModelId(null);
    }
  };

  return (
    <Card className="min-w-0 rounded-xl">
      <CardHeader className="gap-2 border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ServerIcon className="size-4" />
            Provider
          </CardTitle>
          <div className="flex gap-2">
            <Badge variant="outline">
              {provider.approved ? "Approved" : "Awaiting approval"}
            </Badge>
            <Badge variant="secondary">{provider.status}</Badge>
          </div>
        </div>
        <CardDescription className="flex items-center gap-1">
          <span className="min-w-0 font-mono break-all">{provider._id}</span>
          <CopyButton value={provider._id} label="Provider ID" />
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="space-y-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Wallet address</dt>
            <dd className="mt-1 flex items-center gap-1">
              <span className="min-w-0 font-mono break-all">
                {provider.walletAddress}
              </span>
              <CopyButton
                value={provider.walletAddress}
                label="Provider wallet address"
              />
            </dd>
          </div>
          <WorkerSecret secret={provider.secret} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-muted-foreground">Current / maximum jobs</dt>
              <dd className="mt-1 font-medium tabular-nums">
                {String(provider.currentJobs)} / {String(provider.maxJobs)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last heartbeat</dt>
              <dd className="mt-1">{formatDateTime(provider.lastHeartbeat)}</dd>
            </div>
          </div>
        </dl>
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-medium">Availability</p>
          <p className="text-muted-foreground text-xs">
            Approved providers can go ready after setting a positive capacity.
            Take a provider offline to edit its settings.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={
                pending ||
                !provider.approved ||
                provider.status === "ready" ||
                provider.maxJobs === 0n
              }
              onClick={() => updateStatus("ready")}
            >
              Set ready
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !provider.approved || offline}
              onClick={() => updateStatus("offline")}
            >
              Set offline
            </Button>
          </div>
        </div>
        <form onSubmit={saveCapacity} className="grid gap-2">
          <Label htmlFor={`${fieldId}-capacity`}>
            Maximum concurrent jobs (0–20)
          </Label>
          <div className="flex gap-2">
            <Input
              id={`${fieldId}-capacity`}
              type="number"
              min={0}
              max={20}
              step={1}
              required
              value={maxJobs}
              onChange={(event) => setMaxJobs(event.target.value)}
              disabled={!offline || pending}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!offline || pending}
            >
              Save
            </Button>
          </div>
        </form>
        <div className="grid gap-2">
          <p className="text-xs font-medium">Supported models</p>
          {provider.models.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No models added yet.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {provider.models.map((id) => (
                <li
                  key={id}
                  className="flex items-center justify-between gap-2 p-2"
                >
                  <span className="min-w-0 text-xs break-all">
                    {modelLabel(id, [...models, ...(searchedModels ?? [])])}
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!offline || pending}
                    aria-label={`Remove ${modelLabel(id, models)} support`}
                    onClick={async () => {
                      await run(async () => {
                        const result = await removeModel({
                          providerId: provider._id,
                          modelId: id,
                        });
                        if (!result.success) {
                          throw new Error(result.error);
                        }
                      }, "Model support removed");
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form onSubmit={supportModel} className="grid gap-2">
          <Label htmlFor={`${fieldId}-search`}>Find a model to support</Label>
          <Input
            id={`${fieldId}-search`}
            type="search"
            value={modelName}
            onChange={(event) => {
              setModelName(event.target.value);
              setModelId(null);
            }}
            disabled={!offline || pending}
            placeholder="Search models…"
          />
          <Label htmlFor={`${fieldId}-model`}>Model</Label>
          <div className="flex gap-2">
            <Select
              items={modelItems}
              value={modelId}
              onValueChange={setModelId}
              disabled={!offline || pending || availableModels.length === 0}
            >
              <SelectTrigger id={`${fieldId}-model`} className="min-w-0 flex-1">
                <SelectValue placeholder="Choose or search for a model" />
              </SelectTrigger>
              <SelectContent>
                {modelItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="submit"
              variant="outline"
              disabled={!offline || pending || !modelId}
            >
              Add
            </Button>
          </div>
          {searchedModels && availableModels.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No additional models match this search.
            </p>
          ) : null}
        </form>
        {offline ? null : (
          <p className="text-muted-foreground text-xs">
            Set this provider offline to change capacity or model support.
          </p>
        )}
        {error ? (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ProvidersPanel({ models }: { models: Model[] }) {
  const fieldId = useId();
  const [address, setAddress] = useState("");
  const {
    results: providers,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.provider.getUserProviders,
    {},
    { initialNumItems: 6 }
  );
  const registerProvider = useMutation(api.provider.register);
  const { pending, error, run } = useDashboardAction();
  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const succeeded = await run(async () => {
      const walletAddress = address.trim();
      if (!isAddress(walletAddress, { strict: false })) {
        throw new Error(
          "Enter a wallet address with 0x followed by 40 hexadecimal characters."
        );
      }
      const result = await registerProvider({ walletAddress });
      if (!result.success) {
        throw new Error(result.error);
      }
    }, "Provider registered. Approval is required before it can go ready.");
    if (succeeded) {
      setAddress("");
    }
  };
  const awaitingApproval = providers.some((provider) => !provider.approved);

  return (
    <div className="space-y-4">
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>Your providers</CardTitle>
          <CardDescription>
            Register workers and manage their availability, capacity, and
            supported models.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={register} className="grid gap-2">
            <Label htmlFor={fieldId}>Provider wallet address</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={fieldId}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="0x…"
                autoComplete="off"
                required
                disabled={pending || awaitingApproval}
                className="font-mono"
              />
              <Button type="submit" disabled={pending || awaitingApproval}>
                {pending ? "Registering…" : "Register provider"}
              </Button>
            </div>
            {awaitingApproval ? (
              <p className="text-muted-foreground text-xs">
                Wait for your existing provider to be approved before
                registering another.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
      {status === "LoadingFirstPage" ? (
        <output className="text-muted-foreground py-6 text-center text-sm">
          Loading providers…
        </output>
      ) : null}
      {status !== "LoadingFirstPage" && providers.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border p-8 text-center text-sm">
          You have no providers yet. Register your first worker above.
        </p>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {providers.map((provider) => (
          <ProviderCard
            key={provider._id}
            provider={provider}
            models={models}
          />
        ))}
      </div>
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button
          variant="outline"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(6)}
        >
          {status === "LoadingMore" ? "Loading…" : "Load more providers"}
        </Button>
      ) : null}
    </div>
  );
}
