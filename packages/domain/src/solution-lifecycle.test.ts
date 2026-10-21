import { describe, expect, it } from "vitest";

import {
  SolutionLifecycleValidationError,
  getActiveIssueRecordHash,
  getSolutionRevisionManifestContentHash,
  hasCurrentEvidenceAtExactLevel,
  validateActiveIssueTransitionV1,
  validateEvidenceCollectionV1,
  validateSolutionGenerationCoverageV1,
  validateSolutionRevisionManifestIntrinsicV1,
  validateSolutionRevisionManifestWithEvidenceV1,
} from "./index.js";

const digest = `sha256:${"a".repeat(64)}`;
const timestamp = "2026-08-14T12:00:00Z";

interface EvidenceFixtureOptions {
  readonly checkId?: string;
  readonly generationCoverageRequirement?: string;
  readonly issueIds?: readonly string[];
  readonly layer?: string;
  readonly level?: { readonly kind: string; readonly rank: number };
  readonly solutionRevisionId?: string;
  readonly staleness?: Readonly<Record<string, unknown>>;
  readonly status?: "passed" | "failed" | "skipped" | "error";
}

function evidence(id = "evidence-1", options: EvidenceFixtureOptions = {}) {
  return {
    artifacts: [],
    checks: [
      {
        artifactDigests: [],
        checkId: options.checkId ?? "cloudmarkup.structural-validation",
        ...(options.generationCoverageRequirement === undefined
          ? {}
          : {
              generationCoverageRequirement:
                options.generationCoverageRequirement,
            }),
        issueIds: options.issueIds ?? [],
        status: options.status ?? "passed",
        summary: "The deterministic evidence check completed.",
      },
    ],
    contractVersion: 1,
    environment: { environmentType: "test" },
    id,
    layer: options.layer ?? "designed",
    level: options.level ?? { kind: "structural-validity", rank: 1 },
    models: [],
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: { id: "cloudmarkup.validator", version: "1.0.0" },
      },
      createdAt: timestamp,
      inputDigests: [digest],
    },
    solutionRevisionId: options.solutionRevisionId ?? "solution-1",
    staleness: options.staleness ?? { assessedAt: timestamp, state: "current" },
    tools: [],
  };
}

function issueRecord() {
  const placeholder = {
    affected: [{ kind: "solution-revision", solutionRevisionId: "solution-1" }],
    category: "structure",
    closureRequirements: [
      {
        description: "Require exact structural validation evidence.",
        evidenceCheckId: "cloudmarkup.structural-validation",
        evidenceLevel: { kind: "structural-validity", rank: 1 },
      },
    ],
    contractVersion: 1,
    currentRecordDigest: digest,
    id: "issue-1",
    lifecycle: { state: "current" },
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: { id: "cloudmarkup.validator", version: "1.0.0" },
      },
      createdAt: timestamp,
      inputDigests: [digest],
    },
    recordVersion: 1,
    severity: "error",
    solutionRevisionId: "solution-1",
    source: "schema-graph-validation",
    sourceRecordId: "finding-1",
    summary: "A required reference is missing.",
    technicalDetail: "The exact referenced identifier is not present.",
  } as const;

  return {
    ...placeholder,
    currentRecordDigest: getActiveIssueRecordHash(placeholder),
  };
}

function resolvedIssue(evidenceIds: readonly string[] = ["evidence-1"]) {
  const previous = issueRecord();
  const nextPlaceholder = {
    ...previous,
    currentRecordDigest: digest,
    lifecycle: {
      evidenceIds: [...evidenceIds],
      reason: "Exact structural evidence proves the finding is closed.",
      resolvedAt: timestamp,
      resolvedBy: "actor-1",
      state: "resolved",
    },
    previousRecordDigest: previous.currentRecordDigest,
    recordVersion: 2,
  } as const;
  return {
    next: {
      ...nextPlaceholder,
      currentRecordDigest: getActiveIssueRecordHash(nextPlaceholder),
    },
    previous,
  };
}

function validManifest() {
  return {
    aiExtensionIds: [],
    architecture: {
      contentHash: digest,
      documentHash: digest,
      documentKind: "cloudmarkup.architecture-document",
      revisionId: "architecture-revision-1",
      schemaVersion: 3,
      visualHash: digest,
    },
    assumptions: [],
    contractVersion: 1,
    contracts: {
      contentHash: digest,
      contractVersion: 1,
      recordHashes: [],
    },
    createdAt: timestamp,
    createdBy: "actor-1",
    evidenceIdsAtFreeze: ["evidence-1"],
    externalResources: { contentHash: digest, contractVersion: 1 },
    generationCoverage: {
      contractVersion: 1,
      evidence: [],
      missingRequirements: [],
      solutionRevisionId: "solution-1",
      state: "infrastructure-only",
      workloads: [],
    },
    intent: {
      reason: "This solution began from a reviewed blank design.",
      state: "not-applicable",
    },
    issueIdsAtFreeze: [],
    kind: "cloudmarkup.solution-revision-manifest",
    repositoryObservations: [],
    solutionRevisionId: "solution-1",
    sourceOwnership: [
      {
        conflictBehavior: "replace-exact-owned-content",
        ownerId: "generator-1",
        ownership: "generated",
        path: "infrastructure/main.tf",
      },
    ],
    unresolvedDecisionIds: [],
    versions: {
      applicationGenerator: {
        reason: "No application source was generated.",
        state: "not-applicable",
      },
      catalog: {
        digest,
        id: "catalog.example",
        version: "1.0.0",
      },
      compiler: {
        reason: "Compilation has not run.",
        state: "not-applicable",
      },
      diagramRenderer: {
        reason: "Diagram rendering has not run.",
        state: "not-applicable",
      },
      importer: {
        reason: "No repository snapshot is included.",
        state: "not-applicable",
      },
      modelPrompt: {
        reason: "No model-authored extension is included.",
        state: "not-applicable",
      },
      policy: [],
    },
    workload: { contentHash: digest, contractVersion: 2 },
  } as const;
}
function manifestWithCoverage(requirement: string, evidenceId = "evidence-1") {
  const manifest = validManifest();
  return {
    ...manifest,
    evidenceIdsAtFreeze: [evidenceId],
    generationCoverage: {
      ...manifest.generationCoverage,
      evidence: [{ evidenceId, requirement }],
    },
  };
}

function lifecycleIssueCodes(run: () => unknown): readonly string[] {
  try {
    run();
    return [];
  } catch (error) {
    if (error instanceof SolutionLifecycleValidationError) {
      return error.issues.map((issue) => issue.code);
    }
    throw error;
  }
}
describe("solution lifecycle deterministic authority", () => {
  it("does not infer missing evidence levels from a higher coverage claim", () => {
    expect(() =>
      validateSolutionGenerationCoverageV1({
        contractVersion: 1,
        evidence: [],
        missingRequirements: [],
        solutionRevisionId: "solution-1",
        state: "complete-supported-pattern",
        workloads: [],
      }),
    ).toThrow(SolutionLifecycleValidationError);

    expect(
      validateSolutionGenerationCoverageV1({
        contractVersion: 1,
        evidence: [],
        missingRequirements: [],
        solutionRevisionId: "solution-1",
        state: "infrastructure-only",
        workloads: [],
      }).state,
    ).toBe("infrastructure-only");
  });

  it("validates intrinsic coverage references before hashing a frozen manifest", () => {
    const manifest = validManifest();
    const overstated = {
      ...manifest,
      generationCoverage: {
        ...manifest.generationCoverage,
        state: "complete-supported-pattern",
      },
    } as const;

    expect(() =>
      validateSolutionRevisionManifestIntrinsicV1(overstated),
    ).toThrow(SolutionLifecycleValidationError);
    expect(() => getSolutionRevisionManifestContentHash(overstated)).toThrow(
      SolutionLifecycleValidationError,
    );

    const unfrozenEvidence = {
      ...manifest,
      generationCoverage: {
        ...manifest.generationCoverage,
        evidence: [
          {
            evidenceId: "evidence-2",
            requirement: "structural-validity",
          },
        ],
      },
    } as const;
    expect(() =>
      validateSolutionRevisionManifestIntrinsicV1(unfrozenEvidence),
    ).toThrow(SolutionLifecycleValidationError);
    expect(() =>
      validateSolutionRevisionManifestIntrinsicV1({
        ...unfrozenEvidence,
        evidenceIdsAtFreeze: ["evidence-1", "evidence-1", "evidence-2"],
      }),
    ).toThrow(SolutionLifecycleValidationError);

    const frozen = {
      ...unfrozenEvidence,
      evidenceIdsAtFreeze: ["evidence-1", "evidence-2"],
    } as const;
    expect(validateSolutionRevisionManifestIntrinsicV1(frozen)).toBeDefined();
    expect(getSolutionRevisionManifestContentHash(frozen)).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });
  it("keeps intrinsic manifest hashing separate from external Evidence completeness", () => {
    const manifest = validManifest();

    expect(validateSolutionRevisionManifestIntrinsicV1(manifest)).toBeDefined();
    expect(getSolutionRevisionManifestContentHash(manifest)).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(
      lifecycleIssueCodes(() =>
        validateSolutionRevisionManifestWithEvidenceV1(manifest, {
          contractVersion: 1,
          records: [],
        }),
      ),
    ).toContain("evidence-record-missing");
  });

  it("accepts only exact mapped Evidence level kinds for coverage requirements", () => {
    const mappings = [
      {
        evidenceId: "evidence-structural",
        layer: "designed",
        level: { kind: "structural-validity", rank: 1 },
        requirement: "structural-validity",
      },
      {
        evidenceId: "evidence-provider",
        layer: "designed",
        level: { kind: "provider-architecture-validity", rank: 2 },
        requirement: "provider-architecture-validity",
      },
      {
        evidenceId: "evidence-infrastructure",
        layer: "generated",
        level: { kind: "deterministic-target-compilation", rank: 3 },
        requirement: "deterministic-infrastructure-compilation",
      },
      {
        evidenceId: "evidence-ai-extension",
        layer: "generated",
        level: { kind: "ai-extension-parse-static-validity", rank: 4 },
        requirement: "ai-extension-parse-static-validity",
      },
      {
        evidenceId: "evidence-build",
        layer: "generated",
        level: { kind: "application-build-and-tests", rank: 5 },
        requirement: "application-build-and-tests",
      },
      {
        evidenceId: "evidence-application-generation",
        layer: "generated",
        level: { kind: "deterministic-target-compilation", rank: 3 },
        requirement: "deterministic-application-generation",
      },
      {
        evidenceId: "evidence-security",
        layer: "generated",
        level: { kind: "application-build-and-tests", rank: 5 },
        requirement: "application-security-checks",
      },
    ] as const;

    mappings.forEach(({ evidenceId, layer, level, requirement }) => {
      const validated = validateSolutionRevisionManifestWithEvidenceV1(
        manifestWithCoverage(requirement, evidenceId),
        {
          contractVersion: 1,
          records: [
            evidence(evidenceId, {
              checkId: `cloudmarkup.${requirement}`,
              generationCoverageRequirement: requirement,
              layer,
              level,
            }),
          ],
        },
      );
      expect(validated.manifest.solutionRevisionId).toBe("solution-1");
      expect(validated.evidenceCollection.records[0]?.id).toBe(evidenceId);
    });
  });

  it("rejects missing or duplicate records for frozen and coverage Evidence IDs", () => {
    expect(
      lifecycleIssueCodes(() =>
        validateSolutionRevisionManifestWithEvidenceV1(
          manifestWithCoverage("structural-validity", "evidence-invented"),
          { contractVersion: 1, records: [] },
        ),
      ),
    ).toContain("evidence-record-missing");

    expect(
      lifecycleIssueCodes(() =>
        validateSolutionRevisionManifestWithEvidenceV1(validManifest(), {
          contractVersion: 1,
          records: [evidence(), evidence()],
        }),
      ),
    ).toContain("duplicate-evidence-id");
  });

  it("rejects wrong-revision, stale, and non-passing referenced Evidence", () => {
    const manifest = manifestWithCoverage("structural-validity");

    expect(
      lifecycleIssueCodes(() =>
        validateSolutionRevisionManifestWithEvidenceV1(manifest, {
          contractVersion: 1,
          records: [
            evidence("evidence-1", {
              solutionRevisionId: "solution-other",
            }),
          ],
        }),
      ),
    ).toContain("evidence-revision-mismatch");

    expect(
      lifecycleIssueCodes(() =>
        validateSolutionRevisionManifestWithEvidenceV1(manifest, {
          contractVersion: 1,
          records: [
            evidence("evidence-1", {
              staleness: {
                assessedAt: timestamp,
                reason: "The bound source revision changed.",
                staleAt: timestamp,
                state: "stale",
              },
            }),
          ],
        }),
      ),
    ).toContain("evidence-stale");

    (["failed", "skipped", "error"] as const).forEach((status) => {
      expect(
        lifecycleIssueCodes(() =>
          validateSolutionRevisionManifestWithEvidenceV1(manifest, {
            contractVersion: 1,
            records: [evidence("evidence-1", { status })],
          }),
        ),
      ).toContain("evidence-check-not-passed");
    });
  });

  it("rejects an Evidence record whose exact level kind does not match coverage", () => {
    expect(
      lifecycleIssueCodes(() =>
        validateSolutionRevisionManifestWithEvidenceV1(
          manifestWithCoverage("structural-validity"),
          {
            contractVersion: 1,
            records: [
              evidence("evidence-1", {
                layer: "designed",
                level: {
                  kind: "provider-architecture-validity",
                  rank: 2,
                },
              }),
            ],
          },
        ),
      ),
    ).toContain("evidence-level-kind-mismatch");
  });

  it("requires a matching passed check claim when coverage requirements share a level", () => {
    [
      {
        claimed: "deterministic-infrastructure-compilation",
        level: { kind: "deterministic-target-compilation", rank: 3 },
        required: "deterministic-application-generation",
      },
      {
        claimed: "application-build-and-tests",
        level: { kind: "application-build-and-tests", rank: 5 },
        required: "application-security-checks",
      },
    ].forEach(({ claimed, level, required }) => {
      expect(
        lifecycleIssueCodes(() =>
          validateSolutionRevisionManifestWithEvidenceV1(
            manifestWithCoverage(required),
            {
              contractVersion: 1,
              records: [
                evidence("evidence-1", {
                  checkId: `cloudmarkup.${claimed}`,
                  generationCoverageRequirement: claimed,
                  layer: "generated",
                  level,
                }),
              ],
            },
          ),
        ),
      ).toContain("coverage-requirement-check-missing");
    });
  });
  it("rejects duplicate evidence identities and requires exact current evidence", () => {
    expect(() =>
      validateEvidenceCollectionV1({
        contractVersion: 1,
        records: [evidence(), evidence()],
      }),
    ).toThrow(SolutionLifecycleValidationError);

    const record = validateEvidenceCollectionV1({
      contractVersion: 1,
      records: [evidence()],
    }).records[0];
    expect(record).toBeDefined();
    expect(
      hasCurrentEvidenceAtExactLevel(
        record === undefined ? [] : [record],
        "solution-1",
        1,
      ),
    ).toBe(true);
    expect(
      hasCurrentEvidenceAtExactLevel(
        record === undefined ? [] : [record],
        "solution-1",
        2,
      ),
    ).toBe(false);
  });

  it("accepts only immutable issue transitions backed by exact current closure Evidence", () => {
    const { next, previous } = resolvedIssue();
    const evidenceCollection = {
      contractVersion: 1,
      records: [evidence("evidence-1", { issueIds: ["issue-1"] })],
    };

    expect(
      validateActiveIssueTransitionV1(previous, next, evidenceCollection),
    ).toEqual(next);
    expect(
      lifecycleIssueCodes(() =>
        validateActiveIssueTransitionV1(previous, next),
      ),
    ).toContain("issue-resolution-evidence-collection-required");
    expect(() =>
      validateActiveIssueTransitionV1(
        previous,
        {
          ...next,
          previousRecordDigest: digest,
        },
        evidenceCollection,
      ),
    ).toThrow(SolutionLifecycleValidationError);
    const rewrittenOrigin = {
      ...next,
      currentRecordDigest: digest,
      sourceRecordId: "finding-2",
    };
    expect(() =>
      validateActiveIssueTransitionV1(
        previous,
        {
          ...rewrittenOrigin,
          currentRecordDigest: getActiveIssueRecordHash(rewrittenOrigin),
        },
        evidenceCollection,
      ),
    ).toThrow(SolutionLifecycleValidationError);

    const weakenedPlaceholder = {
      ...next,
      closureRequirements: [],
      currentRecordDigest: digest,
    } as const;
    const weakened = {
      ...weakenedPlaceholder,
      currentRecordDigest: getActiveIssueRecordHash(weakenedPlaceholder),
    };
    expect(
      lifecycleIssueCodes(() =>
        validateActiveIssueTransitionV1(previous, weakened, evidenceCollection),
      ),
    ).toContain("issue-closure-requirements-mismatch");
  });

  it("rejects incomplete, unrelated, stale, failed, or ordinal-substituted closure Evidence", () => {
    const { next, previous } = resolvedIssue();
    const collection = (record: unknown) => ({
      contractVersion: 1,
      records: record === undefined ? [] : [record],
    });

    const duplicate = resolvedIssue(["evidence-1", "evidence-1"]).next;
    expect(
      lifecycleIssueCodes(() =>
        validateActiveIssueTransitionV1(
          previous,
          duplicate,
          collection(evidence("evidence-1", { issueIds: ["issue-1"] })),
        ),
      ),
    ).toContain("duplicate-issue-resolution-evidence-id");

    const missing = resolvedIssue(["evidence-missing"]).next;
    expect(
      lifecycleIssueCodes(() =>
        validateActiveIssueTransitionV1(
          previous,
          missing,
          collection(undefined),
        ),
      ),
    ).toContain("evidence-record-missing");

    expect(
      lifecycleIssueCodes(() =>
        validateActiveIssueTransitionV1(
          previous,
          next,
          collection(
            evidence("evidence-1", {
              issueIds: ["issue-1"],
              solutionRevisionId: "solution-other",
            }),
          ),
        ),
      ),
    ).toContain("evidence-revision-mismatch");

    expect(
      lifecycleIssueCodes(() =>
        validateActiveIssueTransitionV1(
          previous,
          next,
          collection(
            evidence("evidence-1", {
              issueIds: ["issue-1"],
              staleness: {
                assessedAt: timestamp,
                reason: "The validated input changed.",
                staleAt: timestamp,
                state: "stale",
              },
            }),
          ),
        ),
      ),
    ).toContain("evidence-stale");

    expect(
      lifecycleIssueCodes(() =>
        validateActiveIssueTransitionV1(
          previous,
          next,
          collection(
            evidence("evidence-1", {
              issueIds: ["issue-1"],
              status: "failed",
            }),
          ),
        ),
      ),
    ).toContain("evidence-check-not-passed");

    expect(
      lifecycleIssueCodes(() =>
        validateActiveIssueTransitionV1(previous, next, collection(evidence())),
      ),
    ).toContain("issue-resolution-evidence-not-linked");

    expect(
      lifecycleIssueCodes(() =>
        validateActiveIssueTransitionV1(
          previous,
          next,
          collection(
            evidence("evidence-1", {
              checkId: "cloudmarkup.unrelated-structural-check",
              issueIds: ["issue-1"],
            }),
          ),
        ),
      ),
    ).toContain("issue-closure-requirement-unsatisfied");

    expect(
      lifecycleIssueCodes(() =>
        validateActiveIssueTransitionV1(
          previous,
          next,
          collection(
            evidence("evidence-1", {
              issueIds: ["issue-1"],
              layer: "designed",
              level: {
                kind: "provider-architecture-validity",
                rank: 2,
              },
            }),
          ),
        ),
      ),
    ).toContain("issue-closure-requirement-unsatisfied");
  });
});
