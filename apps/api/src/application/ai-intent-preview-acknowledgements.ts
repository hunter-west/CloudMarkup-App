import type {
  AcknowledgeAiIntentPreviewV1,
  AiIntentPreviewAcknowledgementV1,
} from "@cloudmarkup/api-contract";

import type { PrincipalContext } from "./ports.js";

/** A host-owned metadata operation, never a model or content persistence port. */
export interface AiIntentPreviewAcknowledgementPortV1 {
  acknowledge(
    principal: PrincipalContext,
    projectId: string,
    input: AcknowledgeAiIntentPreviewV1,
  ): Promise<AiIntentPreviewAcknowledgementV1>;
}
