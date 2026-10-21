import type {
  ModelGatewayOperationV1,
  SemanticVersion,
  Sha256Digest,
} from "@cloudmarkup/schemas";

export interface ReviewedPromptTemplateV1 {
  readonly content: string;
  readonly digest: Sha256Digest;
  readonly operations: readonly ModelGatewayOperationV1[];
  readonly reviewed: true;
  readonly templateId: string;
  readonly version: SemanticVersion;
}

export interface PromptTemplateSourceV1 {
  readonly content: string;
  readonly operations: readonly ModelGatewayOperationV1[];
  readonly templateId: string;
  readonly version: string;
}

export interface ModelPromptRegistry {
  get(operation: ModelGatewayOperationV1): ReviewedPromptTemplateV1 | null;
  list(): readonly ReviewedPromptTemplateV1[];
}
