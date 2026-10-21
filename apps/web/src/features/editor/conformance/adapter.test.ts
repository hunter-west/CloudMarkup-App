import { evaluateConformanceV1, hashCanonicalValue } from "@cloudmarkup/domain";
import {
  defaultConformanceStalenessPolicyV1,
  utcTimestampSchema,
  type ConformanceViewLayerV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { loadManualNotesApiArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import {
  projectApprovedConformanceTopologyV1,
  projectConformanceReportV1,
} from "./adapter.js";

const states = [
  "designed",
  "imported",
  "generated",
  "planned",
  "deployed",
  "current-drift",
] as const satisfies readonly ConformanceViewLayerV1[];

const layerEvidence = {
  designed: ["approved-documents", "architecture-document"],
  imported: ["repository-snapshot", "repository-snapshot"],
  generated: ["generated-manifest", "generated-manifest"],
  planned: ["cloud-plan-change-set", "terraform-plan"],
  deployed: ["deployment-smoke-integration", "deployment-attestation"],
  "current-drift": ["read-only-drift", "read-only-drift-result"],
} as const;

describe("continuous conformance report projection", () => {
  it("uses exact approved positions and endpoints for mapped facts in all six layers", () => {
    const document = loadManualNotesApiArchitectureDocument();
    const approvedTopology = projectApprovedConformanceTopologyV1(document);
    const architectureEdge = document.edges[0];
    if (architectureEdge === undefined) {
      throw new Error("Expected an approved architecture connection fixture.");
    }
    const sourceNode = document.nodes.find(
      ({ id }) => id === architectureEdge.semantic.source.nodeId,
    );
    const targetNode = document.nodes.find(
      ({ id }) => id === architectureEdge.semantic.target.nodeId,
    );
    if (sourceNode === undefined || targetNode === undefined) {
      throw new Error("Expected approved connection endpoint nodes.");
    }
    const evaluatedSolutionRevision = {
      digest: hashCanonicalValue("evaluated-revision"),
      id: "solution_revision_evaluated_1",
    };
    const report = evaluateConformanceV1({
      contractVersion: 1,
      currentSolutionRevision: {
        digest: hashCanonicalValue("newer-current-revision"),
        id: "solution_revision_current_2",
      },
      environment: {
        environmentId: "environment_staging_1",
        environmentType: "staging",
      },
      evaluatedAt: "2026-08-29T12:00:00.000Z",
      evaluatedSolutionRevision,
      evaluator: {
        id: "cloudmarkup.continuous-conformance",
        version: "1.0.0",
      },
      layers: states.map((layer) => {
        const [evidenceType, sourceKind] = layerEvidence[layer];
        const sourceId = `source.${layer}`;
        const evidenceId = `evidence.${layer}`;
        return {
          availability: "available" as const,
          boundSolutionRevision: evaluatedSolutionRevision,
          completeness: "complete" as const,
          declaredFreshness: "current" as const,
          evidenceIds: [evidenceId],
          evidenceType,
          ...(layer === "planned" ||
          layer === "deployed" ||
          layer === "current-drift"
            ? { environmentId: "environment_staging_1" }
            : {}),
          ...(layer === "planned" || layer === "current-drift"
            ? { explicitExpiresAt: "2026-08-29T13:00:00.000Z" }
            : {}),
          facts: [
            {
              evidenceIds: [evidenceId],
              factId: `fact.${layer}.source`,
              ...(layer === "current-drift"
                ? { driftClassification: "managed-drift" as const }
                : {}),
              layer,
              management: "managed" as const,
              ownership: "generated" as const,
              semanticComparison: {
                basis: "resource-intent" as const,
                contractVersion: 1 as const,
                coverage: "complete" as const,
              },
              semanticDigest: hashCanonicalValue("source-resource"),
              sourceIds: [sourceId],
              sourceLocations: [],
              subject: {
                kind: "resource" as const,
                mappedReference: {
                  kind: "architecture-node" as const,
                  nodeId: sourceNode.id,
                },
                stableKey: sourceNode.semantic.deploymentKey,
              },
            },
            ...(layer === "imported"
              ? []
              : [
                  {
                    evidenceIds: [evidenceId],
                    factId: `fact.${layer}.target`,
                    ...(layer === "current-drift"
                      ? { driftClassification: "managed-drift" as const }
                      : {}),
                    layer,
                    management: "managed" as const,
                    ownership: "generated" as const,
                    semanticComparison: {
                      basis: "resource-intent" as const,
                      contractVersion: 1 as const,
                      coverage: "complete" as const,
                    },
                    semanticDigest: hashCanonicalValue("target-resource"),
                    sourceIds: [sourceId],
                    sourceLocations: [],
                    subject: {
                      kind: "resource" as const,
                      mappedReference: {
                        kind: "architecture-node" as const,
                        nodeId: targetNode.id,
                      },
                      stableKey: targetNode.semantic.deploymentKey,
                    },
                  },
                  {
                    evidenceIds: [evidenceId],
                    factId: `fact.${layer}.connection`,
                    ...(layer === "current-drift"
                      ? { driftClassification: "managed-drift" as const }
                      : {}),
                    layer,
                    management: "managed" as const,
                    ownership: "generated" as const,
                    semanticComparison: {
                      basis: "connection-intent" as const,
                      contractVersion: 1 as const,
                      coverage: "complete" as const,
                    },
                    semanticDigest: hashCanonicalValue("approved-connection"),
                    sourceIds: [sourceId],
                    sourceLocations: [],
                    subject: {
                      kind: "connection" as const,
                      mappedReference: {
                        edgeId: architectureEdge.id,
                        kind: "architecture-edge" as const,
                      },
                      stableKey: architectureEdge.id,
                    },
                  },
                ]),
          ],
          integrity: "verified" as const,
          layer,
          sources: [
            {
              digest: hashCanonicalValue(sourceId),
              kind: sourceKind,
              observedAt: "2026-08-29T11:30:00.000Z",
              solutionRevisionId: evaluatedSolutionRevision.id,
              sourceId,
            },
          ],
          verifiedAt: "2026-08-29T11:30:00.000Z",
        };
      }),
      projectId: "project_conformance_1",
      stalenessPolicy: structuredClone(defaultConformanceStalenessPolicyV1),
    });

    const projectionBinding = {
      approvedTopology,
      environmentId: "environment_staging_1",
      projectId: "project_conformance_1",
      solutionRevisionId: evaluatedSolutionRevision.id,
    };
    const projected = projectConformanceReportV1(report, projectionBinding);
    const expectedPositions = new Map(
      approvedTopology.nodes.map(({ id, position }) => [id, position]),
    );
    const expectedEdge = approvedTopology.edges.find(
      ({ id }) => id === `edge.${architectureEdge.id}`,
    );
    expect(expectedEdge).toBeDefined();
    expect(projected.solutionRevisionId).toBe(evaluatedSolutionRevision.id);
    expect(
      projected.differences.every(
        ({ reviewActions }) => reviewActions.length === 0,
      ),
    ).toBe(true);
    const mappedSourceNodeId = "node." + sourceNode.id;
    const designedLayer = projected.layers.find(
      ({ state }) => state === "designed",
    );
    const importedLayer = projected.layers.find(
      ({ state }) => state === "imported",
    );
    expect(
      designedLayer?.diagram.nodes.find(({ id }) => id === mappedSourceNodeId)
        ?.status,
    ).toBe("unknown");
    expect(
      importedLayer?.diagram.nodes.find(({ id }) => id === mappedSourceNodeId)
        ?.status,
    ).toBe("matching");
    for (const layer of projected.layers.filter(
      ({ quality }) => quality.freshness !== "current",
    )) {
      expect(
        layer.diagram.nodes.every(({ status }) => status === "unknown"),
      ).toBe(true);
      expect(
        layer.diagram.edges.every(({ status }) => status === "unknown"),
      ).toBe(true);
    }

    for (const freshness of ["stale", "expired", "invalid"] as const) {
      const nonCurrentReport = structuredClone(report);
      const nonCurrentLayer = nonCurrentReport.layers.find(
        ({ layer }) => layer === "imported",
      );
      if (nonCurrentLayer === undefined) {
        throw new Error("Expected imported evidence.");
      }
      nonCurrentLayer.quality.freshness = freshness;
      nonCurrentLayer.quality.freshnessReasons = [
        freshness === "stale"
          ? "source-declared-stale"
          : freshness === "expired"
            ? "explicit-expiry-reached"
            : "source-integrity-invalid",
      ];
      if (freshness === "expired") {
        nonCurrentLayer.quality.expiresAt = utcTimestampSchema.parse(
          "2026-08-29T11:45:00.000Z",
        );
      }
      const nonCurrentProjection = projectConformanceReportV1(
        nonCurrentReport,
        projectionBinding,
      );
      expect(
        nonCurrentProjection.layers
          .find(({ state }) => state === "imported")
          ?.diagram.nodes.find(({ id }) => id === mappedSourceNodeId)?.status,
      ).toBe("unknown");
    }

    const unavailableReport = structuredClone(report);
    const unavailableLayer = unavailableReport.layers.find(
      ({ layer }) => layer === "imported",
    );
    if (unavailableLayer === undefined) {
      throw new Error("Expected imported evidence.");
    }
    unavailableLayer.availability = "unavailable";
    delete unavailableLayer.boundSolutionRevision;
    unavailableLayer.evidenceIds = [];
    unavailableLayer.facts = [];
    unavailableLayer.sources = [];
    unavailableLayer.quality = {
      completeness: "unknown",
      freshness: "invalid",
      freshnessReasons: ["evidence-unavailable"],
    };
    unavailableReport.differences = unavailableReport.differences.filter(
      ({ comparedWithLayer, layer }) =>
        layer !== "imported" && comparedWithLayer !== "imported",
    );
    const remainingDifferenceIds = new Set(
      unavailableReport.differences.map(({ differenceId }) => differenceId),
    );
    unavailableReport.issues = unavailableReport.issues.filter(
      ({ sourceRecordId }) => remainingDifferenceIds.has(sourceRecordId),
    );
    unavailableReport.provenance.sourceIds = unavailableReport.layers
      .flatMap((layer) => layer.sources.map(({ sourceId }) => sourceId))
      .sort();
    unavailableReport.provenance.inputDigests = [
      ...new Set([
        unavailableReport.currentSolutionRevision.digest,
        unavailableReport.evaluatedSolutionRevision.digest,
        ...unavailableReport.layers.flatMap((layer) =>
          layer.sources.map(({ digest }) => digest),
        ),
      ]),
    ].sort();
    const unavailableProjection = projectConformanceReportV1(
      unavailableReport,
      projectionBinding,
    );
    expect(
      unavailableProjection.layers
        .find(({ state }) => state === "imported")
        ?.diagram.nodes.find(({ id }) => id === mappedSourceNodeId)?.status,
    ).toBe("unknown");
    expect(
      unavailableProjection.layers
        .find(({ state }) => state === "imported")
        ?.diagram.nodes.every(
          ({ presence, status }) =>
            presence === "unknown" && status === "unknown",
        ),
    ).toBe(true);

    expect(
      unavailableProjection.layers
        .find(({ state }) => state === "imported")
        ?.diagram.edges.every(
          ({ presence, status }) =>
            presence === "unknown" && status === "unknown",
        ),
    ).toBe(true);

    for (const layer of projected.layers) {
      expect(layer.diagram.nodes).toHaveLength(2);
      for (const node of layer.diagram.nodes) {
        expect(node.position).toEqual(expectedPositions.get(node.id));
      }
      expect(layer.diagram.edges).toEqual([
        expect.objectContaining({
          id: expectedEdge?.id,
          presence:
            layer.state === "imported" ? "comparison-only-missing" : "present",
          sourceNodeId: expectedEdge?.sourceNodeId,
          targetNodeId: expectedEdge?.targetNodeId,
        }),
      ]);
      if (layer.state === "imported") {
        expect(
          layer.diagram.nodes.find(({ id }) => id === `node.${targetNode.id}`),
        ).toEqual(
          expect.objectContaining({
            presence: "comparison-only-missing",
            status: "different",
          }),
        );
      }
      expect(layer.evidence[0]).toEqual(
        expect.objectContaining({
          evidenceIds: [`evidence.${layer.state}`],
          provenanceId: `source.${layer.state}`,
          sourceDigest: hashCanonicalValue(`source.${layer.state}`),
        }),
      );
      expect(layer.evidence[0]?.provenanceId).not.toBe(
        layer.evidence[0]?.evidenceIds[0],
      );
      expect(layer.diagram.unmappedEvidence).toEqual([]);
    }
    const reviewable = report.differences[0];
    if (reviewable === undefined) {
      throw new Error("Expected at least one conformance difference fixture.");
    }
    const withServerActions = projectConformanceReportV1(
      report,
      {
        approvedTopology,
        environmentId: "environment_staging_1",
        projectId: "project_conformance_1",
        solutionRevisionId: evaluatedSolutionRevision.id,
      },
      [
        {
          actions: [
            {
              actionKey: "action.review.issue",
              kind: "github-issue",
            },
          ],
          differenceId: reviewable.differenceId,
        },
      ],
    );
    expect(
      withServerActions.differences.find(
        ({ differenceId }) => differenceId === reviewable.differenceId,
      )?.reviewActions,
    ).toEqual([
      {
        actionKey: "action.review.issue",
        differenceId: reviewable.differenceId,
        kind: "github-issue",
      },
    ]);
    expect(() =>
      projectConformanceReportV1(
        report,
        {
          approvedTopology,
          environmentId: "environment_staging_1",
          projectId: "project_conformance_1",
          solutionRevisionId: evaluatedSolutionRevision.id,
        },
        [
          {
            actions: [{ actionKey: "action.unknown", kind: "github-issue" }],
            differenceId: "difference.not-in-report",
          },
        ],
      ),
    ).toThrow(/does not match the verified report differences/u);
  });
});
