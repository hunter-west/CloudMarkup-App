import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import { sanitizedTerraformPlanV1Schema } from "./contracts.js";
import { canonicalJson, containsCredentialShape, sha256 } from "./security.js";

const stableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const deploymentKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/u);
const commitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const resourceTypeSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z][A-Za-z0-9_:.-]*$/u);

export const conformanceChangeActionV1Schema = z.enum([
  "create",
  "update",
  "delete",
  "replace",
]);
export const conformanceOwnershipV1Schema = z.enum([
  "managed",
  "user-extension",
  "external",
  "unmanaged",
  "unknown",
]);
export const conformanceIamChangeV1Schema = z.enum([
  "none",
  "expansion",
  "reduction",
  "unknown",
]);
export const conformanceNetworkChangeV1Schema = z.enum([
  "none",
  "public-exposure-increase",
  "public-exposure-decrease",
  "private-boundary-change",
  "unknown",
]);
export const conformanceApplicationBindingV1Schema = z.enum([
  "match",
  "mismatch",
  "not-applicable",
  "unknown",
]);
export const conformanceEvidenceConfidenceV1Schema = z.enum([
  "exact",
  "partial",
  "unknown",
]);
export const conformanceEvidenceScopeV1Schema = z.enum([
  "complete",
  "partial",
  "unknown",
]);

const semanticSignalsSchema = z
  .object({
    applicationBinding: conformanceApplicationBindingV1Schema,
    iam: conformanceIamChangeV1Schema,
    network: conformanceNetworkChangeV1Schema,
  })
  .strict();

const conformanceResourceBindingShape = {
  confidence: conformanceEvidenceConfidenceV1Schema,
  deploymentKey: deploymentKeySchema.optional(),
  graphId: stableIdSchema.optional(),
  ownership: conformanceOwnershipV1Schema,
  semantics: semanticSignalsSchema,
} as const;

export const terraformConformanceResourceBindingV1Schema = z
  .object({
    ...conformanceResourceBindingShape,
    addressDigest: sha256DigestSchema,
  })
  .strict();

export const cloudFormationConformanceResourceBindingV1Schema = z
  .object({
    ...conformanceResourceBindingShape,
    logicalResourceIdDigest: sha256DigestSchema,
  })
  .strict();

const conformanceToolPinSchema = z
  .object({
    digest: sha256DigestSchema,
    id: namespacedIdentifierSchema,
    version: semanticVersionSchema,
  })
  .strict();

const solutionRevisionReferenceSchema = z
  .object({ digest: sha256DigestSchema, id: stableIdSchema })
  .strict();

const commonPlanMetadataShape = {
  commitSha: commitShaSchema,
  createdAt: utcTimestampSchema,
  environmentId: stableIdSchema,
  expiresAt: utcTimestampSchema,
  generatedManifestDigest: sha256DigestSchema,
  planChecksum: sha256DigestSchema,
  scope: conformanceEvidenceScopeV1Schema,
  solutionRevision: solutionRevisionReferenceSchema,
  tool: conformanceToolPinSchema,
} as const;

export const terraformConformancePlanInputV1Schema = z
  .object({
    bindings: z.array(terraformConformanceResourceBindingV1Schema).max(10_000),
    contractVersion: z.literal(1),
    metadata: z
      .object({
        ...commonPlanMetadataShape,
        backendConfigDigest: sha256DigestSchema,
        target: z.literal("terraform"),
        workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/u),
      })
      .strict(),
    plan: sanitizedTerraformPlanV1Schema,
  })
  .strict();

const cloudFormationRawChangeSchema = z
  .object({
    ResourceChange: z
      .object({
        Action: z.enum(["Add", "Modify", "Remove"]),
        LogicalResourceId: z.string().min(1).max(255),
        Replacement: z.enum(["True", "False", "Conditional"]).optional(),
        ResourceType: z.string().min(1).max(256),
      })
      .strict(),
  })
  .strict();

const cloudFormationRawChangeSetSchema = z
  .object({
    ChangeSetId: z.string().min(1).max(2_048),
    Changes: z.array(cloudFormationRawChangeSchema).max(10_000),
    StackId: z.string().min(1).max(2_048),
  })
  .strict();

export const sanitizedCloudFormationChangeSetV1Schema = z
  .object({
    changeSetIdentityDigest: sha256DigestSchema,
    changes: z
      .array(
        z
          .object({
            action: conformanceChangeActionV1Schema,
            logicalResourceIdDigest: sha256DigestSchema,
            resourceType: resourceTypeSchema,
          })
          .strict(),
      )
      .max(10_000),
    contractVersion: z.literal(1),
    kind: z.literal("cloudmarkup.sanitized-cloudformation-change-set"),
    sourceChecksum: sha256DigestSchema,
    stackIdentityDigest: sha256DigestSchema,
  })
  .strict();

export const cloudFormationConformancePlanInputV1Schema = z
  .object({
    bindings: z
      .array(cloudFormationConformanceResourceBindingV1Schema)
      .max(10_000),
    changeSet: sanitizedCloudFormationChangeSetV1Schema,
    contractVersion: z.literal(1),
    metadata: z
      .object({
        ...commonPlanMetadataShape,
        changeSetIdentityDigest: sha256DigestSchema,
        stackIdentityDigest: sha256DigestSchema,
        target: z.literal("cloudformation"),
      })
      .strict(),
  })
  .strict();

export const conformancePlanInputV1Schema = z.union([
  terraformConformancePlanInputV1Schema,
  cloudFormationConformancePlanInputV1Schema,
]);

const normalizedChangeSchema = z
  .object({
    action: conformanceChangeActionV1Schema,
    applicationBinding: conformanceApplicationBindingV1Schema,
    confidence: conformanceEvidenceConfidenceV1Schema,
    deploymentKey: deploymentKeySchema.optional(),
    graphId: stableIdSchema.optional(),
    iam: conformanceIamChangeV1Schema,
    network: conformanceNetworkChangeV1Schema,
    ownership: conformanceOwnershipV1Schema,
    resourceIdentityDigest: sha256DigestSchema,
    resourceType: resourceTypeSchema,
  })
  .strict();

const normalizedPlanCommonShape = {
  changes: z.array(normalizedChangeSchema).max(10_000),
  commitSha: commitShaSchema,
  contractVersion: z.literal(1),
  createdAt: utcTimestampSchema,
  environmentId: stableIdSchema,
  evidenceChecksum: sha256DigestSchema,
  expiresAt: utcTimestampSchema,
  generatedManifestDigest: sha256DigestSchema,
  kind: z.literal("cloudmarkup.normalized-conformance-plan"),
  planChecksum: sha256DigestSchema,
  scope: conformanceEvidenceScopeV1Schema,
  solutionRevision: solutionRevisionReferenceSchema,
  sourceRepresentationChecksum: sha256DigestSchema,
  tool: conformanceToolPinSchema,
} as const;

export const normalizedConformancePlanV1Schema = z.discriminatedUnion(
  "target",
  [
    z
      .object({
        ...normalizedPlanCommonShape,
        backendConfigDigest: sha256DigestSchema,
        target: z.literal("terraform"),
        workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/u),
      })
      .strict(),
    z
      .object({
        ...normalizedPlanCommonShape,
        changeSetIdentityDigest: sha256DigestSchema,
        stackIdentityDigest: sha256DigestSchema,
        target: z.literal("cloudformation"),
      })
      .strict(),
  ],
);

export const conformancePlanExpectedV1Schema = z.discriminatedUnion("target", [
  z
    .object({
      backendConfigDigest: sha256DigestSchema,
      commitSha: commitShaSchema,
      evidenceChecksum: sha256DigestSchema,
      environmentId: stableIdSchema,
      generatedManifestDigest: sha256DigestSchema,
      now: utcTimestampSchema,
      planChecksum: sha256DigestSchema,
      solutionRevision: solutionRevisionReferenceSchema,
      target: z.literal("terraform"),
      tool: conformanceToolPinSchema,
      workspace: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,89}$/u),
    })
    .strict(),
  z
    .object({
      changeSetIdentityDigest: sha256DigestSchema,
      commitSha: commitShaSchema,
      evidenceChecksum: sha256DigestSchema,
      environmentId: stableIdSchema,
      generatedManifestDigest: sha256DigestSchema,
      now: utcTimestampSchema,
      planChecksum: sha256DigestSchema,
      solutionRevision: solutionRevisionReferenceSchema,
      stackIdentityDigest: sha256DigestSchema,
      target: z.literal("cloudformation"),
      tool: conformanceToolPinSchema,
    })
    .strict(),
]);

export const conformanceVerificationIssueV1Schema = z
  .object({
    code: z.string().regex(/^CONFORMANCE_[A-Z0-9_]+$/u),
    field: z.string().min(1).max(128).optional(),
    severity: z.enum(["error", "warning"]),
  })
  .strict();

const deploymentArtifactBindingSchema = z
  .object({
    applicationBindingDigest: sha256DigestSchema,
    applicationContractDigest: sha256DigestSchema,
    artifactDigest: sha256DigestSchema,
    artifactId: stableIdSchema,
    workloadId: stableIdSchema,
  })
  .strict();

const deploymentArtifactAttestationSchema = z
  .object({
    ...deploymentArtifactBindingSchema.shape,
    attestationDigest: sha256DigestSchema,
  })
  .strict();

export const deploymentConformanceInputV1Schema = z
  .object({
    approvedPlanEvidenceChecksum: sha256DigestSchema,
    artifactAttestations: z.array(deploymentArtifactAttestationSchema).max(256),
    commitSha: commitShaSchema,
    contractVersion: z.literal(1),
    environmentId: stableIdSchema,
    executedPlanEvidenceChecksum: sha256DigestSchema,
    generatedManifestDigest: sha256DigestSchema,
    observedAt: utcTimestampSchema,
    planIdentityDigest: sha256DigestSchema,
    smoke: z
      .object({
        evidenceDigest: sha256DigestSchema.optional(),
        state: z.enum(["passed", "failed", "not-run"]),
      })
      .strict(),
    solutionRevision: solutionRevisionReferenceSchema,
    target: z.enum(["terraform", "cloudformation"]),
    workflow: z
      .object({
        runAttempt: z.number().int().min(1).max(100),
        runId: z.string().regex(/^[1-9][0-9]{0,15}$/u),
        workflowDigest: sha256DigestSchema,
      })
      .strict(),
  })
  .strict();

export const deploymentConformanceExpectedV1Schema = z
  .object({
    approvedPlanEvidenceChecksum: sha256DigestSchema,
    commitSha: commitShaSchema,
    environmentId: stableIdSchema,
    expectedArtifactBindings: z.array(deploymentArtifactBindingSchema).max(256),
    generatedManifestDigest: sha256DigestSchema,
    planIdentityDigest: sha256DigestSchema,
    solutionRevision: solutionRevisionReferenceSchema,
    target: z.enum(["terraform", "cloudformation"]),
    workflow: deploymentConformanceInputV1Schema.shape.workflow,
  })
  .strict();

export const normalizedDeploymentConformanceV1Schema = z
  .object({
    artifactAttestations: z.array(deploymentArtifactAttestationSchema).max(256),
    commitSha: commitShaSchema,
    completeness: z.enum(["complete", "partial", "invalid"]),
    contractVersion: z.literal(1),
    evidenceChecksum: sha256DigestSchema,
    environmentId: stableIdSchema,
    generatedManifestDigest: sha256DigestSchema,
    issues: z.array(conformanceVerificationIssueV1Schema).max(256),
    kind: z.literal("cloudmarkup.normalized-deployment-conformance"),
    observedAt: utcTimestampSchema,
    planEvidenceChecksum: sha256DigestSchema,
    planIdentityDigest: sha256DigestSchema,
    smoke: deploymentConformanceInputV1Schema.shape.smoke,
    solutionRevision: solutionRevisionReferenceSchema,
    target: z.enum(["terraform", "cloudformation"]),
    workflow: deploymentConformanceInputV1Schema.shape.workflow,
  })
  .strict();

export const conformanceDriftClassV1Schema = z.enum([
  "managed-drift",
  "unmanaged-resource",
  "permission-drift",
  "network-drift",
  "application-binding-drift",
  "external-resource",
  "unknown",
]);

export const driftConformanceInputV1Schema = z
  .object({
    baselineDeploymentEvidenceChecksum: sha256DigestSchema,
    changes: z
      .array(
        z
          .object({
            action: z.union([
              conformanceChangeActionV1Schema,
              z.literal("unknown"),
            ]),
            classification: conformanceDriftClassV1Schema,
            confidence: conformanceEvidenceConfidenceV1Schema,
            deploymentKey: deploymentKeySchema.optional(),
            graphId: stableIdSchema.optional(),
            ownership: conformanceOwnershipV1Schema,
            resourceIdentityDigest: sha256DigestSchema,
          })
          .strict(),
      )
      .max(10_000),
    contractVersion: z.literal(1),
    environmentId: stableIdSchema,
    observedAt: utcTimestampSchema,
    scope: z.enum(["complete", "partial", "unknown"]),
    solutionRevision: solutionRevisionReferenceSchema,
    source: z.enum([
      "terraform-refresh-only",
      "cloudformation-stack-drift",
      "customer-read-only-observation",
    ]),
    target: z.enum(["terraform", "cloudformation"]),
    validUntil: utcTimestampSchema,
  })
  .strict();

export const driftConformanceExpectedV1Schema = z
  .object({
    approvedDeploymentEvidenceChecksum: sha256DigestSchema,
    environmentId: stableIdSchema,
    solutionRevision: solutionRevisionReferenceSchema,
    target: z.enum(["terraform", "cloudformation"]),
  })
  .strict();

export const normalizedDriftConformanceV1Schema = z
  .object({
    baselineDeploymentEvidenceChecksum: sha256DigestSchema,
    changes: driftConformanceInputV1Schema.shape.changes,
    contractVersion: z.literal(1),
    environmentId: stableIdSchema,
    evidenceChecksum: sha256DigestSchema,
    issues: z.array(conformanceVerificationIssueV1Schema).max(256),
    kind: z.literal("cloudmarkup.normalized-drift-conformance"),
    observedAt: utcTimestampSchema,
    remediation: z.literal("none"),
    scope: z.enum(["complete", "partial", "unknown", "invalid"]),
    solutionRevision: solutionRevisionReferenceSchema,
    source: driftConformanceInputV1Schema.shape.source,
    staleness: z.enum(["current", "stale"]),
    target: z.enum(["terraform", "cloudformation"]),
    validUntil: utcTimestampSchema,
  })
  .strict();

export type SanitizedCloudFormationChangeSetV1 = z.output<
  typeof sanitizedCloudFormationChangeSetV1Schema
>;
export type NormalizedConformancePlanV1 = z.output<
  typeof normalizedConformancePlanV1Schema
>;
export type ConformancePlanExpectedV1 = z.output<
  typeof conformancePlanExpectedV1Schema
>;
export type DriftConformanceExpectedV1 = z.output<
  typeof driftConformanceExpectedV1Schema
>;
export type NormalizedDeploymentConformanceV1 = z.output<
  typeof normalizedDeploymentConformanceV1Schema
>;
export type NormalizedDriftConformanceV1 = z.output<
  typeof normalizedDriftConformanceV1Schema
>;

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f))
      return true;
  }
  return false;
}

function checkedMetadata(value: string, label: string): string {
  if (
    value !== value.trim() ||
    containsCredentialShape(value) ||
    containsControlCharacter(value)
  ) {
    throw new TypeError(`CloudFormation ${label} is unsafe.`);
  }
  return value;
}

export function sanitizeCloudFormationChangeSetV1(
  rawInput: unknown,
): SanitizedCloudFormationChangeSetV1 {
  const raw = cloudFormationRawChangeSetSchema.parse(rawInput);
  const sourceChecksum = sha256(canonicalJson(raw));
  const seen = new Set<string>();
  const changes = raw.Changes.map(({ ResourceChange }) => {
    const logicalResourceId = checkedMetadata(
      ResourceChange.LogicalResourceId,
      "logical resource ID",
    );
    if (!/^[A-Za-z][A-Za-z0-9]{0,254}$/u.test(logicalResourceId)) {
      throw new TypeError("CloudFormation logical resource ID is unsupported.");
    }
    if (seen.has(logicalResourceId)) {
      throw new TypeError(
        "CloudFormation logical resource IDs must be unique.",
      );
    }
    seen.add(logicalResourceId);
    const resourceType = checkedMetadata(
      ResourceChange.ResourceType,
      "resource type",
    );
    resourceTypeSchema.parse(resourceType);
    const action =
      ResourceChange.Action === "Add"
        ? ("create" as const)
        : ResourceChange.Action === "Remove"
          ? ("delete" as const)
          : ResourceChange.Replacement === "True" ||
              ResourceChange.Replacement === "Conditional"
            ? ("replace" as const)
            : ("update" as const);
    return {
      action,
      logicalResourceIdDigest: sha256(
        `cloudmarkup.cloudformation-logical-id.v1\u0000${logicalResourceId}`,
      ),
      resourceType,
    };
  }).sort((left, right) =>
    compareUtf16(left.logicalResourceIdDigest, right.logicalResourceIdDigest),
  );
  return sanitizedCloudFormationChangeSetV1Schema.parse({
    changeSetIdentityDigest: sha256(
      checkedMetadata(raw.ChangeSetId, "change-set identity"),
    ),
    changes,
    contractVersion: 1,
    kind: "cloudmarkup.sanitized-cloudformation-change-set",
    sourceChecksum,
    stackIdentityDigest: sha256(checkedMetadata(raw.StackId, "stack identity")),
  });
}

function unknownBinding() {
  return {
    applicationBinding: "unknown" as const,
    confidence: "unknown" as const,
    iam: "unknown" as const,
    network: "unknown" as const,
    ownership: "unmanaged" as const,
  };
}

function sealPlan(
  projection: Record<string, unknown>,
): NormalizedConformancePlanV1 {
  return normalizedConformancePlanV1Schema.parse({
    ...projection,
    evidenceChecksum: sha256(canonicalJson(projection)),
  });
}

function changeOnlyScope(scope: "complete" | "partial" | "unknown") {
  return scope === "unknown" ? ("unknown" as const) : ("partial" as const);
}

function indexSemanticBindings<T>(input: {
  readonly bindings: readonly T[];
  readonly changeIdentities: ReadonlySet<string>;
  readonly identity: (binding: T) => string;
  readonly target: "CloudFormation" | "Terraform";
}): ReadonlyMap<string, T> {
  const indexed = new Map<string, T>();
  for (const binding of input.bindings) {
    const identity = input.identity(binding);
    if (indexed.has(identity)) {
      throw new TypeError(
        `${input.target} semantic binding identities must be unique.`,
      );
    }
    if (!input.changeIdentities.has(identity)) {
      throw new TypeError(
        `${input.target} semantic bindings must reference a sanitized resource change.`,
      );
    }
    indexed.set(identity, binding);
  }
  return indexed;
}

export function normalizeTerraformConformancePlanV1(
  rawInput: unknown,
): NormalizedConformancePlanV1 {
  const input = terraformConformancePlanInputV1Schema.parse(rawInput);
  const sourceRepresentationChecksum = sha256(canonicalJson(input.plan));
  if (input.metadata.planChecksum !== sourceRepresentationChecksum) {
    throw new TypeError(
      "Terraform plan checksum does not match the sanitized representation.",
    );
  }
  const bindings = indexSemanticBindings({
    bindings: input.bindings,
    changeIdentities: new Set(
      input.plan.resourceChanges.map((change) => change.address),
    ),
    identity: (binding) => binding.addressDigest,
    target: "Terraform",
  });
  const changes = input.plan.resourceChanges
    .flatMap((change) => {
      const action =
        change.actions.includes("replace") ||
        (change.actions.includes("delete") && change.actions.includes("create"))
          ? ("replace" as const)
          : change.actions.find(
              (candidate) =>
                conformanceChangeActionV1Schema.safeParse(candidate).success,
            );
      if (action === undefined) return [];
      const binding = bindings.get(change.address);
      const authority =
        binding === undefined
          ? unknownBinding()
          : {
              applicationBinding: binding.semantics.applicationBinding,
              confidence: binding.confidence,
              ...(binding.deploymentKey === undefined
                ? {}
                : { deploymentKey: binding.deploymentKey }),
              ...(binding.graphId === undefined
                ? {}
                : { graphId: binding.graphId }),
              iam: binding.semantics.iam,
              network: binding.semantics.network,
              ownership: binding.ownership,
            };
      return [
        {
          action,
          ...authority,
          resourceIdentityDigest: change.address,
          resourceType: change.type,
        },
      ];
    })
    .sort((left, right) =>
      compareUtf16(left.resourceIdentityDigest, right.resourceIdentityDigest),
    );
  const metadata = input.metadata;
  return sealPlan({
    backendConfigDigest: metadata.backendConfigDigest,
    changes,
    commitSha: metadata.commitSha,
    contractVersion: 1,
    createdAt: metadata.createdAt,
    environmentId: metadata.environmentId,
    expiresAt: metadata.expiresAt,
    generatedManifestDigest: metadata.generatedManifestDigest,
    kind: "cloudmarkup.normalized-conformance-plan",
    planChecksum: metadata.planChecksum,
    scope: changeOnlyScope(metadata.scope),
    solutionRevision: metadata.solutionRevision,
    sourceRepresentationChecksum,
    target: "terraform",
    tool: metadata.tool,
    workspace: metadata.workspace,
  });
}

export function normalizeCloudFormationConformancePlanV1(
  rawInput: unknown,
): NormalizedConformancePlanV1 {
  const input = cloudFormationConformancePlanInputV1Schema.parse(rawInput);
  if (input.metadata.planChecksum !== input.changeSet.sourceChecksum) {
    throw new TypeError(
      "CloudFormation plan checksum does not match the sanitized change-set representation.",
    );
  }
  if (
    input.metadata.changeSetIdentityDigest !==
      input.changeSet.changeSetIdentityDigest ||
    input.metadata.stackIdentityDigest !== input.changeSet.stackIdentityDigest
  ) {
    throw new TypeError(
      "CloudFormation change-set identity does not match plan metadata.",
    );
  }
  const bindings = indexSemanticBindings({
    bindings: input.bindings,
    changeIdentities: new Set(
      input.changeSet.changes.map((change) => change.logicalResourceIdDigest),
    ),
    identity: (binding) => binding.logicalResourceIdDigest,
    target: "CloudFormation",
  });
  const changes = input.changeSet.changes.map((change) => {
    const binding = bindings.get(change.logicalResourceIdDigest);
    const authority =
      binding === undefined
        ? unknownBinding()
        : {
            applicationBinding: binding.semantics.applicationBinding,
            confidence: binding.confidence,
            ...(binding.deploymentKey === undefined
              ? {}
              : { deploymentKey: binding.deploymentKey }),
            ...(binding.graphId === undefined
              ? {}
              : { graphId: binding.graphId }),
            iam: binding.semantics.iam,
            network: binding.semantics.network,
            ownership: binding.ownership,
          };
    return {
      action: change.action,
      ...authority,
      resourceIdentityDigest: change.logicalResourceIdDigest,
      resourceType: change.resourceType,
    };
  });
  const metadata = input.metadata;
  return sealPlan({
    changeSetIdentityDigest: metadata.changeSetIdentityDigest,
    changes,
    commitSha: metadata.commitSha,
    contractVersion: 1,
    createdAt: metadata.createdAt,
    environmentId: metadata.environmentId,
    expiresAt: metadata.expiresAt,
    generatedManifestDigest: metadata.generatedManifestDigest,
    kind: "cloudmarkup.normalized-conformance-plan",
    planChecksum: metadata.planChecksum,
    scope: changeOnlyScope(metadata.scope),
    solutionRevision: metadata.solutionRevision,
    sourceRepresentationChecksum: input.changeSet.sourceChecksum,
    stackIdentityDigest: metadata.stackIdentityDigest,
    target: "cloudformation",
    tool: metadata.tool,
  });
}

function verificationIssue(
  code: string,
  field?: string,
  severity: "error" | "warning" = "error",
) {
  return conformanceVerificationIssueV1Schema.parse({
    code,
    ...(field === undefined ? {} : { field }),
    severity,
  });
}

export function verifyConformancePlanV1(
  rawPlan: unknown,
  rawExpected: unknown,
): Readonly<{
  issues: readonly z.output<typeof conformanceVerificationIssueV1Schema>[];
  valid: boolean;
}> {
  const plan = normalizedConformancePlanV1Schema.safeParse(rawPlan);
  const expected = conformancePlanExpectedV1Schema.safeParse(rawExpected);
  if (
    !plan.success ||
    !expected.success ||
    plan.data.target !== expected.data.target
  ) {
    return {
      issues: [verificationIssue("CONFORMANCE_PLAN_MALFORMED")],
      valid: false,
    };
  }
  const issues: z.output<typeof conformanceVerificationIssueV1Schema>[] = [];
  const { evidenceChecksum, ...planProjection } = plan.data;
  void evidenceChecksum;
  if (sha256(canonicalJson(planProjection)) !== plan.data.evidenceChecksum) {
    issues.push(
      verificationIssue(
        "CONFORMANCE_PLAN_INTEGRITY_MISMATCH",
        "evidenceChecksum",
      ),
    );
  }
  const fields = [
    "commitSha",
    "evidenceChecksum",
    "environmentId",
    "generatedManifestDigest",
    "planChecksum",
    "solutionRevision",
    "tool",
  ] as const;
  for (const field of fields) {
    if (
      canonicalJson(plan.data[field]) !== canonicalJson(expected.data[field])
    ) {
      issues.push(
        verificationIssue(
          `CONFORMANCE_${field.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}_MISMATCH`,
          field,
        ),
      );
    }
  }
  if (
    plan.data.target === "terraform" &&
    expected.data.target === "terraform"
  ) {
    for (const field of ["backendConfigDigest", "workspace"] as const) {
      if (plan.data[field] !== expected.data[field]) {
        issues.push(
          verificationIssue(
            `CONFORMANCE_${field.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}_MISMATCH`,
            field,
          ),
        );
      }
    }
  }
  if (
    plan.data.target === "cloudformation" &&
    expected.data.target === "cloudformation"
  ) {
    for (const field of [
      "changeSetIdentityDigest",
      "stackIdentityDigest",
    ] as const) {
      if (plan.data[field] !== expected.data[field]) {
        issues.push(
          verificationIssue(
            `CONFORMANCE_${field.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}_MISMATCH`,
            field,
          ),
        );
      }
    }
  }
  if (Date.parse(plan.data.expiresAt) <= Date.parse(expected.data.now)) {
    issues.push(verificationIssue("CONFORMANCE_PLAN_EXPIRED", "expiresAt"));
  }
  return { issues, valid: issues.length === 0 };
}

export function normalizeDeploymentConformanceV1(
  rawInput: unknown,
  rawExpected: unknown,
): NormalizedDeploymentConformanceV1 {
  const input = deploymentConformanceInputV1Schema.parse(rawInput);
  const expected = deploymentConformanceExpectedV1Schema.parse(rawExpected);
  const issues: z.output<typeof conformanceVerificationIssueV1Schema>[] = [];
  for (const field of [
    "approvedPlanEvidenceChecksum",
    "commitSha",
    "environmentId",
    "generatedManifestDigest",
    "planIdentityDigest",
    "solutionRevision",
    "target",
    "workflow",
  ] as const) {
    if (canonicalJson(input[field]) !== canonicalJson(expected[field])) {
      issues.push(
        verificationIssue(
          `CONFORMANCE_DEPLOYMENT_${field.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}_MISMATCH`,
          field,
        ),
      );
    }
  }
  if (
    input.executedPlanEvidenceChecksum !== input.approvedPlanEvidenceChecksum
  ) {
    issues.push(
      verificationIssue(
        "CONFORMANCE_DEPLOYMENT_PLAN_IDENTITY_MISMATCH",
        "executedPlanEvidenceChecksum",
      ),
    );
  }
  const bindingSortKey = (
    binding: z.output<typeof deploymentArtifactBindingSchema>,
  ) => `${binding.workloadId}\u0000${binding.artifactId}`;
  const actualArtifacts = input.artifactAttestations
    .map((artifact) => ({
      applicationBindingDigest: artifact.applicationBindingDigest,
      applicationContractDigest: artifact.applicationContractDigest,
      artifactDigest: artifact.artifactDigest,
      artifactId: artifact.artifactId,
      workloadId: artifact.workloadId,
    }))
    .sort((left, right) =>
      compareUtf16(bindingSortKey(left), bindingSortKey(right)),
    );
  const expectedArtifacts = [...expected.expectedArtifactBindings].sort(
    (left, right) => compareUtf16(bindingSortKey(left), bindingSortKey(right)),
  );
  if (canonicalJson(actualArtifacts) !== canonicalJson(expectedArtifacts)) {
    issues.push(
      verificationIssue(
        "CONFORMANCE_DEPLOYMENT_ARTIFACT_MISMATCH",
        "artifactAttestations",
      ),
    );
  }
  if (input.smoke.state === "failed") {
    issues.push(
      verificationIssue(
        "CONFORMANCE_DEPLOYMENT_SMOKE_FAILED",
        "smoke",
        "warning",
      ),
    );
  } else if (input.smoke.state === "not-run") {
    issues.push(
      verificationIssue(
        "CONFORMANCE_DEPLOYMENT_SMOKE_MISSING",
        "smoke",
        "warning",
      ),
    );
  } else if (input.smoke.evidenceDigest === undefined) {
    issues.push(
      verificationIssue(
        "CONFORMANCE_DEPLOYMENT_SMOKE_EVIDENCE_MISSING",
        "smoke",
      ),
    );
  }
  const invalid = issues.some(({ severity }) => severity === "error");
  const completeness = invalid
    ? "invalid"
    : input.smoke.state === "passed"
      ? "complete"
      : "partial";
  const projection = {
    artifactAttestations: [...input.artifactAttestations].sort((left, right) =>
      compareUtf16(bindingSortKey(left), bindingSortKey(right)),
    ),
    commitSha: input.commitSha,
    completeness,
    contractVersion: 1 as const,
    environmentId: input.environmentId,
    generatedManifestDigest: input.generatedManifestDigest,
    issues,
    kind: "cloudmarkup.normalized-deployment-conformance" as const,
    observedAt: input.observedAt,
    planEvidenceChecksum: input.executedPlanEvidenceChecksum,
    planIdentityDigest: input.planIdentityDigest,
    smoke: input.smoke,
    solutionRevision: input.solutionRevision,
    target: input.target,
    workflow: input.workflow,
  };
  return normalizedDeploymentConformanceV1Schema.parse({
    ...projection,
    evidenceChecksum: sha256(canonicalJson(projection)),
  });
}

export function normalizeDriftConformanceV1(
  rawInput: unknown,
  rawExpected: unknown,
  nowInput: string,
): NormalizedDriftConformanceV1 {
  const input = driftConformanceInputV1Schema.parse(rawInput);
  const expected = driftConformanceExpectedV1Schema.parse(rawExpected);
  const now = utcTimestampSchema.parse(nowInput);
  const issues: z.output<typeof conformanceVerificationIssueV1Schema>[] = [];
  if (
    input.baselineDeploymentEvidenceChecksum !==
    expected.approvedDeploymentEvidenceChecksum
  ) {
    issues.push(
      verificationIssue(
        "CONFORMANCE_DRIFT_BASELINE_MISMATCH",
        "baselineDeploymentEvidenceChecksum",
      ),
    );
  }
  for (const field of [
    "environmentId",
    "solutionRevision",
    "target",
  ] as const) {
    if (canonicalJson(input[field]) !== canonicalJson(expected[field])) {
      issues.push(
        verificationIssue(
          `CONFORMANCE_DRIFT_${field.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}_MISMATCH`,
          field,
        ),
      );
    }
  }
  if (input.scope !== "complete") {
    issues.push(
      verificationIssue(
        "CONFORMANCE_DRIFT_SCOPE_INCOMPLETE",
        "scope",
        "warning",
      ),
    );
  }
  if (
    input.changes.some(({ classification }) => classification === "unknown")
  ) {
    issues.push(
      verificationIssue("CONFORMANCE_DRIFT_UNKNOWN", "changes", "warning"),
    );
  }
  const invalid = issues.some(({ severity }) => severity === "error");
  const projection = {
    baselineDeploymentEvidenceChecksum:
      input.baselineDeploymentEvidenceChecksum,
    changes: [...input.changes].sort((left, right) =>
      compareUtf16(left.resourceIdentityDigest, right.resourceIdentityDigest),
    ),
    contractVersion: 1 as const,
    environmentId: input.environmentId,
    issues,
    kind: "cloudmarkup.normalized-drift-conformance" as const,
    observedAt: input.observedAt,
    remediation: "none" as const,
    scope: invalid ? ("invalid" as const) : input.scope,
    solutionRevision: input.solutionRevision,
    source: input.source,
    staleness:
      Date.parse(input.validUntil) <= Date.parse(now)
        ? ("stale" as const)
        : ("current" as const),
    target: input.target,
    validUntil: input.validUntil,
  };
  return normalizedDriftConformanceV1Schema.parse({
    ...projection,
    evidenceChecksum: sha256(canonicalJson(projection)),
  });
}
