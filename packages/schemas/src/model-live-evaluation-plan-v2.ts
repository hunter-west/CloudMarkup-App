import { z } from "zod";
import {
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import { digestCanonicalValue } from "./canonical-digest.js";
import { solutionStableIdSchema } from "./solution-contract-common-v1.js";
import { modelPlanKeyV1Schema } from "./model-routing-v1.js";
import {
  modelEvaluationAuthorityBindingV1Schema,
  modelLiveEvaluationAuthorityV1Schema,
} from "./model-evaluation-v1.js";
import { modelLiveRuntimeControlPolicyV2Schema } from "./model-live-evaluation-v2.js";

export const modelLiveEvaluationScopeV2Schema = z
  .object({
    organizationId: solutionStableIdSchema,
    projectId: solutionStableIdSchema,
    userId: solutionStableIdSchema,
    environment: z.enum(["development", "staging"]),
    plan: modelPlanKeyV1Schema,
  })
  .strict();

const caseBindingSchema = z
  .object({
    caseId: solutionStableIdSchema,
    caseDigest: sha256DigestSchema,
    sourceInputDigest: sha256DigestSchema,
    invocationInputDigest: sha256DigestSchema,
    authorityBinding: modelEvaluationAuthorityBindingV1Schema,
    routeId:
      modelLiveRuntimeControlPolicyV2Schema.shape.allowlists.shape.routes
        .element,
  })
  .strict();

/** Exact metadata to review before approval. No prompt, candidate, final report
 * or self-asserted approval is accepted. The trusted host must bind each
 * invocation digest to its prepared frozen case before presenting this record. */
export const modelLiveEvaluationDefinitionV2Schema = z
  .object({
    contractVersion: z.literal(2),
    recordKind: z.literal("model-live-evaluation-definition"),
    definitionId: solutionStableIdSchema,
    definitionDigest: sha256DigestSchema,
    scope: modelLiveEvaluationScopeV2Schema,
    policy: modelLiveRuntimeControlPolicyV2Schema,
    cases: z.array(caseBindingSchema).min(1).max(21),
    limits: modelLiveEvaluationAuthorityV1Schema.shape.limits,
    expiresAt: utcTimestampSchema,
    normalCi: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    const fail = (path: (string | number)[], message: string) => {
      context.addIssue({ code: "custom", path, message });
    };
    if (
      new Set(value.cases.map((c) => c.caseId)).size !== value.cases.length ||
      new Set(value.cases.map((c) => c.caseDigest)).size !== value.cases.length
    )
      fail(
        ["cases"],
        "A live definition requires unique frozen case identities.",
      );
    if (
      digestCanonicalValue(value.cases.map((c) => c.caseDigest)) !==
      digestCanonicalValue(
        value.policy.evaluationRequirement.datasetCaseDigests,
      )
    )
      fail(
        ["cases"],
        "The definition must cover the exact ordered frozen case set.",
      );
    if (
      !value.policy.liveEvaluation.permittedEnvironments.includes(
        value.scope.environment,
      )
    )
      fail(
        ["scope", "environment"],
        "The live environment must be permitted by the bound policy.",
      );
    if (
      value.limits.maximumTotalTokens <
      value.limits.maximumInputTokens + value.limits.maximumOutputTokens
    )
      fail(
        ["limits", "maximumTotalTokens"],
        "The total token bound must cover input and output budgets.",
      );
    if (
      value.limits.maximumConcurrentJobs >
        value.policy.requestWindows.organization.maximumConcurrentJobs ||
      value.limits.maximumConcurrentJobs >
        value.policy.requestWindows.user.maximumConcurrentJobs
    )
      fail(
        ["limits", "maximumConcurrentJobs"],
        "Live concurrency cannot exceed the shared user and organization limits.",
      );
    for (const [index, entry] of value.cases.entries()) {
      const tuple = entry.authorityBinding.authorityTuple;
      const lists = value.policy.allowlists;
      if (
        !lists.routes.includes(entry.routeId) ||
        !lists.roles.includes(tuple.role) ||
        !lists.modelConfigurationReferences.includes(
          tuple.modelConfigurationReference,
        )
      )
        fail(
          ["cases", index, "authorityBinding"],
          "Every case must use an explicitly allow-listed route, role and model.",
        );
      if (
        !value.policy.featureEntitlements.some(
          (e) =>
            e.plan === value.scope.plan && e.features.includes(tuple.operation),
        )
      )
        fail(
          ["cases", index, "authorityBinding"],
          "Every live operation must be entitled by the bound commercial plan.",
        );
    }
    const { definitionDigest, ...metadata } = value;
    if (definitionDigest !== digestCanonicalValue(metadata))
      fail(
        ["definitionDigest"],
        "The definition digest must bind its exact scope, cases, policy, budgets and expiry.",
      );
  });
export type ModelLiveEvaluationDefinitionV2 = z.output<
  typeof modelLiveEvaluationDefinitionV2Schema
>;
export function digestModelLiveEvaluationDefinitionV2(
  value: Omit<ModelLiveEvaluationDefinitionV2, "definitionDigest">,
) {
  return digestCanonicalValue(value);
}

/** Issuance metadata, never proof by itself. Only the trusted approval store can
 * authenticate this receipt, its current operator authority and revocation. */
export const modelLiveEvaluationApprovalV2Schema = z
  .object({
    contractVersion: z.literal(2),
    recordKind: z.literal("model-live-evaluation-approval"),
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
        path: ["expiresAt"],
        message:
          "An operator approval must have a positive lifetime of at most 24 hours.",
      });
    const { approvalDigest, ...metadata } = value;
    if (approvalDigest !== digestCanonicalValue(metadata))
      context.addIssue({
        code: "custom",
        path: ["approvalDigest"],
        message:
          "Approval metadata must bind the exact reviewed definition, scope, operator and validity interval.",
      });
  });
export type ModelLiveEvaluationApprovalV2 = z.output<
  typeof modelLiveEvaluationApprovalV2Schema
>;
export function digestModelLiveEvaluationApprovalV2(
  value: Omit<ModelLiveEvaluationApprovalV2, "approvalDigest">,
) {
  return digestCanonicalValue(value);
}

export const modelLiveEvaluationPlanV2Schema = z
  .object({
    contractVersion: z.literal(2),
    recordKind: z.literal("model-live-evaluation-plan"),
    planId: solutionStableIdSchema,
    planDigest: sha256DigestSchema,
    definition: modelLiveEvaluationDefinitionV2Schema,
    approval: modelLiveEvaluationApprovalV2Schema,
    issuedAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.approval.definitionDigest !== value.definition.definitionDigest ||
      digestCanonicalValue(value.approval.scope) !==
        digestCanonicalValue(value.definition.scope)
    )
      context.addIssue({
        code: "custom",
        path: ["approval"],
        message:
          "The approval must bind this exact definition and execution scope.",
      });
    if (
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
        path: ["expiresAt"],
        message:
          "Plan issuance must remain within the approved definition's validity interval.",
      });
    const { planDigest, ...metadata } = value;
    if (planDigest !== digestCanonicalValue(metadata))
      context.addIssue({
        code: "custom",
        path: ["planDigest"],
        message:
          "The live plan must bind its exact definition and issued approval.",
      });
  });
export type ModelLiveEvaluationPlanV2 = z.output<
  typeof modelLiveEvaluationPlanV2Schema
>;
export function digestModelLiveEvaluationPlanV2(
  value: Omit<ModelLiveEvaluationPlanV2, "planDigest">,
) {
  return digestCanonicalValue(value);
}
