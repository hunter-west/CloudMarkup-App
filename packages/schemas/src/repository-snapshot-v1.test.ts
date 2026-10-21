import { describe, expect, it } from "vitest";

import {
  repositoryCommitShaSchema,
  repositorySnapshotV1Schema,
} from "./repository-snapshot-v1.js";
import { normalizeRepositorySnapshotV1 } from "./solution-normalization.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const commitSha = "1".repeat(40);

const snapshot = {
  schemaVersion: 1,
  snapshotId: "snapshot_1",
  source: {
    kind: "integration",
    integrationId: "cloudmarkup.github",
    owner: "example-owner",
    name: "example-repository",
  },
  revision: {
    selector: { kind: "branch", name: "feature/reconcile" },
    commitSha,
  },
  importedAt: "2026-08-14T12:00:00.000Z",
  importer: {
    importerId: "cloudmarkup.repository-importer",
    importerVersion: "1.0.0",
  },
  selectedPaths: [{ ruleId: "selection_1", path: ".", scope: "subtree" }],
  ignoreRules: [
    {
      ruleId: "ignore_1",
      path: "vendor",
      scope: "subtree",
      reason: "Third-party vendored content is excluded.",
    },
  ],
  files: [
    {
      path: "infrastructure/main.tf",
      checksum: digest("2"),
      sizeBytes: 1_024,
      detectedKinds: ["infrastructure-as-code"],
    },
    {
      path: "application/src/handler.unknown",
      checksum: digest("3"),
      sizeBytes: 128,
      detectedKinds: ["application-source"],
    },
  ],
  detectedTypes: [
    {
      category: "iac",
      typeId: "cloudmarkup.iac.terraform",
      detectorId: "cloudmarkup.repository-detector",
      detectorVersion: "1.0.0",
      evidenceIds: ["evidence_resource"],
    },
  ],
  redaction: {
    status: "applied",
    redactedFileCount: 1,
    redactedValueCount: 1,
    categories: ["secret-candidate"],
  },
  sizeLimits: {
    status: "within-limits",
    configured: {
      maximumFileCount: 5_000,
      maximumFileBytes: 5_000_000,
      maximumTotalBytes: 100_000_000,
    },
    scannedFileCount: 2,
    scannedBytes: 1_152,
    includedFileCount: 2,
    excludedFileCount: 0,
  },
  evidence: [
    {
      evidenceId: "evidence_resource",
      path: "infrastructure/main.tf",
      fileChecksum: digest("2"),
      location: { startLine: 1, endLine: 4 },
      evidenceKind: "declaration",
      factDigest: digest("4"),
    },
    {
      evidenceId: "evidence_dependency",
      path: "infrastructure/main.tf",
      fileChecksum: digest("2"),
      location: { startLine: 6, endLine: 6, startColumn: 3, endColumn: 30 },
      evidenceKind: "reference",
      factDigest: digest("5"),
    },
  ],
  parseFindings: [
    {
      findingId: "finding_resource",
      parserId: "cloudmarkup.terraform-parser",
      parserVersion: "1.0.0",
      category: "resource",
      status: "confirmed",
      severity: "information",
      summary: "A deterministically parsed infrastructure resource was found.",
      certainty: { kind: "deterministic", confidence: 1 },
      evidenceIds: ["evidence_resource"],
    },
  ],
  inferredRelationships: [
    {
      relationshipId: "relationship_candidate",
      sourceObservationKey: "observed_function",
      targetObservationKey: "observed_table",
      relationshipType: "cloudmarkup.relationship.reads",
      confidence: 0.75,
      evidenceIds: ["evidence_dependency"],
    },
  ],
  unsupportedFiles: [
    {
      path: "application/src/handler.unknown",
      checksum: digest("3"),
      reason: "unsupported-type",
      detail: "No reviewed parser supports this application file type.",
    },
  ],
  snapshotDigest: digest("6"),
} as const;

describe("Repository Snapshot v1 schema", () => {
  it("accepts an exact revision with bounded parse and redaction evidence", () => {
    expect(repositorySnapshotV1Schema.parse(snapshot)).toEqual(snapshot);
  });

  it("requires a full immutable commit SHA", () => {
    expect(repositoryCommitShaSchema.parse(commitSha)).toBe(commitSha);
    expect(repositoryCommitShaSchema.parse("a".repeat(64))).toBe(
      "a".repeat(64),
    );
    expect(repositoryCommitShaSchema.safeParse("1".repeat(12)).success).toBe(
      false,
    );
    expect(repositoryCommitShaSchema.safeParse("A".repeat(40)).success).toBe(
      false,
    );
  });

  it("rejects repository credentials and unsafe selected paths by closure", () => {
    expect(
      repositorySnapshotV1Schema.safeParse({
        ...snapshot,
        source: { ...snapshot.source, credential: "github-token" },
      }).success,
    ).toBe(false);
    expect(
      repositorySnapshotV1Schema.safeParse({
        ...snapshot,
        selectedPaths: [
          { ruleId: "selection_1", path: "../outside", scope: "subtree" },
        ],
      }).success,
    ).toBe(false);
  });

  it("binds source evidence and unsupported files to exact checksums", () => {
    expect(
      repositorySnapshotV1Schema.safeParse({
        ...snapshot,
        evidence: [
          { ...snapshot.evidence[0], fileChecksum: digest("9") },
          snapshot.evidence[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      repositorySnapshotV1Schema.safeParse({
        ...snapshot,
        unsupportedFiles: [
          { ...snapshot.unsupportedFiles[0], checksum: digest("9") },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects dangling evidence, duplicate paths, and inaccurate limits", () => {
    expect(
      repositorySnapshotV1Schema.safeParse({
        ...snapshot,
        parseFindings: [
          { ...snapshot.parseFindings[0], evidenceIds: ["missing_evidence"] },
        ],
      }).success,
    ).toBe(false);
    expect(
      repositorySnapshotV1Schema.safeParse({
        ...snapshot,
        files: [snapshot.files[0], snapshot.files[0]],
      }).success,
    ).toBe(false);
    expect(
      repositorySnapshotV1Schema.safeParse({
        ...snapshot,
        sizeLimits: { ...snapshot.sizeLimits, includedFileCount: 1 },
      }).success,
    ).toBe(false);
  });

  it("rejects future versions and arbitrary raw source fields", () => {
    expect(
      repositorySnapshotV1Schema.safeParse({ ...snapshot, schemaVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      repositorySnapshotV1Schema.safeParse({
        ...snapshot,
        sourceText: "resource secret {}",
      }).success,
    ).toBe(false);
  });
});

describe("Repository Snapshot v1 canonical normalization", () => {
  it("sorts unordered repository evidence without mutating the parsed input", () => {
    const parsed = repositorySnapshotV1Schema.parse(snapshot);
    const reordered = repositorySnapshotV1Schema.parse({
      ...parsed,
      selectedPaths: [...parsed.selectedPaths].reverse(),
      ignoreRules: [...parsed.ignoreRules].reverse(),
      files: [...parsed.files].reverse().map((file) => ({
        ...file,
        detectedKinds: [...file.detectedKinds].reverse(),
      })),
      detectedTypes: [...parsed.detectedTypes].reverse().map((detected) => ({
        ...detected,
        evidenceIds: [...detected.evidenceIds].reverse(),
      })),
      redaction: {
        ...parsed.redaction,
        categories: [...parsed.redaction.categories].reverse(),
      },
      evidence: [...parsed.evidence].reverse(),
      parseFindings: [...parsed.parseFindings].reverse().map((finding) => ({
        ...finding,
        evidenceIds: [...finding.evidenceIds].reverse(),
      })),
      inferredRelationships: [...parsed.inferredRelationships]
        .reverse()
        .map((relationship) => ({
          ...relationship,
          evidenceIds: [...relationship.evidenceIds].reverse(),
        })),
      unsupportedFiles: [...parsed.unsupportedFiles].reverse(),
    });
    const before = JSON.stringify(reordered);

    expect(normalizeRepositorySnapshotV1(reordered)).toEqual(
      normalizeRepositorySnapshotV1(parsed),
    );
    expect(JSON.stringify(reordered)).toBe(before);
  });
});
