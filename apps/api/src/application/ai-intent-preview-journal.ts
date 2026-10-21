import type {
  ModelCommercialInvocationContextV1,
  ModelCommercialInvocationResultV1,
  ModelCommercialInvocationRecoveryPortV1,
  ModelCommercialOperationRequestV1,
  ModelGatewayInvocationContextV1,
  ModelInvocationStore,
  ModelRuntimeSanitizedOutputEvidenceV1,
  ModelUsageEvidenceSourceV1,
  ModelUsageRecorder,
} from "@cloudmarkup/model-gateway";
import type { Sha256Digest } from "@cloudmarkup/schemas";

/** All inputs are host-resolved metadata, never the untrusted HTTP payload. */
export interface AiIntentPreviewBindingV1 {
  readonly contractVersion: 1;
  readonly scope: ModelGatewayInvocationContextV1["scope"];
  readonly request: ModelCommercialOperationRequestV1;
  readonly invocationId: string;
  readonly idempotencyKeyDigest: Sha256Digest;
  readonly inputDigest: Sha256Digest;
  /** Binds current baseline/lease epoch plus exact runtime/context authority. */
  readonly previewBindingDigest: Sha256Digest;
}

export interface AiIntentPreviewDeliveryProofV1 {
  readonly contractVersion: 1;
  readonly invocationId: string;
  readonly outputDigest: Sha256Digest;
  readonly expiresAt: string;
  /** Unpredictable single-delivery proof. RAM only; SQL stores its SHA-256. */
  readonly token: string;
}

export type AiIntentPreviewDeliveryOutcomeV1 =
  | { readonly kind: "pending" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "terminal";
      readonly acknowledged: boolean;
      readonly commercial: ModelCommercialInvocationResultV1;
    };

export interface AiIntentPreviewJournalV1
  extends
    ModelInvocationStore,
    ModelUsageRecorder,
    ModelUsageEvidenceSourceV1,
    ModelCommercialInvocationRecoveryPortV1 {
  readonly binding: AiIntentPreviewBindingV1;
  /** Only inside the exact canonical coordinator's reserved callback. */
  prepare(callback: ModelCommercialInvocationContextV1): Promise<void>;
  prepareDelivery(
    evidence: ModelRuntimeSanitizedOutputEvidenceV1,
  ): Promise<AiIntentPreviewDeliveryProofV1>;
  acknowledge(proof: AiIntentPreviewDeliveryProofV1): Promise<void>;
  /** Host-observed delivery failure; does not imply zero provider usage. */
  closeDelivery(): Promise<void>;
  deliveryOutcome(): Promise<AiIntentPreviewDeliveryOutcomeV1>;
}

export class AiIntentPreviewError extends Error {
  readonly code = "ai-preview.unavailable";
  constructor() {
    super(
      "The memory-only preview is unavailable or its authority has changed.",
    );
    this.name = "AiIntentPreviewError";
  }
}
