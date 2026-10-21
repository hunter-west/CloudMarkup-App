import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { architectureDocumentV3Schema } from "./architecture-document-v3.js";
import { serializeCanonicalJson } from "./canonical-json.js";
import {
  normalizedResourceV1Schema,
  applicationGenerationRequestV1Schema,
  applicationGenerationResultV1Schema,
  applicationImplementationModeV1Schema,
  applicationSourceArtifactV1Schema,
  applicationSourceFileV1Schema,
  applicationSourceManifestV1Schema,
  applicationWorkloadContractV1Schema,
  prompt32ABuildArtifactContractV1Schema,
  prompt32ABuildArtifactEnvelopeV1Schema,
} from "./application-generation-v1.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const digestC = `sha256:${"c".repeat(64)}`;
const timestamp = "2026-08-17T12:00:00Z";

function digestUtf8(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestCanonicalJson(value: unknown): string {
  return digestUtf8(serializeCanonicalJson(value));
}

function utf8Size(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

const generator = {
  digest: digestA,
  id: "cloudmarkup.application-generator",
  version: "1.0.0",
} as const;

const template = {
  digest: digestB,
  id: "cloudmarkup.template.aws-lambda-notes-typescript",
  version: "1.0.0",
} as const;

const pattern = {
  digest: digestC,
  id: "cloudmarkup.pattern.aws-lambda-authenticated-notes",
  version: "1.0.0",
} as const;

const runtime = {
  digest: digestA,
  handler: "index.handler",
  id: "aws.lambda.runtime.nodejs",
  languageFamily: "cloudmarkup.language.typescript",
  moduleFormat: "esm",
  runtime: "nodejs24.x",
  runtimeFamily: "aws.lambda.runtime-family.nodejs",
  version: "24.0.0",
} as const;

async function readArchitectureFixture() {
  const source = await readFile(
    new URL(
      "../../../packages/test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
      import.meta.url,
    ),
    "utf8",
  );
  return architectureDocumentV3Schema.parse(JSON.parse(source));
}

function solutionRevision(architectureRevisionId: string) {
  return {
    aiExtensionIds: [],
    architecture: {
      contentHash: digestA,
      documentHash: digestB,
      documentKind: "cloudmarkup.architecture-document",
      revisionId: architectureRevisionId,
      schemaVersion: 3,
      visualHash: digestC,
    },
    assumptions: [],
    contractVersion: 1,
    contracts: {
      contentHash: digestA,
      contractVersion: 1,
      recordHashes: [],
    },
    createdAt: timestamp,
    createdBy: "actor-1",
    evidenceIdsAtFreeze: [],
    externalResources: { contentHash: digestB, contractVersion: 1 },
    generationCoverage: {
      contractVersion: 1,
      evidence: [],
      missingRequirements: [],
      solutionRevisionId: "solution-1",
      state: "infrastructure-only",
      workloads: [],
    },
    intent: {
      reason: "No separate intent document is required by this fixture.",
      state: "not-applicable",
    },
    issueIdsAtFreeze: [],
    kind: "cloudmarkup.solution-revision-manifest",
    repositoryObservations: [],
    solutionRevisionId: "solution-1",
    sourceOwnership: [],
    unresolvedDecisionIds: [],
    versions: {
      applicationGenerator: {
        state: "pinned",
        tool: generator,
      },
      catalog: {
        digest: digestC,
        id: "aws.cloudmarkup.notes-api-catalog",
        version: "0.7.0",
      },
      compiler: {
        reason: "The normalized model is supplied independently.",
        state: "not-applicable",
      },
      diagramRenderer: {
        reason: "Diagram rendering is outside application generation.",
        state: "not-applicable",
      },
      importer: {
        reason: "No repository import is included.",
        state: "not-applicable",
      },
      modelPrompt: {
        reason: "Deterministic generation does not call a model.",
        state: "not-applicable",
      },
      policy: [],
    },
    workload: { contentHash: digestA, contractVersion: 2 },
  } as const;
}

function normalizedSolution(architecture: {
  architectureId: string;
  documentId: string;
  revision: { revisionId: string };
}) {
  return {
    connections: [],
    contractVersion: 1,
    externalResources: [],
    outputs: [],
    policyAttachments: [],
    provenance: {
      architectureContentHash: digestA,
      architectureDocumentHash: digestB,
      architectureDocumentId: architecture.documentId,
      architectureId: architecture.architectureId,
      architectureRevisionId: architecture.revision.revisionId,
      architectureVisualHash: digestC,
      catalog: {
        digest: digestC,
        id: "aws.cloudmarkup.notes-api-catalog",
        version: "0.7.0",
      },
      providerId: "aws",
      region: "us-east-1",
      solutionRevisionId: "solution-1",
      workloadContentHash: digestA,
    },
    resources: [],
    target: {
      contractVersion: "1.0.0",
      reasons: [],
      renderingAvailable: true,
      state: "ready",
      target: "terraform",
    },
    variables: [],
    workloads: [],
  } as const;
}

async function validRequest() {
  const architectureDocument = await readArchitectureFixture();
  return {
    architectureDocument,
    contractVersion: 1,
    existingFiles: [],
    generator,
    normalizedSolution: normalizedSolution(architectureDocument),
    pattern,
    runtime,
    solutionRevision: solutionRevision(
      architectureDocument.revision.revisionId,
    ),
    template,
    workloadBehavior: architectureDocument.workloadBehavior,
  } as const;
}

function validResult() {
  const coverage = {
    contractVersion: 1,
    missingRequirements: [],
    solutionRevisionId: "solution-1",
    state: "infrastructure-only",
    workloads: [],
  } as const;
  const coverageDigest = digestCanonicalJson(coverage);
  const sourceManifest = {
    architectureRevisionId: "revision_0002",
    buildContracts: [],
    contractVersion: 1,
    catalog: {
      digest: digestC,
      id: "aws.cloudmarkup.notes-api-catalog",
      version: "0.7.0",
    },
    coverageDigest,
    files: [],
    generator,
    kind: "cloudmarkup.application-source-manifest",
    inputDigests: {
      applicationContracts: digestA,
      architectureDocument: digestB,
      normalizedSolution: digestC,
      solutionRevision: digestA,
      workloadBehavior: digestB,
    },
    manifestPath: "application/manifest.json",
    pattern,
    runtime,
    solutionRevisionId: "solution-1",
    template,
  } as const;
  const sourceManifestDigest = digestCanonicalJson(sourceManifest);

  const artifact = {
    buildContracts: [],
    contractVersion: 1,
    coverage,
    coverageDigest,
    diagnostics: [
      {
        code: "APPLICATION_CODE_REQUIRED",
        message: "Application code is required for this workload mode.",
        related: [],
        severity: "warning",
        source: {
          document: "solution-revision",
          path: "$.generationCoverage.state",
        },
      },
    ],
    diff: { files: [], semantic: [] },
    generator,
    kind: "cloudmarkup.application-source-artifact",
    pattern,
    runtime,
    solutionRevisionId: "solution-1",
    sourceFiles: [],
    sourceManifest,
    sourceManifestDigest,
    template,
    workloadContracts: [],
  } as const;

  return {
    artifact,
    artifactDigest: digestCanonicalJson(artifact),
    contractVersion: 1,
  } as const;
}

function sourceFileBase() {
  const content = "export const generated = true;\n";
  const checksum = digestUtf8(content);
  return {
    baselineChecksum: digestA,
    checksum,
    content,
    disposition: "replace",
    mediaType: "text/typescript",
    path: "application/src/index.ts",
    ownership: "generated",
    previousChecksum: digestA,
    provenance: {
      contractIds: [],
      edgeIds: [],
      environmentBindingIds: ["environment.auth", "environment.table"],
      extensionPointIds: ["extension.custom"],
      generator,
      operationIds: [],
      pattern,
      resourceTargetKeys: ["lambda_notes", "notes_table"],
      runtime,
      solutionRevisionId: "solution-1",
      template,
      workloadIds: [],
    },
    semanticChecksum: checksum,
    sizeBytes: utf8Size(content),
    sourceReferences: [],
  } as const;
}
function validResultWithSourceFile() {
  const result = validResult();
  const sourceFile = sourceFileBase();
  const sourceManifest = {
    ...result.artifact.sourceManifest,
    files: [
      {
        checksum: sourceFile.checksum,
        mediaType: sourceFile.mediaType,
        ownership: sourceFile.ownership,
        path: sourceFile.path,
        semanticChecksum: sourceFile.semanticChecksum,
        sizeBytes: sourceFile.sizeBytes,
      },
    ],
  } as const;
  const artifact = {
    ...result.artifact,
    sourceFiles: [sourceFile],
    sourceManifest,
    sourceManifestDigest: digestCanonicalJson(sourceManifest),
  } as const;

  return {
    ...result,
    artifact,
    artifactDigest: digestCanonicalJson(artifact),
  } as const;
}

function prompt32BuildContract() {
  return {
    compiledEntrypoint: "application/dist/src/functions/lambda_notes/index.js",
    contractVersion: 1,
    dependencies: [
      {
        digest: digestB,
        digestKind: "canonical-coordinate",
        kind: "runtime",
        name: "@aws-sdk/client-dynamodb",
        version: "3.1101.0",
      },
    ],
    entrypoint: "application/src/functions/lambda_notes/index.ts",
    executionPolicy: {
      credentials: "deny",
      filesystem: "isolated",
      network: "deny",
      packageScripts: "deny",
      reproducible: true,
    },
    expectedArtifact: {
      archiveEntrypoint: "index.js",
      artifactId: "artifact.lambda_notes",
      digestAlgorithm: "sha256",
      handler: "index.handler",
      kind: "aws-lambda-zip",
      mediaType: "application/zip",
      path: "application/artifacts/lambda_notes/function.zip",
    },
    implementationMode: "generated-starter",
    lockfilePath: "application/pnpm-lock.yaml",
    packageManifestPath: "application/package.json",
    requiredChecks: ["compile"],
    runtime,
    sourceInputs: [],
    sourceManifestPath: "application/manifest.json",
    toolchain: [
      {
        digest: digestA,
        id: "cloudmarkup.tool.typescript",
        digestKind: "canonical-coordinate",
        role: "compiler",
        version: "6.0.0",
      },
    ],
    workloadId: "workload-1",
  } as const;
}

describe("application generation protocol v1", () => {
  it("accepts the minimal strict request and non-recursive result", async () => {
    expect(
      applicationGenerationRequestV1Schema.parse(await validRequest()),
    ).toBeDefined();
    expect(
      applicationGenerationResultV1Schema.parse(validResult()),
    ).toBeDefined();
  });

  it("publishes exactly the six implementation modes", () => {
    expect(applicationImplementationModeV1Schema.options).toEqual([
      "infrastructure-only",
      "user-provided",
      "generated-starter",
      "complete-supported-pattern",
      "ai-assisted-custom",
      "external-artifact",
    ]);

    const packageContract = {
      expectedArtifact: {
        kind: "aws-lambda-zip",
        mediaType: "application/zip",
        path: "application/artifacts/lambda_notes/function.zip",
      },
      handler: "index.handler",
      packageManifestPath: "application/package.json",
      packageRoot: "application",
      runtimeFamily: "aws.lambda.runtime-family.nodejs",
      workloadId: "workload-1",
    } as const;
    const sourceFiles = [
      {
        ownership: "generated",
        path: "application/src/functions/lambda_notes/index.ts",
      },
    ] as const;
    const contracts = [
      {
        implementationMode: "infrastructure-only",
        ownershipReadiness: "not-applicable",
        readiness: "application-code-required",
        workloadId: "workload-1",
      },
      {
        ...packageContract,
        implementationMode: "user-provided",
        ownershipReadiness: "user-source-preserved",
        readiness: "user-source-required",
      },
      {
        ...packageContract,
        implementationMode: "generated-starter",
        ownershipReadiness: "safe-to-materialize",
        readiness: "starter-source-ready",
        sourceFiles,
      },
      {
        ...packageContract,
        implementationMode: "complete-supported-pattern",
        ownershipReadiness: "safe-to-materialize",
        readiness: "complete-source-ready",
        sourceFiles,
      },
      {
        ...packageContract,
        implementationMode: "ai-assisted-custom",
        ownershipReadiness: "extension-boundary-ready",
        readiness: "custom-source-required",
        sourceFiles,
        validationRequirements: ["parse", "static-analysis"],
      },
      {
        artifact: {
          artifactId: "artifact-1",
          digest: digestA,
          resolution: "reference-only",
        },
        implementationMode: "external-artifact",
        ownershipReadiness: "not-applicable",
        readiness: "external-artifact-reference-ready",
        workloadId: "workload-1",
      },
    ] as const;

    for (const contract of contracts) {
      expect(applicationWorkloadContractV1Schema.parse(contract)).toBeDefined();
    }
  });

  it("represents blocked complete generation without claiming completeness", () => {
    const result = validResult();
    const blockedWorkload = {
      implementationMode: "complete-supported-pattern",
      missingRequirements: ["deterministic-application-generation"],
      representedOperationIds: [],
      representedTestIds: [],
      sourceFilePaths: [],
      state: "custom-implementation-required",
      unresolvedBehaviorIds: ["behavior-unsupported"],
      workloadId: "workload-1",
    } as const;
    const blockedContract = {
      expectedArtifact: {
        kind: "aws-lambda-zip",
        mediaType: "application/zip",
        path: "application/artifacts/lambda_notes/function.zip",
      },
      handler: "index.handler",
      implementationMode: "complete-supported-pattern",
      ownershipReadiness: "not-safe-to-materialize",
      packageManifestPath: "application/package.json",
      packageRoot: "application",
      readiness: "generation-blocked",
      runtimeFamily: "aws.lambda.runtime-family.nodejs",
      sourceFiles: [],
      workloadId: "workload-1",
    } as const;

    const coverage = {
      ...result.artifact.coverage,
      missingRequirements: ["deterministic-application-generation"],
      state: "custom-implementation-required",
      workloads: [blockedWorkload],
    } as const;
    const coverageDigest = digestCanonicalJson(coverage);
    const sourceManifest = {
      ...result.artifact.sourceManifest,
      coverageDigest,
    };
    const sourceManifestDigest = digestCanonicalJson(sourceManifest);
    const artifact = {
      ...result.artifact,
      coverage,
      coverageDigest,
      sourceManifest,
      sourceManifestDigest,
      workloadContracts: [blockedContract],
    } as const;

    expect(
      applicationGenerationResultV1Schema.parse({
        ...result,
        artifact,
        artifactDigest: digestCanonicalJson(artifact),
      }),
    ).toBeDefined();
  });

  it("rejects traversal, malformed digests, and unknown fields", async () => {
    const request = await validRequest();

    expect(
      applicationGenerationRequestV1Schema.safeParse({
        ...request,
        existingFiles: [
          {
            currentChecksum: digestA,
            mediaType: "text/plain",
            ownership: "user-owned",
            path: "../secrets.txt",
            semanticChecksum: digestA,
            sizeBytes: 10,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      applicationGenerationRequestV1Schema.safeParse({
        ...request,
        generator: { ...generator, digest: "sha256:not-a-digest" },
      }).success,
    ).toBe(false);
    expect(
      applicationGenerationRequestV1Schema.safeParse({
        ...request,
        unexpected: true,
      }).success,
    ).toBe(false);
  });
  it("bounds the aggregate existing application inventory", async () => {
    const request = await validRequest();
    expect(
      applicationGenerationRequestV1Schema.safeParse({
        ...request,
        existingFiles: [0, 1].map((index) => ({
          currentChecksum: digestA,
          mediaType: "text/plain",
          ownership: "user-owned",
          path: `application/existing-${String(index)}.txt`,
          semanticChecksum: digestA,
          sizeBytes: (16 << 20) + 1,
        })),
      }).success,
    ).toBe(false);
  });

  it("fails closed on unsafe ownership and replacement metadata", async () => {
    const request = await validRequest();

    expect(
      applicationGenerationRequestV1Schema.safeParse({
        ...request,
        existingFiles: [
          {
            currentChecksum: digestA,
            mediaType: "text/typescript",
            ownership: "generated",
            path: "application/src/index.ts",
            semanticChecksum: digestA,
            sizeBytes: 31,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      applicationGenerationRequestV1Schema.safeParse({
        ...request,
        existingFiles: [
          {
            baselineChecksum: digestA,
            currentChecksum: digestA,
            mediaType: "text/typescript",
            ownership: "user-owned",
            path: "application/src/custom.ts",
            semanticChecksum: digestA,
            sizeBytes: 31,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      applicationSourceFileV1Schema.safeParse({
        ...sourceFileBase(),
        ownership: "user-owned",
      }).success,
    ).toBe(false);
    expect(
      applicationSourceFileV1Schema.safeParse({
        ...sourceFileBase(),
        baselineChecksum: digestC,
        ownership: "generated",
      }).success,
    ).toBe(false);
  });
  it("verifies materialized content checksums, UTF-8 sizes, and semantic hashes", () => {
    const replacement = sourceFileBase();
    expect(applicationSourceFileV1Schema.parse(replacement)).toBeDefined();

    for (const forged of [
      { ...replacement, checksum: digestA },
      { ...replacement, semanticChecksum: digestC },
      { ...replacement, sizeBytes: replacement.sizeBytes + 1 },
    ]) {
      expect(applicationSourceFileV1Schema.safeParse(forged).success).toBe(
        false,
      );
    }

    const { baselineChecksum, previousChecksum, ...createFields } = replacement;
    expect(baselineChecksum).toBe(previousChecksum);
    expect(
      applicationSourceFileV1Schema.parse({
        ...createFields,
        disposition: "create",
      }),
    ).toBeDefined();

    const jsonContent = '{"z":1,"a":"CloudMarkup ☁️"}\r\n';
    const jsonChecksum = digestUtf8(jsonContent);
    const jsonFile = {
      ...replacement,
      checksum: jsonChecksum,
      content: jsonContent,
      mediaType: "application/json",
      semanticChecksum: digestCanonicalJson(JSON.parse(jsonContent)),
      sizeBytes: utf8Size(jsonContent),
    } as const;
    expect(applicationSourceFileV1Schema.parse(jsonFile)).toBeDefined();
    expect(
      applicationSourceFileV1Schema.safeParse({
        ...jsonFile,
        semanticChecksum: jsonChecksum,
      }).success,
    ).toBe(false);
  });

  it("requires complete canonical source-file provenance arrays", () => {
    const sourceFile = sourceFileBase();
    for (const field of [
      "environmentBindingIds",
      "resourceTargetKeys",
      "extensionPointIds",
    ] as const) {
      expect(
        applicationSourceFileV1Schema.safeParse({
          ...sourceFile,
          provenance: {
            ...sourceFile.provenance,
            [field]: undefined,
          },
        }).success,
      ).toBe(false);
      expect(
        applicationSourceFileV1Schema.safeParse({
          ...sourceFile,
          provenance: { ...sourceFile.provenance, [field]: ["a", "a"] },
        }).success,
      ).toBe(false);
      expect(
        applicationSourceFileV1Schema.safeParse({
          ...sourceFile,
          provenance: {
            ...sourceFile.provenance,
            [field]: ["z", "a"],
          },
        }).success,
      ).toBe(false);
    }
  });

  it("requires an explicit Prompt 32 compiled and archive layout and hashes it", () => {
    const contract = prompt32BuildContract();
    expect(
      prompt32ABuildArtifactContractV1Schema.parse(contract),
    ).toBeDefined();
    const contractDigest = digestCanonicalJson(contract);
    expect(
      prompt32ABuildArtifactEnvelopeV1Schema.parse({
        contract,
        contractDigest,
      }),
    ).toBeDefined();
    expect(
      prompt32ABuildArtifactEnvelopeV1Schema.safeParse({
        contract,
        contractDigest: digestA,
      }).success,
    ).toBe(false);

    expect(
      prompt32ABuildArtifactContractV1Schema.safeParse({
        ...contract,
        compiledEntrypoint: undefined,
      }).success,
    ).toBe(false);
    expect(
      prompt32ABuildArtifactContractV1Schema.safeParse({
        ...contract,
        expectedArtifact: {
          ...contract.expectedArtifact,
          archiveEntrypoint: "dist/index.js",
        },
      }).success,
    ).toBe(false);
    expect(
      prompt32ABuildArtifactContractV1Schema.safeParse({
        ...contract,
        expectedArtifact: {
          ...contract.expectedArtifact,
          handler: "dist/index.handler",
        },
      }).success,
    ).toBe(false);
    expect(
      prompt32ABuildArtifactContractV1Schema.safeParse({
        ...contract,
        dependencies: contract.dependencies.map((dependency) => ({
          ...dependency,
          digestKind: "registry-integrity",
        })),
      }).success,
    ).toBe(false);
    expect(
      prompt32ABuildArtifactContractV1Schema.safeParse({
        ...contract,
        toolchain: contract.toolchain.map((tool) => ({
          ...tool,
          digestKind: undefined,
        })),
      }).success,
    ).toBe(false);
  });

  it("rejects forged coverage, manifest, build, and outer artifact digests", () => {
    const result = validResult();
    expect(applicationGenerationResultV1Schema.parse(result)).toBeDefined();

    expect(
      applicationSourceArtifactV1Schema.safeParse({
        ...result.artifact,
        coverageDigest: digestA,
      }).success,
    ).toBe(false);
    expect(
      applicationSourceArtifactV1Schema.safeParse({
        ...result.artifact,
        sourceManifestDigest: digestA,
      }).success,
    ).toBe(false);
    expect(
      applicationSourceArtifactV1Schema.safeParse({
        ...result.artifact,
        sourceManifest: {
          ...result.artifact.sourceManifest,
          inputDigests: {
            ...result.artifact.sourceManifest.inputDigests,
            normalizedSolution: digestA,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      applicationGenerationResultV1Schema.safeParse({
        ...result,
        artifactDigest: digestA,
      }).success,
    ).toBe(false);
  });

  it("requires manifest metadata to equal the exact source-file metadata", () => {
    const result = validResultWithSourceFile();
    expect(applicationGenerationResultV1Schema.parse(result)).toBeDefined();

    const sourceManifest = {
      ...result.artifact.sourceManifest,
      files: result.artifact.sourceManifest.files.map((file) => ({
        ...file,
        sizeBytes: file.sizeBytes + 1,
      })),
    };
    expect(
      applicationSourceArtifactV1Schema.safeParse({
        ...result.artifact,
        sourceManifest,
        sourceManifestDigest: digestCanonicalJson(sourceManifest),
      }).success,
    ).toBe(false);
  });

  it("keeps the manifest outside its own file and digest closure", () => {
    const manifest = validResult().artifact.sourceManifest;
    expect(
      applicationSourceManifestV1Schema.safeParse({
        ...manifest,
        digest: digestA,
      }).success,
    ).toBe(false);
    expect(
      applicationSourceManifestV1Schema.safeParse({
        ...manifest,
        files: [
          {
            checksum: digestA,
            mediaType: "application/json",
            ownership: "generated",
            path: "application/manifest.json",
            semanticChecksum: digestA,
            sizeBytes: 100,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      applicationSourceManifestV1Schema.safeParse({
        ...manifest,
        inputDigests: undefined,
      }).success,
    ).toBe(false);
    expect(
      applicationSourceManifestV1Schema.safeParse({
        ...manifest,
        inputDigests: {
          ...manifest.inputDigests,
          unexpected: digestA,
        },
      }).success,
    ).toBe(false);
    expect(
      applicationSourceManifestV1Schema.safeParse({
        ...manifest,
        catalog: undefined,
      }).success,
    ).toBe(false);
  });
});

// Go preserves the typed parent relationship used by target placement validation.
describe("normalized parent reference compatibility", () => {
  const reference = { nodeId: "parent", targetKey: "parent_key" };
  it("retains an optional bounded relationship and accepts historical references", () => {
    const schema = normalizedResourceV1Schema.shape.parent;
    expect(schema.parse(reference)).toEqual(reference);
    const current = { ...reference, relationshipType: "aws.region.contains" };
    expect(schema.parse(current)).toEqual(current);
    expect(schema.safeParse({ ...current, relationshipType: "" }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ ...current, relationshipType: "x".repeat(513) })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ ...current, arbitraryField: true }).success).toBe(
      false,
    );
  });
});
