import { z } from "zod";
import {
  modelRoutingDecisionV1Schema,
  refineModelRoutingDecisionCommon,
} from "./model-routing-v1.js";
import { modelLiveSequenceInputV3Schema } from "./model-live-evaluation-sequence-v3.js";

const {
  escalation: legacyEscalation,
  evaluationResultDigest: legacyEvaluationResult,
  evaluationResultVersion: legacyEvaluationVersion,
  ...routeFields
} = modelRoutingDecisionV1Schema.shape;
void legacyEscalation;
void legacyEvaluationResult;
void legacyEvaluationVersion;

/** First-seed metadata binds the issued V3 input. It grants no current
 * tenant, approval, commercial, capacity, provider or evaluation authority. */
export const modelLiveSeedRoutingDecisionV3Schema = z
  .object({
    ...routeFields,
    contractVersion: z.literal(3),
    recordKind: z.literal("model-live-seed-routing-decision"),
    seedInputBindingDigest:
      modelLiveSequenceInputV3Schema.shape.inputBindingDigest,
    feature: z.literal("candidate.repair"),
    routeId: z.literal("internal-escalation"),
    maximumAttempts: z.literal(1),
    automaticEscalationPermitted: z.literal(false),
    promptCachePolicy: z
      .object({
        enabled: z.literal(false),
        cacheKeyRequired: z.literal(false),
        maximumCheckpoints: z.literal(0),
        minimumCheckpointTokens: z.literal(0),
      })
      .strict(),
  })
  .strict()
  .superRefine(refineModelRoutingDecisionCommon);
export type ModelLiveSeedRoutingDecisionV3 = z.output<
  typeof modelLiveSeedRoutingDecisionV3Schema
>;
