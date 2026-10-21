import { generateApplication } from "@cloudmarkup/application-generator";
import { createNotesGenerationRequest } from "@cloudmarkup/application-generator/testing";
import {
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentHashes,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
  hashCanonicalValue,
} from "@cloudmarkup/domain";
import {
  applicationGenerationRequestV1Schema,
  architectureDocumentV3Schema,
  repositoryRelativePathSchema,
  solutionRevisionManifestV1Schema,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  projectApprovedDesignToConformanceLayerInputV1,
  projectGeneratedSolutionToConformanceLayerInputV1,
  SolutionConformanceSourceProjectionError,
} from "./conformance-source-adapters.js";
import {
  goCompilationResultV1Schema,
  goTargetArtifactDigest,
  type GoCompilationResultV1,
} from "./compiler-projection.js";
import {
  compilerFixture,
  type CompilerFixtureMode,
} from "./workflow.test-support.js";

const verifiedAt = "2026-08-29T12:00:00.000Z";

function sources(request: ReturnType<typeof createNotesGenerationRequest>) {
  return {
    applicationContracts: request.architectureDocument.applicationContracts,
    architectureDocument: request.architectureDocument,
    externalResources: request.architectureDocument.externalResources,
    solutionRevision: request.solutionRevision,
    workloadBehavior: request.workloadBehavior,
  };
}

function generatedFixture(
  target: "cloudformation" | "terraform" = "terraform",
  mode: CompilerFixtureMode = "complete-supported-pattern",
) {
  const fixture = compilerFixture(mode, target);
  return {
    applicationEvidenceId: "evidence.application.generated.1",
    applicationGeneration: {
      request: fixture.generationRequest,
      result: generateApplication(fixture.generationRequest),
    },
    compilation: fixture.compilation,
    compilerEvidenceId: "evidence.compiler.generated.1",
    sources: sources(fixture.generationRequest),
    verifiedAt,
  };
}

function comparableFacts(
  layer: ReturnType<typeof projectGeneratedSolutionToConformanceLayerInputV1>,
) {
  return layer.facts.map((fact) => ({
    applicationBinding: fact.applicationBinding,
    applicationBindingDigest: fact.applicationBindingDigest,
    applicationContractDigest: fact.applicationContractDigest,
    extensionPoint: fact.extensionPoint,
    management: fact.management,
    ownership: fact.ownership,
    semanticDigest: fact.semanticDigest,
    subject: fact.subject,
  }));
}

function expectProjectionCode(input: unknown, code: string) {
  try {
    projectGeneratedSolutionToConformanceLayerInputV1(input);
    throw new Error("Expected generated conformance projection to fail.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(SolutionConformanceSourceProjectionError);
    expect((error as SolutionConformanceSourceProjectionError).code).toBe(code);
  }
}

describe("designed and generated conformance source adapters", () => {
  it("projects exact approved source facts and matching generated commitments", () => {
    const generatedInput = generatedFixture();
    const designed = projectApprovedDesignToConformanceLayerInputV1({
      evidenceId: "evidence.design.approved.1",
      sources: generatedInput.sources,
      verifiedAt,
    });
    const generated =
      projectGeneratedSolutionToConformanceLayerInputV1(generatedInput);

    expect(designed.layer).toBe("designed");
    expect(designed.integrity).toBe("verified");
    expect(generated.layer).toBe("generated");
    expect(generated.integrity).toBe("verified");
    expect(generated.completeness).toBe("complete");
    const designedDigestBySubject = new Map(
      designed.facts.map((fact) => [
        `${fact.subject.kind}:${fact.subject.stableKey}`,
        fact.semanticDigest,
      ]),
    );
    const factsWithDesignedAuthority = generated.facts.filter((fact) =>
      designedDigestBySubject.has(
        `${fact.subject.kind}:${fact.subject.stableKey}`,
      ),
    );
    expect(
      factsWithDesignedAuthority.every(
        (fact) =>
          designedDigestBySubject.get(
            `${fact.subject.kind}:${fact.subject.stableKey}`,
          ) === fact.semanticDigest,
      ),
    ).toBe(true);
    expect(factsWithDesignedAuthority.length).toBeGreaterThan(0);
    expect(
      generated.facts.filter(
        ({ subject }) => subject.kind === "repository-file",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("keeps unverified custom application bindings semantically partial", () => {
    const generated = projectGeneratedSolutionToConformanceLayerInputV1(
      generatedFixture("terraform", "user-provided"),
    );
    const applicationFact = generated.facts.find(
      ({ subject }) => subject.stableKey === "application:workload_notes_api",
    );

    expect(applicationFact).toMatchObject({
      applicationBinding: "unknown",
      semanticComparison: { coverage: "partial" },
    });
  });

  it("keeps Terraform and CloudFormation generated semantic facts target-neutral", () => {
    const terraform = projectGeneratedSolutionToConformanceLayerInputV1(
      generatedFixture("terraform"),
    );
    const cloudformation = projectGeneratedSolutionToConformanceLayerInputV1(
      generatedFixture("cloudformation"),
    );

    const targetNeutralFacts = (
      layer: ReturnType<
        typeof projectGeneratedSolutionToConformanceLayerInputV1
      >,
    ) =>
      comparableFacts(layer).filter(
        ({ subject }) => subject.kind !== "repository-file",
      );
    expect(targetNeutralFacts(cloudformation)).toEqual(
      targetNeutralFacts(terraform),
    );
    expect(
      cloudformation.facts.some(
        ({ subject }) => subject.kind === "repository-file",
      ),
    ).toBe(true);
  });

  it("binds application and compiler IaC files to independent generated-manifest checksums", () => {
    const input = generatedFixture();
    const generated = projectGeneratedSolutionToConformanceLayerInputV1(input);
    const repositoryFacts = new Map(
      generated.facts
        .filter(({ subject }) => subject.kind === "repository-file")
        .map((fact) => [fact.sourceLocations[0]?.path, fact.semanticDigest]),
    );
    for (const file of input.applicationGeneration.result.artifact
      .sourceFiles) {
      if (file.ownership === "generated") {
        expect(repositoryFacts.get(file.path)).toBe(file.checksum);
      }
    }
    for (const file of input.compilation.artifact?.files ?? []) {
      expect(repositoryFacts.get(file.path)).toBe(file.digest);
    }
  });

  it("fails closed when compiler IaC and application output claim the same repository path", () => {
    const input = generatedFixture();
    const applicationFile =
      input.applicationGeneration.result.artifact.sourceFiles.find(
        ({ ownership }) => ownership === "generated",
      );
    const artifact = input.compilation.artifact;
    const compilerFile = artifact?.files?.[0];
    if (
      applicationFile === undefined ||
      artifact === undefined ||
      compilerFile === undefined
    ) {
      throw new Error("Fixture must include application and compiler files.");
    }
    const files = [
      { ...compilerFile, path: applicationFile.path },
      ...(artifact.files ?? []).slice(1),
    ];
    const substitutedArtifact = {
      ...artifact,
      files,
      digest: goTargetArtifactDigest({ ...artifact, files }),
    };
    const compilation = goCompilationResultV1Schema.parse({
      ...input.compilation,
      artifact: substitutedArtifact,
    });
    expectProjectionCode(
      { ...input, compilation },
      "generated-repository-file-path-collision",
    );
  });

  it("preserves explicit external and approved-extension ownership", () => {
    const base = createNotesGenerationRequest({
      includeExternalResource: true,
      mode: "generated-starter",
    });
    const originalWorkload = base.workloadBehavior.workloads[0];
    const originalOwnership = originalWorkload?.sourceOwnership[0];
    const extensionPoint = originalWorkload?.extensionPoints[0];
    if (
      originalWorkload === undefined ||
      originalOwnership === undefined ||
      extensionPoint === undefined
    ) {
      throw new Error("Fixture must include one reviewed extension boundary.");
    }
    const workloadBehavior = {
      ...base.workloadBehavior,
      workloads: [
        {
          ...originalWorkload,
          sourceOwnership: [
            {
              ...originalOwnership,
              extensionPointId: extensionPoint.extensionPointId,
              ownership: "approved-extension" as const,
            },
          ],
        },
      ],
    };
    const architectureDocument = architectureDocumentV3Schema.parse({
      ...base.architectureDocument,
      workloadBehavior,
    });
    const architectureHashes =
      getArchitectureDocumentHashes(architectureDocument);
    const solutionRevision = solutionRevisionManifestV1Schema.parse({
      ...base.solutionRevision,
      architecture: {
        ...base.solutionRevision.architecture,
        contentHash: architectureHashes.contentHash,
        documentHash:
          getArchitectureDocumentCanonicalHash(architectureDocument),
        visualHash: architectureHashes.visualHash,
      },
      contracts: {
        ...base.solutionRevision.contracts,
        contentHash: getApplicationContractsContentHash(
          architectureDocument.applicationContracts,
        ),
      },
      externalResources: {
        ...base.solutionRevision.externalResources,
        contentHash: getExternalResourceReferenceContentHash(
          architectureDocument.externalResources,
        ),
      },
      workload: {
        ...base.solutionRevision.workload,
        contentHash: getWorkloadBehaviorContentHash(workloadBehavior),
      },
    });
    const designed = projectApprovedDesignToConformanceLayerInputV1({
      evidenceId: "evidence.design.external-extension.1",
      sources: {
        applicationContracts: architectureDocument.applicationContracts,
        architectureDocument,
        externalResources: architectureDocument.externalResources,
        solutionRevision,
        workloadBehavior,
      },
      verifiedAt,
    });

    expect(
      designed.facts.find(
        ({ subject }) => subject.kind === "external-resource",
      ),
    ).toMatchObject({ management: "external", ownership: "imported" });
    expect(
      designed.facts.find(({ subject }) => subject.kind === "source-ownership"),
    ).toMatchObject({ extensionPoint: true, ownership: "user-extension" });
  });

  it("fails closed when generated source documents no longer match the Architecture envelope", () => {
    const input = generatedFixture();
    const foreign = compilerFixture("generated-starter").generationRequest;
    expectProjectionCode(
      {
        ...input,
        sources: {
          ...input.sources,
          workloadBehavior: foreign.workloadBehavior,
        },
      },
      "source-envelope-mismatch",
    );
  });

  it("fails closed on compiler-normalized drift from the exact source", () => {
    const input = generatedFixture();
    const model = input.compilation.model;
    if (model?.resources[0] === undefined) {
      throw new Error("Fixture must include a normalized resource.");
    }
    const normalizedSolution = {
      ...model,
      resources: [
        { ...model.resources[0], targetKey: "tampered_target_key" },
        ...model.resources.slice(1),
      ],
    };
    const request = applicationGenerationRequestV1Schema.parse({
      ...input.applicationGeneration.request,
      normalizedSolution,
    });
    const compilation = goCompilationResultV1Schema.parse({
      ...input.compilation,
      model: normalizedSolution,
    });
    expectProjectionCode(
      {
        ...input,
        applicationGeneration: {
          request,
          result: generateApplication(request),
        },
        compilation,
      },
      "application-generation-unsuccessful",
    );
  });

  it("fails closed when an application workload commitment is substituted", () => {
    const input = generatedFixture();
    const artifact = input.applicationGeneration.result.artifact;
    const original = artifact.workloadContracts[0];
    if (original === undefined || !("handler" in original)) {
      throw new Error("Fixture must include a generated workload contract.");
    }
    const substitutedArtifact = {
      ...artifact,
      workloadContracts: [
        { ...original, handler: "substituted.handler" },
        ...artifact.workloadContracts.slice(1),
      ],
    };
    expectProjectionCode(
      {
        ...input,
        applicationGeneration: {
          ...input.applicationGeneration,
          result: {
            ...input.applicationGeneration.result,
            artifact: substitutedArtifact,
            artifactDigest: hashCanonicalValue(substitutedArtifact),
          },
        },
      },
      "application-generation-binding-mismatch",
    );
  });

  it("requires the normalized compiler target to match the rendered artifact", () => {
    const input = generatedFixture();
    const model = input.compilation.model;
    if (model === undefined) throw new Error("Fixture must include a model.");
    const compilation = goCompilationResultV1Schema.parse({
      ...input.compilation,
      model: {
        ...model,
        target: { ...model.target, target: "cloudformation" },
      },
    });
    expectProjectionCode(
      { ...input, compilation },
      "compiler-target-binding-mismatch",
    );
  });

  it("requires the normalized target to be rendered before generated evidence is complete", () => {
    const input = generatedFixture();
    const model = input.compilation.model;
    if (model === undefined) throw new Error("Fixture must include a model.");
    const compilation = goCompilationResultV1Schema.parse({
      ...input.compilation,
      model: {
        ...model,
        target: { ...model.target, renderingAvailable: false },
      },
    });
    expectProjectionCode(
      { ...input, compilation },
      "compiler-target-binding-mismatch",
    );
  });

  it("rejects duplicate portable compiler paths before generated evidence is complete", () => {
    const input = generatedFixture();
    const artifact = input.compilation.artifact;
    const file = artifact?.files?.[0];
    if (artifact === undefined || file === undefined) {
      throw new Error("Fixture must include a compiler file.");
    }
    const files = [
      file,
      {
        ...file,
        path: repositoryRelativePathSchema.parse(file.path.toUpperCase()),
      },
    ];
    const substituted = {
      ...artifact,
      files,
      digest: goTargetArtifactDigest({ ...artifact, files }),
    };
    const compilation = goCompilationResultV1Schema.parse({
      ...input.compilation,
      artifact: substituted,
    });
    expectProjectionCode(
      { ...input, compilation },
      "compiler-artifact-path-duplicate",
    );
  });

  it("requires exact compiler application workload accounting", () => {
    const input = generatedFixture();
    const artifact = input.compilation.artifact;
    if (artifact === undefined) {
      throw new Error("Fixture must include a compiler artifact.");
    }
    const applicationArtifacts: NonNullable<
      typeof artifact.applicationArtifacts
    > = [];
    const substituted = {
      ...artifact,
      applicationArtifacts,
      digest: goTargetArtifactDigest({
        ...artifact,
        applicationArtifacts,
      }),
    };
    const compilation = goCompilationResultV1Schema.parse({
      ...input.compilation,
      artifact: substituted,
    });
    expectProjectionCode(
      { ...input, compilation },
      "compiler-application-workload-set-mismatch",
    );
  });

  it("requires exact compiler policy attachment accounting", () => {
    const input = generatedFixture();
    const artifact = input.compilation.artifact;
    const ownerNodeId = input.compilation.model?.resources[0]?.id;
    if (artifact === undefined || ownerNodeId === undefined) {
      throw new Error("Fixture must include a compiler artifact and resource.");
    }
    const policyArtifacts = [
      {
        ownerNodeId,
        ownership: "generated",
        policyDocumentId: "policy_orphan",
        policyKind: "inline",
        renderedAs: "target_policy",
      },
    ];
    const substituted = {
      ...artifact,
      policyArtifacts,
      digest: goTargetArtifactDigest({
        ...artifact,
        policyArtifacts,
      }),
    };
    const compilation = goCompilationResultV1Schema.parse({
      ...input.compilation,
      artifact: substituted,
    });
    expectProjectionCode(
      { ...input, compilation },
      "compiler-policy-artifact-set-mismatch",
    );
  });

  it("rejects a compiler result whose exact pinned identity is substituted", () => {
    const input = generatedFixture();
    const compilation: GoCompilationResultV1 = {
      ...input.compilation,
      compiler: {
        ...input.compilation.compiler,
        digest: hashCanonicalValue("substituted-compiler"),
      },
    };
    expectProjectionCode(
      { ...input, compilation },
      "compiler-binding-mismatch",
    );
  });
});
