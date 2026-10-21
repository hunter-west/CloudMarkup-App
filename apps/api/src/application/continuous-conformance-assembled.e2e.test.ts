import { generateApplication } from "@cloudmarkup/application-generator";
import {
  canonicalJson,
  normalizeDeploymentConformanceV1,
  normalizeDriftConformanceV1,
  normalizeTerraformConformancePlanV1,
  projectNormalizedDeploymentToConformanceLayerInputV1,
  projectNormalizedDriftToConformanceLayerInputV1,
  projectNormalizedPlanToConformanceLayerInputV1,
  sha256,
} from "@cloudmarkup/customer-ci-workflow";
import {
  composeConformanceReportV1,
  getConformanceReportDigestV1,
  hashCanonicalValue,
} from "@cloudmarkup/domain";
import { awsCatalogArtifactV1 } from "@cloudmarkup/provider-aws";
import {
  createRepositoryImportService,
  projectRepositoryImportToConformanceLayerInputV1,
  repositoryImportRequestV1Schema,
} from "@cloudmarkup/repository-importer";
import {
  applicationGenerationRequestV1Schema,
  conformanceReportV1Schema,
  defaultConformanceStalenessPolicyV1,
  serializeCanonicalJson,
  solutionRevisionManifestV1Schema,
  versionedToolReferenceV1Schema,
} from "@cloudmarkup/schemas";
import {
  projectApprovedDesignToConformanceLayerInputV1,
  projectGeneratedSolutionToConformanceLayerInputV1,
} from "@cloudmarkup/solution-export-workflow";
import { workflowFixture } from "@cloudmarkup/solution-export-workflow/testing";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const IMPORTED_AT = "2026-08-29T11:00:00.000Z";
const VERIFIED_AT = "2026-08-29T11:30:00.000Z";
const NOW = "2026-08-29T12:00:00.000Z";
const PLAN_EXPIRES_AT = "2026-08-29T13:00:00.000Z";
const COMMIT_SHA = "7".repeat(40);
const ENVIRONMENT_ID = "environment.assembled";
const PROJECT_ID = "project.conformance.assembled";
const LAYER_ORDER = [
  "designed",
  "imported",
  "generated",
  "planned",
  "deployed",
  "current-drift",
] as const;
const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map(async (root) => {
      await rm(root, { force: true, recursive: true });
    }),
  );
  temporaryRoots.clear();
});

async function writeRepositoryFile(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  const absolute = join(root, ...path.split("/"));
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

describe("assembled credential-free continuous conformance", () => {
  it("projects six independent public-adapter layers into one canonical usable report artifact", async () => {
    const fixture = workflowFixture("complete-supported-pattern", "terraform");
    const baseRequest = fixture.generationRequest;
    const importRequest = repositoryImportRequestV1Schema.parse({
      approvedArchitecture: baseRequest.architectureDocument,
      catalog: awsCatalogArtifactV1,
      contractVersion: 1,
      profile: {
        commitSha: COMMIT_SHA,
        contractVersion: 1,
        importedAt: IMPORTED_AT,
        limits: {
          maximumFileBytes: 1024 * 1024,
          maximumFileCount: 1_024,
          maximumTotalBytes: 16 * 1024 * 1024,
        },
        observedSolutionId: "observed.assembled",
        profileId: "cloudmarkup.repository-import.default",
        profileVersion: "1.0.0",
        selectedPaths: ["."],
        snapshotId: "snapshot.assembled",
        sourceDescriptor: "deterministic-credential-free-fixture",
        sourceId: "repository.assembled.local",
      },
      solutionRevision: baseRequest.solutionRevision,
    });
    const repositoryRoot = await mkdtemp(
      join(tmpdir(), "cloudmarkup-conformance-assembled-"),
    );
    temporaryRoots.add(repositoryRoot);
    const {
      applicationContracts,
      externalResources,
      workloadBehavior,
      ...architecture
    } = baseRequest.architectureDocument;
    const repositoryFiles = {
      "cloudmarkup/architecture.json": serializeCanonicalJson(architecture),
      "cloudmarkup/contracts/application-contracts.json":
        serializeCanonicalJson(applicationContracts),
      "cloudmarkup/external-resources.json":
        serializeCanonicalJson(externalResources),
      "cloudmarkup/solution.json": serializeCanonicalJson(
        baseRequest.solutionRevision,
      ),
      "cloudmarkup/workloads.json": serializeCanonicalJson(workloadBehavior),
    };
    for (const [path, content] of Object.entries(repositoryFiles)) {
      await writeRepositoryFile(repositoryRoot, path, content);
    }

    const importer = createRepositoryImportService({
      hclInspector: {
        inspect: () =>
          Promise.reject(
            new Error("The architecture-as-code fixture contains no HCL."),
          ),
      },
    });
    const repositoryImport = await importer.importRepository({
      request: importRequest,
      sourceDirectory: repositoryRoot,
    });
    const approvedSolutionRevision = solutionRevisionManifestV1Schema.parse({
      ...baseRequest.solutionRevision,
      repositoryObservations: [
        ...baseRequest.solutionRevision.repositoryObservations,
        {
          approvalId: "approval.repository.assembled",
          approvedAt: IMPORTED_AT,
          approvedBy: "actor.repository-reviewer.assembled",
          observedContentHash:
            repositoryImport.observedSolution.observedContentHash,
          observedSolutionId:
            repositoryImport.observedSolution.observedSolutionId,
          repositorySnapshotId: repositoryImport.snapshot.snapshotId,
          snapshotContentHash: repositoryImport.snapshot.snapshotDigest,
        },
      ],
    });
    const generationRequest = applicationGenerationRequestV1Schema.parse({
      ...baseRequest,
      solutionRevision: approvedSolutionRevision,
    });
    const sources = {
      applicationContracts:
        generationRequest.architectureDocument.applicationContracts,
      architectureDocument: generationRequest.architectureDocument,
      externalResources:
        generationRequest.architectureDocument.externalResources,
      solutionRevision: approvedSolutionRevision,
      workloadBehavior: generationRequest.workloadBehavior,
    };
    const designed = projectApprovedDesignToConformanceLayerInputV1({
      evidenceId: "evidence.design.assembled",
      sources,
      verifiedAt: VERIFIED_AT,
    });
    const generated = projectGeneratedSolutionToConformanceLayerInputV1({
      applicationEvidenceId: "evidence.application.assembled",
      applicationGeneration: {
        request: generationRequest,
        result: generateApplication(generationRequest),
      },
      compilation: fixture.compilation,
      compilerEvidenceId: "evidence.compiler.assembled",
      sources,
      verifiedAt: VERIFIED_AT,
    });
    const imported = projectRepositoryImportToConformanceLayerInputV1({
      result: repositoryImport,
      solutionRevision: approvedSolutionRevision,
    });
    const revision = {
      digest: hashCanonicalValue(approvedSolutionRevision),
      id: approvedSolutionRevision.solutionRevisionId,
    };
    expect(generated).toMatchObject({
      boundSolutionRevision: revision,
      integrity: "verified",
    });
    const resource = generationRequest.normalizedSolution.resources[0];
    if (resource === undefined) {
      throw new Error("The assembled fixture requires one compiled resource.");
    }

    const terraformTool = {
      digest: hashCanonicalValue("terraform-1.13.0"),
      id: "hashicorp.terraform",
      version: "1.13.0",
    };
    const generatedManifestDigest = hashCanonicalValue({
      application: generated.sources.map(({ digest }) => digest),
      compiler: fixture.compilation.artifact?.digest,
    });
    const addressDigest = hashCanonicalValue({
      address: "aws_lambda_function.assembled",
    });
    const sanitizedPlan = {
      formatVersion: "1.2",
      resourceChanges: [
        {
          actions: ["update" as const],
          address: addressDigest,
          mode: "managed" as const,
          providerName: "registry.terraform.io/hashicorp/aws" as const,
          type: "aws_lambda_function",
        },
      ],
      terraformVersion: terraformTool.version,
    };
    const backendConfigDigest = hashCanonicalValue("assembled-backend");
    const normalizedPlan = normalizeTerraformConformancePlanV1({
      bindings: [
        {
          addressDigest,
          confidence: "exact",
          deploymentKey: resource.deploymentKey,
          graphId: resource.id,
          ownership: "managed",
          semantics: {
            applicationBinding: "not-applicable",
            iam: "none",
            network: "none",
          },
        },
      ],
      contractVersion: 1,
      metadata: {
        backendConfigDigest,
        commitSha: COMMIT_SHA,
        createdAt: VERIFIED_AT,
        environmentId: ENVIRONMENT_ID,
        expiresAt: PLAN_EXPIRES_AT,
        generatedManifestDigest,
        planChecksum: sha256(canonicalJson(sanitizedPlan)),
        scope: "partial",
        solutionRevision: revision,
        target: "terraform",
        tool: terraformTool,
        workspace: "assembled",
      },
      plan: sanitizedPlan,
    });
    const planned = projectNormalizedPlanToConformanceLayerInputV1({
      evidenceId: "evidence.plan.assembled",
      expected: {
        backendConfigDigest,
        commitSha: COMMIT_SHA,
        environmentId: ENVIRONMENT_ID,
        evidenceChecksum: normalizedPlan.evidenceChecksum,
        generatedManifestDigest,
        now: NOW,
        planChecksum: normalizedPlan.sourceRepresentationChecksum,
        solutionRevision: revision,
        target: "terraform",
        tool: terraformTool,
        workspace: "assembled",
      },
      plan: normalizedPlan,
    });

    const workflow = {
      runAttempt: 1,
      runId: "800100",
      workflowDigest: hashCanonicalValue("assembled-deployment-workflow"),
    };
    const planIdentityDigest = hashCanonicalValue({
      evidenceChecksum: normalizedPlan.evidenceChecksum,
      planChecksum: normalizedPlan.planChecksum,
    });
    const deploymentInput = {
      approvedPlanEvidenceChecksum: normalizedPlan.evidenceChecksum,
      artifactAttestations: [],
      commitSha: COMMIT_SHA,
      contractVersion: 1,
      environmentId: ENVIRONMENT_ID,
      executedPlanEvidenceChecksum: normalizedPlan.evidenceChecksum,
      generatedManifestDigest,
      observedAt: "2026-08-29T11:45:00.000Z",
      planIdentityDigest,
      smoke: { state: "not-run" as const },
      solutionRevision: revision,
      target: "terraform" as const,
      workflow,
    };
    const normalizedDeployment = normalizeDeploymentConformanceV1(
      deploymentInput,
      {
        approvedPlanEvidenceChecksum: normalizedPlan.evidenceChecksum,
        commitSha: COMMIT_SHA,
        environmentId: ENVIRONMENT_ID,
        expectedArtifactBindings: [],
        generatedManifestDigest,
        planIdentityDigest,
        solutionRevision: revision,
        target: "terraform",
        workflow,
      },
    );
    const deployed = projectNormalizedDeploymentToConformanceLayerInputV1({
      deployment: normalizedDeployment,
      evidenceId: "evidence.deployment.assembled",
    });

    const normalizedDrift = normalizeDriftConformanceV1(
      {
        baselineDeploymentEvidenceChecksum:
          normalizedDeployment.evidenceChecksum,
        changes: [
          {
            action: "update",
            classification: "managed-drift",
            confidence: "partial",
            graphId: resource.id,
            ownership: "managed",
            resourceIdentityDigest: addressDigest,
          },
        ],
        contractVersion: 1,
        environmentId: ENVIRONMENT_ID,
        observedAt: "2026-08-29T11:50:00.000Z",
        scope: "partial",
        solutionRevision: revision,
        source: "terraform-refresh-only",
        target: "terraform",
        validUntil: PLAN_EXPIRES_AT,
      },
      {
        approvedDeploymentEvidenceChecksum:
          normalizedDeployment.evidenceChecksum,
        environmentId: ENVIRONMENT_ID,
        solutionRevision: revision,
        target: "terraform",
      },
      NOW,
    );
    const drift = projectNormalizedDriftToConformanceLayerInputV1({
      drift: normalizedDrift,
      evidenceId: "evidence.drift.assembled",
    });

    const evaluator = versionedToolReferenceV1Schema.parse({
      id: "cloudmarkup.continuous-conformance.assembled",
      version: "1.0.0",
    });
    const projectedLayers = [
      designed,
      imported,
      generated,
      planned,
      deployed,
      drift,
    ];
    expect(
      projectedLayers.every(({ integrity }) => integrity === "verified"),
    ).toBe(true);
    const composition = composeConformanceReportV1({
      clock: () => new Date(NOW),
      currentSolutionRevision: revision,
      evaluation: {
        contractVersion: 1,
        environment: {
          environmentId: ENVIRONMENT_ID,
          environmentType: "test",
        },
        evaluatedSolutionRevision: revision,
        layers: projectedLayers,
        projectId: PROJECT_ID,
      },
      evaluator,
      previousIssues: [],
      stalenessPolicy: defaultConformanceStalenessPolicyV1,
    });
    const report = conformanceReportV1Schema.parse(composition.report);
    const reportPath = join(
      repositoryRoot,
      "cloudmarkup-conformance.report.json",
    );
    const reportBytes = Buffer.from(serializeCanonicalJson(report));
    await writeFile(reportPath, reportBytes, { flag: "wx" });
    const artifact = conformanceReportV1Schema.parse(
      JSON.parse(await readFile(reportPath, "utf8")),
    );

    expect(artifact.layers.map(({ layer }) => layer)).toEqual(LAYER_ORDER);
    expect(new Set(artifact.layers.map(({ layer }) => layer)).size).toBe(6);
    const byLayer = new Map(
      artifact.layers.map((layer) => [layer.layer, layer] as const),
    );
    for (const layer of artifact.layers) {
      expect(layer).toMatchObject({
        availability: "available",
        boundSolutionRevision: revision,
        quality: { freshness: "current" },
      });
      expect(layer.evidenceIds.length).toBeGreaterThan(0);
      expect(layer.sources.length).toBeGreaterThan(0);
      for (const source of layer.sources) {
        expect(artifact.provenance.sourceIds).toContain(source.sourceId);
        expect(artifact.provenance.inputDigests).toContain(source.digest);
      }
    }
    expect(byLayer.get("designed")?.quality.completeness).toBe("complete");
    expect(byLayer.get("generated")?.quality.completeness).toBe("complete");
    expect(byLayer.get("planned")?.quality.completeness).toBe("partial");
    expect(byLayer.get("deployed")?.quality.completeness).toBe("unknown");
    expect(byLayer.get("current-drift")?.quality.completeness).toBe("partial");
    expect(byLayer.get("imported")?.sources).toContainEqual(
      expect.objectContaining({
        digest: repositoryImport.snapshot.snapshotDigest,
        repositoryCommit: COMMIT_SHA,
      }),
    );
    expect(byLayer.get("planned")?.sources).toContainEqual(
      expect.objectContaining({ digest: normalizedPlan.evidenceChecksum }),
    );
    expect(byLayer.get("deployed")?.sources).toContainEqual(
      expect.objectContaining({
        digest: normalizedDeployment.evidenceChecksum,
      }),
    );
    expect(byLayer.get("current-drift")?.sources).toContainEqual(
      expect.objectContaining({ digest: normalizedDrift.evidenceChecksum }),
    );
    expect(normalizedDrift.baselineDeploymentEvidenceChecksum).toBe(
      normalizedDeployment.evidenceChecksum,
    );
    expect(artifact.reportDigest).toBe(getConformanceReportDigestV1(artifact));
    expect(artifact.mutationPolicy).toBe("review-only-no-auto-remediation");
    expect(artifact.comparisonAuthority).toBe("non-mutating-multi-layer");
    expect(artifact.differences.length).toBeGreaterThan(0);
    expect(artifact.issues.length).toBeGreaterThan(0);
    expect(
      artifact.issues.every((issue) => issue.deterministicFix === undefined),
    ).toBe(true);
    expect(reportBytes.byteLength).toBeLessThan(8 * 1024 * 1024);
    expect(artifact).toEqual(report);
    expect(JSON.stringify(artifact)).not.toContain(repositoryRoot);
    expect(JSON.stringify(artifact)).not.toMatch(
      /AKIA[0-9A-Z]{16}|aws_secret_access_key|BEGIN PRIVATE KEY/u,
    );
  });
});
