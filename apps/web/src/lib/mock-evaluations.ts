import type {
  Benchmark,
  EvaluationJob,
  ProviderModel,
  ProviderResult,
  ProviderRunStatus,
} from "@/lib/evaluations";

export const BENCHMARKS = [
  {
    id: "support-triage",
    name: "Support Ticket Triage",
    version: "3.2",
    samples: 2400,
    description:
      "Routing and priority labels for anonymized enterprise support tickets.",
  },
  {
    id: "contract-clauses",
    name: "Contract Clause Extraction",
    version: "1.4",
    samples: 860,
    description:
      "Indemnity, termination, and liability clauses from vendor contracts.",
  },
  {
    id: "claims-coding",
    name: "Insurance Claims Coding",
    version: "2.0",
    samples: 1500,
    description: "ICD-10 code assignment from de-identified claim narratives.",
  },
  {
    id: "warehouse-sql",
    name: "Warehouse SQL Generation",
    version: "5.1",
    samples: 640,
    description: "Natural-language questions against the internal warehouse.",
  },
  {
    id: "pii-redaction",
    name: "PII Redaction Recall",
    version: "1.1",
    samples: 3200,
    description: "Detect and mask personal data in free-text customer records.",
  },
  {
    id: "secure-code-review",
    name: "Secure Code Review",
    version: "0.9",
    samples: 420,
    description: "Flag injection and auth flaws in proprietary service diffs.",
  },
] as const satisfies readonly Benchmark[];

export const PROVIDER_MODELS = [
  { id: "openai-gpt-4.1", provider: "OpenAI", model: "gpt-4.1" },
  {
    id: "anthropic-claude-sonnet-4",
    provider: "Anthropic",
    model: "claude-sonnet-4",
  },
  { id: "google-gemini-2.5-pro", provider: "Google", model: "gemini-2.5-pro" },
  { id: "mistral-large", provider: "Mistral", model: "mistral-large-latest" },
  {
    id: "together-llama-3.3-70b",
    provider: "Together AI",
    model: "llama-3.3-70b-instruct",
  },
  {
    id: "self-hosted-qwen-2.5-72b",
    provider: "Self-hosted vLLM",
    model: "qwen2.5-72b-instruct",
  },
] as const satisfies readonly ProviderModel[];

type BenchmarkId = (typeof BENCHMARKS)[number]["id"];
type ProviderModelId = (typeof PROVIDER_MODELS)[number]["id"];

const benchmark = (id: BenchmarkId): Benchmark => {
  const match = BENCHMARKS.find((item) => item.id === id);
  if (!match) {
    throw new Error(`Unknown benchmark: ${id}`);
  }
  return match;
};

const providerModel = (id: ProviderModelId): ProviderModel => {
  const match = PROVIDER_MODELS.find((item) => item.id === id);
  if (!match) {
    throw new Error(`Unknown provider model: ${id}`);
  }
  return match;
};

export const getBenchmark = (id: string): Benchmark | undefined =>
  BENCHMARKS.find((item) => item.id === id);

interface ResultInput {
  status: ProviderRunStatus;
  score: number | null;
  p50LatencyMs: number | null;
  costUsd: number;
  samplesCompleted: number;
}

const result = (id: ProviderModelId, input: ResultInput): ProviderResult => ({
  ...providerModel(id),
  ...input,
});

export interface NewEvaluationInput {
  name: string;
  benchmark: Benchmark;
  providers: ProviderModel[];
  issueReceipt: boolean;
}

const JOB_ID_LENGTH = 6;

export const createQueuedJob = (
  input: NewEvaluationInput,
  createdBy: string
): EvaluationJob => ({
  id: `eval_${crypto.randomUUID().replaceAll("-", "").slice(0, JOB_ID_LENGTH)}`,
  name: input.name,
  benchmark: input.benchmark,
  status: "queued",
  createdBy,
  createdAt: new Date().toISOString(),
  startedAt: null,
  completedAt: null,
  failureReason: null,
  issueReceipt: input.issueReceipt,
  providers: input.providers.map((model) => ({
    ...model,
    status: "pending",
    score: null,
    p50LatencyMs: null,
    costUsd: 0,
    samplesCompleted: 0,
  })),
  recoveryAttempts: [],
  receipt: null,
});

export const MOCK_EVALUATION_JOBS: EvaluationJob[] = [
  {
    id: "eval_7hq2xk",
    name: "Support triage · September release candidate",
    benchmark: benchmark("support-triage"),
    status: "running",
    createdBy: "Maya Chen",
    createdAt: "2026-09-30T22:41:00Z",
    startedAt: "2026-09-30T22:43:00Z",
    completedAt: null,
    failureReason: null,
    issueReceipt: true,
    providers: [
      result("anthropic-claude-sonnet-4", {
        status: "running",
        score: 89.4,
        p50LatencyMs: 1480,
        costUsd: 11.2,
        samplesCompleted: 1652,
      }),
      result("openai-gpt-4.1", {
        status: "running",
        score: 87.9,
        p50LatencyMs: 1240,
        costUsd: 9.62,
        samplesCompleted: 1780,
      }),
      result("google-gemini-2.5-pro", {
        status: "passed",
        score: 86.1,
        p50LatencyMs: 980,
        costUsd: 7.85,
        samplesCompleted: 2400,
      }),
    ],
    recoveryAttempts: [],
    receipt: null,
  },
  {
    id: "eval_4mc9ta",
    name: "Contract clause extraction · vendor shortlist",
    benchmark: benchmark("contract-clauses"),
    status: "recovering",
    createdBy: "Jordan Alvarez",
    createdAt: "2026-09-30T21:58:00Z",
    startedAt: "2026-09-30T22:02:00Z",
    completedAt: null,
    failureReason: null,
    issueReceipt: true,
    providers: [
      result("anthropic-claude-sonnet-4", {
        status: "retrying",
        score: 84.7,
        p50LatencyMs: 2650,
        costUsd: 9.91,
        samplesCompleted: 512,
      }),
      result("openai-gpt-4.1", {
        status: "passed",
        score: 81.3,
        p50LatencyMs: 2310,
        costUsd: 14.08,
        samplesCompleted: 860,
      }),
      result("mistral-large", {
        status: "passed",
        score: 74.2,
        p50LatencyMs: 1890,
        costUsd: 4.37,
        samplesCompleted: 860,
      }),
    ],
    recoveryAttempts: [
      {
        id: "rec_4mc9ta_1",
        providerId: "anthropic-claude-sonnet-4",
        attempt: 1,
        maxAttempts: 5,
        reason: "HTTP 429 · output tokens per minute limit exceeded",
        action: "Backed off 45 s and resumed from checkpoint at sample 388.",
        outcome: "recovered",
        occurredAt: "2026-09-30T22:31:00Z",
      },
      {
        id: "rec_4mc9ta_2",
        providerId: "anthropic-claude-sonnet-4",
        attempt: 2,
        maxAttempts: 5,
        reason: "HTTP 429 · output tokens per minute limit exceeded",
        action: "Backing off 90 s before resuming from sample 512.",
        outcome: "in_progress",
        occurredAt: "2026-09-30T23:12:00Z",
      },
    ],
    receipt: null,
  },
  {
    id: "eval_9pr3dw",
    name: "PII redaction · nightly regression",
    benchmark: benchmark("pii-redaction"),
    status: "queued",
    createdBy: "Scheduled run",
    createdAt: "2026-09-30T23:20:00Z",
    startedAt: null,
    completedAt: null,
    failureReason: null,
    issueReceipt: true,
    providers: [
      result("self-hosted-qwen-2.5-72b", {
        status: "pending",
        score: null,
        p50LatencyMs: null,
        costUsd: 0,
        samplesCompleted: 0,
      }),
      result("google-gemini-2.5-pro", {
        status: "pending",
        score: null,
        p50LatencyMs: null,
        costUsd: 0,
        samplesCompleted: 0,
      }),
    ],
    recoveryAttempts: [],
    receipt: null,
  },
  {
    id: "eval_6tb1vq",
    name: "Warehouse SQL · schema v12 migration",
    benchmark: benchmark("warehouse-sql"),
    status: "completed",
    createdBy: "Ade Okafor",
    createdAt: "2026-09-30T19:30:00Z",
    startedAt: "2026-09-30T19:31:00Z",
    completedAt: "2026-09-30T20:14:00Z",
    failureReason: null,
    issueReceipt: true,
    providers: [
      result("anthropic-claude-sonnet-4", {
        status: "passed",
        score: 82.3,
        p50LatencyMs: 3120,
        costUsd: 7.04,
        samplesCompleted: 640,
      }),
      result("openai-gpt-4.1", {
        status: "passed",
        score: 78.6,
        p50LatencyMs: 2890,
        costUsd: 6.12,
        samplesCompleted: 640,
      }),
      result("self-hosted-qwen-2.5-72b", {
        status: "passed",
        score: 71.8,
        p50LatencyMs: 1740,
        costUsd: 1.86,
        samplesCompleted: 640,
      }),
    ],
    recoveryAttempts: [
      {
        id: "rec_6tb1vq_1",
        providerId: "self-hosted-qwen-2.5-72b",
        attempt: 1,
        maxAttempts: 3,
        reason: "Schema validation failed on 14 responses (malformed JSON)",
        action: "Re-ran the affected samples with constrained JSON decoding.",
        outcome: "recovered",
        occurredAt: "2026-09-30T19:58:00Z",
      },
    ],
    receipt: {
      id: "rcpt_6tb1vq",
      status: "signed",
      resultDigest:
        "sha256:2d6f2d6c44ed35708df0eab498acffa237f13cac9da208d6ff172c7a79bdc514",
      signer: "enclave · worker-gpu-04",
      network: "Base Sepolia",
      txHash: null,
      blockNumber: null,
      issuedAt: "2026-09-30T20:15:00Z",
    },
  },
  {
    id: "eval_8zd5ue",
    name: "Secure code review · prompt v7",
    benchmark: benchmark("secure-code-review"),
    status: "failed",
    createdBy: "Chris Moreau",
    createdAt: "2026-09-30T17:12:00Z",
    startedAt: "2026-09-30T17:13:00Z",
    completedAt: "2026-09-30T17:41:00Z",
    failureReason:
      "gemini-2.5-pro exhausted 3 of 3 recovery attempts. Partial results were withheld and no receipt was issued.",
    issueReceipt: true,
    providers: [
      result("openai-gpt-4.1", {
        status: "passed",
        score: 76.4,
        p50LatencyMs: 4210,
        costUsd: 5.48,
        samplesCompleted: 420,
      }),
      result("google-gemini-2.5-pro", {
        status: "failed",
        score: null,
        p50LatencyMs: 6830,
        costUsd: 1.92,
        samplesCompleted: 233,
      }),
    ],
    recoveryAttempts: [
      {
        id: "rec_8zd5ue_1",
        providerId: "google-gemini-2.5-pro",
        attempt: 1,
        maxAttempts: 3,
        reason: "Upstream timeout after 120 s",
        action: "Retried batch 12 with exponential backoff (10 s).",
        outcome: "recovered",
        occurredAt: "2026-09-30T17:24:00Z",
      },
      {
        id: "rec_8zd5ue_2",
        providerId: "google-gemini-2.5-pro",
        attempt: 2,
        maxAttempts: 3,
        reason: "Upstream timeout after 120 s",
        action: "Reduced batch concurrency from 8 to 2 and retried.",
        outcome: "recovered",
        occurredAt: "2026-09-30T17:33:00Z",
      },
      {
        id: "rec_8zd5ue_3",
        providerId: "google-gemini-2.5-pro",
        attempt: 3,
        maxAttempts: 3,
        reason: "Upstream timeout after 120 s",
        action: "Retry budget exhausted; provider marked as failed.",
        outcome: "exhausted",
        occurredAt: "2026-09-30T17:41:00Z",
      },
    ],
    receipt: null,
  },
  {
    id: "eval_2kw8nf",
    name: "Claims coding · Q4 model selection",
    benchmark: benchmark("claims-coding"),
    status: "completed",
    createdBy: "Maya Chen",
    createdAt: "2026-09-30T14:05:00Z",
    startedAt: "2026-09-30T14:06:00Z",
    completedAt: "2026-09-30T15:52:00Z",
    failureReason: null,
    issueReceipt: true,
    providers: [
      result("anthropic-claude-sonnet-4", {
        status: "passed",
        score: 92.6,
        p50LatencyMs: 1390,
        costUsd: 21.75,
        samplesCompleted: 1500,
      }),
      result("openai-gpt-4.1", {
        status: "passed",
        score: 91.2,
        p50LatencyMs: 1120,
        costUsd: 18.4,
        samplesCompleted: 1500,
      }),
      result("google-gemini-2.5-pro", {
        status: "passed",
        score: 90.4,
        p50LatencyMs: 870,
        costUsd: 12.3,
        samplesCompleted: 1500,
      }),
      result("together-llama-3.3-70b", {
        status: "passed",
        score: 83.9,
        p50LatencyMs: 640,
        costUsd: 3.1,
        samplesCompleted: 1500,
      }),
    ],
    recoveryAttempts: [
      {
        id: "rec_2kw8nf_1",
        providerId: "google-gemini-2.5-pro",
        attempt: 1,
        maxAttempts: 3,
        reason: "Worker preempted · spot instance reclaimed",
        action:
          "Rescheduled on worker-gpu-07 and resumed from checkpoint at sample 1,104.",
        outcome: "recovered",
        occurredAt: "2026-09-30T15:10:00Z",
      },
    ],
    receipt: {
      id: "rcpt_2kw8nf",
      status: "anchored",
      resultDigest:
        "sha256:2c50ba4e5188d0d7b4b4f2c282a4f6a61e2cff255a9128ce7040263ae92cb082",
      signer: "enclave · worker-gpu-07",
      network: "Base Sepolia",
      txHash:
        "0x87ee31379db7d7a7540554b6bc1660046e0ce13d24823aa170ecbad6ccf40fab",
      blockNumber: 31_482_907,
      issuedAt: "2026-09-30T15:54:00Z",
    },
  },
  {
    id: "eval_3ny7gc",
    name: "Support triage · Llama baseline",
    benchmark: benchmark("support-triage"),
    status: "failed",
    createdBy: "Jordan Alvarez",
    createdAt: "2026-09-29T16:20:00Z",
    startedAt: "2026-09-29T16:21:00Z",
    completedAt: "2026-09-29T16:22:00Z",
    failureReason:
      "Provider credential rejected (HTTP 401). Recovery was skipped because authentication errors are not retryable.",
    issueReceipt: true,
    providers: [
      result("together-llama-3.3-70b", {
        status: "failed",
        score: null,
        p50LatencyMs: null,
        costUsd: 0,
        samplesCompleted: 0,
      }),
    ],
    recoveryAttempts: [],
    receipt: null,
  },
  {
    id: "eval_5vx0hp",
    name: "PII redaction · baseline refresh",
    benchmark: benchmark("pii-redaction"),
    status: "completed",
    createdBy: "Ade Okafor",
    createdAt: "2026-09-29T09:00:00Z",
    startedAt: "2026-09-29T09:02:00Z",
    completedAt: "2026-09-29T11:47:00Z",
    failureReason: null,
    issueReceipt: true,
    providers: [
      result("anthropic-claude-sonnet-4", {
        status: "passed",
        score: 96.3,
        p50LatencyMs: 1180,
        costUsd: 24.6,
        samplesCompleted: 3200,
      }),
      result("openai-gpt-4.1", {
        status: "passed",
        score: 95.8,
        p50LatencyMs: 1010,
        costUsd: 21.33,
        samplesCompleted: 3200,
      }),
      result("self-hosted-qwen-2.5-72b", {
        status: "passed",
        score: 93.1,
        p50LatencyMs: 720,
        costUsd: 6.4,
        samplesCompleted: 3200,
      }),
    ],
    recoveryAttempts: [],
    receipt: {
      id: "rcpt_5vx0hp",
      status: "anchored",
      resultDigest:
        "sha256:6426af2e917653c10ae6aec2c501946f095ceeed0e30bedea607e422a87217ec",
      signer: "enclave · worker-gpu-02",
      network: "Base Sepolia",
      txHash:
        "0x506bdacc5b2db7900144beae6e72763ae0b49bfe6a327051e3a27ebc062d5a45",
      blockNumber: 31_437_118,
      issuedAt: "2026-09-29T11:49:00Z",
    },
  },
  {
    id: "eval_1qs6je",
    name: "Contract clause extraction · prompt v3",
    benchmark: benchmark("contract-clauses"),
    status: "completed",
    createdBy: "Chris Moreau",
    createdAt: "2026-09-28T13:15:00Z",
    startedAt: "2026-09-28T13:16:00Z",
    completedAt: "2026-09-28T14:02:00Z",
    failureReason: null,
    issueReceipt: true,
    providers: [
      result("openai-gpt-4.1", {
        status: "passed",
        score: 79,
        p50LatencyMs: 2240,
        costUsd: 13.71,
        samplesCompleted: 860,
      }),
      result("mistral-large", {
        status: "passed",
        score: 72.5,
        p50LatencyMs: 1830,
        costUsd: 4.12,
        samplesCompleted: 860,
      }),
    ],
    recoveryAttempts: [
      {
        id: "rec_1qs6je_1",
        providerId: "openai-gpt-4.1",
        attempt: 1,
        maxAttempts: 3,
        reason: "HTTP 500 · upstream server error",
        action: "Retried 6 failed requests after 5 s.",
        outcome: "recovered",
        occurredAt: "2026-09-28T13:38:00Z",
      },
    ],
    receipt: {
      id: "rcpt_1qs6je",
      status: "anchored",
      resultDigest:
        "sha256:1e33887192f76fdc3f6e9f95ba596e368d8d51b61e6fab59f9c66045cc9186c0",
      signer: "enclave · worker-gpu-04",
      network: "Base Sepolia",
      txHash:
        "0x52ebfb2c008b25dde8c783a38740b1d65af1b579f556d4ace8ea726e5fed5cb2",
      blockNumber: 31_389_544,
      issuedAt: "2026-09-28T14:04:00Z",
    },
  },
  {
    id: "eval_0fl4ry",
    name: "Warehouse SQL · smoke test",
    benchmark: benchmark("warehouse-sql"),
    status: "completed",
    createdBy: "Ade Okafor",
    createdAt: "2026-09-28T10:02:00Z",
    startedAt: "2026-09-28T10:02:00Z",
    completedAt: "2026-09-28T10:31:00Z",
    failureReason: null,
    issueReceipt: false,
    providers: [
      result("anthropic-claude-sonnet-4", {
        status: "passed",
        score: 81.9,
        p50LatencyMs: 3040,
        costUsd: 6.95,
        samplesCompleted: 640,
      }),
    ],
    recoveryAttempts: [],
    receipt: null,
  },
];
