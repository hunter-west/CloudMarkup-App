import { describe, expect, it } from "vitest";

import { observedSolutionV1Schema } from "./observed-solution-v1.js";
import { normalizeObservedSolutionV1 } from "./solution-normalization.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

const observed = {
  contractVersion: 1,
  kind: "cloudmarkup.observed-solution",
  observedSolutionId: "observed_solution_1",
  designAuthority: "none",
  mutationPolicy: "reviewed-reconciliation-required",
  provenance: {
    repositorySnapshotId: "snapshot_1",
    repositorySnapshotDigest: digest("1"),
    commitSha: "2".repeat(40),
    importedAt: "2026-08-14T12:00:00.000Z",
    importerId: "cloudmarkup.repository-importer",
    importerVersion: "1.0.0",
  },
  evidence: [
    {
      sourceEvidenceId: "evidence_function",
      path: "application/src/handler.ts",
      fileChecksum: digest("3"),
      location: { startLine: 1, endLine: 12 },
    },
    {
      sourceEvidenceId: "evidence_dependency",
      path: "application/src/handler.ts",
      fileChecksum: digest("3"),
      location: { startLine: 8, endLine: 8 },
    },
    {
      sourceEvidenceId: "evidence_external",
      path: "application/src/client.ts",
      fileChecksum: digest("4"),
      location: { startLine: 3, endLine: 5 },
    },
    {
      sourceEvidenceId: "evidence_generated",
      path: "application/src/generated.ts",
      fileChecksum: digest("5"),
      location: { startLine: 1, endLine: 1 },
    },
  ],
  resources: [
    {
      observedResourceId: "observed_function",
      capability: "cloudmarkup.capability.compute",
      resourceType: "cloudmarkup.resource.function",
      providerId: "cloudmarkup.provider.aws",
      serviceFamily: "cloudmarkup.service.lambda",
      certainty: { kind: "deterministic", confidence: 1 },
      sourceEvidenceIds: ["evidence_function"],
      designComparison: {
        state: "conflicts-with-approved-design",
        target: { kind: "architecture-node", nodeId: "node_function" },
        conflictKind: "configuration-mismatch",
        summary: "The observed runtime differs from the approved design.",
      },
    },
  ],
  externalResources: [
    {
      candidateId: "external_candidate_api",
      capability: "cloudmarkup.capability.http-api",
      ownershipCandidate: "third-party-service-api",
      certainty: {
        kind: "inferred",
        confidence: 0.8,
        methodId: "cloudmarkup.import.inference",
        methodVersion: "1.0.0",
      },
      sourceEvidenceIds: ["evidence_external"],
      designComparison: { state: "no-approved-match" },
    },
  ],
  connections: [
    {
      observedConnectionId: "observed_connection_api",
      source: {
        kind: "resource",
        observedResourceId: "observed_function",
      },
      target: {
        kind: "external-resource",
        candidateId: "external_candidate_api",
      },
      relationshipType: "cloudmarkup.relationship.calls",
      certainty: {
        kind: "inferred",
        confidence: 0.75,
        methodId: "cloudmarkup.import.inference",
        methodVersion: "1.0.0",
      },
      sourceEvidenceIds: ["evidence_dependency"],
      designComparison: { state: "no-approved-match" },
    },
  ],
  workloads: [
    {
      observedWorkloadId: "observed_workload_1",
      owningObservedResourceId: "observed_function",
      runtimeFamily: "cloudmarkup.runtime.nodejs",
      languageFamily: "cloudmarkup.language.typescript",
      entrypoints: ["application/src/handler.ts"],
      applicationRelationshipIds: ["observed_connection_api"],
      certainty: { kind: "deterministic", confidence: 1 },
      sourceEvidenceIds: ["evidence_function", "evidence_dependency"],
      designComparison: {
        state: "matches-approved-design",
        target: { kind: "workload", workloadId: "workload_1" },
      },
    },
  ],
  generatedFileOwnership: [
    {
      observedGeneratedFileId: "observed_generated_file_1",
      path: "application/src/generated.ts",
      checksum: digest("5"),
      ownership: "generated",
      generatorId: "cloudmarkup.application-generator",
      generatorVersion: "1.0.0",
      certainty: { kind: "deterministic", confidence: 1 },
      sourceEvidenceIds: ["evidence_generated"],
      designComparison: { state: "not-compared" },
    },
  ],
  observedContentHash: digest("6"),
} as const;

describe("Observed Solution v1 schema", () => {
  it("accepts deterministic and inferred repository evidence separately from design", () => {
    expect(observedSolutionV1Schema.parse(observed)).toEqual(observed);
  });

  it("makes the layer evidence-only and unable to carry mutation commands", () => {
    expect(
      observedSolutionV1Schema.safeParse({
        ...observed,
        designAuthority: "canonical",
      }).success,
    ).toBe(false);
    expect(
      observedSolutionV1Schema.safeParse({
        ...observed,
        graphCommands: [],
      }).success,
    ).toBe(false);
    expect(
      observedSolutionV1Schema.safeParse({
        ...observed,
        architectureDocument: { schemaVersion: 3 },
      }).success,
    ).toBe(false);
  });

  it("requires confidence below certainty for inferred relationships", () => {
    const connection = observed.connections[0];
    expect(
      observedSolutionV1Schema.safeParse({
        ...observed,
        connections: [
          {
            ...connection,
            certainty: {
              kind: "inferred",
              confidence: 1,
              methodId: "cloudmarkup.import.inference",
              methodVersion: "1.0.0",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects dangling evidence and observed relationship references", () => {
    expect(
      observedSolutionV1Schema.safeParse({
        ...observed,
        workloads: [
          {
            ...observed.workloads[0],
            sourceEvidenceIds: ["missing_evidence"],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      observedSolutionV1Schema.safeParse({
        ...observed,
        connections: [
          {
            ...observed.connections[0],
            target: {
              kind: "external-resource",
              candidateId: "missing_external",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe source paths, future versions, and secret fields", () => {
    expect(
      observedSolutionV1Schema.safeParse({
        ...observed,
        evidence: [
          { ...observed.evidence[0], path: "../outside" },
          ...observed.evidence.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      observedSolutionV1Schema.safeParse({ ...observed, contractVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      observedSolutionV1Schema.safeParse({ ...observed, credentials: "no" })
        .success,
    ).toBe(false);
  });
});

describe("Observed Solution v1 canonical normalization", () => {
  it("sorts evidence and observed-layer references without changing authority", () => {
    const parsed = observedSolutionV1Schema.parse(observed);
    const reordered = observedSolutionV1Schema.parse({
      ...parsed,
      evidence: [...parsed.evidence].reverse(),
      resources: [...parsed.resources].reverse().map((resource) => ({
        ...resource,
        sourceEvidenceIds: [...resource.sourceEvidenceIds].reverse(),
      })),
      connections: [...parsed.connections].reverse().map((connection) => ({
        ...connection,
        sourceEvidenceIds: [...connection.sourceEvidenceIds].reverse(),
      })),
      workloads: [...parsed.workloads].reverse().map((workload) => ({
        ...workload,
        entrypoints: [...workload.entrypoints].reverse(),
        applicationRelationshipIds: [
          ...workload.applicationRelationshipIds,
        ].reverse(),
        sourceEvidenceIds: [...workload.sourceEvidenceIds].reverse(),
      })),
      externalResources: [...parsed.externalResources]
        .reverse()
        .map((resource) => ({
          ...resource,
          sourceEvidenceIds: [...resource.sourceEvidenceIds].reverse(),
        })),
      generatedFileOwnership: [...parsed.generatedFileOwnership]
        .reverse()
        .map((record) => ({
          ...record,
          sourceEvidenceIds: [...record.sourceEvidenceIds].reverse(),
        })),
    });
    const before = JSON.stringify(reordered);

    expect(normalizeObservedSolutionV1(reordered)).toEqual(
      normalizeObservedSolutionV1(parsed),
    );
    expect(normalizeObservedSolutionV1(reordered).designAuthority).toBe("none");
    expect(JSON.stringify(reordered)).toBe(before);
  });
});
