import {
  ACTIVE_ISSUE_V1_LIMITS,
  CONFORMANCE_V1_LIMITS,
  conformanceEvaluationRequestV1Schema,
  conformanceFactV1Schema,
  conformanceLayerInputV1Schema,
  conformanceReportV1Schema,
  defaultConformanceStalenessPolicyV1,
  evidenceIdSchema,
  solutionRevisionIdSchema,
  utcTimestampSchema,
  type ConformanceEvaluationRequestV1,
  type ConformanceFactV1,
  type ConformanceLayerInputV1,
  type ConformanceViewLayerV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import { composeConformanceReportV1 } from "./conformance-composition.js";
import {
  evaluateConformanceV1,
  getConformanceDifferenceDigestV1,
  getConformanceReportDigestV1,
} from "./conformance.js";
import { hashCanonicalValue } from "./document-hashing.js";
import { getActiveIssueRecordHash } from "./solution-lifecycle.js";

const revision = {
  digest: hashCanonicalValue("solution-revision-1"),
  id: solutionRevisionIdSchema.parse("solution-revision-1"),
} as const;
const evaluatedAt = utcTimestampSchema.parse("2026-08-29T12:00:00.000Z");
const verifiedAt = utcTimestampSchema.parse("2026-08-29T11:30:00.000Z");

const layerEvidence = {
  designed: ["approved-documents", "architecture-document"],
  imported: ["repository-snapshot", "repository-snapshot"],
  generated: ["generated-manifest", "generated-manifest"],
  planned: ["cloud-plan-change-set", "terraform-plan"],
  deployed: ["deployment-smoke-integration", "deployment-attestation"],
  "current-drift": ["read-only-drift", "read-only-drift-result"],
} as const;

type FactKind = ConformanceFactV1["subject"]["kind"];
const semanticBasisByKind = {
  artifact: "artifact-binding",
  "application-contract": "application-contract-intent",
  configuration: "configuration-intent",
  connection: "connection-intent",
  "external-resource": "external-resource-intent",
  "iam-policy": "iam-policy-intent",
  "network-exposure": "network-exposure-intent",
  "repository-file": "repository-file-bytes",
  resource: "resource-intent",
  "source-ownership": "source-ownership-intent",
} as const satisfies Record<
  FactKind,
  ConformanceFactV1["semanticComparison"]["basis"]
>;

interface FactOptions {
  readonly applicationBinding?: ConformanceFactV1["applicationBinding"];
  readonly driftClassification?: ConformanceFactV1["driftClassification"];
  readonly extensionPoint?: boolean;
  readonly iamPermissions?: ConformanceFactV1["iamPermissions"];
  readonly management?: ConformanceFactV1["management"];
  readonly operation?: ConformanceFactV1["operation"];
  readonly ownership?: ConformanceFactV1["ownership"];
  readonly publicExposure?: ConformanceFactV1["publicExposure"];
  readonly repositoryFileState?: ConformanceFactV1["repositoryFileState"];
  readonly semanticComparison?: ConformanceFactV1["semanticComparison"];
  readonly semantic?: string;
}

function fact(
  layer: ConformanceViewLayerV1,
  kind: FactKind,
  stableKey: string,
  options: FactOptions = {},
): ConformanceFactV1 {
  return conformanceFactV1Schema.parse({
    applicationBinding: options.applicationBinding ?? "not-applicable",
    ...(layer === "current-drift"
      ? {
          driftClassification: options.driftClassification ?? "unknown",
        }
      : {}),
    evidenceIds: [`evidence.${layer}`],
    extensionPoint: options.extensionPoint ?? false,
    factId: `fact.${layer}.${kind}.${stableKey}`,
    iamAccess: "not-applicable" as const,
    iamPermissions: [...(options.iamPermissions ?? [])],
    layer,
    management: options.management ?? "managed",
    operation: options.operation ?? "none",
    ownership: options.ownership ?? "generated",
    publicExposure: options.publicExposure ?? "private",
    ...(options.repositoryFileState === undefined
      ? {}
      : { repositoryFileState: options.repositoryFileState }),
    semanticComparison:
      options.semanticComparison ??
      ({
        basis: semanticBasisByKind[kind],
        contractVersion: 1,
        coverage: "complete",
      } as const),
    semanticDigest: hashCanonicalValue(
      options.semantic ?? `${kind}:${stableKey}`,
    ),
    sourceIds: [`source.${layer}`],
    sourceLocations: [],
    subject: { kind, stableKey },
  });
}

function standardFacts(layer: ConformanceViewLayerV1) {
  return [
    fact(layer, "resource", "resource.api"),
    fact(layer, "connection", "connection.api-table"),
    fact(layer, "configuration", "configuration.api-timeout"),
  ];
}

function makeLayer(
  layer: ConformanceViewLayerV1,
  facts: readonly ReturnType<typeof fact>[] = standardFacts(layer),
): ConformanceLayerInputV1 {
  const [evidenceType, sourceKind] = layerEvidence[layer];
  return conformanceLayerInputV1Schema.parse({
    availability: "available" as const,
    boundSolutionRevision: revision,
    completeness: "complete" as const,
    declaredFreshness: "current" as const,
    evidenceIds: [`evidence.${layer}`],
    evidenceType,
    ...(layer === "planned" || layer === "deployed" || layer === "current-drift"
      ? { environmentId: "environment.test" }
      : {}),
    ...(layer === "planned" || layer === "current-drift"
      ? { explicitExpiresAt: "2026-08-29T13:00:00.000Z" }
      : {}),
    facts: [...facts],
    integrity: "verified" as const,
    layer,
    sources: [
      {
        digest: hashCanonicalValue(`source:${layer}`),
        kind: sourceKind,
        observedAt: verifiedAt,
        solutionRevisionId: revision.id,
        sourceId: `source.${layer}`,
      },
    ],
    verifiedAt,
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
    ).map((layer) =>
      makeLayer(layer, layer === "current-drift" ? [] : standardFacts(layer)),
    ),
    projectId: "project.test",
    stalenessPolicy: structuredClone(defaultConformanceStalenessPolicyV1),
  });
}

function replaceLayer(
  input: ReturnType<typeof request>,
  layerName: ConformanceViewLayerV1,
  replacement: ReturnType<typeof makeLayer>,
) {
  return {
    ...input,
    layers: input.layers.map((layer) =>
      layer.layer === layerName ? replacement : layer,
    ),
  };
}

function composeAt(
  input: ReturnType<typeof request>,
  at: string,
  previousIssues: Parameters<
    typeof composeConformanceReportV1
  >[0]["previousIssues"] = [],
) {
  const {
    currentSolutionRevision,
    evaluatedAt: _evaluatedAt,
    evaluator,
    stalenessPolicy,
    ...evaluation
  } = input;
  void _evaluatedAt;
  return composeConformanceReportV1({
    clock: () => new Date(at),
    currentSolutionRevision,
    evaluation,
    evaluator,
    previousIssues,
    stalenessPolicy,
  });
}

function differenceKinds(input: unknown) {
  return new Set(
    evaluateConformanceV1(input).differences.map(({ kind }) => kind),
  );
}

describe("continuous conformance evaluator", () => {
  it("classifies exact resource, connection, and configuration matches", () => {
    const report = evaluateConformanceV1(request());
    expect(new Set(report.differences.map(({ kind }) => kind))).toEqual(
      new Set([
        "matching-resource",
        "matching-connection",
        "matching-configuration",
      ]),
    );
    expect(report.issues).toEqual([]);
    expect(report.layers.map(({ layer }) => layer)).toEqual([
      "designed",
      "imported",
      "generated",
      "planned",
      "deployed",
      "current-drift",
    ]);
  });

  it("preserves maximum layer Evidence and both semantic source sets", () => {
    const evidenceInput = structuredClone(request());
    const planned = evidenceInput.layers.find(
      ({ layer }) => layer === "planned",
    );
    if (planned === undefined) {
      throw new Error("Expected planned conformance input.");
    }
    planned.completeness = "partial";
    planned.evidenceIds = [
      evidenceIdSchema.parse("evidence.planned"),
      ...Array.from(
        { length: CONFORMANCE_V1_LIMITS.layerEvidenceReferences - 1 },
        (_, index) =>
          evidenceIdSchema.parse(
            `evidence.planned.${index.toString().padStart(4, "0")}`,
          ),
      ),
    ];

    const evidenceReport = evaluateConformanceV1(evidenceInput);
    const partialDifference = evidenceReport.differences.find(
      ({ kind, layer }) => kind === "partial-evidence" && layer === "planned",
    );
    if (partialDifference === undefined) {
      throw new Error("Expected the planned partial-Evidence difference.");
    }
    const partialIssue = evidenceReport.issues.find(
      ({ sourceRecordId }) => sourceRecordId === partialDifference.differenceId,
    );
    if (partialIssue === undefined) {
      throw new Error("Expected an issue for partial planned Evidence.");
    }
    expect(partialDifference.evidenceIds).toHaveLength(
      CONFORMANCE_V1_LIMITS.layerEvidenceReferences,
    );
    expect(partialIssue.affected).toHaveLength(
      CONFORMANCE_V1_LIMITS.layerEvidenceReferences + 2,
    );
    expect(partialIssue.affected.length).toBeLessThanOrEqual(
      ACTIVE_ISSUE_V1_LIMITS.affectedReferences,
    );

    const sourceInput = structuredClone(request());
    const comparedLayers = ["designed", "imported"] as const;
    const comparedSourceDigests: string[] = [];
    for (const layerName of comparedLayers) {
      const sourceLayer = sourceInput.layers.find(
        ({ layer }) => layer === layerName,
      );
      if (sourceLayer === undefined) {
        throw new Error("Expected a semantic comparison layer.");
      }
      const sourceKind = layerEvidence[layerName][1];
      sourceLayer.sources = Array.from(
        { length: CONFORMANCE_V1_LIMITS.layerSourceReferences },
        (_, index) => ({
          digest: hashCanonicalValue(`source:${layerName}:${String(index)}`),
          kind: sourceKind,
          observedAt: verifiedAt,
          solutionRevisionId: revision.id,
          sourceId:
            index === 0
              ? `source.${layerName}`
              : `source.${layerName}.${index.toString().padStart(3, "0")}`,
        }),
      );
      comparedSourceDigests.push(
        ...sourceLayer.sources.map(({ digest }) => digest),
      );
    }
    const importedResource = sourceInput.layers
      .find(({ layer }) => layer === "imported")
      ?.facts.find(({ subject }) => subject.stableKey === "resource.api");
    if (importedResource === undefined) {
      throw new Error("Expected the imported resource fact.");
    }
    importedResource.semanticDigest = hashCanonicalValue("changed-resource");

    const sourceReport = evaluateConformanceV1(sourceInput);
    const sourceDifference = sourceReport.differences.find(
      ({ kind, layer }) => kind === "resource-mismatch" && layer === "imported",
    );
    if (sourceDifference === undefined) {
      throw new Error("Expected the imported resource mismatch.");
    }
    const sourceIssue = sourceReport.issues.find(
      ({ sourceRecordId }) => sourceRecordId === sourceDifference.differenceId,
    );
    if (sourceIssue === undefined) {
      throw new Error("Expected an issue for the imported resource mismatch.");
    }
    expect(sourceDifference.sourceIds).toHaveLength(
      CONFORMANCE_V1_LIMITS.differenceSourceReferences,
    );
    expect(sourceIssue.provenance.inputDigests).toContain(
      hashCanonicalValue({
        contractVersion: 1,
        kind: "cloudmarkup.conformance-issue-source-set",
        sourceDigests: comparedSourceDigests.sort(),
      }),
    );
  });
  it("reports unknown evidence instead of comparing incompatible semantic digests", () => {
    let input = request();
    input = replaceLayer(
      input,
      "imported",
      makeLayer("imported", [
        fact("imported", "resource", "resource.api", {
          semantic: "target-specific-observation",
          semanticComparison: {
            basis: "opaque",
            contractVersion: 1,
            coverage: "partial",
          },
        }),
        ...standardFacts("imported").slice(1),
      ]),
    );

    const relevant = evaluateConformanceV1(input).differences.filter(
      ({ layer, subject }) =>
        layer === "imported" && subject?.stableKey === "resource.api",
    );

    expect(relevant).toContainEqual(
      expect.objectContaining({ kind: "unknown-evidence" }),
    );
    expect(
      relevant.some(
        ({ kind }) =>
          kind === "matching-resource" || kind === "resource-mismatch",
      ),
    ).toBe(false);
  });

  it("keeps plan operations authoritative while treating operation-only semantics as unknown", () => {
    let input = request();
    input = replaceLayer(
      input,
      "planned",
      makeLayer("planned", [
        fact("planned", "resource", "resource.api", {
          operation: "update",
          semantic: "target-specific-plan-change",
          semanticComparison: {
            basis: "opaque",
            contractVersion: 1,
            coverage: "operation-only",
          },
        }),
        ...standardFacts("planned").slice(1),
      ]),
    );

    const relevant = evaluateConformanceV1(input).differences.filter(
      ({ layer, subject }) =>
        layer === "planned" && subject?.stableKey === "resource.api",
    );

    expect(relevant).toContainEqual(
      expect.objectContaining({ kind: "plan-update" }),
    );
    expect(relevant).toContainEqual(
      expect.objectContaining({ kind: "unknown-evidence" }),
    );
    expect(
      relevant.some(
        ({ kind }) =>
          kind === "matching-resource" || kind === "resource-mismatch",
      ),
    ).toBe(false);
  });

  it("treats an empty complete current-drift delta as verified no drift", () => {
    const report = evaluateConformanceV1(request());
    expect(
      report.differences.filter(({ layer }) => layer === "current-drift"),
    ).toEqual([]);
  });

  it("covers designed, imported, generated, planned, IAM, network, ownership, and binding differences", () => {
    let input = request();
    input = replaceLayer(
      input,
      "imported",
      makeLayer("imported", [
        fact("imported", "resource", "resource.api", {
          ownership: "imported",
          semantic: "resource-mismatch",
        }),
        fact("imported", "connection", "connection.api-table", {
          semantic: "wrong-direction",
        }),
        fact("imported", "configuration", "configuration.api-timeout", {
          semantic: "wrong-timeout",
        }),
        fact("imported", "resource", "resource.observed-only"),
        fact("imported", "external-resource", "external.orphan", {
          management: "unmanaged",
        }),
      ]),
    );
    input = replaceLayer(
      input,
      "generated",
      makeLayer("generated", [
        fact("generated", "resource", "resource.api", {
          semantic: "generated-drift",
        }),
        ...standardFacts("generated").slice(1),
        fact("generated", "application-contract", "contract.upload", {
          applicationBinding: "mismatch",
        }),
      ]),
    );
    const baselineExtras = [
      fact("designed", "resource", "resource.plan-missing"),
      fact("designed", "iam-policy", "iam.processor", {
        iamPermissions: [
          {
            actionDigest: hashCanonicalValue("read"),
            effect: "allow",
            resourceDigest: hashCanonicalValue("bucket"),
          },
          {
            actionDigest: hashCanonicalValue("write"),
            effect: "allow",
            resourceDigest: hashCanonicalValue("table"),
          },
        ],
      }),
      fact("designed", "network-exposure", "network.api", {
        publicExposure: "private",
      }),
    ];
    input = replaceLayer(
      input,
      "designed",
      makeLayer("designed", [...standardFacts("designed"), ...baselineExtras]),
    );
    input = replaceLayer(
      input,
      "planned",
      makeLayer("planned", [
        fact("planned", "resource", "resource.api", { operation: "create" }),
        fact("planned", "connection", "connection.api-table", {
          operation: "update",
        }),
        fact("planned", "configuration", "configuration.api-timeout", {
          operation: "delete",
        }),
        fact("planned", "artifact", "artifact.processor", {
          operation: "replace",
        }),
        fact("planned", "iam-policy", "iam.processor", {
          iamPermissions: [
            {
              actionDigest: hashCanonicalValue("write"),
              effect: "allow",
              resourceDigest: hashCanonicalValue("table"),
            },
            {
              actionDigest: hashCanonicalValue("delete"),
              effect: "allow",
              resourceDigest: hashCanonicalValue("table"),
            },
          ],
        }),
        fact("planned", "network-exposure", "network.api", {
          publicExposure: "public",
        }),
      ]),
    );
    input = replaceLayer(
      input,
      "deployed",
      makeLayer("deployed", standardFacts("deployed").slice(0, 2)),
    );

    const classified = evaluateConformanceV1(input);
    const kinds = new Set(classified.differences.map(({ kind }) => kind));
    expect([...kinds]).toEqual(
      expect.arrayContaining([
        "designed-missing-from-repository",
        "designed-missing-from-plan",
        "designed-missing-from-deployment",
        "observed-but-not-designed",
        "connection-mismatch",
        "configuration-mismatch",
        "resource-mismatch",
        "generated-drift-from-source",
        "plan-create",
        "plan-update",
        "plan-delete",
        "plan-replace",
        "iam-expansion",
        "iam-reduction",
        "network-public-exposure-change",
        "external-unmanaged-resource",
        "ownership-import-mismatch",
        "application-contract-binding-mismatch",
      ]),
    );
    expect(classified.issues).toHaveLength(
      classified.differences.filter(({ kind }) => !kind.startsWith("matching-"))
        .length,
    );
    for (const issue of classified.issues) {
      expect(issue.currentRecordDigest).toBe(getActiveIssueRecordHash(issue));
      expect(issue.deterministicFix).toBeUndefined();
      expect(issue.aiProposedFix).toBeUndefined();
      expect(issue.affected).toContainEqual({
        kind: "solution-revision",
        solutionRevisionId: revision.id,
      });
    }
  });

  it("surfaces external and unmanaged imported resources as distinct differences", () => {
    let input = request();
    input = replaceLayer(
      input,
      "imported",
      makeLayer("imported", [
        ...standardFacts("imported"),
        fact("imported", "external-resource", "external.managed-elsewhere", {
          management: "external",
        }),
        fact("imported", "external-resource", "external.orphan", {
          management: "unmanaged",
        }),
      ]),
    );

    const differences = evaluateConformanceV1(input).differences.filter(
      ({ kind }) => kind === "external-unmanaged-resource",
    );
    expect(differences).toHaveLength(2);
    expect(
      new Set(differences.map(({ subject }) => subject?.stableKey)),
    ).toEqual(new Set(["external.managed-elsewhere", "external.orphan"]));
    expect(new Set(differences.map(({ summary }) => summary))).toEqual(
      new Set([
        "external-resource external.managed-elsewhere is external evidence.",
        "external-resource external.orphan is unmanaged evidence.",
      ]),
    );
    expect(
      new Set(differences.map(({ differenceId }) => differenceId)),
    ).toHaveProperty("size", 2);
  });

  it("classifies managed, unmanaged, permission, network, application, external, and unknown current drift", () => {
    let input = request();
    const deployed = [
      fact("deployed", "resource", "resource.api"),
      fact("deployed", "iam-policy", "iam.processor"),
      fact("deployed", "network-exposure", "network.api"),
      fact("deployed", "application-contract", "contract.upload"),
    ];
    input = replaceLayer(input, "deployed", makeLayer("deployed", deployed));
    input = replaceLayer(
      input,
      "current-drift",
      makeLayer("current-drift", [
        fact("current-drift", "resource", "resource.api", {
          driftClassification: "managed-drift",
          semantic: "managed-change",
        }),
        fact("current-drift", "iam-policy", "iam.processor", {
          driftClassification: "permission-drift",
          semantic: "permission-change",
        }),
        fact("current-drift", "network-exposure", "network.api", {
          driftClassification: "network-drift",
          publicExposure: "public",
          semantic: "network-change",
        }),
        fact("current-drift", "application-contract", "contract.upload", {
          applicationBinding: "mismatch",
          driftClassification: "application-binding-drift",
          semantic: "binding-change",
        }),
        fact("current-drift", "external-resource", "external.unmanaged", {
          driftClassification: "unmanaged-resource",
          management: "unmanaged",
          operation: "update",
        }),
        fact("current-drift", "external-resource", "external.approved", {
          driftClassification: "external-resource",
          management: "external",
          operation: "update",
        }),
        fact("current-drift", "resource", "resource.unknown", {
          driftClassification: "unknown",
          operation: "unknown",
        }),
      ]),
    );
    expect([...differenceKinds(input)]).toEqual(
      expect.arrayContaining([
        "managed-drift",
        "unmanaged-resource-drift",
        "permission-drift",
        "network-drift",
        "application-binding-drift",
        "external-unmanaged-resource",
        "unknown-drift",
      ]),
    );
  });

  it("preserves approved user extension points during repository comparison", () => {
    let input = request();
    input = replaceLayer(
      input,
      "imported",
      makeLayer("imported", [
        fact("imported", "resource", "resource.api", {
          extensionPoint: true,
          ownership: "user-extension",
          semantic: "reviewed-user-extension",
        }),
        ...standardFacts("imported").slice(1),
      ]),
    );
    const kinds = differenceKinds(input);
    expect(kinds.has("ownership-import-mismatch")).toBe(false);
    expect(kinds.has("resource-mismatch")).toBe(false);
  });

  it("carries deterministic generated-file drift while preserving approved repository extensions", () => {
    let input = request();
    input = replaceLayer(
      input,
      "imported",
      makeLayer("imported", [
        ...standardFacts("imported"),
        fact("imported", "repository-file", "repository-file.generated", {
          ownership: "generated",
          repositoryFileState: "generated-file-drift",
          semantic: "edited-generated-file",
        }),
        fact("imported", "repository-file", "repository-file.extension", {
          extensionPoint: true,
          ownership: "user-extension",
          semantic: "approved-user-content",
        }),
      ]),
    );

    const report = evaluateConformanceV1(input);
    const generatedDrift = report.differences.find(
      ({ kind, subject }) =>
        kind === "generated-drift-from-source" &&
        subject?.stableKey === "repository-file.generated",
    );
    expect(generatedDrift?.comparedWithLayer).toBe("generated");
    expect(generatedDrift?.layer).toBe("imported");
    expect(
      report.differences.some(
        ({ subject }) => subject?.stableKey === "repository-file.extension",
      ),
    ).toBe(false);
  });

  it("does not derive generated-file drift from stale or invalid generated evidence", () => {
    for (const generatedQuality of ["invalid", "stale"] as const) {
      let input = request();
      input = replaceLayer(
        input,
        "imported",
        makeLayer("imported", [
          ...standardFacts("imported"),
          fact("imported", "repository-file", "repository-file.generated", {
            ownership: "generated",
            repositoryFileState: "generated-file-drift",
            semantic: "edited-generated-file",
          }),
        ]),
      );
      const generated = makeLayer("generated", [
        ...standardFacts("generated"),
        fact("generated", "repository-file", "repository-file.generated", {
          ownership: "generated",
          semantic: "reviewed-generated-file",
        }),
      ]);
      if (generatedQuality === "invalid") {
        generated.integrity = "invalid";
        generated.invalidReason =
          "Generated manifest checksum verification failed.";
      } else {
        generated.declaredFreshness = "stale";
        generated.verifiedAt = utcTimestampSchema.parse(
          "2026-08-27T11:00:00.000Z",
        );
        const generatedSource = generated.sources[0];
        if (generatedSource === undefined) {
          throw new Error("Expected generated source provenance.");
        }
        generatedSource.observedAt = utcTimestampSchema.parse(
          "2026-08-27T10:30:00.000Z",
        );
      }
      input = replaceLayer(input, "generated", generated);

      const report = evaluateConformanceV1(input);
      expect(
        report.differences.some(
          ({ kind, subject }) =>
            kind === "generated-drift-from-source" &&
            subject?.stableKey === "repository-file.generated",
        ),
      ).toBe(false);
      expect(report.differences).toContainEqual(
        expect.objectContaining({
          kind:
            generatedQuality === "invalid"
              ? "invalid-evidence"
              : "stale-evidence",
          layer: "generated",
        }),
      );
    }
  });

  it("marks partial, unknown, stale, expired, invalid, and superseded evidence without fabricating absence", () => {
    let input = request();
    const imported = makeLayer("imported", []);
    imported.completeness = "partial";
    imported.verifiedAt = utcTimestampSchema.parse("2026-08-27T11:00:00.000Z");
    const importedSource = imported.sources[0];
    if (importedSource === undefined) {
      throw new Error("Expected imported source provenance.");
    }
    importedSource.observedAt = utcTimestampSchema.parse(
      "2026-08-27T10:30:00.000Z",
    );
    input = replaceLayer(input, "imported", imported);
    const generated = makeLayer("generated");
    generated.integrity = "invalid";
    generated.invalidReason =
      "Generated manifest checksum verification failed.";
    input = replaceLayer(input, "generated", generated);
    const planned = makeLayer("planned");
    planned.explicitExpiresAt = evaluatedAt;
    input = replaceLayer(input, "planned", planned);
    const deployed = makeLayer("deployed");
    deployed.completeness = "unknown";
    input = replaceLayer(input, "deployed", deployed);

    const report = evaluateConformanceV1(input);
    const kinds = new Set(report.differences.map(({ kind }) => kind));
    expect([...kinds]).toEqual(
      expect.arrayContaining([
        "partial-evidence",
        "unknown-evidence",
        "stale-evidence",
        "expired-evidence",
        "invalid-evidence",
      ]),
    );
    expect(kinds.has("designed-missing-from-repository")).toBe(false);

    const newer = structuredClone(request());
    newer.currentSolutionRevision = {
      digest: hashCanonicalValue("solution-revision-2"),
      id: solutionRevisionIdSchema.parse("solution-revision-2"),
    };
    const superseded = evaluateConformanceV1(newer);
    for (const layer of superseded.layers.filter(({ layer }) =>
      ["generated", "planned", "deployed", "current-drift"].includes(layer),
    )) {
      expect(layer.quality.freshness).toBe("invalid");
      expect(layer.quality.freshnessReasons).toContain(
        "newer-solution-revision",
      );
    }
    expect(
      superseded.layers.find(({ layer }) => layer === "designed")?.quality
        .freshness,
    ).toBe("current");
    const historicalImported = superseded.layers.find(
      ({ layer }) => layer === "imported",
    );
    expect(historicalImported?.quality.freshness).toBe("current");
    expect(historicalImported?.quality.freshnessReasons).not.toContain(
      "newer-solution-revision",
    );
    expect(defaultConformanceStalenessPolicyV1.rules).toContainEqual(
      expect.objectContaining({
        evidenceType: "repository-snapshot",
        invalidatedByNewerRevision: false,
      }),
    );

    const wrongBinding = request();
    const wrongImported = makeLayer("imported");
    wrongImported.boundSolutionRevision = {
      digest: hashCanonicalValue("different-revision"),
      id: solutionRevisionIdSchema.parse("solution-revision-other"),
    };
    wrongImported.sources = wrongImported.sources.map((source) => ({
      ...source,
      solutionRevisionId: solutionRevisionIdSchema.parse(
        "solution-revision-other",
      ),
    }));
    const wrongReport = evaluateConformanceV1(
      replaceLayer(wrongBinding, "imported", wrongImported),
    );
    const importedQuality = wrongReport.layers.find(
      ({ layer }) => layer === "imported",
    )?.quality;
    expect(importedQuality?.freshness).toBe("invalid");
    expect(importedQuality?.freshnessReasons).toContain(
      "solution-revision-mismatch",
    );
  });
  it("keeps an expired plan visible when verification occurs after expiry and its sources predate expiry", () => {
    const planned = makeLayer("planned");
    planned.explicitExpiresAt = utcTimestampSchema.parse(
      "2026-08-29T12:00:00.000Z",
    );
    planned.verifiedAt = utcTimestampSchema.parse("2026-08-29T12:30:00.000Z");
    const input = replaceLayer(request(), "planned", planned);

    const composition = composeAt(input, "2026-08-29T13:00:00.000Z");
    const quality = composition.report.layers.find(
      ({ layer }) => layer === "planned",
    )?.quality;
    expect(quality?.freshness).toBe("expired");
    expect(quality?.freshnessReasons).toContain("explicit-expiry-reached");
    expect(composition.report.differences).toContainEqual(
      expect.objectContaining({
        kind: "expired-evidence",
        layer: "planned",
      }),
    );

    const incoherent = makeLayer("planned");
    incoherent.explicitExpiresAt = verifiedAt;
    incoherent.verifiedAt = utcTimestampSchema.parse(
      "2026-08-29T12:30:00.000Z",
    );
    expect(() =>
      composeAt(
        replaceLayer(request(), "planned", incoherent),
        "2026-08-29T13:00:00.000Z",
      ),
    ).toThrow(/source observation time/u);
  });

  it("creates a new current issue and stales the prior record when security-significant difference content changes", () => {
    const designed = makeLayer("designed", [
      ...standardFacts("designed"),
      fact("designed", "network-exposure", "network.api", {
        publicExposure: "none",
      }),
    ]);
    const firstPlanned = makeLayer("planned", [
      ...standardFacts("planned"),
      fact("planned", "network-exposure", "network.api", {
        publicExposure: "public",
      }),
    ]);
    let firstInput = replaceLayer(request(), "designed", designed);
    firstInput = replaceLayer(firstInput, "planned", firstPlanned);
    const first = composeAt(firstInput, evaluatedAt);
    const firstDifference = first.report.differences.find(
      ({ kind, subject }) =>
        kind === "network-public-exposure-change" &&
        subject?.stableKey === "network.api",
    );
    const firstIssue = first.report.issues.find(
      ({ sourceRecordId }) => sourceRecordId === firstDifference?.differenceId,
    );
    if (firstDifference === undefined || firstIssue === undefined) {
      throw new Error("Expected the first network exposure issue.");
    }
    expect(firstIssue.severity).toBe("security-error");
    expect(firstIssue.affected).toContainEqual({
      evidenceId: "evidence.planned",
      kind: "evidence",
    });

    const changedNetwork = fact("planned", "network-exposure", "network.api", {
      publicExposure: "private",
    });
    const changedPlanned = makeLayer("planned", [
      ...standardFacts("planned"),
      changedNetwork,
    ]);
    const changedNetworkFact = changedPlanned.facts.find(
      ({ subject }) => subject.stableKey === "network.api",
    );
    if (changedNetworkFact === undefined) {
      throw new Error("Expected the changed network exposure fact.");
    }
    changedNetworkFact.evidenceIds = [
      evidenceIdSchema.parse("evidence.planned.changed"),
    ];
    changedPlanned.evidenceIds = [
      evidenceIdSchema.parse("evidence.planned"),
      evidenceIdSchema.parse("evidence.planned.changed"),
    ];
    let changedInput = replaceLayer(request(), "designed", designed);
    changedInput = replaceLayer(changedInput, "planned", changedPlanned);
    const changed = composeAt(
      changedInput,
      "2026-08-29T12:10:00.000Z",
      first.report.issues,
    );
    const changedDifference = changed.report.differences.find(
      ({ kind, subject }) =>
        kind === "network-public-exposure-change" &&
        subject?.stableKey === "network.api",
    );
    const changedIssue = changed.report.issues.find(
      ({ sourceRecordId }) =>
        sourceRecordId === changedDifference?.differenceId,
    );
    if (changedDifference === undefined || changedIssue === undefined) {
      throw new Error("Expected the changed network exposure issue.");
    }

    expect(changedDifference.differenceDigest).not.toBe(
      firstDifference.differenceDigest,
    );
    expect(changedIssue.id).not.toBe(firstIssue.id);
    expect(changedIssue.severity).toBe("warning");
    expect(changedIssue.affected).toContainEqual({
      evidenceId: "evidence.planned.changed",
      kind: "evidence",
    });
    const currentUpdate = changed.issueHistoryUpdates.find(
      ({ id }) => id === changedIssue.id,
    );
    const staleUpdate = changed.issueHistoryUpdates.find(
      ({ id }) => id === firstIssue.id,
    );
    if (currentUpdate === undefined || staleUpdate === undefined) {
      throw new Error("Expected current and stale issue history updates.");
    }
    expect(currentUpdate.lifecycle).toEqual({ state: "current" });
    expect(staleUpdate.affected).toContainEqual({
      evidenceId: "evidence.planned",
      kind: "evidence",
    });
    expect(staleUpdate.lifecycle.state).toBe("stale");
    expect(staleUpdate.previousRecordDigest).toBe(
      firstIssue.currentRecordDigest,
    );
    expect(staleUpdate.recordVersion).toBe(firstIssue.recordVersion + 1);
  });

  it("rejects relabeled, unbound, or internally inconsistent report projections", () => {
    const requireLayer = (
      report: ReturnType<typeof evaluateConformanceV1>,
      layerName: ConformanceViewLayerV1,
    ) => {
      const layer = report.layers.find(({ layer }) => layer === layerName);
      if (layer === undefined) {
        throw new Error("Expected the requested conformance result layer.");
      }
      return layer;
    };
    const requireSource = (
      report: ReturnType<typeof evaluateConformanceV1>,
      layerName: ConformanceViewLayerV1,
    ) => {
      const source = requireLayer(report, layerName).sources[0];
      if (source === undefined) {
        throw new Error("Expected the requested conformance source.");
      }
      return source;
    };
    const requireFact = (
      report: ReturnType<typeof evaluateConformanceV1>,
      layerName: ConformanceViewLayerV1,
    ) => {
      const fact = requireLayer(report, layerName).facts[0];
      if (fact === undefined) {
        throw new Error("Expected the requested conformance fact.");
      }
      return fact;
    };
    const mutations: ((
      report: ReturnType<typeof evaluateConformanceV1>,
    ) => void)[] = [
      (report) => {
        requireLayer(report, "designed").evidenceType = "read-only-drift";
      },
      (report) => {
        requireSource(report, "designed").kind = "read-only-drift-result";
      },
      (report) => {
        delete requireLayer(report, "designed").boundSolutionRevision;
      },
      (report) => {
        const binding = requireLayer(report, "designed").boundSolutionRevision;
        if (binding === undefined) {
          throw new Error("Expected the designed revision binding.");
        }
        binding.digest = hashCanonicalValue("forged-layer-revision");
      },
      (report) => {
        requireLayer(report, "designed").availability = "unavailable";
      },
      (report) => {
        requireLayer(report, "planned").environmentId = "environment.other";
      },
      (report) => {
        requireSource(report, "designed").solutionRevisionId =
          solutionRevisionIdSchema.parse("solution-revision-other");
      },
      (report) => {
        requireSource(report, "imported").observedAt = utcTimestampSchema.parse(
          "2026-08-29T12:01:00.000Z",
        );
      },
      (report) => {
        const planned = requireLayer(report, "planned");
        planned.quality.expiresAt = utcTimestampSchema.parse(
          "2026-08-29T11:45:00.000Z",
        );
        planned.quality.freshness = "stale";
        planned.quality.freshnessReasons = ["source-declared-stale"];
      },
      (report) => {
        requireFact(report, "designed").layer = "imported";
      },
      (report) => {
        requireFact(report, "designed").sourceIds = ["source.unknown"];
      },
      (report) => {
        const layer = requireLayer(report, "designed");
        layer.facts.push(structuredClone(requireFact(report, "designed")));
      },
      (report) => {
        report.provenance.sourceIds.pop();
      },
      (report) => {
        requireSource(report, "imported").sourceId = requireSource(
          report,
          "designed",
        ).sourceId;
      },
      (report) => {
        const imported = requireLayer(report, "imported");
        const designed = requireLayer(report, "designed");
        imported.evidenceIds = [...designed.evidenceIds];
      },
      (report) => {
        const difference = report.differences[0];
        if (difference === undefined) {
          throw new Error("Expected a conformance difference.");
        }
        difference.sourceIds = ["source.uncontained"];
      },
    ];
    for (const mutate of mutations) {
      const report = structuredClone(evaluateConformanceV1(request()));
      mutate(report);
      expect(conformanceReportV1Schema.safeParse(report).success).toBe(false);
    }

    const inputWithIssue = structuredClone(request());
    const imported = inputWithIssue.layers.find(
      ({ layer }) => layer === "imported",
    );
    if (imported === undefined) {
      throw new Error("Expected imported conformance input.");
    }
    imported.facts = [];
    const missingIssue = structuredClone(evaluateConformanceV1(inputWithIssue));
    expect(missingIssue.issues.length).toBeGreaterThan(0);
    missingIssue.issues.pop();
    expect(conformanceReportV1Schema.safeParse(missingIssue).success).toBe(
      false,
    );

    const wrongIssue = structuredClone(evaluateConformanceV1(inputWithIssue));
    const issue = wrongIssue.issues[0];
    const matchingDifference = wrongIssue.differences.find(({ kind }) =>
      kind.startsWith("matching-"),
    );
    if (issue === undefined || matchingDifference === undefined) {
      throw new Error("Expected issue and matching difference lineage.");
    }
    issue.sourceRecordId = matchingDifference.differenceId;
    expect(conformanceReportV1Schema.safeParse(wrongIssue).success).toBe(false);
  });
  it("fails closed on dangling fact links and forged current-issue projections", () => {
    const reportWithPlannedIssue = () => {
      const input = structuredClone(request());
      const planned = input.layers.find(({ layer }) => layer === "planned");
      if (planned === undefined) {
        throw new Error("Expected planned conformance input.");
      }
      planned.facts = [];
      return structuredClone(evaluateConformanceV1(input));
    };
    const requirePlannedDifference = (
      report: ReturnType<typeof evaluateConformanceV1>,
    ) => {
      const difference = report.differences.find(
        ({ kind, layer }) =>
          layer === "planned" && !kind.startsWith("matching-"),
      );
      if (difference === undefined) {
        throw new Error("Expected a planned conformance difference.");
      }
      return difference;
    };
    const requireIssue = (report: ReturnType<typeof evaluateConformanceV1>) => {
      const difference = requirePlannedDifference(report);
      const issue = report.issues.find(
        ({ sourceRecordId }) => sourceRecordId === difference.differenceId,
      );
      if (issue === undefined) {
        throw new Error("Expected the planned conformance issue.");
      }
      return issue;
    };

    const invalidMutations: ((
      report: ReturnType<typeof evaluateConformanceV1>,
    ) => void)[] = [
      (report) => {
        requirePlannedDifference(report).leftFactId = "fact.missing";
      },
      (report) => {
        requirePlannedDifference(report).rightFactId = "fact.missing";
      },
      (report) => {
        const difference = requirePlannedDifference(report);
        difference.subject = {
          kind: "resource",
          stableKey: "resource.missing",
        };
      },
      (report) => {
        requireIssue(report).source = "deployed-drift";
      },
      (report) => {
        requireIssue(report).severity = "recommendation";
      },
      (report) => {
        requireIssue(report).summary = "A forged issue summary.";
      },
      (report) => {
        requireIssue(report).lifecycle = {
          reason: "No longer current.",
          staleAt: evaluatedAt,
          state: "stale",
        };
      },
      (report) => {
        const issue = requireIssue(report);
        issue.affected = issue.affected.filter(
          ({ kind }) => kind !== "solution-revision",
        );
      },
      (report) => {
        const issue = requireIssue(report);
        issue.affected = issue.affected.filter(
          ({ kind }) => kind !== "evidence",
        );
      },
      (report) => {
        const issue = requireIssue(report);
        issue.affected = issue.affected.filter(
          ({ kind }) => kind !== "environment",
        );
      },
      (report) => {
        requireIssue(report).affected.push({
          artifactId: "artifact.unrelated",
          kind: "artifact",
        });
      },
    ];
    for (const mutate of invalidMutations) {
      const report = reportWithPlannedIssue();
      mutate(report);
      expect(conformanceReportV1Schema.safeParse(report).success).toBe(false);
    }

    const linked = reportWithPlannedIssue();
    const linkedDifference = requirePlannedDifference(linked);
    const resolvingFact = linked.layers
      .find(({ layer }) => layer === "designed")
      ?.facts.find(
        ({ subject }) =>
          subject.kind === linkedDifference.subject?.kind &&
          subject.stableKey === linkedDifference.subject.stableKey,
      );
    if (resolvingFact === undefined) {
      throw new Error(
        "Expected the designed fact referenced by the difference.",
      );
    }
    linkedDifference.leftFactId = resolvingFact.factId;
    linkedDifference.rightFactId = resolvingFact.factId;
    expect(conformanceReportV1Schema.safeParse(linked).success).toBe(true);

    const independentCreatedAt = reportWithPlannedIssue();
    requireIssue(independentCreatedAt).provenance.createdAt =
      utcTimestampSchema.parse("2026-08-29T11:59:00.000Z");
    expect(
      conformanceReportV1Schema.safeParse(independentCreatedAt).success,
    ).toBe(true);
  });

  it("is deterministic, immutable, digest-verifiable, clock-free, and never auto-remediates", () => {
    const input = request();
    const before = JSON.stringify(input);
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("The evaluator must not read the process clock.");
    });
    const first = evaluateConformanceV1(input);
    now.mockRestore();
    const reordered = structuredClone(input);
    reordered.layers.reverse();
    reordered.layers.forEach((layer) => {
      layer.facts.reverse();
      layer.sources.reverse();
      layer.evidenceIds.reverse();
    });
    reordered.stalenessPolicy.rules.reverse();
    const second = evaluateConformanceV1(reordered);

    expect(second).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
    expect(first.reportDigest).toBe(getConformanceReportDigestV1(first));
    for (const difference of first.differences) {
      expect(difference.differenceDigest).toBe(
        getConformanceDifferenceDigestV1(difference),
      );
      expect(difference.remediation.automatic).toBe(false);
    }
    for (const issue of first.issues) {
      expect(issue.currentRecordDigest).toBe(getActiveIssueRecordHash(issue));
      expect(issue.deterministicFix).toBeUndefined();
      expect(issue.aiProposedFix).toBeUndefined();
      expect(issue.affected).toContainEqual({
        kind: "solution-revision",
        solutionRevisionId: revision.id,
      });
    }
  });
});
