import type {
  AcceptAiIntentPreviewV1,
  AcceptedIntentV1,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext } from "./ports.js";

export interface AiIntentAcceptancePortV1 {
  accept(
    principal: PrincipalContext,
    projectId: string,
    input: AcceptAiIntentPreviewV1,
    expectedDraftEtag: string,
    idempotencyKey: string,
  ): Promise<AcceptedIntentV1>;
  get(
    principal: PrincipalContext,
    projectId: string,
    acceptedIntentId: string,
  ): Promise<AcceptedIntentV1>;
}
