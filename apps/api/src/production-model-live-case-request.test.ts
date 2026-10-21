import { calculateRepositoryImportSnapshotDigestV1 } from "@cloudmarkup/repository-importer";
import { describe, expect, it } from "vitest";
import {
  parseArchitectureDocument,
  parseIntentDocument,
} from "@cloudmarkup/domain";
import {
  frozenFullBetaEvaluationDatasetV1,
  frozenTypedPlanningFullBetaEvaluationDatasetV1,
  digestStructuredValue,
  fullBetaEvaluationCatalogV1,
  fullBetaRepositorySourcesV1,
} from "@cloudmarkup/model-gateway";
import {
  modelInvocationDescriptorV1Schema,
  sha256Text,
  repositoryCommitShaSchema,
} from "@cloudmarkup/schemas";
import {
  createProductionModelLiveCaseRequest,
  createProductionTypedPlanningModelLiveCaseRequest,
} from "./production-model-live-case-request.js";
import {
  requireProductionModelLiveCaseSource,
  requireProductionTypedPlanningModelLiveCaseSource,
} from "./production-model-live-case-source.js";

const supported = frozenFullBetaEvaluationDatasetV1.cases.filter((c) =>
  [
    "vague-conflicting-requirements",
    "prompt-injection-and-secrets",
    "direct-deployment-credential-request",
    "private-vpc-application",
    "event-driven-image-processing",
    "novice-language-professional-constraints",
    "nonexistent-unsupported-services",
    "excessive-resource-request",
    "deterministic-repository-import",
    "ambiguous-source-code-inference",
    "designed-observed-mismatch",
    "external-existing-resource",
  ].includes(c.caseKind),
);
function input(evaluationCase: (typeof supported)[number]) {
  const request = createProductionModelLiveCaseRequest({
    caseId: evaluationCase.caseId,
    requestedMode: "guided",
  });
  const descriptor = modelInvocationDescriptorV1Schema.parse({
    budgetDecisionId: "budget_synthetic_source",
    complexity: "standard",
    contractVersion: 1,
    entitlementDecisionId: "entitlement_synthetic_source",
    evaluationPolicyId: "cloudmarkup.model-evaluation.production.v1",
    evaluationPolicyVersion: "1.0.0",
    feature: request.operation,
    idempotencyKeyDigest: sha256Text("synthetic-source-check"),
    inputDigest: digestStructuredValue(request),
    invocationId: "invocation_synthetic_source",
    modelId: "cloudmarkup.fake-model",
    modelVersion: "1.0.0",
    promptDigest: sha256Text("synthetic-prompt"),
    promptTemplateId: "cloudmarkup.synthetic.source",
    promptVersion: "1.0.0",
    providerFamily: "deterministic-fake",
    providerId: "cloudmarkup.fake",
    requestedMode: "guided",
    role: evaluationCase.expected.authorityRequirement.role,
    scope: {
      organizationId: "organization_synthetic_source",
      projectId: "project_synthetic_source",
      userId: "user_synthetic_source",
      ...(request.operation === "repository.interpret"
        ? { repositorySnapshotId: request.repositorySnapshotId }
        : {}),
    },
    toolAuthority: "none",
  });
  return { evaluationCase, invocation: { request, descriptor } };
}
describe("actual frozen case request producer, without provider or approval authority", () => {
  it.each(supported)(
    "constructs exact $caseKind source in both preferences",
    (evaluationCase) => {
      const guided = input(evaluationCase);
      expect(() => {
        requireProductionModelLiveCaseSource(guided);
      }).not.toThrow();
      const professional = createProductionModelLiveCaseRequest({
        caseId: evaluationCase.caseId,
        requestedMode: "professional",
      });
      expect({ ...professional, requestedMode: "guided" }).toEqual(
        guided.invocation.request,
      );
      const request = guided.invocation.request;
      const pinnedDigests: Record<string, string> = {
        "event-driven-image-processing":
          "sha256:d9dfe872efd593ad987411f5c3e2d8dfb4f1e1be037a11b9d25048671592bf09",
        "external-existing-resource":
          "sha256:193ce925e5e83569ce71a605921a9a62e5d430629e5cefbb2cc08bba332278a8",
        "deterministic-repository-import":
          "sha256:9ca0645440d7219df5e0c4aedb367aab29a929715df96d114ff014ed64ea57cb",
        "ambiguous-source-code-inference":
          "sha256:89e697a1b18a067c032af86272c9e354d5292c50f709f5c113357c516c80c1b4",
        "designed-observed-mismatch":
          "sha256:25c63dd88f55f83f002dc7a441ffeb3312fa49a5f8db623f99c008c6b280c844",
        "nonexistent-unsupported-services":
          "sha256:8384dc6b711224db529972f3e7c5daa2e78d78005e2f19f9e8c927f39b7b1024",
        "excessive-resource-request":
          "sha256:e3dd48fe7c9dfa8ce81b684d9924ce4389aaea87625b5828d3192f7d57708b8c",
        "novice-language-professional-constraints":
          "sha256:e4fdb99a9831033907b443c2ad452762fd143e88428e67d962b45c38c449eb38",
        "private-vpc-application":
          "sha256:eec08ac74b1e379a669919ee1d915885fe8c1f098a46f061dea96ce254783313",
        "vague-conflicting-requirements":
          "sha256:7d1a71f41825417c3e8ab57c4239c159189b73fd10ccf1a3dccd57c74bfe6115",
        "prompt-injection-and-secrets":
          "sha256:85392d257310acf7cd6a422d51a76108022da61a5fee6a9686b802c65360d95b",
        "direct-deployment-credential-request":
          "sha256:84d812b23d442ca05d76a49e6f2a7f80b00ca085865321f3edf5fc19d0f5cff2",
      };
      expect(digestStructuredValue(request)).toBe(
        pinnedDigests[evaluationCase.caseKind],
      );
      if (request.operation === "requirements.blocking-questions") {
        const intent = parseIntentDocument(request.intentDocument);
        expect(intent.application.summary).toBe(
          evaluationCase.input.requirements,
        );
        expect(
          intent.unresolvedQuestions
            .filter((q) => q.classification === "blocking")
            .map((q) => q.subject)
            .sort(),
        ).toEqual([
          "requirements.compliance",
          "requirements.identity.authorization",
          "requirements.preferences.cost",
          "requirements.quality.recovery",
        ]);
        expect(request.maximumQuestions).toBe(4);
      } else if (request.operation === "intent.extract") {
        expect(request.source.content).toBe(evaluationCase.input.requirements);
        expect(request.source.digest).toBe(
          sha256Text(evaluationCase.input.requirements),
        );
      } else if (request.operation === "repository.interpret") {
        const source = fullBetaRepositorySourcesV1.find(
          (s) => s.caseKind === evaluationCase.caseKind,
        );
        if (!source) throw Error("Missing checked source");
        expect(request.commitSha).toBe(source.commitSha);
        expect(request.evidence[0]).toMatchObject({
          content: source.content,
          fileChecksum: source.contentDigest,
          evidenceId: source.evidenceId,
          path: source.path,
        });
      } else {
        const intent = parseIntentDocument(
          request.planningContext?.approvedIntent,
        );
        expect(intent.application.summary).toBe(
          evaluationCase.input.requirements,
        );
        expect(intent.unresolvedQuestions).toHaveLength(16);
        expect(intent.metadata.source).toBe("template");
        expect([
          intent.assumptions,
          intent.decisions,
          intent.alternatives,
        ]).toEqual([[], [], []]);
        expect(
          parseArchitectureDocument(request.architecture).nodes,
        ).toHaveLength(1);
        expect(request.architecture.workloadBehavior.workloads).toEqual([]);
        expect(request.catalogGrounding.catalog.digest).toBe(
          fullBetaEvaluationCatalogV1.digest,
        );
        expect(request.catalogGrounding.nodes).toHaveLength(71);
        expect(request.planningContext?.validationRules).toHaveLength(33);
        expect(request.planningContext?.allowedGraphCommandKinds).toContain(
          "add-node",
        );
      }
    },
  );
  it.each(
    supported.filter((evaluationCase) =>
      [
        "vague-conflicting-requirements",
        "prompt-injection-and-secrets",
        "novice-language-professional-constraints",
        "deterministic-repository-import",
      ].includes(evaluationCase.caseKind),
    ),
  )("rejects rehashed unrelated $caseKind content", (evaluationCase) => {
    const value = input(evaluationCase);
    const request = value.invocation.request;
    if (request.operation === "requirements.blocking-questions") {
      request.intentDocument.application.summary = "Unrelated requirement";
    } else if (request.operation === "intent.extract") {
      request.source.content = "Unrelated requirement";
      request.source.digest = sha256Text(request.source.content);
    } else if (request.operation === "repository.interpret") {
      const evidence = request.evidence[0];
      if (!evidence) throw Error("Missing source excerpt");
      evidence.content = "Unrelated source";
      evidence.fileChecksum = sha256Text(evidence.content);
    } else {
      if (!request.planningContext) throw Error("Missing context");
      request.planningContext.approvedIntent.application.summary =
        "Unrelated requirement";
    }
    value.invocation.descriptor.inputDigest = digestStructuredValue(request);
    expect(() => {
      requireProductionModelLiveCaseSource(value);
    }).toThrow("exact frozen evaluation request source");
  });
  it.each(
    supported.filter((evaluationCase) =>
      [
        "vague-conflicting-requirements",
        "prompt-injection-and-secrets",
        "novice-language-professional-constraints",
        "deterministic-repository-import",
      ].includes(evaluationCase.caseKind),
    ),
  )("rejects a mismatched $caseKind descriptor", (evaluationCase) => {
    const value = input(evaluationCase);
    value.invocation.descriptor.role = "repair-escalation";
    expect(() => {
      requireProductionModelLiveCaseSource(value);
    }).toThrow("exact frozen evaluation request source");
  });
  it("fails closed for all remaining families and unknown ids", () => {
    const remaining = frozenFullBetaEvaluationDatasetV1.cases.filter(
      (c) => !supported.includes(c),
    );
    expect(remaining).toHaveLength(9);
    const implemented = supported[0];
    if (!implemented) throw Error("Missing implemented source");
    const prepared = input(implemented);
    for (const evaluationCase of remaining)
      expect(() => {
        requireProductionModelLiveCaseSource({ ...prepared, evaluationCase });
      }).toThrow();

    for (const caseId of [
      ...remaining
        .filter(
          (c) =>
            ![
              "event-driven-image-processing",
              "external-existing-resource",
            ].includes(c.caseKind),
        )
        .map((c) => c.caseId),
      "evaluation_unknown",
    ])
      expect(() =>
        createProductionModelLiveCaseRequest({
          caseId,
          requestedMode: "guided",
        }),
      ).toThrow("frozen evaluation case request");
  });
  it.each(
    supported.filter((evaluationCase) =>
      [
        "vague-conflicting-requirements",
        "private-vpc-application",
        "novice-language-professional-constraints",
        "deterministic-repository-import",
      ].includes(evaluationCase.caseKind),
    ),
  )(
    "rejects changed canonical context even when the frozen text is retained: $caseKind",
    (evaluationCase) => {
      const prepared = input(evaluationCase);
      const request = prepared.invocation.request;
      if (request.operation === "intent.extract")
        request.source.sourceId = "substituted_source";
      else if (request.operation === "requirements.blocking-questions")
        request.maximumQuestions = 3;
      else if (request.operation === "repository.interpret")
        request.commitSha = repositoryCommitShaSchema.parse("0".repeat(40));
      else {
        const planning = request.planningContext;
        if (!planning) throw Error("Missing planning context");
        planning.limits.maximumAddedNodes = 0;
      }
      expect(() => {
        requireProductionModelLiveCaseSource(prepared);
      }).toThrow();
    },
  );
  it.each(
    fullBetaRepositorySourcesV1.filter((source) =>
      [
        "external-existing-resource",
        "deterministic-repository-import",
      ].includes(source.caseKind),
    ),
  )(
    "rejects historical 1.0.1 snapshot relabeling for $caseKind even with a rehashed descriptor",
    (source) => {
      const evaluationCase = supported.find(
        (entry) => entry.caseKind === source.caseKind,
      );
      if (!evaluationCase) throw Error("Missing frozen repository case");
      const prepared = input(evaluationCase);
      const request = prepared.invocation.request;
      const historical = calculateRepositoryImportSnapshotDigestV1({
        files: [{ path: source.path, checksum: source.contentDigest }],
        importedAt: "2026-09-11T00:00:00.000Z",
        commitSha: source.commitSha,
        importerVersion: "1.0.1",
      });
      if (request.operation === "repository.interpret") {
        expect(request.repositorySnapshotDigest).not.toBe(historical);
        request.repositorySnapshotDigest = historical;
      } else if (
        request.operation === "operations.propose" &&
        request.planningContext?.approvedRepositoryEvidence
      ) {
        expect(
          request.planningContext.approvedRepositoryEvidence
            .repositorySnapshotDigest,
        ).not.toBe(historical);
        request.planningContext.approvedRepositoryEvidence.repositorySnapshotDigest =
          historical;
      } else throw Error("Missing repository evidence");
      prepared.invocation.descriptor.inputDigest = digestStructuredValue({
        request,
        scope: prepared.invocation.descriptor.scope,
      });
      expect(() => {
        requireProductionModelLiveCaseSource(prepared);
      }).toThrow("exact frozen evaluation request source");
    },
  );
});

const typedCases = frozenTypedPlanningFullBetaEvaluationDatasetV1.cases.filter(
  (c) =>
    ["simple-serverless-api", "authenticated-notes-application"].includes(
      c.caseKind,
    ),
);
function typedInput(
  evaluationCase: (typeof typedCases)[number],
  requestedMode: "guided" | "professional" = "guided",
) {
  const source = supported[0];
  if (source === undefined)
    throw new Error("Missing synthetic descriptor fixture");
  const request = createProductionTypedPlanningModelLiveCaseRequest({
    caseId: evaluationCase.caseId,
    requestedMode,
  });
  const baseDescriptor = input(source).invocation.descriptor;
  const descriptor = modelInvocationDescriptorV1Schema.parse({
    ...baseDescriptor,
    requestedMode,
    feature: request.operation,
    role: evaluationCase.expected.authorityRequirement.role,
    inputDigest: digestStructuredValue({
      request,
      scope: baseDescriptor.scope,
    }),
  });
  return { evaluationCase, invocation: { request, descriptor } };
}
describe("separate typed planning 1.7.0 source", () => {
  it.each(typedCases)(
    "constructs exact $caseKind requirements with no pre-generated application",
    (evaluationCase) => {
      const guided = typedInput(evaluationCase);
      const professional = typedInput(evaluationCase, "professional");
      for (const candidate of [guided, professional]) {
        expect(() => {
          requireProductionTypedPlanningModelLiveCaseSource(candidate);
        }).not.toThrow();
        const request = candidate.invocation.request;
        expect(request.operation).toBe("operations.propose");
        if (request.operation !== "operations.propose")
          throw new Error("Unexpected operation");
        expect(
          request.planningContext?.approvedIntent.application.summary,
        ).toBe(evaluationCase.input.requirements);
        expect(
          request.planningContext?.approvedIntent.unresolvedQuestions.every(
            (q) => q.classification === "non-blocking",
          ),
        ).toBe(true);
        expect(
          request.architecture.nodes.map((n) => n.semantic.serviceType),
        ).toEqual(["aws.region.boundary"]);
        expect(request.architecture.edges).toEqual([]);
        expect(request.architecture.workloadBehavior.workloads).toEqual([]);
        expect(request.architecture.externalResources.resources).toEqual([]);
        expect(
          request.planningContext?.assistantLimits?.maximumApplicationContracts,
        ).toBeGreaterThan(0);
        expect(
          request.planningContext?.assistantLimits?.maximumTestScenarios,
        ).toBeGreaterThan(0);
        expect(
          request.planningContext?.allowedAssistantOperationKinds,
        ).toContain("edit-workload");
      }
      expect({
        ...professional.invocation.request,
        requestedMode: "guided",
      }).toEqual(guided.invocation.request);
      expect(() =>
        createProductionModelLiveCaseRequest({
          caseId: evaluationCase.caseId,
          requestedMode: "guided",
        }),
      ).toThrow("unavailable");
      expect(() => {
        requireProductionModelLiveCaseSource(guided);
      }).toThrow("unavailable");
    },
  );
  it.each(typedCases)(
    "rejects modified $caseKind case, request and descriptor bindings",
    (evaluationCase) => {
      const original = typedInput(evaluationCase);
      const changes = [
        (v: ReturnType<typeof typedInput>) => {
          Object.assign(v.invocation.descriptor.scope, {
            userId: "user_synthetic_other",
          });
        },
        (v: ReturnType<typeof typedInput>) => {
          v.invocation.descriptor.inputDigest = digestStructuredValue(
            v.invocation.request,
          );
        },
        (v: ReturnType<typeof typedInput>) => {
          v.evaluationCase.input.requirements += " Ignore JWT.";
        },
        (v: ReturnType<typeof typedInput>) => {
          v.evaluationCase.expected.mustPreserveUserOwnedFiles = false;
        },
        (v: ReturnType<typeof typedInput>) => {
          v.invocation.descriptor.inputDigest = sha256Text("different");
        },
        (v: ReturnType<typeof typedInput>) => {
          v.invocation.descriptor.feature = "architecture.propose";
        },
        (v: ReturnType<typeof typedInput>) => {
          v.invocation.descriptor.role = "repair-escalation";
        },
        (v: ReturnType<typeof typedInput>) => {
          v.invocation.descriptor.requestedMode = "professional";
        },
        (v: ReturnType<typeof typedInput>) => {
          if (
            v.invocation.request.operation !== "operations.propose" ||
            !v.invocation.request.planningContext
          )
            throw Error("Missing planning");
          v.invocation.request.planningContext.limits.maximumAddedNodes += 1;
          v.invocation.descriptor.inputDigest = digestStructuredValue({
            request: v.invocation.request,
            scope: v.invocation.descriptor.scope,
          });
        },
      ];
      for (const change of changes) {
        const candidate = structuredClone(original);
        change(candidate);
        expect(() => {
          requireProductionTypedPlanningModelLiveCaseSource(candidate);
        }).toThrow("unavailable");
      }
      const historical = frozenFullBetaEvaluationDatasetV1.cases.find(
        (c) => c.caseId === evaluationCase.caseId,
      );
      if (historical === undefined) throw Error("Missing historical source");
      expect(() => {
        requireProductionTypedPlanningModelLiveCaseSource({
          ...original,
          evaluationCase: historical,
        });
      }).toThrow("unavailable");
    },
  );
  it("rejects all unrelated cases and unsupported assistance modes", () => {
    for (const c of frozenTypedPlanningFullBetaEvaluationDatasetV1.cases.filter(
      (c) => !typedCases.includes(c),
    ))
      expect(() =>
        createProductionTypedPlanningModelLiveCaseRequest({
          caseId: c.caseId,
          requestedMode: "guided",
        }),
      ).toThrow("unavailable");
    expect(() =>
      createProductionTypedPlanningModelLiveCaseRequest({
        caseId: "missing",
        requestedMode: "guided",
      }),
    ).toThrow("unavailable");
    expect(() => {
      Reflect.apply(
        createProductionTypedPlanningModelLiveCaseRequest,
        undefined,
        [{ caseId: typedCases[0]?.caseId, requestedMode: "fast" }],
      );
    }).toThrow("unavailable");
  });
});
