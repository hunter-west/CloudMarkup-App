import { z } from "zod";

import {
  modelHostSeedPatchResponseV2Schema,
  type ModelHostSeedPatchResponseV2,
  modelAiFixResponseV1Schema,
  modelApplicationSourceGenerationResponseV1Schema,
  modelArchitectureProposalResponseV1Schema,
  modelBlockingQuestionsResponseV1Schema,
  modelCandidateRepairResponseV1Schema,
  modelDeterministicFixExplanationResponseV1Schema,
  modelExternalResourceProposalResponseV1Schema,
  modelGatewayOperationV1Schema,
  modelIacExtensionGenerationResponseV1Schema,
  modelIntentExtractionResponseV1Schema,
  modelIssueExplanationResponseV1Schema,
  modelOperationProposalResponseV1Schema,
  modelPlainLanguageSummaryResponseV1Schema,
  modelRepositoryInterpretationResponseV1Schema,
  modelTechnicalSummaryResponseV1Schema,
  modelWorkloadProposalResponseV1Schema,
  type ModelGatewayOperationV1,
  type ModelGatewayResponseV1,
} from "@cloudmarkup/schemas";

const responseSchemas = {
  "application-source.generate":
    modelApplicationSourceGenerationResponseV1Schema,
  "architecture.propose": modelArchitectureProposalResponseV1Schema,
  "candidate.repair": modelCandidateRepairResponseV1Schema,
  "deterministic-fix.explain": modelDeterministicFixExplanationResponseV1Schema,
  "external-resource.propose": modelExternalResourceProposalResponseV1Schema,
  "fix.propose": modelAiFixResponseV1Schema,
  "iac-extension.generate": modelIacExtensionGenerationResponseV1Schema,
  "intent.extract": modelIntentExtractionResponseV1Schema,
  "issue.explain": modelIssueExplanationResponseV1Schema,
  "operations.propose": modelOperationProposalResponseV1Schema,
  "repository.interpret": modelRepositoryInterpretationResponseV1Schema,
  "requirements.blocking-questions": modelBlockingQuestionsResponseV1Schema,
  "summary.plain-language": modelPlainLanguageSummaryResponseV1Schema,
  "summary.technical": modelTechnicalSummaryResponseV1Schema,
  "workload.propose": modelWorkloadProposalResponseV1Schema,
} as const satisfies Readonly<
  Record<ModelGatewayOperationV1, z.ZodType<ModelGatewayResponseV1>>
>;

const responseToolNames = {
  "application-source.generate": "cloudmarkup_application_source_v1",
  "architecture.propose": "cloudmarkup_architecture_proposal_v1",
  "candidate.repair": "cloudmarkup_candidate_repair_v1",
  "deterministic-fix.explain": "cloudmarkup_deterministic_fix_v1",
  "external-resource.propose": "cloudmarkup_external_resources_v1",
  "fix.propose": "cloudmarkup_fix_proposal_v1",
  "iac-extension.generate": "cloudmarkup_iac_extension_v1",
  "intent.extract": "cloudmarkup_intent_extraction_v1",
  "issue.explain": "cloudmarkup_issue_explanation_v1",
  "operations.propose": "cloudmarkup_operation_batches_v1",
  "repository.interpret": "cloudmarkup_repository_interpretation_v1",
  "requirements.blocking-questions": "cloudmarkup_blocking_questions_v1",
  "summary.plain-language": "cloudmarkup_plain_summary_v1",
  "summary.technical": "cloudmarkup_technical_summary_v1",
  "workload.propose": "cloudmarkup_workload_proposal_v1",
} as const satisfies Readonly<Record<ModelGatewayOperationV1, string>>;

export interface StrictModelResponseToolV1 {
  readonly authority: "none";
  readonly contractVersion: 1;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly operation: ModelGatewayOperationV1;
  readonly schemaId: string;
  readonly toolName: string;
}

export type ModelProviderContentV1 =
  | {
      readonly input: unknown;
      readonly kind: "tool-use";
      readonly toolName: string;
    }
  | { readonly kind: "text"; readonly text: string };

const providerContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      input: z.unknown(),
      kind: z.literal("tool-use"),
      toolName: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      text: z.string().max(1_048_576),
    })
    .strict(),
]);

export class ModelResponseToolError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "ModelResponseToolError";
    this.code = code;
  }
}

export function getModelResponseToolV1(
  operation: ModelGatewayOperationV1,
): StrictModelResponseToolV1 {
  const schema = responseSchemas[operation];
  const toolName = responseToolNames[operation];
  return Object.freeze({
    authority: "none",
    contractVersion: 1,
    inputSchema: Object.freeze(
      z.toJSONSchema(schema, {
        io: "input",
        target: "draft-2020-12",
        reused: "ref",
      }),
    ),
    operation,
    schemaId: `https://schemas.cloudmarkup.com/model-response-tools/${toolName}/v1.schema.json`,
    toolName,
  });
}

export function listModelResponseToolsV1(): readonly StrictModelResponseToolV1[] {
  return modelGatewayOperationV1Schema.options.map(getModelResponseToolV1);
}

function parseToolContent<T>(
  raw: unknown,
  tool: StrictModelResponseToolV1,
  schema: z.ZodType<T>,
): T {
  const content = providerContentSchema.safeParse(raw);
  if (!content.success) {
    throw new ModelResponseToolError(
      "model-gateway.invalid-output",
      "The provider content does not match the strict response channel.",
    );
  }
  if (content.data.kind === "text") {
    throw new ModelResponseToolError(
      "model-gateway.prose-not-machine-state",
      "Prose provider output cannot be consumed as machine state.",
    );
  }
  if (content.data.toolName !== tool.toolName) {
    throw new ModelResponseToolError(
      "model-gateway.unknown-response-tool",
      "The provider selected an unknown or operation-mismatched response tool.",
    );
  }
  const response = schema.safeParse(content.data.input);
  if (!response.success) {
    throw new ModelResponseToolError(
      "model-gateway.invalid-output",
      "The response tool input does not match the operation contract.",
    );
  }
  return response.data;
}

export function parseModelResponseToolContentV1(input: {
  readonly content: unknown;
  readonly operation: ModelGatewayOperationV1;
}): ModelGatewayResponseV1 {
  return parseToolContent<ModelGatewayResponseV1>(
    input.content,
    getModelResponseToolV1(input.operation),
    responseSchemas[input.operation],
  );
}
export function getModelHostSeedPatchResponseToolV2(): StrictModelResponseToolV1 {
  const toolName = "cloudmarkup_host_seed_patch_v2";
  return Object.freeze({
    authority: "none",
    contractVersion: 1,
    operation: "candidate.repair",
    toolName,
    schemaId:
      "https://schemas.cloudmarkup.com/model-response-tools/" +
      toolName +
      "/v2.schema.json",
    inputSchema: Object.freeze(
      z.toJSONSchema(modelHostSeedPatchResponseV2Schema, {
        io: "input",
        target: "draft-2020-12",
        reused: "ref",
      }),
    ),
  });
}
export function parseModelHostSeedPatchResponseToolContentV2(
  content: unknown,
): ModelHostSeedPatchResponseV2 {
  return parseToolContent(
    content,
    getModelHostSeedPatchResponseToolV2(),
    modelHostSeedPatchResponseV2Schema,
  );
}
