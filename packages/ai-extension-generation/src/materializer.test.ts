import { describe, expect, it } from "vitest";

import { materializeCandidateBundle } from "./materializer.js";
import { sha256Text } from "./security.js";

const sourceReference = {
  digest: sha256Text("solution-contract"),
  kind: "solution-contract",
  referenceId: "solution-contract-1",
} as const;

const validationExpectations = [
  {
    checkId: "extension.parse",
    kind: "parse",
    required: true,
    successCondition: "must-pass",
    toolProfileId: "cloudmarkup.extension-static",
  },
] as const;

function fileCandidate(
  path: string,
  content: string,
  candidateId = "candidate-1",
) {
  return {
    candidateId,
    content,
    contentDigest: sha256Text(content),
    encoding: "utf-8",
    kind: "file",
    ownership: "ai-authored-candidate",
    path,
  };
}

function bundle(input?: {
  readonly candidates?: readonly {
    readonly [key: string]: unknown;
    readonly path: string;
  }[];
  readonly dependencies?: readonly Record<string, unknown>[];
  readonly ownedPaths?: readonly string[];
}) {
  const candidates = input?.candidates ?? [
    fileCandidate(
      "application/extensions/custom.ts",
      "export const answer = 42;\n",
    ),
  ];
  const ownedPaths =
    input?.ownedPaths ?? candidates.map((candidate) => candidate.path);
  return {
    boundary: {
      approvalPathIds: ["extension.application"],
      boundaryId: "extension-custom",
      ownedPaths,
      writeAuthority: "candidate-artifacts-only",
    },
    candidates,
    dependencies: input?.dependencies ?? [],
    generationPlan: {
      objective: "Create only the reviewed custom extension files.",
      planId: "generation-plan-1",
      steps: candidates.map((candidate, index) => ({
        action: candidate.kind === "patch" ? "propose-patch" : "create-file",
        rationale: "Implement the canonical workload contract.",
        sourceReferences: [sourceReference],
        stepId: `generation-step-${String(index + 1)}`,
        targetPath: candidate.path,
      })),
    },
    provenance: {
      contractVersion: 1,
      gatewayId: "cloudmarkup.model-gateway",
      inputDigest: sha256Text("model-input"),
      invocationId: "invocation-materializer-1",
      modelId: "model.fixture",
      modelVersion: "2026-08-21",
      ownership: "untrusted-proposal",
      promptDigest: sha256Text("prompt"),
      promptTemplateId: "cloudmarkup.extension-generation",
      promptVersion: "1.0.0",
      providerId: "provider.fixture",
    },
    validationExpectations,
  };
}

function policy(input?: {
  readonly approvedDependencies?: readonly Record<string, unknown>[];
  readonly existingFiles?: readonly Record<string, unknown>[];
  readonly maximumFiles?: number;
  readonly ownedPaths?: readonly Record<string, unknown>[];
  readonly protectedPaths?: readonly string[];
}) {
  return {
    approvalPathIds: ["extension.application"],
    approvedDependencies: input?.approvedDependencies ?? [],
    boundaryId: "extension-custom",
    contentKind: "application",
    existingFiles: input?.existingFiles ?? [],
    limits: {
      maximumFileBytes: 4_096,
      maximumDependencies: 16,
      maximumFiles: input?.maximumFiles ?? 8,
      maximumPatchHunks: 8,
      maximumTotalBytes: 16_384,
    },
    ownedPaths: input?.ownedPaths ?? [
      {
        conflictPolicy: "fail",
        path: "application/extensions/custom.ts",
      },
    ],
    protectedPaths: input?.protectedPaths ?? [
      "application/generated/router.ts",
    ],
    sourceReferenceIds: ["solution-contract-1"],
    validationExpectations,
  };
}

describe("candidate bundle materialization", () => {
  it("materializes exact owned content reproducibly", () => {
    const input = { bundle: bundle(), policy: policy() };
    const first = materializeCandidateBundle(input);
    const second = materializeCandidateBundle(structuredClone(input));

    expect(first.succeeded).toBe(true);
    expect(first).toEqual(second);
    expect(first.files).toEqual([
      expect.objectContaining({
        digest: sha256Text("export const answer = 42;\n"),
        ownership: "ai-authored-candidate",
        path: "application/extensions/custom.ts",
        sourceKind: "file",
      }),
    ]);
  });

  it("rejects unowned and protected deterministic paths", () => {
    for (const path of [
      "application/unowned.ts",
      "application/generated/router.ts",
    ]) {
      const candidateBundle = bundle({
        candidates: [fileCandidate(path, "export const value = 1;\n")],
        ownedPaths: ["application/extensions/custom.ts"],
      });
      const result = materializeCandidateBundle({
        bundle: candidateBundle,
        policy: policy(),
      });

      expect(result.succeeded).toBe(false);
      expect(result.files).toHaveLength(0);
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "ownership",
            code: "cloudmarkup.ai-extension.path-not-owned",
            repairable: false,
          }),
        ]),
      );
    }
  });

  it("rejects non-portable paths and portable case collisions", () => {
    const reserved = materializeCandidateBundle({
      bundle: bundle({
        candidates: [fileCandidate("application/CON.ts", "export {};\n")],
        ownedPaths: ["application/CON.ts"],
      }),
      policy: policy({
        ownedPaths: [{ conflictPolicy: "fail", path: "application/CON.ts" }],
      }),
    });
    expect(reserved.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "cloudmarkup.ai-extension.path-invalid",
        }),
      ]),
    );

    const first = fileCandidate(
      "application/extensions/custom.ts",
      "export {};\n",
    );
    const second = fileCandidate(
      "APPLICATION/EXTENSIONS/CUSTOM.TS",
      "export const other = true;\n",
      "candidate-2",
    );
    const collision = materializeCandidateBundle({
      bundle: bundle({ candidates: [first, second] }),
      policy: policy(),
    });
    expect(collision.succeeded).toBe(false);
    expect(collision.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "cloudmarkup.ai-extension.path-collision",
        }),
      ]),
    );
  });

  it("preserves exact user-owned patches and rejects replacements or stale ownership", () => {
    const oldContent = "export const answer = 41;\n";
    const oldDigest = sha256Text(oldContent);
    const path = "application/extensions/custom.ts";
    const proposedContent = "export const answer = 42;\n";
    const patch = {
      baseDigest: oldDigest,
      candidateId: "candidate-1",
      kind: "patch",
      ownership: "ai-authored-candidate",
      path,
      proposedResultDigest: sha256Text(proposedContent),
      unifiedDiff: [
        `--- a/${path}`,
        `+++ b/${path}`,
        "@@ -1 +1 @@",
        "-export const answer = 41;",
        "+export const answer = 42;",
        "",
      ].join("\n"),
    };
    const patchPolicy = policy({
      existingFiles: [
        {
          content: oldContent,
          digest: oldDigest,
          noSecretValues: true,
          ownership: "user-owned",
          path,
        },
      ],
      ownedPaths: [
        {
          conflictPolicy: "propose-patch",
          path,
          priorDigest: oldDigest,
        },
      ],
    });

    const accepted = materializeCandidateBundle({
      bundle: bundle({ candidates: [patch] }),
      policy: patchPolicy,
    });
    expect(accepted.succeeded).toBe(true);
    expect(accepted.files[0]?.ownership).toBe("user-owned-preserved");
    expect(accepted.files[0]?.sourceKind).toBe("patch");
    expect(accepted.files[0]?.digest).toBe(sha256Text(proposedContent));

    const replacement = {
      ...fileCandidate(path, proposedContent),
      priorDigest: oldDigest,
    };
    const fullFile = materializeCandidateBundle({
      bundle: bundle({ candidates: [replacement] }),
      policy: {
        ...patchPolicy,
        ownedPaths: [{ conflictPolicy: "fail", path, priorDigest: oldDigest }],
      },
    });
    expect(fullFile.succeeded).toBe(false);
    expect(fullFile.diagnostics[0]?.technicalDetail).toContain(
      "user-owned content requires an exact bounded patch",
    );

    const stale = materializeCandidateBundle({
      bundle: bundle({
        candidates: [
          { ...patch, baseDigest: sha256Text("stale user content\n") },
        ],
      }),
      policy: patchPolicy,
    });
    expect(stale.succeeded).toBe(false);
    expect(stale.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "cloudmarkup.ai-extension.candidate-content-invalid",
        }),
      ]),
    );
  });

  it("marks only exact allow-listed dependency tuples as approved", () => {
    const requestedDependency = {
      approvalPathId: "extension.application",
      ecosystem: "package.npm",
      kind: "package",
      name: "@example/runtime",
      reason: "Use the reviewed runtime helper.",
      requestedVersion: "1.2.3",
      reviewState: "requested",
    };
    const approved = materializeCandidateBundle({
      bundle: bundle({ dependencies: [requestedDependency] }),
      policy: policy({
        approvedDependencies: [
          {
            approvalPathId: "extension.application",
            ecosystem: "package.npm",
            kind: "package",
            name: "@example/runtime",
            version: "1.2.3",
          },
        ],
      }),
    });
    expect(approved.succeeded).toBe(true);
    expect(approved.dependencies[0]?.reviewState).toBe("approved");

    const rejected = materializeCandidateBundle({
      bundle: bundle({
        dependencies: [{ ...requestedDependency, requestedVersion: "2.0.0" }],
      }),
      policy: policy({
        approvedDependencies: [
          {
            approvalPathId: "extension.application",
            ecosystem: "package.npm",
            kind: "package",
            name: "@example/runtime",
            version: "1.2.3",
          },
        ],
      }),
    });
    expect(rejected.succeeded).toBe(false);
    expect(rejected.dependencies[0]?.reviewState).toBe("rejected");
    expect(rejected.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "cloudmarkup.ai-extension.dependency-not-approved",
        }),
      ]),
    );
  });

  it("rejects secret-bearing and process-authorizing application content", () => {
    for (const content of [
      'const client_secret = "candidate-secret-value";\n',
      'import { spawn } from "node:child_process";\n',
    ]) {
      const result = materializeCandidateBundle({
        bundle: bundle({
          candidates: [
            fileCandidate("application/extensions/custom.ts", content),
          ],
        }),
        policy: policy(),
      });

      expect(result.succeeded).toBe(false);
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "security",
            code: "cloudmarkup.ai-extension.candidate-content-invalid",
          }),
        ]),
      );
    }
  });

  it("fails closed when the candidate file count exceeds the approved bound", () => {
    const first = fileCandidate("application/extensions/a.ts", "export {};\n");
    const second = fileCandidate(
      "application/extensions/b.ts",
      "export const b = true;\n",
      "candidate-2",
    );
    const result = materializeCandidateBundle({
      bundle: bundle({ candidates: [first, second] }),
      policy: policy({
        maximumFiles: 1,
        ownedPaths: [
          { conflictPolicy: "fail", path: first.path },
          { conflictPolicy: "fail", path: second.path },
        ],
      }),
    });

    expect(result.succeeded).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "admission",
          code: "cloudmarkup.ai-extension.file-count-exceeded",
        }),
      ]),
    );
  });
});
