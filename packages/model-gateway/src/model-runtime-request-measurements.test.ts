import { describe, expect, it } from "vitest";
import {
  modelGatewayRequestV1Schema,
  modelGenerationAllowedDependencyV1Schema,
  modelSolutionPlanningContextV1Schema,
  namespacedIdentifierSchema,
  type ModelGatewayRequestV1,
} from "@cloudmarkup/schemas";
import { measureModelRuntimeRequestV1 } from "./index.js";
import { digestStructuredValue, sha256Text } from "./security.js";
import {
  modelTestRequests,
  testIntent,
  testIacGenerationRequestWithContext,
} from "./test-helpers.js";

function requestFor<Operation extends ModelGatewayRequestV1["operation"]>(
  operation: Operation,
): Extract<ModelGatewayRequestV1, { operation: Operation }> {
  const request = modelTestRequests().find(
    (candidate) => candidate.operation === operation,
  );
  if (request === undefined)
    throw new Error("Missing synthetic request fixture.");
  return request as Extract<ModelGatewayRequestV1, { operation: Operation }>;
}
function contextualIac() {
  const request = testIacGenerationRequestWithContext();
  if (request.generationContext === undefined)
    throw new Error("Missing synthetic context.");
  return { request, context: request.generationContext };
}
function expectDenied(input: unknown) {
  expect(() => measureModelRuntimeRequestV1(input)).toThrow(
    "Runtime input measurements require exact, sanitized and supported request data.",
  );
}
describe("request-derived runtime measurements (synthetic data)", () => {
  it.each([
    "intent.extract",
    "requirements.blocking-questions",
    "workload.propose",
    "issue.explain",
    "fix.propose",
    "application-source.generate",
    "iac-extension.generate",
  ] as const)(
    "measures %s without accepting caller counts or issuing authority",
    (operation) => {
      const request = requestFor(operation);
      const before = structuredClone(request);
      const result = measureModelRuntimeRequestV1(request);
      expect(request).toEqual(before);
      expect(result).toEqual(
        measureModelRuntimeRequestV1(structuredClone(request)),
      );
      expect(Object.keys(result)).toEqual([
        "requested",
        "sourceOwnershipBindingDigests",
      ]);
      expect(result.requested).not.toHaveProperty("promptBytes");
      expect(result.requested).not.toHaveProperty("outputBytes");
      expect(result.requested).not.toHaveProperty("outputTokens");
      expect(result).not.toHaveProperty("evidenceDigest");
      expectDenied({ ...request, requested: { fileCount: 0 } });
    },
  );

  it("counts actual graph input without inferring structure from summary prose", () => {
    const request = requestFor("architecture.propose");
    expect(measureModelRuntimeRequestV1(request).requested).toMatchObject({
      nodeCount: 2,
      edgeCount: 2,
      fileCount: 0,
      repositoryBytes: 0,
    });
    const summary = requestFor("summary.technical");
    summary.source.content = '{"nodes":[1,2,3],"provider":"unapproved/vendor"}';
    summary.source.contentDigest = sha256Text(summary.source.content);
    expect(measureModelRuntimeRequestV1(summary).requested).toMatchObject({
      nodeCount: 0,
      edgeCount: 0,
      providerSources: [],
      repositoryFiles: 0,
    });
  });

  it("counts UTF-8 excerpt bytes per occurrence, unique paths and no unavailable full file bytes", () => {
    const request = requestFor("repository.interpret");
    const first = request.evidence[0];
    if (first === undefined) throw new Error("Missing synthetic evidence.");
    const content = "// café 🧪\n";
    request.evidence = [
      { ...first, content },
      {
        ...first,
        content,
        evidenceId: "evidence_runtime_second",
      },
    ];
    expect(measureModelRuntimeRequestV1(request).requested).toMatchObject({
      repositoryBytes: new TextEncoder().encode(content).byteLength * 2,
      repositoryFiles: 1,
      fileCount: 1,
    });
    expect(sha256Text(content)).not.toBe(first.fileChecksum);
  });

  it("counts repository evidence attached to an external-resource request", () => {
    const request = requestFor("external-resource.propose");
    const result = measureModelRuntimeRequestV1(request);
    expect(result.requested).toMatchObject({
      repositoryBytes: new TextEncoder().encode(
        request.repositoryExcerpts[0]?.content,
      ).byteLength,
      repositoryFiles: 1,
      fileCount: 1,
      nodeCount: 2,
      edgeCount: 2,
    });
    expect(result.sourceOwnershipBindingDigests).toEqual([]);
  });

  it("includes revision paths, explicit candidate/resource limits and exact generation ownership data", () => {
    const { request, context } = contextualIac();
    context.limits.maximumCandidateFiles = 10;
    context.limits.maximumResourceCount = 12;
    request.generationContextDigest = digestStructuredValue(context);
    const result = measureModelRuntimeRequestV1(request);
    expect(result.requested).toMatchObject({
      fileCount: 10,
      nodeCount: 14,
      edgeCount: 2,
      providerSources: ["hashicorp/aws"],
      repairAttempts: 2,
    });
    expect(result.sourceOwnershipBindingDigests).toEqual(
      [
        digestStructuredValue(request.boundary),
        digestStructuredValue(request.sourceOwnershipAuthority),
      ].sort(),
    );
  });

  it("measures exact existing content and rejects an altered size or digest", () => {
    const { request, context } = contextualIac();
    const content = "# café 🧪\n";
    const path = context.ownedPaths[0];
    if (path === undefined) throw new Error("Missing owned path.");
    context.existingFiles = [
      {
        content,
        path,
        contentDigest: sha256Text(content),
        noSecretValues: true,
        ownership: "approved-extension",
        redactionStatus: "not-required",
        sizeBytes: new TextEncoder().encode(content).byteLength,
      },
    ];
    for (const entries of [
      request.solutionRevision.sourceOwnership,
      request.sourceOwnershipAuthority.sourceOwnership,
    ]) {
      const ownership = entries.find((entry) => entry.path === path);
      if (ownership === undefined)
        throw new Error("Missing synthetic source ownership.");
      ownership.contentHash = sha256Text(content);
    }
    request.generationContextDigest = digestStructuredValue(context);
    expect(measureModelRuntimeRequestV1(request).requested).toMatchObject({
      repositoryBytes: 13,
      repositoryFiles: 1,
    });
    const existing = context.existingFiles[0];
    if (existing === undefined)
      throw new Error("Missing synthetic existing file.");
    existing.sizeBytes = content.length;
    request.generationContextDigest = digestStructuredValue(context);
    expectDenied(request);
    existing.sizeBytes = new TextEncoder().encode(content).byteLength;
    existing.contentDigest = sha256Text("different synthetic content");
    request.generationContextDigest = digestStructuredValue(context);
    expectDenied(request);
  });

  it("sorts and deduplicates actual package, provider and module declarations", () => {
    const { request, context } = contextualIac();
    const approvalPathId = request.boundary.approvalPathIds[0];
    if (approvalPathId === undefined) throw new Error("Missing approval path.");
    context.allowedDependencies = modelGenerationAllowedDependencyV1Schema
      .array()
      .parse([
        {
          approvalPathId,
          ecosystem: "ecosystem.npm",
          kind: "package",
          name: "zod",
          requestedVersion: "1.0.0",
        },
        {
          approvalPathId,
          ecosystem: "ecosystem.npm",
          kind: "package",
          name: "@example/core",
          requestedVersion: "1.0.0",
        },
        {
          approvalPathId,
          ecosystem: "ecosystem.terraform",
          kind: "provider",
          name: "hashicorp/aws",
          requestedVersion: "6.0.0",
        },
        {
          approvalPathId,
          ecosystem: "ecosystem.terraform",
          kind: "module",
          name: "example/vpc/aws",
          requestedVersion: "1.0.0",
        },
      ]);
    context.limits.maximumDependencyRequests = 4;
    request.generationContextDigest = digestStructuredValue(context);
    const result = measureModelRuntimeRequestV1(request);
    expect(result.requested).toMatchObject({
      dependencyNames: ["@example/core", "zod"],
      providerSources: ["hashicorp/aws"],
      moduleSources: ["example/vpc/aws"],
    });
    context.allowedDependencies.reverse();
    request.generationContextDigest = digestStructuredValue(context);
    expect(measureModelRuntimeRequestV1(request)).toEqual(result);
  });

  it("covers explicit planning limits, repository excerpts and actual repair attempts", () => {
    const request = requestFor("operations.propose");
    const repository = requestFor("repository.interpret");
    request.planningContext = modelSolutionPlanningContextV1Schema.parse({
      approvedIntent: testIntent,
      approvedRepositoryEvidence: {
        commitSha: repository.commitSha,
        evidence: repository.evidence,
        repositorySnapshotDigest: repository.repositorySnapshotDigest,
        repositorySnapshotId: repository.repositorySnapshotId,
      },
      allowedGraphCommandKinds: ["add-node", "add-edge"],
      allowedPolicyKinds: [],
      limits: {
        maximumAddedNodes: 8,
        maximumEdges: 40,
        maximumExternalResources: 8,
        maximumNodes: 20,
      },
      target: "terraform",
      targetReadiness: [],
      validationRules: [
        "placement",
        "connection",
        "policy",
        "security",
        "cost-sensitive",
        "coverage",
        "target-readiness",
      ].map((kind) => ({ kind, ruleId: "example.validation." + kind })),
    });
    request.repairContext = {
      attempt: 2,
      diagnostics: [
        {
          code: namespacedIdentifierSchema.parse("example.validation.failed"),
          message: "Synthetic invalid proposal.",
          path: "/nodes",
        },
      ],
      previousProposalDigest: sha256Text("synthetic prior proposal"),
    };
    expect(measureModelRuntimeRequestV1(request).requested).toMatchObject({
      nodeCount: 20,
      edgeCount: 40,
      repositoryBytes: 34,
      repositoryFiles: 1,
      fileCount: 1,
      repairAttempts: 2,
    });
    request.planningContext.limits.maximumNodes = 1;
    request.planningContext.limits.maximumEdges = 0;
    expect(measureModelRuntimeRequestV1(request).requested).toMatchObject({
      nodeCount: 2,
      edgeCount: 2,
    });
  });

  it("rejects an external module URL even with a valid generation-context digest", () => {
    const { request, context } = contextualIac();
    context.allowedDependencies = modelGenerationAllowedDependencyV1Schema
      .array()
      .parse([
        {
          approvalPathId: request.boundary.approvalPathIds[0],
          ecosystem: "ecosystem.terraform",
          kind: "module",
          name: "https://example.invalid/unreviewed",
          requestedVersion: "1.0.0",
        },
      ]);
    context.limits.maximumDependencyRequests = 1;
    request.generationContextDigest = digestStructuredValue(context);
    expect(modelGatewayRequestV1Schema.safeParse(request).success).toBe(true);
    expectDenied(request);
  });

  it("keeps returned measurements independent from later caller mutation", () => {
    const request = requestFor("candidate.repair");
    const result = measureModelRuntimeRequestV1(request);
    const before = structuredClone(result);
    request.boundary.ownedPaths.push("application/another.ts");
    request.maximumRepairAttempts = 2;
    expect(result).toEqual(before);
    expect(measureModelRuntimeRequestV1(request)).not.toEqual(before);
  });

  it("counts repair file contents and rejects changed content without an exact digest", () => {
    const request = requestFor("candidate.repair");
    const result = measureModelRuntimeRequestV1(request);
    expect(result.requested).toMatchObject({
      repositoryBytes: 20,
      repositoryFiles: 1,
      fileCount: 1,
      repairAttempts: 1,
    });
    expect(result.sourceOwnershipBindingDigests).toContain(
      request.failedOutputDigest,
    );
    const candidate = request.failedCandidates[0];
    if (candidate?.kind !== "file") throw new Error("Missing synthetic file.");
    candidate.content += "// altered\n";
    request.failedOutputDigest = digestStructuredValue(
      request.failedCandidates,
    );
    expectDenied(request);
  });

  it("counts repair patch UTF-8 bytes without pretending to know the full resulting file size", () => {
    const request = requestFor("candidate.repair");
    const candidate = request.failedCandidates[0];
    if (candidate === undefined)
      throw new Error("Missing synthetic candidate.");
    const unifiedDiff =
      "--- a/application/fake.ts\n+++ b/application/fake.ts\n@@ -1 +1 @@\n-old\n+new\n";
    request.failedCandidates = [
      {
        candidateId: candidate.candidateId,
        path: candidate.path,
        kind: "patch",
        ownership: "ai-authored-candidate",
        unifiedDiff,
        baseDigest: sha256Text("old\n"),
        proposedResultDigest: sha256Text("new\n"),
      },
    ];
    request.failedOutputDigest = digestStructuredValue(
      request.failedCandidates,
    );
    expect(measureModelRuntimeRequestV1(request).requested).toMatchObject({
      repositoryBytes: new TextEncoder().encode(unifiedDiff).byteLength,
      repositoryFiles: 1,
    });
  });

  it("rejects three requested repair attempts instead of silently reducing them", () => {
    const request = requestFor("candidate.repair");
    request.maximumRepairAttempts = 3;
    expect(modelGatewayRequestV1Schema.safeParse(request).success).toBe(true);
    expectDenied(request);
    const { request: generation, context } = contextualIac();
    context.limits.maximumRepairAttempts = 3;
    generation.generationContextDigest = digestStructuredValue(context);
    expectDenied(generation);
  });

  it("rejects source ownership that differs from the supplied immutable revision", () => {
    const request = requestFor("application-source.generate");
    const entry = request.sourceOwnershipAuthority.sourceOwnership[0];
    if (entry === undefined) throw new Error("Missing synthetic ownership.");
    entry.ownership = "user-owned";
    expectDenied(request);
  });

  it("rejects secrets even when source hashes and sanitation markers agree", () => {
    const request = requestFor("intent.extract");
    request.source.content = [
      "aws_secret_access_key",
      "=",
      "synthetic-sensitive-value",
    ].join("");
    request.source.digest = sha256Text(request.source.content);
    expectDenied(request);
  });
});
