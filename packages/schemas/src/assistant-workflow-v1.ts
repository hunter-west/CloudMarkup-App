import { z } from "zod";

import { activeIssueV1Schema } from "./active-issue-v1.js";
import {
  aiExtensionOwnedPathV1Schema,
  aiExtensionSourceReferenceV1Schema,
  aiExtensionTargetV1Schema,
  structuredExtensionRequestV1Schema,
} from "./ai-authored-extension-v1.js";
import {
  applicationContractRecordV1Schema,
  applicationTestCaseContractV1Schema,
} from "./application-contracts-v1.js";
import {
  actorIdSchema,
  namespacedIdentifierSchema,
  operationIdSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import {
  addEdgeCommandV1Schema,
  addNodeCommandV1Schema,
  adoptGeneratedResourceCommandV1Schema,
  moveNodeCommandV1Schema,
  removeEdgeCommandV1Schema,
  removeNodeCommandV1Schema,
  reparentNodeCommandV1Schema,
  updateEdgeConfigurationCommandV1Schema,
  updateNodeConfigurationCommandV1Schema,
} from "./graph-command-v1.js";
import { externalResourceV1Schema } from "./external-resource-reference-v1.js";
import { reconciliationOperationV1Schema } from "./reconciliation-proposal-v1.js";
import { repositoryPathOwnershipV1Schema } from "./repository-ownership-v1.js";
import {
  activeIssueIdSchema,
  aiExtensionIdSchema,
  evidenceIdSchema,
  solutionRevisionIdSchema,
  solutionStableIdSchema,
} from "./solution-contract-common-v1.js";
import { workloadOperationV1Schema } from "./workload-behavior-v1.js";
import { workloadV2Schema } from "./workload-behavior-v2.js";

const printableOneLineSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (value) => !/[\r\n\u2028\u2029]/u.test(value),
    "Must be one printable line.",
  );

export const assistantWorkflowIdSchema =
  solutionStableIdSchema.brand<"AssistantWorkflowId">();
export const assistantReviewIdSchema =
  solutionStableIdSchema.brand<"AssistantReviewId">();
export const assistantOperationIdSchema =
  operationIdSchema.brand<"AssistantOperationId">();

const assistantOperationBaseShape = {
  operationId: assistantOperationIdSchema,
  rationale: printableOneLineSchema,
} as const;

export const assistantGraphCommandV1Schema = z.discriminatedUnion("kind", [
  addNodeCommandV1Schema,
  removeNodeCommandV1Schema,
  updateNodeConfigurationCommandV1Schema,
  moveNodeCommandV1Schema,
  reparentNodeCommandV1Schema,
  addEdgeCommandV1Schema,
  removeEdgeCommandV1Schema,
  updateEdgeConfigurationCommandV1Schema,
  adoptGeneratedResourceCommandV1Schema,
]);

const assistantWorkloadPatchV1Schema = workloadV2Schema
  .omit({
    id: true,
    operations: true,
    provenance: true,
    sourceOwnership: true,
    tests: true,
  })
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "A Workload edit must change at least one allow-listed field.",
  );

const assistantExternalResourcePatchV1Schema = z
  .object({
    addresses: externalResourceV1Schema.shape.addresses.optional(),
    architectureNodeIds:
      externalResourceV1Schema.shape.architectureNodeIds.optional(),
    availability: externalResourceV1Schema.shape.availability.optional(),
    capability: externalResourceV1Schema.shape.capability.optional(),
    dataClassifications:
      externalResourceV1Schema.shape.dataClassifications.optional(),
    description: externalResourceV1Schema.shape.description.optional(),
    displayName: externalResourceV1Schema.shape.displayName.optional(),
    evidence: externalResourceV1Schema.shape.evidence.optional(),
    extractedCandidates:
      externalResourceV1Schema.shape.extractedCandidates.optional(),
    interfaces: externalResourceV1Schema.shape.interfaces.optional(),
    lifecycle: externalResourceV1Schema.shape.lifecycle.optional(),
    provider: externalResourceV1Schema.shape.provider.optional(),
    resourceType: externalResourceV1Schema.shape.resourceType.optional(),
    scope: externalResourceV1Schema.shape.scope.optional(),
    trustBoundary: externalResourceV1Schema.shape.trustBoundary.optional(),
    unresolvedInformation:
      externalResourceV1Schema.shape.unresolvedInformation.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "An External Resource edit must change at least one allow-listed field.",
  );

export const assistantOperationV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      ...assistantOperationBaseShape,
      command: assistantGraphCommandV1Schema,
      kind: z.literal("graph-command"),
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      expectedWorkloadContentHash: sha256DigestSchema,
      kind: z.literal("add-workload"),
      workload: workloadV2Schema,
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      expectedWorkloadContentHash: sha256DigestSchema,
      kind: z.literal("edit-workload"),
      patch: assistantWorkloadPatchV1Schema,
      workloadId: solutionStableIdSchema,
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      expectedWorkloadContentHash: sha256DigestSchema,
      kind: z.literal("add-workload-operation"),
      operation: workloadOperationV1Schema,
      workloadId: solutionStableIdSchema,
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      expectedOperationDigest: sha256DigestSchema,
      expectedWorkloadContentHash: sha256DigestSchema,
      kind: z.literal("edit-workload-operation"),
      operation: workloadOperationV1Schema,
      workloadId: solutionStableIdSchema,
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      contract: applicationContractRecordV1Schema,
      expectedContractsContentHash: sha256DigestSchema,
      kind: z.literal("add-application-contract"),
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      contract: applicationContractRecordV1Schema,
      expectedContractDigest: sha256DigestSchema,
      expectedContractsContentHash: sha256DigestSchema,
      kind: z.literal("edit-application-contract"),
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      expectedContractsContentHash: sha256DigestSchema,
      kind: z.literal("add-test-scenario"),
      scenario: applicationTestCaseContractV1Schema,
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      expectedContractsContentHash: sha256DigestSchema,
      expectedScenarioDigest: sha256DigestSchema,
      kind: z.literal("edit-test-scenario"),
      scenario: applicationTestCaseContractV1Schema,
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      expectedExternalResourcesContentHash: sha256DigestSchema,
      kind: z.literal("add-external-resource"),
      resource: externalResourceV1Schema,
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      expectedExternalResourcesContentHash: sha256DigestSchema,
      expectedResourceDigest: sha256DigestSchema,
      externalResourceId: solutionStableIdSchema,
      kind: z.literal("edit-external-resource"),
      patch: assistantExternalResourcePatchV1Schema,
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      action: z.enum(["add", "edit"]),
      declaration: repositoryPathOwnershipV1Schema,
      expectedDeclarationDigest: sha256DigestSchema.optional(),
      expectedWorkloadContentHash: sha256DigestSchema,
      kind: z.literal("set-source-ownership"),
      workloadId: solutionStableIdSchema,
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.action === "edit" &&
        value.expectedDeclarationDigest === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "Editing source ownership requires its exact prior digest.",
          path: ["expectedDeclarationDigest"],
        });
      }
      if (
        value.action === "add" &&
        value.expectedDeclarationDigest !== undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "Adding source ownership cannot claim a prior digest.",
          path: ["expectedDeclarationDigest"],
        });
      }
    }),
  z
    .object({
      ...assistantOperationBaseShape,
      extensionRequestId: aiExtensionIdSchema,
      kind: z.literal("upsert-ai-extension-request"),
      ownedPaths: z.array(aiExtensionOwnedPathV1Schema).min(1).max(1_000),
      regenerationPolicy: z.enum([
        "replace-owned-exact",
        "propose-patch",
        "manual-only",
      ]),
      request: structuredExtensionRequestV1Schema,
      sourceReferences: z
        .array(aiExtensionSourceReferenceV1Schema)
        .min(1)
        .max(256),
      target: aiExtensionTargetV1Schema,
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      decision: z.enum(["accept", "reject", "ignore"]),
      kind: z.literal("review-repository-difference"),
      observedContentHash: sha256DigestSchema,
      proposalId: solutionStableIdSchema,
      reconciliationOperation: reconciliationOperationV1Schema,
    })
    .strict(),
  z
    .object({
      ...assistantOperationBaseShape,
      blocking: z.boolean(),
      evidenceIds: z.array(evidenceIdSchema).max(256),
      kind: z.literal("request-clarification"),
      question: printableOneLineSchema,
      questionId: solutionStableIdSchema,
    })
    .strict(),
]);

export const assistantOperationKindV1Schema = z.enum([
  "graph-command",
  "add-workload",
  "edit-workload",
  "add-workload-operation",
  "edit-workload-operation",
  "add-application-contract",
  "edit-application-contract",
  "add-test-scenario",
  "edit-test-scenario",
  "add-external-resource",
  "edit-external-resource",
  "set-source-ownership",
  "upsert-ai-extension-request",
  "review-repository-difference",
  "request-clarification",
]);

export const assistantOperationBatchV1Schema = z
  .object({
    baseArchitectureDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
    kind: z.literal("cloudmarkup.assistant-operation-batch"),
    operations: z.array(assistantOperationV1Schema).min(1).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    const operationIds = new Set<string>();
    value.operations.forEach((operation, index) => {
      if (operationIds.has(operation.operationId)) {
        context.addIssue({
          code: "custom",
          message: "Assistant operation identities must be unique.",
          path: ["operations", index, "operationId"],
        });
      }
      operationIds.add(operation.operationId);
    });
  });

export const assistantDiffCategoryV1Schema = z.enum([
  "architecture",
  "workload",
  "contract",
  "permission-policy",
  "external-resource",
  "repository-observation",
  "file-impact",
  "validation-coverage",
  "custom-generation",
  "clarification",
]);

export const assistantReviewDiffV1Schema = z
  .object({
    category: assistantDiffCategoryV1Schema,
    operationIds: z.array(assistantOperationIdSchema).min(1).max(256),
    primary: printableOneLineSchema,
    technical: z
      .object({
        evidenceIds: z.array(evidenceIdSchema).max(256),
        ids: z.array(solutionStableIdSchema).max(512),
        paths: z.array(z.string().min(1).max(512)).max(512),
        policyActions: z.array(namespacedIdentifierSchema).max(256),
        validationDeltas: z.array(printableOneLineSchema).max(256),
      })
      .strict(),
  })
  .strict();

export const assistantModelProvenanceV1Schema = z
  .object({
    inputDigest: sha256DigestSchema,
    invocationId: solutionStableIdSchema,
    modelId: z.string().min(1).max(256),
    modelVersion: z.string().min(1).max(128),
    outputDigest: sha256DigestSchema,
    promptDigest: sha256DigestSchema,
    promptId: namespacedIdentifierSchema,
    promptVersion: semanticVersionSchema,
    providerId: namespacedIdentifierSchema,
    reservationId: solutionStableIdSchema,
    usageEventIds: z.array(solutionStableIdSchema).max(64),
  })
  .strict();

export const assistantCreditSummaryV1Schema = z
  .object({
    completedCreditUnits: z.number().int().nonnegative().nullable(),
    maximumEstimatedCreditUnits: z.number().int().nonnegative().nullable(),
    minimumEstimatedCreditUnits: z.number().int().nonnegative().nullable(),
    reservationId: solutionStableIdSchema.nullable(),
    state: z.enum([
      "denied",
      "estimate-confirmation-required",
      "reservation-denied",
      "completed",
      "released",
      "compensated",
      "settlement-pending",
      "reconciliation-required",
    ]),
  })
  .strict();

export const assistantProgressEventV1Schema = z
  .object({
    occurredAt: utcTimestampSchema,
    sequence: z.number().int().min(0).max(63),
    stage: z.enum([
      "queued",
      "commercial-check",
      "model-generation",
      "deterministic-validation",
      "review-ready",
      "needs-user-input",
      "cancelled",
      "rejected",
      "accepted",
    ]),
    summary: printableOneLineSchema,
  })
  .strict();

export const assistantReviewDecisionV1Schema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending") }).strict(),
  z
    .object({
      authorizationDecisionId: solutionStableIdSchema,
      decidedAt: utcTimestampSchema,
      decidedBy: actorIdSchema,
      state: z.literal("accepted"),
    })
    .strict(),
  z
    .object({
      authorizationDecisionId: solutionStableIdSchema,
      decidedAt: utcTimestampSchema,
      decidedBy: actorIdSchema,
      reason: printableOneLineSchema,
      state: z.literal("rejected"),
    })
    .strict(),
]);

export const assistantReviewRecordV1Schema = z
  .object({
    activeIssues: z.array(activeIssueV1Schema).max(1_000),
    editAuthorizationDecisionIds: z.array(solutionStableIdSchema).max(64),
    baseArchitectureDigest: sha256DigestSchema,
    candidateArchitectureDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
    createdAt: utcTimestampSchema,
    credit: assistantCreditSummaryV1Schema,
    decision: assistantReviewDecisionV1Schema,
    diffs: z.array(assistantReviewDiffV1Schema).max(1_000),
    evidenceIds: z.array(evidenceIdSchema).max(10_000),
    issueIds: z.array(activeIssueIdSchema).max(1_000),
    modelProvenance: assistantModelProvenanceV1Schema.nullable(),
    operationBatch: assistantOperationBatchV1Schema,
    organizationId: solutionStableIdSchema,
    projectId: solutionStableIdSchema,
    reviewId: assistantReviewIdSchema,
    solutionRevisionId: solutionRevisionIdSchema,
    writeAuthority: z.literal("none"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.editAuthorizationDecisionIds).size !==
      value.editAuthorizationDecisionIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Edit authorization decision identities must be unique.",
        path: ["editAuthorizationDecisionIds"],
      });
    }
    const exactIssueIds = [...new Set(value.activeIssues.map(({ id }) => id))]
      .sort()
      .join("\u0000");
    const claimedIssueIds = [...new Set(value.issueIds)].sort().join("\u0000");
    if (exactIssueIds !== claimedIssueIds) {
      context.addIssue({
        code: "custom",
        message: "Review issue identities must exactly match Active Issues.",
        path: ["issueIds"],
      });
    }
  });

export const assistantWorkflowRecordV1Schema = z
  .object({
    assistancePreference: z.enum(["guided", "professional"]),
    authorizationDecisionIds: z.array(solutionStableIdSchema).max(64),
    contractVersion: z.literal(1),
    createdAt: utcTimestampSchema,
    jobId: solutionStableIdSchema,
    organizationId: solutionStableIdSchema,
    progress: z.array(assistantProgressEventV1Schema).min(1).max(64),
    projectId: solutionStableIdSchema,
    review: assistantReviewRecordV1Schema.nullable(),
    solutionRevisionId: solutionRevisionIdSchema,
    state: z.enum([
      "queued",
      "running",
      "review-ready",
      "needs-user-input",
      "rejected",
      "cancelled",
      "accepted",
    ]),
    updatedAt: utcTimestampSchema,
    workflowId: assistantWorkflowIdSchema,
    workflowRequestDigest: sha256DigestSchema,
    writeAuthority: z.literal("none"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.authorizationDecisionIds).size !==
      value.authorizationDecisionIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Workflow authorization decision identities must be unique.",
        path: ["authorizationDecisionIds"],
      });
    }
    value.progress.forEach((event, index) => {
      if (event.sequence !== index) {
        context.addIssue({
          code: "custom",
          message: "Assistant progress must be a complete ordered sequence.",
          path: ["progress", index, "sequence"],
        });
      }
    });
    const terminalStage = value.progress.at(-1)?.stage;
    const expectedTerminalStage =
      value.state === "review-ready"
        ? "review-ready"
        : value.state === "needs-user-input"
          ? "needs-user-input"
          : value.state === "rejected"
            ? "rejected"
            : value.state === "cancelled"
              ? "cancelled"
              : value.state === "accepted"
                ? "accepted"
                : undefined;
    if (
      expectedTerminalStage !== undefined &&
      terminalStage !== expectedTerminalStage
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Terminal workflow state must match its latest progress stage.",
        path: ["progress"],
      });
    }
  });

export type AssistantOperationV1 = z.output<typeof assistantOperationV1Schema>;
export type AssistantOperationBatchV1 = z.output<
  typeof assistantOperationBatchV1Schema
>;
export type AssistantReviewDiffV1 = z.output<
  typeof assistantReviewDiffV1Schema
>;
export type AssistantReviewRecordV1 = z.output<
  typeof assistantReviewRecordV1Schema
>;
export type AssistantWorkflowRecordV1 = z.output<
  typeof assistantWorkflowRecordV1Schema
>;

export function generateAssistantWorkflowV1JsonSchema() {
  const generated = z.toJSONSchema(assistantWorkflowRecordV1Schema, {
    io: "input",
    target: "draft-2020-12",
  });
  return {
    ...generated,
    $id: "https://schemas.cloudmarkup.com/assistant-workflow/v1.schema.json",
    title: "Cloud Markup Assistant Workflow v1",
  };
}
