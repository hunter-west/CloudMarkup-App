import {
  semanticVersionSchema,
  repositoryRelativePathSchema,
} from "@cloudmarkup/schemas";
import {
  solutionExportInfrastructureArtifactV1Schema,
  sha256Digest,
  solutionExportTerraformApplicationPackagePathV1Schema,
} from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import {
  GoCompilationProjectionError,
  goCompilationResultV1Schema,
  goTargetArtifactDigest,
  projectGoCompilationResultToSolutionExportInfrastructure,
} from "./compiler-projection.js";
import {
  TEST_COMPILER,
  compilerFixture,
  multiWorkloadEventWorkflowFixture,
} from "./workflow.test-support.js";

const reviewedTerraformPackagePaths = [
  "../application/artifacts/workload_notes_api/function.zip",
  "../application/artifacts/team_notes-9f1188ffec23328dd65a49bf84617b62550a293a19b563fd9951e90c4d3a987a/function.zip",
] as const;

const rejectedTerraformPackagePaths = [
  "../../application/artifacts/workload_notes_api/function.zip",
  "/application/artifacts/workload_notes_api/function.zip",
  "C:/application/artifacts/workload_notes_api/function.zip",
  "..\\application\\artifacts\\workload_notes_api\\function.zip",
  "../application/./artifacts/workload_notes_api/function.zip",
  "../application/artifacts/../workload_notes_api/function.zip",
  "../application/artifacts//workload_notes_api/function.zip",
  "../application/artifacts/workload_notes_api/nested/function.zip",
  "../application/artifacts/workload_notes_api/function.zip.bak",
  `../application/artifacts/${"a".repeat(129)}/function.zip`,
] as const;
describe("Go compiler result projection", () => {
  it.each(reviewedTerraformPackagePaths)(
    "admits the dedicated Terraform package path %s without weakening repository paths",
    (path) => {
      expect(
        solutionExportTerraformApplicationPackagePathV1Schema.safeParse(path)
          .success,
      ).toBe(true);
      expect(repositoryRelativePathSchema.safeParse(path).success).toBe(false);
    },
  );

  it.each(
    rejectedTerraformPackagePaths.filter(
      (path) =>
        path !== "../application/artifacts//workload_notes_api/function.zip",
    ),
  )("rejects the non-canonical Terraform package path %s", (path) => {
    expect(
      solutionExportTerraformApplicationPackagePathV1Schema.safeParse(path)
        .success,
    ).toBe(false);
  });

  it("accepts compiler package paths only when they bind the workload and final artifact", () => {
    const fixture = multiWorkloadEventWorkflowFixture();
    const infrastructure =
      projectGoCompilationResultToSolutionExportInfrastructure(
        fixture.compilation,
      );

    expect(
      infrastructure.applicationArtifacts.map(
        ({ relativePackagePath }) => relativePackagePath,
      ),
    ).toEqual(
      fixture.compilation.artifact?.applicationArtifacts?.map(
        ({ relativePackagePath }) => relativePackagePath,
      ),
    );
  });

  it("requires complete and internally bound v2 application artifact metadata", () => {
    const infrastructure =
      projectGoCompilationResultToSolutionExportInfrastructure(
        multiWorkloadEventWorkflowFixture().compilation,
      );
    const application = infrastructure.applicationArtifacts[0];
    if (
      application?.contractVersion !== 2 ||
      application.expectedArtifact === undefined
    ) {
      throw new TypeError("Missing v2 application artifact fixture.");
    }

    const withoutExpectedArtifact = { ...application };
    delete withoutExpectedArtifact.expectedArtifact;
    expect(
      solutionExportInfrastructureArtifactV1Schema.safeParse({
        ...infrastructure,
        applicationArtifacts: [
          withoutExpectedArtifact,
          ...infrastructure.applicationArtifacts.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      solutionExportInfrastructureArtifactV1Schema.safeParse({
        ...infrastructure,
        applicationArtifacts: [
          {
            ...application,
            expectedArtifact: {
              ...application.expectedArtifact,
              path: "application/artifacts/workload_attacker/function.zip",
            },
          },
          ...infrastructure.applicationArtifacts.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it("normalizes only authentic Go nil slices while preserving raw artifact digest semantics", () => {
    const fixture = multiWorkloadEventWorkflowFixture();
    const artifact = fixture.compilation.artifact;
    const model = fixture.compilation.model;
    const resource = model?.resources[0];
    const connection = model?.connections[0];
    if (
      artifact === undefined ||
      model === undefined ||
      resource === undefined ||
      connection === undefined
    ) {
      throw new TypeError("Missing compiler null-wire fixture records.");
    }
    const nullNodeProvenance = {
      dependentEdgeIds: [] as string[],
      dependentNodeIds: null,
      generatorId: "cloudmarkup.connection-rule",
      generatorKind: "connection-rule",
      generatorVersion: semanticVersionSchema.parse("1.0.0"),
      operationId: "operation_fixture",
    } as const;
    const rawPolicyArtifact = {
      ownerNodeId: resource.id,
      ownership: "generated",
      policyDocumentId: "policy_document_fixture",
      policyKind: "identity",
      provenance: nullNodeProvenance,
      renderedAs: "aws_iam_role_policy",
    } as const;
    const provisionalArtifact = {
      ...artifact,
      digest: sha256Digest("provisional-null-wire-artifact"),
      policyArtifacts: [rawPolicyArtifact],
    };
    const rawModel = {
      ...model,
      policyAttachments: [
        {
          configuration: resource.configuration,
          ownerReferences: [
            { nodeId: resource.id, targetKey: resource.targetKey },
          ],
          ownership: "generated",
          provenance: nullNodeProvenance,
          resourceId: resource.id,
          resourceType: resource.resourceType,
          targetKey: resource.targetKey,
        },
        ...model.policyAttachments,
      ],
      resources: [
        {
          ...resource,
          lifecycle: {
            ...resource.lifecycle,
            provenance: nullNodeProvenance,
          },
          workloadIds: null,
        },
        ...model.resources.slice(1),
      ],
    };
    const rawCompilation = {
      ...fixture.compilation,
      artifact: {
        ...provisionalArtifact,
        digest: goTargetArtifactDigest(provisionalArtifact),
      },
      model: rawModel,
    };
    const parsed = goCompilationResultV1Schema.parse(rawCompilation);

    expect(parsed.model?.resources[0]?.workloadIds).toEqual([]);
    expect(
      parsed.model?.resources[0]?.lifecycle.provenance?.dependentNodeIds,
    ).toEqual([]);
    expect(
      parsed.model?.policyAttachments[0]?.provenance?.dependentNodeIds,
    ).toEqual([]);
    expect(
      parsed.artifact?.policyArtifacts?.[0]?.provenance?.dependentNodeIds,
    ).toBeNull();
    if (parsed.artifact === undefined) {
      throw new TypeError("Missing parsed null-wire artifact.");
    }
    expect(goTargetArtifactDigest(parsed.artifact)).toBe(
      parsed.artifact.digest,
    );
    expect(
      projectGoCompilationResultToSolutionExportInfrastructure(rawCompilation)
        .policyArtifacts[0]?.provenance.sourceReferences,
    ).toEqual([
      { id: "policy_document_fixture", kind: "policy" },
      { id: resource.id, kind: "resource" },
    ]);

    const invalidLocation = goCompilationResultV1Schema.safeParse({
      ...rawCompilation,
      model: {
        ...rawModel,
        connections: [
          {
            ...connection,
            lifecycle: {
              ...connection.lifecycle,
              provenance: nullNodeProvenance,
            },
          },
          ...model.connections.slice(1),
        ],
      },
    });
    expect(invalidLocation.success).toBe(false);
    if (invalidLocation.success) {
      throw new TypeError("Unexpected null normalization outside its scope.");
    }
    expect(invalidLocation.error.issues).toContainEqual(
      expect.objectContaining({
        path: [
          "model",
          "connections",
          0,
          "lifecycle",
          "provenance",
          "dependentNodeIds",
        ],
      }),
    );

    const invalidArtifactField = goCompilationResultV1Schema.safeParse({
      ...rawCompilation,
      artifact: {
        ...rawCompilation.artifact,
        policyArtifacts: [
          {
            ...rawPolicyArtifact,
            provenance: {
              ...nullNodeProvenance,
              dependentEdgeIds: null,
            },
          },
        ],
      },
    });
    expect(invalidArtifactField.success).toBe(false);
    if (invalidArtifactField.success) {
      throw new TypeError("Unexpected dependent-edge null normalization.");
    }
    expect(invalidArtifactField.error.issues).toContainEqual(
      expect.objectContaining({
        path: [
          "artifact",
          "policyArtifacts",
          0,
          "provenance",
          "dependentEdgeIds",
        ],
      }),
    );
  });

  it("fails projection for a shape-valid package path bound to another workload", () => {
    const fixture = multiWorkloadEventWorkflowFixture();
    const artifact = fixture.compilation.artifact;
    const first = artifact?.applicationArtifacts?.[0];
    if (artifact === undefined || first === undefined) {
      throw new TypeError("Missing event compiler artifact fixture.");
    }
    const provisional = {
      ...artifact,
      applicationArtifacts: [
        {
          ...first,
          relativePackagePath:
            "../application/artifacts/workload_attacker/function.zip",
        },
        ...(artifact.applicationArtifacts?.slice(1) ?? []),
      ],
    };
    const compilation = {
      ...fixture.compilation,
      artifact: {
        ...provisional,
        digest: goTargetArtifactDigest(provisional),
      },
    };

    expect(goCompilationResultV1Schema.safeParse(compilation).success).toBe(
      false,
    );
    expect(() =>
      projectGoCompilationResultToSolutionExportInfrastructure(compilation),
    ).toThrow(
      expect.objectContaining<Partial<GoCompilationProjectionError>>({
        code: "compiler-result-invalid",
      }),
    );
  });

  it("accepts the exact reviewed compiler pin and binds normalized resources", () => {
    const fixture = compilerFixture("infrastructure-only");

    const infrastructure =
      projectGoCompilationResultToSolutionExportInfrastructure(
        fixture.compilation,
      );
    expect(infrastructure.compiler).toEqual(TEST_COMPILER);
    expect(infrastructure.solutionRevisionId).toBe(
      fixture.generationRequest.solutionRevision.solutionRevisionId,
    );
    expect(infrastructure.resources).toEqual(
      fixture.generationRequest.normalizedSolution.resources.map(
        (resource) => ({
          dependentEdgeIds:
            resource.lifecycle.provenance?.dependentEdgeIds ?? [],
          dependentNodeIds:
            resource.lifecycle.provenance?.dependentNodeIds.length === 0 ||
            resource.lifecycle.provenance === undefined
              ? [resource.id]
              : resource.lifecycle.provenance.dependentNodeIds,
          resourceId: resource.id,
          targetKey: resource.targetKey,
        }),
      ),
    );
  });

  it("projects CloudFormation metadata and preserves target-neutral application contracts", () => {
    const cloudFormation = compilerFixture(
      "infrastructure-only",
      "cloudformation",
    );
    const terraform = compilerFixture("infrastructure-only");

    const projected = projectGoCompilationResultToSolutionExportInfrastructure(
      cloudFormation.compilation,
    );
    const terraformProjected =
      projectGoCompilationResultToSolutionExportInfrastructure(
        terraform.compilation,
      );

    expect(projected).toMatchObject({
      localValidation: "cloudmarkup-structured-template-v1",
      target: "cloudformation",
      templateFormat: "json",
      templateSpecificationVersion: "2010-09-09",
    });
    expect(projected.files).toEqual([
      expect.objectContaining({
        mediaType: "application/vnd.amazon.cloudformation.template+json",
        path: "infrastructure/template.json",
      }),
    ]);
    expect(projected.applicationArtifacts).toEqual(
      terraformProjected.applicationArtifacts,
    );
    expect(
      projectGoCompilationResultToSolutionExportInfrastructure(
        cloudFormation.compilation,
      ),
    ).toEqual(projected);
    expect(() =>
      projectGoCompilationResultToSolutionExportInfrastructure({
        ...cloudFormation.compilation,
        model: terraform.compilation.model,
      }),
    ).toThrow(
      expect.objectContaining<Partial<GoCompilationProjectionError>>({
        code: "compiler-result-binding-invalid",
      }),
    );
  });

  it("maps external immutable references to user-provided ownership", () => {
    const fixture = compilerFixture("external-artifact");

    const infrastructure =
      projectGoCompilationResultToSolutionExportInfrastructure(
        fixture.compilation,
      );

    expect(infrastructure.applicationArtifacts).toEqual([
      {
        implementationMode: "external-artifact",
        inputs: [
          expect.objectContaining({
            artifactId: "artifact.external.notes",
            ownership: "user-provided",
            state: "immutable-reference",
            workloadId: "workload_notes_api",
          }),
        ],
        workloadId: "workload_notes_api",
      },
    ]);
  });

  it("fails closed when the compiler digest is missing", () => {
    const fixture = compilerFixture("infrastructure-only");
    const parsedWithoutDigest = goCompilationResultV1Schema.parse({
      ...fixture.compilation,
      compiler: {
        id: fixture.compilation.compiler.id,
        version: fixture.compilation.compiler.version,
      },
    });

    expect(() =>
      projectGoCompilationResultToSolutionExportInfrastructure(
        parsedWithoutDigest,
      ),
    ).toThrow(
      expect.objectContaining<Partial<GoCompilationProjectionError>>({
        code: "compiler-pin-missing",
      }),
    );
  });

  it("rejects forged file content, artifact digests, and provenance binding", () => {
    const fixture = compilerFixture("infrastructure-only");
    const artifact = fixture.compilation.artifact;
    if (artifact === undefined)
      throw new TypeError("Missing compiler artifact.");
    const file = artifact.files?.[0];
    if (file === undefined) throw new TypeError("Missing compiler file.");

    expect(
      goCompilationResultV1Schema.safeParse({
        ...fixture.compilation,
        artifact: {
          ...artifact,
          files: [{ ...file, content: `${file.content}# forged\n` }],
        },
      }).success,
    ).toBe(false);
    expect(
      goCompilationResultV1Schema.safeParse({
        ...fixture.compilation,
        artifact: { ...artifact, digest: sha256Digest("forged") },
      }).success,
    ).toBe(false);

    const rebound = {
      ...artifact,
      provenance: {
        ...artifact.provenance,
        architectureRevisionId: "revision.attacker",
      },
    };
    const reboundWithDigest = {
      ...rebound,
      digest: goTargetArtifactDigest(rebound),
    };
    expect(() =>
      projectGoCompilationResultToSolutionExportInfrastructure({
        ...fixture.compilation,
        artifact: reboundWithDigest,
      }),
    ).toThrow(
      expect.objectContaining<Partial<GoCompilationProjectionError>>({
        code: "compiler-result-binding-invalid",
      }),
    );
  });
});
