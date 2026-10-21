import {
  modelCacheKeyInputV1Schema,
  modelEvaluationRegressionV1Schema,
  modelEvaluationReportV1Schema,
  modelLiveEvaluationAuthorityV1Schema,
  modelRoutingDecisionV1Schema,
  modelRoutingRequestV1Schema,
  modelRuntimeAdmissionDecisionV1Schema,
  modelRuntimeAdmissionRequestV1Schema,
  modelRuntimeAuditEventV1Schema,
  modelRuntimeControlPolicyV1Schema,
  modelRuntimeInputEvidenceV1Schema,
  modelRuntimeMetricV1Schema,
  modelRuntimeStateSnapshotV1Schema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
  type ModelCacheKeyInputV1,
  type ModelEvaluationRegressionV1,
  type ModelEvaluationReportV1,
  type ModelLiveEvaluationAuthorityV1,
  type ModelRoutingDecisionV1,
  type ModelRoutingRequestV1,
  type ModelRuntimeAdmissionDecisionV1,
  type ModelRuntimeAdmissionRequestV1,
  type ModelRuntimeAuditEventV1,
  type ModelRuntimeControlPolicyV1,
  type ModelRuntimeHostEvidenceV1,
  type ModelRuntimeInputEvidenceV1,
  type ModelRuntimeMetricV1,
  type ModelRuntimeStateSnapshotV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import type {
  ModelCommercialInvocationContextV1,
  ModelCommercialInvocationResultV1,
  ModelCommercialLifecycleResponseV1,
  ModelCommercialOperationRequestV1,
} from "./commercial-lifecycle.js";
import { projectModelCommercialOperationIdentityV1 } from "./commercial-lifecycle.js";
import {
  frozenModelEvaluationDatasetV1,
  modelEvaluationScoringPolicyV1,
} from "./model-evaluation.js";
import {
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
} from "./security.js";

import {
  ModelRuntimeControlError,
  orderedReasons,
  type ModelRuntimeDenialReasonV1,
} from "./model-runtime-errors.js";
import {
  expectedRuntimeDenialReasons,
  expectedSharedStaticDenialReasons,
} from "./model-runtime-shared-controls.js";
export { ModelRuntimeControlError } from "./model-runtime-errors.js";
import {
  runtimeTelemetryPair,
  runtimeOperationalProjectionPair,
} from "./model-runtime-telemetry.js";
import {
  runClaimedRuntimeExecution,
  type ModelRuntimeMetricProjectionV1,
} from "./model-runtime-execution.js";
import {
  assertInstant,
  plannedMaximums,
  assertCommercialBindings,
  assertDecisionMatches,
  tenantScopeDigest,
  assertInputEvidenceBindings,
  authenticateInputEvidence,
  assertRuntimeRoutingBindings,
  assertRuntimeCacheBindings,
  verifyRuntimeInvocationOutput,
} from "./model-runtime-execution-bindings.js";

export interface ModelRuntimeCanonicalCommercialPortV1 {
  execute(
    request: ModelCommercialOperationRequestV1,
    invoke: (
      context: ModelCommercialInvocationContextV1,
    ) => Promise<ModelCommercialInvocationResultV1>,
  ): Promise<ModelCommercialLifecycleResponseV1>;
  /** Accounting/workflow recovery only; must never reserve or invoke a model. */
  recover(
    request: ModelCommercialOperationRequestV1,
  ): Promise<ModelCommercialLifecycleResponseV1>;
}

export interface ModelRuntimeTelemetryPortV1 {
  /** Idempotent by exact event/metric identities; same identity with changed payload fails. */
  publish(input: {
    readonly audit: ModelRuntimeAuditEventV1;
    readonly metric: ModelRuntimeMetricV1;
  }): Promise<void>;
}

export interface ModelRuntimeTelemetryOutboxEntryV1 {
  readonly audit: ModelRuntimeAuditEventV1;
  readonly metric: ModelRuntimeMetricV1;
  readonly outboxId: Sha256Digest;
}

export interface ModelRuntimeExecutionLeaseV1 {
  readonly acquiredAt: string;
  readonly executionLeaseId: string;
  readonly expiresAt: string;
  readonly fencingToken: string;
  readonly recoveryOnly: boolean;
  readonly revision: number;
}

export interface ModelRuntimeHostEvidenceVerifierV1 {
  /** Authenticates one exact issued input record against durable host state. */
  verifyInputEvidence(input: {
    readonly evidence: ModelRuntimeInputEvidenceV1;
  }): Promise<boolean>;
  /** Authenticates one host-produced output record against durable verifier state. */
  verify(input: {
    readonly evidence: ModelRuntimeHostEvidenceV1;
    readonly expected: {
      readonly evidenceKind: ModelRuntimeHostEvidenceV1["evidenceKind"];
      readonly catalogDigest: Sha256Digest;
      readonly inputDigest: Sha256Digest;
      readonly operation: ModelRuntimeAdmissionRequestV1["operation"];
      readonly organizationId: string;
      readonly outputBytes: number;
      readonly outputDigest: Sha256Digest;
      readonly outputTokens: number;
      readonly projectId: string;
      readonly responseSchemaDigest: Sha256Digest;
      readonly runtimePolicyDigest: Sha256Digest;
    };
  }): Promise<boolean>;
  /** Authenticates one bounded post-execution outcome against durable host state. */
  verifyOperationalOutcome(input: {
    readonly authority: ModelRuntimeOperationalOutcomeAuthorityV1;
  }): Promise<boolean>;
}
export interface ModelRuntimeSanitizedOutputEvidenceV1 {
  /** Host-authenticated evidence; these records must never be self-attested by the model. */
  readonly allowListedOperationsEvidence: ModelRuntimeHostEvidenceV1;
  readonly noRawSensitiveContent: true;
  readonly outputBytes: number;
  readonly outputDigest: Sha256Digest;
  readonly outputTokens: number;
  readonly resultSanitized: true;
  readonly secretRedactionApplied: true;
  readonly sourceOwnershipEvidence: ModelRuntimeHostEvidenceV1;
  readonly structuredOutputValidated: true;
}

export interface ModelRuntimeControlledInvocationContextV1 {
  readonly commercial: ModelCommercialInvocationContextV1;
  readonly inputEvidence: ModelRuntimeInputEvidenceV1;
  /** Supplied by the real runtime; never serialized or caller-authored. Older
   * consumers may ignore it. Memory-only delivery requires this exact fence. */
  readonly assertCurrentExecution?: () => Promise<void>;
  /** Real runtime-owned final dispatch assertion. Re-resolves current route and
   * policy authority and returns the exact bounded execution/commercial expiry. */
  readonly assertCurrentDispatch?: () => Promise<{
    readonly expiresAt: string;
  }>;
}

export interface ModelRuntimeControlledInvocationResultV1 {
  readonly commercial: ModelCommercialInvocationResultV1;
  readonly output: ModelRuntimeSanitizedOutputEvidenceV1 | null;
}

export interface ModelRuntimeAdmissionTerminalV1 {
  readonly admission: ModelRuntimeAdmissionDecisionV1;
  readonly commercial: ModelCommercialLifecycleResponseV1 | null;
  readonly output: ModelRuntimeSanitizedOutputEvidenceV1 | null;
}

export interface ModelRuntimeLiveAuthorityReservationV1 {
  readonly authorityDigest: Sha256Digest;
  readonly limits: ModelLiveEvaluationAuthorityV1["limits"];
  /** Conservative authority-capacity reservation; never actual usage/accounting. */
  readonly planned: {
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
    readonly creditUnits: number;
    readonly estimatedMicroUsd: number;
    readonly inputTokens: number;
    readonly invocations: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
}

export interface ModelRuntimeStateSnapshotRequestV1 {
  readonly decidedAt: string;
  readonly liveAuthorityReservation?: ModelRuntimeLiveAuthorityReservationV1;
  readonly idempotencyKeyDigest: Sha256Digest;
  readonly organizationId: string;
  readonly organizationWindowSeconds: number;
  readonly projectId: string;
  readonly requestDigest: Sha256Digest;
  readonly runtimePolicyDigest: Sha256Digest;
  readonly tenantScopeDigest: Sha256Digest;
  readonly userId: string;
  readonly userWindowSeconds: number;
}
export interface ModelRuntimeAdmissionClaimV1 extends ModelRuntimeStateSnapshotRequestV1 {
  readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  readonly acquire: boolean;
  readonly claimOutbox: readonly ModelRuntimeTelemetryOutboxEntryV1[];
  readonly commercialExpiresAt: string;
  readonly deniedTerminal?: ModelRuntimeAdmissionTerminalV1;
  readonly executionLeaseExpiresAt: string;
  readonly fingerprint: Sha256Digest;
  readonly leaseId?: string;
  readonly limits: {
    readonly maximumConcurrentOrganizationJobs: number;
    readonly maximumConcurrentUserJobs: number;
    readonly maximumOrganizationRequests: number;
    readonly maximumUserRequests: number;
  };
  readonly snapshotDigest: Sha256Digest;
  readonly snapshotId: string;
}

export type ModelRuntimeAdmissionClaimResultV1 =
  | {
      /** Canonical originally persisted admission authority for terminal construction. */
      readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
      readonly executionLease: ModelRuntimeExecutionLeaseV1;
      readonly kind: "claimed";
      readonly pending: ModelRuntimeAdmissionTerminalV1 | null;
      readonly snapshot: ModelRuntimeStateSnapshotV1;
    }
  | {
      readonly kind: "denied";
      readonly snapshot: ModelRuntimeStateSnapshotV1;
      readonly terminal: ModelRuntimeAdmissionTerminalV1;
    }
  | {
      readonly kind: "duplicate-terminal";
      readonly terminal: ModelRuntimeAdmissionTerminalV1;
    }
  | { readonly kind: "duplicate-in-progress" }
  | { readonly kind: "expired" }
  | { readonly kind: "conflict" }
  | {
      readonly kind: "limit-changed";
      readonly reason:
        | "concurrency-limit-exceeded"
        | "live-evaluation-not-authorized"
        | "request-limit-exceeded";
      readonly snapshot: ModelRuntimeStateSnapshotV1;
    };

export interface ModelRuntimeAdmissionStoreV1 {
  /** Read authority for a decision; claim rechecks this digest atomically. */
  inspect(
    request: ModelRuntimeStateSnapshotRequestV1,
  ): Promise<ModelRuntimeStateSnapshotV1>;
  /** Atomically fences idempotency, request windows, active concurrency, and active lease-ID ownership. */
  claim(
    claim: ModelRuntimeAdmissionClaimV1,
  ): Promise<ModelRuntimeAdmissionClaimResultV1>;
  assertExecutionLease(input: {
    readonly commercialExpiresAt: string;
    readonly executionLease: ModelRuntimeExecutionLeaseV1;
    readonly tenantScopeDigest: Sha256Digest;
    readonly trustedNow: string;
  }): Promise<void>;
  checkpointPendingAndRelease(input: {
    readonly executionLease: ModelRuntimeExecutionLeaseV1;
    readonly fingerprint: Sha256Digest;
    readonly pending: ModelRuntimeAdmissionTerminalV1;
    readonly pendingOutbox: readonly ModelRuntimeTelemetryOutboxEntryV1[];
    readonly tenantScopeDigest: Sha256Digest;
    readonly trustedNow: string;
  }): Promise<void>;
  completeAndRelease(input: {
    readonly executionLease: ModelRuntimeExecutionLeaseV1;
    readonly fingerprint: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
    readonly terminal: ModelRuntimeAdmissionTerminalV1;
    readonly terminalOutbox: readonly ModelRuntimeTelemetryOutboxEntryV1[];
    readonly trustedNow: string;
  }): Promise<void>;
  listPendingOutbox(input: {
    readonly fingerprint: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
  }): Promise<readonly ModelRuntimeTelemetryOutboxEntryV1[]>;
  acknowledgeOutbox(input: {
    readonly fingerprint: Sha256Digest;
    readonly outboxId: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
  }): Promise<void>;
  /** Releases active concurrency only; request/live capacity remains consumed. */
  release(input: {
    readonly executionLease: ModelRuntimeExecutionLeaseV1;
    readonly tenantScopeDigest: Sha256Digest;
  }): Promise<void>;
  /** Reads only an immutable admitted execution; unexecuted and denied records fail closed. */
  readOperationalExecutionBinding(input: {
    readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
    readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
    readonly tenantScopeDigest: Sha256Digest;
  }): Promise<ModelRuntimePersistedExecutionBindingV1>;
  /** Atomically appends an authenticated post-execution entry to its execution outbox. */
  appendOperationalOutbox(input: {
    readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
    readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
    readonly entry: ModelRuntimeTelemetryOutboxEntryV1;
    readonly fingerprint: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
    readonly terminalDigest: Sha256Digest;
  }): Promise<void>;
}

export interface ModelRuntimeControlExecutionInputV1 {
  readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly evaluationReport: ModelEvaluationReportV1;
  readonly inputEvidence: ModelRuntimeInputEvidenceV1;
  readonly liveEvaluationAuthority?: ModelLiveEvaluationAuthorityV1;
  readonly policy: ModelRuntimeControlPolicyV1;
  readonly promptCacheKey?: ModelCacheKeyInputV1;
  readonly catalogDigest: Sha256Digest;
  readonly promptTemplateDigest: Sha256Digest;
  readonly responseSchemaDigest: Sha256Digest;
  readonly routingDecision: ModelRoutingDecisionV1;
  readonly routingRequest: ModelRoutingRequestV1;
}

export interface ModelRuntimeTrustedAuthorityBundleV1 {
  readonly catalogDigest: Sha256Digest;
  readonly evaluationReport: ModelEvaluationReportV1;
  readonly liveEvaluationAuthority: ModelLiveEvaluationAuthorityV1 | undefined;
  readonly policy: ModelRuntimeControlPolicyV1;
  readonly promptTemplateDigest: Sha256Digest;
  readonly responseSchemaDigest: Sha256Digest;
  readonly routingDecision: ModelRoutingDecisionV1;
  readonly routingRequest: ModelRoutingRequestV1;
}

export interface ModelRuntimeAuthorityResolverV1 {
  /** Resolve immutable current host authority; candidate is comparison input only. */
  resolve(input: {
    readonly candidate: ModelRuntimeTrustedAuthorityBundleV1;
    readonly executionClass: ModelRuntimeAdmissionRequestV1["executionClass"];
    readonly operation: ModelRuntimeAdmissionRequestV1["operation"];
    readonly organizationId: string;
    readonly projectId: string;
    readonly userId: string;
  }): Promise<ModelRuntimeTrustedAuthorityBundleV1>;
}

export interface ModelRuntimeControlExecutionResultV1 {
  readonly admission: ModelRuntimeAdmissionDecisionV1;
  readonly commercial: ModelCommercialLifecycleResponseV1 | null;
  readonly output: ModelRuntimeSanitizedOutputEvidenceV1 | null;
  readonly replayed: boolean;
}

export type ModelRuntimeOperationalEventKindV1 =
  | "import-inference"
  | "generation-result"
  | "repair-result"
  | "validator-failure"
  | "groundedness-failure"
  | "safety-issue";

export interface ModelRuntimeOperationalOutcomeAuthorityV1 {
  readonly authorityDigest: Sha256Digest;
  readonly contractVersion: 1;
  readonly decisionDigest: Sha256Digest;
  readonly eventKind: ModelRuntimeOperationalEventKindV1;
  readonly issuerId: string;
  readonly issuerVersion: string;
  readonly noRawSensitiveContent: true;
  readonly occurredAt: string;
  readonly operation: ModelRuntimeAdmissionRequestV1["operation"];
  readonly organizationId: string;
  readonly projectId: string;
  readonly recordKind: "model-runtime-operational-outcome-authority";
  readonly referenceDigests: readonly Sha256Digest[];
  readonly requestDigest: Sha256Digest;
  readonly safeReasonCodes: readonly string[];
  readonly sourceEvidenceDigests: readonly Sha256Digest[];
  readonly terminalDigest: Sha256Digest;
  readonly userId: string;
}

export interface ModelRuntimePersistedExecutionBindingV1 {
  readonly fingerprint: Sha256Digest;
  readonly tenantScopeDigest: Sha256Digest;
  readonly terminalDigest: Sha256Digest;
}

const runtimeOperationalOperations = Object.freeze({
  "generation-result": [
    "application-source.generate",
    "iac-extension.generate",
  ],
  "groundedness-failure": [
    "architecture.propose",
    "workload.propose",
    "external-resource.propose",
    "operations.propose",
    "repository.interpret",
    "fix.propose",
    "application-source.generate",
    "iac-extension.generate",
  ],
  "import-inference": ["repository.interpret"],
  "repair-result": ["candidate.repair"],
  "safety-issue": [
    "intent.extract",
    "requirements.blocking-questions",
    "architecture.propose",
    "workload.propose",
    "external-resource.propose",
    "operations.propose",
    "repository.interpret",
    "issue.explain",
    "deterministic-fix.explain",
    "fix.propose",
    "application-source.generate",
    "iac-extension.generate",
    "candidate.repair",
    "summary.plain-language",
    "summary.technical",
  ],
  "validator-failure": [
    "architecture.propose",
    "workload.propose",
    "external-resource.propose",
    "operations.propose",
    "repository.interpret",
    "fix.propose",
    "application-source.generate",
    "iac-extension.generate",
    "candidate.repair",
  ],
} satisfies Readonly<
  Record<
    ModelRuntimeOperationalEventKindV1,
    readonly ModelRuntimeAdmissionRequestV1["operation"][]
  >
>);

const runtimeOperationalReasonCodes = Object.freeze({
  "generation-result": [] as const,
  "groundedness-failure": ["cloudmarkup.runtime.groundedness-failure"] as const,
  "import-inference": [] as const,
  "repair-result": [] as const,
  "safety-issue": [
    "cloudmarkup.runtime.live-evaluation-not-authorized",
    "cloudmarkup.runtime.output-limit-exceeded",
    "cloudmarkup.runtime.reconciliation-required",
    "cloudmarkup.runtime.result-sanitization-failed",
  ] as const,
  "validator-failure": ["cloudmarkup.runtime.validator-failure"] as const,
} satisfies Readonly<
  Record<ModelRuntimeOperationalEventKindV1, readonly string[]>
>);

interface ModelRuntimeOperationalProjectionInputV1 {
  readonly decision: ModelRuntimeAdmissionDecisionV1;
  readonly eventKind: ModelRuntimeAuditEventV1["eventKind"];
  readonly occurredAt: string;
  readonly projection: ModelRuntimeMetricProjectionV1;
  readonly referenceDigests: readonly Sha256Digest[];
  readonly request: ModelRuntimeAdmissionRequestV1;
  readonly safeReasonCodes: readonly string[];
  readonly sourceEvidenceDigest: Sha256Digest;
}

export interface ModelRuntimeOperationalOutcomeV1 {
  readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  /** Current immutable authority candidate; the resolver remains authoritative. */
  readonly trustedAuthority: ModelRuntimeTrustedAuthorityBundleV1;
  /** Host-authenticated outcome and source-evidence binding; never model-authored. */
  readonly outcomeAuthority: ModelRuntimeOperationalOutcomeAuthorityV1;
}

export interface ModelRuntimeEvaluationRegressionOutcomeV1 {
  readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  readonly evaluationReport: ModelEvaluationReportV1;
  readonly regression: ModelEvaluationRegressionV1;
  /** Current immutable authority candidate; the resolver remains authoritative. */
  readonly trustedAuthority: ModelRuntimeTrustedAuthorityBundleV1;
}
export interface ModelRuntimeControlServiceDependenciesV1 {
  readonly authorityResolver: ModelRuntimeAuthorityResolverV1;
  readonly commercial: ModelRuntimeCanonicalCommercialPortV1;
  readonly evidenceVerifier: ModelRuntimeHostEvidenceVerifierV1;
  readonly now: () => string;
  readonly store: ModelRuntimeAdmissionStoreV1;
  readonly telemetry: ModelRuntimeTelemetryPortV1;
}

const MODEL_RUNTIME_EXECUTION_LEASE_MILLISECONDS = 5 * 60 * 1000;

function runtimeExecutionLeaseExpiresAt(acquiredAt: string): string {
  return new Date(
    assertInstant(acquiredAt) + MODEL_RUNTIME_EXECUTION_LEASE_MILLISECONDS,
  ).toISOString();
}

function sameOrderedValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function assertRoutingBindings(input: {
  readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  readonly policy: ModelRuntimeControlPolicyV1;
  readonly routingDecision: ModelRoutingDecisionV1;
  readonly routingRequest: ModelRoutingRequestV1;
}): void {
  assertRuntimeRoutingBindings({
    ...input,
    evaluationRequirement: input.policy.evaluationGate,
  });
}

function assertEvaluationBindings(input: {
  readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  readonly catalogDigest: Sha256Digest;
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly evaluationReport: ModelEvaluationReportV1;
  readonly policy: ModelRuntimeControlPolicyV1;
  readonly promptTemplateDigest: Sha256Digest;
  readonly responseSchemaDigest: Sha256Digest;
  readonly routingDecision: ModelRoutingDecisionV1;
}): void {
  const {
    admissionDecision,
    admissionRequest,
    catalogDigest,
    commercialRequest,
    evaluationReport,
    policy,
    promptTemplateDigest,
    responseSchemaDigest,
    routingDecision,
  } = input;
  const gate = policy.evaluationGate;
  const tuple = gate.authorityTuple;
  const reportBinding = evaluationReport.authorityBindings.find(
    (binding) => binding.authorityTupleDigest === gate.authorityTupleDigest,
  );
  const deterministicFakeRoute =
    routingDecision.providerFamily === "deterministic-fake";
  const deterministicFakeEvidence =
    evaluationReport.executionMode === "deterministic-fake";
  if (
    reportBinding === undefined ||
    gate.datasetDigest !== evaluationReport.datasetDigest ||
    !sameOrderedValues(
      gate.datasetCaseDigests,
      evaluationReport.datasetCaseDigests,
    ) ||
    (deterministicFakeEvidence &&
      (evaluationReport.datasetDigest !==
        frozenModelEvaluationDatasetV1.datasetDigest ||
        !sameOrderedValues(
          evaluationReport.datasetCaseDigests,
          frozenModelEvaluationDatasetV1.cases.map(
            ({ caseDigest }) => caseDigest,
          ),
        ))) ||
    gate.evaluationReportId !== evaluationReport.evaluationReportId ||
    gate.evaluationReportDigest !== evaluationReport.reportDigest ||
    gate.evaluationResultSetDigest !==
      evaluationReport.evaluationResultSetDigest ||
    gate.deterministicPassed !== evaluationReport.deterministicPassed ||
    gate.deterministicQualityBasisPoints !==
      evaluationReport.deterministicQualityBasisPoints ||
    evaluationReport.deterministicQualityBasisPoints <
      gate.minimumDeterministicQualityBasisPoints ||
    admissionRequest.evaluationReportId !==
      evaluationReport.evaluationReportId ||
    admissionRequest.evaluationReportDigest !== evaluationReport.reportDigest ||
    admissionRequest.evaluationResultSetDigest !==
      evaluationReport.evaluationResultSetDigest ||
    admissionRequest.evaluationAuthorityTupleDigest !==
      gate.authorityTupleDigest ||
    admissionDecision.evaluationReportId !==
      evaluationReport.evaluationReportId ||
    admissionDecision.evaluationReportDigest !==
      evaluationReport.reportDigest ||
    admissionDecision.evaluationResultSetDigest !==
      evaluationReport.evaluationResultSetDigest ||
    admissionDecision.evaluationAuthorityTupleDigest !==
      gate.authorityTupleDigest ||
    evaluationReport.evaluationPolicyDigest !== gate.evaluationPolicyDigest ||
    evaluationReport.evaluationPolicyId !== gate.evaluationPolicyId ||
    evaluationReport.evaluationPolicyVersion !== gate.evaluationPolicyVersion ||
    evaluationReport.activationRecommendation !==
      "eligible-for-reviewed-beta" ||
    deterministicFakeRoute !== deterministicFakeEvidence ||
    (!deterministicFakeEvidence &&
      (admissionRequest.executionClass !== "live-evaluation" ||
        evaluationReport.liveEvaluationAuthorityDigest !==
          admissionRequest.liveEvaluationAuthorityDigest)) ||
    tuple.capabilityRegistryDigest !==
      routingDecision.capabilityRegistryDigest ||
    tuple.modelConfigurationReference !==
      routingDecision.modelConfigurationReference ||
    tuple.operation !== admissionRequest.operation ||
    tuple.catalogDigest !== catalogDigest ||
    tuple.catalogDigest !== admissionRequest.catalogDigest ||
    tuple.promptTemplateDigest !== promptTemplateDigest ||
    tuple.promptTemplateDigest !== admissionRequest.promptTemplateDigest ||
    tuple.responseSchemaDigest !== responseSchemaDigest ||
    tuple.responseSchemaDigest !== admissionRequest.responseSchemaDigest ||
    tuple.promptTemplateId !== commercialRequest.promptId ||
    tuple.promptTemplateVersion !== commercialRequest.promptVersion ||
    tuple.role !== admissionRequest.role ||
    tuple.routeDefinitionDigest !== routingDecision.routeDefinitionDigest ||
    tuple.routeRegistryDigest !== routingDecision.routeRegistryDigest ||
    tuple.inferenceProfileId !== routingDecision.inferenceProfileId
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}

function assertCacheBindings(input: {
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  readonly cacheKey: ModelCacheKeyInputV1 | undefined;
  readonly policy: ModelRuntimeControlPolicyV1;
  readonly promptTemplateDigest: Sha256Digest;
  readonly routingDecision: ModelRoutingDecisionV1;
}): void {
  assertRuntimeCacheBindings({
    ...input,
    tuple: input.policy.evaluationGate.authorityTuple,
  });
}

function assertLiveEvaluationBindings(input: {
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  readonly authority: ModelLiveEvaluationAuthorityV1 | undefined;
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly evaluationReport: ModelEvaluationReportV1;
  readonly now: number;
  readonly policy: ModelRuntimeControlPolicyV1;
  readonly promptTemplateDigest: Sha256Digest;
  readonly routingDecision: ModelRoutingDecisionV1;
  readonly routingRequest: ModelRoutingRequestV1;
  readonly terminalReplay: boolean;
}): boolean {
  const {
    admissionRequest,
    authority,
    commercialRequest,
    evaluationReport,
    now,
    policy,
    promptTemplateDigest,
    routingDecision,
    routingRequest,
    terminalReplay,
  } = input;
  if (admissionRequest.executionClass !== "live-evaluation") {
    if (authority !== undefined) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    return true;
  }
  if (
    authority === undefined ||
    admissionRequest.liveEvaluationAuthorityDigest !==
      authority.authorityDigest ||
    evaluationReport.executionMode !== "opt-in-live" ||
    evaluationReport.liveEvaluationAuthorityDigest !==
      authority.authorityDigest ||
    authority.runtimeControlConfigurationDigest !==
      policy.runtimeControlConfigurationDigest ||
    authority.runtimePolicyId !== policy.policyId ||
    authority.runtimePolicyVersion !== policy.policyVersion ||
    authority.organizationId !== admissionRequest.organizationId ||
    authority.datasetDigest !== evaluationReport.datasetDigest ||
    !sameSet(
      authority.datasetCaseDigests,
      evaluationReport.datasetCaseDigests,
    ) ||
    authority.evaluationPolicyDigest !==
      policy.evaluationGate.evaluationPolicyDigest ||
    authority.evaluationPolicyId !== policy.evaluationGate.evaluationPolicyId ||
    authority.evaluationPolicyVersion !==
      policy.evaluationGate.evaluationPolicyVersion
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
  const planned = plannedMaximums(commercialRequest);
  return (
    authority.environment === routingRequest.environment &&
    policy.liveEvaluation.permittedEnvironments.includes(
      authority.environment,
    ) &&
    authority.modelConfigurationReferences.includes(
      routingDecision.modelConfigurationReference,
    ) &&
    authority.promptTemplateDigests.includes(promptTemplateDigest) &&
    admissionRequest.commercialEstimate.maximumCreditUnits <=
      authority.limits.maximumCreditUnits &&
    admissionRequest.commercialEstimate.estimatedMicroUsd <=
      authority.limits.maximumEstimatedMicroUsd &&
    planned.invocations <= authority.limits.maximumInvocations &&
    planned.inputTokens <= authority.limits.maximumInputTokens &&
    planned.outputTokens <= authority.limits.maximumOutputTokens &&
    planned.totalTokens <= authority.limits.maximumTotalTokens &&
    (terminalReplay ||
      (now >= assertInstant(authority.createdAt) &&
        now < assertInstant(authority.expiresAt)))
  );
}

function expectedStaticDenialReasons(input: {
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  readonly evaluationReport: ModelEvaluationReportV1;
  readonly liveEvaluationAuthorized: boolean;
  readonly policy: ModelRuntimeControlPolicyV1;
  readonly routingDecision: ModelRoutingDecisionV1;
  readonly routingRequest: ModelRoutingRequestV1;
}): readonly ModelRuntimeDenialReasonV1[] {
  const { evaluationReport, policy } = input;
  const reasons = new Set(expectedSharedStaticDenialReasons(input));
  if (!input.liveEvaluationAuthorized)
    reasons.add("live-evaluation-not-authorized");
  if (
    !evaluationReport.deterministicPassed ||
    evaluationReport.activationRecommendation !==
      "eligible-for-reviewed-beta" ||
    evaluationReport.deterministicQualityBasisPoints <
      policy.evaluationGate.minimumDeterministicQualityBasisPoints
  ) {
    reasons.add("evaluation-gate-failed");
  }
  return orderedReasons(reasons);
}

function mergeReasons(
  ...groups: readonly (readonly ModelRuntimeDenialReasonV1[])[]
): readonly ModelRuntimeDenialReasonV1[] {
  return orderedReasons(new Set(groups.flat()));
}
function safeTelemetryPair(input: {
  readonly decision: ModelRuntimeAdmissionDecisionV1;
  readonly eventKind: ModelRuntimeAuditEventV1["eventKind"];
  readonly occurredAt: string;
  readonly request: ModelRuntimeAdmissionRequestV1;
  readonly safeReasons?: readonly ModelRuntimeDenialReasonV1[];
  readonly sourceAuthority?: ModelRuntimeMetricV1["sourceAuthority"];
  readonly unit?: ModelRuntimeMetricV1["unit"];
  readonly value?: number;
}): {
  readonly audit: ModelRuntimeAuditEventV1;
  readonly metric: ModelRuntimeMetricV1;
} {
  return runtimeTelemetryPair({
    ...input,
    authorityDigests: [input.request.evaluationReportDigest],
  });
}

const SENSITIVE_RUNTIME_CODE_SEGMENT =
  /(?:^|[.:-])(?:api[-_]?key|credential|password|private[-_]?key|secret|token)(?:$|[.:-])/iu;

function exactRuntimeRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).some((key) => typeof key !== "string")
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
  return record;
}

export function parseModelRuntimeTelemetryOutboxEntryV1(
  value: unknown,
): ModelRuntimeTelemetryOutboxEntryV1 {
  const record = exactRuntimeRecord(value, ["audit", "metric", "outboxId"]);
  try {
    const projected = {
      audit: modelRuntimeAuditEventV1Schema.parse(record["audit"]),
      metric: modelRuntimeMetricV1Schema.parse(record["metric"]),
      outboxId: sha256DigestSchema.parse(record["outboxId"]),
    } satisfies ModelRuntimeTelemetryOutboxEntryV1;
    if (
      projected.outboxId !==
        digestStructuredValue({
          audit: projected.audit,
          metric: projected.metric,
        }) ||
      projected.audit.safeReasonCodes.some((code) =>
        SENSITIVE_RUNTIME_CODE_SEGMENT.test(code),
      ) ||
      inspectModelValueForSecretCandidatesV1(projected).detectedValueCount > 0
    ) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    return projected;
  } catch (error) {
    if (error instanceof ModelRuntimeControlError) throw error;
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}

export function digestModelRuntimeOperationalOutcomeAuthorityV1(
  value: Omit<ModelRuntimeOperationalOutcomeAuthorityV1, "authorityDigest">,
): Sha256Digest {
  return digestStructuredValue(value);
}

function projectOperationalOutcomeAuthority(
  value: unknown,
): ModelRuntimeOperationalOutcomeAuthorityV1 {
  const record = exactRuntimeRecord(value, [
    "authorityDigest",
    "contractVersion",
    "decisionDigest",
    "eventKind",
    "issuerId",
    "issuerVersion",
    "noRawSensitiveContent",
    "occurredAt",
    "operation",
    "organizationId",
    "projectId",
    "recordKind",
    "referenceDigests",
    "requestDigest",
    "safeReasonCodes",
    "sourceEvidenceDigests",
    "terminalDigest",
    "userId",
  ]);
  try {
    const rawEventKind = record["eventKind"];
    if (
      typeof rawEventKind !== "string" ||
      !Object.prototype.hasOwnProperty.call(
        runtimeOperationalOperations,
        rawEventKind,
      ) ||
      typeof record["operation"] !== "string" ||
      typeof record["organizationId"] !== "string" ||
      typeof record["projectId"] !== "string" ||
      typeof record["userId"] !== "string" ||
      record["contractVersion"] !== 1 ||
      record["noRawSensitiveContent"] !== true ||
      record["recordKind"] !== "model-runtime-operational-outcome-authority" ||
      !Array.isArray(record["referenceDigests"]) ||
      !Array.isArray(record["safeReasonCodes"]) ||
      !Array.isArray(record["sourceEvidenceDigests"])
    ) {
      throw new Error("invalid operational outcome authority");
    }
    const referenceDigests = record["referenceDigests"].map((digest) =>
      sha256DigestSchema.parse(digest),
    );
    const safeReasonCodes = record["safeReasonCodes"].map((code) => {
      if (typeof code !== "string") throw new Error("invalid reason code");
      return code;
    });
    const sourceEvidenceDigests = record["sourceEvidenceDigests"].map(
      (digest) => sha256DigestSchema.parse(digest),
    );
    const projected = {
      authorityDigest: sha256DigestSchema.parse(record["authorityDigest"]),
      contractVersion: 1 as const,
      decisionDigest: sha256DigestSchema.parse(record["decisionDigest"]),
      eventKind: rawEventKind as ModelRuntimeOperationalEventKindV1,
      issuerId: namespacedIdentifierSchema.parse(record["issuerId"]),
      issuerVersion: semanticVersionSchema.parse(record["issuerVersion"]),
      noRawSensitiveContent: true as const,
      occurredAt: utcTimestampSchema.parse(record["occurredAt"]),
      operation: record[
        "operation"
      ] as ModelRuntimeAdmissionRequestV1["operation"],
      organizationId: record["organizationId"],
      projectId: record["projectId"],
      recordKind: "model-runtime-operational-outcome-authority" as const,
      referenceDigests,
      requestDigest: sha256DigestSchema.parse(record["requestDigest"]),
      safeReasonCodes,
      sourceEvidenceDigests,
      terminalDigest: sha256DigestSchema.parse(record["terminalDigest"]),
      userId: record["userId"],
    } satisfies ModelRuntimeOperationalOutcomeAuthorityV1;
    const { authorityDigest: _authorityDigest, ...withoutDigest } = projected;
    void _authorityDigest;
    if (
      projected.authorityDigest !==
        digestModelRuntimeOperationalOutcomeAuthorityV1(withoutDigest) ||
      referenceDigests.length > 128 ||
      safeReasonCodes.length > 16 ||
      sourceEvidenceDigests.length === 0 ||
      sourceEvidenceDigests.length > 128 ||
      new Set(referenceDigests).size !== referenceDigests.length ||
      new Set(safeReasonCodes).size !== safeReasonCodes.length ||
      new Set(sourceEvidenceDigests).size !== sourceEvidenceDigests.length ||
      safeReasonCodes.some((code) =>
        SENSITIVE_RUNTIME_CODE_SEGMENT.test(code),
      ) ||
      inspectModelValueForSecretCandidatesV1(projected).detectedValueCount > 0
    ) {
      throw new Error("invalid operational outcome authority");
    }
    return projected;
  } catch (error) {
    if (error instanceof ModelRuntimeControlError) throw error;
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}

function projectPersistedExecutionBinding(
  value: unknown,
): ModelRuntimePersistedExecutionBindingV1 {
  const record = exactRuntimeRecord(value, [
    "fingerprint",
    "tenantScopeDigest",
    "terminalDigest",
  ]);
  try {
    return {
      fingerprint: sha256DigestSchema.parse(record["fingerprint"]),
      tenantScopeDigest: sha256DigestSchema.parse(record["tenantScopeDigest"]),
      terminalDigest: sha256DigestSchema.parse(record["terminalDigest"]),
    };
  } catch {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}

function projectTrustedAuthorityBundle(
  value: unknown,
): ModelRuntimeTrustedAuthorityBundleV1 {
  const record = exactRuntimeRecord(value, [
    "catalogDigest",
    "evaluationReport",
    "liveEvaluationAuthority",
    "policy",
    "promptTemplateDigest",
    "responseSchemaDigest",
    "routingDecision",
    "routingRequest",
  ]);
  try {
    return {
      catalogDigest: sha256DigestSchema.parse(record["catalogDigest"]),
      evaluationReport: modelEvaluationReportV1Schema.parse(
        record["evaluationReport"],
      ),
      liveEvaluationAuthority:
        record["liveEvaluationAuthority"] === undefined
          ? undefined
          : modelLiveEvaluationAuthorityV1Schema.parse(
              record["liveEvaluationAuthority"],
            ),
      policy: modelRuntimeControlPolicyV1Schema.parse(record["policy"]),
      promptTemplateDigest: sha256DigestSchema.parse(
        record["promptTemplateDigest"],
      ),
      responseSchemaDigest: sha256DigestSchema.parse(
        record["responseSchemaDigest"],
      ),
      routingDecision: modelRoutingDecisionV1Schema.parse(
        record["routingDecision"],
      ),
      routingRequest: modelRoutingRequestV1Schema.parse(
        record["routingRequest"],
      ),
    };
  } catch (error) {
    if (error instanceof ModelRuntimeControlError) throw error;
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}

function assertCurrentAuthority(
  candidate: ModelRuntimeTrustedAuthorityBundleV1,
  resolved: ModelRuntimeTrustedAuthorityBundleV1,
): void {
  const candidateLive = candidate.liveEvaluationAuthority;
  const resolvedLive = resolved.liveEvaluationAuthority;
  if (
    candidate.catalogDigest !== resolved.catalogDigest ||
    candidate.promptTemplateDigest !== resolved.promptTemplateDigest ||
    candidate.responseSchemaDigest !== resolved.responseSchemaDigest ||
    candidate.policy.policyDigest !== resolved.policy.policyDigest ||
    candidate.evaluationReport.reportDigest !==
      resolved.evaluationReport.reportDigest ||
    digestStructuredValue(candidate.routingDecision) !==
      digestStructuredValue(resolved.routingDecision) ||
    digestStructuredValue(candidate.routingRequest) !==
      digestStructuredValue(resolved.routingRequest) ||
    (candidateLive === undefined) !== (resolvedLive === undefined) ||
    (candidateLive !== undefined &&
      resolvedLive !== undefined &&
      candidateLive.authorityDigest !== resolvedLive.authorityDigest)
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}

function assertOutcomeAuthorityBindings(input: {
  readonly authority: ModelRuntimeTrustedAuthorityBundleV1;
  readonly decision: ModelRuntimeAdmissionDecisionV1;
  readonly request: ModelRuntimeAdmissionRequestV1;
}): void {
  const { authority, decision, request } = input;
  assertRoutingBindings({
    admissionDecision: decision,
    admissionRequest: request,
    policy: authority.policy,
    routingDecision: authority.routingDecision,
    routingRequest: authority.routingRequest,
  });
  const gate = authority.policy.evaluationGate;
  const tuple = gate.authorityTuple;
  const report = authority.evaluationReport;
  const reportBinding = report.authorityBindings.find(
    (binding) => binding.authorityTupleDigest === gate.authorityTupleDigest,
  );
  const liveDigest = authority.liveEvaluationAuthority?.authorityDigest;
  if (
    request.catalogDigest !== authority.catalogDigest ||
    request.promptTemplateDigest !== authority.promptTemplateDigest ||
    request.responseSchemaDigest !== authority.responseSchemaDigest ||
    request.evaluationReportId !== report.evaluationReportId ||
    request.evaluationReportDigest !== report.reportDigest ||
    request.evaluationResultSetDigest !== report.evaluationResultSetDigest ||
    request.evaluationAuthorityTupleDigest !== gate.authorityTupleDigest ||
    decision.evaluationReportId !== report.evaluationReportId ||
    decision.evaluationReportDigest !== report.reportDigest ||
    decision.evaluationResultSetDigest !== report.evaluationResultSetDigest ||
    decision.evaluationAuthorityTupleDigest !== gate.authorityTupleDigest ||
    gate.evaluationReportId !== report.evaluationReportId ||
    gate.evaluationReportDigest !== report.reportDigest ||
    gate.evaluationResultSetDigest !== report.evaluationResultSetDigest ||
    gate.evaluationPolicyDigest !== report.evaluationPolicyDigest ||
    gate.evaluationPolicyId !== report.evaluationPolicyId ||
    gate.evaluationPolicyVersion !== report.evaluationPolicyVersion ||
    gate.datasetDigest !== report.datasetDigest ||
    !sameOrderedValues(gate.datasetCaseDigests, report.datasetCaseDigests) ||
    reportBinding === undefined ||
    tuple.catalogDigest !== authority.catalogDigest ||
    tuple.operation !== request.operation ||
    tuple.promptTemplateDigest !== authority.promptTemplateDigest ||
    tuple.responseSchemaDigest !== authority.responseSchemaDigest ||
    tuple.role !== request.role ||
    tuple.capabilityRegistryDigest !==
      authority.routingDecision.capabilityRegistryDigest ||
    tuple.routeDefinitionDigest !==
      authority.routingDecision.routeDefinitionDigest ||
    tuple.routeRegistryDigest !==
      authority.routingDecision.routeRegistryDigest ||
    tuple.inferenceProfileId !== authority.routingDecision.inferenceProfileId ||
    (request.executionClass === "live-evaluation") !==
      (liveDigest !== undefined) ||
    request.liveEvaluationAuthorityDigest !== liveDigest
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}

function telemetryOutboxEntry(input: {
  readonly audit: ModelRuntimeAuditEventV1;
  readonly metric: ModelRuntimeMetricV1;
}): ModelRuntimeTelemetryOutboxEntryV1 {
  return {
    ...input,
    outboxId: digestStructuredValue(input),
  };
}

function parseRuntimeExecutionMetadata(
  input: ModelRuntimeControlExecutionInputV1,
): {
  admissionDecision: ModelRuntimeAdmissionDecisionV1;
  admissionRequest: ModelRuntimeAdmissionRequestV1;
  catalogDigest: Sha256Digest;
  evaluationReport: ModelEvaluationReportV1;
  inputEvidence: ModelRuntimeInputEvidenceV1;
  liveEvaluationAuthority: ModelLiveEvaluationAuthorityV1 | undefined;
  policy: ModelRuntimeControlPolicyV1;
  promptCacheKey: ModelCacheKeyInputV1 | undefined;
  promptTemplateDigest: Sha256Digest;
  responseSchemaDigest: Sha256Digest;
  routingDecision: ModelRoutingDecisionV1;
  routingRequest: ModelRoutingRequestV1;
} {
  try {
    return {
      admissionDecision: modelRuntimeAdmissionDecisionV1Schema.parse(
        input.admissionDecision,
      ),
      admissionRequest: modelRuntimeAdmissionRequestV1Schema.parse(
        input.admissionRequest,
      ),
      catalogDigest: sha256DigestSchema.parse(input.catalogDigest),
      evaluationReport: modelEvaluationReportV1Schema.parse(
        input.evaluationReport,
      ),
      inputEvidence: modelRuntimeInputEvidenceV1Schema.parse(
        input.inputEvidence,
      ),
      liveEvaluationAuthority:
        input.liveEvaluationAuthority === undefined
          ? undefined
          : modelLiveEvaluationAuthorityV1Schema.parse(
              input.liveEvaluationAuthority,
            ),
      policy: modelRuntimeControlPolicyV1Schema.parse(input.policy),
      promptCacheKey:
        input.promptCacheKey === undefined
          ? undefined
          : modelCacheKeyInputV1Schema.parse(input.promptCacheKey),
      promptTemplateDigest: sha256DigestSchema.parse(
        input.promptTemplateDigest,
      ),
      responseSchemaDigest: sha256DigestSchema.parse(
        input.responseSchemaDigest,
      ),
      routingDecision: modelRoutingDecisionV1Schema.parse(
        input.routingDecision,
      ),
      routingRequest: modelRoutingRequestV1Schema.parse(input.routingRequest),
    };
  } catch {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
}

/** Strict metadata identity only, never current authorization, an evaluation
 * promotion, admission, debit or permission to dispatch. Uses the exact same
 * parser and fingerprint as execute; trusted resolvers remain mandatory there. */
export function projectModelRuntimeExecutionIdentityV1(
  input: ModelRuntimeControlExecutionInputV1,
): {
  readonly fingerprint: Sha256Digest;
  readonly tenantScopeDigest: Sha256Digest;
} {
  const parsed = parseRuntimeExecutionMetadata(input);
  if (
    parsed.catalogDigest !== parsed.admissionRequest.catalogDigest ||
    parsed.responseSchemaDigest !==
      parsed.admissionRequest.responseSchemaDigest ||
    parsed.promptTemplateDigest !== parsed.admissionRequest.promptTemplateDigest
  ) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
  projectModelCommercialOperationIdentityV1(input.commercialRequest);
  assertRoutingBindings(parsed);
  assertInputEvidenceBindings(parsed);
  assertCommercialBindings({
    ...parsed,
    commercialRequest: input.commercialRequest,
  });
  assertCacheBindings({
    admissionRequest: parsed.admissionRequest,
    cacheKey: parsed.promptCacheKey,
    policy: parsed.policy,
    promptTemplateDigest: parsed.promptTemplateDigest,
    routingDecision: parsed.routingDecision,
  });
  return {
    fingerprint: runtimeAdmissionFingerprint({
      ...parsed,
      commercialRequest: input.commercialRequest,
    }),
    tenantScopeDigest: tenantScopeDigest(parsed.admissionRequest),
  };
}

function runtimeAdmissionFingerprint(input: {
  readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly evaluationReport: ModelEvaluationReportV1;
  readonly inputEvidence: ModelRuntimeInputEvidenceV1;
  readonly liveEvaluationAuthority: ModelLiveEvaluationAuthorityV1 | undefined;
  readonly policy: ModelRuntimeControlPolicyV1;
  readonly promptCacheKey: ModelCacheKeyInputV1 | undefined;
  readonly promptTemplateDigest: Sha256Digest;
  readonly routingDecision: ModelRoutingDecisionV1;
  readonly routingRequest: ModelRoutingRequestV1;
}): Sha256Digest {
  const decision = Object.fromEntries(
    Object.entries(input.admissionDecision).filter(
      ([key]) => !["decidedAt", "decisionDigest", "expiresAt"].includes(key),
    ),
  );
  const commercialRequest = Object.fromEntries(
    Object.entries(input.commercialRequest).filter(
      ([key]) => !["expiresAt", "requestedAt"].includes(key),
    ),
  );
  return digestStructuredValue({
    admissionDecision: decision,
    admissionRequest: input.admissionRequest,
    commercialRequest,
    evaluationReport: input.evaluationReport,
    inputEvidence: input.inputEvidence,
    liveEvaluationAuthority: input.liveEvaluationAuthority,
    policy: input.policy,
    promptCacheKey: input.promptCacheKey,
    promptTemplateDigest: input.promptTemplateDigest,
    routingDecision: input.routingDecision,
    routingRequest: input.routingRequest,
  });
}
interface ModelRuntimeClaimAuthorityInputV1 {
  readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly evaluationReport: ModelEvaluationReportV1;
  readonly inputEvidence: ModelRuntimeInputEvidenceV1;
  readonly liveEvaluationAuthority: ModelLiveEvaluationAuthorityV1 | undefined;
  readonly policy: ModelRuntimeControlPolicyV1;
  readonly promptCacheKey: ModelCacheKeyInputV1 | undefined;
  readonly promptTemplateDigest: Sha256Digest;
  readonly routingDecision: ModelRoutingDecisionV1;
  readonly routingRequest: ModelRoutingRequestV1;
  readonly trustedNow: string;
}

function runtimeStateRequestInput(
  input: ModelRuntimeClaimAuthorityInputV1,
): ModelRuntimeStateSnapshotRequestV1 {
  const planned = plannedMaximums(input.commercialRequest);
  const liveAuthorityReservation =
    input.liveEvaluationAuthority === undefined
      ? undefined
      : {
          authorityDigest: input.liveEvaluationAuthority.authorityDigest,
          limits: input.liveEvaluationAuthority.limits,
          planned: {
            cacheReadTokens: planned.cacheReadTokens,
            cacheWriteTokens: planned.cacheWriteTokens,
            creditUnits:
              input.admissionRequest.commercialEstimate.maximumCreditUnits,
            estimatedMicroUsd:
              input.admissionRequest.commercialEstimate.estimatedMicroUsd,
            inputTokens: planned.inputTokens,
            invocations: planned.invocations,
            outputTokens: planned.outputTokens,
            totalTokens: planned.totalTokens,
          },
        };
  return {
    decidedAt: input.trustedNow,
    idempotencyKeyDigest: input.admissionRequest.idempotencyKeyDigest,
    ...(liveAuthorityReservation === undefined
      ? {}
      : { liveAuthorityReservation }),
    organizationId: input.admissionRequest.organizationId,
    organizationWindowSeconds:
      input.policy.requestWindows.organization.windowSeconds,
    projectId: input.admissionRequest.projectId,
    requestDigest: input.admissionRequest.requestDigest,
    runtimePolicyDigest: input.policy.policyDigest,

    tenantScopeDigest: tenantScopeDigest(input.admissionRequest),
    userId: input.admissionRequest.userId,
    userWindowSeconds: input.policy.requestWindows.user.windowSeconds,
  };
}

function claimInput(
  input: ModelRuntimeClaimAuthorityInputV1 & {
    readonly runtimeState: ModelRuntimeStateSnapshotV1;
  },
): ModelRuntimeAdmissionClaimV1 {
  const allowed = input.admissionDecision.outcome === "allowed";
  const leaseId = input.admissionDecision.authorization.concurrencyLeaseId;
  if (allowed !== (leaseId !== undefined)) {
    throw new ModelRuntimeControlError("routing-authority-mismatch");
  }
  const stateRequest = runtimeStateRequestInput(input);
  return {
    ...stateRequest,
    admissionDecision: input.admissionDecision,
    admissionRequest: input.admissionRequest,
    acquire: allowed,
    claimOutbox: [],
    commercialExpiresAt: input.commercialRequest.expiresAt,
    executionLeaseExpiresAt: runtimeExecutionLeaseExpiresAt(input.trustedNow),
    ...(allowed
      ? {}
      : {
          deniedTerminal: {
            admission: input.admissionDecision,
            commercial: null,
            output: null,
          },
        }),
    fingerprint: runtimeAdmissionFingerprint(input),
    ...(leaseId === undefined ? {} : { leaseId }),
    limits: {
      maximumConcurrentOrganizationJobs:
        input.policy.requestWindows.organization.maximumConcurrentJobs,
      maximumConcurrentUserJobs:
        input.policy.requestWindows.user.maximumConcurrentJobs,
      maximumOrganizationRequests:
        input.policy.requestWindows.organization.maximumRequests,
      maximumUserRequests: input.policy.requestWindows.user.maximumRequests,
    },
    snapshotDigest: input.runtimeState.snapshotDigest,
    snapshotId: input.runtimeState.snapshotId,
  };
}
export async function verifyModelRuntimeInvocationOutputV1(
  supplied: ModelRuntimeControlledInvocationResultV1,
  input: {
    readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
    readonly commercialRequest: ModelCommercialOperationRequestV1;
    readonly evidenceVerifier: ModelRuntimeHostEvidenceVerifierV1;
    readonly liveEvaluationAuthority:
      ModelLiveEvaluationAuthorityV1 | undefined;
    readonly policy: ModelRuntimeControlPolicyV1;
    readonly routingDecision: ModelRoutingDecisionV1;
  },
): Promise<{
  readonly commercial: ModelCommercialInvocationResultV1;
  readonly output: ModelRuntimeSanitizedOutputEvidenceV1 | null;
  readonly rejected: boolean;
}> {
  return verifyRuntimeInvocationOutput(supplied, input);
}

export class ModelRuntimeControlServiceV1 {
  readonly #authorityResolver: ModelRuntimeAuthorityResolverV1;
  readonly #commercial: ModelRuntimeCanonicalCommercialPortV1;
  readonly #evidenceVerifier: ModelRuntimeHostEvidenceVerifierV1;
  readonly #now: () => string;
  readonly #store: ModelRuntimeAdmissionStoreV1;
  readonly #telemetry: ModelRuntimeTelemetryPortV1;

  public constructor(dependencies: ModelRuntimeControlServiceDependenciesV1) {
    this.#authorityResolver = dependencies.authorityResolver;
    this.#commercial = dependencies.commercial;
    this.#evidenceVerifier = dependencies.evidenceVerifier;
    this.#now = dependencies.now;
    this.#store = dependencies.store;
    this.#telemetry = dependencies.telemetry;
  }

  #operationalProjectionPair(input: ModelRuntimeOperationalProjectionInputV1): {
    readonly audit: ModelRuntimeAuditEventV1;
    readonly metric: ModelRuntimeMetricV1;
  } {
    const { decision, request } = input;
    if (
      decision.outcome !== "allowed" ||
      !decision.invokeModel ||
      decision.requestDigest !== request.requestDigest ||
      decision.routingDecisionDigest !== request.routingDecisionDigest ||
      decision.runtimePolicyDigest !== request.runtimePolicyDigest ||
      decision.commercialEstimateDigest !==
        request.commercialEstimate.estimateDigest ||
      decision.evaluationReportId !== request.evaluationReportId ||
      decision.evaluationReportDigest !== request.evaluationReportDigest ||
      decision.evaluationResultSetDigest !==
        request.evaluationResultSetDigest ||
      decision.evaluationAuthorityTupleDigest !==
        request.evaluationAuthorityTupleDigest
    ) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    return runtimeOperationalProjectionPair({
      ...input,
      authorityDigests: [request.evaluationReportDigest],
    });
  }

  async #assertCurrentOutcomeAuthority(
    candidate: ModelRuntimeTrustedAuthorityBundleV1,
    request: ModelRuntimeAdmissionRequestV1,
  ): Promise<void> {
    let current: ModelRuntimeTrustedAuthorityBundleV1;
    try {
      current = projectTrustedAuthorityBundle(
        await this.#authorityResolver.resolve({
          candidate,
          executionClass: request.executionClass,
          operation: request.operation,
          organizationId: request.organizationId,
          projectId: request.projectId,
          userId: request.userId,
        }),
      );
    } catch (error) {
      if (error instanceof ModelRuntimeControlError) throw error;
      throw new ModelRuntimeControlError("runtime-control-unavailable");
    }
    assertCurrentAuthority(candidate, current);
  }

  async #readOperationalExecutionBinding(input: {
    readonly decision: ModelRuntimeAdmissionDecisionV1;
    readonly request: ModelRuntimeAdmissionRequestV1;
  }): Promise<ModelRuntimePersistedExecutionBindingV1> {
    const expectedTenantScopeDigest = tenantScopeDigest(input.request);
    let binding: ModelRuntimePersistedExecutionBindingV1;
    try {
      binding = projectPersistedExecutionBinding(
        await this.#store.readOperationalExecutionBinding({
          admissionDecision: input.decision,
          admissionRequest: input.request,
          tenantScopeDigest: expectedTenantScopeDigest,
        }),
      );
    } catch (error) {
      if (error instanceof ModelRuntimeControlError) throw error;
      throw new ModelRuntimeControlError("runtime-control-unavailable");
    }
    if (binding.tenantScopeDigest !== expectedTenantScopeDigest) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    return binding;
  }

  async #persistOperationalProjection(input: {
    readonly binding: ModelRuntimePersistedExecutionBindingV1;
    readonly decision: ModelRuntimeAdmissionDecisionV1;
    readonly pair: {
      readonly audit: ModelRuntimeAuditEventV1;
      readonly metric: ModelRuntimeMetricV1;
    };
    readonly request: ModelRuntimeAdmissionRequestV1;
  }): Promise<void> {
    try {
      await this.#store.appendOperationalOutbox({
        admissionDecision: input.decision,
        admissionRequest: input.request,
        entry: telemetryOutboxEntry(input.pair),
        fingerprint: input.binding.fingerprint,
        tenantScopeDigest: input.binding.tenantScopeDigest,
        terminalDigest: input.binding.terminalDigest,
      });
      await this.#drainOutbox({
        fingerprint: input.binding.fingerprint,
        tenantScopeDigest: input.binding.tenantScopeDigest,
      });
    } catch (error) {
      if (error instanceof ModelRuntimeControlError) throw error;
      throw new ModelRuntimeControlError("runtime-control-unavailable");
    }
  }

  public async recordOperationalOutcome(
    supplied: ModelRuntimeOperationalOutcomeV1,
  ): Promise<{
    readonly audit: ModelRuntimeAuditEventV1;
    readonly metric: ModelRuntimeMetricV1;
  }> {
    const record = exactRuntimeRecord(supplied, [
      "admissionDecision",
      "admissionRequest",
      "outcomeAuthority",
      "trustedAuthority",
    ]);
    let authority: ModelRuntimeTrustedAuthorityBundleV1;
    let decision: ModelRuntimeAdmissionDecisionV1;
    let outcomeAuthority: ModelRuntimeOperationalOutcomeAuthorityV1;
    let request: ModelRuntimeAdmissionRequestV1;
    try {
      decision = modelRuntimeAdmissionDecisionV1Schema.parse(
        record["admissionDecision"],
      );
      request = modelRuntimeAdmissionRequestV1Schema.parse(
        record["admissionRequest"],
      );
      authority = projectTrustedAuthorityBundle(record["trustedAuthority"]);
      outcomeAuthority = projectOperationalOutcomeAuthority(
        record["outcomeAuthority"],
      );
    } catch (error) {
      if (error instanceof ModelRuntimeControlError) throw error;
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    assertOutcomeAuthorityBindings({ authority, decision, request });
    await this.#assertCurrentOutcomeAuthority(authority, request);
    const binding = await this.#readOperationalExecutionBinding({
      decision,
      request,
    });
    const { eventKind, safeReasonCodes } = outcomeAuthority;
    const allowedCodes = runtimeOperationalReasonCodes[eventKind];
    const requiresReason = allowedCodes.length > 0;
    if (
      outcomeAuthority.decisionDigest !== decision.decisionDigest ||
      outcomeAuthority.requestDigest !== request.requestDigest ||
      outcomeAuthority.terminalDigest !== binding.terminalDigest ||
      outcomeAuthority.operation !== request.operation ||
      outcomeAuthority.organizationId !== request.organizationId ||
      outcomeAuthority.projectId !== request.projectId ||
      outcomeAuthority.userId !== request.userId ||
      !runtimeOperationalOperations[eventKind].some(
        (operation) => operation === request.operation,
      ) ||
      requiresReason !== safeReasonCodes.length > 0 ||
      safeReasonCodes.some(
        (code) =>
          !allowedCodes.some((allowedCode) => allowedCode === code) ||
          SENSITIVE_RUNTIME_CODE_SEGMENT.test(code),
      )
    ) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    let verified: boolean;
    try {
      verified = await this.#evidenceVerifier.verifyOperationalOutcome({
        authority: outcomeAuthority,
      });
    } catch (error) {
      if (error instanceof ModelRuntimeControlError) throw error;
      throw new ModelRuntimeControlError("runtime-control-unavailable");
    }
    if (!verified) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    const pair = this.#operationalProjectionPair({
      decision,
      eventKind,
      occurredAt: outcomeAuthority.occurredAt,
      projection: {
        sourceAuthority: "runtime-control-v1",
        unit: "count",
        value: 1,
      },
      referenceDigests: [
        binding.terminalDigest,
        ...outcomeAuthority.referenceDigests,
        ...outcomeAuthority.sourceEvidenceDigests,
      ],
      request,
      safeReasonCodes,
      sourceEvidenceDigest: outcomeAuthority.authorityDigest,
    });
    await this.#persistOperationalProjection({
      binding,
      decision,
      pair,
      request,
    });
    return pair;
  }

  public async recordEvaluationRegression(
    supplied: ModelRuntimeEvaluationRegressionOutcomeV1,
  ): Promise<{
    readonly audit: ModelRuntimeAuditEventV1;
    readonly metric: ModelRuntimeMetricV1;
  }> {
    const record = exactRuntimeRecord(supplied, [
      "admissionDecision",
      "admissionRequest",
      "evaluationReport",
      "regression",
      "trustedAuthority",
    ]);
    let authority: ModelRuntimeTrustedAuthorityBundleV1;
    let decision: ModelRuntimeAdmissionDecisionV1;
    let evaluationReport: ModelEvaluationReportV1;
    let request: ModelRuntimeAdmissionRequestV1;
    let regression: ModelEvaluationRegressionV1;
    try {
      decision = modelRuntimeAdmissionDecisionV1Schema.parse(
        record["admissionDecision"],
      );
      request = modelRuntimeAdmissionRequestV1Schema.parse(
        record["admissionRequest"],
      );
      evaluationReport = modelEvaluationReportV1Schema.parse(
        record["evaluationReport"],
      );
      regression = modelEvaluationRegressionV1Schema.parse(
        record["regression"],
      );
      authority = projectTrustedAuthorityBundle(record["trustedAuthority"]);
    } catch (error) {
      if (error instanceof ModelRuntimeControlError) throw error;
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    assertOutcomeAuthorityBindings({ authority, decision, request });
    await this.#assertCurrentOutcomeAuthority(authority, request);
    const regressionDigest = digestStructuredValue(regression);
    if (
      regression.evidenceDigests.length === 0 ||
      authority.evaluationReport.reportDigest !==
        evaluationReport.reportDigest ||
      request.evaluationReportId !== evaluationReport.evaluationReportId ||
      request.evaluationReportDigest !== evaluationReport.reportDigest ||
      request.evaluationResultSetDigest !==
        evaluationReport.evaluationResultSetDigest ||
      decision.evaluationReportId !== evaluationReport.evaluationReportId ||
      decision.evaluationReportDigest !== evaluationReport.reportDigest ||
      decision.evaluationResultSetDigest !==
        evaluationReport.evaluationResultSetDigest ||
      !evaluationReport.regressions.some(
        (entry) => digestStructuredValue(entry) === regressionDigest,
      )
    ) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    const direction =
      modelEvaluationScoringPolicyV1[regression.dimension].direction;
    const normalizedDelta =
      direction === "higher-is-better"
        ? regression.deltaBasisPoints
        : -regression.deltaBasisPoints;
    if (
      normalizedDelta >= 0 &&
      !(regression.priorPassed && !regression.currentPassed)
    ) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    const binding = await this.#readOperationalExecutionBinding({
      decision,
      request,
    });
    const pair = this.#operationalProjectionPair({
      decision,
      eventKind: "eval-regression",
      occurredAt: evaluationReport.finishedAt,
      projection: {
        sourceAuthority: "deterministic-evaluation-v1",
        unit: "basis-points",
        value: Math.abs(normalizedDelta),
      },
      referenceDigests: [
        binding.terminalDigest,
        request.evaluationReportDigest,
        ...regression.evidenceDigests,
      ],
      request,
      safeReasonCodes: [
        `cloudmarkup.evaluation.${regression.dimension}.regression`,
      ],
      sourceEvidenceDigest: regressionDigest,
    });
    await this.#persistOperationalProjection({
      binding,
      decision,
      pair,
      request,
    });
    return pair;
  }
  async #drainOutbox(input: {
    readonly fingerprint: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
  }): Promise<void> {
    const pending = await this.#store.listPendingOutbox(input);
    for (const rawEntry of pending) {
      const entry = parseModelRuntimeTelemetryOutboxEntryV1(rawEntry);
      await this.#telemetry.publish({
        audit: entry.audit,
        metric: entry.metric,
      });
      await this.#store.acknowledgeOutbox({
        ...input,
        outboxId: entry.outboxId,
      });
    }
  }

  public async execute(
    supplied: ModelRuntimeControlExecutionInputV1,
    invoke: (
      context: ModelRuntimeControlledInvocationContextV1,
    ) => Promise<ModelRuntimeControlledInvocationResultV1>,
  ): Promise<ModelRuntimeControlExecutionResultV1> {
    try {
      return await this.#execute(supplied, invoke);
    } catch (error) {
      if (error instanceof ModelRuntimeControlError) throw error;
      throw new ModelRuntimeControlError("runtime-control-unavailable");
    }
  }

  async #execute(
    supplied: ModelRuntimeControlExecutionInputV1,
    invoke: (
      context: ModelRuntimeControlledInvocationContextV1,
    ) => Promise<ModelRuntimeControlledInvocationResultV1>,
  ): Promise<ModelRuntimeControlExecutionResultV1> {
    const parsed = parseRuntimeExecutionMetadata(supplied);

    parsed.inputEvidence = await authenticateInputEvidence({
      admissionRequest: parsed.admissionRequest,
      evidenceVerifier: this.#evidenceVerifier,
      inputEvidence: parsed.inputEvidence,
    });

    const authorityCandidate = projectTrustedAuthorityBundle({
      catalogDigest: parsed.catalogDigest,
      evaluationReport: parsed.evaluationReport,
      liveEvaluationAuthority: parsed.liveEvaluationAuthority,
      policy: parsed.policy,
      promptTemplateDigest: parsed.promptTemplateDigest,
      responseSchemaDigest: parsed.responseSchemaDigest,
      routingDecision: parsed.routingDecision,
      routingRequest: parsed.routingRequest,
    });
    let currentAuthority: ModelRuntimeTrustedAuthorityBundleV1;
    try {
      currentAuthority = projectTrustedAuthorityBundle(
        await this.#authorityResolver.resolve({
          candidate: authorityCandidate,
          executionClass: parsed.admissionRequest.executionClass,
          operation: parsed.admissionRequest.operation,
          organizationId: parsed.admissionRequest.organizationId,
          projectId: parsed.admissionRequest.projectId,
          userId: parsed.admissionRequest.userId,
        }),
      );
    } catch (error) {
      if (error instanceof ModelRuntimeControlError) throw error;
      throw new ModelRuntimeControlError("runtime-control-unavailable");
    }
    assertCurrentAuthority(authorityCandidate, currentAuthority);

    const nowText = this.#now();
    const now = assertInstant(nowText);
    assertRoutingBindings(parsed);
    assertEvaluationBindings({
      ...parsed,
      commercialRequest: supplied.commercialRequest,
    });
    assertCacheBindings({
      admissionRequest: parsed.admissionRequest,
      cacheKey: parsed.promptCacheKey,
      policy: parsed.policy,
      promptTemplateDigest: parsed.promptTemplateDigest,
      routingDecision: parsed.routingDecision,
    });
    assertCommercialBindings({
      admissionDecision: parsed.admissionDecision,
      admissionRequest: parsed.admissionRequest,
      commercialRequest: supplied.commercialRequest,
      liveEvaluationAuthority: parsed.liveEvaluationAuthority,
      policy: parsed.policy,
      routingDecision: parsed.routingDecision,
    });
    const stateRequest = runtimeStateRequestInput({
      ...parsed,
      commercialRequest: supplied.commercialRequest,
      trustedNow: nowText,
    });
    const runtimeState = await this.#store.inspect(stateRequest);
    const liveEvaluationAuthorized = assertLiveEvaluationBindings({
      admissionRequest: parsed.admissionRequest,
      authority: parsed.liveEvaluationAuthority,
      commercialRequest: supplied.commercialRequest,
      evaluationReport: parsed.evaluationReport,
      now,
      policy: parsed.policy,
      promptTemplateDigest: parsed.promptTemplateDigest,
      routingDecision: parsed.routingDecision,
      routingRequest: parsed.routingRequest,
      terminalReplay: runtimeState.idempotencyReplay,
    });
    const staticReasons = expectedStaticDenialReasons({
      ...parsed,
      liveEvaluationAuthorized,
    });
    const reasons = mergeReasons(
      staticReasons,
      expectedRuntimeDenialReasons({
        liveAuthorityReservation: stateRequest.liveAuthorityReservation,
        policy: parsed.policy,
        replayDenialReasons: parsed.admissionDecision.denialReasons,
        runtimeState,
      }),
    );
    assertDecisionMatches(parsed.admissionDecision, reasons, nowText, {
      admissionRequest: parsed.admissionRequest,
      commercialRequest: supplied.commercialRequest,
      routingDecision: parsed.routingDecision,
      routingRequest: parsed.routingRequest,
      runtimeState,
    });

    const claimPairs =
      parsed.admissionDecision.outcome === "allowed"
        ? [
            safeTelemetryPair({
              decision: parsed.admissionDecision,
              eventKind: "request",
              occurredAt: nowText,
              request: parsed.admissionRequest,
            }),
            safeTelemetryPair({
              decision: parsed.admissionDecision,
              eventKind: "model-route",
              occurredAt: nowText,
              request: parsed.admissionRequest,
            }),
          ]
        : [
            safeTelemetryPair({
              decision: parsed.admissionDecision,
              eventKind: "request",
              occurredAt: nowText,
              request: parsed.admissionRequest,
            }),
            safeTelemetryPair({
              decision: parsed.admissionDecision,
              eventKind: "deny",
              occurredAt: nowText,
              request: parsed.admissionRequest,
              safeReasons: reasons,
            }),
          ];
    const claim = {
      ...claimInput({
        ...parsed,
        commercialRequest: supplied.commercialRequest,
        runtimeState,
        trustedNow: nowText,
      }),
      claimOutbox: claimPairs.map(telemetryOutboxEntry),
    } satisfies ModelRuntimeAdmissionClaimV1;
    const claimResult = await this.#store.claim(claim);
    if (claimResult.kind === "duplicate-terminal") {
      await this.#drainOutbox({
        fingerprint: claim.fingerprint,
        tenantScopeDigest: claim.tenantScopeDigest,
      });
      return {
        ...claimResult.terminal,
        replayed: true,
      };
    }
    if (claimResult.kind === "duplicate-in-progress") {
      await this.#drainOutbox({
        fingerprint: claim.fingerprint,
        tenantScopeDigest: claim.tenantScopeDigest,
      });
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    if (
      claimResult.kind === "conflict" ||
      claimResult.kind === "expired" ||
      claimResult.kind === "limit-changed"
    ) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    if (claimResult.kind === "denied") {
      await this.#drainOutbox({
        fingerprint: claim.fingerprint,
        tenantScopeDigest: claim.tenantScopeDigest,
      });
      return {
        ...claimResult.terminal,
        replayed: false,
      };
    }

    const canonicalAdmissionDecision =
      modelRuntimeAdmissionDecisionV1Schema.parse(
        claimResult.admissionDecision,
      );
    if (
      runtimeAdmissionFingerprint({
        ...parsed,
        admissionDecision: canonicalAdmissionDecision,
        commercialRequest: supplied.commercialRequest,
      }) !== claim.fingerprint
    ) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    parsed.admissionDecision = canonicalAdmissionDecision;
    return runClaimedRuntimeExecution({
      parsed,
      supplied,
      claimResult,
      claim,
      store: this.#store,
      commercialPort: this.#commercial,
      evidenceVerifier: this.#evidenceVerifier,
      now: this.#now,
      invoke,
      drainOutbox: (identity) => this.#drainOutbox(identity),
      safeTelemetryPair,
      operationalProjectionPair: (projection) =>
        this.#operationalProjectionPair(projection),
      assertCurrentDispatchAuthority: async () => {
        const refreshed = projectTrustedAuthorityBundle(
          await this.#authorityResolver.resolve({
            candidate: structuredClone(authorityCandidate),
            executionClass: parsed.admissionRequest.executionClass,
            operation: parsed.admissionRequest.operation,
            organizationId: parsed.admissionRequest.organizationId,
            projectId: parsed.admissionRequest.projectId,
            userId: parsed.admissionRequest.userId,
          }),
        );
        assertCurrentAuthority(authorityCandidate, refreshed);
      },
    });
  }
}
interface InMemoryRuntimeOutboxRecordV1 {
  acknowledged: boolean;
  readonly entry: ModelRuntimeTelemetryOutboxEntryV1;
}

interface InMemoryAdmissionRecordV1 {
  active: boolean;
  readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
  readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
  readonly fingerprint: Sha256Digest;
  readonly leaseId: string | null;
  liveAuthorityDigest: Sha256Digest | null;
  readonly organizationConcurrencyKey: string;
  readonly organizationId: string;
  readonly organizationWindowKey: string;
  readonly outbox: Map<Sha256Digest, InMemoryRuntimeOutboxRecordV1>;
  pending: ModelRuntimeAdmissionTerminalV1 | null;
  revision: number;
  executionLease: ModelRuntimeExecutionLeaseV1 | null;
  readonly snapshot: ModelRuntimeStateSnapshotV1;
  readonly tenantScopeDigest: Sha256Digest;
  readonly userConcurrencyKey: string;
  readonly userId: string;
  readonly userWindowKey: string;
  terminal: ModelRuntimeAdmissionTerminalV1 | null;
}

type InMemoryLiveAuthorityUsageV1 = NonNullable<
  ModelRuntimeStateSnapshotV1["liveAuthorityUsage"]
>;

function windowKey(scope: string, at: number, windowSeconds: number): string {
  return `${scope}\u0000${String(Math.floor(at / (windowSeconds * 1_000)))}`;
}

function windowBounds(
  at: number,
  windowSeconds: number,
): { readonly endsAt: string; readonly startsAt: string } {
  const startsAt =
    Math.floor(at / (windowSeconds * 1_000)) * windowSeconds * 1_000;
  return {
    endsAt: new Date(startsAt + windowSeconds * 1_000).toISOString(),
    startsAt: new Date(startsAt).toISOString(),
  };
}

function mapCount(map: ReadonlyMap<string, number>, key: string): number {
  return map.get(key) ?? 0;
}

function emptyLiveAuthorityUsage(
  authorityDigest: Sha256Digest,
): InMemoryLiveAuthorityUsageV1 {
  return {
    activeConcurrentJobs: 0,
    authorityDigest,
    reservedCacheReadTokens: 0,
    reservedCacheWriteTokens: 0,
    reservedCreditUnits: 0,
    reservedEstimatedMicroUsd: 0,
    reservedInputTokens: 0,
    reservedInvocations: 0,
    reservedOutputTokens: 0,
    reservedTotalTokens: 0,
  };
}

function liveReservationFits(
  usage: InMemoryLiveAuthorityUsageV1,
  reservation: ModelRuntimeLiveAuthorityReservationV1,
): boolean {
  const planned = reservation.planned;
  const limits = reservation.limits;
  return (
    usage.activeConcurrentJobs < limits.maximumConcurrentJobs &&
    usage.reservedInvocations + planned.invocations <=
      limits.maximumInvocations &&
    usage.reservedInputTokens + planned.inputTokens <=
      limits.maximumInputTokens &&
    usage.reservedOutputTokens + planned.outputTokens <=
      limits.maximumOutputTokens &&
    usage.reservedTotalTokens + planned.totalTokens <=
      limits.maximumTotalTokens &&
    usage.reservedCreditUnits + planned.creditUnits <=
      limits.maximumCreditUnits &&
    usage.reservedEstimatedMicroUsd + planned.estimatedMicroUsd <=
      limits.maximumEstimatedMicroUsd
  );
}

/**
 * Deterministic testing/reference adapter only. Production must provide one
 * tenant-first durable atomic store with equivalent claim, fencing, CAS, and
 * outbox semantics. Live values are conservative capacity reservations, never
 * actual model-token, credit, cost, or settlement counters.
 */
export class InMemoryModelRuntimeAdmissionStoreV1 implements ModelRuntimeAdmissionStoreV1 {
  readonly #activeConcurrency = new Map<string, number>();
  readonly #liveAuthorityUsage = new Map<
    Sha256Digest,
    InMemoryLiveAuthorityUsageV1
  >();
  readonly #records = new Map<Sha256Digest, InMemoryAdmissionRecordV1>();
  readonly #requestCounts = new Map<string, number>();
  #nextFence = 1;

  #snapshot(input: {
    readonly claim: ModelRuntimeStateSnapshotRequestV1;
    readonly decidedAt: number;
    readonly organizationConcurrencyKey: string;
    readonly organizationWindowKey: string;
    readonly userConcurrencyKey: string;
    readonly userWindowKey: string;
  }): ModelRuntimeStateSnapshotV1 {
    const organizationBounds = windowBounds(
      input.decidedAt,
      input.claim.organizationWindowSeconds,
    );
    const userBounds = windowBounds(
      input.decidedAt,
      input.claim.userWindowSeconds,
    );
    const liveReservation = input.claim.liveAuthorityReservation;
    const liveAuthorityUsage =
      liveReservation === undefined
        ? undefined
        : (this.#liveAuthorityUsage.get(liveReservation.authorityDigest) ??
          emptyLiveAuthorityUsage(liveReservation.authorityDigest));
    const withoutDigest = {
      activeConcurrencyLeaseIds: [...this.#records.values()]
        .filter(
          (record) =>
            record.active &&
            record.organizationId === input.claim.organizationId,
        )
        .flatMap((record) => (record.leaseId === null ? [] : [record.leaseId]))
        .sort(),
      capturedAt: input.claim.decidedAt,
      contractVersion: 1 as const,
      idempotencyReplay: this.#records.has(input.claim.tenantScopeDigest),
      ...(liveAuthorityUsage === undefined
        ? {}
        : { liveAuthorityUsage: structuredClone(liveAuthorityUsage) }),
      organizationId: input.claim.organizationId,
      policyDigest: input.claim.runtimePolicyDigest,
      projectId: input.claim.projectId,
      recordKind: "model-runtime-state-snapshot" as const,
      requestDigest: input.claim.requestDigest,
      snapshotId: `runtime_snapshot_${digestStructuredValue({
        capturedAt: input.claim.decidedAt,
        requestDigest: input.claim.requestDigest,
        runtimePolicyDigest: input.claim.runtimePolicyDigest,
        tenantScopeDigest: input.claim.tenantScopeDigest,
      }).slice("sha256:".length, "sha256:".length + 48)}`,
      userId: input.claim.userId,
      windows: {
        organization: {
          activeConcurrentJobs: mapCount(
            this.#activeConcurrency,
            input.organizationConcurrencyKey,
          ),
          requestCount: mapCount(
            this.#requestCounts,
            input.organizationWindowKey,
          ),
          windowEndsAt: organizationBounds.endsAt,
          windowStartedAt: organizationBounds.startsAt,
        },
        user: {
          activeConcurrentJobs: mapCount(
            this.#activeConcurrency,
            input.userConcurrencyKey,
          ),
          requestCount: mapCount(this.#requestCounts, input.userWindowKey),
          windowEndsAt: userBounds.endsAt,
          windowStartedAt: userBounds.startsAt,
        },
      },
    };
    return modelRuntimeStateSnapshotV1Schema.parse({
      ...withoutDigest,
      snapshotDigest: digestStructuredValue(withoutDigest),
    });
  }

  #state(input: ModelRuntimeStateSnapshotRequestV1): {
    readonly decidedAt: number;
    readonly organizationConcurrencyKey: string;
    readonly organizationWindowKey: string;
    readonly snapshot: ModelRuntimeStateSnapshotV1;
    readonly userConcurrencyKey: string;
    readonly userWindowKey: string;
  } {
    const decidedAt = assertInstant(input.decidedAt);
    const organizationWindowKey = windowKey(
      input.organizationId,
      decidedAt,
      input.organizationWindowSeconds,
    );
    const userWindowKey = windowKey(
      `${input.organizationId}\u0000${input.userId}`,
      decidedAt,
      input.userWindowSeconds,
    );
    const organizationConcurrencyKey = `organization\u0000${input.organizationId}`;
    const userConcurrencyKey = `user\u0000${input.organizationId}\u0000${input.userId}`;
    return {
      decidedAt,
      organizationConcurrencyKey,
      organizationWindowKey,
      snapshot: this.#snapshot({
        claim: input,
        decidedAt,
        organizationConcurrencyKey,
        organizationWindowKey,
        userConcurrencyKey,
        userWindowKey,
      }),
      userConcurrencyKey,
      userWindowKey,
    };
  }

  #newExecutionLease(
    tenantScopeDigest: Sha256Digest,
    revision: number,
    acquiredAt: string,
    expiresAt: string,
    recoveryOnly: boolean,
  ): ModelRuntimeExecutionLeaseV1 {
    if (assertInstant(expiresAt) <= assertInstant(acquiredAt)) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    const fence = this.#nextFence;
    this.#nextFence += 1;
    const suffix = tenantScopeDigest.slice(
      "sha256:".length,
      "sha256:".length + 32,
    );
    return {
      acquiredAt,
      executionLeaseId: `runtime_execution_${String(fence)}_${suffix}`,
      expiresAt,
      fencingToken: `runtime_fence_${String(fence)}`,
      recoveryOnly,
      revision,
    };
  }

  #appendOutbox(
    record: InMemoryAdmissionRecordV1,
    entries: readonly ModelRuntimeTelemetryOutboxEntryV1[],
  ): void {
    for (const entry of entries) {
      if (
        entry.outboxId !==
        digestStructuredValue({ audit: entry.audit, metric: entry.metric })
      ) {
        throw new ModelRuntimeControlError("routing-authority-mismatch");
      }
      const existing = record.outbox.get(entry.outboxId);
      if (
        existing !== undefined &&
        digestStructuredValue(existing.entry) !== digestStructuredValue(entry)
      ) {
        throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
      }
      if (existing === undefined) {
        record.outbox.set(entry.outboxId, {
          acknowledged: false,
          entry: structuredClone(entry),
        });
      }
    }
  }

  #recordMatchesLease(
    record: InMemoryAdmissionRecordV1,
    executionLease: ModelRuntimeExecutionLeaseV1,
  ): boolean {
    return (
      record.executionLease?.executionLeaseId ===
        executionLease.executionLeaseId &&
      record.executionLease.fencingToken === executionLease.fencingToken &&
      record.executionLease.acquiredAt === executionLease.acquiredAt &&
      record.executionLease.expiresAt === executionLease.expiresAt &&
      record.executionLease.recoveryOnly === executionLease.recoveryOnly &&
      record.executionLease.revision === executionLease.revision
    );
  }

  public inspect(
    request: ModelRuntimeStateSnapshotRequestV1,
  ): Promise<ModelRuntimeStateSnapshotV1> {
    return Promise.resolve(this.#state(request).snapshot);
  }

  #hasActiveLeaseIdCollision(input: {
    readonly leaseId: string;
    readonly organizationId: string;
    readonly tenantScopeDigest: Sha256Digest;
  }): boolean {
    return [...this.#records.values()].some(
      (record) =>
        record.active &&
        record.organizationId === input.organizationId &&
        record.leaseId === input.leaseId &&
        record.tenantScopeDigest !== input.tenantScopeDigest,
    );
  }

  #releaseActive(record: InMemoryAdmissionRecordV1): void {
    if (!record.active || record.executionLease === null) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    const organizationActive = mapCount(
      this.#activeConcurrency,
      record.organizationConcurrencyKey,
    );
    const userActive = mapCount(
      this.#activeConcurrency,
      record.userConcurrencyKey,
    );
    const liveUsage =
      record.liveAuthorityDigest === null
        ? null
        : this.#liveAuthorityUsage.get(record.liveAuthorityDigest);
    if (
      organizationActive < 1 ||
      userActive < 1 ||
      (record.liveAuthorityDigest !== null &&
        (liveUsage === null ||
          liveUsage === undefined ||
          liveUsage.activeConcurrentJobs < 1))
    ) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    this.#activeConcurrency.set(
      record.organizationConcurrencyKey,
      organizationActive - 1,
    );
    this.#activeConcurrency.set(record.userConcurrencyKey, userActive - 1);
    if (liveUsage !== null && liveUsage !== undefined) {
      liveUsage.activeConcurrentJobs -= 1;
    }
    record.active = false;
    record.executionLease = null;
  }

  public claim(
    claim: ModelRuntimeAdmissionClaimV1,
  ): Promise<ModelRuntimeAdmissionClaimResultV1> {
    const trustedNow = assertInstant(claim.decidedAt);
    const executionLeaseExpiresAt = assertInstant(
      claim.executionLeaseExpiresAt,
    );
    if (executionLeaseExpiresAt <= trustedNow) {
      return Promise.resolve({ kind: "conflict" });
    }
    const existing = this.#records.get(claim.tenantScopeDigest);
    const claimedLeaseId = claim.leaseId ?? null;
    const commercialExpired =
      trustedNow >= assertInstant(claim.commercialExpiresAt);
    if (
      claim.acquire &&
      claimedLeaseId !== null &&
      this.#hasActiveLeaseIdCollision({
        leaseId: claimedLeaseId,
        organizationId: claim.organizationId,
        tenantScopeDigest: claim.tenantScopeDigest,
      })
    ) {
      return Promise.resolve({ kind: "conflict" });
    }
    if (existing !== undefined) {
      if (
        existing.fingerprint !== claim.fingerprint ||
        existing.leaseId !== claimedLeaseId
      ) {
        return Promise.resolve({ kind: "conflict" });
      }
      if (existing.terminal !== null) {
        if (existing.active || existing.executionLease !== null) {
          return Promise.resolve({ kind: "conflict" });
        }
        return Promise.resolve({
          kind: "duplicate-terminal",
          terminal: structuredClone(existing.terminal),
        });
      }
      if (existing.active) {
        const activeLease = existing.executionLease;
        if (activeLease === null) {
          return Promise.resolve({ kind: "conflict" });
        }
        if (trustedNow < assertInstant(activeLease.expiresAt)) {
          return Promise.resolve({ kind: "duplicate-in-progress" });
        }
        this.#releaseActive(existing);
        existing.revision += 1;
      }
      const settlementRecovery =
        existing.pending?.commercial?.state === "settlement-pending";
      const recoveryOnly = commercialExpired || settlementRecovery;
      if (
        !claim.acquire ||
        claim.deniedTerminal !== undefined ||
        existing.leaseId === null
      ) {
        return Promise.resolve({ kind: "conflict" });
      }
      const reservation = claim.liveAuthorityReservation;
      if (
        (reservation === undefined) !==
          (existing.liveAuthorityDigest === null) ||
        (reservation !== undefined &&
          reservation.authorityDigest !== existing.liveAuthorityDigest)
      ) {
        return Promise.resolve({ kind: "conflict" });
      }
      const organizationActive = mapCount(
        this.#activeConcurrency,
        existing.organizationConcurrencyKey,
      );
      const userActive = mapCount(
        this.#activeConcurrency,
        existing.userConcurrencyKey,
      );
      if (
        organizationActive >= claim.limits.maximumConcurrentOrganizationJobs ||
        userActive >= claim.limits.maximumConcurrentUserJobs
      ) {
        return Promise.resolve({
          kind: "limit-changed",
          reason: "concurrency-limit-exceeded",
          snapshot: this.#state(claim).snapshot,
        });
      }
      if (reservation !== undefined) {
        const usage = this.#liveAuthorityUsage.get(reservation.authorityDigest);
        if (
          usage === undefined ||
          usage.activeConcurrentJobs >= reservation.limits.maximumConcurrentJobs
        ) {
          return Promise.resolve({
            kind: "limit-changed",
            reason: "concurrency-limit-exceeded",
            snapshot: this.#state(claim).snapshot,
          });
        }
        usage.activeConcurrentJobs += 1;
      }
      this.#activeConcurrency.set(
        existing.organizationConcurrencyKey,
        organizationActive + 1,
      );
      this.#activeConcurrency.set(existing.userConcurrencyKey, userActive + 1);
      existing.active = true;
      existing.executionLease = this.#newExecutionLease(
        claim.tenantScopeDigest,
        existing.revision,
        claim.decidedAt,
        claim.executionLeaseExpiresAt,
        recoveryOnly,
      );
      return Promise.resolve({
        admissionDecision: structuredClone(existing.admissionDecision),
        executionLease: structuredClone(existing.executionLease),
        kind: "claimed",
        pending:
          existing.pending === null ? null : structuredClone(existing.pending),
        snapshot: this.#state(claim).snapshot,
      });
    }

    const state = this.#state(claim);
    const { snapshot } = state;
    if (snapshot.snapshotDigest !== claim.snapshotDigest) {
      return Promise.resolve({ kind: "conflict" });
    }
    if (commercialExpired) {
      return Promise.resolve({ kind: "expired" });
    }
    const denied = !claim.acquire;
    if (
      denied !== (claim.deniedTerminal !== undefined) ||
      claim.acquire !== (claim.leaseId !== undefined) ||
      (claim.deniedTerminal !== undefined &&
        (claim.deniedTerminal.admission.outcome !== "denied" ||
          claim.deniedTerminal.commercial !== null ||
          claim.deniedTerminal.output !== null))
    ) {
      return Promise.resolve({ kind: "conflict" });
    }
    if (
      claim.acquire &&
      (snapshot.windows.organization.requestCount >=
        claim.limits.maximumOrganizationRequests ||
        snapshot.windows.user.requestCount >= claim.limits.maximumUserRequests)
    ) {
      return Promise.resolve({
        kind: "limit-changed",
        reason: "request-limit-exceeded",
        snapshot,
      });
    }
    if (
      claim.acquire &&
      (snapshot.windows.organization.activeConcurrentJobs >=
        claim.limits.maximumConcurrentOrganizationJobs ||
        snapshot.windows.user.activeConcurrentJobs >=
          claim.limits.maximumConcurrentUserJobs)
    ) {
      return Promise.resolve({
        kind: "limit-changed",
        reason: "concurrency-limit-exceeded",
        snapshot,
      });
    }
    const reservation = claim.liveAuthorityReservation;
    if (claim.acquire && reservation !== undefined) {
      const usage =
        this.#liveAuthorityUsage.get(reservation.authorityDigest) ??
        emptyLiveAuthorityUsage(reservation.authorityDigest);
      if (!liveReservationFits(usage, reservation)) {
        return Promise.resolve({
          kind: "limit-changed",
          reason:
            usage.activeConcurrentJobs >=
            reservation.limits.maximumConcurrentJobs
              ? "concurrency-limit-exceeded"
              : "live-evaluation-not-authorized",
          snapshot,
        });
      }
    }

    this.#requestCounts.set(
      state.organizationWindowKey,
      snapshot.windows.organization.requestCount + 1,
    );
    this.#requestCounts.set(
      state.userWindowKey,
      snapshot.windows.user.requestCount + 1,
    );
    const record: InMemoryAdmissionRecordV1 = {
      active: false,
      admissionDecision: structuredClone(claim.admissionDecision),
      admissionRequest: structuredClone(claim.admissionRequest),
      executionLease: null,
      fingerprint: claim.fingerprint,
      leaseId: claimedLeaseId,
      liveAuthorityDigest: null,
      organizationConcurrencyKey: state.organizationConcurrencyKey,
      organizationId: claim.organizationId,
      organizationWindowKey: state.organizationWindowKey,
      outbox: new Map(),
      pending: null,
      revision: 0,
      snapshot: structuredClone(snapshot),
      tenantScopeDigest: claim.tenantScopeDigest,
      terminal: null,
      userConcurrencyKey: state.userConcurrencyKey,
      userId: claim.userId,
      userWindowKey: state.userWindowKey,
    };
    this.#appendOutbox(record, claim.claimOutbox);
    if (denied) {
      const terminal = claim.deniedTerminal;
      if (terminal === undefined) {
        return Promise.resolve({ kind: "conflict" });
      }
      record.terminal = structuredClone(terminal);
      this.#records.set(claim.tenantScopeDigest, record);
      return Promise.resolve({ kind: "denied", snapshot, terminal });
    }
    const leaseId = claim.leaseId;
    if (leaseId === undefined) {
      return Promise.resolve({ kind: "conflict" });
    }
    this.#activeConcurrency.set(
      state.organizationConcurrencyKey,
      snapshot.windows.organization.activeConcurrentJobs + 1,
    );
    this.#activeConcurrency.set(
      state.userConcurrencyKey,
      snapshot.windows.user.activeConcurrentJobs + 1,
    );
    if (reservation !== undefined) {
      const current =
        this.#liveAuthorityUsage.get(reservation.authorityDigest) ??
        emptyLiveAuthorityUsage(reservation.authorityDigest);
      const planned = reservation.planned;
      const next = {
        activeConcurrentJobs: current.activeConcurrentJobs + 1,
        authorityDigest: reservation.authorityDigest,
        reservedCacheReadTokens:
          current.reservedCacheReadTokens + planned.cacheReadTokens,
        reservedCacheWriteTokens:
          current.reservedCacheWriteTokens + planned.cacheWriteTokens,
        reservedCreditUnits: current.reservedCreditUnits + planned.creditUnits,
        reservedEstimatedMicroUsd:
          current.reservedEstimatedMicroUsd + planned.estimatedMicroUsd,
        reservedInputTokens: current.reservedInputTokens + planned.inputTokens,
        reservedInvocations: current.reservedInvocations + planned.invocations,
        reservedOutputTokens:
          current.reservedOutputTokens + planned.outputTokens,
        reservedTotalTokens: current.reservedTotalTokens + planned.totalTokens,
      } satisfies InMemoryLiveAuthorityUsageV1;
      this.#liveAuthorityUsage.set(reservation.authorityDigest, next);
      record.liveAuthorityDigest = reservation.authorityDigest;
    }
    record.active = true;
    record.executionLease = this.#newExecutionLease(
      claim.tenantScopeDigest,
      record.revision,
      claim.decidedAt,
      claim.executionLeaseExpiresAt,
      false,
    );
    this.#records.set(claim.tenantScopeDigest, record);
    return Promise.resolve({
      admissionDecision: structuredClone(record.admissionDecision),
      executionLease: structuredClone(record.executionLease),
      kind: "claimed",
      pending: null,
      snapshot,
    });
  }
  #assertTransitionLease(input: {
    readonly executionLease: ModelRuntimeExecutionLeaseV1;
    readonly record: InMemoryAdmissionRecordV1;
    readonly trustedNow: string;
  }): void {
    if (
      !input.record.active ||
      input.record.terminal !== null ||
      !this.#recordMatchesLease(input.record, input.executionLease) ||
      input.record.revision !== input.executionLease.revision ||
      assertInstant(input.trustedNow) >=
        assertInstant(input.executionLease.expiresAt)
    ) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
  }

  public assertExecutionLease(input: {
    readonly commercialExpiresAt: string;
    readonly executionLease: ModelRuntimeExecutionLeaseV1;
    readonly tenantScopeDigest: Sha256Digest;
    readonly trustedNow: string;
  }): Promise<void> {
    const existing = this.#records.get(input.tenantScopeDigest);
    if (existing === undefined) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    this.#assertTransitionLease({
      executionLease: input.executionLease,
      record: existing,
      trustedNow: input.trustedNow,
    });
    if (
      assertInstant(input.trustedNow) >=
        assertInstant(input.commercialExpiresAt) &&
      !input.executionLease.recoveryOnly
    ) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    return Promise.resolve();
  }

  public checkpointPendingAndRelease(input: {
    readonly executionLease: ModelRuntimeExecutionLeaseV1;
    readonly fingerprint: Sha256Digest;
    readonly pending: ModelRuntimeAdmissionTerminalV1;
    readonly pendingOutbox: readonly ModelRuntimeTelemetryOutboxEntryV1[];
    readonly tenantScopeDigest: Sha256Digest;
    readonly trustedNow: string;
  }): Promise<void> {
    const existing = this.#records.get(input.tenantScopeDigest);
    if (existing === undefined) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    if (
      existing.fingerprint !== input.fingerprint ||
      input.pending.admission.outcome !== "allowed" ||
      input.pending.commercial?.state !== "settlement-pending" ||
      digestStructuredValue(input.pending.admission) !==
        digestStructuredValue(existing.admissionDecision)
    ) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    this.#assertTransitionLease({
      executionLease: input.executionLease,
      record: existing,
      trustedNow: input.trustedNow,
    });
    if (
      existing.pending !== null &&
      digestStructuredValue(existing.pending) !==
        digestStructuredValue(input.pending)
    ) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    this.#appendOutbox(existing, input.pendingOutbox);
    existing.pending = structuredClone(input.pending);
    this.#releaseActive(existing);
    existing.revision += 1;
    return Promise.resolve();
  }

  public completeAndRelease(input: {
    readonly executionLease: ModelRuntimeExecutionLeaseV1;
    readonly fingerprint: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
    readonly terminal: ModelRuntimeAdmissionTerminalV1;
    readonly terminalOutbox: readonly ModelRuntimeTelemetryOutboxEntryV1[];
    readonly trustedNow: string;
  }): Promise<void> {
    const existing = this.#records.get(input.tenantScopeDigest);
    if (existing === undefined) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    if (
      existing.fingerprint !== input.fingerprint ||
      input.terminal.admission.outcome !== "allowed" ||
      input.terminal.commercial === null ||
      input.terminal.commercial.state === "settlement-pending" ||
      digestStructuredValue(input.terminal.admission) !==
        digestStructuredValue(existing.admissionDecision)
    ) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    this.#assertTransitionLease({
      executionLease: input.executionLease,
      record: existing,
      trustedNow: input.trustedNow,
    });
    if (
      existing.terminal !== null &&
      digestStructuredValue(existing.terminal) !==
        digestStructuredValue(input.terminal)
    ) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    this.#appendOutbox(existing, input.terminalOutbox);
    existing.pending = null;
    existing.terminal = structuredClone(input.terminal);
    this.#releaseActive(existing);
    existing.revision += 1;
    return Promise.resolve();
  }
  #operationalExecutionBinding(input: {
    readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
    readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
    readonly tenantScopeDigest: Sha256Digest;
  }): ModelRuntimePersistedExecutionBindingV1 {
    const existing = this.#records.get(input.tenantScopeDigest);
    const executed = existing?.terminal ?? existing?.pending ?? null;
    if (
      existing === undefined ||
      existing.active ||
      executed === null ||
      existing.admissionDecision.outcome !== "allowed" ||
      !existing.admissionDecision.invokeModel ||
      executed.admission.outcome !== "allowed" ||
      !executed.admission.invokeModel ||
      executed.commercial === null ||
      digestStructuredValue(existing.admissionDecision) !==
        digestStructuredValue(input.admissionDecision) ||
      digestStructuredValue(existing.admissionRequest) !==
        digestStructuredValue(input.admissionRequest) ||
      digestStructuredValue(executed.admission) !==
        digestStructuredValue(existing.admissionDecision)
    ) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    return {
      fingerprint: existing.fingerprint,
      tenantScopeDigest: existing.tenantScopeDigest,
      terminalDigest: digestStructuredValue(executed),
    };
  }

  public readOperationalExecutionBinding(input: {
    readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
    readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
    readonly tenantScopeDigest: Sha256Digest;
  }): Promise<ModelRuntimePersistedExecutionBindingV1> {
    return Promise.resolve(this.#operationalExecutionBinding(input));
  }

  public appendOperationalOutbox(input: {
    readonly admissionDecision: ModelRuntimeAdmissionDecisionV1;
    readonly admissionRequest: ModelRuntimeAdmissionRequestV1;
    readonly entry: ModelRuntimeTelemetryOutboxEntryV1;
    readonly fingerprint: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
    readonly terminalDigest: Sha256Digest;
  }): Promise<void> {
    const binding = this.#operationalExecutionBinding(input);
    const existing = this.#records.get(input.tenantScopeDigest);
    if (
      existing === undefined ||
      binding.fingerprint !== input.fingerprint ||
      binding.terminalDigest !== input.terminalDigest
    ) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    const entry = parseModelRuntimeTelemetryOutboxEntryV1(input.entry);
    const eventKind = entry.audit.eventKind;
    const operationalKind = Object.prototype.hasOwnProperty.call(
      runtimeOperationalOperations,
      eventKind,
    );
    if (
      (!operationalKind && eventKind !== "eval-regression") ||
      entry.metric.eventKind !== eventKind ||
      entry.audit.admissionDecisionDigest !==
        input.admissionDecision.decisionDigest ||
      entry.audit.idempotencyKeyDigest !==
        input.admissionRequest.idempotencyKeyDigest ||
      entry.audit.organizationId !== input.admissionRequest.organizationId ||
      entry.audit.projectId !== input.admissionRequest.projectId ||
      entry.audit.userId !== input.admissionRequest.userId ||
      entry.metric.organizationScopeDigest !==
        digestStructuredValue({
          organizationId: input.admissionRequest.organizationId,
        }) ||
      !entry.audit.referenceDigests.includes(
        input.admissionRequest.requestDigest,
      ) ||
      !entry.audit.referenceDigests.includes(
        input.admissionDecision.decisionDigest,
      ) ||
      !entry.audit.referenceDigests.includes(input.terminalDigest) ||
      (operationalKind &&
        (entry.metric.sourceAuthority !== "runtime-control-v1" ||
          entry.metric.unit !== "count" ||
          entry.metric.value !== 1)) ||
      (eventKind === "eval-regression" &&
        (entry.metric.sourceAuthority !== "deterministic-evaluation-v1" ||
          entry.metric.unit !== "basis-points"))
    ) {
      throw new ModelRuntimeControlError("routing-authority-mismatch");
    }
    this.#appendOutbox(existing, [entry]);
    return Promise.resolve();
  }

  public listPendingOutbox(input: {
    readonly fingerprint: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
  }): Promise<readonly ModelRuntimeTelemetryOutboxEntryV1[]> {
    const existing = this.#records.get(input.tenantScopeDigest);
    if (existing?.fingerprint !== input.fingerprint) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    return Promise.resolve(
      [...existing.outbox.values()]
        .filter((record) => !record.acknowledged)
        .map((record) => structuredClone(record.entry))
        .sort((left, right) => left.outboxId.localeCompare(right.outboxId)),
    );
  }

  public acknowledgeOutbox(input: {
    readonly fingerprint: Sha256Digest;
    readonly outboxId: Sha256Digest;
    readonly tenantScopeDigest: Sha256Digest;
  }): Promise<void> {
    const existing = this.#records.get(input.tenantScopeDigest);
    const outbox = existing?.outbox.get(input.outboxId);
    if (existing?.fingerprint !== input.fingerprint || outbox === undefined) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    outbox.acknowledged = true;
    return Promise.resolve();
  }

  public release(input: {
    readonly executionLease: ModelRuntimeExecutionLeaseV1;
    readonly tenantScopeDigest: Sha256Digest;
  }): Promise<void> {
    const existing = this.#records.get(input.tenantScopeDigest);
    if (
      existing === undefined ||
      !this.#recordMatchesLease(existing, input.executionLease)
    ) {
      throw new ModelRuntimeControlError("stale-or-duplicate-conflict");
    }
    this.#releaseActive(existing);
    existing.revision += 1;
    return Promise.resolve();
  }
}
