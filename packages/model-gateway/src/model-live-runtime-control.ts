import {
  modelLiveEvaluationPlanV2Schema,
  modelLiveRuntimeAdmissionDecisionV2Schema,
  modelRoutingDecisionV1Schema,
  modelRoutingRequestV1Schema,
  modelRuntimeStateSnapshotV1Schema,
  type ModelLiveRuntimeAdmissionDecisionV2,
  type ModelLiveRuntimeAdmissionRequestV2,
  type ModelRuntimeInputEvidenceV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import type {
  ModelRuntimeCanonicalCommercialPortV1,
  ModelRuntimeControlledInvocationContextV1,
  ModelRuntimeControlledInvocationResultV1,
  ModelRuntimeHostEvidenceVerifierV1,
  ModelRuntimeTelemetryPortV1,
} from "./model-runtime-controls.js";
import { parseModelRuntimeTelemetryOutboxEntryV1 } from "./model-runtime-controls.js";
import type {
  ModelLiveRuntimeAdmissionClaimV2,
  ModelLiveRuntimeAdmissionStoreV2,
  ModelLiveRuntimeAdmissionTerminalV2,
} from "./model-live-runtime-admission.js";
import {
  assertLiveRuntimeDecisionBinding,
  liveRuntimeExecutionFingerprint,
  parseLiveRuntimeExecutionInput,
  type ParsedLiveRuntimeExecution,
  type ModelLiveRuntimeAuthorityBundleV2,
  type ModelLiveRuntimeControlExecutionInputV2,
} from "./model-live-runtime-execution-metadata.js";
import { validateModelLiveEvaluationRequestV2 } from "./model-live-evaluation-plan.js";
import {
  assertDecisionMatches,
  assertInstant,
  authenticateInputEvidence,
  tenantScopeDigest,
} from "./model-runtime-execution-bindings.js";
import { runClaimedRuntimeExecution } from "./model-runtime-execution.js";
import {
  ModelRuntimeControlError,
  orderedReasons,
} from "./model-runtime-errors.js";
import {
  expectedSharedStaticDenialReasons,
  expectedRuntimeDenialReasons,
} from "./model-runtime-shared-controls.js";
import {
  runtimeTelemetryPair,
  runtimeOperationalProjectionPair,
} from "./model-runtime-telemetry.js";
import { digestStructuredValue } from "./security.js";

export type ModelLiveRuntimeAuthorityPurposeV2 =
  "execution" | "dispatch" | "output" | "recovery";
export interface ModelLiveRuntimeAuthorityResolverV2 {
  /** Host-owned authority only. Authenticate current execution tenant/project,
   * actual issued plan, exact frozen input and immutable routing from trusted
   * configuration. Every purpose except recovery requires current approval.
   * Recovery authenticates historical issuance and grants no new model work.
   * Candidate metadata is comparison input, never an authority source. */
  resolve(input: {
    readonly candidate: ModelLiveRuntimeAuthorityBundleV2;
    readonly request: ModelLiveRuntimeAdmissionRequestV2;
    readonly inputEvidence: ModelRuntimeInputEvidenceV1;
    readonly purpose: ModelLiveRuntimeAuthorityPurposeV2;
  }): Promise<ModelLiveRuntimeAuthorityBundleV2>;
}
export interface ModelLiveRuntimeControlServiceDependenciesV2 {
  readonly authorityResolver: ModelLiveRuntimeAuthorityResolverV2;
  readonly commercial: ModelRuntimeCanonicalCommercialPortV1;
  readonly evidenceVerifier: ModelRuntimeHostEvidenceVerifierV1;
  readonly now: () => string;
  readonly store: ModelLiveRuntimeAdmissionStoreV2;
  readonly telemetry: ModelRuntimeTelemetryPortV1;
}
export interface ModelLiveRuntimeControlExecutionResultV2 extends ModelLiveRuntimeAdmissionTerminalV2 {
  readonly replayed: boolean;
}
type Invoke = (
  context: ModelRuntimeControlledInvocationContextV1,
) => Promise<ModelRuntimeControlledInvocationResultV1>;

/** Explicit evaluation execution through shared capacity, leases, canonical
 * accounting and output checks. Does not accept V1 report metadata or issue
 * reports/promotion. Production requires real host issuers and the platform
 * HTTP adapter wired to the provided final dispatch assertion. */
export class ModelLiveRuntimeControlServiceV2 {
  readonly #authorityResolver: ModelLiveRuntimeAuthorityResolverV2;
  readonly #commercial: ModelRuntimeCanonicalCommercialPortV1;
  readonly #evidenceVerifier: ModelRuntimeHostEvidenceVerifierV1;
  readonly #now: () => string;
  readonly #store: ModelLiveRuntimeAdmissionStoreV2;
  readonly #telemetry: ModelRuntimeTelemetryPortV1;
  constructor(dependencies: ModelLiveRuntimeControlServiceDependenciesV2) {
    this.#authorityResolver = dependencies.authorityResolver;
    this.#commercial = dependencies.commercial;
    this.#evidenceVerifier = dependencies.evidenceVerifier;
    this.#now = dependencies.now;
    this.#store = dependencies.store;
    this.#telemetry = dependencies.telemetry;
  }
  async #authenticate(
    parsed: ParsedLiveRuntimeExecution,
    purpose: ModelLiveRuntimeAuthorityPurposeV2,
  ) {
    const candidate = {
      plan: parsed.plan,
      routingDecision: parsed.routingDecision,
      routingRequest: parsed.routingRequest,
    };
    const supplied = await this.#authorityResolver.resolve({
      candidate: structuredClone(candidate),
      request: structuredClone(parsed.admissionRequest),
      inputEvidence: structuredClone(parsed.inputEvidence),
      purpose,
    });
    const current = {
      plan: modelLiveEvaluationPlanV2Schema.parse(supplied.plan),
      routingDecision: modelRoutingDecisionV1Schema.parse(
        supplied.routingDecision,
      ),
      routingRequest: modelRoutingRequestV1Schema.parse(
        supplied.routingRequest,
      ),
    };
    if (digestStructuredValue(candidate) !== digestStructuredValue(current))
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    if (purpose !== "recovery")
      validateModelLiveEvaluationRequestV2({
        request: parsed.admissionRequest,
        plan: current.plan,
        inputEvidence: parsed.inputEvidence,
        observedAt: this.#now(),
      });
  }
  async #drainOutbox(identity: {
    readonly fingerprint: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
  }) {
    for (const raw of await this.#store.listPendingOutbox(identity)) {
      const entry = parseModelRuntimeTelemetryOutboxEntryV1(raw);
      await this.#telemetry.publish({
        audit: entry.audit,
        metric: entry.metric,
      });
      await this.#store.acknowledgeOutbox({
        ...identity,
        outboxId: entry.outboxId,
      });
    }
  }
  execute(
    input: ModelLiveRuntimeControlExecutionInputV2,
    invoke: Invoke,
  ): Promise<ModelLiveRuntimeControlExecutionResultV2> {
    return this.#run(input, invoke, false);
  }
  /** An explicit historical entry point with no invocation callback. It must
   * find the original durable admission and can only reclaim a recovery lease. */
  recover(
    input: ModelLiveRuntimeControlExecutionInputV2,
  ): Promise<ModelLiveRuntimeControlExecutionResultV2> {
    return this.#run(
      input,
      () => {
        return Promise.reject(
          new ModelRuntimeControlError("stale-or-duplicate-conflict"),
        );
      },
      true,
    );
  }
  async #run(
    supplied: ModelLiveRuntimeControlExecutionInputV2,
    invoke: Invoke,
    recoveryOnly: boolean,
  ): Promise<ModelLiveRuntimeControlExecutionResultV2> {
    try {
      const parsed = parseLiveRuntimeExecutionInput(supplied);
      parsed.inputEvidence = await authenticateInputEvidence({
        admissionRequest: parsed.admissionRequest,
        inputEvidence: parsed.inputEvidence,
        evidenceVerifier: this.#evidenceVerifier,
      });
      await this.#authenticate(parsed, recoveryOnly ? "recovery" : "execution");
      const trustedNow = this.#now();
      const request = parsed.admissionRequest;
      const decision = parsed.admissionDecision;
      const policy = parsed.policy;
      const stateRequest = {
        decidedAt: trustedNow,
        idempotencyKeyDigest: request.idempotencyKeyDigest,
        liveAuthorityReservation: parsed.liveAuthorityReservation,
        organizationId: request.organizationId,
        organizationWindowSeconds:
          policy.requestWindows.organization.windowSeconds,
        projectId: request.projectId,
        requestDigest: request.requestDigest,
        runtimePolicyDigest: policy.policyDigest,
        tenantScopeDigest: tenantScopeDigest(request),
        userId: request.userId,
        userWindowSeconds: policy.requestWindows.user.windowSeconds,
      };
      const snapshot = modelRuntimeStateSnapshotV1Schema.parse(
        await this.#store.inspect(stateRequest),
      );
      if (
        snapshot.organizationId !== request.organizationId ||
        snapshot.projectId !== request.projectId ||
        snapshot.userId !== request.userId ||
        snapshot.requestDigest !== request.requestDigest ||
        snapshot.policyDigest !== policy.policyDigest ||
        snapshot.capturedAt !== trustedNow ||
        (recoveryOnly && !snapshot.idempotencyReplay)
      )
        throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
      const reasons = orderedReasons(
        new Set([
          ...expectedSharedStaticDenialReasons(parsed),
          ...expectedRuntimeDenialReasons({
            liveAuthorityReservation: parsed.liveAuthorityReservation,
            policy,
            replayDenialReasons: decision.denialReasons,
            runtimeState: snapshot,
          }),
        ]),
      );
      assertDecisionMatches(decision, reasons, trustedNow, {
        ...parsed,
        runtimeState: snapshot,
      });
      const authorityDigests = [
        request.liveEvaluationPlanDigest,
        request.liveEvaluationAuthorityDigest,
        request.evaluationCaseDigest,
        request.evaluationAuthorityTupleDigest,
      ];
      const pair = (eventKind: "request" | "model-route" | "deny") =>
        runtimeTelemetryPair({
          decision,
          request,
          eventKind,
          occurredAt: trustedNow,
          authorityDigests,
          ...(eventKind === "deny" ? { safeReasons: reasons } : {}),
        });
      const allowed = decision.outcome === "allowed";
      const leaseId = decision.authorization.concurrencyLeaseId;
      if (allowed !== (leaseId !== undefined))
        throw new ModelRuntimeControlError("routing-authority-mismatch");
      const claim: ModelLiveRuntimeAdmissionClaimV2 = {
        ...stateRequest,
        admissionRequest: request,
        admissionDecision: decision,
        acquire: allowed,
        claimOutbox: [
          pair("request"),
          pair(allowed ? "model-route" : "deny"),
        ].map((p) => ({ ...p, outboxId: digestStructuredValue(p) })),
        commercialExpiresAt: parsed.commercialRequest.expiresAt,
        executionLeaseExpiresAt: new Date(
          assertInstant(trustedNow) + 300000,
        ).toISOString(),
        ...(allowed
          ? {}
          : {
              deniedTerminal: {
                admission: decision,
                commercial: null,
                output: null,
              },
            }),
        fingerprint: liveRuntimeExecutionFingerprint(parsed),
        ...(leaseId === undefined ? {} : { leaseId }),
        limits: {
          maximumConcurrentOrganizationJobs:
            policy.requestWindows.organization.maximumConcurrentJobs,
          maximumConcurrentUserJobs:
            policy.requestWindows.user.maximumConcurrentJobs,
          maximumOrganizationRequests:
            policy.requestWindows.organization.maximumRequests,
          maximumUserRequests: policy.requestWindows.user.maximumRequests,
        },
        snapshotDigest: snapshot.snapshotDigest,
        snapshotId: snapshot.snapshotId,
      };
      const result = await this.#store.claim(claim);
      if (result.kind === "duplicate-terminal" || result.kind === "denied") {
        assertLiveRuntimeDecisionBinding(
          modelLiveRuntimeAdmissionDecisionV2Schema.parse(
            result.terminal.admission,
          ),
          request,
        );
        await this.#drainOutbox(claim);
        return {
          ...result.terminal,
          replayed: result.kind === "duplicate-terminal",
        };
      }
      if (result.kind !== "claimed") {
        if (result.kind === "duplicate-in-progress")
          await this.#drainOutbox(claim);
        throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
      }
      try {
        const canonical = modelLiveRuntimeAdmissionDecisionV2Schema.parse(
          result.admissionDecision,
        );
        assertLiveRuntimeDecisionBinding(canonical, request);
        if (
          liveRuntimeExecutionFingerprint({
            ...parsed,
            admissionDecision: canonical,
          }) !== claim.fingerprint ||
          (recoveryOnly && !result.executionLease.recoveryOnly)
        )
          throw new ModelRuntimeControlError("routing-authority-mismatch");
        parsed.admissionDecision = canonical;
      } catch (error) {
        await this.#store.release({
          executionLease: result.executionLease,
          tenantScopeDigest: claim.tenantScopeDigest,
        });
        throw error;
      }
      return await runClaimedRuntimeExecution<
        ModelLiveRuntimeAdmissionDecisionV2,
        ModelLiveRuntimeAdmissionRequestV2
      >({
        parsed,
        supplied: { commercialRequest: parsed.commercialRequest },
        claim,
        claimResult: result,
        store: this.#store,
        commercialPort: this.#commercial,
        evidenceVerifier: this.#evidenceVerifier,
        now: this.#now,
        drainOutbox: (identity) => this.#drainOutbox(identity),
        assertCurrentDispatchAuthority: () =>
          this.#authenticate(parsed, "dispatch"),
        safeTelemetryPair: (projection) =>
          runtimeTelemetryPair({ ...projection, authorityDigests }),
        operationalProjectionPair: (projection) =>
          runtimeOperationalProjectionPair({ ...projection, authorityDigests }),
        invoke: async (context) => {
          const output = await invoke(context);
          if (output.output !== null)
            await this.#authenticate(parsed, "output");
          return output;
        },
      });
    } catch (error) {
      if (error instanceof ModelRuntimeControlError) throw error;
      throw new ModelRuntimeControlError("runtime-control-unavailable");
    }
  }
}
