import { expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import {
  createBetaInfrastructureApplication,
  type BetaProposalBaselineReaderV1,
} from "../application/beta-infrastructure.js";
import { betaProposalCommandPreparerV1 } from "../application/beta-proposal-command-preparer.js";
import { currentAiCanvasIssueFixture } from "../application/ai-canvas-context-test-helpers.js";
import { projectAiSemanticContextV3 } from "../application/ai-semantic-context.js";
import { FixedPrincipalResolver } from "../testing/in-memory-adapters.js";
import {
  digestCanonicalValue,
  architectureDocumentV3Schema,
  type CreateBetaInfrastructureProposalV1,
} from "@cloudmarkup/schemas";
import type { CloudMarkupApplication } from "../application/ports.js";
import { ApplicationError } from "../application/errors.js";

function fixture(fault?: "unsaved" | "unsupported" | "denied") {
  const document = currentAiCanvasIssueFixture();
  const context = projectAiSemanticContextV3(document);
  const issue = context.validation.findings.find(
    (item) => item.code === "aws.validation.sqs-visibility-timeout-conflict",
  );
  if (!issue?.affectedEntities) throw new Error("Missing queue finding");
  const selectedIssue = {
    code: issue.code,
    affected: issue.affectedEntities.map((item) => ({
      ...(item.nodeId ? { nodeId: item.nodeId } : {}),
      ...(item.edgeId ? { edgeId: item.edgeId } : {}),
      fieldPath: item.path.replace(/^\$\.(?:nodes|edges)\[\d+\]/u, ""),
    })),
  };
  const principal = {
    principalId: "principal_http_context",
    sessionId: "session_http_context",
    authenticatedAt: "2026-10-03T00:00:00.000Z",
    expiresAt: "2099-10-03T00:00:00.000Z",
  };
  const getProject = vi.fn().mockResolvedValue({
    value: { organizationId: "org_http_context", lifecycleStatus: "active" },
  });
  const getDraft = vi.fn().mockResolvedValue({
    etag: '"draft:draft_http_context:v1"',
    value: {
      id: "draft_http_context",
      version: 1,
      architectureDocument: document,
    },
  });
  const getCurrentPrincipal = vi.fn().mockResolvedValue({
    id: principal.principalId,
    organizationContexts: [
      {
        organizationId: "org_http_context",
        capabilities: ["projects.mutate"],
      },
    ],
  });
  const application = {
    getProject,
    getDraft,
    getCurrentPrincipal,
  } as unknown as CloudMarkupApplication;
  const proposal = {
    contractVersion: 6,
    summary: "Repair queue delivery visibility.",
    resources: [],
    connections: [],
    existingResources: [{ key: "queue", nodeId: "node_affected_queue" }],
    updates: [
      {
        resourceKey: "queue",
        configuration: { visibilityTimeoutSeconds: 120 },
        reason: "Allow processing to complete",
      },
    ],
    limitations: [],
    review: {
      intent: "Resolve the selected delivery conflict",
      assumptions: [],
      checks: ["Compare queue and function timeouts"],
      questions: [],
    },
  };
  const model = vi.fn().mockResolvedValue(proposal);
  const events: string[] = [];
  const reader = vi.fn<BetaProposalBaselineReaderV1>((input) => {
    expect(input).toMatchObject({
      ownership: {
        organizationId: "org_http_context",
        projectId: "project_http_context",
      },
      subject: {
        draftId: "draft_http_context",
        draftVersion: 1,
        etag: '"draft:draft_http_context:v1"',
        contentDigest: digestCanonicalValue(document),
      },
    });
    if (fault === "denied")
      return Promise.reject(
        new ApplicationError("access_denied", "Revoked actor"),
      );
    return Promise.resolve(document);
  });
  const host = createBetaInfrastructureApplication({
    application,
    model,
    applicability: {
      preparer: betaProposalCommandPreparerV1,
      forPrincipal: (actor) => {
        expect(actor.principalId).toBe(principal.principalId);
        return reader;
      },
    },
    creditMeter: {
      async execute<T>(input: {
        run: (onUsage: () => Promise<void>) => Promise<T>;
      }) {
        events.push("reserved");
        try {
          const result = await input.run(() => Promise.resolve());
          events.push("settled");
          return result;
        } catch (error) {
          events.push("released");
          throw error;
        }
      },
    },
  });
  const request: CreateBetaInfrastructureProposalV1 = {
    contractVersion: 1,
    proposalVersion: 6,
    requirements: "Repair the selected queue visibility conflict",
    architectureDocument:
      fault === "unsaved"
        ? architectureDocumentV3Schema.parse({
            ...document,
            provider: { ...document.provider, region: "us-west-2" },
          })
        : document,
    selectedIssue:
      fault === "unsupported"
        ? {
            ...selectedIssue,
            affected: selectedIssue.affected.filter((item) => item.edgeId),
          }
        : selectedIssue,
  };
  // Lightweight HTTP/application integration: queue, SQL and credits are ports.
  // Actual durable idempotency/hold settlement remains a PostgreSQL gate.
  const jobs = {
    async create(
      actor: Parameters<typeof host.propose>[0],
      projectId: string,
      input: CreateBetaInfrastructureProposalV1,
      etag: string,
    ) {
      const result = await host.propose(
        actor,
        projectId,
        input,
        etag,
        new AbortController().signal,
      );
      return {
        contractVersion: 1 as const,
        id: "job_http_context",
        state: "succeeded" as const,
        architectureDigest: result.architectureDigest,
        result,
      };
    },
    get: () => Promise.reject(new Error("Unused job port")),
    cancel: () => Promise.reject(new Error("Unused cancel port")),
    credits: () => Promise.reject(new Error("Unused credits port")),
  };
  const app = createApp({
    application,
    betaInfrastructureJobs: jobs,
    principalResolver: new FixedPrincipalResolver({
      "Bearer synthetic-http-context": principal,
    }),
    authenticationClock: () => new Date(principal.authenticatedAt),
  });
  const post = () =>
    app.request("/v1/projects/project_http_context/beta-infrastructure-jobs", {
      method: "POST",
      headers: {
        authorization: "Bearer synthetic-http-context",
        "content-type": "application/json",
        "if-match": '"draft:draft_http_context:v1"',
        "idempotency-key": "reviewed-http-context-request",
      },
      body: JSON.stringify(request),
    });
  return { post, model, events, reader, document, selectedIssue };
}

it("routes the browser v6 request through the actual saved-baseline/shared-command host before successful delivery", async () => {
  const f = fixture();
  const response = await f.post();
  expect(await response.clone().json()).not.toHaveProperty("error");
  expect(response.status).toBe(202);
  const body = (await response.json()) as {
    data: {
      result: {
        proposal: { contractVersion: number };
        applicability: { kind: string; commandDigest: string };
      };
    };
  };
  expect(body.data.result.proposal.contractVersion).toBe(6);
  expect(body.data.result.applicability).toMatchObject({
    kind: "mutation",
    commandDigest: expect.stringMatching(/^sha256:/u) as unknown,
  });
  const input = f.model.mock.calls[0]?.[0] as {
    proposalVersion: number;
    existingArchitecture: ReturnType<typeof projectAiSemanticContextV3>;
  };
  expect(input.proposalVersion).toBe(6);
  expect(input.existingArchitecture.contextVersion).toBe(3);
  expect(input.existingArchitecture.selectedIssue).toEqual(f.selectedIssue);
  expect(
    input.existingArchitecture.resources.find(
      (item) => item.nodeId === "node_affected_queue",
    )?.configuration,
  ).toHaveProperty("visibilityTimeoutSeconds", 60);
  expect(
    input.existingArchitecture.connections.find(
      (item) => item.edgeId === "edge_affected_trigger",
    ),
  ).toMatchObject({
    sourceNodeId: "node_affected_queue",
    sourcePort: f.document.edges[0]?.semantic.source.port,
    targetPort: f.document.edges[0]?.semantic.target.port,
    configuration: { batchingWindowSeconds: 0 },
  });
  expect(f.events).toEqual(["reserved", "settled"]);
  expect(f.reader.mock.calls.length).toBeGreaterThanOrEqual(3);
});
it.each(["unsaved", "unsupported", "denied"] as const)(
  "rejects %s admission before reservation or model invocation",
  async (fault) => {
    const f = fixture(fault);
    const response = await f.post();
    expect(response.status).toBe(
      fault === "unsaved" ? 412 : fault === "denied" ? 403 : 400,
    );
    expect(f.events).toEqual([]);
    expect(f.model).not.toHaveBeenCalled();
  },
);
