import {
  architectureDocumentV3Schema,
  graphCommandV1Schema,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import { projectEditingLeaseProofV1Schema } from "./project-editing-leases.js";

import {
  capabilitySchema,
  createDataEnvelopeSchema,
  correlationIdSchema,
  createListEnvelopeSchema,
  createOpaqueIdentifierSchema,
  paginationQueryShape,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./common.js";

export const principalIdSchema = createOpaqueIdentifierSchema("principal");
export const organizationIdSchema = createOpaqueIdentifierSchema("org");
export const membershipIdSchema = createOpaqueIdentifierSchema("membership");
export const projectIdSchema = createOpaqueIdentifierSchema("project");
export const environmentIdSchema = createOpaqueIdentifierSchema("env");
export const draftIdSchema = createOpaqueIdentifierSchema("draft");
export const revisionIdSchema = createOpaqueIdentifierSchema("revision");
export const validationRunIdSchema = createOpaqueIdentifierSchema("validation");
export const generationJobIdSchema = createOpaqueIdentifierSchema("generation");
export const exportJobIdSchema = createOpaqueIdentifierSchema("export");
export const artifactIdSchema = createOpaqueIdentifierSchema("artifact");
export const artifactFileIdSchema = createOpaqueIdentifierSchema("file");
export const downloadIdSchema = createOpaqueIdentifierSchema("download");
export const integrationIdSchema = createOpaqueIdentifierSchema("integration");
export const auditEventIdSchema = createOpaqueIdentifierSchema("audit");

const resourceNameSchema = z.string().trim().min(1).max(120);
const resourceDescriptionSchema = z.string().trim().min(1).max(500);

export const healthResponseV1Schema = z
  .object({
    contractVersion: z.literal(1),
    service: z.literal("cloudmarkup-api"),
    status: z.literal("ok"),
  })
  .strict();

export const readinessCheckV1Schema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*$/),
    status: z.enum(["ready", "not-ready"]),
  })
  .strict();

export const readinessResponseV1Schema = z
  .object({
    checks: z.array(readinessCheckV1Schema).max(32),
    contractVersion: z.literal(1),
    service: z.literal("cloudmarkup-api"),
    status: z.enum(["ready", "not-ready"]),
  })
  .strict();
export const organizationRoleV1Schema = z.enum([
  "owner",
  "administrator",
  "editor",
  "viewer",
]);

export const principalOrganizationContextV1Schema = z
  .object({
    capabilities: z.array(capabilitySchema).max(128),
    isOwner: z.boolean(),
    membershipId: membershipIdSchema,
    organizationId: organizationIdSchema,
    role: organizationRoleV1Schema,
  })
  .strict();

export const currentPrincipalV1Schema = z
  .object({
    displayName: resourceNameSchema,
    email: z.email().optional(),
    id: principalIdSchema,
    organizationContexts: z
      .array(principalOrganizationContextV1Schema)
      .max(100),
    resourceVersion: z.literal(1),
  })
  .strict();

export const currentPrincipalResponseV1Schema = createDataEnvelopeSchema(
  currentPrincipalV1Schema,
);

export const experienceModeSchema = z.enum(["guided", "professional"]);

export const presentationPreferencesV1Schema = z
  .object({
    contextualLearningEnabled: z.boolean(),
    contractVersion: z.literal(1),
    experienceMode: experienceModeSchema,
    syncVersion: z.number().int().positive(),
    updatedAt: utcTimestampSchema,
  })
  .strict();

export const updatePresentationPreferencesV1Schema = z
  .object({
    contextualLearningEnabled: z.boolean(),
    contractVersion: z.literal(1),
    experienceMode: experienceModeSchema,
  })
  .strict();

export const presentationPreferencesResponseV1Schema = createDataEnvelopeSchema(
  presentationPreferencesV1Schema,
);

export const organizationV1Schema = z
  .object({
    createdAt: utcTimestampSchema,
    deletionRequestedAt: utcTimestampSchema.optional(),
    displayName: resourceNameSchema,
    id: organizationIdSchema,
    lifecycleStatus: z.enum([
      "active",
      "suspended",
      "deletion-pending",
      "deleted",
    ]),
    slug: z
      .string()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    version: z.number().int().positive().optional(),
  })
  .strict();

export const organizationResponseV1Schema =
  createDataEnvelopeSchema(organizationV1Schema);
export const organizationListResponseV1Schema =
  createListEnvelopeSchema(organizationV1Schema);

export const principalSummaryV1Schema = z
  .object({
    displayName: resourceNameSchema,
    id: principalIdSchema,
  })
  .strict();

export const membershipV1Schema = z
  .object({
    capabilities: z.array(capabilitySchema).max(128),
    id: membershipIdSchema,
    isOwner: z.boolean(),
    joinedAt: utcTimestampSchema,
    organizationId: organizationIdSchema,
    principal: principalSummaryV1Schema,
    role: organizationRoleV1Schema,
    status: z.enum(["active", "suspended"]),
  })
  .strict();

export const membershipListResponseV1Schema =
  createListEnvelopeSchema(membershipV1Schema);

export const projectLifecycleStatusSchema = z.enum([
  "active",
  "archived",
  "deletion-pending",
  "deleted",
]);

export const projectSummaryV1Schema = z
  .object({
    createdAt: utcTimestampSchema,
    currentDraft: z
      .object({ id: draftIdSchema, version: z.number().int().positive() })
      .strict(),
    id: projectIdSchema,
    latestRevisionId: revisionIdSchema.optional(),
    lifecycleStatus: projectLifecycleStatusSchema,
    name: resourceNameSchema,
    organizationId: organizationIdSchema,
    tombstoneRequestedAt: utcTimestampSchema.optional(),
    updatedAt: utcTimestampSchema,
    version: z.number().int().positive().optional(),
  })
  .strict();

export const projectV1Schema = projectSummaryV1Schema
  .extend({
    description: resourceDescriptionSchema.optional(),
    environmentCount: z.number().int().nonnegative(),
  })
  .strict();

export const createProjectV1Schema = z.discriminatedUnion("creationMode", [
  z
    .object({
      creationMode: z.literal("blank"),
      description: resourceDescriptionSchema.optional(),
      name: resourceNameSchema,
    })
    .strict(),
  z
    .object({
      architectureDocument: z.unknown(),
      creationMode: z.literal("draft-copy"),
      description: resourceDescriptionSchema.optional(),
      name: resourceNameSchema,
    })
    .strict(),
]);

export const renameProjectV1Schema = z
  .object({
    contractVersion: z.literal(1),
    name: resourceNameSchema,
  })
  .strict();

export const archiveProjectV1Schema = z
  .object({ contractVersion: z.literal(1) })
  .strict();

export const createProjectResultV1Schema = z
  .object({
    draft: z
      .object({ id: draftIdSchema, version: z.number().int().positive() })
      .strict(),
    project: projectV1Schema,
  })
  .strict();

export const projectResponseV1Schema =
  createDataEnvelopeSchema(projectV1Schema);
export const createProjectResponseV1Schema = createDataEnvelopeSchema(
  createProjectResultV1Schema,
);
export const projectListResponseV1Schema = createListEnvelopeSchema(
  projectSummaryV1Schema,
);

export const environmentTypeSchema = z.enum([
  "development",
  "test",
  "staging",
  "production",
  "disaster-recovery",
  "multi-environment",
]);

export const projectEnvironmentV1Schema = z
  .object({
    createdAt: utcTimestampSchema,
    environmentType: environmentTypeSchema,
    id: environmentIdSchema,
    lifecycleStatus: z
      .enum(["active", "deletion-pending", "deleted"])
      .optional(),
    name: resourceNameSchema,
    projectId: projectIdSchema,
    region: z.string().min(1).max(64).optional(),
    updatedAt: utcTimestampSchema.optional(),
    version: z.number().int().positive(),
  })
  .strict();

export const createProjectEnvironmentV1Schema = z
  .object({
    environmentType: environmentTypeSchema,
    name: resourceNameSchema,
    region: z.string().min(1).max(64).optional(),
  })
  .strict();

export const updateProjectEnvironmentV1Schema = z
  .object({
    contractVersion: z.literal(1),
    environmentType: environmentTypeSchema,
    name: resourceNameSchema,
    region: z.string().min(1).max(64).nullable().optional(),
  })
  .strict();

export const projectEnvironmentResponseV1Schema = createDataEnvelopeSchema(
  projectEnvironmentV1Schema,
);
export const projectEnvironmentListResponseV1Schema = createListEnvelopeSchema(
  projectEnvironmentV1Schema,
);

export const draftArchitectureDocumentV1Schema = z
  .object({
    architectureDocument: architectureDocumentV3Schema,
    contentDigest: sha256DigestSchema,
    documentDigest: sha256DigestSchema.optional(),
    id: draftIdSchema,
    projectId: projectIdSchema,
    semanticDigest: sha256DigestSchema.optional(),
    storageStatus: z.enum(["publication-pending", "published"]).optional(),
    updatedAt: utcTimestampSchema,
    version: z.number().int().positive(),
    visualDigest: sha256DigestSchema.optional(),
  })
  .strict();

export const saveDraftV1Schema = z
  .object({
    architectureDocument: z.unknown(),
    contractVersion: z.literal(1),
    editingLease: projectEditingLeaseProofV1Schema.optional(),
  })
  .strict();

export const applyDraftCommandV1Schema = z
  .object({
    command: graphCommandV1Schema,
    contentBinding: z
      .object({
        expectedContentDigest: sha256DigestSchema,
        resultingContentDigest: sha256DigestSchema,
      })
      .strict()
      .optional(),
    contractVersion: z.literal(1),
    editingLease: projectEditingLeaseProofV1Schema.optional(),
  })
  .strict();

export const applyDraftCommandResultV1Schema = z
  .object({
    appliedCommandId: z.string().min(1).max(128),
    draft: draftArchitectureDocumentV1Schema,
  })
  .strict();

export const draftArchitectureDocumentResponseV1Schema =
  createDataEnvelopeSchema(draftArchitectureDocumentV1Schema);
export const saveDraftResponseV1Schema = createDataEnvelopeSchema(
  draftArchitectureDocumentV1Schema,
);
export const applyDraftCommandResponseV1Schema = createDataEnvelopeSchema(
  applyDraftCommandResultV1Schema,
);

export const createRevisionV1Schema = z
  .object({
    contractVersion: z.literal(1),
    draftId: draftIdSchema,
    draftVersion: z.number().int().positive(),
    name: resourceNameSchema,
    validationRunId: validationRunIdSchema,
  })
  .strict();

export const revisionCompatibilityV1Schema = z
  .object({
    catalog: z
      .object({
        digest: sha256DigestSchema,
        id: z.string().min(1).max(128),
        version: z.string().min(1).max(64),
      })
      .strict(),
    compiler: z
      .object({
        inputContractVersion: z.number().int().positive(),
        maximumVersionExclusive: z.string().min(1).max(64).optional(),
        minimumVersion: z.string().min(1).max(64),
      })
      .strict(),
    documentSchema: z
      .object({
        kind: z.literal("cloudmarkup.architecture-document"),
        version: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export const revisionSummaryV1Schema = z
  .object({
    catalogDigest: sha256DigestSchema,
    catalogId: z.string().min(1).max(128),
    catalogVersion: z.string().min(1).max(64),
    compatibility: revisionCompatibilityV1Schema.optional(),
    contentDigest: sha256DigestSchema,
    createdAt: utcTimestampSchema,
    createdBy: principalSummaryV1Schema,
    documentDigest: sha256DigestSchema.optional(),
    graphSchemaVersion: z.number().int().positive(),
    id: revisionIdSchema,
    name: resourceNameSchema.optional(),
    projectId: projectIdSchema,
    revisionNumber: z.number().int().positive().optional(),
    semanticDigest: sha256DigestSchema.optional(),
    sourceDraftId: draftIdSchema,
    sourceDraftVersion: z.number().int().positive(),
    storageStatus: z.literal("published").optional(),
    visualDigest: sha256DigestSchema.optional(),
    workloadBehaviorVersion: z.number().int().positive(),
  })
  .strict();

export const revisionV1Schema = revisionSummaryV1Schema
  .extend({
    architectureDocument: architectureDocumentV3Schema,
  })
  .strict();

export const revisionResponseV1Schema =
  createDataEnvelopeSchema(revisionV1Schema);
export const revisionListResponseV1Schema = createListEnvelopeSchema(
  revisionSummaryV1Schema,
);

export const validationSeveritySchema = z.enum([
  "security-error",
  "error",
  "cost-warning",
  "warning",
  "recommendation",
  "educational-note",
]);

export const validationFindingSummaryV1Schema = z
  .object({
    affectedPaths: z.array(z.string().min(1).max(512)).min(1).max(100),
    code: z.string().min(1).max(128),
    id: z.string().min(1).max(128),
    ruleId: z.string().min(1).max(128),
    severity: validationSeveritySchema,
    title: resourceNameSchema,
  })
  .strict();

export const validationSummaryV1Schema = z
  .object({
    complete: z.boolean(),
    findingCounts: z
      .object({
        costWarning: z.number().int().nonnegative(),
        educationalNote: z.number().int().nonnegative(),
        error: z.number().int().nonnegative(),
        recommendation: z.number().int().nonnegative(),
        securityError: z.number().int().nonnegative(),
        warning: z.number().int().nonnegative(),
      })
      .strict(),
    findings: z.array(validationFindingSummaryV1Schema).max(1_000),
    reportId: z.string().min(1).max(128),
  })
  .strict();

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);

export const validationInputV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      draftId: draftIdSchema,
      draftVersion: z.number().int().positive(),
      kind: z.literal("draft"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("revision"),
      revisionId: revisionIdSchema,
    })
    .strict(),
]);

export const createValidationRunV1Schema = z
  .object({
    contractVersion: z.literal(1),
    environment: z.enum([
      "development",
      "test",
      "staging",
      "production",
      "disaster-recovery",
      "multi-environment",
      "unknown",
    ]),
    input: validationInputV1Schema,
    target: z.enum(["draft", "revision", "compilation"]),
  })
  .strict();

export const validationRunV1Schema = z
  .object({
    completedAt: utcTimestampSchema.optional(),
    createdAt: utcTimestampSchema,
    id: validationRunIdSchema,
    input: validationInputV1Schema,
    projectId: projectIdSchema,
    status: jobStatusSchema,
    summary: validationSummaryV1Schema.optional(),
    target: z.enum(["draft", "revision", "compilation"]),
  })
  .strict();

export const validationRunResponseV1Schema = createDataEnvelopeSchema(
  validationRunV1Schema,
);

export const generationKindSchema = z.enum([
  "infrastructure-as-code",
  "diagram",
  "combined-artifact",
]);

export const createGenerationJobV1Schema = z
  .object({
    contractVersion: z.literal(1),
    kind: generationKindSchema,
    revisionId: revisionIdSchema,
    target: z.enum(["terraform", "svg", "png", "combined"]),
  })
  .strict();

export const generationJobV1Schema = z
  .object({
    artifactId: artifactIdSchema.optional(),
    completedAt: utcTimestampSchema.optional(),
    createdAt: utcTimestampSchema,
    id: generationJobIdSchema,
    kind: generationKindSchema,
    projectId: projectIdSchema,
    revisionId: revisionIdSchema,
    status: jobStatusSchema,
    target: z.enum(["terraform", "svg", "png", "combined"]),
  })
  .strict();

export const generationJobResponseV1Schema = createDataEnvelopeSchema(
  generationJobV1Schema,
);

export const createExportJobV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      artifactId: artifactIdSchema,
      contractVersion: z.literal(1),
      kind: z.literal("zip"),
    })
    .strict(),
  z
    .object({
      artifactId: artifactIdSchema,
      contractVersion: z.literal(1),
      integrationId: integrationIdSchema,
      kind: z.literal("github"),
    })
    .strict(),
]);

export const exportJobV1Schema = z
  .object({
    artifactId: artifactIdSchema,
    completedAt: utcTimestampSchema.optional(),
    createdAt: utcTimestampSchema,
    id: exportJobIdSchema,
    integrationId: integrationIdSchema.optional(),
    kind: z.enum(["zip", "github"]),
    projectId: projectIdSchema,
    status: jobStatusSchema,
  })
  .strict();

export const exportJobResponseV1Schema =
  createDataEnvelopeSchema(exportJobV1Schema);

export const artifactFileV1Schema = z
  .object({
    digest: sha256DigestSchema,
    id: artifactFileIdSchema,
    mediaType: z.string().min(1).max(128),
    path: z.string().min(1).max(512),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const artifactSummaryV1Schema = z
  .object({
    contentDigest: sha256DigestSchema,
    createdAt: utcTimestampSchema,
    fileCount: z.number().int().nonnegative(),
    id: artifactIdSchema,
    projectId: projectIdSchema,
    revisionId: revisionIdSchema,
    status: z.enum(["ready-to-review", "verified", "failed"]),
  })
  .strict();

export const artifactV1Schema = artifactSummaryV1Schema
  .extend({
    files: z.array(artifactFileV1Schema).max(10_000),
    target: z.enum(["terraform", "diagram", "combined"]),
  })
  .strict();

export const artifactResponseV1Schema =
  createDataEnvelopeSchema(artifactV1Schema);
export const artifactListResponseV1Schema = createListEnvelopeSchema(
  artifactSummaryV1Schema,
);

export const downloadableArtifactV1Schema = z
  .object({
    artifactId: artifactIdSchema,
    digest: sha256DigestSchema,
    downloadId: downloadIdSchema,
    expiresAt: utcTimestampSchema,
    fileName: z.string().min(1).max(255),
    mediaType: z.string().min(1).max(128),
    sizeBytes: z.number().int().nonnegative(),
    url: z.string().min(1).max(2_048).startsWith("/"),
  })
  .strict();

export const downloadableArtifactListResponseV1Schema =
  createListEnvelopeSchema(downloadableArtifactV1Schema);

export const integrationV1Schema = z
  .object({
    capabilities: z.array(capabilitySchema).max(64),
    createdAt: utcTimestampSchema,
    displayName: resourceNameSchema,
    id: integrationIdSchema,
    kind: z.literal("github"),
    organizationId: organizationIdSchema,
    status: z.enum(["connected", "reauthorization-required", "disabled"]),
  })
  .strict();

export const integrationListResponseV1Schema =
  createListEnvelopeSchema(integrationV1Schema);

export const auditEventSummaryV1Schema = z
  .object({
    action: z
      .string()
      .min(3)
      .max(128)
      .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/),
    actor: principalSummaryV1Schema.optional(),
    correlationId: correlationIdSchema,
    id: auditEventIdSchema,
    occurredAt: utcTimestampSchema,
    organizationId: organizationIdSchema,
    outcome: z.enum(["succeeded", "denied", "failed"]),
    summary: z.string().min(1).max(300),
    target: z
      .object({
        id: z.string().min(1).max(128).optional(),
        kind: z.enum([
          "organization",
          "membership",
          "project",
          "draft",
          "revision",
          "artifact",
          "integration",
          "job",
        ]),
      })
      .strict(),
  })
  .strict();

export const auditEventSummaryListResponseV1Schema = createListEnvelopeSchema(
  auditEventSummaryV1Schema,
);

export const organizationPathV1Schema = z
  .object({ organizationId: organizationIdSchema })
  .strict();
export const projectPathV1Schema = z
  .object({ projectId: projectIdSchema })
  .strict();
export const environmentPathV1Schema = z
  .object({ environmentId: environmentIdSchema, projectId: projectIdSchema })
  .strict();
export const revisionPathV1Schema = z
  .object({ projectId: projectIdSchema, revisionId: revisionIdSchema })
  .strict();
export const validationRunPathV1Schema = z
  .object({
    projectId: projectIdSchema,
    validationRunId: validationRunIdSchema,
  })
  .strict();
export const generationJobPathV1Schema = z
  .object({
    generationJobId: generationJobIdSchema,
    projectId: projectIdSchema,
  })
  .strict();
export const exportJobPathV1Schema = z
  .object({ exportJobId: exportJobIdSchema, projectId: projectIdSchema })
  .strict();
export const artifactPathV1Schema = z
  .object({ artifactId: artifactIdSchema, projectId: projectIdSchema })
  .strict();

export const organizationListQueryV1Schema = z
  .object({
    ...paginationQueryShape,
    sort: z.enum(["displayName", "-displayName"]).optional(),
  })
  .strict();
export const membershipListQueryV1Schema = z
  .object({
    ...paginationQueryShape,
    "filter[status]": z.enum(["active", "suspended"]).optional(),
    sort: z
      .enum(["joinedAt", "-joinedAt", "displayName", "-displayName"])
      .optional(),
  })
  .strict();
export const projectListQueryV1Schema = z
  .object({
    ...paginationQueryShape,
    "filter[status]": projectLifecycleStatusSchema.optional(),
    sort: z.enum(["name", "-name", "updatedAt", "-updatedAt"]).optional(),
  })
  .strict();
export const environmentListQueryV1Schema = z
  .object({
    ...paginationQueryShape,
    "filter[type]": environmentTypeSchema.optional(),
    sort: z.enum(["name", "-name", "createdAt", "-createdAt"]).optional(),
  })
  .strict();
export const revisionListQueryV1Schema = z
  .object({
    ...paginationQueryShape,
    sort: z.enum(["createdAt", "-createdAt"]).optional(),
  })
  .strict();
export const artifactListQueryV1Schema = z
  .object({
    ...paginationQueryShape,
    "filter[status]": z
      .enum(["ready-to-review", "verified", "failed"])
      .optional(),
    sort: z.enum(["createdAt", "-createdAt"]).optional(),
  })
  .strict();
export const integrationListQueryV1Schema = z
  .object({
    ...paginationQueryShape,
    "filter[status]": z
      .enum(["connected", "reauthorization-required", "disabled"])
      .optional(),
    sort: z
      .enum(["createdAt", "-createdAt", "displayName", "-displayName"])
      .optional(),
  })
  .strict();
export const auditEventListQueryV1Schema = z
  .object({
    ...paginationQueryShape,
    "filter[action]": z.string().min(3).max(128).optional(),
    "filter[outcome]": z.enum(["succeeded", "denied", "failed"]).optional(),
    sort: z.enum(["occurredAt", "-occurredAt"]).optional(),
  })
  .strict();
export const downloadListQueryV1Schema = z
  .object({ ...paginationQueryShape })
  .strict();

export type CurrentPrincipalV1 = z.output<typeof currentPrincipalV1Schema>;
export type PresentationPreferencesV1 = z.output<
  typeof presentationPreferencesV1Schema
>;
export type UpdatePresentationPreferencesV1 = z.output<
  typeof updatePresentationPreferencesV1Schema
>;
export type OrganizationV1 = z.output<typeof organizationV1Schema>;
export type OrganizationRoleV1 = z.output<typeof organizationRoleV1Schema>;

export type MembershipV1 = z.output<typeof membershipV1Schema>;
export type ProjectV1 = z.output<typeof projectV1Schema>;
export type ProjectSummaryV1 = z.output<typeof projectSummaryV1Schema>;
export type CreateProjectV1 = z.output<typeof createProjectV1Schema>;
export type RenameProjectV1 = z.output<typeof renameProjectV1Schema>;
export type ArchiveProjectV1 = z.output<typeof archiveProjectV1Schema>;
export type CreateProjectResultV1 = z.output<
  typeof createProjectResultV1Schema
>;
export type ProjectEnvironmentV1 = z.output<typeof projectEnvironmentV1Schema>;
export type CreateProjectEnvironmentV1 = z.output<
  typeof createProjectEnvironmentV1Schema
>;
export type UpdateProjectEnvironmentV1 = z.output<
  typeof updateProjectEnvironmentV1Schema
>;
export type DraftArchitectureDocumentV1 = z.output<
  typeof draftArchitectureDocumentV1Schema
>;
export type ApplyDraftCommandV1 = z.output<typeof applyDraftCommandV1Schema>;
export type SaveDraftV1 = z.output<typeof saveDraftV1Schema>;
export type ApplyDraftCommandResultV1 = z.output<
  typeof applyDraftCommandResultV1Schema
>;
export type RevisionV1 = z.output<typeof revisionV1Schema>;
export type CreateRevisionV1 = z.output<typeof createRevisionV1Schema>;
export type RevisionSummaryV1 = z.output<typeof revisionSummaryV1Schema>;
export type CreateValidationRunV1 = z.output<
  typeof createValidationRunV1Schema
>;
export type ValidationRunV1 = z.output<typeof validationRunV1Schema>;
export type CreateGenerationJobV1 = z.output<
  typeof createGenerationJobV1Schema
>;
export type GenerationJobV1 = z.output<typeof generationJobV1Schema>;
export type CreateExportJobV1 = z.output<typeof createExportJobV1Schema>;
export type ExportJobV1 = z.output<typeof exportJobV1Schema>;
export type ArtifactV1 = z.output<typeof artifactV1Schema>;
export type ArtifactSummaryV1 = z.output<typeof artifactSummaryV1Schema>;
export type DownloadableArtifactV1 = z.output<
  typeof downloadableArtifactV1Schema
>;
export type IntegrationV1 = z.output<typeof integrationV1Schema>;
export type AuditEventSummaryV1 = z.output<typeof auditEventSummaryV1Schema>;
