import type {
  Doc,
  Id,
} from "@cse416-project-jmac/backend/convex/_generated/dataModel";

export type Benchmark = Pick<
  Doc<"benchmarks">,
  "_id" | "name" | "description" | "ownerName" | "version" | "contentHash"
>;
export type Model = Doc<"models">;
export type Provider = Doc<"providers"> & { models: Id<"models">[] };
export type EvaluationJob = Doc<"jobs"> & {
  benchmark?: Benchmark;
  model?: Model;
};
export type JobFilter = "all" | "created" | "active" | "succeeded" | "failed";

export const matchesFilter = (job: EvaluationJob, filter: JobFilter): boolean =>
  filter === "all" ||
  (filter === "active" ? job.status === "funded" : job.status === filter);

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export const formatDateTime = (value: number): string =>
  `${dateTimeFormatter.format(new Date(value))} UTC`;
export const formatWei = (value: bigint): string =>
  `${value.toLocaleString("en-US")} wei`;
export const truncateHash = (hash: string): string =>
  hash.length <= 16 ? hash : `${hash.slice(0, 8)}…${hash.slice(-6)}`;
