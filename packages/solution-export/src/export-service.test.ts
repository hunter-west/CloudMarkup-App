import { generateApplication } from "@cloudmarkup/application-generator";
import {
  createNotesGenerationRequest,
  type FixtureMode,
} from "@cloudmarkup/application-generator/testing";
import {
  conformanceDiagramRequestV1Schema,
  createConformanceDiagramService,
  type ConformanceDiagramRequestV1,
} from "@cloudmarkup/diagram-export";
import {
  applicationGenerationRequestV1Schema,
  evidenceRecordV1Schema,
  repositoryRelativePathSchema,
  serializeCanonicalJson,
  solutionRevisionManifestV1Schema,
  type ApplicationGenerationRequestV1,
  type EvidenceRecordV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  canonicalSemanticDigest,
  computeReviewedRepositoryWorkflowsResultDigestV1,
  createDeterministicZip,
  decodeUtf8,
  encodeUtf8,
  exactToolPinV1Schema,
  generateSolutionExport,
  localSolutionExportService,
  readDeterministicZip,
  restoreSolutionExportArtifact,
  reviewedRepositoryWorkflowsDigestPayloadV1Schema,
  reviewedRepositoryWorkflowsV1Schema,
  SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH,
  sha256Digest,
  solutionExportInfrastructureArtifactV1Schema,
  solutionExportProvenanceV1Schema,
  solutionExportRepositoryWorkflowsV1Schema,
  solutionExportRequestV1Schema,
  type SolutionExportArtifactV1,
  type SolutionExportInfrastructureArtifactV1,
  type SolutionExportMediaTypeV1,
  type SolutionExportOwnershipKindV1,
  type SolutionExportRequestV1,
  type SolutionExportResultV1,
} from "./index.js";

const COMPILER = exactToolPinV1Schema.parse({
  digest: sha256Digest(
    serializeCanonicalJson({
      id: "cloudmarkup.iac-compiler",
      version: "1.1.0",
    }),
  ),
  id: "cloudmarkup.iac-compiler",
  version: "1.1.0",
});

const RENDERER = exactToolPinV1Schema.parse({
  digest: sha256Digest(
    serializeCanonicalJson({
      id: "cloudmarkup.terraform-renderer",
      version: "1.1.0",
    }),
  ),
  id: "cloudmarkup.terraform-renderer",
  version: "1.1.0",
});

const CONFORMANCE_DIAGRAM_SERVICE = createConformanceDiagramService();

function conformanceDiagram(
  solutionRevisionId: string,
  overrides: Partial<ConformanceDiagramRequestV1> = {},
) {
  const request = conformanceDiagramRequestV1Schema.parse({
    contractVersion: 1,
    differences: [
      {
        differenceId: "difference.plan.update",
        evidenceIds: ["evidence.plan"],
        kind: "plan-update",
        severity: "warning",
        summary: "The planned function configuration differs from design.",
        target: { id: "node.function", kind: "node" },
      },
    ],
    edges: [
      {
        differenceIds: [],
        evidenceIds: ["evidence.design"],
        id: "edge.api-function",
        label: "invokes",
        mapping: "mapped",
        presence: "present",
        sourceNodeId: "node.api",
        status: "matching",
        targetNodeId: "node.function",
      },
    ],
    environmentId: "environment.development",
    environmentLabel: "development us-east-1",
    nodes: [
      {
        differenceIds: [],
        evidenceIds: ["evidence.design"],
        id: "node.api",
        label: "Notes API",
        mapping: "mapped",
        position: { x: 120, y: 180 },
        presence: "present",
        serviceLabel: "Amazon API Gateway",
        status: "matching",
      },
      {
        differenceIds: ["difference.plan.update"],
        evidenceIds: ["evidence.plan"],
        id: "node.function",
        label: "Notes handler",
        mapping: "mapped",
        position: { x: 520, y: 180 },
        presence: "present",
        serviceLabel: "AWS Lambda",
        status: "different",
      },
    ],
    provenance: [
      {
        evidenceIds: ["evidence.design"],
        provenanceId: "source.design",
        sourceDigest: sha256Digest("approved-architecture-evidence"),
        sourceLabel: "approved architecture",
        verifiedAt: "2026-08-29T10:00:00.000Z",
      },
      {
        evidenceIds: ["evidence.plan"],
        provenanceId: "source.plan",
        sourceDigest: sha256Digest("sanitized-plan-evidence"),
        sourceLabel: "sanitized saved plan",
        verifiedAt: "2026-08-29T10:05:00.000Z",
      },
    ],
    quality: {
      availability: "available",
      completeness: "partial",
      expiresAt: "2026-08-29T10:30:00.000Z",
      freshness: "stale",
      lastVerifiedAt: "2026-08-29T10:05:00.000Z",
      reason: "Only safely mapped evidence is included in this projection.",
    },
    reportDigest: sha256Digest("continuous-conformance-report"),
    reportId: "report.notes.7",
    showDifferences: true,
    solutionRevisionId,
    state: "planned",
    title: "Notes conformance evidence",
    unmappedEvidence: [],
    ...overrides,
  });
  return {
    request,
    result: CONFORMANCE_DIAGRAM_SERVICE.generate(request),
  };
}
const defaultLimits = {
  maxArchiveBytes: 8 * 1024 * 1024,
  maxDecompressedBytes: 8 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxFiles: 512,
  maxPathBytes: 200,
} as const;

interface ExportFixtureOptions {
  readonly exportName?: string;
  readonly mode?: FixtureMode;
  readonly reverseCollections?: boolean;
  readonly supplementalFiles?: readonly unknown[];
}

function compilerProvenance(
  revisionId: string,
  references: readonly {
    readonly id: string;
    readonly kind: "policy" | "resource" | "workload";
  }[],
) {
  return solutionExportProvenanceV1Schema.parse({
    producer: COMPILER,
    solutionRevisionId: revisionId,
    sourceReferences: references,
  });
}

function textFile(
  path: string,
  content: string,
  mediaType: SolutionExportMediaTypeV1,
  revisionId: string,
) {
  const bytes = encodeUtf8(content);
  return {
    checksum: sha256Digest(bytes),
    content,
    mediaType,
    ownership: "generated" as const,
    path,
    provenance: compilerProvenance(revisionId, [
      { id: "workload_notes_api", kind: "workload" },
    ]),
    semanticChecksum: canonicalSemanticDigest(mediaType, bytes),
  };
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

type InfrastructureWithoutArtifactDigest<Artifact> = Artifact extends unknown
  ? Omit<Artifact, "artifactDigest">
  : never;

function canonicalInfrastructureDigest(
  infrastructure: InfrastructureWithoutArtifactDigest<SolutionExportInfrastructureArtifactV1>,
) {
  return sha256Digest(
    serializeCanonicalJson({
      ...infrastructure,
      applicationArtifacts: [...infrastructure.applicationArtifacts].sort(
        (left, right) =>
          compareUtf16(
            serializeCanonicalJson(left),
            serializeCanonicalJson(right),
          ),
      ),
      diagnostics: [...infrastructure.diagnostics].sort((left, right) =>
        compareUtf16(
          serializeCanonicalJson(left),
          serializeCanonicalJson(right),
        ),
      ),
      files: [...infrastructure.files].sort((left, right) =>
        compareUtf16(left.path, right.path),
      ),
      policyArtifacts: [...infrastructure.policyArtifacts].sort((left, right) =>
        compareUtf16(left.policyDocumentId, right.policyDocumentId),
      ),
      ...(infrastructure.target === "terraform"
        ? {
            providers: [...infrastructure.providers].sort((left, right) =>
              compareUtf16(left.source, right.source),
            ),
          }
        : {}),
      resources: [...infrastructure.resources].sort((left, right) =>
        compareUtf16(left.resourceId, right.resourceId),
      ),
    }),
  );
}

function buildInfrastructure(
  request: ApplicationGenerationRequestV1,
  mode: FixtureMode,
  reverse: boolean,
): SolutionExportInfrastructureArtifactV1 {
  const revisionId = request.solutionRevision.solutionRevisionId;
  const files = [
    textFile(
      "infrastructure/main.tf",
      'terraform {\n  required_version = ">= 1.9.0, < 2.0.0"\n}\n\nresource "aws_lambda_function" "notes_handler" {\n  function_name = "notes-handler"\n  role          = aws_iam_role.notes_handler.arn\n  handler       = "index.handler"\n  runtime       = "nodejs24.x"\n}\n',
      "application/vnd.hashicorp.terraform",
      revisionId,
    ),
    textFile(
      "infrastructure/README.md",
      "# Generated infrastructure\n\nProduced from the immutable Solution Revision.\n",
      "text/markdown",
      revisionId,
    ),
  ];
  const resources = [
    {
      dependentEdgeIds: ["edge_api_invokes_lambda"],
      dependentNodeIds: ["node_notes_function"],
      resourceId: "aws_lambda_function.notes_handler",
      targetKey: "notes_handler",
    },
    {
      dependentEdgeIds: ["edge_lambda_writes_table"],
      dependentNodeIds: ["node_notes_table"],
      resourceId: "aws_dynamodb_table.notes_table",
      targetKey: "notes_table",
    },
  ];
  const policies = [
    {
      ownerNodeId: "node_notes_function",
      ownership: "generated" as const,
      policyDocumentId: "policy.generated.dynamodb",
      policyKind: "inline",
      provenance: compilerProvenance(revisionId, [
        { id: "policy.generated.dynamodb", kind: "policy" },
      ]),
      renderedAs: "aws_iam_role_policy",
    },
    {
      ownerNodeId: "node_notes_function",
      ownership: "user-owned" as const,
      policyDocumentId: "policy.custom.audit",
      policyKind: "inline",
      provenance: compilerProvenance(revisionId, [
        { id: "policy.custom.audit", kind: "policy" },
      ]),
      renderedAs: "aws_iam_role_policy",
    },
  ];
  const applicationArtifacts = [
    {
      implementationMode: mode,
      inputs: [],
      workloadId: "workload_notes_api",
    },
  ];
  const projection = {
    applicationArtifacts: reverse
      ? applicationArtifacts.toReversed()
      : applicationArtifacts,
    catalog: request.solutionRevision.versions.catalog,
    compiler: COMPILER,
    contractVersion: 1 as const,
    diagnostics: [],
    files: reverse ? files.toReversed() : files,
    formatVersion: "1.0.0",
    kind: "cloudmarkup.export-infrastructure-input" as const,
    policyArtifacts: reverse ? policies.toReversed() : policies,
    providers: [
      {
        source: "hashicorp/aws",
        versionConstraint: ">= 5.0.0, < 7.0.0",
      },
    ],
    requiredTerraformVersion: ">= 1.9.0, < 2.0.0",
    resources: reverse ? resources.toReversed() : resources,
    solutionRevisionId: revisionId,
    target: "terraform" as const,
  };
  const provisional = solutionExportInfrastructureArtifactV1Schema.parse({
    ...projection,
    artifactDigest: sha256Digest("provisional"),
  });
  const { artifactDigest: provisionalDigest, ...digestProjection } =
    provisional;
  void provisionalDigest;
  return solutionExportInfrastructureArtifactV1Schema.parse({
    ...digestProjection,
    artifactDigest: canonicalInfrastructureDigest(digestProjection),
  });
}

function buildCloudFormationInfrastructure(
  request: ApplicationGenerationRequestV1,
  mode: FixtureMode,
): SolutionExportInfrastructureArtifactV1 {
  const terraform = buildInfrastructure(request, mode, false);
  if (terraform.target !== "terraform") {
    throw new TypeError("Expected Terraform infrastructure.");
  }
  const { artifactDigest, providers, requiredTerraformVersion, ...shared } =
    terraform;
  void artifactDigest;
  void providers;
  void requiredTerraformVersion;
  const template = textFile(
    "infrastructure/template.json",
    '{\n  "AWSTemplateFormatVersion": "2010-09-09",\n  "Resources": {}\n}\n',
    "application/vnd.amazon.cloudformation.template+json",
    request.solutionRevision.solutionRevisionId,
  );
  const projection = {
    ...shared,
    files: [
      template,
      ...shared.files.filter(({ path }) => path !== "infrastructure/main.tf"),
    ],
    localValidation: "cloudmarkup-structured-template-v1",
    target: "cloudformation" as const,
    templateFormat: "json" as const,
    templateSpecificationVersion: "2010-09-09" as const,
  };
  const provisional = solutionExportInfrastructureArtifactV1Schema.parse({
    ...projection,
    artifactDigest: sha256Digest("provisional-cloudformation"),
  });
  const { artifactDigest: provisionalDigest, ...digestProjection } =
    provisional;
  void provisionalDigest;
  return solutionExportInfrastructureArtifactV1Schema.parse({
    ...digestProjection,
    artifactDigest: canonicalInfrastructureDigest(digestProjection),
  });
}

function withCompilerBinding(
  input: ApplicationGenerationRequestV1,
): ApplicationGenerationRequestV1 {
  const solutionRevision = solutionRevisionManifestV1Schema.parse({
    ...input.solutionRevision,
    versions: {
      ...input.solutionRevision.versions,
      applicationGenerator:
        input.solutionRevision.versions.applicationGenerator,
      compiler: { state: "pinned", tool: COMPILER },
    },
  });
  return applicationGenerationRequestV1Schema.parse({
    ...input,
    solutionRevision,
  });
}

function createExportRequest(
  options: ExportFixtureOptions = {},
): SolutionExportRequestV1 {
  const mode = options.mode ?? "complete-supported-pattern";
  const includeApplication = mode !== "infrastructure-only";
  const generatorRequest = withCompilerBinding(
    createNotesGenerationRequest({
      mode,
      operations:
        mode === "complete-supported-pattern"
          ? ["create", "read", "update", "delete"]
          : ["create"],
      ...(options.reverseCollections === undefined
        ? {}
        : { reverseCollections: options.reverseCollections }),
    }),
  );
  return solutionExportRequestV1Schema.parse({
    application: includeApplication
      ? generateApplication(generatorRequest)
      : undefined,
    architectureDocument: generatorRequest.architectureDocument,
    contractVersion: 1,
    existingFiles: [],
    infrastructure: buildInfrastructure(
      generatorRequest,
      mode,
      options.reverseCollections ?? false,
    ),
    solutionRevision: generatorRequest.solutionRevision,
    supplementalFiles: options.supplementalFiles ?? [],
    target: {
      exportName: options.exportName ?? "Notes API Export",
      limits: defaultLimits,
      policyPacks: [],
      renderer: RENDERER,
      target: "terraform",
    },
  });
}

function ready(result: SolutionExportResultV1): SolutionExportArtifactV1 {
  if (result.state !== "ready") {
    throw new Error(
      `Expected a ready export: ${result.diagnostics.map(({ code }) => code).join(", ")}`,
    );
  }
  return result.artifact;
}

function diagnosticCodes(result: SolutionExportResultV1): string[] {
  return result.diagnostics.map(({ code }) => code);
}

function supplementalText(
  path: string,
  value: string,
  ownership: Exclude<
    SolutionExportOwnershipKindV1,
    "architecture-as-code-source" | "generated-replaceable"
  > = "user-provided",
  kind:
    "regular-file" | "symlink" | "device-file" | "directory" = "regular-file",
) {
  const bytes = encodeUtf8(value);
  return {
    checksum: sha256Digest(bytes),
    content: { encoding: "utf8", value },
    kind,
    mediaType: "text/plain",
    ownership,
    path,
    provenance: solutionExportProvenanceV1Schema.parse({
      producer: COMPILER,
      solutionRevisionId: "solution_notes_revision_1",
      sourceReferences: [{ id: "workload_notes_api", kind: "workload" }],
    }),
    semanticChecksum: canonicalSemanticDigest("text/plain", bytes),
  };
}

const REVIEWED_WORKFLOW_PATHS = [
  ".github/workflows/cloudmarkup-deploy.yml",
  ".github/workflows/cloudmarkup-drift.yml",
  ".github/workflows/cloudmarkup-plan.yml",
  ".github/workflows/cloudmarkup-smoke.yml",
  ".github/workflows/cloudmarkup-validate.yml",
] as const;

function reviewedRepositoryWorkflows(request: SolutionExportRequestV1) {
  const revisionId = request.solutionRevision.solutionRevisionId;
  const revisionDigest = sha256Digest(
    serializeCanonicalJson(request.solutionRevision),
  );
  const files = REVIEWED_WORKFLOW_PATHS.map((path) => {
    const content = [
      `name: ${path.split("/").at(-1)?.replace(".yml", "") ?? "reviewed"}`,
      "on:",
      "  workflow_dispatch:",
      "permissions:",
      "  contents: read",
      "jobs:",
      "  reviewed:",
      "    runs-on: ubuntu-latest",
      "    steps: []",
      "",
    ].join("\n");
    const bytes = encodeUtf8(content);
    return {
      checksum: sha256Digest(bytes),
      content: { encoding: "utf8" as const, value: content },
      kind: "regular-file" as const,
      mediaType: "application/yaml" as const,
      ownership: "generated-replaceable" as const,
      path,
      provenance: solutionExportProvenanceV1Schema.parse({
        producer: COMPILER,
        solutionRevisionId: revisionId,
        sourceReferences: [{ id: revisionId, kind: "solution-revision" }],
      }),
      semanticChecksum: canonicalSemanticDigest("application/yaml", bytes),
    };
  });
  const payload = reviewedRepositoryWorkflowsDigestPayloadV1Schema.parse({
    configDigest: sha256Digest("reviewed-workflow-config"),
    contractVersion: 1,
    dependencyLockDigests: [
      {
        digest: sha256Digest("reviewed-action-pins"),
        id: "action-pin-registry",
      },
    ],
    files,
    generator: COMPILER,
    kind: "cloudmarkup.reviewed-repository-workflows",
    pinRegistryDigest: sha256Digest("reviewed-action-pins"),
    policyDigest: sha256Digest("reviewed-workflow-policy"),
    repository: {
      defaultBranch: "main",
      destinationFolder: "solutions/notes",
      name: "platform",
      owner: "example",
      repositoryId: "900",
      repositoryOwnerId: "500",
      state: "bound",
    },
    requiredPackageTrees: [
      {
        files: [...request.infrastructure.files]
          .sort((left, right) => compareUtf16(left.path, right.path))
          .map(({ checksum, path }) => ({ checksum, path })),
        root: "infrastructure",
      },
    ],
    review: {
      environments: [
        {
          approvedRefs: ["refs/heads/main"],
          githubEnvironment: "development",
          id: "dev",
          protected: false,
          requiredApprovals: 0,
          smokeBaseUrlDigest: sha256Digest("approved-development-smoke-url"),
          workspace: "dev",
        },
      ],
      permissions: files.map(({ path }) => ({
        access: "read" as const,
        explanation: "Reads the reviewed repository package.",
        scope: "contents",
        workflowPath: path,
      })),
      roles: [
        {
          audience: "customer-cloud",
          environment: "dev",
          purpose: "plan",
          reference: "vars.CLOUDMARKUP_PLAN_ROLE_ARN",
          subject: "repo:example/platform:ref:refs/heads/main",
          variable: "CLOUDMARKUP_PLAN_ROLE_ARN",
        },
      ],
      secrets: [],
      triggers: files.map(({ path }) => ({
        events: ["workflow_dispatch"],
        workflowPath: path,
      })),
      variables: [
        {
          name: "CLOUDMARKUP_PLAN_ROLE_ARN",
          purpose: "Customer planning role",
        },
      ],
      workflows: files.map(({ path }) => ({
        environmentScoped: true,
        path,
        purpose: "Reviewed customer-owned lifecycle operation",
      })),
      warnings: [],
    },
    solutionRevision: { digest: revisionDigest, id: revisionId },
    validator: RENDERER,
  });
  return reviewedRepositoryWorkflowsV1Schema.parse({
    ...payload,
    resultDigest: computeReviewedRepositoryWorkflowsResultDigestV1(payload),
  });
}

function supplementalZip(path: string) {
  const bytes = new Uint8Array([0, 1, 2, 3, 4]);
  return {
    checksum: sha256Digest(bytes),
    content: {
      encoding: "base64",
      value: Buffer.from(bytes).toString("base64"),
    },
    kind: "regular-file",
    mediaType: "application/zip",
    ownership: "generated-build-artifact",
    path,
    provenance: solutionExportProvenanceV1Schema.parse({
      producer: COMPILER,
      solutionRevisionId: "solution_notes_revision_1",
      sourceReferences: [{ id: "workload_notes_api", kind: "workload" }],
    }),
    semanticChecksum: canonicalSemanticDigest("application/zip", bytes),
  };
}

function externalEvidence(
  revisionId: string,
  id: string,
  level: 3 | 5,
): EvidenceRecordV1 {
  const inputDigest = sha256Digest(`${id}:input`);
  return evidenceRecordV1Schema.parse({
    artifacts: [],
    checks: [
      {
        artifactDigests: [],
        checkId:
          level === 5
            ? "cloudmarkup.evidence.application-build-and-tests"
            : "cloudmarkup.evidence.terraform-static-validation",
        issueIds: [],
        status: "passed",
        summary: "The isolated external stage passed before export.",
      },
    ],
    contractVersion: 1,
    environment: { environmentType: "unknown" },
    id,
    layer: "generated",
    level:
      level === 5
        ? { kind: "application-build-and-tests", rank: 5 }
        : { kind: "deterministic-target-compilation", rank: 3 },
    models: [],
    provenance: {
      actor: { kind: "deterministic-tool", tool: COMPILER },
      createdAt: "2026-08-18T12:00:00.000Z",
      inputDigests: [inputDigest],
    },
    solutionRevisionId: revisionId,
    staleness: {
      assessedAt: "2026-08-18T12:00:00.000Z",
      state: "current",
    },
    tools: [COMPILER],
  });
}

function evidenceSupplemental(record: EvidenceRecordV1) {
  const value = serializeCanonicalJson(record);
  const bytes = encodeUtf8(value);
  return {
    checksum: sha256Digest(bytes),
    content: { encoding: "utf8" as const, value },
    kind: "regular-file" as const,
    mediaType: "application/json" as const,
    ownership: "evidence-artifact" as const,
    path: `evidence/external/${record.id}.json`,
    provenance: solutionExportProvenanceV1Schema.parse({
      producer: COMPILER,
      solutionRevisionId: record.solutionRevisionId,
      sourceReferences: [{ id: record.id, kind: "evidence" }],
    }),
    semanticChecksum: canonicalSemanticDigest("application/json", bytes),
  };
}

function replaceAsciiEverywhere(
  bytes: Uint8Array,
  source: string,
  replacement: string,
): Uint8Array {
  const sourceBytes = encodeUtf8(source);
  const replacementBytes = encodeUtf8(replacement);
  if (sourceBytes.byteLength !== replacementBytes.byteLength) {
    throw new Error("ZIP path mutation requires equal byte lengths.");
  }
  const output = bytes.slice();
  for (
    let offset = 0;
    offset <= output.byteLength - sourceBytes.byteLength;
    offset += 1
  ) {
    if (sourceBytes.every((value, index) => output[offset + index] === value)) {
      output.set(replacementBytes, offset);
    }
  }
  return output;
}

describe("retained Solution export reconstruction", () => {
  function retained(artifact: SolutionExportArtifactV1) {
    return {
      archiveFileName: artifact.archiveFileName,
      fileCount: artifact.files.length,
      manifestBytes: encodeUtf8(serializeCanonicalJson(artifact.manifest)),
      manifestDigest: artifact.manifestDigest,
      solutionRevisionDigest: artifact.manifest.solutionRevision.digest,
      solutionRevisionId: artifact.manifest.solutionRevision.id,
      zipBytes: artifact.zipBytes,
      zipDigest: artifact.zipDigest,
    };
  }

  it.each(["infrastructure-only", "complete-supported-pattern"] as const)(
    "round trips exact verified %s bytes and ownership without running a producer",
    (mode) => {
      const artifact = ready(
        generateSolutionExport(createExportRequest({ mode })),
      );
      expect(restoreSolutionExportArtifact(retained(artifact))).toEqual(
        artifact,
      );
    },
  );

  it("restores CloudFormation without rewriting its target or files", () => {
    const request = createExportRequest({ mode: "infrastructure-only" });
    const generation = withCompilerBinding(
      createNotesGenerationRequest({
        mode: "infrastructure-only",
        operations: ["create"],
      }),
    );
    const artifact = ready(
      generateSolutionExport({
        ...request,
        infrastructure: buildCloudFormationInfrastructure(
          generation,
          "infrastructure-only",
        ),
        target: { ...request.target, target: "cloudformation" },
      }),
    );
    expect(restoreSolutionExportArtifact(retained(artifact))).toEqual(artifact);
  });

  it.each([
    "archiveFileName",
    "fileCount",
    "solutionRevisionId",
    "solutionRevisionDigest",
    "manifestDigest",
    "zipDigest",
  ] as const)("rejects substituted %s metadata with a safe error", (field) => {
    const input = retained(
      ready(
        generateSolutionExport(
          createExportRequest({ mode: "infrastructure-only" }),
        ),
      ),
    );
    const value = field === "fileCount" ? input.fileCount + 1 : "substituted";
    expect(() =>
      restoreSolutionExportArtifact({ ...input, [field]: value }),
    ).toThrow("The retained Solution export failed integrity verification.");
  });

  it("rejects noncanonical manifest bytes and archive corruption even with newly matching outer digests", () => {
    const input = retained(
      ready(
        generateSolutionExport(
          createExportRequest({ mode: "infrastructure-only" }),
        ),
      ),
    );
    const manifestBytes = encodeUtf8(`${decodeUtf8(input.manifestBytes)} `);
    expect(() =>
      restoreSolutionExportArtifact({
        ...input,
        manifestBytes,
        manifestDigest: sha256Digest(manifestBytes),
      }),
    ).toThrow("integrity verification");
    const zipBytes = input.zipBytes.slice();
    zipBytes[0] = 0;
    expect(() =>
      restoreSolutionExportArtifact({
        ...input,
        zipBytes,
        zipDigest: sha256Digest(zipBytes),
      }),
    ).toThrow("integrity verification");
  });

  it("detaches retained input bytes and rejects a changed file with a fresh ZIP digest", () => {
    const artifact = ready(
      generateSolutionExport(
        createExportRequest({ mode: "infrastructure-only" }),
      ),
    );
    const input = retained(artifact);
    const restored = restoreSolutionExportArtifact(input);
    input.zipBytes.fill(0);
    input.manifestBytes.fill(0);
    expect(localSolutionExportService.verify(restored)).toEqual([]);
    const zipBytes = createDeterministicZip(
      restored.files.map((file) =>
        file.path === "README.md"
          ? { ...file, bytes: encodeUtf8("changed") }
          : file,
      ),
    );
    expect(() =>
      restoreSolutionExportArtifact({
        ...retained(restored),
        zipBytes,
        zipDigest: sha256Digest(zipBytes),
      }),
    ).toThrow("integrity verification");
  });
});

describe("deterministic Solution export", () => {
  it("packages verified conformance diagrams as deterministic evidence artifacts", () => {
    const base = createExportRequest({ mode: "infrastructure-only" });
    const designed = conformanceDiagram(
      base.solutionRevision.solutionRevisionId,
      {
        showDifferences: false,
        state: "designed",
      },
    );
    const planned = conformanceDiagram(
      base.solutionRevision.solutionRevisionId,
    );
    const first = ready(
      generateSolutionExport({
        ...base,
        conformanceDiagrams: [planned, designed],
      }),
    );
    const reordered = ready(
      generateSolutionExport({
        ...base,
        conformanceDiagrams: [designed, planned],
      }),
    );

    expect(first.manifest.conformanceDiagrams).toEqual([
      designed.result.artifact,
      planned.result.artifact,
    ]);
    expect(first.zipDigest).toBe(reordered.zipDigest);
    expect(first.manifestDigest).toBe(reordered.manifestDigest);
    for (const entry of [designed, planned]) {
      const file = first.files.find(
        ({ path }) => path === entry.result.artifact.file.path,
      );
      expect(file).toEqual(
        expect.objectContaining({
          checksum: entry.result.artifact.svgDigest,
          mediaType: "image/svg+xml",
          ownership: "evidence-artifact",
          semanticChecksum: entry.result.artifact.svgDigest,
        }),
      );
      expect(file?.bytes.byteLength).toBe(entry.result.artifact.file.sizeBytes);
    }
    const zipPaths = readDeterministicZip(first.zipBytes).map(
      ({ path }) => path,
    );
    expect(zipPaths).toContain("diagram/conformance/designed.svg");
    expect(zipPaths).toContain("diagram/conformance/planned-differences.svg");
    const readme = first.files.find(({ path }) => path === "README.md");
    const readmeText = decodeUtf8(readme?.bytes ?? new Uint8Array());
    expect(readmeText).toContain(
      "[Designed](diagram/conformance/designed.svg)",
    );
    expect(readmeText).toContain(
      "[Planned with Differences](diagram/conformance/planned-differences.svg)",
    );
    expect(readmeText).toContain("availability `available`");
    expect(readmeText).toContain("environment `environment.development`");
    expect(readmeText).toContain("report `report.notes.7`");
    expect(readmeText).toContain(planned.result.artifact.reportDigest);
    expect(readmeText).toContain("expires `2026-08-29T10:30:00.000Z`");
    expect(
      planned.result.artifact.provenance.map(
        ({ evidenceIds, provenanceId, sourceDigest }) => ({
          evidenceIds,
          provenanceId,
          sourceDigest,
        }),
      ),
    ).toEqual([
      {
        evidenceIds: ["evidence.design"],
        provenanceId: "source.design",
        sourceDigest: sha256Digest("approved-architecture-evidence"),
      },
      {
        evidenceIds: ["evidence.plan"],
        provenanceId: "source.plan",
        sourceDigest: sha256Digest("sanitized-plan-evidence"),
      },
    ]);
    expect(readmeText).toContain(planned.result.artifact.provenanceDigest);
    expect(readmeText).toContain("never remediate drift");
    expect(localSolutionExportService.verify(first)).toEqual([]);
  });

  it("rejects substituted diagrams, wrong revisions, and duplicate selections", () => {
    const base = createExportRequest({ mode: "infrastructure-only" });
    const valid = conformanceDiagram(base.solutionRevision.solutionRevisionId);
    const substituted = {
      ...valid,
      result: {
        ...valid.result,
        svg: valid.result.svg.replace("Notes API", "Other API"),
      },
    };
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...base,
          conformanceDiagrams: [substituted],
        }),
      ),
    ).toContain("EXPORT_CONFORMANCE_DIAGRAM_INVALID");

    const wrongRevision = conformanceDiagram("solution.other.revision");
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...base,
          conformanceDiagrams: [wrongRevision],
        }),
      ),
    ).toContain("EXPORT_CONFORMANCE_DIAGRAM_REVISION_MISMATCH");

    const mismatchedReport = conformanceDiagram(
      base.solutionRevision.solutionRevisionId,
      { reportId: "report.other", state: "designed" },
    );
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...base,
          conformanceDiagrams: [valid, mismatchedReport],
        }),
      ),
    ).toContain("EXPORT_REQUEST_INVALID");

    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...base,
          conformanceDiagrams: [valid, valid],
        }),
      ),
    ).toContain("EXPORT_REQUEST_INVALID");
  });

  it("independently rejects tampered packaged conformance metadata", () => {
    const base = createExportRequest({ mode: "infrastructure-only" });
    const diagram = conformanceDiagram(
      base.solutionRevision.solutionRevisionId,
    );
    const artifact = ready(
      generateSolutionExport({ ...base, conformanceDiagrams: [diagram] }),
    );
    const conformance = artifact.manifest.conformanceDiagrams?.[0];
    expect(conformance).toBeDefined();
    if (conformance === undefined) return;
    const tampered = {
      ...artifact,
      manifest: {
        ...artifact.manifest,
        conformanceDiagrams: [
          {
            ...conformance,
            svgDigest: sha256Digest("substituted SVG"),
          },
        ],
      },
    } as SolutionExportArtifactV1;

    expect(
      localSolutionExportService.verify(tampered).map(({ code }) => code),
    ).toContain("EXPORT_VERIFY_CONFORMANCE_DIAGRAM_INVALID");

    const sourceDigestTampered = {
      ...artifact,
      manifest: {
        ...artifact.manifest,
        conformanceDiagrams: [
          {
            ...conformance,
            provenance: conformance.provenance.map((source, index) =>
              index === 0
                ? {
                    ...source,
                    sourceDigest: sha256Digest("substituted source"),
                  }
                : source,
            ),
          },
        ],
      },
    } as SolutionExportArtifactV1;
    expect(
      localSolutionExportService
        .verify(sourceDigestTampered)
        .map(({ code }) => code),
    ).toContain("EXPORT_VERIFY_CONFORMANCE_DIAGRAM_INVALID");

    const expiryTampered = {
      ...artifact,
      manifest: {
        ...artifact.manifest,
        conformanceDiagrams: [
          {
            ...conformance,
            quality: {
              ...conformance.quality,
              expiresAt: "2026-08-29T10:31:00.000Z",
            },
          },
        ],
      },
    } as SolutionExportArtifactV1;
    expect(
      localSolutionExportService.verify(expiryTampered).map(({ code }) => code),
    ).toContain("EXPORT_VERIFY_CONFORMANCE_DIAGRAM_INVALID");
  });
  it("packages infrastructure-only output without application source", () => {
    const artifact = ready(
      generateSolutionExport(
        createExportRequest({ mode: "infrastructure-only" }),
      ),
    );
    const paths = artifact.files.map(({ path }) => path);

    expect(paths).toContain("cloudmarkup/architecture.json");
    expect(paths).toContain("cloudmarkup/workloads.json");
    expect(paths).toContain("infrastructure/main.tf");
    expect(paths).not.toContain("application/manifest.json");
    expect(artifact.manifest.application).toBeNull();
    expect(artifact.manifest.tools.generator).toBeNull();
    expect(artifact.manifest.generationCoverage.artifact).toBeUndefined();
    expect(artifact.manifest.status).toEqual({
      evidence: { evidenceIdsAtFreeze: [], state: "not-collected-by-export" },
      validation: { state: "not-run-by-export" },
    });
    const readme = artifact.files.find(({ path }) => path === "README.md");
    expect(Object.hasOwn(artifact.manifest, "conformanceDiagrams")).toBe(false);
    expect(paths.some((path) => path.startsWith("diagram/conformance/"))).toBe(
      false,
    );
    expect(decodeUtf8(readme?.bytes ?? new Uint8Array())).not.toContain(
      "Conformance evidence diagrams",
    );
  });

  it("packages deterministic CloudFormation output with target-specific manifest metadata", () => {
    const terraformRequest = createExportRequest();
    const cloudFormationGenerationRequest = withCompilerBinding(
      createNotesGenerationRequest({
        mode: "complete-supported-pattern",
        operations: ["create", "read", "update", "delete"],
      }),
    );
    const request = solutionExportRequestV1Schema.parse({
      ...terraformRequest,
      infrastructure: buildCloudFormationInfrastructure(
        cloudFormationGenerationRequest,
        "complete-supported-pattern",
      ),
      target: { ...terraformRequest.target, target: "cloudformation" },
    });

    const first = ready(generateSolutionExport(request));
    const repeated = ready(generateSolutionExport(request));
    expect(first.manifest.target).toEqual({
      formatVersion: "1.0.0",
      kind: "cloudformation",
      localValidation: "cloudmarkup-structured-template-v1",
      templateFormat: "json",
      templateSpecificationVersion: "2010-09-09",
    });
    expect(first.files).toContainEqual(
      expect.objectContaining({
        mediaType: "application/vnd.amazon.cloudformation.template+json",
        path: "infrastructure/template.json",
      }),
    );
    expect(first.files.map(({ path }) => path)).not.toContain(
      "infrastructure/main.tf",
    );
    expect(first.manifestDigest).toBe(repeated.manifestDigest);
    const readme = first.files.find(({ path }) => path === "README.md");
    expect(readme).toBeDefined();
    const readmeText = decodeUtf8(readme?.bytes ?? new Uint8Array());
    expect(readmeText).toContain("Target: `cloudformation`");
    expect(readmeText).toContain("CloudFormation validation was executed");
    expect(readmeText).not.toContain("Target: `terraform`");
    expect(first.files).toContainEqual(
      expect.objectContaining({
        path: SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH,
      }),
    );
    expect(
      first.files
        .filter(({ path }) => path.startsWith(".github/workflows/"))
        .map(({ path }) => path),
    ).toEqual([SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH]);
    expect(localSolutionExportService.verify(first)).toEqual([]);
  });

  it("admits an exact sealed repository-workflow artifact without polluting package files", () => {
    const request = createExportRequest();
    const workflows = reviewedRepositoryWorkflows(request);
    const artifact = ready(
      generateSolutionExport({
        ...request,
        reviewedRepositoryWorkflows: workflows,
      }),
    );

    expect(
      artifact.manifest.files.filter(({ path }) => path.startsWith(".github")),
    ).toEqual([]);
    expect(
      artifact.manifest.repositoryWorkflows?.files.map(({ path }) => path),
    ).toEqual([...REVIEWED_WORKFLOW_PATHS]);
    expect(artifact.manifest.repositoryWorkflows).toMatchObject({
      configDigest: workflows.configDigest,
      inclusionPolicy: "explicit-workflow-permission-and-confirmation-required",
      repository: workflows.repository,
      resultDigest: workflows.resultDigest,
    });
    expect(localSolutionExportService.verify(artifact)).toEqual([]);
  });

  it("rejects a self-consistent privileged subset on a portable workflow manifest", () => {
    const artifact = ready(generateSolutionExport(createExportRequest()));
    const workflows = artifact.manifest.repositoryWorkflows;
    if (workflows === undefined) {
      throw new Error("Fixture requires portable repository workflows.");
    }
    const validationEntry = workflows.files[0];
    const validationFile = artifact.files.find(
      ({ path }) =>
        path === SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH,
    );
    const permission = workflows.review.permissions[0];
    const trigger = workflows.review.triggers[0];
    const workflowReview = workflows.review.workflows[0];
    if (
      validationEntry === undefined ||
      validationFile === undefined ||
      permission === undefined ||
      trigger === undefined ||
      workflowReview === undefined
    ) {
      throw new Error("Portable workflow fixture is incomplete.");
    }
    const planPath = ".github/workflows/cloudmarkup-plan.yml" as const;
    const files = [validationEntry, { ...validationEntry, path: planPath }];
    const review = {
      ...workflows.review,
      permissions: [
        ...workflows.review.permissions,
        { ...permission, workflowPath: planPath },
      ],
      triggers: [
        ...workflows.review.triggers,
        { ...trigger, workflowPath: planPath },
      ],
      workflows: [
        ...workflows.review.workflows,
        { ...workflowReview, path: planPath },
      ],
    };
    const digestPayload = {
      configDigest: workflows.configDigest,
      contractVersion: 1 as const,
      dependencyLockDigests: workflows.dependencyLockDigests,
      files: files.map((entry) => ({
        checksum: entry.checksum,
        content: {
          encoding: "utf8" as const,
          value: decodeUtf8(validationFile.bytes),
        },
        kind: "regular-file" as const,
        mediaType: "application/yaml" as const,
        ownership: "generated-replaceable" as const,
        path: entry.path,
        provenance: entry.provenance,
        semanticChecksum: entry.semanticChecksum,
      })),
      generator: workflows.generator,
      kind: workflows.kind,
      pinRegistryDigest: workflows.pinRegistryDigest,
      policyDigest: workflows.policyDigest,
      repository: workflows.repository,
      requiredPackageTrees: workflows.requiredPackageTrees,
      review,
      solutionRevision: workflows.solutionRevision,
      validator: workflows.validator,
    };
    const portableSubset = {
      ...workflows,
      files,
      resultDigest: sha256Digest(serializeCanonicalJson(digestPayload)),
      review,
    };

    const parsed =
      solutionExportRepositoryWorkflowsV1Schema.safeParse(portableSubset);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Portable privileged subset admitted.");
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({ path: ["repository", "state"] }),
    );
    const invalidManifest = {
      ...artifact.manifest,
      repositoryWorkflows: portableSubset,
    } as SolutionExportArtifactV1["manifest"];
    expect(
      localSolutionExportService
        .verify({ ...artifact, manifest: invalidManifest })
        .map(({ code }) => code),
    ).toContain("EXPORT_MANIFEST_SCHEMA_INVALID");
  });

  it("verifies that portable workflow bytes remain the exact credentialless validator", () => {
    const artifact = ready(generateSolutionExport(createExportRequest()));
    const tampered = {
      ...artifact,
      files: artifact.files.map((file) =>
        file.path === SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH
          ? { ...file, bytes: encodeUtf8("name: privileged replacement\n") }
          : file,
      ),
    };

    expect(
      localSolutionExportService.verify(tampered).map(({ code }) => code),
    ).toContain("EXPORT_VERIFY_PORTABLE_WORKFLOW_CONTENT_MISMATCH");
  });

  it("rejects workflow tampering, incomplete package trees, false review metadata, and a sixth workflow", () => {
    const request = createExportRequest();
    const workflows = reviewedRepositoryWorkflows(request);
    const tampered = structuredClone(workflows);
    const first = tampered.files[0];
    if (first === undefined) throw new Error("Missing workflow fixture.");
    first.content.value += "# changed after review\n";
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...request,
          reviewedRepositoryWorkflows: tampered,
        }),
      ),
    ).toContain("EXPORT_REVIEWED_WORKFLOW_RESULT_DIGEST_MISMATCH");

    const changedRepositoryIdentity = structuredClone(workflows);
    changedRepositoryIdentity.repository.repositoryId = "901";
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...request,
          reviewedRepositoryWorkflows: changedRepositoryIdentity,
        }),
      ),
    ).toContain("EXPORT_REVIEWED_WORKFLOW_RESULT_DIGEST_MISMATCH");

    const missingRepositoryIdentity = structuredClone(workflows) as unknown as {
      repository: {
        repositoryId?: string;
        repositoryOwnerId?: string;
      };
    };
    delete missingRepositoryIdentity.repository.repositoryId;
    delete missingRepositoryIdentity.repository.repositoryOwnerId;
    expect(
      reviewedRepositoryWorkflowsV1Schema.safeParse(missingRepositoryIdentity)
        .success,
    ).toBe(false);
    const { resultDigest: ignoredDigest, ...payload } = workflows;
    void ignoredDigest;
    const incompletePayload =
      reviewedRepositoryWorkflowsDigestPayloadV1Schema.parse({
        ...payload,
        requiredPackageTrees: payload.requiredPackageTrees.map((tree) => ({
          ...tree,
          files: tree.files.slice(0, 1),
        })),
      });
    const incomplete = reviewedRepositoryWorkflowsV1Schema.parse({
      ...incompletePayload,
      resultDigest:
        computeReviewedRepositoryWorkflowsResultDigestV1(incompletePayload),
    });
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...request,
          reviewedRepositoryWorkflows: incomplete,
        }),
      ),
    ).toContain("EXPORT_REVIEWED_WORKFLOW_PACKAGE_TREE_MISMATCH");

    const falseReview = structuredClone(workflows);
    const firstReview = falseReview.review.workflows[0];
    if (firstReview === undefined) throw new Error("Missing review fixture.");
    firstReview.path = repositoryRelativePathSchema.parse(
      ".github/workflows/not-sealed.yml",
    );
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...request,
          reviewedRepositoryWorkflows: falseReview,
        }),
      ),
    ).toContain("EXPORT_REQUEST_INVALID");

    const falseLock = structuredClone(workflows);
    const pinLock = falseLock.dependencyLockDigests[0];
    if (pinLock === undefined) throw new Error("Missing lock digest fixture.");
    pinLock.digest = sha256Digest("unbound-dependency-lock");
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...request,
          reviewedRepositoryWorkflows: falseLock,
        }),
      ),
    ).toContain("EXPORT_REQUEST_INVALID");

    const sixth = structuredClone(workflows);
    const last = sixth.files.at(-1);
    if (last === undefined) throw new Error("Missing workflow fixture.");
    const extraWorkflowPath = repositoryRelativePathSchema.parse(
      ".github/workflows/cloudmarkup-extra.yml",
    );
    sixth.files.push({
      ...last,
      path: extraWorkflowPath,
    });
    sixth.review.workflows.push({
      environmentScoped: false,
      path: extraWorkflowPath,
      purpose: "Unreviewed extra workflow",
    });
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...request,
          reviewedRepositoryWorkflows: sixth,
        }),
      ),
    ).toContain("EXPORT_REQUEST_INVALID");
  });

  it("reserves workflow paths and verifies exact root inventory plus revision binding", () => {
    const request = createExportRequest();
    const supplementalWorkflow = supplementalText(
      ".github/workflows/injected.yml",
      "name: injected\n",
    );
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...request,
          supplementalFiles: [
            {
              ...supplementalWorkflow,
              mediaType: "application/yaml",
              semanticChecksum: canonicalSemanticDigest(
                "application/yaml",
                encodeUtf8("name: injected\n"),
              ),
            },
          ],
        }),
      ),
    ).toContain("EXPORT_WORKFLOW_PATH_RESERVED");

    const workflows = reviewedRepositoryWorkflows(request);
    const artifact = ready(
      generateSolutionExport({
        ...request,
        reviewedRepositoryWorkflows: workflows,
      }),
    );
    const omitted = {
      ...artifact,
      files: artifact.files.filter(
        ({ path }) => !path.startsWith(".github/workflows/"),
      ),
    };
    expect(
      localSolutionExportService.verify(omitted).map(({ code }) => code),
    ).toContain("EXPORT_VERIFY_MANIFEST_FILE_SET_MISMATCH");

    const repositoryWorkflows = artifact.manifest.repositoryWorkflows;
    if (repositoryWorkflows === undefined) {
      throw new Error("Missing workflow inventory fixture.");
    }
    const foreignRevision = {
      ...artifact,
      manifest: {
        ...artifact.manifest,
        repositoryWorkflows: {
          ...repositoryWorkflows,
          solutionRevision: {
            ...repositoryWorkflows.solutionRevision,
            digest: sha256Digest("foreign-revision"),
          },
        },
      },
    };
    expect(
      localSolutionExportService
        .verify(foreignRevision)
        .map(({ code }) => code),
    ).toContain("EXPORT_VERIFY_REPOSITORY_WORKFLOW_REVISION_MISMATCH");
  });

  it("packages digest-bound external build and Terraform Evidence without claiming exporter execution", () => {
    const base = createExportRequest();
    const buildEvidence = externalEvidence(
      base.solutionRevision.solutionRevisionId,
      "evidence_build_passed_1",
      5,
    );
    const validationEvidence = externalEvidence(
      base.solutionRevision.solutionRevisionId,
      "evidence_validation_passed_1",
      3,
    );
    const buildFile = evidenceSupplemental(buildEvidence);
    const validationFile = evidenceSupplemental(validationEvidence);
    const externalStageStatus = {
      applicationBuild: {
        evidenceRecords: [
          {
            evidenceId: buildEvidence.id,
            recordDigest: buildFile.checksum,
          },
        ],
        reportDigest: sha256Digest("application-build-report"),
        state: "passed-before-export" as const,
      },
      environment: { environmentType: "unknown" as const },
      targetSettingsDigest: sha256Digest("approved-target-settings"),
      terraformValidation: {
        evidenceRecords: [
          {
            evidenceId: validationEvidence.id,
            recordDigest: validationFile.checksum,
          },
        ],
        reportDigest: sha256Digest("terraform-validation-report"),
        state: "passed-before-export" as const,
      },
      workflowRequestDigest: sha256Digest("workflow-request"),
    };
    const artifact = ready(
      generateSolutionExport({
        ...base,
        externalStageStatus,
        supplementalFiles: [buildFile, validationFile],
      }),
    );

    expect(artifact.manifest.status).toEqual({
      evidence: { evidenceIdsAtFreeze: [], state: "not-collected-by-export" },
      externalStages: externalStageStatus,
      validation: { state: "not-run-by-export" },
    });
    const buildStatus = artifact.files.find(
      ({ path }) => path === "cloudmarkup/application-build/status.json",
    );
    const validationStatus = artifact.files.find(
      ({ path }) => path === "cloudmarkup/validation/status.json",
    );
    const evidenceStatus = artifact.files.find(
      ({ path }) => path === "evidence/status.json",
    );
    expect(
      JSON.parse(decodeUtf8(buildStatus?.bytes ?? new Uint8Array())),
    ).toMatchObject({
      externalStage: externalStageStatus.applicationBuild,
      state: "not-run-by-export",
    });
    expect(
      JSON.parse(decodeUtf8(validationStatus?.bytes ?? new Uint8Array())),
    ).toMatchObject({
      externalStage: externalStageStatus.terraformValidation,
      state: "not-run-by-export",
    });
    expect(
      JSON.parse(decodeUtf8(evidenceStatus?.bytes ?? new Uint8Array())),
    ).toMatchObject({
      externalStages: externalStageStatus,
      state: "not-collected-by-export",
    });
    expect(artifact.manifest.files).toContainEqual(
      expect.objectContaining({
        checksum: validationFile.checksum,
        path: validationFile.path,
      }),
    );
    expect(localSolutionExportService.verify(artifact)).toEqual([]);
  });

  it("rejects external stage status with missing or digest-mismatched Evidence", () => {
    const base = createExportRequest({ mode: "infrastructure-only" });
    const validationEvidence = externalEvidence(
      base.solutionRevision.solutionRevisionId,
      "evidence_validation_passed_1",
      3,
    );
    const file = evidenceSupplemental(validationEvidence);
    const status = {
      environment: { environmentType: "unknown" as const },
      targetSettingsDigest: sha256Digest("approved-target-settings"),
      terraformValidation: {
        evidenceRecords: [
          { evidenceId: validationEvidence.id, recordDigest: file.checksum },
        ],
        reportDigest: sha256Digest("terraform-validation-report"),
        state: "passed-before-export" as const,
      },
      workflowRequestDigest: sha256Digest("workflow-request"),
    };
    expect(
      diagnosticCodes(
        generateSolutionExport({ ...base, externalStageStatus: status }),
      ),
    ).toContain("EXPORT_EXTERNAL_EVIDENCE_REFERENCE_INVALID");
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...base,
          externalStageStatus: {
            ...status,
            terraformValidation: {
              ...status.terraformValidation,
              evidenceRecords: [
                {
                  evidenceId: validationEvidence.id,
                  recordDigest: sha256Digest("wrong"),
                },
              ],
            },
          },
          supplementalFiles: [file],
        }),
      ),
    ).toContain("EXPORT_EXTERNAL_EVIDENCE_DIGEST_INVALID");
  });

  it("packages generated starter source with replaceable ownership and a build handoff", () => {
    const artifact = ready(
      generateSolutionExport(
        createExportRequest({ mode: "generated-starter" }),
      ),
    );
    const source = artifact.files.filter(({ path }) =>
      path.startsWith("application/"),
    );

    expect(source.some(({ path }) => path.endsWith(".ts"))).toBe(true);
    expect(
      source.some(
        ({ ownership, path }) =>
          ownership === "generated-replaceable" && path.endsWith(".ts"),
      ),
    ).toBe(true);
    expect(
      source
        .filter(({ ownership }) => ownership === "user-owned-extension")
        .every(({ path }) => path.includes("/extensions/")),
    ).toBe(true);
    expect(artifact.manifest.artifactReferences).toContainEqual(
      expect.objectContaining({
        ownership: "generated-build-artifact",
        state: "required-output",
      }),
    );
    expect(artifact.files.map(({ path }) => path)).toContain(
      "cloudmarkup/contracts/application-build-contracts.json",
    );
  });

  it("packages the complete supported pattern with contracts, tests, coverage, and provenance", () => {
    const artifact = ready(generateSolutionExport(createExportRequest()));
    const contractBytes = artifact.files.find(
      ({ path }) => path === "cloudmarkup/contracts/application-contracts.json",
    );
    const generatedTests = artifact.files.filter(({ path }) =>
      path.endsWith(".test.ts"),
    );

    expect(contractBytes).toBeDefined();
    expect(generatedTests.length).toBeGreaterThanOrEqual(2);
    expect(artifact.manifest.generationCoverage.artifact?.state).toBe(
      "complete-supported-pattern",
    );
    expect(artifact.manifest.provenance.contracts.length).toBeGreaterThan(0);
    expect(artifact.manifest.provenance.resources).toEqual([
      "aws_dynamodb_table.notes_table",
      "aws_lambda_function.notes_handler",
    ]);
    expect(artifact.manifest.provenance.policies).toEqual([
      "policy.custom.audit",
      "policy.generated.dynamodb",
    ]);
    expect(
      artifact.manifest.files.every(
        ({ provenance }) => provenance.sourceReferences.length > 0,
      ),
    ).toBe(true);
  });

  it.each(["user-provided", "external-artifact"] as const)(
    "represents %s workloads as non-generated artifact ownership",
    (mode) => {
      const artifact = ready(
        generateSolutionExport(createExportRequest({ mode })),
      );
      const references = artifact.manifest.artifactReferences;

      expect(references).toContainEqual(
        expect.objectContaining({ ownership: "user-provided" }),
      );
      expect(
        artifact.files.some(
          ({ ownership, path }) =>
            path.endsWith("/src/index.ts") &&
            ownership === "generated-replaceable",
        ),
      ).toBe(false);
      if (mode === "external-artifact") {
        expect(references).toContainEqual(
          expect.objectContaining({ state: "immutable-reference" }),
        );
      }
    },
  );

  it("retains generated-build and Evidence artifact ownership without producing either", () => {
    const buildPath = "application/artifacts/workload_notes_api/function.zip";
    const evidencePath = "evidence/review.txt";
    const artifact = ready(
      generateSolutionExport(
        createExportRequest({
          supplementalFiles: [
            supplementalZip(buildPath),
            supplementalText(
              evidencePath,
              "reviewed evidence",
              "evidence-artifact",
            ),
          ],
        }),
      ),
    );

    expect(
      artifact.files.find(({ path }) => path === buildPath)?.ownership,
    ).toBe("generated-build-artifact");
    expect(
      artifact.files.find(({ path }) => path === evidencePath)?.ownership,
    ).toBe("evidence-artifact");
    expect(artifact.manifest.artifactReferences).toContainEqual(
      expect.objectContaining({
        digest: sha256Digest(new Uint8Array([0, 1, 2, 3, 4])),
        state: "immutable-reference",
      }),
    );
  });

  it("packages the already-enumerated CycloneDX JSON media type without broadening other media rules", () => {
    const value = '{"bomFormat":"CycloneDX","specVersion":"1.6"}\n';
    const bytes = encodeUtf8(value);
    const path = "application/evidence/workload_notes_api/sbom.cdx.json";
    const supplemental = supplementalText(
      path,
      value,
      "generated-build-artifact",
    );
    const artifact = ready(
      generateSolutionExport(
        createExportRequest({
          supplementalFiles: [
            {
              ...supplemental,
              mediaType: "application/vnd.cyclonedx+json",
              semanticChecksum: canonicalSemanticDigest(
                "application/vnd.cyclonedx+json",
                bytes,
              ),
            },
          ],
        }),
      ),
    );

    expect(artifact.files.find((file) => file.path === path)?.mediaType).toBe(
      "application/vnd.cyclonedx+json",
    );
  });

  it("binds every file and manifest to accurate exact and semantic checksums", () => {
    const artifact = ready(generateSolutionExport(createExportRequest()));

    for (const file of artifact.files) {
      expect(file.checksum).toBe(sha256Digest(file.bytes));
      expect(file.semanticChecksum).toBe(
        canonicalSemanticDigest(file.mediaType, file.bytes),
      );
    }
    expect(artifact.manifest.files).not.toContainEqual(
      expect.objectContaining({
        path: "cloudmarkup/cloudmarkup.manifest.json",
      }),
    );
    expect(artifact.manifestDigest).toBe(
      sha256Digest(
        artifact.files.find(
          ({ path }) => path === "cloudmarkup/cloudmarkup.manifest.json",
        )?.bytes ?? new Uint8Array(),
      ),
    );
    expect(localSolutionExportService.verify(artifact)).toEqual([]);
  });

  it("is byte-identical across repeated runs and equivalent collection orderings", () => {
    const first = ready(generateSolutionExport(createExportRequest()));
    const repeated = ready(generateSolutionExport(createExportRequest()));
    const reordered = ready(
      generateSolutionExport(createExportRequest({ reverseCollections: true })),
    );

    expect(repeated.manifestDigest).toBe(first.manifestDigest);
    expect(repeated.zipDigest).toBe(first.zipDigest);
    expect(repeated.zipBytes).toEqual(first.zipBytes);
    expect(reordered.manifestDigest).toBe(first.manifestDigest);
    expect(reordered.zipDigest).toBe(first.zipDigest);
    expect(reordered.zipBytes).toEqual(first.zipBytes);
  });

  it("writes regular store-mode ZIP entries in deterministic UTF-16 order", () => {
    const artifact = ready(generateSolutionExport(createExportRequest()));
    const entries = readDeterministicZip(artifact.zipBytes);
    const paths = entries.map(({ path }) => path);

    expect(paths).toEqual(paths.toSorted());
    expect(createDeterministicZip(artifact.files)).toEqual(artifact.zipBytes);
    expect(entries.map(({ bytes }) => bytes.byteLength)).toEqual(
      artifact.files.map(({ bytes }) => bytes.byteLength),
    );
  });

  it("rejects traversal, absolute, platform-specific, ADS, and device paths", () => {
    const base = createExportRequest({ mode: "infrastructure-only" });
    for (const path of [
      "evidence/../application/escape.txt",
      "/application/escape.txt",
      "C:/application/escape.txt",
      "application\\escape.txt",
      "application/file.txt:stream",
      "application/CON.txt",
    ]) {
      const raw = {
        ...base,
        supplementalFiles: [supplementalText(path, "safe")],
      };
      const codes = diagnosticCodes(generateSolutionExport(raw));
      expect(
        codes.some(
          (code) =>
            code === "EXPORT_REQUEST_INVALID" ||
            code.startsWith("EXPORT_PATH_"),
        ),
      ).toBe(true);
    }
  });

  it("rejects non-regular files, duplicate paths, case collisions, and non-NFC paths", () => {
    const base = createExportRequest({ mode: "infrastructure-only" });
    const duplicate = supplementalText("evidence/report.txt", "one");

    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...base,
          supplementalFiles: [duplicate, duplicate],
        }),
      ),
    ).toContain("EXPORT_PATH_DUPLICATE");
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...base,
          supplementalFiles: [
            duplicate,
            supplementalText("evidence/REPORT.txt", "two"),
          ],
        }),
      ),
    ).toContain("EXPORT_PATH_NORMALIZATION_COLLISION");
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...base,
          supplementalFiles: [
            supplementalText(
              "evidence/link.txt",
              "target",
              "user-provided",
              "symlink",
            ),
          ],
        }),
      ),
    ).toContain("EXPORT_NON_REGULAR_FILE_REJECTED");
    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...base,
          supplementalFiles: [
            supplementalText("evidence/cafe\u0301.txt", "safe"),
          ],
        }),
      ),
    ).toContain("EXPORT_REQUEST_INVALID");
  });

  it("rejects inaccurate checksums and each configured size boundary", () => {
    const base = createExportRequest({ mode: "infrastructure-only" });
    const supplemental = supplementalText(
      "evidence/report.txt",
      "reviewed evidence",
    );
    const wrongChecksum = sha256Digest("different");

    expect(
      diagnosticCodes(
        generateSolutionExport({
          ...base,
          supplementalFiles: [{ ...supplemental, checksum: wrongChecksum }],
        }),
      ),
    ).toContain("EXPORT_FILE_CHECKSUM_MISMATCH");
    for (const limits of [
      { ...defaultLimits, maxFileBytes: 32 },
      { ...defaultLimits, maxFiles: 3 },
      { ...defaultLimits, maxDecompressedBytes: 512 },
      { ...defaultLimits, maxArchiveBytes: 512 },
    ]) {
      const result = generateSolutionExport({
        ...base,
        target: { ...base.target, limits },
      });
      expect(result.state).toBe("blocked");
    }
  });

  it("never silently overwrites user-owned or modified generated files", () => {
    const artifact = ready(
      generateSolutionExport(
        createExportRequest({ mode: "generated-starter" }),
      ),
    );
    const proposed = artifact.files.find(
      ({ ownership, path }) =>
        ownership === "generated-replaceable" &&
        path.startsWith("application/") &&
        path.endsWith(".ts"),
    );
    expect(proposed).toBeDefined();
    if (proposed === undefined) return;
    const changed = sha256Digest("locally changed");
    const base = createExportRequest({ mode: "generated-starter" });

    const userConflict = generateSolutionExport({
      ...base,
      existingFiles: [
        {
          currentChecksum: changed,
          kind: "regular-file",
          ownership: "user-provided",
          path: proposed.path,
        },
      ],
    });
    expect(userConflict.state).toBe("blocked");
    expect(diagnosticCodes(userConflict)).toContain(
      "EXPORT_DESTINATION_CONFLICT",
    );

    const modifiedGenerated = generateSolutionExport({
      ...base,
      existingFiles: [
        {
          baselineChecksum: proposed.checksum,
          currentChecksum: changed,
          kind: "regular-file",
          ownership: "generated-replaceable",
          path: proposed.path,
        },
      ],
    });
    expect(modifiedGenerated.state).toBe("blocked");

    const verifiedReplacement = generateSolutionExport({
      ...base,
      existingFiles: [
        {
          baselineChecksum: changed,
          currentChecksum: changed,
          kind: "regular-file",
          ownership: "generated-replaceable",
          path: proposed.path,
        },
      ],
    });
    expect(verifiedReplacement.state).toBe("ready");
  });

  it("rejects secrets, signed URLs, local paths, prompts, caches, modules, state, and plans", () => {
    const base = createExportRequest({ mode: "infrastructure-only" });
    const forbiddenContent = [
      "AKIA" + "ABCDEFGHIJKLMNOP",
      "password=ThisMustNeverShip123",
      "https://example.invalid/file?X-Amz-Signature=abc",
      "C:\\Users\\someone\\secret.txt",
      "<|system|> internal prompt",
      "[debug] internal trace",
    ];
    for (const [index, value] of forbiddenContent.entries()) {
      const result = generateSolutionExport({
        ...base,
        supplementalFiles: [
          supplementalText(`evidence/unsafe-${String(index)}.txt`, value),
        ],
      });
      expect(result.state).toBe("blocked");
    }
    for (const path of [
      "application/node_modules/package.txt",
      "application/.cache/result.txt",
      "application/coverage/report.txt",
      "infrastructure/terraform.tfstate",
      "infrastructure/review.tfplan",
      "application/.env",
    ]) {
      const result = generateSolutionExport({
        ...base,
        supplementalFiles: [supplementalText(path, "safe")],
      });
      expect(result.state).toBe("blocked");
    }
    const reservedFiles = [
      supplementalText("application/.env.txt", "safe"),
      {
        ...supplementalText("infrastructure/terraform.tfstate.json", "{}"),
        mediaType: "application/json" as const,
        semanticChecksum: canonicalSemanticDigest(
          "application/json",
          encodeUtf8("{}"),
        ),
      },
    ];
    for (const file of reservedFiles) {
      expect(
        diagnosticCodes(
          generateSolutionExport({ ...base, supplementalFiles: [file] }),
        ),
      ).toContain("EXPORT_PATH_FORBIDDEN_FILE");
    }
  });

  it("sanitizes generated Markdown and logical archive names", () => {
    const artifact = ready(
      generateSolutionExport(
        createExportRequest({
          exportName: "Notes *bold* <script> Export",
          mode: "infrastructure-only",
        }),
      ),
    );
    const readme = artifact.files.find(({ path }) => path === "README.md");

    expect(artifact.archiveFileName).toBe("notes-bold-script-export.zip");
    expect(readme === undefined ? "" : decodeUtf8(readme.bytes)).not.toContain(
      "<script>",
    );
    expect(readme === undefined ? "" : decodeUtf8(readme.bytes)).not.toContain(
      "*bold*",
    );
  });

  it("rejects application output from a stale semantic Solution Revision", () => {
    const base = createExportRequest();
    const result = generateSolutionExport({
      ...base,
      solutionRevision: {
        ...base.solutionRevision,
        issueIdsAtFreeze: ["issue_added_after_generation"],
      },
    });

    expect(result.state).toBe("blocked");
    expect(diagnosticCodes(result)).toContain(
      "EXPORT_APPLICATION_REVISION_DIGEST_MISMATCH",
    );
  });

  it("detects corrupted manifests, file bytes, ZIP bytes, and zip-slip names", () => {
    const artifact = ready(generateSolutionExport(createExportRequest()));
    const malformedArtifact = {
      ...artifact,
      manifest: { ...artifact.manifest, contractVersion: 2 },
    } as unknown as SolutionExportArtifactV1;
    expect(
      localSolutionExportService
        .verify(malformedArtifact)
        .map(({ code }) => code),
    ).toContain("EXPORT_MANIFEST_SCHEMA_INVALID");

    const corruptedManifest = {
      ...artifact,
      manifest: {
        ...artifact.manifest,
        warnings: [
          ...artifact.manifest.warnings,
          {
            code: "manual.corruption",
            message: "Manifest bytes were not updated.",
          },
        ],
      },
    };
    expect(
      diagnosticCodes({
        artifact: corruptedManifest,
        contractVersion: 1,
        diagnostics: localSolutionExportService.verify(corruptedManifest),
        state: "ready",
      }),
    ).toContain("EXPORT_VERIFY_MANIFEST_CONTENT_MISMATCH");

    const changedFiles = artifact.files.map((file, index) =>
      index === 0 ? { ...file, bytes: encodeUtf8("corrupted") } : file,
    );
    expect(
      localSolutionExportService
        .verify({ ...artifact, files: changedFiles })
        .map(({ code }) => code),
    ).toContain("EXPORT_VERIFY_CHECKSUM_MISMATCH");

    const zipSlipBytes = replaceAsciiEverywhere(
      artifact.zipBytes,
      "README.md",
      "../bad.md",
    );
    const zipDiagnostics = localSolutionExportService.verify({
      ...artifact,
      zipBytes: zipSlipBytes,
    });
    expect(zipDiagnostics.map(({ code }) => code)).toContain(
      "EXPORT_VERIFY_ZIP_CORRUPT",
    );
  });
});
