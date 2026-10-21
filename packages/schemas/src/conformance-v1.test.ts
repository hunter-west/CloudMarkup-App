import {
  ACTIVE_ISSUE_V1_LIMITS,
  activeIssueV1Schema,
} from "./active-issue-v1.js";
import { describe, expect, it } from "vitest";

import {
  CONFORMANCE_V1_LIMITS,
  conformanceDifferenceV1Schema,
  conformanceFactV1Schema,
  conformanceEvaluationRequestV1Schema,
  conformanceEvidenceFreshnessV1Schema,
  conformanceLayerInputV1Schema,
  conformanceLayerResultV1Schema,
  conformanceViewLayerV1Schema,
  defaultConformanceStalenessPolicyV1,
  type ConformanceEvaluationRequestV1,
  type ConformanceFactV1,
  type ConformanceLayerInputV1,
} from "./conformance-v1.js";
import { solutionLayerSchema } from "./solution-contract-common-v1.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const revision = {
  digest: digest("a"),
  id: "solution-revision-1",
} as const;
const evaluatedAt = "2026-08-29T12:00:00.000Z";
const verifiedAt = "2026-08-29T11:30:00.000Z";

const layerEvidence = {
  designed: ["approved-documents", "architecture-document"],
  imported: ["repository-snapshot", "repository-snapshot"],
  generated: ["generated-manifest", "generated-manifest"],
  planned: ["cloud-plan-change-set", "terraform-plan"],
  deployed: ["deployment-smoke-integration", "deployment-attestation"],
  "current-drift": ["read-only-drift", "read-only-drift-result"],
} as const;

function fact(
  layer: keyof typeof layerEvidence,
  stableKey = "resource.api",
): ConformanceFactV1 {
  const sourceId = `source.${layer}`;
  return conformanceFactV1Schema.parse({
    applicationBinding: "not-applicable" as const,
    evidenceIds: [`evidence.${layer}`],
    ...(layer === "current-drift"
      ? { driftClassification: "unknown" as const }
      : {}),
    extensionPoint: false,
    factId: `fact.${layer}.${stableKey}`,
    iamAccess: "not-applicable" as const,
    iamPermissions: [],
    semanticComparison: {
      basis: "resource-intent" as const,
      contractVersion: 1 as const,
      coverage: "complete" as const,
    },
    layer,
    management: "managed" as const,
    operation: "none" as const,
    ownership: "generated" as const,
    publicExposure: "private" as const,
    semanticDigest: digest("b"),
    sourceIds: [sourceId],
    sourceLocations: [],
    subject: {
      kind: "resource" as const,
      stableKey,
    },
  });
}

function layer(layerName: keyof typeof layerEvidence): ConformanceLayerInputV1 {
  const [evidenceType, sourceKind] = layerEvidence[layerName];
  return conformanceLayerInputV1Schema.parse({
    availability: "available" as const,
    boundSolutionRevision: revision,
    completeness: "complete" as const,
    declaredFreshness: "current" as const,
    evidenceIds: [`evidence.${layerName}`],
    evidenceType,
    ...(layerName === "planned" ||
    layerName === "deployed" ||
    layerName === "current-drift"
      ? { environmentId: "environment.test" }
      : {}),
    ...(layerName === "planned" || layerName === "current-drift"
      ? { explicitExpiresAt: "2026-08-29T13:00:00.000Z" }
      : {}),
    facts: [fact(layerName)],
    integrity: "verified" as const,
    layer: layerName,
    sources: [
      {
        digest: digest("c"),
        kind: sourceKind,
        observedAt: verifiedAt,
        solutionRevisionId: revision.id,
        sourceId: `source.${layerName}`,
      },
    ],
    verifiedAt,
  });
}

function resultLayer(layerName: keyof typeof layerEvidence) {
  const input = layer(layerName);
  return conformanceLayerResultV1Schema.parse({
    authority: layerName === "designed" ? "approved-design" : "evidence-only",
    availability: input.availability,
    boundSolutionRevision: input.boundSolutionRevision,
    evidenceIds: input.evidenceIds,
    evidenceType: input.evidenceType,
    ...(input.environmentId === undefined
      ? {}
      : { environmentId: input.environmentId }),
    facts: input.facts,
    layer: layerName,
    quality: {
      completeness: input.completeness,
      ...(input.explicitExpiresAt === undefined
        ? {}
        : { expiresAt: input.explicitExpiresAt }),
      freshness: "current",
      freshnessReasons: [],
      lastVerifiedAt: input.verifiedAt,
    },
    sources: input.sources,
  });
}

function request(): ConformanceEvaluationRequestV1 {
  return conformanceEvaluationRequestV1Schema.parse({
    contractVersion: 1 as const,
    currentSolutionRevision: revision,
    environment: {
      environmentId: "environment.test",
      environmentType: "test" as const,
    },
    evaluatedAt,
    evaluatedSolutionRevision: revision,
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
    ).map(layer),
    projectId: "project.test",
    stalenessPolicy: defaultConformanceStalenessPolicyV1,
  });
}

describe("continuous conformance v1 contracts", () => {
  it("fails closed on invalid complete and operation-only comparison bases", () => {
    const wrongBasis = structuredClone(fact("imported"));
    wrongBasis.semanticComparison.basis = "connection-intent";
    expect(conformanceFactV1Schema.safeParse(wrongBasis).success).toBe(false);

    const operationOutsidePlan = structuredClone(fact("imported"));
    operationOutsidePlan.semanticComparison = {
      basis: "opaque",
      contractVersion: 1,
      coverage: "operation-only",
    };
    expect(
      conformanceFactV1Schema.safeParse(operationOutsidePlan).success,
    ).toBe(false);

    const legacyFact: Record<string, unknown> = structuredClone(
      fact("imported"),
    );
    delete legacyFact["semanticComparison"];
    expect(
      conformanceFactV1Schema.parse(legacyFact).semanticComparison,
    ).toEqual({
      basis: "opaque",
      contractVersion: 1,
      coverage: "partial",
    });
  });
  it("keeps six conformance views additive to Evidence v1 layers", () => {
    expect(conformanceEvaluationRequestV1Schema.parse(request())).toBeDefined();
    expect(conformanceViewLayerV1Schema.parse("current-drift")).toBe(
      "current-drift",
    );
    expect(solutionLayerSchema.safeParse("current-drift").success).toBe(false);
    expect(conformanceEvidenceFreshnessV1Schema.options).toEqual([
      "current",
      "stale",
      "expired",
      "invalid",
    ]);
  });

  it("rejects relabeled or structurally unbound result layers", () => {
    const relabeled = structuredClone(resultLayer("designed"));
    relabeled.evidenceType = "read-only-drift";
    expect(conformanceLayerResultV1Schema.safeParse(relabeled).success).toBe(
      false,
    );

    const wrongSource = structuredClone(resultLayer("designed"));
    const source = wrongSource.sources[0];
    if (source === undefined) {
      throw new Error("Expected designed provenance.");
    }
    source.kind = "read-only-drift-result";
    expect(conformanceLayerResultV1Schema.safeParse(wrongSource).success).toBe(
      false,
    );

    const missingBinding = structuredClone(resultLayer("designed"));
    delete missingBinding.boundSolutionRevision;
    expect(
      conformanceLayerResultV1Schema.safeParse(missingBinding).success,
    ).toBe(false);

    const danglingFact = structuredClone(resultLayer("designed"));
    const fact = danglingFact.facts[0];
    if (fact === undefined) {
      throw new Error("Expected designed fact.");
    }
    fact.sourceIds = ["source.missing"];
    expect(conformanceLayerResultV1Schema.safeParse(danglingFact).success).toBe(
      false,
    );

    const duplicateFact = structuredClone(resultLayer("designed"));
    const firstFact = duplicateFact.facts[0];
    if (firstFact === undefined) {
      throw new Error("Expected designed fact.");
    }
    duplicateFact.facts.push(structuredClone(firstFact));
    expect(
      conformanceLayerResultV1Schema.safeParse(duplicateFact).success,
    ).toBe(false);

    const missingEnvironment = structuredClone(resultLayer("planned"));
    delete missingEnvironment.environmentId;
    expect(
      conformanceLayerResultV1Schema.safeParse(missingEnvironment).success,
    ).toBe(false);

    const relabeledInvalidFreshness = structuredClone(resultLayer("generated"));
    relabeledInvalidFreshness.quality.freshness = "stale";
    relabeledInvalidFreshness.quality.freshnessReasons = [
      "source-integrity-invalid",
    ];
    expect(
      conformanceLayerResultV1Schema.safeParse(relabeledInvalidFreshness)
        .success,
    ).toBe(false);
  });

  it("requires fallback staleness rules and exact available-layer provenance", () => {
    const missingFallback = structuredClone(request());
    missingFallback.stalenessPolicy.rules =
      missingFallback.stalenessPolicy.rules.slice(1);
    expect(
      conformanceEvaluationRequestV1Schema.safeParse(missingFallback).success,
    ).toBe(false);

    const missingBinding = structuredClone(request());
    delete missingBinding.layers[0]?.boundSolutionRevision;
    expect(
      conformanceEvaluationRequestV1Schema.safeParse(missingBinding).success,
    ).toBe(false);

    const danglingSource = structuredClone(request());
    const firstFact = danglingSource.layers[0]?.facts[0];
    if (firstFact !== undefined) firstFact.sourceIds = ["source.missing"];
    expect(
      conformanceEvaluationRequestV1Schema.safeParse(danglingSource).success,
    ).toBe(false);

    const missingDriftClassification = structuredClone(request());
    const driftFact = missingDriftClassification.layers
      .find(({ layer }) => layer === "current-drift")
      ?.facts.at(0);
    if (driftFact !== undefined) delete driftFact.driftClassification;
    expect(
      conformanceEvaluationRequestV1Schema.safeParse(missingDriftClassification)
        .success,
    ).toBe(false);

    const misplacedDriftClassification = structuredClone(request());
    const designedFact = misplacedDriftClassification.layers.at(0)?.facts.at(0);
    if (designedFact !== undefined)
      designedFact.driftClassification = "managed-drift";
    expect(
      conformanceEvaluationRequestV1Schema.safeParse(
        misplacedDriftClassification,
      ).success,
    ).toBe(false);

    for (const layerName of ["planned", "deployed", "current-drift"] as const) {
      const wrongEnvironment = structuredClone(request());
      const environmentLayer = wrongEnvironment.layers.find(
        ({ layer }) => layer === layerName,
      );
      if (environmentLayer === undefined)
        throw new Error("Expected environment-bound conformance layer.");
      environmentLayer.environmentId = "environment.other";
      expect(
        conformanceEvaluationRequestV1Schema.safeParse(wrongEnvironment)
          .success,
      ).toBe(false);
    }
  });

  it("accepts exact conformance reference maxima and rejects overflow", () => {
    const boundaryDifference = {
      comparedWithLayer: "designed",
      differenceDigest: digest("d"),
      differenceId: "difference.boundary",
      environmentId: "environment.test",
      evidenceIds: Array.from(
        { length: CONFORMANCE_V1_LIMITS.differenceEvidenceReferences },
        (_, index) => `evidence.boundary.${String(index)}`,
      ),
      kind: "configuration-mismatch",
      layer: "imported",
      remediation: { automatic: false, disposition: "review-required" },
      severity: "error",
      solutionRevisionId: revision.id,
      sourceIds: Array.from(
        { length: CONFORMANCE_V1_LIMITS.differenceSourceReferences },
        (_, index) => `source.boundary.${String(index)}`,
      ),
      summary: "The compared configuration differs.",
    } as const;
    expect(
      conformanceDifferenceV1Schema.parse(boundaryDifference),
    ).toBeDefined();
    expect(
      conformanceDifferenceV1Schema.safeParse({
        ...boundaryDifference,
        evidenceIds: [...boundaryDifference.evidenceIds, "evidence.overflow"],
      }).success,
    ).toBe(false);
    expect(
      conformanceDifferenceV1Schema.safeParse({
        ...boundaryDifference,
        sourceIds: [...boundaryDifference.sourceIds, "source.overflow"],
      }).success,
    ).toBe(false);

    const boundaryIssue = {
      affected: Array.from(
        { length: ACTIVE_ISSUE_V1_LIMITS.affectedReferences },
        (_, index) => ({
          evidenceId: `evidence.affected.${String(index)}`,
          kind: "evidence" as const,
        }),
      ),
      category: "verification",
      closureRequirements: [],
      contractVersion: 1,
      currentRecordDigest: digest("e"),
      id: "issue.boundary",
      lifecycle: { state: "current" },
      provenance: {
        actor: {
          kind: "deterministic-tool",
          tool: { id: "cloudmarkup.validator", version: "1.0.0" },
        },
        createdAt: evaluatedAt,
        inputDigests: [],
      },
      recordVersion: 1,
      severity: "warning",
      solutionRevisionId: revision.id,
      source: "cloud-plan-change-set",
      sourceRecordId: "difference.boundary",
      summary: "The conformance difference requires review.",
      technicalDetail: "Review the source-linked difference without mutation.",
    } as const;
    expect(activeIssueV1Schema.parse(boundaryIssue)).toBeDefined();
    expect(
      activeIssueV1Schema.safeParse({
        ...boundaryIssue,
        affected: [
          ...boundaryIssue.affected,
          { evidenceId: "evidence.affected.overflow", kind: "evidence" },
        ],
      }).success,
    ).toBe(false);
  });
  it("rejects unavailable claims, duplicate fact subjects, and unsafe text", () => {
    const unavailable = structuredClone(request());
    const unavailableLayer = unavailable.layers.at(0);
    if (unavailableLayer === undefined) {
      throw new Error("Expected the representative designed layer.");
    }
    unavailable.layers[0] = {
      ...unavailableLayer,
      availability: "unavailable",
      completeness: "unknown",
    };
    expect(
      conformanceEvaluationRequestV1Schema.safeParse(unavailable).success,
    ).toBe(false);

    const duplicate = structuredClone(request());
    const duplicateLayer = duplicate.layers.at(0);
    const duplicateFact = duplicateLayer?.facts.at(0);
    if (duplicateLayer === undefined || duplicateFact === undefined) {
      throw new Error("Expected the representative conformance fact.");
    }
    duplicateLayer.facts.push(structuredClone(duplicateFact));
    expect(
      conformanceEvaluationRequestV1Schema.safeParse(duplicate).success,
    ).toBe(false);

    const unsafeDifference = {
      comparedWithLayer: "designed",
      differenceDigest: digest("d"),
      differenceId: "difference.test",
      environmentId: "environment.test",
      evidenceIds: [],
      kind: "configuration-mismatch",
      layer: "imported",
      remediation: { automatic: false, disposition: "review-required" },
      severity: "error",
      solutionRevisionId: revision.id,
      sourceIds: [],
      summary: "password=do-not-store",
    };
    expect(
      conformanceDifferenceV1Schema.safeParse(unsafeDifference).success,
    ).toBe(false);
    expect(
      conformanceDifferenceV1Schema.safeParse({
        ...unsafeDifference,
        summary: "See https://example.invalid/private.",
      }).success,
    ).toBe(false);
  });
});
