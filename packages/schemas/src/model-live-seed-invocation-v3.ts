import { z } from "zod";
import {
  modelInvocationDescriptorV1Schema,
  modelInvocationRoutingV1Schema,
  modelInvocationScopeV1Schema,
} from "./model-gateway-v1.js";

const {
  routingDecisionDigest: finalDecision,
  acceptedMaximumCreditUnits: acceptedCredits,
  evaluationResultDigest: evaluationMetadata,
  evaluationResultVersion: evaluationVersion,
  ...staticRouting
} = modelInvocationRoutingV1Schema.shape;
void finalDecision;
void acceptedCredits;
void evaluationMetadata;
void evaluationVersion;

/** Static first-seed configuration only. The model capability digest includes
 * its configured evaluation metadata. Final route, counted estimate and issued
 * input bind this descriptor in one direction after preparation. */
export const modelLiveSeedInvocationRoutingV3Schema = z
  .object({
    ...staticRouting,
    routeId: z.literal("internal-escalation"),
    effort: z.literal("high"),
  })
  .strict();

export const modelLiveSeedInvocationDescriptorV3Schema = z
  .object({
    ...modelInvocationDescriptorV1Schema.shape,
    contractVersion: z.literal(3),
    recordKind: z.literal("model-live-seed-invocation-descriptor"),
    feature: z.literal("candidate.repair"),
    role: z.literal("repair-escalation"),
    routing: modelLiveSeedInvocationRoutingV3Schema,
    scope: z
      .object({
        organizationId: modelInvocationScopeV1Schema.shape.organizationId,
        projectId: modelInvocationScopeV1Schema.shape.projectId.unwrap(),
        userId: modelInvocationScopeV1Schema.shape.userId,
        jobId: modelInvocationScopeV1Schema.shape.jobId.unwrap(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.routing.evaluationPolicyId !== value.evaluationPolicyId ||
      value.routing.evaluationPolicyVersion !== value.evaluationPolicyVersion
    )
      context.addIssue({
        code: "custom",
        path: ["routing", "evaluationPolicyId"],
        message:
          "Static routing must bind the descriptor evaluation policy exactly.",
      });
  });
export type ModelLiveSeedInvocationRoutingV3 = z.output<
  typeof modelLiveSeedInvocationRoutingV3Schema
>;
export type ModelLiveSeedInvocationDescriptorV3 = z.output<
  typeof modelLiveSeedInvocationDescriptorV3Schema
>;
