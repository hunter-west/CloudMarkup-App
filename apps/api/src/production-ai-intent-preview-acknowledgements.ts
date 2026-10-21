import { acknowledgeAiIntentPreviewV1Schema } from "@cloudmarkup/api-contract";

import { acknowledgeExistingAiIntentPreview } from "./adapters/persistence/ai-intent-preview-acknowledgement.js";
import { aiPreviewProofSchema } from "./adapters/persistence/ai-intent-preview-codec.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import type { AiIntentPreviewAcknowledgementPortV1 } from "./application/ai-intent-preview-acknowledgements.js";
import { ApplicationError } from "./application/errors.js";

/** Constructs no runtime, provider, reservation, object storage or content
 * closure. The real journal derives tenant ownership and verifies the original
 * session/draft/lease/proof again in a fresh transaction before recording ACK. */
export function createProductionAiIntentPreviewAcknowledgements(
  database: SqlDatabase,
): AiIntentPreviewAcknowledgementPortV1 {
  return {
    acknowledge: async (principal, projectId, value) => {
      try {
        const input = acknowledgeAiIntentPreviewV1Schema.parse(value);
        await acknowledgeExistingAiIntentPreview({
          database,
          principal,
          projectId,
          editingProof: input.editingProof,
          proof: aiPreviewProofSchema.parse(input.delivery),
        });
        return { contractVersion: 1, state: "acknowledged" };
      } catch {
        // Missing/foreign/stale proofs and storage faults disclose no target,
        // secret, candidate content or internals. No automatic regeneration.
        throw new ApplicationError(
          "conflict",
          "The preview acknowledgement could not be confirmed.",
        );
      }
    },
  };
}
