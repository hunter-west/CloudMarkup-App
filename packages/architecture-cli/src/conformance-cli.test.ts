import { rm } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { evaluateConformanceV1, hashCanonicalValue } from "@cloudmarkup/domain";
import {
  CONFORMANCE_V1_LIMITS,
  defaultConformanceStalenessPolicyV1,
} from "@cloudmarkup/schemas";

import { runArchitectureCli } from "./cli.js";
import {
  ARCHITECTURE_CLI_EXIT_CODES,
  architectureCliCommandResultV1Schema,
} from "./contracts.js";
import { architectureCliConformanceSummaryV1Schema } from "./conformance-contracts.js";
import {
  createArchitectureCliService,
  type ArchitectureCliPipelineV1,
} from "./service.js";
import {
  architectureCliFixtureArtifact,
  architectureCliFixtureSnapshot,
  writeArchitectureCliFixtureRepository,
} from "./test-fixtures.js";

const DIGEST = `sha256:${"1".repeat(64)}` as const;
const layerEvidence = {
  designed: ["approved-documents", "architecture-document"],
  imported: ["repository-snapshot", "repository-snapshot"],
  generated: ["generated-manifest", "generated-manifest"],
  planned: ["cloud-plan-change-set", "terraform-plan"],
  deployed: ["deployment-smoke-integration", "deployment-attestation"],
  "current-drift": ["read-only-drift", "read-only-drift-result"],
} as const;

function exactConformanceReport() {
  const solutionRevision = architectureCliFixtureSnapshot().solutionRevision;
  const verifiedAt = "2026-08-29T11:30:00.000Z";
  return evaluateConformanceV1({
    contractVersion: 1,
    currentSolutionRevision: solutionRevision,
    environment: {
      environmentId: "environment.cli",
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
        declaredFreshness: "current",
        evidenceIds: [`evidence.${layer}`],
        evidenceType,
        ...(layer === "planned" ||
        layer === "deployed" ||
        layer === "current-drift"
          ? { environmentId: "environment.cli" }
          : {}),
        ...(layer === "planned" || layer === "current-drift"
          ? { explicitExpiresAt: "2026-08-29T13:00:00.000Z" }
          : {}),
        facts: [],
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
    projectId: "project.cli",
    stalenessPolicy: structuredClone(defaultConformanceStalenessPolicyV1),
  });
}

function recomputeConformanceReportDigest(
  report: ReturnType<typeof exactConformanceReport>,
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

function pipeline(): ArchitectureCliPipelineV1 {
  const output = {
    artifact: architectureCliFixtureArtifact(),
    diagnostics: [],
    evidence: { current: 3, failed: 0, stale: 0, unavailableLevels: [6, 7, 9] },
    semanticSnapshot: architectureCliFixtureSnapshot(),
    state: "ready" as const,
  };
  return {
    inspect: () => Promise.resolve(output),
    run: () => Promise.resolve(output),
  };
}

describe("Architecture CLI continuous conformance", () => {
  it("validates report digest and locked revision before returning an exact-match summary", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      const report = exactConformanceReport();
      const result = await createArchitectureCliService(pipeline(), undefined, {
        read: (input) => {
          expect(input.solutionRevision).toEqual(
            architectureCliFixtureSnapshot().solutionRevision,
          );
          return Promise.resolve(report);
        },
      }).execute({
        command: "conformance",
        environmentId: "environment.cli",
        root,
      });

      expect(result).toMatchObject({
        conformance: {
          differenceIds: [],
          issueIds: [],
          reportDigest: report.reportDigest,
          reportId: report.reportId,
        },
        evidence: { current: 6, failed: 0, stale: 0 },
        exitCode: ARCHITECTURE_CLI_EXIT_CODES.success,
        state: "succeeded",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a schema-valid report whose canonical digest was changed", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      const report = exactConformanceReport();
      const result = await createArchitectureCliService(pipeline(), undefined, {
        read: () =>
          Promise.resolve({
            ...report,
            reportDigest: DIGEST,
          }),
      }).execute({
        command: "conformance",
        environmentId: "environment.cli",
        root,
      });

      expect(result).toMatchObject({
        diagnostics: [{ code: "cloudmarkup.cli.conformance-invalid" }],
        exitCode: ARCHITECTURE_CLI_EXIT_CODES.pipeline,
        state: "failed",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
  it("rejects recomputed digests for relabeled or cross-environment layers", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      const relabeled = structuredClone(exactConformanceReport());
      const designed = relabeled.layers.find(
        ({ layer }) => layer === "designed",
      );
      if (designed === undefined) {
        throw new Error("Expected designed conformance result.");
      }
      designed.evidenceType = "read-only-drift";

      const crossEnvironment = structuredClone(exactConformanceReport());
      const planned = crossEnvironment.layers.find(
        ({ layer }) => layer === "planned",
      );
      if (planned === undefined) {
        throw new Error("Expected planned conformance result.");
      }
      planned.environmentId = "environment.other";

      const wrongRevision = structuredClone(exactConformanceReport());
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
        const result = await createArchitectureCliService(
          pipeline(),
          undefined,
          { read: () => Promise.resolve(report) },
        ).execute({
          command: "conformance",
          environmentId: "environment.cli",
          root,
        });
        expect(result).toMatchObject({
          diagnostics: [{ code: "cloudmarkup.cli.conformance-invalid" }],
          exitCode: ARCHITECTURE_CLI_EXIT_CODES.pipeline,
          state: "failed",
        });
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when no approved evidence source is registered", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      const result = await createArchitectureCliService(pipeline()).execute({
        command: "conformance",
        environmentId: "environment.cli",
        root,
      });
      expect(result).toMatchObject({
        diagnostics: [
          { code: "cloudmarkup.cli.conformance-source-unavailable" },
        ],
        exitCode: ARCHITECTURE_CLI_EXIT_CODES.pipeline,
        state: "failed",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("represents every report entry at the shared bounded maximum", () => {
    const entryIds = Array.from(
      { length: CONFORMANCE_V1_LIMITS.reportEntries },
      (_, index) => `conformance.entry.${String(index)}`,
    );
    const summary = {
      contractVersion: 1,
      counts: {
        byKind: [],
        byLayer: [
          "designed",
          "imported",
          "generated",
          "planned",
          "deployed",
          "current-drift",
        ].map((layer) => ({ count: 0, layer })),
        bySeverity: [],
      },
      differenceIds: entryIds,
      evaluatedAt: "2026-08-29T12:00:00.000Z",
      issueIds: entryIds,
      layers: [
        "designed",
        "imported",
        "generated",
        "planned",
        "deployed",
        "current-drift",
      ].map((layer) => ({
        availability: "available",
        completeness: "complete",
        freshness: "current",
        layer,
      })),
      mutationPolicy: "review-only-no-auto-remediation",
      reportDigest: DIGEST,
      reportId: "conformance.report.boundary",
    };
    const parsed = architectureCliConformanceSummaryV1Schema.parse(summary);
    expect(parsed.differenceIds).toHaveLength(
      CONFORMANCE_V1_LIMITS.reportEntries,
    );
    expect(parsed.issueIds).toHaveLength(CONFORMANCE_V1_LIMITS.reportEntries);
    expect(
      architectureCliConformanceSummaryV1Schema.safeParse({
        ...summary,
        differenceIds: [...entryIds, "conformance.entry.overflow"],
      }).success,
    ).toBe(false);
    expect(
      architectureCliConformanceSummaryV1Schema.safeParse({
        ...summary,
        issueIds: [...entryIds, "conformance.issue.overflow"],
      }).success,
    ).toBe(false);
  });
  it("accepts the command and renders only a bounded report summary", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = architectureCliCommandResultV1Schema.parse({
      command: "conformance",
      conformance: {
        contractVersion: 1,
        counts: {
          byKind: [{ count: 1, kind: "generated-drift-from-source" }],
          byLayer: [
            "designed",
            "imported",
            "generated",
            "planned",
            "deployed",
            "current-drift",
          ].map((layer) => ({
            count: layer === "generated" ? 1 : 0,
            layer,
          })),
          bySeverity: [{ count: 1, severity: "warning" }],
        },
        differenceIds: ["conformance_difference_1"],
        evaluatedAt: "2026-08-29T12:00:00.000Z",
        issueIds: ["conformance_issue_1"],
        layers: [
          "designed",
          "imported",
          "generated",
          "planned",
          "deployed",
          "current-drift",
        ].map((layer) => ({
          availability: "available",
          completeness: "complete",
          freshness: "current",
          layer,
        })),
        mutationPolicy: "review-only-no-auto-remediation",
        reportDigest: DIGEST,
        reportId: "conformance_report_1",
      },
      contractVersion: 1,
      diagnostics: [
        {
          code: "cloudmarkup.cli.conformance-drift",
          message:
            "The validated conformance report contains review-required differences.",
          severity: "warning",
        },
      ],
      evidence: { current: 6, failed: 0, stale: 0, unavailableLevels: [] },
      exitCode: ARCHITECTURE_CLI_EXIT_CODES.drift,
      fileChanges: [],
      semanticChanges: [],
      state: "drift",
    });

    const exitCode = await runArchitectureCli({
      args: ["conformance", "--environment", "environment.cli"],
      service: { execute: () => Promise.resolve(result) },
      stderr: { write: (value) => stderr.push(value) },
      stdout: { write: (value) => stdout.push(value) },
    });

    expect(exitCode).toBe(ARCHITECTURE_CLI_EXIT_CODES.drift);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain(
      "Conformance report: conformance_report_1",
    );
    expect(stdout.join("")).toContain("Conformance differences: 1");
    expect(stdout.join("")).not.toContain("token");
  });
});
