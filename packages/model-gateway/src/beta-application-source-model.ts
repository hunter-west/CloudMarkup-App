import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import {
  requireBetaConverseUsage,
  type BetaConverseUsage,
} from "./beta-infrastructure-model.js";
import {
  betaApplicationSourceV1Schema,
  betaApplicationSourceV2Schema,
  betaApplicationSourceV3Schema,
  prepareApplicationSourceRequestV1,
  type BetaApplicationSource,
} from "./application-source-content.js";
export {
  betaApplicationSourceV2Schema,
  betaApplicationSourceV3Schema,
  betaApplicationSourceSchema,
  BETA_APPLICATION_SOURCE_PROMPT_VERSION,
  BETA_APPLICATION_SOURCE_SEMANTIC_PROMPT_VERSION,
  BETA_APPLICATION_SOURCE_LEGACY_PROMPT_VERSION,
  BETA_APPLICATION_SOURCE_INSTRUCTIONS,
  BETA_APPLICATION_SOURCE_REVIEW_INSTRUCTIONS,
  BETA_APPLICATION_SOURCE_SEMANTIC_INSTRUCTIONS,
  type BetaApplicationSource,
} from "./application-source-content.js";
export const BETA_APPLICATION_SOURCE_MODEL_ID =
  "global.anthropic.claude-sonnet-4-6" as const;

export function createBetaApplicationSourceModel() {
  const client = new BedrockRuntimeClient({
    region: "us-east-1",
    maxAttempts: 1,
  });
  return async (input: {
    context: unknown;
    reviewed?: boolean;
    semantic?: boolean;
    signal: AbortSignal;
    onUsage?: (usage: BetaConverseUsage) => Promise<void>;
  }): Promise<BetaApplicationSource> => {
    const result = await client.send(
      new ConverseCommand(betaApplicationSourceModelRequest(input)),
      { abortSignal: input.signal },
    );
    const calls = (result.output?.message?.content ?? []).flatMap((block) =>
      block.toolUse ? [block.toolUse] : [],
    );
    if (
      result.stopReason !== "tool_use" ||
      calls.length !== 1 ||
      calls[0]?.name !== "application_source"
    )
      throw new Error("Application source generation did not complete.");
    const output = (
      input.semantic
        ? betaApplicationSourceV3Schema
        : input.reviewed
          ? betaApplicationSourceV2Schema
          : betaApplicationSourceV1Schema
    ).parse(calls[0].input);
    if (input.onUsage)
      await input.onUsage(
        requireBetaConverseUsage(result.usage, result.$metadata.requestId),
      );
    return output;
  };
}

export function betaApplicationSourceModelRequest(input: {
  readonly context: unknown;
  readonly reviewed?: boolean;
  readonly semantic?: boolean;
}): ConverseCommandInput {
  const prepared = prepareApplicationSourceRequestV1(input);
  return {
    modelId: BETA_APPLICATION_SOURCE_MODEL_ID,
    inferenceConfig: {
      maxTokens: prepared.maximumOutputTokens,
      temperature: prepared.temperature,
    },
    system: [{ text: prepared.systemText }],
    messages: [
      // Retain the original JSON.stringify runtime behavior at this SDK wire.
      // Its former string annotation also allowed undefined input at runtime.
      {
        role: "user",
        content: [{ text: prepared.userText } as ContentBlock.TextMember],
      },
    ],
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: prepared.responseTool.name,
            description: prepared.responseTool.description,
            inputSchema: { json: prepared.responseTool.schema as never },
          },
        },
      ],
      toolChoice: { tool: { name: prepared.responseTool.name } },
    },
  };
}
