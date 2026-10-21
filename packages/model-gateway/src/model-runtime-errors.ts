import type { ModelRuntimeAdmissionDecisionV1 } from "@cloudmarkup/schemas";

const denialReasonOrder = [
  "administratively-suspended",
  "capability-killed",
  "evaluation-gate-failed",
  "feature-not-entitled",
  "insufficient-credits",
  "live-evaluation-not-authorized",
  "model-not-allow-listed",
  "request-limit-exceeded",
  "concurrency-limit-exceeded",
  "input-limit-exceeded",
  "output-limit-exceeded",
  "repair-limit-exceeded",
  "dependency-not-allow-listed",
  "provider-not-allow-listed",
  "module-not-allow-listed",
  "routing-authority-mismatch",
  "runtime-control-unavailable",
  "stale-or-duplicate-conflict",
] as const satisfies readonly ModelRuntimeAdmissionDecisionV1["denialReasons"][number][];

export type ModelRuntimeDenialReasonV1 = (typeof denialReasonOrder)[number];

const safeMessages = Object.freeze({
  "administratively-suspended":
    "Model assistance is administratively suspended for this scope.",
  "capability-killed": "This model capability is currently unavailable.",
  "concurrency-limit-exceeded":
    "The concurrent model-job limit has been reached.",
  "dependency-not-allow-listed":
    "The request contains a dependency that is not approved.",
  "evaluation-gate-failed":
    "The required deterministic evaluation evidence is not current and passing.",
  "feature-not-entitled":
    "The current plan does not include this model-assisted feature.",
  "input-limit-exceeded": "The request exceeds a configured input limit.",
  "insufficient-credits":
    "The canonical commercial authority did not approve sufficient credits.",
  "live-evaluation-not-authorized":
    "Live evaluation requires current, explicit operator authority.",
  "model-not-allow-listed":
    "The trusted route is not present in the runtime allow-list.",
  "module-not-allow-listed":
    "The request contains a module source that is not approved.",
  "output-limit-exceeded": "The request exceeds a configured output limit.",
  "provider-not-allow-listed":
    "The request contains a provider source that is not approved.",
  "repair-limit-exceeded":
    "The request exceeds the configured repair-attempt limit.",
  "request-limit-exceeded": "The request-rate limit has been reached.",
  "routing-authority-mismatch":
    "The runtime request does not match its trusted routing authority.",
  "runtime-control-unavailable":
    "Model runtime controls are temporarily unavailable.",
  "stale-or-duplicate-conflict":
    "The request is stale, already running, or reuses an idempotency identity.",
} satisfies Readonly<Record<ModelRuntimeDenialReasonV1, string>>);

export class ModelRuntimeControlError extends Error {
  public readonly safeCode: ModelRuntimeDenialReasonV1;

  public constructor(safeCode: ModelRuntimeDenialReasonV1) {
    super(safeMessages[safeCode]);
    this.name = "ModelRuntimeControlError";
    this.safeCode = safeCode;
  }
}

export function orderedReasons(
  reasons: ReadonlySet<ModelRuntimeDenialReasonV1>,
): readonly ModelRuntimeDenialReasonV1[] {
  return denialReasonOrder.filter((reason) => reasons.has(reason));
}
