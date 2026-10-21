import {
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
  ModelRuntimeControlError,
  parseModelRuntimeTelemetryOutboxEntryV1,
  type ModelRuntimeAdmissionClaimV1,
  type ModelRuntimeAdmissionTerminalV1,
  type ModelRuntimeExecutionLeaseV1,
  type ModelRuntimeStateSnapshotRequestV1,
  type ModelRuntimeTelemetryOutboxEntryV1,
} from "@cloudmarkup/model-gateway";
import {
  modelRuntimeAdmissionDecisionV1Schema,
  modelRuntimeAdmissionRequestV1Schema,
  modelRuntimeHostEvidenceV1Schema,
  modelRuntimeStateSnapshotV1Schema,
  serializeCanonicalJson,
  sha256DigestSchema,
  type ModelRuntimeAdmissionRequestV1,
  type ModelRuntimeAdmissionDecisionV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import {
  parseCommercialWorkflowResponseMetadata,
  workflowIdSchema,
  workflowInstantSchema,
} from "./model-commercial-workflow-codec.js";

export const RUNTIME_ADMISSION_METADATA_BYTES = 16384;
export const RUNTIME_ADMISSION_OUTBOX_LIMIT = 256;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = sha256DigestSchema;
const id = workflowIdSchema;
const instant = workflowInstantSchema;
export function admissionFail(): never {
  throw new ModelRuntimeControlError("routing-authority-mismatch");
}
export function admissionAssert(condition: boolean): asserts condition {
  if (!condition) admissionFail();
}
export function admissionChecked<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return admissionFail();
  }
}
export function admissionJson(
  value: unknown,
  maximum = RUNTIME_ADMISSION_METADATA_BYTES,
): string {
  return admissionChecked(() => {
    const text = serializeCanonicalJson(value);
    admissionAssert(
      new TextEncoder().encode(text).byteLength <= maximum &&
        inspectModelValueForSecretCandidatesV1(value).detectedValueCount === 0,
    );
    return text;
  });
}
export function admissionRead(value: unknown): unknown {
  return admissionChecked(() =>
    typeof value === "string" ? (JSON.parse(value) as unknown) : value,
  );
}
export const admissionScopeSchema = z
  .object({ organizationId: id, projectId: id, userId: id })
  .strict();
export type RuntimeAdmissionScope = z.output<typeof admissionScopeSchema>;
export function admissionScopeDigest(
  value: RuntimeAdmissionScope & { readonly idempotencyKeyDigest: string },
) {
  return digestStructuredValue({
    idempotencyKeyDigest: value.idempotencyKeyDigest,
    organizationId: value.organizationId,
    projectId: value.projectId,
    userId: value.userId,
  });
}
export const runtimeStateRequestShape = {
  decidedAt: instant,
  idempotencyKeyDigest: digest,
  organizationId: id,
  organizationWindowSeconds: integer.min(1).max(86400),
  projectId: id,
  requestDigest: digest,
  runtimePolicyDigest: digest,
  tenantScopeDigest: digest,
  userId: id,
  userWindowSeconds: integer.min(1).max(86400),
};
const stateSchema = z.object(runtimeStateRequestShape).strict();
export function parseRuntimeStateRequest(
  value: ModelRuntimeStateSnapshotRequestV1,
  scope: RuntimeAdmissionScope,
): ModelRuntimeStateSnapshotRequestV1 {
  return admissionChecked(() => {
    const parsed = stateSchema.parse(value);
    admissionAssert(
      parsed.organizationId === scope.organizationId &&
        parsed.projectId === scope.projectId &&
        parsed.userId === scope.userId &&
        parsed.tenantScopeDigest === admissionScopeDigest(parsed),
    );
    return parsed;
  });
}
export function parseRuntimeOutbox(
  value: unknown,
): ModelRuntimeTelemetryOutboxEntryV1 {
  return admissionChecked(() => {
    const parsed = parseModelRuntimeTelemetryOutboxEntryV1(value);
    admissionJson(parsed, 8192);
    return parsed;
  });
}
export const runtimeExecutionLeaseSchema = z
  .object({
    acquiredAt: instant,
    executionLeaseId: id,
    expiresAt: instant,
    fencingToken: z.string().regex(/^runtime_fence_[1-9][0-9]{0,15}$/u),
    recoveryOnly: z.boolean(),
    revision: integer,
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.expiresAt) > Date.parse(value.acquiredAt) &&
      Date.parse(value.expiresAt) - Date.parse(value.acquiredAt) <= 300000,
  );
export const runtimeOutputMetadataSchema = z
  .object({
    allowListedOperationsEvidence: modelRuntimeHostEvidenceV1Schema,
    sourceOwnershipEvidence: modelRuntimeHostEvidenceV1Schema,
    noRawSensitiveContent: z.literal(true),
    outputBytes: integer,
    outputDigest: digest,
    outputTokens: integer,
    resultSanitized: z.literal(true),
    secretRedactionApplied: z.literal(true),
    structuredOutputValidated: z.literal(true),
  })
  .strict();
export function parseRuntimeTerminal(
  value: unknown,
  request: ModelRuntimeAdmissionRequestV1,
  decision: ModelRuntimeAdmissionDecisionV1,
): ModelRuntimeAdmissionTerminalV1 {
  return admissionChecked(() => {
    const raw = z
      .object({
        admission: modelRuntimeAdmissionDecisionV1Schema,
        commercial: z.unknown(),
        output: runtimeOutputMetadataSchema.nullable(),
      })
      .strict()
      .parse(value);
    const parsed = {
      admission: raw.admission,
      ...parseRuntimeTerminalDetails(raw, request, decision),
    };
    admissionJson(parsed);
    return parsed;
  });
}
/** Shared content-free terminal checks after the version-specific admission parser. */
export function parseRuntimeTerminalDetails(
  raw: {
    readonly commercial: unknown;
    readonly output: z.output<typeof runtimeOutputMetadataSchema> | null;
    readonly admission: unknown;
  },
  request: Pick<
    ModelRuntimeAdmissionRequestV1,
    | "organizationId"
    | "projectId"
    | "operation"
    | "inputDigest"
    | "catalogDigest"
    | "responseSchemaDigest"
    | "runtimePolicyDigest"
    | "requested"
  >,
  decision: Pick<ModelRuntimeAdmissionDecisionV1, "outcome">,
) {
  const commercial =
    raw.commercial === null
      ? null
      : parseCommercialWorkflowResponseMetadata(raw.commercial);
  admissionAssert(
    digestStructuredValue(raw.admission) === digestStructuredValue(decision),
  );
  if (decision.outcome === "denied")
    admissionAssert(commercial === null && raw.output === null);
  if (raw.output !== null) {
    const output = raw.output;
    admissionAssert(
      decision.outcome === "allowed" &&
        commercial !== null &&
        output.outputBytes <= request.requested.outputBytes &&
        output.outputTokens <= request.requested.outputTokens,
    );
    for (const [evidence, evidenceKind] of [
      [output.allowListedOperationsEvidence, "allow-listed-operations"],
      [output.sourceOwnershipEvidence, "source-ownership"],
    ] as const)
      admissionAssert(
        evidence.evidenceKind === evidenceKind &&
          evidence.organizationId === request.organizationId &&
          evidence.projectId === request.projectId &&
          evidence.operation === request.operation &&
          evidence.inputDigest === request.inputDigest &&
          evidence.outputDigest === output.outputDigest &&
          evidence.outputBytes === output.outputBytes &&
          evidence.outputTokens === output.outputTokens &&
          evidence.catalogDigest === request.catalogDigest &&
          evidence.responseSchemaDigest === request.responseSchemaDigest &&
          evidence.runtimePolicyDigest === request.runtimePolicyDigest,
      );
  }
  return { commercial, output: raw.output };
}
export function assertRuntimeDecision(
  request: ModelRuntimeAdmissionRequestV1,
  decision: ModelRuntimeAdmissionDecisionV1,
) {
  admissionAssert(
    request.executionClass === "normal" &&
      decision.executionClass === "normal" &&
      request.liveEvaluationAuthorityDigest === undefined &&
      decision.requestDigest === request.requestDigest &&
      decision.routingDecisionDigest === request.routingDecisionDigest &&
      decision.runtimePolicyDigest === request.runtimePolicyDigest &&
      decision.commercialEstimateDigest ===
        request.commercialEstimate.estimateDigest &&
      decision.evaluationAuthorityTupleDigest ===
        request.evaluationAuthorityTupleDigest &&
      decision.evaluationReportDigest === request.evaluationReportDigest &&
      decision.evaluationReportId === request.evaluationReportId &&
      decision.evaluationResultSetDigest === request.evaluationResultSetDigest,
  );
}
export const runtimeClaimMetadataShape = {
  acquire: z.boolean(),
  claimOutbox: z.array(z.unknown()).max(32),
  commercialExpiresAt: instant,
  deniedTerminal: z.unknown().optional(),
  executionLeaseExpiresAt: instant,
  fingerprint: digest,
  leaseId: id.optional(),
  limits: z
    .object({
      maximumConcurrentOrganizationJobs: integer,
      maximumConcurrentUserJobs: integer,
      maximumOrganizationRequests: integer,
      maximumUserRequests: integer,
    })
    .strict(),
  snapshotDigest: digest,
  snapshotId: id,
};
export function parseRuntimeClaim(
  value: unknown,
  scope: RuntimeAdmissionScope,
): ModelRuntimeAdmissionClaimV1 {
  return admissionChecked(() => {
    const raw = z
      .object({
        ...runtimeStateRequestShape,
        admissionDecision: modelRuntimeAdmissionDecisionV1Schema,
        admissionRequest: modelRuntimeAdmissionRequestV1Schema,
        ...runtimeClaimMetadataShape,
      })
      .strict()
      .parse(value);
    const { admissionRequest: request, admissionDecision: decision } = raw;
    parseRuntimeStateRequest(
      Object.fromEntries(
        Object.keys(runtimeStateRequestShape).map((key) => [
          key,
          Reflect.get(raw, key),
        ]),
      ) as unknown as ModelRuntimeStateSnapshotRequestV1,
      scope,
    );
    assertRuntimeDecision(request, decision);
    admissionAssert(
      request.organizationId === raw.organizationId &&
        request.projectId === raw.projectId &&
        request.userId === raw.userId &&
        request.idempotencyKeyDigest === raw.idempotencyKeyDigest &&
        request.requestDigest === raw.requestDigest &&
        request.runtimePolicyDigest === raw.runtimePolicyDigest &&
        raw.acquire === (decision.outcome === "allowed") &&
        raw.leaseId === decision.authorization.concurrencyLeaseId &&
        raw.acquire === (raw.deniedTerminal === undefined) &&
        Date.parse(raw.executionLeaseExpiresAt) > Date.parse(raw.decidedAt) &&
        Date.parse(raw.executionLeaseExpiresAt) - Date.parse(raw.decidedAt) <=
          300000,
    );
    const { deniedTerminal: denied, leaseId, ...rest } = raw;
    const parsed = {
      ...rest,
      claimOutbox: raw.claimOutbox.map((entry) =>
        bindRuntimeOutbox(parseRuntimeOutbox(entry), request, decision),
      ),
      ...(leaseId === undefined ? {} : { leaseId }),
      ...(denied === undefined
        ? {}
        : { deniedTerminal: parseRuntimeTerminal(denied, request, decision) }),
    };
    admissionJson({ admissionRequest: request, admissionDecision: decision });
    return parsed;
  });
}
export function bindRuntimeOutbox(
  entry: ModelRuntimeTelemetryOutboxEntryV1,
  request: Pick<
    ModelRuntimeAdmissionRequestV1,
    | "idempotencyKeyDigest"
    | "organizationId"
    | "projectId"
    | "userId"
    | "requestDigest"
  >,
  decision: Pick<ModelRuntimeAdmissionDecisionV1, "decisionDigest">,
) {
  admissionAssert(
    entry.audit.admissionDecisionDigest === decision.decisionDigest &&
      entry.audit.idempotencyKeyDigest === request.idempotencyKeyDigest &&
      entry.audit.organizationId === request.organizationId &&
      entry.audit.projectId === request.projectId &&
      entry.audit.userId === request.userId &&
      entry.audit.eventKind === entry.metric.eventKind &&
      entry.metric.organizationScopeDigest ===
        digestStructuredValue({ organizationId: request.organizationId }) &&
      entry.audit.referenceDigests.includes(request.requestDigest) &&
      entry.audit.referenceDigests.includes(decision.decisionDigest),
  );
  return entry;
}
export function runtimeWindow(now: string, seconds: number) {
  const start = Math.floor(Date.parse(now) / (seconds * 1000)) * seconds * 1000;
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + seconds * 1000).toISOString(),
  };
}
export interface RuntimeAdmissionRecord<
  Request = ModelRuntimeAdmissionRequestV1,
  Decision = ModelRuntimeAdmissionDecisionV1,
  Terminal = ModelRuntimeAdmissionTerminalV1,
> {
  readonly request: Request;
  readonly decision: Decision;
  readonly originalSnapshot: z.output<typeof modelRuntimeStateSnapshotV1Schema>;
  readonly fingerprint: z.output<typeof digest>;
  readonly tenantScopeDigest: z.output<typeof digest>;
  readonly commercialExpiresAt: string;
  readonly concurrencyLeaseId: string | null;
  readonly revision: number;
  /** Sticky after expired execution authority; never a refund or dispatch grant. */
  readonly recoveryRequired: boolean;
  readonly executionLease: ModelRuntimeExecutionLeaseV1 | null;
  readonly pending: Terminal | null;
  readonly terminal: Terminal | null;
}
export function parseRuntimeRecord(
  value: unknown,
  scope: RuntimeAdmissionScope,
): RuntimeAdmissionRecord {
  return admissionChecked(() => {
    const raw = z
      .object({
        request: modelRuntimeAdmissionRequestV1Schema,
        decision: modelRuntimeAdmissionDecisionV1Schema,
        originalSnapshot: modelRuntimeStateSnapshotV1Schema,
        fingerprint: digest,
        tenantScopeDigest: digest,
        commercialExpiresAt: instant,
        concurrencyLeaseId: id.nullable(),
        revision: integer,
        recoveryRequired: z.boolean(),
        executionLease: runtimeExecutionLeaseSchema.nullable(),
        pending: z.unknown(),
        terminal: z.unknown(),
      })
      .strict()
      .parse(admissionRead(value));
    assertRuntimeDecision(raw.request, raw.decision);
    const snapshot = raw.originalSnapshot;
    admissionAssert(
      snapshot.organizationId === raw.request.organizationId &&
        snapshot.projectId === raw.request.projectId &&
        snapshot.userId === raw.request.userId &&
        snapshot.requestDigest === raw.request.requestDigest &&
        snapshot.policyDigest === raw.request.runtimePolicyDigest,
    );
    admissionAssert(
      raw.request.organizationId === scope.organizationId &&
        raw.request.projectId === scope.projectId &&
        raw.request.userId === scope.userId &&
        raw.tenantScopeDigest === admissionScopeDigest(raw.request) &&
        raw.concurrencyLeaseId ===
          (raw.decision.authorization.concurrencyLeaseId ?? null) &&
        raw.originalSnapshot.liveAuthorityUsage === undefined,
    );
    const parsed = {
      ...raw,
      pending:
        raw.pending === null
          ? null
          : parseRuntimeTerminal(raw.pending, raw.request, raw.decision),
      terminal:
        raw.terminal === null
          ? null
          : parseRuntimeTerminal(raw.terminal, raw.request, raw.decision),
    };
    assertRuntimeRecordLifecycle(parsed);
    admissionJson(parsed);
    return parsed;
  });
}

/** Common lease/pending/terminal invariants; the calling codec binds its version. */
export function assertRuntimeRecordLifecycle(
  parsed: Pick<
    RuntimeAdmissionRecord,
    "revision" | "recoveryRequired" | "executionLease"
  > & {
    readonly decision: Pick<ModelRuntimeAdmissionDecisionV1, "outcome">;
    readonly pending: Pick<
      ModelRuntimeAdmissionTerminalV1,
      "commercial"
    > | null;
    readonly terminal: Pick<
      ModelRuntimeAdmissionTerminalV1,
      "commercial"
    > | null;
  },
) {
  admissionAssert(
    parsed.executionLease === null ||
      (parsed.executionLease.revision === parsed.revision &&
        parsed.terminal === null &&
        parsed.decision.outcome === "allowed"),
  );
  admissionAssert(
    parsed.pending === null ||
      parsed.pending.commercial?.state === "settlement-pending",
  );
  admissionAssert(
    parsed.terminal === null ||
      (parsed.decision.outcome === "denied"
        ? parsed.terminal.commercial === null
        : parsed.terminal.commercial !== null &&
          parsed.terminal.commercial.state !== "settlement-pending"),
  );
  admissionAssert(
    !parsed.recoveryRequired ||
      parsed.executionLease === null ||
      parsed.executionLease.recoveryOnly,
  );
}
