import { hashCanonicalValue } from "@cloudmarkup/domain";
import {
  conformanceReportV1Schema,
  solutionRevisionIdSchema,
  versionedToolReferenceV1Schema,
  defaultConformanceStalenessPolicyV1,
  type ActiveIssueV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  ComposingContinuousConformanceReportSource,
  type ContinuousConformanceInputScopeV1,
} from "./continuous-conformance-composition.js";
import { ContinuousConformanceApplicationService } from "./continuous-conformance.js";
import { InMemoryLocalConformanceReportSnapshots } from "../local-development/in-memory-conformance-report-snapshots.js";
import { downgradeSelfAttestedEvaluation } from "../local-development/verified-manifest-conformance-source.js";

const scope: ContinuousConformanceInputScopeV1 = {
  environmentId: "env_conformance_1",
  organizationId: "organization_allowed",
  projectId: "project_conformance_1",
  solutionRevisionId: "solution_revision_conformance_1",
};
const revision = {
  digest: hashCanonicalValue("composition-revision"),
  id: solutionRevisionIdSchema.parse("solution_revision_conformance_1"),
};
const evaluator = versionedToolReferenceV1Schema.parse({
  id: "cloudmarkup.continuous-conformance",
  version: "1.0.0",
});
const evidenceByLayer = {
  designed: "approved-documents",
  imported: "repository-snapshot",
  generated: "generated-manifest",
  planned: "cloud-plan-change-set",
  deployed: "deployment-smoke-integration",
  "current-drift": "read-only-drift",
} as const;
const sourceKindByLayer = {
  designed: "architecture-document",
  imported: "repository-snapshot",
  generated: "generated-manifest",
  planned: "terraform-plan",
  deployed: "deployment-attestation",
  "current-drift": "read-only-drift-result",
} as const;

function evaluation() {
  return {
    contractVersion: 1,
    environment: {
      environmentId: scope.environmentId,
      environmentType: "test",
    },
    evaluatedSolutionRevision: revision,
    layers: (
      [
        "designed",
        "imported",
        "generated",
        "planned",
        "deployed",
        "current-drift",
      ] as const
    ).map((layer) => ({
      availability: "unavailable",
      completeness: "unknown",
      declaredFreshness: "current",
      evidenceIds: [],
      evidenceType: evidenceByLayer[layer],
      ...(layer === "planned" ||
      layer === "deployed" ||
      layer === "current-drift"
        ? { environmentId: scope.environmentId }
        : {}),
      facts: [],
      integrity: "unknown",
      layer,
      sources: [],
    })),
    projectId: scope.projectId,
  };
}

function matchingEvaluation() {
  const verifiedAt = "2026-08-29T11:30:00.000Z";
  return {
    ...evaluation(),
    layers: evaluation().layers.map((layer) => ({
      availability: "available" as const,
      boundSolutionRevision: revision,
      completeness: "complete" as const,
      declaredFreshness: "current" as const,
      evidenceIds: [`evidence.${layer.layer}`],
      evidenceType: layer.evidenceType,
      ...(layer.environmentId === undefined
        ? {}
        : { environmentId: layer.environmentId }),
      ...(layer.layer === "planned" || layer.layer === "current-drift"
        ? { explicitExpiresAt: "2026-08-29T13:00:00.000Z" }
        : {}),
      facts: [],
      integrity: "verified" as const,
      layer: layer.layer,
      sources: [
        {
          digest: hashCanonicalValue(`source:${layer.layer}`),
          kind: sourceKindByLayer[layer.layer],
          observedAt: verifiedAt,
          solutionRevisionId: revision.id,
          sourceId: `source.${layer.layer}`,
        },
      ],
      verifiedAt,
    })),
  };
}

function source(options?: {
  readonly append?: (updates: readonly ActiveIssueV1[]) => Promise<void>;
  readonly clock?: () => Date;
  readonly evaluation?: () => unknown;
  readonly previous?: () => readonly ActiveIssueV1[];
}) {
  return new ComposingContinuousConformanceReportSource({
    clock: options?.clock ?? (() => new Date("2026-08-29T12:00:00.000Z")),
    evaluator,
    issueUpdates: {
      appendIfAbsent: ({ updates }) =>
        options?.append?.(updates) ?? Promise.resolve(),
    },
    snapshots: new InMemoryLocalConformanceReportSnapshots(),
    source: {
      get: () =>
        Promise.resolve({
          contractVersion: 1,
          evaluation: options?.evaluation?.() ?? evaluation(),
          kind: "cloudmarkup.continuous-conformance-input",
        }),
    },
    stalenessPolicy: defaultConformanceStalenessPolicyV1,
    trustedContext: {
      get: () =>
        Promise.resolve({
          currentSolutionRevision: revision,
          previousIssues: options?.previous?.() ?? [],
        }),
    },
  });
}

describe("continuous conformance production composition", () => {
  it("appends stable issue updates once and reuses trusted current history", async () => {
    let previous: readonly ActiveIssueV1[] = [];
    const append = vi.fn((updates: readonly ActiveIssueV1[]) => {
      previous = updates;
      return Promise.resolve();
    });
    const reportSource = source({ append, previous: () => previous });

    const first = conformanceReportV1Schema.parse(
      await reportSource.get(scope),
    );
    const second = conformanceReportV1Schema.parse(
      await reportSource.get(scope),
    );

    expect(first.issues.length).toBeGreaterThan(0);
    expect(second.issues.map(({ id }) => id)).toEqual(
      first.issues.map(({ id }) => id),
    );
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[0].map(({ id }) => id)).toEqual(
      first.issues.map(({ id }) => id),
    );
  });

  it("reuses the exact report snapshot while trusted state remains current", async () => {
    let now = "2026-08-29T12:00:00.000Z";
    const reportSource = source({
      clock: () => new Date(now),
      evaluation: () => matchingEvaluation(),
    });
    const first = conformanceReportV1Schema.parse(
      await reportSource.get(scope),
    );
    now = "2026-08-29T12:01:00.000Z";
    const bound = conformanceReportV1Schema.parse(
      await reportSource.get(scope, {
        reportDigest: first.reportDigest,
        reportId: first.reportId,
      }),
    );
    const latest = conformanceReportV1Schema.parse(
      await reportSource.get(scope),
    );

    expect({
      reportDigest: bound.reportDigest,
      reportId: bound.reportId,
    }).toEqual({
      reportDigest: first.reportDigest,
      reportId: first.reportId,
    });
    expect(latest.reportDigest).toBe(first.reportDigest);
    expect(latest.reportId).toBe(first.reportId);
    expect(latest.evaluatedAt).toBe(first.evaluatedAt);
  });

  it("carries an exact composed GET binding into a later diagram operation", async () => {
    let now = "2026-08-29T12:00:00.000Z";
    const reportSource = source({
      clock: () => new Date(now),
      evaluation: () => matchingEvaluation(),
    });
    const render = vi.fn(() =>
      Promise.resolve({
        artifactId: "conformance.diagram.designed",
        svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      }),
    );
    const application = new ContinuousConformanceApplicationService({
      access: {
        authorizeProject: () =>
          Promise.resolve({ organizationId: scope.organizationId }),
      },
      diagrams: { render },
      source: reportSource,
    });
    const principal = {
      authenticatedAt: "2026-08-29T11:55:00.000Z",
      authenticationSource: "test" as const,
      correlationId: "correlation_conformance_composition_1",
      expiresAt: "2026-08-29T13:00:00.000Z",
      principalId: "principal_conformance_composition_1",
      sessionId: "session_conformance_composition_1",
    };
    const report = await application.getReport(
      principal,
      scope.projectId,
      scope.solutionRevisionId,
      scope.environmentId,
    );
    now = "2026-08-29T12:01:00.000Z";
    const exported = await application.exportDiagram(
      principal,
      scope.projectId,
      scope.solutionRevisionId,
      scope.environmentId,
      {
        contractVersion: 1,
        reportDigest: report.reportDigest,
        reportId: report.reportId,
        showDifferences: true,
        state: "designed",
      },
    );
    expect(exported.reportDigest).toBe(report.reportDigest);
    expect(render).toHaveBeenCalledTimes(1);
    now = "2026-08-29T13:00:00.000Z";
    await expect(
      application.exportDiagram(
        principal,
        scope.projectId,
        scope.solutionRevisionId,
        scope.environmentId,
        {
          contractVersion: 1,
          reportDigest: report.reportDigest,
          reportId: report.reportId,
          showDifferences: true,
          state: "designed",
        },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the explicit issue-history append fails", async () => {
    const reportSource = source({
      append: () => Promise.reject(new Error("history unavailable")),
    });

    await expect(reportSource.get(scope)).rejects.toMatchObject({
      code: "service_unavailable",
    });
  });

  it("appends immutable stale transitions when a current difference clears", async () => {
    let resolved = false;
    let previous: readonly ActiveIssueV1[] = [];
    const batches: (readonly ActiveIssueV1[])[] = [];
    const reportSource = source({
      append: (updates) => {
        batches.push(updates);
        previous = updates;
        return Promise.resolve();
      },
      evaluation: () => (resolved ? matchingEvaluation() : evaluation()),
      previous: () => previous,
    });

    const first = conformanceReportV1Schema.parse(
      await reportSource.get(scope),
    );
    resolved = true;
    const second = conformanceReportV1Schema.parse(
      await reportSource.get(scope),
    );

    expect(first.issues.length).toBeGreaterThan(0);
    expect(second.issues).toEqual([]);
    expect(batches).toHaveLength(2);
    expect(batches[1]).toHaveLength(first.issues.length);
    const staleById = new Map(
      batches[1]?.map((issue) => [issue.id, issue] as const),
    );
    for (const issue of first.issues) {
      const stale = staleById.get(issue.id);
      expect(stale?.lifecycle.state).toBe("stale");
      expect(stale?.previousRecordDigest).toBe(issue.currentRecordDigest);
      expect(stale?.recordVersion).toBe(issue.recordVersion + 1);
    }
  });
  it("does not let evidence choose trusted evaluator, policy, clock, or current revision", async () => {
    for (const supplied of [
      { currentSolutionRevision: revision },
      { evaluatedAt: "2025-01-01T00:00:00.000Z" },
      { evaluator: { id: "attacker.tool", version: "99.0.0" } },
      { stalenessPolicy: defaultConformanceStalenessPolicyV1 },
    ]) {
      const reportSource = new ComposingContinuousConformanceReportSource({
        clock: () => new Date("2026-08-29T12:00:00.000Z"),
        evaluator,
        issueUpdates: { appendIfAbsent: () => Promise.resolve() },
        snapshots: new InMemoryLocalConformanceReportSnapshots(),
        source: {
          get: () =>
            Promise.resolve({
              contractVersion: 1,
              evaluation: {
                ...evaluation(),
                ...supplied,
              },
              kind: "cloudmarkup.continuous-conformance-input",
            }),
        },
        stalenessPolicy: defaultConformanceStalenessPolicyV1,
        trustedContext: {
          get: () => Promise.resolve({ currentSolutionRevision: revision }),
        },
      });

      await expect(reportSource.get(scope)).rejects.toMatchObject({
        code: "service_unavailable",
      });
    }
  });

  it("downgrades checksum-consistent local self-attested cloud layers", () => {
    const raw = {
      ...evaluation(),
      currentSolutionRevision: revision,
      evaluatedAt: "2026-08-29T11:00:00.000Z",
      evaluator: { id: "self.attested", version: "1.0.0" },
      stalenessPolicy: defaultConformanceStalenessPolicyV1,
      layers: evaluation().layers.map((layer) => ({
        ...layer,
        availability: "available",
        facts: [{ secretLikeClaim: "claimed planned/deployed state" }],
        integrity: "verified",
      })),
    };
    const sanitized = downgradeSelfAttestedEvaluation(raw) as Record<
      string,
      unknown
    >;

    expect(sanitized).not.toHaveProperty("currentSolutionRevision");
    expect(sanitized).not.toHaveProperty("evaluatedAt");
    expect(sanitized).not.toHaveProperty("evaluator");
    expect(sanitized).not.toHaveProperty("stalenessPolicy");
    expect(sanitized["layers"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availability: "unavailable",
          facts: [],
          integrity: "unknown",
          layer: "planned",
        }),
        expect.objectContaining({
          availability: "unavailable",
          facts: [],
          integrity: "unknown",
          layer: "deployed",
        }),
        expect.objectContaining({
          availability: "unavailable",
          facts: [],
          integrity: "unknown",
          layer: "current-drift",
        }),
      ]),
    );
  });
});
