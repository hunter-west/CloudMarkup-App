import { z } from "zod";
import { modelLiveSeedInvocationDescriptorV3Schema } from "./model-live-seed-invocation-v3.js";

/** Static final-repair metadata only. Issuance, counted cost and current
 * authority are established separately by the authenticated host. */
export const modelLiveRepairSuccessorInvocationDescriptorV4Schema = z
  .object({
    ...modelLiveSeedInvocationDescriptorV3Schema.shape,
    contractVersion: z.literal(4),
    recordKind: z.literal("model-live-repair-successor-invocation-descriptor"),
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
export type ModelLiveRepairSuccessorInvocationDescriptorV4 = z.output<
  typeof modelLiveRepairSuccessorInvocationDescriptorV4Schema
>;
