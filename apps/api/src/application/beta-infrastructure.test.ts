import { betaInfrastructureModelRequest } from "@cloudmarkup/model-gateway";
import {
  architectureDocumentV3Schema,
  configurationKeySchema,
  deploymentKeySchema,
  digestCanonicalValue,
  nodeIdSchema,
  parseGraphCommandV1,
  sha256DigestSchema,
  serviceTypeSchema,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";
import { createProductionInitialDocument } from "../production-initial-document.js";
import { currentAiCanvasIssueFixture } from "./ai-canvas-context-test-helpers.js";
import { aiCanvasContextSchema } from "./ai-canvas-context.js";
import { createInitialArchitectureDocument } from "./architecture-document-storage.js";
import {
  createBetaInfrastructureApplication,
  preparedBetaInfrastructureInputSchema,
} from "./beta-infrastructure.js";
import { ApplicationError } from "./errors.js";
import type { CloudMarkupApplication, PrincipalContext } from "./ports.js";
type CanvasModelTestInput = Parameters<
  typeof betaInfrastructureModelRequest
>[0] & {
  catalog: {
    services: {
      id: string;
      configuration: { properties: Record<string, unknown> };
    }[];
  };
};
it("v6 cannot reserve or invoke without the reviewed applicability host", async () => {
  const f = fixture(true, true);
  await expect(
    f.app.propose(
      f.principal,
      "project_beta_test",
      { ...f.request, proposalVersion: 6 },
      '"draft:v1"',
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "service_unavailable" });
  expect(f.model).not.toHaveBeenCalled();
});
it("v6 baseline denial is before credit reservation and model dispatch", async () => {
  const f = fixture(true, true);
  const execute = vi.fn(() => Promise.reject(new Error("must not reserve")));
  const readBaseline = vi.fn(() =>
    Promise.reject(new ApplicationError("access_denied", "actor revoked")),
  );
  const app = createBetaInfrastructureApplication({
    application: {
      getProject: f.getProject,
      getDraft: f.getDraft,
      getCurrentPrincipal: f.getCurrentPrincipal,
    },
    model: f.model,
    creditMeter: { execute },
    applicability: {
      preparer: {
        prepare: () => {
          throw new Error("must not prepare");
        },
      },
      forPrincipal: (principal, ownership) => {
        expect(principal).toBe(f.principal);
        expect(ownership).toEqual({
          organizationId: "org_beta_test",
          projectId: "project_beta_test",
        });
        return readBaseline;
      },
    },
  });
  await expect(
    app.propose(
      f.principal,
      "project_beta_test",
      { ...f.request, proposalVersion: 6 },
      '"draft:v1"',
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "access_denied" });
  expect(readBaseline).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  expect(f.model).not.toHaveBeenCalled();
});

it.each(["invalid-repair", "questions"])(
  "v6 %s completes proof before the meter can accept delivery",
  async (kind) => {
    const f = fixture(true, true);
    const architectureDocument = currentAiCanvasIssueFixture();
    f.getDraft.mockResolvedValue({
      etag: '"draft:v1"',
      value: { architectureDocument, id: "draft_beta_test", version: 1 },
    } as Awaited<ReturnType<CloudMarkupApplication["getDraft"]>>);
    const context = (
      await import("./ai-semantic-context.js")
    ).projectAiSemanticContextV3(architectureDocument);
    const finding = context.validation.findings.find(
      (item) => item.code === "aws.validation.sqs-visibility-timeout-conflict",
    );
    if (!finding?.affectedEntities)
      throw new Error("Missing selected queue finding.");
    const selectedIssue = {
      code: finding.code,
      affected: finding.affectedEntities.map((item) => ({
        ...(item.nodeId ? { nodeId: item.nodeId } : {}),
        ...(item.edgeId ? { edgeId: item.edgeId } : {}),
        fieldPath: item.path.replace(/^\$\.(?:nodes|edges)\[\d+\]/u, ""),
      })),
    };
    const events: string[] = [];
    const creditMeter: NonNullable<
      Parameters<typeof createBetaInfrastructureApplication>[0]["creditMeter"]
    > = {
      async execute(input) {
        events.push("reserved");
        try {
          const result = await input.run(() => {
            events.push("usage-observed");
            return Promise.resolve();
          });
          events.push("settled");
          return result;
        } catch (error) {
          events.push("released");
          throw error;
        }
      },
    };
    f.model.mockImplementation(
      async (input: {
        onUsage?: (usage: {
          inputTokens: number;
          outputTokens: number;
          cacheReadInputTokens: number;
        }) => Promise<void>;
      }) => {
        await input.onUsage?.({
          inputTokens: 50,
          outputTokens: 20,
          cacheReadInputTokens: 0,
        });
        return {
          contractVersion: 6,
          summary: "Review queue delivery.",
          resources: [],
          connections: [],
          existingResources: [{ key: "queue", nodeId: "node_affected_queue" }],
          updates:
            kind === "questions"
              ? []
              : [
                  {
                    resourceKey: "queue",
                    configuration: { visibilityTimeoutSeconds: 30 },
                    reason: "A claimed repair",
                  },
                ],
          limitations: [],
          review: {
            intent: "Review queue visibility",
            assumptions: [],
            checks: ["Compared timeout settings"],
            questions:
              kind === "questions"
                ? ["Which processing timeout is required?"]
                : [],
          },
        };
      },
    );
    const readBaseline = vi.fn(
      (input: {
        ownership: { organizationId: string; projectId?: string | undefined };
        subject: { draftId: string };
      }) => {
        expect(input.ownership).toEqual({
          organizationId: "org_beta_test",
          projectId: "project_beta_test",
        });
        expect(input.subject.draftId).toBe("draft_beta_test");
        return Promise.resolve(architectureDocument);
      },
    );
    const app = createBetaInfrastructureApplication({
      application: {
        getProject: f.getProject,
        getDraft: f.getDraft,
        getCurrentPrincipal: f.getCurrentPrincipal,
      },
      model: f.model,
      creditMeter,
      applicability: {
        readBaseline,
        preparer: {
          prepare(input) {
            events.push("proof");
            const node = input.document.nodes.find(
              (item) => item.id === "node_affected_queue",
            );
            if (!node) throw new Error("Missing queue.");
            return parseGraphCommandV1({
              schemaVersion: 1,
              commandId: input.createId(),
              inverseCommandId: input.createId(),
              origin: "user",
              target: {
                architectureId: input.document.architectureId,
                documentId: input.document.documentId,
                revisionId: input.document.revision.revisionId,
              },
              kind: "update-node-configuration",
              nodeId: node.id,
              expectedConfiguration: node.semantic.configuration,
              configuration: {
                ...node.semantic.configuration,
                values: {
                  ...node.semantic.configuration.values,
                  visibilityTimeoutSeconds: { kind: "integer", value: 30 },
                },
              },
            });
          },
        },
      },
    });
    const prepared = await app.prepare(
      f.principal,
      "project_beta_test",
      { ...f.request, architectureDocument, proposalVersion: 6, selectedIssue },
      '"draft:v1"',
    );
    for (const field of [
      "configurationProjectionVersion",
      "modelInputBytes",
    ] as const) {
      const incomplete = Object.fromEntries(
        Object.entries(prepared.request).filter(([key]) => key !== field),
      );
      expect(
        preparedBetaInfrastructureInputSchema.safeParse(incomplete).success,
      ).toBe(false);
    }
    expect(events).toEqual([]);
    const run = app.propose(
      f.principal,
      "project_beta_test",
      { ...f.request, architectureDocument, proposalVersion: 6, selectedIssue },
      '"draft:v1"',
      new AbortController().signal,
    );
    if (kind === "invalid-repair") {
      await expect(run).rejects.toMatchObject({ code: "service_unavailable" });
      expect(events).toEqual([
        "reserved",
        "usage-observed",
        "proof",
        "released",
      ]);
    } else {
      const result = await run;
      expect(result.applicability?.kind).toBe("questions-or-assessment");
      expect(events).toEqual(["reserved", "usage-observed", "settled"]);
    }
    expect(readBaseline.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(f.model.mock.calls[0]?.[0]).toMatchObject({
      proposalVersion: 6,
      existingArchitecture: (
        await import("./ai-semantic-context.js")
      ).projectAiSemanticContextV3(architectureDocument, selectedIssue),
    });
  },
);
const proposal = {
  contractVersion: 1 as const,
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
  limitations: ["No application code is generated."],
};
function fixture(blank = true, production = false) {
  const principal: PrincipalContext = {
    principalId: "principal_beta_test",
    sessionId: "session_beta",
    correlationId: "correlation_beta",
    authenticationSource: "test",
    authenticatedAt: "2026-09-17T00:00:00.000Z",
    expiresAt: "2099-09-17T00:00:00.000Z",
  };
  const architectureDocument = (
    production
      ? createProductionInitialDocument
      : createInitialArchitectureDocument
  )({
    identity: {
      architectureId: "architecture_beta_test",
      documentId: "document_beta_test",
      draftId: "draft_beta_test",
      revisionId: "revision_beta_test",
      principalId: principal.principalId,
    },
    createdAt: principal.authenticatedAt,
    blank,
    infrastructureOnly: true,
  });
  const request = {
    contractVersion: 1 as const,
    requirements: "A private bucket for my files",
    architectureDocument,
  };
  const getProject = vi
    .fn<CloudMarkupApplication["getProject"]>()
    .mockResolvedValue({
      etag: '"project:v1"',
      value: { organizationId: "org_beta_test", lifecycleStatus: "active" },
    } as Awaited<ReturnType<CloudMarkupApplication["getProject"]>>);
  const getDraft = vi
    .fn<CloudMarkupApplication["getDraft"]>()
    .mockResolvedValue({
      etag: '"draft:v1"',
      value: { architectureDocument, id: "draft_beta_test", version: 1 },
    } as Awaited<ReturnType<CloudMarkupApplication["getDraft"]>>);
  const getCurrentPrincipal = vi
    .fn<CloudMarkupApplication["getCurrentPrincipal"]>()
    .mockResolvedValue({
      id: principal.principalId,
      organizationContexts: [
        { organizationId: "org_beta_test", capabilities: ["projects.mutate"] },
      ],
    } as Awaited<ReturnType<CloudMarkupApplication["getCurrentPrincipal"]>>);
  const model = vi.fn().mockResolvedValue(proposal);
  const app = createBetaInfrastructureApplication({
    application: { getProject, getDraft, getCurrentPrincipal },
    model,
  });
  const run = (etag = '"draft:v1"', signal = new AbortController().signal) =>
    app.propose(principal, "project_beta_test", request, etag, signal);
  return {
    principal,
    app,
    request,
    getProject,
    getDraft,
    getCurrentPrincipal,
    model,
    run,
  };
}
describe("authorized functional beta proposal", () => {
  it("sends only the approved diagram projection for v2 and preserves v1 requests", async () => {
    const f = fixture();
    f.model.mockResolvedValue({
      ...proposal,
      contractVersion: 2,
      existingResources: [],
    });
    await f.app.propose(
      f.principal,
      "project_beta_test",
      { ...f.request, proposalVersion: 2 },
      '"draft:v1"',
      new AbortController().signal,
    );
    expect(f.model.mock.calls[0]?.[0]).toMatchObject({
      proposalVersion: 2,
      existingArchitecture: {
        region: f.request.architectureDocument.provider.region,
        resources: [],
        connections: [],
      },
    });
    expect(f.model.mock.calls[0]?.[0]).not.toHaveProperty(
      "architectureDocument",
    );
    const legacy = fixture();
    await legacy.run();
    expect(legacy.model.mock.calls[0]?.[0]).not.toHaveProperty(
      "existingArchitecture",
    );
  });
  it("projects only approved fields from a nonempty local diagram", async () => {
    const f = fixture(false);
    const document = f.request.architectureDocument;
    document.nodes.forEach((node, index) => {
      node.semantic.serviceType = serviceTypeSchema.parse(
        index === 0
          ? "aws.s3.bucket"
          : index === 1
            ? "aws.lambda.function"
            : "example.unsupported",
      );
      node.semantic.configuration.values[
        configurationKeySchema.parse("privateValue")
      ] = {
        kind: "string",
        value: "must-never-leave-the-application",
      };
    });
    f.model.mockResolvedValue({
      ...proposal,
      contractVersion: 2,
      existingResources: [],
    });
    await f.app.propose(
      f.principal,
      "project_beta_test",
      { ...f.request, proposalVersion: 2 },
      '"draft:v1"',
      new AbortController().signal,
    );
    const dispatched = f.model.mock.calls[0]?.[0] as {
      existingArchitecture: unknown;
    };
    expect(dispatched.existingArchitecture).toEqual({
      region: document.provider.region,
      resources: document.nodes.slice(0, 2).map((node) => ({
        nodeId: node.id,
        serviceType: node.semantic.serviceType,
        label: node.presentation.label,
      })),
      connections: [
        {
          sourceNodeId: "node_api",
          targetNodeId: "node_handler",
          relationshipType: "example.relationship.invokes",
        },
      ],
    });
    expect(JSON.stringify(dispatched)).not.toContain(
      "must-never-leave-the-application",
    );
    expect(dispatched).not.toHaveProperty("workloadBehavior");
    expect(dispatched).not.toHaveProperty("applicationContracts");
  });
  it("rejects credential-like resource labels before sending context", async () => {
    const f = fixture(false);
    const node = f.request.architectureDocument.nodes[0];
    if (!node) throw new Error("Missing synthetic resource");
    node.semantic.serviceType = serviceTypeSchema.parse("aws.s3.bucket");
    node.presentation.label = "AKIA" + "ABCDEFGHIJKLMNOP";
    await expect(
      f.app.propose(
        f.principal,
        "project_beta_test",
        { ...f.request, proposalVersion: 2 },
        '"draft:v1"',
        new AbortController().signal,
      ),
    ).rejects.toThrow("Remove credentials");
    expect(f.model).not.toHaveBeenCalled();
  });
  it("rejects oversized diagram context before provider dispatch", async () => {
    const f = fixture(false);
    const first = f.request.architectureDocument.nodes[0];
    if (!first) throw new Error("Missing synthetic resource");
    first.semantic.serviceType = serviceTypeSchema.parse("aws.s3.bucket");
    f.request.architectureDocument.nodes.push(
      ...Array.from({ length: 100 }, (_, index) => ({
        ...first,
        id: nodeIdSchema.parse("node_limit_" + String(index)),
        semantic: {
          ...first.semantic,
          deploymentKey: deploymentKeySchema.parse("limit_" + String(index)),
        },
      })),
    );
    await expect(
      f.app.propose(
        f.principal,
        "project_beta_test",
        { ...f.request, proposalVersion: 2 },
        '"draft:v1"',
        new AbortController().signal,
      ),
    ).rejects.toThrow("100 editable resources");
    expect(f.model).not.toHaveBeenCalled();
  });
  it("rejects fabricated existing resource IDs and mismatched response versions", async () => {
    const f = fixture();
    f.model.mockResolvedValue({
      ...proposal,
      contractVersion: 2,
      existingResources: [{ key: "existing", nodeId: "foreign_node" }],
    });
    const run = () =>
      f.app.propose(
        f.principal,
        "project_beta_test",
        { ...f.request, proposalVersion: 2 },
        '"draft:v1"',
        new AbortController().signal,
      );
    await expect(run()).rejects.toThrow("unavailable resource");
    f.model.mockResolvedValue(proposal);
    await expect(run()).rejects.toThrow("incompatible");
  });

  it("binds the actual local baseline, uses a fixed catalog, and rechecks authority without saving", async () => {
    const f = fixture();
    expect(await f.run()).toEqual({
      contractVersion: 1,
      architectureDigest: digestCanonicalValue(f.request.architectureDocument),
      proposal,
    });
    expect(f.getDraft).toHaveBeenCalledTimes(3);
    expect(f.model).toHaveBeenCalledTimes(1);
    expect(f.model.mock.calls[0]?.[0]).toMatchObject({
      requirements: f.request.requirements,
    });
    expect(f.model.mock.calls[0]?.[0]).not.toHaveProperty(
      "architectureDocument",
    );
  });
  it.each(["cross-tenant", "read-only", "stale", "expired"] as const)(
    "denies %s before provider dispatch",
    async (fault) => {
      const f = fixture();
      if (fault === "cross-tenant")
        f.getProject.mockRejectedValue(
          new ApplicationError("not_found", "Unavailable."),
        );
      if (fault === "read-only")
        f.getCurrentPrincipal.mockResolvedValue({
          displayName: "Read-only test",
          id: "principal_beta_test",
          resourceVersion: 1,
          organizationContexts: [],
        });
      if (fault === "expired")
        Object.assign(f.principal, { expiresAt: "2020-01-01T00:00:00.000Z" });
      await expect(
        f.run(fault === "stale" ? '"draft:v0"' : undefined),
      ).rejects.toThrow();
      expect(f.model).not.toHaveBeenCalled();
    },
  );
  it("rejects access revocation after inference", async () => {
    const f = fixture();
    f.model.mockImplementationOnce(() => {
      f.getProject.mockRejectedValue(
        new ApplicationError("access_denied", "Revoked."),
      );
      return Promise.resolve(proposal);
    });
    await expect(f.run()).rejects.toThrow("Revoked");
  });
  it("rejects malformed output and cancellation without emitting a proposal", async () => {
    const f = fixture();
    f.model.mockResolvedValue({ summary: "Incomplete" });
    await expect(f.run()).rejects.toThrow("could not finish");
    const cancelled = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(cancelled.run(undefined, controller.signal)).rejects.toThrow();
  });
});

it("opts v3 into FSx and network schemas without disclosing stored configuration", async () => {
  const f = fixture();
  f.model.mockResolvedValue({
    ...proposal,
    contractVersion: 3,
    existingResources: [],
  });
  await f.app.propose(
    f.principal,
    "project_beta_test",
    { ...f.request, proposalVersion: 3 },
    '"draft:v1"',
    new AbortController().signal,
  );
  const input: unknown = f.model.mock.calls[0]?.[0];
  expect(input).toHaveProperty(
    "catalog.services",
    expect.arrayContaining([
      expect.objectContaining({
        id: "aws.fsx.lustre-file-system",
      }),
      expect.objectContaining({ id: "aws.ec2.route-table-association" }),
    ]),
  );
  expect(input).not.toHaveProperty(
    "catalog.services",
    expect.arrayContaining([
      expect.objectContaining({ id: "aws.iam.policy-document" }),
    ]),
  );
  expect(input).toHaveProperty("existingArchitecture", {
    region: f.request.architectureDocument.provider.region,
    resources: [],
    connections: [],
  });
  expect(input).not.toHaveProperty("architectureDocument");
});

it("v4 includes reviewed context and estimates the complete model input", async () => {
  const f = fixture(true, true);
  const prepared = await f.app.prepare(
    f.principal,
    "project_beta_test",
    { ...f.request, proposalVersion: 4 },
    '"draft:v1"',
  );
  expect(prepared.request.existingArchitecture).toHaveProperty(
    "contextVersion",
    2,
  );
  expect(prepared.request.existingArchitecture).toHaveProperty(
    "validation.status",
    "complete",
  );
  expect(prepared.request.modelInputBytes).toBeGreaterThan(
    JSON.stringify(prepared.request.existingArchitecture).length +
      f.request.requirements.length,
  );
  const legacy = await f.app.prepare(
    f.principal,
    "project_beta_test",
    f.request,
    '"draft:v1"',
  );
  expect(legacy.request).not.toHaveProperty("modelInputBytes");
});

const listProposal = {
  contractVersion: 5 as const,
  summary: "Select the requested events.",
  resources: [
    {
      key: "rule",
      serviceType: "aws.eventbridge.rule",
      label: "Selected events",
      parentKey: null,
      configuration: {
        detailTypes: ["Application Event"],
        sourceKinds: ["cloudmarkup.application"],
        filterKeys: ["category"],
      },
    },
    {
      key: "subscription",
      serviceType: "aws.sns.subscription",
      label: "Selected messages",
      parentKey: null,
      configuration: {
        filterKeys: ["category"],
        filterScope: "MESSAGE_ATTRIBUTES",
      },
    },
  ],
  existingResources: [],
  connections: [],
  updates: [],
  limitations: [],
  review: {
    intent: "Select events",
    assumptions: [],
    checks: ["Compared requested filters"],
    questions: [],
  },
};

async function preparedListFixture() {
  const f = fixture(true, true);
  const prepared = await f.app.prepare(
    f.principal,
    "project_beta_test",
    { ...f.request, proposalVersion: 5 },
    '"draft:v1"',
  );
  f.model.mockResolvedValue(listProposal);
  return {
    ...f,
    prepared,
    generate: () =>
      f.app.generate(prepared.request, new AbortController().signal, () =>
        Promise.resolve(),
      ),
  };
}

it("v5 admits all four audited lists, advertises exact field limits and meters the full request", async () => {
  const f = await preparedListFixture();
  expect(await f.generate()).toHaveProperty("proposal", listProposal);
  const modelInput = f.model.mock.calls[0]?.[0] as Parameters<
    typeof betaInfrastructureModelRequest
  >[0] & {
    catalog: {
      services: {
        id: string;
        configuration: { properties: Record<string, unknown> };
      }[];
    };
  };
  expect(f.prepared.request.modelInputBytes).toBe(
    new TextEncoder().encode(
      JSON.stringify(betaInfrastructureModelRequest(modelInput)),
    ).length,
  );
  expect(modelInput.existingArchitecture).toHaveProperty("contextVersion", 2);
  const rule = modelInput.catalog.services.find(
    (s: { id: string }) => s.id === "aws.eventbridge.rule",
  );
  if (!rule) throw new Error("Expected rule capability");
  expect(rule.configuration.properties["detailTypes"]).toMatchObject({
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
    items: {
      type: "string",
      maxLength: 256,
      enum: ["Object Created", "Object Deleted", "Application Event"],
    },
  });
  expect(rule.configuration.properties["sourceKinds"]).toMatchObject({
    minItems: 1,
    maxItems: 2,
  });
  expect(rule.configuration.properties["filterKeys"]).toMatchObject({
    maxItems: 8,
  });
});

it("passes grounded configuration and connections from the exact prepared snapshot into model input", async () => {
  const f = fixture(true, true);
  const graph = currentAiCanvasIssueFixture();
  f.request.architectureDocument = architectureDocumentV3Schema.parse({
    ...f.request.architectureDocument,
    nodes: graph.nodes,
    edges: graph.edges,
  });
  const prepared = await f.app.prepare(
    f.principal,
    "project_beta_test",
    { ...f.request, proposalVersion: 5 },
    '"draft:v1"',
  );
  const snapshot = structuredClone(prepared.request.existingArchitecture);
  f.model.mockResolvedValue({
    ...listProposal,
    resources: [],
    connections: [],
    review: {
      ...listProposal.review,
      checks: ["Review the immutable queue settings"],
    },
  });
  await f.app.generate(prepared.request, new AbortController().signal, () =>
    Promise.resolve(),
  );
  const input = f.model.mock.calls[0]?.[0] as CanvasModelTestInput;
  const context = aiCanvasContextSchema.parse(input.existingArchitecture);
  expect(context).toEqual(snapshot);
  expect(
    input.catalog.services.find(
      (service: { id: string }) =>
        service.id === "aws.cognito.user-pool-client",
    )?.configuration.properties,
  ).toHaveProperty(
    "generateClientSecret",
    expect.objectContaining({ const: false }),
  );
  expect(
    context.resources.find(
      (resource) => resource.nodeId === "node_affected_queue",
    ),
  ).toMatchObject({
    nodeId: "node_affected_queue",
    sourcePath: "$.nodes[2]",
    configuration: { visibilityTimeoutSeconds: 60 },
  });
  expect(
    context.connections.find(
      (connection) => connection.edgeId === "edge_affected_trigger",
    ),
  ).toMatchObject({
    edgeId: "edge_affected_trigger",
    sourcePort: graph.edges[0]?.semantic.source.port,
    targetPort: graph.edges[0]?.semantic.target.port,
    configuration: { batchingWindowSeconds: 0 },
  });
  expect(prepared.request.modelInputBytes).toBe(
    new TextEncoder().encode(
      JSON.stringify(betaInfrastructureModelRequest(input)),
    ).length,
  );
});

it("preserves historical v5 catalog capabilities and snapshots when no new projection version was recorded", async () => {
  const f = await preparedListFixture();
  delete f.prepared.request.configurationProjectionVersion;
  const context = f.prepared.request.existingArchitecture;
  if (!context || !("contextVersion" in context))
    throw new Error("Missing reviewed context");
  if (context.contextVersion === 2) delete context.projectionVersion;
  delete context.omissions;
  for (const resource of context.resources) delete resource.sourcePath;
  for (const finding of context.validation.findings)
    delete finding.affectedEntities;
  const historical = structuredClone(context);
  await f.generate();
  const input = f.model.mock.calls[0]?.[0] as CanvasModelTestInput;
  expect(input.existingArchitecture).toEqual(historical);
  const client = input.catalog.services.find(
    (s: { id: string }) => s.id === "aws.cognito.user-pool-client",
  );
  expect(client?.configuration.properties).not.toHaveProperty(
    "generateClientSecret",
  );
  expect(client?.configuration.properties).not.toHaveProperty(
    "accessTokenValidityMinutes",
  );
  f.model.mockResolvedValue({
    ...listProposal,
    resources: [
      {
        key: "client",
        serviceType: "aws.cognito.user-pool-client",
        parentKey: null,
        label: "Client",
        configuration: { accessTokenValidityMinutes: 20 },
      },
    ],
  });
  await expect(f.generate()).rejects.toMatchObject({
    code: "service_unavailable",
  });
});

it.each([
  { detailTypes: ["Invented Event"] },
  { sourceKinds: ["aws.unknown"] },
  { detailTypes: [] },
  { sourceKinds: [] },
  { detailTypes: ["Application Event", "Application Event"] },
  { filterKeys: Array.from({ length: 9 }, (_, i) => `field${String(i)}`) },
  { filterKeys: ["duplicate", "duplicate"] },
  { filterKeys: "category" },
  { unknownSetting: ["value"] },
  { enabled: ["true"] },
])(
  "v5 rejects catalog-invalid fields before publishing: %j",
  async (configuration) => {
    const f = await preparedListFixture();
    f.model.mockResolvedValue({
      ...listProposal,
      resources: [{ ...listProposal.resources[0], configuration }],
    });
    await expect(f.generate()).rejects.toMatchObject({
      code: "service_unavailable",
    });
  },
);

it("v5 binds editable references and preserves exact list update data, including empty lists", async () => {
  const f = await preparedListFixture();
  const context = f.prepared.request.existingArchitecture;
  if (
    !context ||
    !("contextVersion" in context) ||
    context.contextVersion !== 2
  )
    throw new Error("Expected reviewed context");
  context.resources.push({
    nodeId: "node_rule",
    serviceType: "aws.eventbridge.rule",
    label: "Events",
    parentNodeId: null,
    editable: true,
    configuration: {
      filterKeys: ["previous"],
      detailTypes: ["Application Event"],
    },
    omittedConfigurationKeys: [],
  });
  const update = {
    ...listProposal,
    resources: [],
    existingResources: [{ key: "rule", nodeId: "node_rule" }],
    updates: [
      {
        resourceKey: "rule",
        configuration: { filterKeys: [] },
        reason: "Remove the optional filter",
      },
    ],
  };
  f.model.mockResolvedValue(update);
  expect(await f.generate()).toHaveProperty("proposal", update);
  const resource = context.resources[0];
  if (!resource) throw new Error("Expected referenced rule");
  resource.editable = false;
  await expect(f.generate()).rejects.toMatchObject({
    code: "service_unavailable",
  });
});

it("v5 rejects mismatched response versions and unsupported connections", async () => {
  const f = await preparedListFixture();
  f.model.mockResolvedValue(proposal);
  await expect(f.generate()).rejects.toMatchObject({
    code: "service_unavailable",
  });
  f.model.mockResolvedValue({
    ...listProposal,
    connections: [
      {
        ruleId: "invented",
        sourceKey: "rule",
        targetKey: "subscription",
        configuration: { filterKeys: [] },
      },
    ],
  });
  await expect(f.generate()).rejects.toMatchObject({
    code: "service_unavailable",
  });
});

it("v5 rejects a queued catalog change or missing reviewed binding before model dispatch", async () => {
  const f = await preparedListFixture();
  expect(f.prepared.request.catalogDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(f.prepared.request.catalogDigest).not.toBe("sha256:" + "0".repeat(64));
  await expect(
    f.app.generate(
      {
        ...f.prepared.request,
        catalogDigest: sha256DigestSchema.parse("sha256:" + "0".repeat(64)),
      },
      new AbortController().signal,
      () => Promise.resolve(),
    ),
  ).rejects.toMatchObject({ code: "precondition_failed" });
  const unbound = { ...f.prepared.request };
  delete unbound.catalogDigest;
  await expect(
    f.app.generate(unbound, new AbortController().signal, () =>
      Promise.resolve(),
    ),
  ).rejects.toThrow("V5 requires reviewed context");
  await expect(
    f.app.generate(
      {
        ...f.prepared.request,
        existingArchitecture: {
          region: "us-east-1",
          resources: [],
          connections: [],
        },
      },
      new AbortController().signal,
      () => Promise.resolve(),
    ),
  ).rejects.toThrow("V5 requires reviewed context");
  expect(f.model).not.toHaveBeenCalled();
});
