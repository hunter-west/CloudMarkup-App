import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import type { BetaInfrastructureProposal } from "@cloudmarkup/schemas";
import {
  infrastructureProposalSchemaForVersion,
  prepareInfrastructureProposalRequestV1,
} from "./infrastructure-proposal-request.js";
import { z } from "zod";

export const BETA_INFRASTRUCTURE_MODEL_ID =
  "global.anthropic.claude-sonnet-4-6" as const;

export interface BetaConverseUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly providerRequestId?: string;
}

const proposalFields = new Set([
  "contractVersion",
  "summary",
  "resources",
  "connections",
  "limitations",
  "existingResources",
  "updates",
  "review",
]);
const rootValidationRules: Readonly<Record<string, string>> = {
  "Resource keys and existing node references must be unique.":
    "resource-identity",
  "Parents must precede children in the proposal.": "parent-order",
  "Connections must reference distinct declared resources.":
    "connection-reference",
  "Updates require unique existing resources and bounded nonempty settings.":
    "update-binding",
  "A proposal requires changes, a substantive assessment or a question to resolve.":
    "empty-assessment",
  "Resolve blocking questions before proposing changes.": "blocking-question",
};

function sanitizedValidationDiagnostic(
  version: 1 | 2 | 3 | 4 | 5 | 6 | undefined,
  value: unknown,
): {
  readonly validationFields: readonly string[];
  readonly validationRules?: readonly string[];
} {
  const result =
    infrastructureProposalSchemaForVersion(version).safeParse(value);
  if (result.success) return { validationFields: ["root"] };
  const validationFields = [
    ...new Set(
      result.error.issues.map((issue) => {
        const field = issue.path[0];
        return typeof field === "string" && proposalFields.has(field)
          ? field
          : "root";
      }),
    ),
  ].sort();
  const validationRules = [
    ...new Set(
      result.error.issues
        .filter((issue) => issue.path.length === 0)
        .map((issue) =>
          issue.code === "custom"
            ? (rootValidationRules[issue.message] ?? "root-constraint")
            : "root-shape",
        ),
    ),
  ].sort();
  return {
    validationFields,
    ...(validationRules.length === 0 ? {} : { validationRules }),
  };
}

export function requireBetaConverseUsage(
  usage:
    | {
        inputTokens?: number | undefined;
        outputTokens?: number | undefined;
        cacheReadInputTokens?: number | undefined;
        cacheWriteInputTokens?: number | undefined;
      }
    | undefined,
  requestId?: string,
): BetaConverseUsage {
  const inputTokens = usage?.inputTokens;
  const outputTokens = usage?.outputTokens;
  const cacheReadInputTokens = usage?.cacheReadInputTokens ?? 0;
  if (
    typeof inputTokens !== "number" ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    typeof outputTokens !== "number" ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0 ||
    !Number.isSafeInteger(cacheReadInputTokens) ||
    cacheReadInputTokens < 0 ||
    (usage?.cacheWriteInputTokens ?? 0) !== 0
  )
    throw new Error("Bedrock usage is unavailable or cannot be priced.");
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    ...(requestId ? { providerRequestId: requestId } : {}),
  };
}
/** Summary is display prose, never graph configuration. Bound only that field;
 * every resource, relationship and configuration still passes the strict schema. */
function compactModelSummary(proposal: unknown): unknown {
  if (
    proposal === null ||
    typeof proposal !== "object" ||
    Array.isArray(proposal) ||
    !("summary" in proposal) ||
    typeof proposal.summary !== "string"
  )
    return proposal;
  const summary = proposal.summary.trim();
  if (summary.length <= 1500) return proposal;
  let bounded = "";
  for (const character of summary) {
    if (bounded.length + character.length > 1499) break;
    bounded += character;
  }
  return { ...proposal, summary: bounded.trimEnd() + "…" };
}
/** Beta proposal provider path. The caller owns reservation and settlement;
 * this adapter returns validated output and exact provider usage. */
export function createBetaInfrastructureModel(
  options: {
    readonly onFailure?: (
      reason:
        | "access-denied"
        | "request-rejected"
        | "throttled"
        | "aborted"
        | "incomplete-response"
        | "invalid-response"
        | "unavailable",
      diagnostic?: {
        readonly validationFields: readonly string[];
        readonly validationRules?: readonly string[];
      },
    ) => void;
  } = {},
) {
  const client = new BedrockRuntimeClient({
    region: "us-east-1",
    maxAttempts: 1,
  });
  return async (input: {
    readonly requirements: string;
    readonly proposalVersion?: 1 | 2 | 3 | 4 | 5 | 6;
    readonly existingArchitecture?: unknown;
    readonly catalog: unknown;
    readonly signal: AbortSignal;
    readonly onUsage?: (usage: BetaConverseUsage) => Promise<void>;
  }): Promise<BetaInfrastructureProposal> => {
    let responseInput: unknown;
    try {
      const result = await client.send(
        new ConverseCommand(betaInfrastructureModelRequest(input)),
        { abortSignal: input.signal },
      );
      const tools = (result.output?.message?.content ?? []).flatMap((block) =>
        block.toolUse === undefined ? [] : [block.toolUse],
      );
      if (
        result.stopReason !== "tool_use" ||
        tools.length !== 1 ||
        tools[0]?.name !== "infrastructure_proposal"
      )
        throw new Error("The beta model did not return a complete proposal.");
      responseInput = compactModelSummary(tools[0].input);
      const proposal = infrastructureProposalSchemaForVersion(
        input.proposalVersion,
      ).parse(responseInput);
      if (input.onUsage)
        await input.onUsage(
          requireBetaConverseUsage(result.usage, result.$metadata.requestId),
        );
      return proposal;
    } catch (error) {
      const reason =
        error instanceof z.ZodError
          ? "invalid-response"
          : error instanceof Error && error.name === "AccessDeniedException"
            ? "access-denied"
            : error instanceof Error && error.name === "ValidationException"
              ? "request-rejected"
              : error instanceof Error && error.name === "ThrottlingException"
                ? "throttled"
                : input.signal.aborted
                  ? "aborted"
                  : error instanceof Error &&
                      error.message ===
                        "The beta model did not return a complete proposal."
                    ? "incomplete-response"
                    : "unavailable";
      if (reason === "invalid-response")
        options.onFailure?.(
          reason,
          sanitizedValidationDiagnostic(input.proposalVersion, responseInput),
        );
      else options.onFailure?.(reason);
      throw error;
    }
  };
}

export function betaInfrastructureModelRequest(input: {
  readonly requirements: string;
  readonly proposalVersion?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly existingArchitecture?: unknown;
  readonly catalog: unknown;
}): ConverseCommandInput {
  const prepared = prepareInfrastructureProposalRequestV1(input);
  return {
    modelId: BETA_INFRASTRUCTURE_MODEL_ID,
    inferenceConfig: {
      maxTokens: prepared.maximumOutputTokens,
      temperature: prepared.temperature,
    },
    system: [{ text: prepared.systemText }],
    messages: [{ role: "user", content: [{ text: prepared.userText }] }],
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
