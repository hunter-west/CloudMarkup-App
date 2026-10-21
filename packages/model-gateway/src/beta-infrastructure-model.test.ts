import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  BETA_INFRASTRUCTURE_MODEL_ID,
  betaInfrastructureModelRequest,
  createBetaInfrastructureModel,
} from "./beta-infrastructure-model.js";
const { send, configurations } = vi.hoisted(() => ({
  send: vi.fn(),
  configurations: [] as unknown[],
}));
it("v6 sends complete semantic data through one output tool without widening edit authority", () => {
  const context = {
    contextVersion: 3,
    resources: [{ nodeId: "policy", editable: false }],
    connections: [
      {
        edgeId: "relationship",
        sourcePort: "principal",
        targetPort: "resource",
      },
    ],
  };
  const request = betaInfrastructureModelRequest({
    requirements: "Review existing permissions",
    proposalVersion: 6,
    catalog: {},
    existingArchitecture: context,
  });
  expect(request.toolConfig?.tools).toHaveLength(1);
  expect(
    request.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json,
  ).toHaveProperty("properties.contractVersion.const", 6);
  expect(request.messages?.[0]?.content?.[0]?.text).toContain(
    JSON.stringify(context),
  );
  expect(request.system?.[0]?.text).toContain("Read-only IAM");
  expect(request.system?.[0]?.text).toContain("Never edit policy nodes");
  expect(
    betaInfrastructureModelRequest({
      requirements: "Review",
      proposalVersion: 5,
      catalog: {},
    }).system?.[0]?.text,
  ).not.toContain("Version 6");
});
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    constructor(config: unknown) {
      configurations.push(config);
    }
    send = send;
  },
  ConverseCommand: class {
    readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));
const proposal = {
  contractVersion: 1,
  summary: "A private bucket.",
  resources: [
    {
      key: "bucket",
      serviceType: "aws.s3.bucket",
      label: "Files",
      parentKey: null,
    },
  ],
  connections: [],
  limitations: [],
};
describe("explicit beta model transport", () => {
  it("uses one fixed route, bounded output, one attempt and a response-only tool", async () => {
    send.mockResolvedValueOnce({
      stopReason: "tool_use",
      output: {
        message: {
          content: [
            { toolUse: { name: "infrastructure_proposal", input: proposal } },
          ],
        },
      },
    });
    const signal = new AbortController().signal;
    const result = await createBetaInfrastructureModel()({
      requirements: "Private files",
      catalog: { services: [] },
      signal,
    });
    expect(result).toEqual(proposal);
    expect(configurations.at(-1)).toEqual({
      region: "us-east-1",
      maxAttempts: 1,
    });
    expect(send.mock.calls.at(-1)).toMatchObject([
      {
        input: {
          modelId: BETA_INFRASTRUCTURE_MODEL_ID,
          inferenceConfig: { maxTokens: 4096, temperature: 0 },
          toolConfig: {
            toolChoice: { tool: { name: "infrastructure_proposal" } },
          },
        },
      },
      { abortSignal: signal },
    ]);
  });
  it("requires exact provider usage before a metered proposal can be delivered", async () => {
    const onUsage = vi.fn().mockResolvedValue(undefined);
    send.mockResolvedValueOnce({
      stopReason: "tool_use",
      output: {
        message: {
          content: [
            { toolUse: { name: "infrastructure_proposal", input: proposal } },
          ],
        },
      },
      usage: { inputTokens: 1200, outputTokens: 320, cacheReadInputTokens: 0 },
      $metadata: { requestId: "bedrock-request-1" },
    });
    await createBetaInfrastructureModel()({
      requirements: "Private files",
      catalog: { services: [] },
      signal: new AbortController().signal,
      onUsage,
    });
    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 1200,
      outputTokens: 320,
      cacheReadInputTokens: 0,
      providerRequestId: "bedrock-request-1",
    });
    send.mockResolvedValueOnce({
      stopReason: "tool_use",
      output: {
        message: {
          content: [
            { toolUse: { name: "infrastructure_proposal", input: proposal } },
          ],
        },
      },
      $metadata: {},
    });
    await expect(
      createBetaInfrastructureModel()({
        requirements: "Private files",
        catalog: { services: [] },
        signal: new AbortController().signal,
        onUsage,
      }),
    ).rejects.toThrow("usage");
    expect(onUsage).toHaveBeenCalledTimes(1);
  });
  it("sends approved v2 diagram context with the v2 response schema", async () => {
    const proposalV2 = {
      ...proposal,
      contractVersion: 2,
      existingResources: [{ key: "input", nodeId: "node_input" }],
    };
    send.mockResolvedValueOnce({
      stopReason: "tool_use",
      output: {
        message: {
          content: [
            { toolUse: { name: "infrastructure_proposal", input: proposalV2 } },
          ],
        },
      },
    });
    const existingArchitecture = {
      region: "us-east-1",
      resources: [
        { nodeId: "node_input", serviceType: "aws.s3.bucket", label: "Input" },
      ],
      connections: [],
    };
    expect(
      await createBetaInfrastructureModel()({
        requirements: "Add a handler",
        proposalVersion: 2,
        existingArchitecture,
        catalog: { services: [] },
        signal: new AbortController().signal,
      }),
    ).toEqual(proposalV2);
    const command = send.mock.calls.at(-1)?.[0] as {
      input: {
        messages: { content: { text: string }[] }[];
        toolConfig: {
          tools: {
            toolSpec: {
              inputSchema: {
                json: {
                  properties: {
                    contractVersion: { const: number };
                    existingResources: unknown;
                  };
                };
              };
            };
          }[];
        };
      };
    };
    expect(
      JSON.parse(command.input.messages[0]?.content[0]?.text ?? "{}"),
    ).toEqual({
      requirements: "Add a handler",
      proposalVersion: 2,
      existingArchitecture,
      catalog: { services: [] },
    });
    expect(
      command.input.toolConfig.tools[0]?.toolSpec.inputSchema.json.properties
        .contractVersion.const,
    ).toBe(2);
    expect(
      command.input.toolConfig.tools[0]?.toolSpec.inputSchema.json.properties,
    ).toHaveProperty("existingResources");
  });
  it.each(["truncated", "arbitrary-tool", "malformed"] as const)(
    "denies %s output",
    async (fault) => {
      send.mockResolvedValueOnce({
        stopReason: fault === "truncated" ? "max_tokens" : "tool_use",
        output: {
          message: {
            content: [
              {
                toolUse: {
                  name:
                    fault === "arbitrary-tool"
                      ? "execute_shell"
                      : "infrastructure_proposal",
                  input: fault === "malformed" ? {} : proposal,
                },
              },
            ],
          },
        },
      });
      await expect(
        createBetaInfrastructureModel()({
          requirements: "Files",
          catalog: {},
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow();
    },
  );
});

it("requests the v3 literal-configuration schema with a bounded larger graph", async () => {
  const v3 = {
    ...proposal,
    contractVersion: 3,
    existingResources: [],
    resources: [
      {
        key: "fsx",
        serviceType: "aws.fsx.lustre-file-system",
        label: "Shared files",
        parentKey: null,
        configuration: { storageCapacity: 1200 },
      },
    ],
  };
  send.mockResolvedValueOnce({
    stopReason: "tool_use",
    output: {
      message: {
        content: [{ toolUse: { name: "infrastructure_proposal", input: v3 } }],
      },
    },
  });
  expect(
    await createBetaInfrastructureModel()({
      requirements: "S3 file processing into FSx",
      proposalVersion: 3,
      catalog: { services: [] },
      signal: new AbortController().signal,
    }),
  ).toEqual(v3);
  const command = send.mock.calls.at(-1)?.[0] as {
    input: {
      inferenceConfig: { maxTokens: number };
      toolConfig: {
        tools: {
          toolSpec: {
            inputSchema: {
              json: {
                properties: {
                  contractVersion: { const: number };
                  resources: { maxItems: number };
                };
              };
            };
          };
        }[];
      };
    };
  };
  expect(command.input.inferenceConfig.maxTokens).toBe(6144);
  expect(
    command.input.toolConfig.tools[0]?.toolSpec.inputSchema.json.properties
      .contractVersion.const,
  ).toBe(3);
  expect(
    command.input.toolConfig.tools[0]?.toolSpec.inputSchema.json.properties
      .resources.maxItems,
  ).toBe(24);
});

it.each([
  ["AccessDeniedException", "access-denied"],
  ["ValidationException", "request-rejected"],
  ["ThrottlingException", "throttled"],
  ["PrivateProviderException", "unavailable"],
] as const)("reports only a fixed category for %s", async (name, reason) => {
  const error = new Error("private prompt and provider content");
  error.name = name;
  send.mockRejectedValueOnce(error);
  const onFailure = vi.fn();
  await expect(
    createBetaInfrastructureModel({ onFailure })({
      requirements: "Synthetic",
      catalog: {},
      signal: new AbortController().signal,
    }),
  ).rejects.toBe(error);
  expect(onFailure.mock.calls).toEqual([[reason]]);
});

it("bounds overlong display summaries without changing the infrastructure proposal", async () => {
  const overlong = {
    ...proposal,
    summary: "AWS file processing. ".repeat(200) + "😀",
  };
  send.mockResolvedValueOnce({
    stopReason: "tool_use",
    output: {
      message: {
        content: [
          { toolUse: { name: "infrastructure_proposal", input: overlong } },
        ],
      },
    },
  });
  const result = await createBetaInfrastructureModel()({
    requirements: "Synthetic",
    catalog: {},
    signal: new AbortController().signal,
  });
  expect(result.summary.length).toBeLessThanOrEqual(1500);
  expect(result.summary.endsWith("…")).toBe(true);
  expect({ ...result, summary: overlong.summary }).toEqual(overlong);
});
it("retains strict configuration and unknown-field rejection when shortening a summary", async () => {
  const invalid = {
    ...proposal,
    summary: "A".repeat(2000),
    resources: [{ ...proposal.resources[0], unapproved: "value" }],
  };
  send.mockResolvedValueOnce({
    stopReason: "tool_use",
    output: {
      message: {
        content: [
          { toolUse: { name: "infrastructure_proposal", input: invalid } },
        ],
      },
    },
  });
  await expect(
    createBetaInfrastructureModel()({
      requirements: "Synthetic",
      catalog: {},
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow();
});

it("reports only allowlisted schema fields for an invalid model response", async () => {
  const onFailure = vi.fn();
  const invalid = {
    ...proposal,
    contractVersion: 6,
    existingResources: [],
    updates: [],
    review: {
      intent: "Review",
      assumptions: [],
      checks: ["Checked"],
      questions: [],
    },
    resources: [
      {
        ...proposal.resources[0],
        "private prompt and tenant identity": "must never be logged",
      },
    ],
  };
  send.mockResolvedValueOnce({
    stopReason: "tool_use",
    output: {
      message: {
        content: [
          { toolUse: { name: "infrastructure_proposal", input: invalid } },
        ],
      },
    },
  });
  await expect(
    createBetaInfrastructureModel({ onFailure })({
      requirements: "private prompt and tenant identity",
      proposalVersion: 6,
      catalog: {},
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow();
  expect(onFailure.mock.calls).toEqual([
    ["invalid-response", { validationFields: ["resources"] }],
  ]);
});

it("selects a bounded v5 tool without changing the legacy request path", async () => {
  const v5 = {
    ...proposal,
    contractVersion: 5,
    existingResources: [],
    updates: [],
    resources: [
      { ...proposal.resources[0], configuration: { filterKeys: ["category"] } },
    ],
    review: {
      intent: "Select events",
      assumptions: [],
      checks: ["Checked filters"],
      questions: [],
    },
  };
  send.mockResolvedValueOnce({
    stopReason: "tool_use",
    output: {
      message: {
        content: [{ toolUse: { name: "infrastructure_proposal", input: v5 } }],
      },
    },
  });
  expect(
    await createBetaInfrastructureModel()({
      requirements: "Select events",
      proposalVersion: 5,
      catalog: {},
      signal: new AbortController().signal,
    }),
  ).toEqual(v5);
  const request = betaInfrastructureModelRequest({
    requirements: "Select events",
    proposalVersion: 5,
    catalog: {},
  });
  const schema = request.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json;
  expect(schema).toHaveProperty("properties.contractVersion.const", 5);
  expect(schema).toHaveProperty(
    "properties.resources.items.properties.configuration.additionalProperties.anyOf",
    expect.arrayContaining([
      {
        type: "array",
        items: { type: "string", maxLength: 256 },
        maxItems: 16,
      },
    ]),
  );
  expect(request.system?.[0]?.text).toContain("Never stringify a list");
  for (const proposalVersion of [1, 2, 3, 4] as const) {
    const legacy = betaInfrastructureModelRequest({
      requirements: "Select events",
      proposalVersion,
      catalog: {},
    });
    expect(legacy.system?.[0]?.text).not.toContain("Version 5");
    expect(
      legacy.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json,
    ).toMatchObject({
      properties: { contractVersion: { const: proposalVersion } },
    });
  }
});

// Captured from the released prompts at df8e1602.
it.each([1, 2, 3, 4] as const)(
  "retains the released v%s system instruction bytes",
  (proposalVersion) => {
    const request = betaInfrastructureModelRequest({
      requirements: "Synthetic",
      proposalVersion,
      catalog: {},
    });
    const instructions = request.system?.[0]?.text;
    if (!instructions) throw new Error("Expected system instructions");
    expect(createHash("sha256").update(instructions).digest("hex")).toBe(
      proposalVersion === 4
        ? "473933924b8f7ba942d2a3f076e28c2749d33089b392c1130ab8c56e92432a42"
        : "e0a46a7656111c63307b63f7d7f6a9ebf0b8034bb01adc81fe26e45a4105ce4e",
    );
  },
);
