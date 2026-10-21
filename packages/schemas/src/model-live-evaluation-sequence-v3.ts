import { z } from "zod";
import { digestCanonicalValue } from "./canonical-digest.js";
import {
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import { solutionStableIdSchema } from "./solution-contract-common-v1.js";
import {
  modelEvaluationAuthorityBindingV1Schema,
  modelLiveEvaluationAuthorityV1Schema,
} from "./model-evaluation-v1.js";
import { modelLiveEvaluationScopeV2Schema } from "./model-live-evaluation-plan-v2.js";
import { modelLiveRuntimeControlPolicyV2Schema } from "./model-live-evaluation-v2.js";

/** V3 is a separate metadata contract, never approval or execution authority by
 * itself. Only authenticated host issuance can admit these records. */
function exactDigest(
  value: Record<string, unknown>,
  key: string,
  context: z.RefinementCtx,
) {
  const body = Object.fromEntries(
    Object.entries(value).filter(([name]) => name !== key),
  );
  if (value[key] !== digestCanonicalValue(body))
    context.addIssue({
      code: "custom",
      path: [key],
      message: "The exact complete metadata digest is required.",
    });
}
const same = (left: unknown, right: unknown) =>
  digestCanonicalValue(left) === digestCanonicalValue(right);
export const modelLiveRepairCaseV3Schema = z.enum([
  "evaluation_case_repair_success_full_beta_v1",
  "evaluation_case_repair_exhaustion_full_beta_v1",
]);
export const modelLiveRepairStageV3Schema = z.enum(["repair-1", "repair-2"]);
function freezeRecipe<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeRecipe(child);
    Object.freeze(value);
  }
  return value;
}
export const MODEL_LIVE_REPAIR_RECIPE_V3 = freezeRecipe({
  recipeId: "cloudmarkup.live-evaluation.candidate-repair",
  recipeVersion: "1.0.0",
  maximumRepairAttempts: 2,
  operation: "candidate.repair",
  role: "repair-escalation",
  stages: [
    { stageKey: "repair-1", ordinal: 1, predecessor: "seed" },
    { stageKey: "repair-2", ordinal: 2, predecessor: "repair-1" },
  ],
  derivation: "actual-predecessor-bytes-and-complete-sanitized-validation-v1",
  storage: "bounded-session-ram-only",
} as const);
export const MODEL_LIVE_REPAIR_RECIPE_DIGEST_V3 = digestCanonicalValue(
  MODEL_LIVE_REPAIR_RECIPE_V3,
);
const frozenCaseDigests = {
  evaluation_case_repair_success_full_beta_v1:
    "sha256:26e82404d35aea55037641eabad0cc378c9bb3de4e61178255dd9366313600f6",
  evaluation_case_repair_exhaustion_full_beta_v1:
    "sha256:6715b2d07acdeb511c4c29d87b10fd7a924566a3864355b7f1237895339f3c14",
} as const;
const seed = z
  .object({
    sourceDigest: sha256DigestSchema,
    revisionDigest: sha256DigestSchema,
    candidateDigest: sha256DigestSchema,
    ownershipDigest: sha256DigestSchema,
    validationReceiptDigest: sha256DigestSchema,
    validatorPolicyDigest: sha256DigestSchema,
  })
  .strict();
export const modelLiveRepairCaseDefinitionV3Schema = z
  .object({
    caseId: modelLiveRepairCaseV3Schema,
    caseDigest: sha256DigestSchema,
    sourceInputDigest: sha256DigestSchema,
    recipeDigest: sha256DigestSchema,
    authorityBinding: modelEvaluationAuthorityBindingV1Schema,
    routeId:
      modelLiveRuntimeControlPolicyV2Schema.shape.allowlists.shape.routes
        .element,
    seed,
  })
  .strict()
  .superRefine((value, context) => {
    const tuple = value.authorityBinding.authorityTuple;
    if (
      value.caseDigest !== frozenCaseDigests[value.caseId] ||
      value.recipeDigest !== MODEL_LIVE_REPAIR_RECIPE_DIGEST_V3 ||
      tuple.operation !== "candidate.repair" ||
      tuple.role !== "repair-escalation"
    )
      context.addIssue({
        code: "custom",
        message:
          "Only the exact frozen repair cases and reviewed two-slot recipe are supported.",
      });
  });
export type ModelLiveRepairCaseDefinitionV3 = z.output<
  typeof modelLiveRepairCaseDefinitionV3Schema
>;
export const modelLiveSequenceDefinitionV3Schema = z
  .object({
    contractVersion: z.literal(3),
    recordKind: z.literal("model-live-sequence-definition"),
    definitionId: solutionStableIdSchema,
    definitionDigest: sha256DigestSchema,
    scope: modelLiveEvaluationScopeV2Schema,
    policy: modelLiveRuntimeControlPolicyV2Schema,
    cases: z.array(modelLiveRepairCaseDefinitionV3Schema).min(1).max(2),
    limits: modelLiveEvaluationAuthorityV1Schema.shape.limits,
    expiresAt: utcTimestampSchema,
    normalCi: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    const fail = (message: string) => {
      context.addIssue({ code: "custom", message });
    };
    if (
      new Set(value.cases.map((entry) => entry.caseId)).size !==
        value.cases.length ||
      !same(
        value.cases.map((entry) => entry.caseDigest),
        value.policy.evaluationRequirement.datasetCaseDigests,
      )
    )
      fail(
        "The definition must preserve its exact ordered frozen case selection.",
      );
    if (
      !value.policy.liveEvaluation.permittedEnvironments.includes(
        value.scope.environment,
      )
    )
      fail(
        "The actual live environment must be permitted by the bound policy.",
      );
    if (
      value.policy.limits.maximumRepairAttempts < 2 ||
      value.limits.maximumInvocations < value.cases.length * 2 ||
      value.limits.maximumTotalTokens <
        value.limits.maximumInputTokens + value.limits.maximumOutputTokens ||
      value.limits.maximumConcurrentJobs >
        value.policy.requestWindows.organization.maximumConcurrentJobs ||
      value.limits.maximumConcurrentJobs >
        value.policy.requestWindows.user.maximumConcurrentJobs
    )
      fail(
        "The predeclared bounded stage set and all shared limits must fit the approved authority.",
      );
    for (const entry of value.cases) {
      const tuple = entry.authorityBinding.authorityTuple;
      const lists = value.policy.allowlists;
      if (
        !lists.routes.includes(entry.routeId) ||
        !lists.roles.includes(tuple.role) ||
        !lists.modelConfigurationReferences.includes(
          tuple.modelConfigurationReference,
        ) ||
        !value.policy.featureEntitlements.some(
          (entitlement) =>
            entitlement.plan === value.scope.plan &&
            entitlement.features.includes(tuple.operation),
        )
      )
        fail(
          "Every repair stage requires the same exact entitled and allow-listed authority.",
        );
    }
    exactDigest(value, "definitionDigest", context);
  });
export type ModelLiveSequenceDefinitionV3 = z.output<
  typeof modelLiveSequenceDefinitionV3Schema
>;
export const modelLiveSequenceApprovalV3Schema = z
  .object({
    contractVersion: z.literal(3),
    recordKind: z.literal("model-live-sequence-approval"),
    approvalId: solutionStableIdSchema,
    approvalDigest: sha256DigestSchema,
    definitionDigest: sha256DigestSchema,
    scope: modelLiveEvaluationScopeV2Schema,
    operatorUserId: solutionStableIdSchema,
    approvedAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const duration = Date.parse(value.expiresAt) - Date.parse(value.approvedAt);
    if (duration <= 0 || duration > 24 * 60 * 60 * 1000)
      context.addIssue({
        code: "custom",
        message: "Approval must have a positive lifetime of at most 24 hours.",
      });
    exactDigest(value, "approvalDigest", context);
  });
export type ModelLiveSequenceApprovalV3 = z.output<
  typeof modelLiveSequenceApprovalV3Schema
>;
export const modelLiveSequencePlanV3Schema = z
  .object({
    contractVersion: z.literal(3),
    recordKind: z.literal("model-live-sequence-plan"),
    planId: solutionStableIdSchema,
    planDigest: sha256DigestSchema,
    definition: modelLiveSequenceDefinitionV3Schema,
    approval: modelLiveSequenceApprovalV3Schema,
    issuedAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.approval.definitionDigest !== value.definition.definitionDigest ||
      !same(value.approval.scope, value.definition.scope) ||
      Date.parse(value.issuedAt) < Date.parse(value.approval.approvedAt) ||
      Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) ||
      Date.parse(value.expiresAt) >
        Math.min(
          Date.parse(value.approval.expiresAt),
          Date.parse(value.definition.expiresAt),
        )
    )
      context.addIssue({
        code: "custom",
        message:
          "The exact approved scope, definition and issuance interval are required.",
      });
    exactDigest(value, "planDigest", context);
  });
export type ModelLiveSequencePlanV3 = z.output<
  typeof modelLiveSequencePlanV3Schema
>;
const selectionId = solutionStableIdSchema.regex(
  /^live_sequence_[a-f0-9]{32}$/u,
);
const invocationId = solutionStableIdSchema.regex(/^invocation_[a-f0-9]{32}$/u);
const stageId = solutionStableIdSchema.regex(/^live_stage_[a-f0-9]{32}$/u);
const selectedStage = z
  .object({
    caseId: modelLiveRepairCaseV3Schema,
    caseDigest: sha256DigestSchema,
    stageKey: modelLiveRepairStageV3Schema,
    stageId,
    invocationId,
  })
  .strict();
export const modelLiveSequenceSelectionV3Schema = z
  .object({
    contractVersion: z.literal(3),
    recordKind: z.literal("model-live-sequence-selection"),
    issuerId: z.literal("cloudmarkup.model-live-sequence-selection"),
    issuerVersion: z.literal("1.0.0"),
    selectionId,
    selectionDigest: sha256DigestSchema,
    definitionId: solutionStableIdSchema,
    planDigest: sha256DigestSchema,
    approvalDigest: sha256DigestSchema,
    scope: modelLiveEvaluationScopeV2Schema,
    issuedAt: utcTimestampSchema,
    stages: z.array(selectedStage).min(2).max(4),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.stages.length % 2 !== 0 ||
      new Set(value.stages.map((stage) => stage.stageId)).size !==
        value.stages.length ||
      new Set(value.stages.map((stage) => stage.invocationId)).size !==
        value.stages.length ||
      new Set(value.stages.map((stage) => `${stage.caseId}:${stage.stageKey}`))
        .size !== value.stages.length
    )
      context.addIssue({
        code: "custom",
        message:
          "Every pre-issued case requires two unique immutable stages and invocation IDs.",
      });
    for (let index = 0; index < value.stages.length; index += 2) {
      const first = value.stages[index],
        second = value.stages[index + 1];
      if (
        first?.stageKey !== "repair-1" ||
        second?.stageKey !== "repair-2" ||
        first.caseId !== second.caseId ||
        first.caseDigest !== second.caseDigest ||
        first.caseDigest !== frozenCaseDigests[first.caseId]
      )
        context.addIssue({
          code: "custom",
          message: "The complete ordered frozen stage pair is required.",
        });
    }
    exactDigest(value, "selectionDigest", context);
  });
export type ModelLiveSequenceSelectionV3 = z.output<
  typeof modelLiveSequenceSelectionV3Schema
>;
const boundStage = {
  selectionId,
  selectionDigest: sha256DigestSchema,
  planDigest: sha256DigestSchema,
  caseId: modelLiveRepairCaseV3Schema,
  caseDigest: sha256DigestSchema,
  stageKey: modelLiveRepairStageV3Schema,
  stageId,
  invocationId,
};
const predecessor = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("seed"),
      candidateDigest: sha256DigestSchema,
      validationReceiptDigest: sha256DigestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("stage"),
      stageId,
      outcomeDigest: sha256DigestSchema,
      outputDigest: sha256DigestSchema,
      candidateDigest: sha256DigestSchema,
      validationReceiptDigest: sha256DigestSchema,
    })
    .strict(),
]);
export const modelLiveSequenceInputV3Schema = z
  .object({
    contractVersion: z.literal(3),
    recordKind: z.literal("model-live-sequence-input"),
    ...boundStage,
    inputBindingDigest: sha256DigestSchema,
    recipeDigest: sha256DigestSchema,
    authorityTupleDigest: sha256DigestSchema,
    operationInputDigest: sha256DigestSchema,
    preparedPayloadDigest: sha256DigestSchema,
    diagnosticsDigest: sha256DigestSchema,
    revisionDigest: sha256DigestSchema,
    ownershipDigest: sha256DigestSchema,
    predecessor,
    issuedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.recipeDigest !== MODEL_LIVE_REPAIR_RECIPE_DIGEST_V3 ||
      (value.stageKey === "repair-1") !== (value.predecessor.kind === "seed")
    )
      context.addIssue({
        code: "custom",
        message: "The exact stage-specific reviewed input recipe is required.",
      });
    exactDigest(value, "inputBindingDigest", context);
  });
export type ModelLiveSequenceInputV3 = z.output<
  typeof modelLiveSequenceInputV3Schema
>;
export const modelLiveSequenceDispatchV3Schema = z
  .object({
    contractVersion: z.literal(3),
    recordKind: z.literal("model-live-sequence-dispatch"),
    ...boundStage,
    inputBindingDigest: sha256DigestSchema,
    dispatchDigest: sha256DigestSchema,
    descriptorDigest: sha256DigestSchema,
    runtimeRequestDigest: sha256DigestSchema,
    canonicalAttemptDigest: sha256DigestSchema,
    platformReservationDigest: sha256DigestSchema,
    dispatchedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    exactDigest(value, "dispatchDigest", context);
  });
export type ModelLiveSequenceDispatchV3 = z.output<
  typeof modelLiveSequenceDispatchV3Schema
>;
const outcomeHeader = {
  contractVersion: z.literal(3),
  recordKind: z.literal("model-live-sequence-outcome"),
  ...boundStage,
  outcomeDigest: sha256DigestSchema,
  observedAt: utcTimestampSchema,
};
const knownDispatch = {
  inputBindingDigest: sha256DigestSchema,
  dispatchDigest: sha256DigestSchema,
  normalizedUsageDigest: sha256DigestSchema,
  commercialTerminalDigest: sha256DigestSchema,
};
export const modelLiveSequenceOutcomeV3Schema = z
  .discriminatedUnion("status", [
    z
      .object({
        ...outcomeHeader,
        status: z.literal("not-dispatched"),
        reason: z.enum([
          "predecessor-valid",
          "predecessor-nonrepairable",
          "predecessor-provider-failed",
          "predecessor-unknown",
          "predecessor-not-dispatched",
          "current-authority-denied",
          "cancelled-before-dispatch",
          "ram-unavailable",
        ]),
        noDispatchReceiptDigest: sha256DigestSchema,
      })
      .strict(),
    z
      .object({
        ...outcomeHeader,
        ...knownDispatch,
        status: z.literal("validated"),
        outputDigest: sha256DigestSchema,
        candidateDigest: sha256DigestSchema,
        validationReceiptDigest: sha256DigestSchema,
        validation: z.discriminatedUnion("status", [
          z
            .object({
              status: z.literal("valid"),
              repairable: z.literal(false),
            })
            .strict(),
          z
            .object({ status: z.literal("invalid"), repairable: z.boolean() })
            .strict(),
        ]),
      })
      .strict(),
    z
      .object({
        ...outcomeHeader,
        ...knownDispatch,
        status: z.literal("provider-failed"),
        failure: z.enum([
          "rejected",
          "malformed-output",
          "cancelled-after-dispatch",
        ]),
      })
      .strict(),
    z
      .object({
        ...outcomeHeader,
        status: z.literal("dispatch-unknown"),
        inputBindingDigest: sha256DigestSchema,
        dispatchDigest: sha256DigestSchema,
        reason: z.enum([
          "timeout",
          "connection-lost",
          "missing-usage",
          "ram-lost",
        ]),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    exactDigest(value, "outcomeDigest", context);
  });
export type ModelLiveSequenceOutcomeV3 = z.output<
  typeof modelLiveSequenceOutcomeV3Schema
>;

/** The additive artifact classifies V3 metadata only. Authenticating issuance,
 * receipts and current authority remains the private host's responsibility. */
export const modelLiveEvaluationSequenceRecordV3Schema = z.union([
  modelLiveSequenceDefinitionV3Schema,
  modelLiveSequenceApprovalV3Schema,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceDispatchV3Schema,
  modelLiveSequenceOutcomeV3Schema,
]);
export type ModelLiveEvaluationSequenceRecordV3 = z.output<
  typeof modelLiveEvaluationSequenceRecordV3Schema
>;
