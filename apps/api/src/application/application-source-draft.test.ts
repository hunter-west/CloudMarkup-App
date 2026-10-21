import {
  currentAiCanvasFixture,
  currentAiCanvasIssueFixture,
} from "./ai-canvas-context-test-helpers.js";
import { getApplicationContractRecordContentHash } from "@cloudmarkup/domain";
import { semanticAiFixture } from "./ai-semantic-context-test-helpers.js";
import type {
  BetaApplicationSource,
  createBetaApplicationSourceModel,
} from "@cloudmarkup/model-gateway";
import { describe, expect, it, vi } from "vitest";
import {
  architectureDocumentV3Schema,
  applicationContractRecordV1Schema,
  digestCanonicalValue,
} from "@cloudmarkup/schemas";
import { createNotesGenerationRequest } from "@cloudmarkup/application-generator/testing";
import {
  applicationSourceContext,
  createApplicationSourceDraftPort,
  type ApplicationSourceDraftPort,
} from "./application-source-draft.js";
function fixture() {
  const initial = createNotesGenerationRequest({
    mode: "infrastructure-only",
  }).architectureDocument;
  const workload = initial.workloadBehavior.workloads[0];
  if (!workload) throw new Error("Expected Lambda workload.");
  const purpose = applicationContractRecordV1Schema.parse({
    contractId: "cloudmarkup.test.source-purpose",
    contractVersion: "1.0.0",
    displayName: "Read notes",
    description:
      "Read the requested note using the connected database and return its text.",
    provenance: {
      source: "designed",
      sourceReferenceIds: [workload.id],
      recordedAt: "2026-09-21T00:00:00.000Z",
      recordedBy: "principal_source",
    },
    contractKind: "behavior-operation",
    capability: "cloudmarkup.application.describe-purpose",
    input: { kind: "none" },
    output: { kind: "none" },
    failureOutcomes: [],
  });
  const document = architectureDocumentV3Schema.parse({
    ...initial,
    applicationContracts: {
      ...initial.applicationContracts,
      contracts: [purpose],
    },
    workloadBehavior: {
      ...initial.workloadBehavior,
      workloads: [
        {
          ...workload,
          behaviorContracts: [
            {
              contractId: purpose.contractId,
              contractVersion: purpose.contractVersion,
              contractKind: "behavior-operation",
              digest: getApplicationContractRecordContentHash(purpose),
            },
          ],
        },
      ],
    },
  });
  const response = {
    contractVersion: 1 as const,
    workloads: [
      {
        workloadId: workload.id,
        handler:
          "export async function handler() { return { statusCode: 200 }; }\n",
        tests:
          "import { test } from 'node:test';\nimport { handler } from './index.mjs';\ntest('handler', async () => { await handler(); });\n",
        notes: "Review the database binding and implement error handling.",
      },
    ],
  };
  const model = vi
      .fn<ReturnType<typeof createBetaApplicationSourceModel>>()
      .mockResolvedValue(response),
    authorize = vi.fn().mockResolvedValue(undefined),
    saved = new Map<string, unknown>();
  const cache = {
    read: vi.fn((key: string) => Promise.resolve(saved.get(key))),
    write: vi.fn((key: string, value: unknown) => {
      saved.set(key, value);
      return Promise.resolve();
    }),
  };
  const port = createApplicationSourceDraftPort({ model, authorize, cache });
  const input = {
    request: {
      applicationSource: "ai-source-draft-v1",
      subject: {
        kind: "solution-revision",
        solutionRevisionId: "solution_revision_source",
        manifestRecordId: "manifest_source",
        manifestDigest: digestCanonicalValue(document),
      },
    },
    sources: { architectureDocument: document },
    signal: new AbortController().signal,
  } as Parameters<ApplicationSourceDraftPort["generate"]>[0];
  return { document, response, model, authorize, cache, port, input };
}
it("source-v3 generation captures immutable contracts and packages unexecuted review-required content with a distinct producer", async () => {
  const f = fixture();
  const document = semanticAiFixture();
  f.model.mockResolvedValue({
    contractVersion: 3,
    workloads: f.response.workloads.map((workload) => ({
      ...workload,
      review: {
        purposeCoverage: "Reviewed declared operations and schemas",
        configurationChecks: ["Queue trigger and resource references"],
        risks: ["Source is not executed"],
        testPlan: ["Run contract tests independently"],
      },
    })),
  });
  const files = await f.port.generate({
    ...f.input,
    request: { ...f.input.request, applicationSource: "ai-source-draft-v3" },
    sources: { ...f.input.sources, architectureDocument: document },
  });
  const captured = f.model.mock.calls[0]?.[0];
  expect(captured?.semantic).toBe(true);
  expect(captured?.context).toEqual(applicationSourceContext(document, 3));
  expect(
    files.every(
      (file) =>
        file.ownership === "ai-generated-review-required" &&
        file.provenance.producer.version === "3.0.0",
    ),
  ).toBe(true);
  expect(files.at(-1)?.content.value).toContain(
    "have not been executed or built",
  );
  expect(JSON.stringify(captured?.context)).not.toContain(
    "synthetic_secret_locator_never_shared",
  );
  expect(
    await f.port.generate({
      ...f.input,
      request: { ...f.input.request, applicationSource: "ai-source-draft-v3" },
      sources: { ...f.input.sources, architectureDocument: document },
    }),
  ).toEqual(files);
  expect(f.model).toHaveBeenCalledTimes(1);
});
describe("opt-in immutable application source", () => {
  it("sends purpose and relationships without configuration or source, packages fixed paths and reuses retained bytes", async () => {
    const f = fixture();
    const files = await f.port.generate(f.input);
    expect(await f.port.generate(f.input)).toEqual(files);
    expect(f.model).toHaveBeenCalledTimes(1);
    const context = applicationSourceContext(f.document);
    expect(f.model.mock.calls[0]?.[0].context).toEqual(context);
    expect(context.workloads[0]?.relatedConnections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "incoming",
          targetNodeId: context.workloads[0]?.nodeId,
        }),
      ]),
    );
    expect(JSON.stringify(context)).not.toContain('"configuration"');
    expect(context).not.toHaveProperty("applicationContracts");
    expect(files).toHaveLength(4);
    expect(
      files.every(
        (file) =>
          file.ownership === "ai-generated-review-required" &&
          file.path.startsWith("application/ai-drafts/") &&
          file.provenance.solutionRevisionId === "solution_revision_source",
      ),
    ).toBe(true);
    expect(files.at(-1)?.content.value).toContain(
      "have not been executed or built",
    );
  });
  it("validates and stores a metered draft before reporting its charge, then reuses the cache", async () => {
    const f = fixture();
    const model = vi
      .fn()
      .mockImplementation(
        async (input: {
          onUsage?: (usage: {
            inputTokens: number;
            outputTokens: number;
            cacheReadInputTokens: number;
          }) => Promise<void>;
        }) => {
          await input.onUsage?.({
            inputTokens: 1200,
            outputTokens: 800,
            cacheReadInputTokens: 0,
          });
          return f.response;
        },
      );
    const write = vi.fn(async (key: string, value: unknown) => {
      await f.cache.write(key, value);
      return { objectId: "object_source_test", contentSha256: "a".repeat(64) };
    });
    const generate = vi.fn(
      async (input: {
        invoke: (
          onUsage: (usage: {
            inputTokens: number;
            outputTokens: number;
            cacheReadInputTokens: number;
          }) => Promise<void>,
        ) => Promise<BetaApplicationSource>;
        persist: (
          value: BetaApplicationSource,
        ) => Promise<{ objectId: string; contentSha256: string }>;
      }) => {
        let usage: unknown;
        const response = await input.invoke((value) => {
          usage = value;
          return Promise.resolve();
        });
        expect(usage).toMatchObject({ inputTokens: 1200, outputTokens: 800 });
        expect(await input.persist(response)).toEqual({
          objectId: "object_source_test",
          contentSha256: "a".repeat(64),
        });
        return response;
      },
    );
    const onCacheHit = vi.fn().mockResolvedValue(undefined);
    const port = createApplicationSourceDraftPort({
      model,
      authorize: f.authorize,
      cache: { read: f.cache.read, write },
      credits: { generate, onCacheHit },
    });
    await port.generate(f.input);
    await port.generate(f.input);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(onCacheHit).toHaveBeenCalledTimes(1);
    expect(model).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("requires explicit opt-in and a useful workload purpose before invoking the model", async () => {
    const f = fixture();
    await expect(
      f.port.generate({
        ...f.input,
        request: { ...f.input.request, applicationSource: undefined },
      }),
    ).rejects.toThrow("not requested");
    expect(() =>
      applicationSourceContext({
        ...f.document,
        applicationContracts: {
          ...f.document.applicationContracts,
          contracts: [],
        },
      }),
    ).toThrow();
    expect(f.model).not.toHaveBeenCalled();
  });
  it("rejects missing or substituted workloads without publishing source", async () => {
    const f = fixture();
    f.model.mockResolvedValue({
      ...f.response,
      workloads: f.response.workloads.map((w) => ({
        ...w,
        workloadId: "workload_other",
      })),
    });
    await expect(f.port.generate(f.input)).rejects.toThrow("match");
    expect(f.cache.write).not.toHaveBeenCalled();
  });
  it("rejects revoked authority after generation and never retains its output", async () => {
    const f = fixture();
    f.authorize
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Access revoked"));
    await expect(f.port.generate(f.input)).rejects.toThrow("revoked");
    expect(f.cache.write).not.toHaveBeenCalled();
  });
  it("does not publish output after cancellation", async () => {
    const f = fixture(),
      controller = new AbortController();
    f.model.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(f.response);
    });
    await expect(
      f.port.generate({ ...f.input, signal: controller.signal }),
    ).rejects.toThrow();
    expect(f.cache.write).not.toHaveBeenCalled();
  });
});

it("v2 uses immutable configuration and packages advisory review; v1 stays minimized", async () => {
  const f = fixture();
  const review = {
    purposeCoverage: "Read the requested note",
    configurationChecks: ["Use the configured table key"],
    risks: ["Confirm missing-note behavior"],
    testPlan: ["Exercise missing and found notes"],
  };
  f.model.mockResolvedValue({
    ...f.response,
    contractVersion: 2,
    workloads: f.response.workloads.map((w) => ({ ...w, review })),
  });
  const current = currentAiCanvasFixture();
  const document = architectureDocumentV3Schema.parse({
    ...current,
    workloadBehavior: f.document.workloadBehavior,
    applicationContracts: f.document.applicationContracts,
  });
  const files = await f.port.generate({
    ...f.input,
    sources: { ...f.input.sources, architectureDocument: document },
    request: { ...f.input.request, applicationSource: "ai-source-draft-v2" },
  });
  const context = f.model.mock.calls[0]?.[0].context;
  expect(context).toHaveProperty("contextVersion", 2);
  expect(JSON.stringify(context)).toContain('"configuration"');
  expect(
    files.find(
      (file) =>
        file.path.endsWith("/README.md") &&
        file.provenance.sourceReferences.some((r) => r.kind === "workload"),
    )?.content.value,
  ).toContain("advisory, not execution evidence");
});
it("passes immutable reviewed trigger configuration, stable edge identities and ports through source generation and export provenance", async () => {
  const f = fixture();
  const document = architectureDocumentV3Schema.parse({
    ...currentAiCanvasIssueFixture(),
    workloadBehavior: f.document.workloadBehavior,
    applicationContracts: f.document.applicationContracts,
  });
  const before = structuredClone(document);
  f.model.mockResolvedValue({
    ...f.response,
    contractVersion: 2,
    workloads: f.response.workloads.map((w) => ({
      ...w,
      review: {
        purposeCoverage: "Review the selected trigger",
        configurationChecks: ["Check the batching window"],
        risks: ["Resolve validation findings before deployment"],
        testPlan: ["Exercise multiple queue records"],
      },
    })),
  });
  const files = await f.port.generate({
    ...f.input,
    request: { ...f.input.request, applicationSource: "ai-source-draft-v2" },
    sources: { ...f.input.sources, architectureDocument: document },
  });
  const context = f.model.mock.calls[0]?.[0].context as ReturnType<
    typeof applicationSourceContext
  >;
  const edge = document.edges[0];
  expect(context.workloads[0]?.relatedConnections).toContainEqual(
    expect.objectContaining({
      edgeId: edge?.id,
      sourcePort: edge?.semantic.source.port,
      targetPort: edge?.semantic.target.port,
      sourcePath: "$.edges[0]",
      direction: "incoming",
      configuration: {
        batchSize: 10,
        batchingWindowSeconds: 0,
        maximumConcurrency: 10,
        partialBatchResponse: true,
        deliverySemantics: "AT_LEAST_ONCE",
      },
    }),
  );
  expect(context.connections[0]).toMatchObject({ edgeId: edge?.id });
  const queue = context.resources.find(
    (r) => r.nodeId === "node_affected_queue",
  );
  expect(
    queue && "configuration" in queue ? queue.configuration : undefined,
  ).toHaveProperty("visibilityTimeoutSeconds", 60);
  expect(
    files.every((file) => file.ownership === "ai-generated-review-required"),
  ).toBe(true);
  expect(
    files.find((file) => file.path === "application/ai-drafts/README.md")
      ?.content.value,
  ).toContain("have not been executed or built");
  expect(document).toEqual(before);
});

it("rejects a v2 source response without review before retaining or charging it", async () => {
  const f = fixture();
  const document = architectureDocumentV3Schema.parse({
    ...currentAiCanvasFixture(),
    workloadBehavior: f.document.workloadBehavior,
    applicationContracts: f.document.applicationContracts,
  });
  await expect(
    f.port.generate({
      ...f.input,
      sources: { ...f.input.sources, architectureDocument: document },
      request: { ...f.input.request, applicationSource: "ai-source-draft-v2" },
    }),
  ).rejects.toThrow("review");
  expect(f.model).toHaveBeenCalledTimes(1);
  expect(f.cache.write).not.toHaveBeenCalled();
});

it("rejects unsupported source runtime before invoking or retaining AI output", async () => {
  const f = fixture();
  const current = currentAiCanvasFixture();
  const document = architectureDocumentV3Schema.parse({
    ...current,
    nodes: current.nodes.map((node) => ({
      ...node,
      semantic: {
        ...node.semantic,
        configuration: {
          ...node.semantic.configuration,
          values: {
            ...node.semantic.configuration.values,
            runtime: { kind: "string", value: "python3.13" },
          },
        },
      },
    })),
    workloadBehavior: f.document.workloadBehavior,
    applicationContracts: f.document.applicationContracts,
  });
  await expect(
    f.port.generate({
      ...f.input,
      sources: { ...f.input.sources, architectureDocument: document },
      request: { ...f.input.request, applicationSource: "ai-source-draft-v2" },
    }),
  ).rejects.toThrow("Node.js 24");
  expect(f.model).not.toHaveBeenCalled();
  expect(f.cache.write).not.toHaveBeenCalled();
});

it("rejects a reviewed response stored under a legacy source cache identity", async () => {
  const f = fixture();
  f.cache.read.mockResolvedValue({
    ...f.response,
    contractVersion: 2,
    workloads: f.response.workloads.map((w) => ({
      ...w,
      review: {
        purposeCoverage: "Review the requested purpose",
        configurationChecks: ["Match the table key"],
        risks: [],
        testPlan: ["Exercise the handler"],
      },
    })),
  });
  await expect(f.port.generate(f.input)).rejects.toThrow("match");
  expect(f.model).not.toHaveBeenCalled();
  expect(f.cache.write).not.toHaveBeenCalled();
});
