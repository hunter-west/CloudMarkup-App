import type {
  ModelRuntimeAuditEventV1,
  ModelRuntimeControlPolicyV1,
  ModelRuntimeInputEvidenceV1,
  ModelRuntimeMetricV1,
  ModelRoutingDecisionV1,
  Sha256Digest,
} from "@cloudmarkup/schemas";
import type {
  ModelCommercialDenialReasonV1,
  ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";
import type {
  ModelRuntimeAdmissionStoreV1,
  ModelRuntimeAdmissionTerminalV1,
  ModelRuntimeCanonicalCommercialPortV1,
  ModelRuntimeControlledInvocationContextV1,
  ModelRuntimeControlledInvocationResultV1,
  ModelRuntimeExecutionLeaseV1,
  ModelRuntimeHostEvidenceVerifierV1,
  ModelRuntimeSanitizedOutputEvidenceV1,
  ModelRuntimeTelemetryOutboxEntryV1,
} from "./model-runtime-controls.js";
import {
  assertInstant,
  assertReservedCallback,
  checkedInvocationLatencyMilliseconds,
  commercialUsageExceedsBounds,
  verifyRuntimeInvocationOutput,
  type RuntimeExecutionDecision,
  type RuntimeExecutionRequest,
  type RuntimeLiveExecutionBounds,
} from "./model-runtime-execution-bindings.js";
import {
  ModelRuntimeControlError,
  orderedReasons,
  type ModelRuntimeDenialReasonV1,
} from "./model-runtime-errors.js";
import { digestStructuredValue } from "./security.js";

export type ModelRuntimeMetricProjectionV1 =
  | {
      readonly sourceAuthority: "runtime-control-v1";
      readonly unit: "count";
      readonly value: number;
    }
  | {
      readonly sourceAuthority: "deterministic-evaluation-v1";
      readonly unit: "basis-points";
      readonly value: number;
    }
  | {
      readonly sourceAuthority: "canonical-commercial-v1";
      readonly unit: "credit-units" | "estimated-micro-usd";
      readonly value: number;
    }
  | {
      readonly sourceAuthority: "canonical-model-usage-v1";
      readonly unit: "milliseconds" | "tokens";
      readonly value: number;
    };

type RuntimeTerminal<D> = Omit<ModelRuntimeAdmissionTerminalV1, "admission"> & {
  readonly admission: D;
};
interface Pair {
  readonly audit: ModelRuntimeAuditEventV1;
  readonly metric: ModelRuntimeMetricV1;
}
type CommonTransition = Parameters<
  ModelRuntimeAdmissionStoreV1["completeAndRelease"]
>[0];
export interface RuntimeExecutionStore<D> extends Pick<
  ModelRuntimeAdmissionStoreV1,
  "assertExecutionLease" | "release"
> {
  checkpointPendingAndRelease(
    input: Omit<
      Parameters<
        ModelRuntimeAdmissionStoreV1["checkpointPendingAndRelease"]
      >[0],
      "pending"
    > & {
      readonly pending: RuntimeTerminal<D>;
    },
  ): Promise<void>;
  completeAndRelease(
    input: Omit<CommonTransition, "terminal"> & {
      readonly terminal: RuntimeTerminal<D>;
    },
  ): Promise<void>;
}
export interface RuntimeProjectionInput<D, R> {
  readonly decision: D;
  readonly request: R;
  readonly eventKind: ModelRuntimeAuditEventV1["eventKind"];
  readonly occurredAt: string;
  readonly projection: ModelRuntimeMetricProjectionV1;
  readonly referenceDigests: readonly Sha256Digest[];
  readonly safeReasonCodes: readonly string[];
  readonly sourceEvidenceDigest: Sha256Digest;
}
function telemetryOutboxEntry(pair: Pair): ModelRuntimeTelemetryOutboxEntryV1 {
  return { ...pair, outboxId: digestStructuredValue(pair) };
}
function mapCommercialDenialReason(
  reason: ModelCommercialDenialReasonV1,
): ModelRuntimeDenialReasonV1 {
  switch (reason) {
    case "organization-suspended":
      return "administratively-suspended";
    case "plan-not-entitled":
    case "feature-limit-reached":
      return "feature-not-entitled";
    case "route-not-allowed":
    case "model-not-allowed":
    case "pricing-unavailable":
      return "model-not-allow-listed";
    case "per-user-request-limit-reached":
      return "request-limit-exceeded";
    case "organization-concurrent-reservation-limit-reached":
      return "concurrency-limit-exceeded";
    case "maximum-input-exceeded":
      return "input-limit-exceeded";
    case "maximum-output-exceeded":
      return "output-limit-exceeded";
    case "cross-tenant-denied":
      return "routing-authority-mismatch";
    case "commercial-state-unavailable":
    case "confirmation-required":
    case "insufficient-credits":
    case "reservation-denied":
      return "insufficient-credits";
  }
}

/** Shared execution of an already authenticated, atomically claimed request.
 * Version-specific wrappers own parsing, initial authority and final dispatch
 * rechecks. This module is intentionally absent from public package exports. */
export async function runClaimedRuntimeExecution<
  D extends RuntimeExecutionDecision,
  R extends RuntimeExecutionRequest,
>(input: {
  readonly parsed: {
    readonly admissionDecision: D;
    readonly admissionRequest: R;
    readonly inputEvidence: ModelRuntimeInputEvidenceV1;
    readonly policy: Pick<ModelRuntimeControlPolicyV1, "limits">;
    readonly liveEvaluationAuthority: RuntimeLiveExecutionBounds | undefined;
    readonly routingDecision: ModelRoutingDecisionV1;
  };
  readonly supplied: {
    readonly commercialRequest: ModelCommercialOperationRequestV1;
  };
  readonly claimResult: {
    readonly executionLease: ModelRuntimeExecutionLeaseV1;
    readonly pending: RuntimeTerminal<D> | null;
  };
  readonly claim: {
    readonly fingerprint: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
  };
  readonly store: RuntimeExecutionStore<D>;
  readonly commercialPort: ModelRuntimeCanonicalCommercialPortV1;
  readonly evidenceVerifier: ModelRuntimeHostEvidenceVerifierV1;
  readonly now: () => string;
  readonly invoke: (
    context: ModelRuntimeControlledInvocationContextV1,
  ) => Promise<ModelRuntimeControlledInvocationResultV1>;
  readonly assertCurrentDispatchAuthority: () => Promise<void>;
  readonly drainOutbox: (input: {
    readonly fingerprint: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
  }) => Promise<void>;
  readonly safeTelemetryPair: (input: {
    readonly decision: D;
    readonly request: R;
    readonly eventKind: ModelRuntimeAuditEventV1["eventKind"];
    readonly occurredAt: string;
    readonly safeReasons?: readonly ModelRuntimeDenialReasonV1[];
  }) => Pair;
  readonly operationalProjectionPair: (
    input: RuntimeProjectionInput<D, R>,
  ) => Pair;
}): Promise<RuntimeTerminal<D> & { readonly replayed: false }> {
  const {
    parsed,
    supplied,
    claimResult,
    claim,
    store,
    commercialPort,
    evidenceVerifier,
    now,
    invoke,
    assertCurrentDispatchAuthority,
    drainOutbox,
    safeTelemetryPair,
    operationalProjectionPair,
  } = input;
  const { executionLease, pending } = claimResult;
  const hadPendingSettlement = pending !== null;
  let leaseTransitioned = false;
  try {
    await drainOutbox({
      fingerprint: claim.fingerprint,
      tenantScopeDigest: claim.tenantScopeDigest,
    });
    await store.assertExecutionLease({
      commercialExpiresAt: supplied.commercialRequest.expiresAt,
      executionLease,
      tenantScopeDigest: claim.tenantScopeDigest,
      trustedNow: now(),
    });
    const invocationState: {
      commercialEstimateEvidenceDigest: Sha256Digest | null;
      estimatedMicroUsd: number | null;
      evidenceDigest: Sha256Digest | null;
      latencyMilliseconds: number | null;
      output: ModelRuntimeSanitizedOutputEvidenceV1 | null;
      outputRejected: boolean;
    } = {
      commercialEstimateEvidenceDigest: null,
      estimatedMicroUsd: null,
      evidenceDigest: null,
      latencyMilliseconds: null,
      output: pending?.output ?? null,
      outputRejected: false,
    };
    const safetyReasons = new Set<ModelRuntimeDenialReasonV1>();
    const commercial = executionLease.recoveryOnly
      ? await commercialPort.recover(supplied.commercialRequest)
      : await commercialPort.execute(
          supplied.commercialRequest,
          async (commercialContext) => {
            if (hadPendingSettlement) {
              throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
            }
            const immediatelyBeforeInvoke = now();
            await store.assertExecutionLease({
              commercialExpiresAt: supplied.commercialRequest.expiresAt,
              executionLease,
              tenantScopeDigest: claim.tenantScopeDigest,
              trustedNow: immediatelyBeforeInvoke,
            });
            assertReservedCallback({
              admissionDecision: parsed.admissionDecision,
              admissionRequest: parsed.admissionRequest,
              commercial: commercialContext,
              liveEvaluationAuthority: parsed.liveEvaluationAuthority,
              now: assertInstant(immediatelyBeforeInvoke),
              routingDecision: parsed.routingDecision,
            });
            invocationState.commercialEstimateEvidenceDigest =
              digestStructuredValue(commercialContext);
            invocationState.estimatedMicroUsd =
              commercialContext.acceptedMaximumEstimatedProviderCostMicros;
            const assertCurrentExecution = async (): Promise<void> => {
              await store.assertExecutionLease({
                commercialExpiresAt: supplied.commercialRequest.expiresAt,
                executionLease,
                tenantScopeDigest: claim.tenantScopeDigest,
                trustedNow: now(),
              });
            };
            const checked = await verifyRuntimeInvocationOutput(
              await invoke({
                commercial: structuredClone(commercialContext),
                inputEvidence: structuredClone(parsed.inputEvidence),
                assertCurrentExecution,
                assertCurrentDispatch: async () => {
                  await assertCurrentExecution();
                  await assertCurrentDispatchAuthority();
                  await assertCurrentExecution();
                  const expiresAt = Math.min(
                    assertInstant(executionLease.expiresAt),
                    assertInstant(supplied.commercialRequest.expiresAt),
                    parsed.admissionDecision.expiresAt === undefined
                      ? Infinity
                      : assertInstant(parsed.admissionDecision.expiresAt),
                    parsed.liveEvaluationAuthority === undefined
                      ? Infinity
                      : assertInstant(parsed.liveEvaluationAuthority.expiresAt),
                  );
                  if (assertInstant(now()) >= expiresAt)
                    throw new ModelRuntimeControlError(
                      "stale-or-duplicate-conflict",
                    );
                  return { expiresAt: new Date(expiresAt).toISOString() };
                },
              }),
              {
                admissionRequest: parsed.admissionRequest,
                commercialRequest: supplied.commercialRequest,
                evidenceVerifier: evidenceVerifier,
                liveEvaluationAuthority: parsed.liveEvaluationAuthority,
                policy: parsed.policy,
                routingDecision: parsed.routingDecision,
              },
            );
            invocationState.latencyMilliseconds =
              checkedInvocationLatencyMilliseconds(checked.commercial);
            invocationState.evidenceDigest = digestStructuredValue(
              checked.commercial,
            );
            invocationState.output = checked.output;
            invocationState.outputRejected = checked.rejected;
            if (checked.rejected) safetyReasons.add("output-limit-exceeded");
            await assertCurrentExecution();
            return checked.commercial;
          },
        );
    const commerciallyDenied = [
      "denied",
      "estimate-confirmation-required",
      "reservation-denied",
    ].includes(commercial.state);
    if (
      commerciallyDenied &&
      (commercial.denialReason === null ||
        commercial.reservationAccepted ||
        invocationState.evidenceDigest !== null)
    ) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    if (!commerciallyDenied && commercial.denialReason !== null) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    if (
      commercialUsageExceedsBounds({
        admissionRequest: parsed.admissionRequest,
        commercialRequest: supplied.commercialRequest,
        policy: parsed.policy,
        response: commercial,
        routingDecision: parsed.routingDecision,
      })
    ) {
      invocationState.output = null;
      invocationState.outputRejected = true;
      safetyReasons.add("output-limit-exceeded");
    }
    if (invocationState.output !== null && commercial.technicalUnits === null) {
      invocationState.output = null;
      invocationState.outputRejected = true;
      safetyReasons.add("output-limit-exceeded");
    }
    const liveLimits = parsed.liveEvaluationAuthority?.limits;
    if (
      liveLimits !== undefined &&
      commercial.technicalUnits !== null &&
      (commercial.technicalUnits.inputUnits > liveLimits.maximumInputTokens ||
        commercial.technicalUnits.outputUnits >
          liveLimits.maximumOutputTokens ||
        commercial.technicalUnits.totalUnits > liveLimits.maximumTotalTokens)
    ) {
      invocationState.output = null;
      invocationState.outputRejected = true;
      safetyReasons.add("live-evaluation-not-authorized");
    }
    const terminal = {
      admission: parsed.admissionDecision,
      commercial,
      output: invocationState.output,
    } satisfies RuntimeTerminal<D>;
    const terminalAt = now();
    const terminalPairs: {
      readonly audit: ModelRuntimeAuditEventV1;
      readonly metric: ModelRuntimeMetricV1;
    }[] = [];
    if (invocationState.outputRejected) {
      terminalPairs.push(
        safeTelemetryPair({
          decision: parsed.admissionDecision,
          eventKind: "safety-issue",
          occurredAt: terminalAt,
          request: parsed.admissionRequest,
          safeReasons: orderedReasons(safetyReasons),
        }),
      );
    }
    if (commerciallyDenied) {
      const denialReason = commercial.denialReason;
      if (denialReason === null) {
        throw new ModelRuntimeControlError("routing-authority-mismatch");
      }
      terminalPairs.push(
        safeTelemetryPair({
          decision: parsed.admissionDecision,
          eventKind: "deny",
          occurredAt: terminalAt,
          request: parsed.admissionRequest,
          safeReasons: [mapCommercialDenialReason(denialReason)],
        }),
      );
    }
    if (
      !hadPendingSettlement &&
      invocationState.estimatedMicroUsd !== null &&
      invocationState.commercialEstimateEvidenceDigest !== null
    ) {
      terminalPairs.push(
        operationalProjectionPair({
          decision: parsed.admissionDecision,
          eventKind: "estimated-cost",
          occurredAt: terminalAt,
          projection: {
            sourceAuthority: "canonical-commercial-v1",
            unit: "estimated-micro-usd",
            value: invocationState.estimatedMicroUsd,
          },
          referenceDigests: [],
          request: parsed.admissionRequest,
          safeReasonCodes: [],
          sourceEvidenceDigest:
            invocationState.commercialEstimateEvidenceDigest,
        }),
      );
    }
    if (commercial.reservationAccepted && !hadPendingSettlement) {
      terminalPairs.push(
        safeTelemetryPair({
          decision: parsed.admissionDecision,
          eventKind: "reserve",
          occurredAt: terminalAt,
          request: parsed.admissionRequest,
        }),
      );
    }
    const commercialEvidenceDigest = digestStructuredValue(commercial);
    if (commercial.state === "released") {
      terminalPairs.push(
        safeTelemetryPair({
          decision: parsed.admissionDecision,
          eventKind: "release",
          occurredAt: terminalAt,
          request: parsed.admissionRequest,
        }),
      );
    } else if (
      commercial.state === "completed" ||
      commercial.state === "compensated"
    ) {
      terminalPairs.push(
        safeTelemetryPair({
          decision: parsed.admissionDecision,
          eventKind: "settle",
          occurredAt: terminalAt,
          request: parsed.admissionRequest,
        }),
      );
    } else if (commercial.state === "reconciliation-required") {
      terminalPairs.push(
        operationalProjectionPair({
          decision: parsed.admissionDecision,
          eventKind: "safety-issue",
          occurredAt: terminalAt,
          projection: {
            sourceAuthority: "runtime-control-v1",
            unit: "count",
            value: 1,
          },
          referenceDigests: [],
          request: parsed.admissionRequest,
          safeReasonCodes: ["cloudmarkup.runtime.reconciliation-required"],
          sourceEvidenceDigest: commercialEvidenceDigest,
        }),
      );
    }
    if (commercial.completedCreditUnits !== null) {
      terminalPairs.push(
        operationalProjectionPair({
          decision: parsed.admissionDecision,
          eventKind: "credits",
          occurredAt: terminalAt,
          projection: {
            sourceAuthority: "canonical-commercial-v1",
            unit: "credit-units",
            value: commercial.completedCreditUnits,
          },
          referenceDigests: [],
          request: parsed.admissionRequest,
          safeReasonCodes: [],
          sourceEvidenceDigest: commercialEvidenceDigest,
        }),
      );
    }
    if (!hadPendingSettlement && commercial.technicalUnits !== null) {
      terminalPairs.push(
        operationalProjectionPair({
          decision: parsed.admissionDecision,
          eventKind: "tokens",
          occurredAt: terminalAt,
          projection: {
            sourceAuthority: "canonical-model-usage-v1",
            unit: "tokens",
            value: commercial.technicalUnits.totalUnits,
          },
          referenceDigests: [],
          request: parsed.admissionRequest,
          safeReasonCodes: [],
          sourceEvidenceDigest: commercialEvidenceDigest,
        }),
      );
    }
    if (
      !hadPendingSettlement &&
      invocationState.evidenceDigest !== null &&
      invocationState.latencyMilliseconds !== null
    ) {
      terminalPairs.push(
        operationalProjectionPair({
          decision: parsed.admissionDecision,
          eventKind: "latency",
          occurredAt: terminalAt,
          projection: {
            sourceAuthority: "canonical-model-usage-v1",
            unit: "milliseconds",
            value: invocationState.latencyMilliseconds,
          },
          referenceDigests: [],
          request: parsed.admissionRequest,
          safeReasonCodes: [],
          sourceEvidenceDigest: invocationState.evidenceDigest,
        }),
      );
    }
    if (commercial.state === "settlement-pending") {
      await store.checkpointPendingAndRelease({
        executionLease,
        fingerprint: claim.fingerprint,
        pending: terminal,
        pendingOutbox: terminalPairs.map(telemetryOutboxEntry),
        tenantScopeDigest: claim.tenantScopeDigest,
        trustedNow: terminalAt,
      });
      leaseTransitioned = true;
    } else {
      await store.completeAndRelease({
        executionLease,
        fingerprint: claim.fingerprint,
        tenantScopeDigest: claim.tenantScopeDigest,
        terminal,
        terminalOutbox: terminalPairs.map(telemetryOutboxEntry),
        trustedNow: terminalAt,
      });
      leaseTransitioned = true;
    }
    await drainOutbox({
      fingerprint: claim.fingerprint,
      tenantScopeDigest: claim.tenantScopeDigest,
    });
    return { ...terminal, replayed: false };
  } finally {
    if (!leaseTransitioned) {
      await store.release({
        executionLease,
        tenantScopeDigest: claim.tenantScopeDigest,
      });
    }
  }
}
