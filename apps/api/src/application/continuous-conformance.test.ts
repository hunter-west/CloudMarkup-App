import {
  evaluateConformanceV1,
  getArchitectureDocumentContentHash,
  hashCanonicalValue,
} from "@cloudmarkup/domain";
import { defaultConformanceStalenessPolicyV1 } from "@cloudmarkup/schemas";
import { canonicalDigest } from "@cloudmarkup/github-repository-export";
import { describe, expect, it, vi } from "vitest";

import {
  createSeedArchitectureDocument,
  LOCAL_PROJECT_SEEDS,
} from "../local-development/local-seed.js";
import { createApp } from "../app.js";
import {
  ContinuousConformanceApplicationService,
  ObjectAuthorizationContinuousConformanceAccessControl,
  type ContinuousConformanceReportSource,
} from "./continuous-conformance.js";
import {
  ObjectAuthorizationService,
  type AuthorizationStore,
} from "./object-authorization.js";
import { CanonicalContinuousConformanceDiagramRenderer } from "./conformance-diagram-renderer.js";
import { GitHubContinuousConformanceReviewActionRegistry } from "./github-conformance-review-registry.js";
import type { CloudMarkupApplication } from "./ports.js";

const principal = {
  authenticatedAt: "2026-08-29T11:55:00.000Z",
  authenticationSource: "test" as const,
  correlationId: "correlation_conformance_1",
  expiresAt: "2026-08-29T13:00:00.000Z",
  principalId: "principal_conformance_1",
  sessionId: "session_conformance_1",
};
const layerEvidence = {
  designed: ["approved-documents", "architecture-document"],
  imported: ["repository-snapshot", "repository-snapshot"],
  generated: ["generated-manifest", "generated-manifest"],
  planned: ["cloud-plan-change-set", "terraform-plan"],
  deployed: ["deployment-smoke-integration", "deployment-attestation"],
  "current-drift": ["read-only-drift", "read-only-drift-result"],
} as const;

function designedResourceFact(mappedNodeId?: string) {
  return {
    applicationBinding: "not-applicable" as const,
    evidenceIds: ["evidence.designed"],
    extensionPoint: false,
    factId: "fact.designed.resource.api",
    iamAccess: "not-applicable" as const,
    iamPermissions: [],
    layer: "designed" as const,
    management: "managed" as const,
    operation: "none" as const,
    ownership: "generated" as const,
    publicExposure: "private" as const,
    semanticComparison: {
      basis: "resource-intent" as const,
      contractVersion: 1 as const,
      coverage: "complete" as const,
    },
    semanticDigest: hashCanonicalValue("resource:api"),
    sourceIds: ["source.designed"],
    sourceLocations: [],
    subject: {
      kind: "resource" as const,
      ...(mappedNodeId === undefined
        ? {}
        : {
            mappedReference: {
              kind: "architecture-node" as const,
              nodeId: mappedNodeId,
            },
          }),
      stableKey: "resource.api",
    },
  };
}

function exactReport(
  withDifference = false,
  options: {
    readonly importedFreshness?: "current" | "stale";
    readonly mappedNodeId?: string;
  } = {},
) {
  const solutionRevision = {
    digest: hashCanonicalValue("api-conformance-revision"),
    id: "solution_revision_conformance_1",
  };
  const verifiedAt = "2026-08-29T11:30:00.000Z";
  return evaluateConformanceV1({
    contractVersion: 1,
    currentSolutionRevision: solutionRevision,
    environment: {
      environmentId: "env_conformance_1",
      environmentType: "test",
    },
    evaluatedAt: "2026-08-29T12:00:00.000Z",
    evaluatedSolutionRevision: solutionRevision,
    evaluator: {
      id: "cloudmarkup.continuous-conformance",
      version: "1.0.0",
    },
    layers: (
      [
        "designed",
        "imported",
        "generated",
        "planned",
        "deployed",
        "current-drift",
      ] as const
    ).map((layer) => {
      const [evidenceType, sourceKind] = layerEvidence[layer];
      return {
        availability: "available",
        boundSolutionRevision: solutionRevision,
        completeness: "complete",
        declaredFreshness:
          layer === "imported"
            ? (options.importedFreshness ?? "current")
            : "current",
        evidenceIds: [`evidence.${layer}`],
        evidenceType,
        ...(layer === "planned" ||
        layer === "deployed" ||
        layer === "current-drift"
          ? { environmentId: "env_conformance_1" }
          : {}),
        ...(layer === "planned" || layer === "current-drift"
          ? { explicitExpiresAt: "2026-08-29T13:00:00.000Z" }
          : {}),
        facts:
          layer === "designed" && withDifference
            ? [designedResourceFact(options.mappedNodeId)]
            : layer === "imported" && options.mappedNodeId !== undefined
              ? [
                  {
                    ...designedResourceFact(options.mappedNodeId),
                    evidenceIds: ["evidence.imported"],
                    factId: "fact.imported.resource.api",
                    layer: "imported" as const,
                    sourceIds: ["source.imported"],
                  },
                ]
              : [],
        integrity: "verified",
        layer,
        sources: [
          {
            digest: hashCanonicalValue(`source:${layer}`),
            kind: sourceKind,
            observedAt: verifiedAt,
            solutionRevisionId: solutionRevision.id,
            sourceId: `source.${layer}`,
          },
        ],
        verifiedAt,
      };
    }),
    projectId: "project_conformance_1",
    stalenessPolicy: structuredClone(defaultConformanceStalenessPolicyV1),
  });
}

function recomputeConformanceReportDigest(
  report: ReturnType<typeof exactReport>,
) {
  const { reportDigest: discardedDigest, ...basis } = report;
  void discardedDigest;
  return {
    ...report,
    reportDigest: hashCanonicalValue({
      contractVersion: 1,
      kind: "cloudmarkup.conformance-report-digest",
      report: basis,
    }),
  };
}

function authorizationStore(): AuthorizationStore {
  return {
    getArtifact: () => Promise.resolve(null),
    getAuditEvent: () => Promise.resolve(null),
    getIntegration: () => Promise.resolve(null),
    getJob: () => Promise.resolve(null),
    getMembership: () => Promise.resolve(null),
    getPrincipalState: () => Promise.resolve("active"),
    getProject: () =>
      Promise.resolve({
        organizationId: "organization_other",
        projectId: "project_conformance_1",
      }),
    getRevision: () => Promise.resolve(null),
  };
}

describe("continuous conformance application", () => {
  it("returns only a schema-valid report with exact project, revision, and environment bindings", async () => {
    const report = exactReport();
    const application = new ContinuousConformanceApplicationService({
      access: {
        authorizeProject: () =>
          Promise.resolve({ organizationId: "organization_allowed" }),
      },
      source: { get: () => Promise.resolve(report) },
    });

    await expect(
      application.getReport(
        principal,
        "project_conformance_1",
        "solution_revision_conformance_1",
        "env_conformance_1",
      ),
    ).resolves.toEqual(report);
  });

  it("rejects a schema-valid report when its canonical digest is tampered", async () => {
    const report = exactReport();
    const application = new ContinuousConformanceApplicationService({
      access: {
        authorizeProject: () =>
          Promise.resolve({ organizationId: "organization_allowed" }),
      },
      source: {
        get: () =>
          Promise.resolve({
            ...report,
            reportDigest: hashCanonicalValue("tampered-report"),
          }),
      },
    });

    await expect(
      application.getReport(
        principal,
        "project_conformance_1",
        "solution_revision_conformance_1",
        "env_conformance_1",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
  it("rejects recomputed digests for relabeled or cross-environment layers", async () => {
    const relabeled = structuredClone(exactReport());
    const designed = relabeled.layers.find(({ layer }) => layer === "designed");
    if (designed === undefined) {
      throw new Error("Expected designed conformance result.");
    }
    designed.evidenceType = "read-only-drift";

    const crossEnvironment = structuredClone(exactReport());
    const planned = crossEnvironment.layers.find(
      ({ layer }) => layer === "planned",
    );
    if (planned === undefined) {
      throw new Error("Expected planned conformance result.");
    }
    planned.environmentId = "env_conformance_other";

    const wrongRevision = structuredClone(exactReport());
    const generated = wrongRevision.layers.find(
      ({ layer }) => layer === "generated",
    );
    if (generated?.boundSolutionRevision === undefined) {
      throw new Error("Expected generated revision binding.");
    }
    generated.boundSolutionRevision.digest = hashCanonicalValue(
      "forged-layer-revision",
    );
    for (const report of [
      recomputeConformanceReportDigest(relabeled),
      recomputeConformanceReportDigest(crossEnvironment),
      recomputeConformanceReportDigest(wrongRevision),
    ]) {
      const application = new ContinuousConformanceApplicationService({
        access: {
          authorizeProject: () =>
            Promise.resolve({ organizationId: "organization_allowed" }),
        },
        source: { get: () => Promise.resolve(report) },
      });
      await expect(
        application.getReport(
          principal,
          "project_conformance_1",
          "solution_revision_conformance_1",
          "env_conformance_1",
        ),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    }
  });

  it("serves the protected evidence API through the versioned HTTP contract", async () => {
    const report = exactReport();
    const getView = vi.fn().mockResolvedValue({
      availableReviewActions: [],
      report,
    });
    const app = createApp({
      application: {} as CloudMarkupApplication,
      authenticationClock: () => new Date("2026-08-29T12:00:00.000Z"),
      continuousConformance: { getView } as never,
      correlationIdFactory: () => "correlation_conformance_http",
      principalResolver: {
        resolve: () => Promise.resolve(principal),
      },
    });

    const response = await app.request(
      "/v1/projects/project_conformance_1/solution-revisions/solution_revision_conformance_1/environments/env_conformance_1/conformance",
      { headers: { authorization: "Bearer conformance-test" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      apiVersion: "v1",
      data: {
        availableReviewActions: [],
        report,
      },
    });
    expect(getView).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: "correlation_conformance_http",
        principalId: principal.principalId,
      }),
      "project_conformance_1",
      "solution_revision_conformance_1",
      "env_conformance_1",
    );
  });
  it("hides a valid report when any requested object binding differs", async () => {
    const application = new ContinuousConformanceApplicationService({
      access: {
        authorizeProject: () =>
          Promise.resolve({ organizationId: "organization_allowed" }),
      },
      source: { get: () => Promise.resolve(exactReport()) },
    });

    await expect(
      application.getReport(
        principal,
        "project_conformance_1",
        "solution_revision_conformance_1",
        "environment_other",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("fails closed across tenants before reading conformance evidence", async () => {
    const get = vi.fn().mockResolvedValue(null);
    const source: ContinuousConformanceReportSource = { get };
    const application = new ContinuousConformanceApplicationService({
      access: new ObjectAuthorizationContinuousConformanceAccessControl(
        new ObjectAuthorizationService(authorizationStore()),
      ),
      source,
    });

    await expect(
      application.getReport(
        principal,
        "project_conformance_1",
        "solution_revision_conformance_1",
        "env_conformance_1",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(get).not.toHaveBeenCalled();
  });

  it("scopes the source from authorization and rejects malformed evidence", async () => {
    const get = vi.fn().mockResolvedValue({ untrusted: true });
    const source: ContinuousConformanceReportSource = { get };
    const application = new ContinuousConformanceApplicationService({
      access: {
        authorizeProject: (_principal, _projectId, permission) => {
          expect(permission).toBe("projects.read");
          return Promise.resolve({ organizationId: "organization_allowed" });
        },
      },
      source,
    });

    await expect(
      application.getReport(
        principal,
        "project_conformance_1",
        "solution_revision_conformance_1",
        "env_conformance_1",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(get).toHaveBeenCalledWith(
      {
        environmentId: "env_conformance_1",
        organizationId: "organization_allowed",
        projectId: "project_conformance_1",
        solutionRevisionId: "solution_revision_conformance_1",
      },
      undefined,
    );
  });

  it("does not turn unavailable tenant-scoped evidence into an empty report", async () => {
    const application = new ContinuousConformanceApplicationService({
      access: {
        authorizeProject: () =>
          Promise.resolve({ organizationId: "organization_allowed" }),
      },
      source: { get: () => Promise.resolve(null) },
    });

    await expect(
      application.getReport(
        principal,
        "project_conformance_1",
        "solution_revision_conformance_1",
        "env_conformance_1",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("renders only a freshly bound server report and rejects stale digests before the renderer", async () => {
    const report = exactReport();
    const render = vi.fn().mockResolvedValue({
      artifactId: "conformance.diagram.designed",
      svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
    const permissions: string[] = [];
    const application = new ContinuousConformanceApplicationService({
      access: {
        authorizeProject: (_principal, _projectId, permission) => {
          permissions.push(permission);
          return Promise.resolve({ organizationId: "organization_allowed" });
        },
      },
      diagrams: { render },
      source: { get: () => Promise.resolve(report) },
    });
    const request = {
      contractVersion: 1 as const,
      reportDigest: report.reportDigest,
      reportId: report.reportId,
      showDifferences: true,
      state: "designed" as const,
    };

    const result = await application.exportDiagram(
      principal,
      "project_conformance_1",
      "solution_revision_conformance_1",
      "env_conformance_1",
      request,
    );

    expect(result).toMatchObject({
      artifact: {
        artifactId: "conformance.diagram.designed",
        mediaType: "image/svg+xml",
      },
      reportDigest: report.reportDigest,
      reportId: report.reportId,
      state: "designed",
    });
    expect(result.artifact.checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(permissions).toEqual(["exports.run"]);
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "organization_allowed",
        report,
        state: "designed",
      }),
    );

    await expect(
      application.exportDiagram(
        principal,
        "project_conformance_1",
        "solution_revision_conformance_1",
        "env_conformance_1",
        {
          ...request,
          reportDigest: hashCanonicalValue("stale-report"),
        },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("projects and executes only an exact server-known reviewed action", async () => {
    const report = exactReport(true);
    const difference = report.differences.find(
      ({ remediation }) => remediation.disposition === "review-required",
    );
    if (difference === undefined) throw new Error("Expected one difference.");
    const actionKey = "conformance.action.issue";
    const list = vi.fn().mockResolvedValue([
      {
        actions: [{ actionKey, kind: "github-issue" }],
        differenceId: difference.differenceId,
      },
    ]);
    const execute = vi.fn().mockResolvedValue({
      actionId: actionKey,
      createdAt: "2026-08-29T12:05:00.000Z",
      mergeAuthority: "none",
      providerRecordDigest: hashCanonicalValue("provider-record"),
      sourceRecordDigest: difference.differenceDigest,
      remediation: "none",
      state: "created",
    });
    const permissions: string[] = [];
    const application = new ContinuousConformanceApplicationService({
      access: {
        authorizeProject: (_principal, _projectId, permission) => {
          permissions.push(permission);
          return Promise.resolve({ organizationId: "organization_allowed" });
        },
      },
      actions: { execute, list },
      source: { get: () => Promise.resolve(report) },
    });

    await expect(
      application.getView(
        principal,
        "project_conformance_1",
        "solution_revision_conformance_1",
        "env_conformance_1",
      ),
    ).resolves.toMatchObject({
      availableReviewActions: [
        {
          actions: [{ actionKey, kind: "github-issue" }],
          differenceId: difference.differenceId,
        },
      ],
      report,
    });

    const result = await application.reviewAction(
      principal,
      "project_conformance_1",
      "solution_revision_conformance_1",
      "env_conformance_1",
      {
        actionKey,
        contractVersion: 1,
        differenceId: difference.differenceId,
        kind: "github-issue",
        reportDigest: report.reportDigest,
        reportId: report.reportId,
      },
      "idempotency.conformance.issue.1",
    );
    expect(result).toMatchObject({
      actionKey,
      differenceId: difference.differenceId,
      kind: "github-issue",
      reportDigest: report.reportDigest,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        actionKey,
        difference,
        idempotencyKey: "idempotency.conformance.issue.1",
        organizationId: "organization_allowed",
        principalId: principal.principalId,
        report,
      }),
    );
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty("mergeAuthority");
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty("remediation");
    expect(permissions).toContain("projects.mutate");

    await expect(
      application.reviewAction(
        principal,
        "project_conformance_1",
        "solution_revision_conformance_1",
        "env_conformance_1",
        {
          actionKey: "conformance.action.unknown",
          contractVersion: 1,
          differenceId: difference.differenceId,
          kind: "github-issue",
          reportDigest: report.reportDigest,
          reportId: report.reportId,
        },
        "idempotency.conformance.issue.2",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("denies cross-tenant operation scope before renderer or action registry access", async () => {
    const render = vi.fn();
    const list = vi.fn();
    const application = new ContinuousConformanceApplicationService({
      access: {
        authorizeProject: () =>
          Promise.reject(
            Object.assign(new Error("hidden"), { code: "not_found" }),
          ),
      },
      actions: { execute: vi.fn(), list },
      diagrams: { render },
      source: { get: vi.fn() },
    });
    const report = exactReport();

    await expect(
      application.exportDiagram(
        principal,
        "project_conformance_1",
        "solution_revision_conformance_1",
        "env_conformance_1",
        {
          contractVersion: 1,
          reportDigest: report.reportDigest,
          reportId: report.reportId,
          showDifferences: false,
          state: "generated",
        },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(render).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it("maps only a server-catalogued report action into the hardened GitHub service", async () => {
    const report = exactReport(true);
    const difference = report.differences.find(
      ({ remediation }) => remediation.disposition === "review-required",
    );
    if (difference === undefined) throw new Error("Expected one difference.");
    const action = {
      actionId: "conformance.action.github.issue",
      findingClass: "designed-but-missing",
      issueKey: "conformance.issue.designed.missing",
      kind: "upsert-known-issue",
    } as const;
    const binding = {
      evidenceRecordIds: [...difference.evidenceIds],
      organizationId: "organization_allowed",
      projectId: "project_conformance_1",
      reportDigest: report.reportDigest,
      repositoryId: 101,
      solutionRevision: report.evaluatedSolutionRevision,
    };
    const bindingDigest = canonicalDigest(binding);
    const knownAction = {
      action,
      bindingDigest,
      sourceRecordDigest: difference.differenceDigest,
    };
    const catalog = {
      list: vi.fn().mockResolvedValue([
        {
          binding,
          differenceId: difference.differenceId,
          knownAction,
        },
      ]),
    };
    const claim = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue({
      actionDigest: canonicalDigest(action),
      actionId: action.actionId,
      actionKind: action.kind,
      authorizationDigest: hashCanonicalValue("github-authorization"),
      bindingDigest,
      contractVersion: 1,
      createdAt: "2026-08-29T12:06:00.000Z",
      idempotencyDigest: hashCanonicalValue("github-idempotency"),
      mergeAuthority: "none",
      providerRecordDigest: hashCanonicalValue("github-provider-record"),
      providerState: "created",
      remediation: "none",
      sourceRecordDigest: difference.differenceDigest,
    });
    const registry = new GitHubContinuousConformanceReviewActionRegistry({
      catalog,
      idempotency: { claim },
      service: { execute },
    });

    await expect(
      registry.list({
        environmentId: "env_conformance_1",
        organizationId: "organization_allowed",
        projectId: "project_conformance_1",
        report,
        solutionRevisionId: report.evaluatedSolutionRevision.id,
      }),
    ).resolves.toEqual([
      {
        actions: [
          {
            actionKey: action.actionId,
            kind: "github-issue",
          },
        ],
        differenceId: difference.differenceId,
      },
    ]);

    await expect(
      registry.execute({
        actionKey: action.actionId,
        difference,
        environmentId: "env_conformance_1",
        idempotencyKey: "idempotency.conformance.github.1",
        kind: "github-issue",
        organizationId: "organization_allowed",
        principalId: principal.principalId,
        projectId: "project_conformance_1",
        report,
        solutionRevisionId: report.evaluatedSolutionRevision.id,
      }),
    ).resolves.toMatchObject({
      actionId: action.actionId,
      mergeAuthority: "none",
      remediation: "none",
      state: "created",
    });
    expect(claim).toHaveBeenCalledWith({
      actionKey: action.actionId,
      bindingDigest,
      idempotencyKey: "idempotency.conformance.github.1",
      operationId: "continuous-conformance.review-action",
      organizationId: "organization_allowed",
      principalId: principal.principalId,
      projectId: "project_conformance_1",
    });
    expect(execute).toHaveBeenCalledWith(
      {
        action,
        binding,
        contractVersion: 1,
        principalId: principal.principalId,
      },
      binding,
    );

    await expect(
      registry.execute({
        actionKey: "conformance.action.github.unknown",
        difference,
        environmentId: "env_conformance_1",
        idempotencyKey: "idempotency.conformance.github.2",
        kind: "github-issue",
        organizationId: "organization_allowed",
        principalId: principal.principalId,
        projectId: "project_conformance_1",
        report,
        solutionRevisionId: report.evaluatedSolutionRevision.id,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects stale reconciliation-PR source and Evidence lineage before idempotency or GitHub access", async () => {
    const report = exactReport(true);
    const difference = report.differences.find(
      ({ remediation }) => remediation.disposition === "review-required",
    );
    if (difference === undefined || difference.evidenceIds.length === 0) {
      throw new Error("Expected one evidence-backed difference.");
    }
    const action = {
      actionId: "conformance.action.github.reconciliation",
      baseCommitSha: "a".repeat(40),
      extensionPreservationDigest: hashCanonicalValue("extension-preservation"),
      kind: "request-reconciliation-pr",
      proposedArtifactDigest: hashCanonicalValue("reconciliation-artifact"),
      repositorySnapshotDigest: hashCanonicalValue("repository-snapshot"),
    } as const;
    const binding = {
      evidenceRecordIds: [...difference.evidenceIds],
      organizationId: "organization_allowed",
      projectId: "project_conformance_1",
      reportDigest: report.reportDigest,
      repositoryId: 101,
      solutionRevision: report.evaluatedSolutionRevision,
    };
    const list = vi.fn();
    const claim = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn();
    const registry = new GitHubContinuousConformanceReviewActionRegistry({
      catalog: { list },
      idempotency: { claim },
      service: { execute },
    });
    const scope = {
      environmentId: "env_conformance_1",
      organizationId: "organization_allowed",
      projectId: "project_conformance_1",
      report,
      solutionRevisionId: report.evaluatedSolutionRevision.id,
    };

    list.mockResolvedValueOnce([
      {
        binding,
        differenceId: difference.differenceId,
        knownAction: {
          action,
          bindingDigest: canonicalDigest(binding),
          sourceRecordDigest: hashCanonicalValue("stale-difference"),
        },
      },
    ]);
    await expect(registry.list(scope)).rejects.toMatchObject({
      code: "service_unavailable",
    });

    const staleEvidenceBinding = {
      ...binding,
      evidenceRecordIds: ["evidence.stale"],
    };
    list.mockResolvedValueOnce([
      {
        binding: staleEvidenceBinding,
        differenceId: difference.differenceId,
        knownAction: {
          action,
          bindingDigest: canonicalDigest(staleEvidenceBinding),
          sourceRecordDigest: difference.differenceDigest,
        },
      },
    ]);
    await expect(
      registry.execute({
        ...scope,
        actionKey: action.actionId,
        difference,
        idempotencyKey: "idempotency.conformance.github.stale-pr",
        kind: "reconciliation-pr",
        principalId: principal.principalId,
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("reconstructs canonical SVG only from an exact tenant and revision-bound approved topology", async () => {
    const report = exactReport(true);
    const architectureDocument = createSeedArchitectureDocument(
      LOCAL_PROJECT_SEEDS[0],
    );
    const record = {
      architectureDocument,
      architectureDocumentDigest:
        getArchitectureDocumentContentHash(architectureDocument),
      contractVersion: 1 as const,
      organizationId: "organization_allowed",
      projectId: "project_conformance_1",
      solutionRevision: report.evaluatedSolutionRevision,
    };
    const get = vi.fn().mockResolvedValue(record);
    const renderer = new CanonicalContinuousConformanceDiagramRenderer({ get });
    const input = {
      environmentId: "env_conformance_1",
      organizationId: "organization_allowed",
      projectId: "project_conformance_1",
      report,
      showDifferences: true,
      solutionRevisionId: report.evaluatedSolutionRevision.id,
      state: "designed" as const,
    };

    const result = await renderer.render(input);

    expect(result.artifactId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.svg).toContain("Continuous conformance");
    expect(result.svg).toContain("env_conformance_1 | test");
    expect(result.svg).toContain("Unmapped evidence (1)");
    expect(result.svg).toContain("never remediates drift");
    expect(result.svg).not.toMatch(/<(?:script|foreignObject)\b/iu);
    expect(get).toHaveBeenCalledWith({
      organizationId: "organization_allowed",
      projectId: "project_conformance_1",
      solutionRevisionId: report.evaluatedSolutionRevision.id,
    });

    const substituted = new CanonicalContinuousConformanceDiagramRenderer({
      get: () =>
        Promise.resolve({
          ...record,
          organizationId: "organization_other",
        }),
    });
    await expect(substituted.render(input)).rejects.toMatchObject({
      code: "service_unavailable",
    });
  });

  it("renders matching only from current explicit positive comparison evidence", async () => {
    const architectureDocument = createSeedArchitectureDocument(
      LOCAL_PROJECT_SEEDS[0],
    );
    const mappedNode = architectureDocument.nodes[0];
    if (mappedNode === undefined) {
      throw new Error("Expected one approved topology node.");
    }
    const report = exactReport(true, { mappedNodeId: mappedNode.id });
    const record = {
      architectureDocument,
      architectureDocumentDigest:
        getArchitectureDocumentContentHash(architectureDocument),
      contractVersion: 1 as const,
      organizationId: "organization_allowed",
      projectId: "project_conformance_1",
      solutionRevision: report.evaluatedSolutionRevision,
    };
    const renderer = new CanonicalContinuousConformanceDiagramRenderer({
      get: () => Promise.resolve(record),
    });
    const input = {
      environmentId: "env_conformance_1",
      organizationId: "organization_allowed",
      projectId: "project_conformance_1",
      report,
      showDifferences: true,
      solutionRevisionId: report.evaluatedSolutionRevision.id,
    };

    const designed = await renderer.render({
      ...input,
      state: "designed",
    });
    expect(designed.svg).toMatch(/, present, UNKNOWN"/u);
    expect(designed.svg).not.toMatch(/, present, MATCH"/u);

    const imported = await renderer.render({
      ...input,
      state: "imported",
    });
    expect(imported.svg).toMatch(/, present, MATCH"/u);

    for (const freshness of ["stale", "expired", "invalid"] as const) {
      const nonCurrentReport = structuredClone(report);
      const nonCurrentLayer = nonCurrentReport.layers.find(
        ({ layer }) => layer === "imported",
      );
      if (nonCurrentLayer === undefined) {
        throw new Error("Expected imported evidence.");
      }
      nonCurrentLayer.quality.freshness = freshness;
      const rendered = await renderer.render({
        ...input,
        report: nonCurrentReport,
        state: "imported",
      });
      expect(rendered.svg).toMatch(/, present, UNKNOWN"/u);
      expect(rendered.svg).not.toMatch(/, present, MATCH"/u);
    }

    const unavailableReport = structuredClone(report);
    const unavailableLayer = unavailableReport.layers.find(
      ({ layer }) => layer === "imported",
    );
    if (unavailableLayer === undefined) {
      throw new Error("Expected imported evidence.");
    }
    unavailableLayer.availability = "unavailable";
    unavailableLayer.quality = {
      completeness: "unknown",
      freshness: "invalid",
      freshnessReasons: ["evidence-unavailable"],
    };
    const unavailable = await renderer.render({
      ...input,
      report: unavailableReport,
      state: "imported",
    });
    expect(unavailable.svg).toMatch(/, present, UNKNOWN"/u);
    expect(unavailable.svg).not.toMatch(/, present, MATCH"/u);
  });
});
