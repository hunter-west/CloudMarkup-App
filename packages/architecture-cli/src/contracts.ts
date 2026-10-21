import {
  evidenceIdSchema,
  namespacedIdentifierSchema,
  repositoryRelativePathSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  generationCoverageStateSchema,
  solutionRevisionIdSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { exactToolPinV1Schema } from "@cloudmarkup/solution-export";
import { repositoryImportResultV1Schema } from "@cloudmarkup/repository-importer";
import { z } from "zod";
import { architectureCliConformanceSummaryV1Schema } from "./conformance-contracts.js";

export const ARCHITECTURE_CLI_CONTRACT_VERSION = 1 as const;
export const ARCHITECTURE_CLI_ID = "cloudmarkup.architecture-cli" as const;
export const ARCHITECTURE_CLI_VERSION = "1.0.0" as const;

export const ARCHITECTURE_CLI_LIMITS = Object.freeze({
  diagnostics: 512,
  diffEntries: 10_000,
  evidenceRecords: 256,
  fileBytes: 32 * 1024 * 1024,
  files: 4_096,
  jsonOutputBytes: 8 * 1024 * 1024,
  semanticFacts: 20_000,
  totalBytes: 128 * 1024 * 1024,
} as const);

export const architectureCliCommandV1Schema = z.enum([
  "validate",
  "generate",
  "verify",
  "diff",
  "render",
  "test",
  "evidence",
  "conformance",
  "import",
  "inspect-repository",
  "compare",
  "verify-repository",
]);

export const architectureCliOutputFormatV1Schema = z.enum(["human", "json"]);

export const architectureCliExitCodeV1Schema = z.union([
  z.literal(0),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]);

export const ARCHITECTURE_CLI_EXIT_CODES = Object.freeze({
  success: 0,
  usage: 2,
  validation: 3,
  drift: 4,
  conflict: 5,
  pipeline: 6,
  internal: 7,
} as const);

const safeCodeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^cloudmarkup\.cli\.[a-z0-9-]+$/u);
const safeMessageSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !/(?:[A-Za-z]:\\|file:\/\/|https?:\/\/|token\s*=|secret\s*=)/iu.test(
        value,
      ),
    "Diagnostics cannot expose machine paths, URLs, tokens, or secrets.",
  );

export const architectureCliDiagnosticV1Schema = z
  .object({
    code: safeCodeSchema,
    edgeId: z.string().min(1).max(128).optional(),
    message: safeMessageSchema,
    nodeId: z.string().min(1).max(128).optional(),
    ownedPolicyId: z.string().min(1).max(128).optional(),
    path: repositoryRelativePathSchema.optional(),
    severity: z.enum(["error", "warning", "info"]),
    workloadId: z.string().min(1).max(128).optional(),
  })
  .strict();

export const architectureCliRepositoryLockV1Schema = z
  .object({
    contractVersion: z.literal(1),
    inputs: z
      .object({
        applicationContracts: sha256DigestSchema,
        architecture: sha256DigestSchema,
        externalResources: sha256DigestSchema,
        workload: sha256DigestSchema,
      })
      .strict(),
    kind: z.literal("cloudmarkup.solution-export-lock"),
    solutionRevision: z
      .object({ digest: sha256DigestSchema, id: solutionRevisionIdSchema })
      .strict(),
    tools: z
      .object({
        catalog: exactToolPinV1Schema,
        compiler: exactToolPinV1Schema,
        generator: exactToolPinV1Schema.nullable(),
        policyPacks: z.array(exactToolPinV1Schema).max(64),
        renderer: exactToolPinV1Schema,
      })
      .strict(),
  })
  .strict();

export const architectureCliRepositoryProfileV1Schema = z
  .object({
    cli: z
      .object({
        digest: sha256DigestSchema,
        id: z.literal(ARCHITECTURE_CLI_ID),
        version: z.literal(ARCHITECTURE_CLI_VERSION),
      })
      .strict(),
    contractVersion: z.literal(ARCHITECTURE_CLI_CONTRACT_VERSION),
    kind: z.literal("cloudmarkup.repository-verification-profile"),
    pipelineProfile: z
      .object({
        digest: sha256DigestSchema,
        id: namespacedIdentifierSchema,
        version: semanticVersionSchema,
      })
      .strict(),
    paths: z
      .object({
        lock: z.literal("cloudmarkup/cloudmarkup.lock.json"),
        manifest: z.literal("cloudmarkup/cloudmarkup.manifest.json"),
        solutionRevision: z.literal("cloudmarkup/solution.json"),
      })
      .strict(),
  })
  .strict();

const stableFactIdSchema = z.string().min(1).max(256);
const semanticFactBaseSchema = z
  .object({
    digest: sha256DigestSchema,
    id: stableFactIdSchema,
    label: z.string().min(1).max(256).optional(),
  })
  .strict();

export const architectureCliServiceFactV1Schema = semanticFactBaseSchema
  .extend({
    costSensitive: z.boolean(),
    generated: z.boolean(),
    publicExposure: z.enum(["none", "private", "public", "unknown"]),
    serviceType: namespacedIdentifierSchema,
  })
  .strict();

export const architectureCliConnectionFactV1Schema = semanticFactBaseSchema
  .extend({
    relationshipType: namespacedIdentifierSchema,
    sourceId: stableFactIdSchema,
    targetId: stableFactIdSchema,
  })
  .strict();

export const architectureCliPermissionFactV1Schema = semanticFactBaseSchema
  .extend({
    action: z.string().min(1).max(256),
    effect: z.enum(["allow", "deny"]),
    resource: z.string().min(1).max(512),
  })
  .strict();

export const architectureCliRouteFactV1Schema = semanticFactBaseSchema
  .extend({
    contractId: stableFactIdSchema.optional(),
    method: z.enum([
      "DELETE",
      "GET",
      "HEAD",
      "OPTIONS",
      "PATCH",
      "POST",
      "PUT",
    ]),
    pathTemplate: z.string().min(1).max(512),
    workloadId: stableFactIdSchema,
  })
  .strict();

export const architectureCliEventFactV1Schema = semanticFactBaseSchema
  .extend({
    contractId: stableFactIdSchema.optional(),
    eventType: namespacedIdentifierSchema,
    workloadId: stableFactIdSchema,
  })
  .strict();

export const architectureCliEventPolicyFactV1Schema = semanticFactBaseSchema
  .extend({
    eventId: stableFactIdSchema,
    policyKind: z.enum(["batch", "dlq", "filter", "retry"]),
    workloadId: stableFactIdSchema,
  })
  .strict();

export const architectureCliHandlerFactV1Schema = semanticFactBaseSchema
  .extend({
    handlerKind: namespacedIdentifierSchema,
    workloadId: stableFactIdSchema,
  })
  .strict();

export const architectureCliContractFactV1Schema = semanticFactBaseSchema
  .extend({
    contractKind: z.enum(["api", "auth", "data", "event", "test"]),
    version: semanticVersionSchema,
  })
  .strict();

export const architectureCliWorkloadOperationFactV1Schema =
  semanticFactBaseSchema
    .extend({
      operationKind: z.enum([
        "command",
        "query",
        "event",
        "scheduled",
        "other",
      ]),
      workloadId: stableFactIdSchema,
    })
    .strict();

const coverageFactSchema = z
  .object({
    evidenceIds: z.array(evidenceIdSchema).max(1_024),
    missingRequirements: z.array(stableFactIdSchema).max(1_024),
    state: generationCoverageStateSchema,
    unresolvedRequirementIds: z.array(stableFactIdSchema).max(1_024),
  })
  .strict();

export const architectureCliSemanticSnapshotV1Schema = z
  .object({
    connections: z
      .array(architectureCliConnectionFactV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.semanticFacts),
    contractVersion: z.literal(1),
    contracts: z
      .array(architectureCliContractFactV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.semanticFacts),
    coverage: coverageFactSchema,
    events: z
      .array(architectureCliEventFactV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.semanticFacts),
    eventPolicies: z
      .array(architectureCliEventPolicyFactV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.semanticFacts)
      .optional(),
    handlers: z
      .array(architectureCliHandlerFactV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.semanticFacts)
      .optional(),
    kind: z.literal("cloudmarkup.repository-semantic-snapshot"),
    permissions: z
      .array(architectureCliPermissionFactV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.semanticFacts),
    readiness: z
      .object({
        reasons: z.array(stableFactIdSchema).max(1_024),
        state: z.enum(["ready", "blocked", "unsupported", "unknown"]),
      })
      .strict(),
    routes: z
      .array(architectureCliRouteFactV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.semanticFacts),
    services: z
      .array(architectureCliServiceFactV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.semanticFacts),
    target: z.enum(["terraform", "cloudformation"]).optional(),
    snapshotDigest: sha256DigestSchema,
    solutionRevision: z
      .object({ digest: sha256DigestSchema, id: solutionRevisionIdSchema })
      .strict(),
    unresolvedRequirements: z.array(stableFactIdSchema).max(1_024),
    workloadOperations: z
      .array(architectureCliWorkloadOperationFactV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.semanticFacts),
  })
  .strict();

export const architectureCliSemanticChangeKindV1Schema = z.enum([
  "service-added",
  "service-removed",
  "service-changed",
  "connection-added",
  "connection-removed",
  "connection-changed",
  "permission-expanded",
  "permission-reduced",
  "permission-changed",
  "route-added",
  "route-removed",
  "route-changed",
  "event-added",
  "event-removed",
  "event-changed",
  "event-contract-added",
  "event-contract-removed",
  "event-contract-changed",
  "event-retry-added",
  "event-retry-removed",
  "event-retry-changed",
  "event-dlq-added",
  "event-dlq-removed",
  "event-dlq-changed",
  "event-filter-added",
  "event-filter-removed",
  "event-filter-changed",
  "event-batch-added",
  "event-batch-removed",
  "event-batch-changed",
  "handler-added",
  "handler-removed",
  "handler-changed",
  "data-contract-added",
  "data-contract-removed",
  "data-contract-changed",
  "workload-operation-added",
  "workload-operation-removed",
  "workload-operation-changed",
  "coverage-changed",
  "target-changed",
  "target-readiness-changed",
  "public-exposure-changed",
  "cost-sensitive-resource-changed",
  "unresolved-requirement-added",
  "unresolved-requirement-resolved",
]);

export const architectureCliSemanticChangeV1Schema = z
  .object({
    afterDigest: sha256DigestSchema.optional(),
    beforeDigest: sha256DigestSchema.optional(),
    factId: stableFactIdSchema,
    kind: architectureCliSemanticChangeKindV1Schema,
    summary: safeMessageSchema,
  })
  .strict();

export const architectureCliFileChangeV1Schema = z
  .object({
    afterChecksum: sha256DigestSchema.optional(),
    beforeChecksum: sha256DigestSchema.optional(),
    change: z.enum(["added", "removed", "modified"]),
    path: repositoryRelativePathSchema,
  })
  .strict();

export const architectureCliEvidenceSummaryV1Schema = z
  .object({
    current: z
      .number()
      .int()
      .nonnegative()
      .max(ARCHITECTURE_CLI_LIMITS.evidenceRecords),
    failed: z
      .number()
      .int()
      .nonnegative()
      .max(ARCHITECTURE_CLI_LIMITS.evidenceRecords),
    stale: z
      .number()
      .int()
      .nonnegative()
      .max(ARCHITECTURE_CLI_LIMITS.evidenceRecords),
    unavailableLevels: z.array(z.number().int().min(1).max(9)).max(9),
  })
  .strict();

export const architectureCliCommandResultV1Schema = z
  .object({
    command: architectureCliCommandV1Schema,
    contractVersion: z.literal(ARCHITECTURE_CLI_CONTRACT_VERSION),
    conformance: architectureCliConformanceSummaryV1Schema.optional(),
    diagnostics: z
      .array(architectureCliDiagnosticV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.diagnostics),
    evidence: architectureCliEvidenceSummaryV1Schema.optional(),
    exitCode: architectureCliExitCodeV1Schema,
    fileChanges: z
      .array(architectureCliFileChangeV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.diffEntries),
    semanticChanges: z
      .array(architectureCliSemanticChangeV1Schema)
      .max(ARCHITECTURE_CLI_LIMITS.diffEntries),
    repositoryImport: repositoryImportResultV1Schema.optional(),
    solutionRevision: z
      .object({ digest: sha256DigestSchema, id: solutionRevisionIdSchema })
      .strict()
      .optional(),
    state: z.enum(["succeeded", "failed", "drift", "conflict"]),
  })
  .strict();

export type ArchitectureCliCommandV1 = z.output<
  typeof architectureCliCommandV1Schema
>;
export type ArchitectureCliDiagnosticV1 = z.output<
  typeof architectureCliDiagnosticV1Schema
>;
export type ArchitectureCliRepositoryLockV1 = z.output<
  typeof architectureCliRepositoryLockV1Schema
>;
export type ArchitectureCliRepositoryProfileV1 = z.output<
  typeof architectureCliRepositoryProfileV1Schema
>;
export type ArchitectureCliSemanticSnapshotV1 = z.output<
  typeof architectureCliSemanticSnapshotV1Schema
>;
export type ArchitectureCliSemanticChangeV1 = z.output<
  typeof architectureCliSemanticChangeV1Schema
>;
export type ArchitectureCliFileChangeV1 = z.output<
  typeof architectureCliFileChangeV1Schema
>;
export type ArchitectureCliEvidenceSummaryV1 = z.output<
  typeof architectureCliEvidenceSummaryV1Schema
>;
export type ArchitectureCliCommandResultV1 = z.output<
  typeof architectureCliCommandResultV1Schema
>;
export type ArchitectureCliSha256Digest = Sha256Digest;
