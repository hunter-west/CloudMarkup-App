import {
  evidenceRecordV1Schema,
  type EvidenceRecordV1,
  type ModelInvocationDescriptorV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import {
  AI_EXTENSION_GENERATION_COORDINATOR_ID,
  AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
  type CandidateArtifactReferenceV1,
  type CandidateDiagnosticV1,
} from "./contracts.js";
import { stableRecordId } from "./security.js";
import type { CandidateValidationOutcomeV1 } from "./validation.js";

function failedByCategory(
  diagnostics: readonly CandidateDiagnosticV1[],
  categories: readonly CandidateDiagnosticV1["category"][],
): boolean {
  return diagnostics.some(
    (entry) =>
      entry.severity === "error" && categories.includes(entry.category),
  );
}

function outcomeFailed(
  outcomes: readonly CandidateValidationOutcomeV1[],
  kind: CandidateValidationOutcomeV1["kind"],
): boolean {
  const outcome = outcomes.find((entry) => entry.kind === kind);
  return (
    outcome === undefined ||
    outcome.result === "failed" ||
    outcome.result === "error" ||
    outcome.result === "not-run"
  );
}

export function createCandidateStaticEvidence(input: {
  readonly artifact: CandidateArtifactReferenceV1;
  readonly assessedAt: string;
  readonly claimsCoverageRequirement: boolean;
  readonly descriptor: ModelInvocationDescriptorV1;
  readonly diagnostics: readonly CandidateDiagnosticV1[];
  readonly generationContextDigest: Sha256Digest;
  readonly outcomes: readonly CandidateValidationOutcomeV1[];
  readonly solutionRevisionDigest: Sha256Digest;
  readonly solutionRevisionId: string;
}): EvidenceRecordV1 {
  const parseFailed =
    failedByCategory(input.diagnostics, ["admission", "parse", "format"]) ||
    outcomeFailed(input.outcomes, "parse");
  const staticFailed =
    failedByCategory(input.diagnostics, [
      "dependency",
      "ownership",
      "provenance",
      "static-analysis",
      "target-readiness",
    ]) || outcomeFailed(input.outcomes, "static-analysis");
  const securityFailed =
    failedByCategory(input.diagnostics, ["security"]) ||
    outcomeFailed(input.outcomes, "security");
  const checks: readonly {
    readonly failed: boolean;
    readonly id: string;
    readonly requirement?: "ai-extension-parse-static-validity";
    readonly summary: string;
  }[] = [
    {
      failed: parseFailed,
      id: "cloudmarkup.ai-extension.candidate-parse",
      summary: "Candidate parsing and bounded materialization",
    },
    {
      failed: staticFailed,
      id: "cloudmarkup.ai-extension.candidate-static-analysis",
      ...(input.claimsCoverageRequirement
        ? { requirement: "ai-extension-parse-static-validity" as const }
        : {}),
      summary:
        "Candidate ownership, dependency, contract, and static validation",
    },
    {
      failed: securityFailed,
      id: "cloudmarkup.ai-extension.candidate-security",
      summary: "Candidate secret, content, policy, and security validation",
    },
  ];
  const evidenceIdentity = {
    artifactDigest: input.artifact.artifactDigest,
    claimsCoverageRequirement: input.claimsCoverageRequirement,
    checks: checks.map(({ failed, id }) => ({ failed, id })),
    generationContextDigest: input.generationContextDigest,
    modelOutputDigest: input.artifact.bundleDigest,
    solutionRevisionDigest: input.solutionRevisionDigest,
  };
  return evidenceRecordV1Schema.parse({
    artifacts: [
      {
        digest: input.artifact.artifactDigest,
        mediaType: "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
        sizeBytes: input.artifact.files.reduce(
          (sum, file) => sum + file.sizeBytes,
          0,
        ),
      },
    ],
    checks: checks.map((check) => ({
      artifactDigests: [input.artifact.artifactDigest],
      checkId: check.id,
      ...(check.requirement === undefined
        ? {}
        : { generationCoverageRequirement: check.requirement }),
      issueIds: [],
      ...(check.failed
        ? {
            redactedFailure:
              "The bounded candidate did not satisfy this deterministic check.",
          }
        : {}),
      status: check.failed ? "failed" : "passed",
      summary: check.failed
        ? `${check.summary} failed.`
        : `${check.summary} passed.`,
    })),
    contractVersion: 1,
    environment: { environmentType: "unknown" },
    id: stableRecordId("evidence-ai-extension", evidenceIdentity),
    layer: "generated",
    level: { kind: "ai-extension-parse-static-validity", rank: 4 },
    models: [
      {
        modelId: input.descriptor.modelId,
        modelVersion: input.descriptor.modelVersion,
        promptVersion: input.descriptor.promptVersion,
        providerId: input.descriptor.providerId,
      },
    ],
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: {
          id: AI_EXTENSION_GENERATION_COORDINATOR_ID,
          version: AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
        },
      },
      createdAt: input.assessedAt,
      inputDigests: [
        input.artifact.artifactDigest,
        input.artifact.bundleDigest,
        input.generationContextDigest,
        input.solutionRevisionDigest,
      ],
    },
    solutionRevisionId: input.solutionRevisionId,
    staleness: { assessedAt: input.assessedAt, state: "current" },
    tools: [
      {
        id: AI_EXTENSION_GENERATION_COORDINATOR_ID,
        version: AI_EXTENSION_GENERATION_COORDINATOR_VERSION,
      },
    ],
  });
}
