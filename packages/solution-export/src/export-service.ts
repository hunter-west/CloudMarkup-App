import {
  conformanceDiagramRendererV1Pin,
  createConformanceDiagramService,
} from "@cloudmarkup/diagram-export/conformance";
import {
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
  getSolutionRevisionManifestContentHash,
} from "@cloudmarkup/domain";
import {
  evidenceRecordV1Schema,
  repositoryRelativePathSchema,
  normalizeArchitectureDocumentV3,
  serializeCanonicalJson,
  type ApplicationGenerationResultV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import {
  reviewedRepositoryWorkflowsDigestPayloadV1Schema,
  exactToolPinV1Schema,
  SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH,
  SOLUTION_EXPORT_MANIFEST_PATH,
  SOLUTION_EXPORT_REPOSITORY_WORKFLOW_INCLUSION_POLICY,
  SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT,
  SOLUTION_EXPORT_ZIP_EPOCH,
  solutionExportManifestV1Schema,
  solutionExportMediaTypeV1Schema,
  solutionExportRequestV1Schema,
  type ExactToolPinV1,
  type ReviewedRepositoryWorkflowsDigestPayloadV1,
  type SolutionExportArtifactReferenceV1,
  type SolutionExportArtifactV1,
  type SolutionExportConflictV1,
  type SolutionExportDiagnosticV1,
  type SolutionExportFileV1,
  type SolutionExportManifestFileV1,
  type SolutionExportManifestV1,
  type SolutionExportMediaTypeV1,
  type SolutionExportOwnershipKindV1,
  type SolutionExportOwnershipV1,
  type SolutionExportProvenanceV1,
  type SolutionExportRequestV1,
  type SolutionExportRepositoryWorkflowsV1,
  type SolutionExportResultV1,
  type SolutionExportService,
} from "./contracts.js";
import {
  canonicalSemanticDigest,
  compareUtf16,
  decodeBase64,
  decodeUtf8,
  encodeUtf8,
  inspectExportPath,
  inspectMediaType,
  inspectTextContent,
  portableArchiveStem,
  sanitizeMarkdownInline,
  sha256Digest,
} from "./security.js";
import { createDeterministicZip, readDeterministicZip } from "./zip.js";

const EXPORTER_VERSION = "1.0.0";
const EXPORTER_ID = "cloudmarkup.solution-export";
const EXPORTER: ExactToolPinV1 = Object.freeze(
  exactToolPinV1Schema.parse({
    digest: sha256Digest(
      serializeCanonicalJson({ id: EXPORTER_ID, version: EXPORTER_VERSION }),
    ),
    id: EXPORTER_ID,
    version: EXPORTER_VERSION,
  }),
);

const CONFORMANCE_DIAGRAM_SERVICE = createConformanceDiagramService();

export function computeReviewedRepositoryWorkflowsResultDigestV1(
  input: ReviewedRepositoryWorkflowsDigestPayloadV1,
): Sha256Digest {
  const payload = reviewedRepositoryWorkflowsDigestPayloadV1Schema.parse(input);
  return sha256Digest(serializeCanonicalJson(payload));
}

interface CandidateFile {
  readonly bytes: Uint8Array;
  readonly checksum: Sha256Digest;
  readonly mediaType: SolutionExportMediaTypeV1;
  readonly ownership: SolutionExportOwnershipKindV1;
  readonly path: string;
  readonly provenance: SolutionExportProvenanceV1;
  readonly semanticChecksum: Sha256Digest;
}

export const NO_CREDENTIAL_PULL_REQUEST_WORKFLOW_PATH =
  SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH;

export const NO_CREDENTIAL_PULL_REQUEST_WORKFLOW =
  [
    "name: CloudMarkup package validation",
    "",
    "on:",
    "  pull_request:",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  validate:",
    "    name: Verify reviewed Solution packages",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 5",
    "    steps:",
    "      - name: Check out pull request",
    "        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2",
    "        with:",
    "          persist-credentials: false",
    "      - name: Set up pinned Node.js",
    "        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0",
    "        with:",
    "          node-version: 24.18.0",
    "      - name: Verify exact package files",
    "        shell: bash",
    "        run: |",
    "          node --input-type=module <<'CLOUDMARKUP_VERIFY'",
    "          import { createHash } from 'node:crypto';",
    "          import { readdir, readFile } from 'node:fs/promises';",
    "          import { dirname, join, relative, resolve, sep } from 'node:path';",
    "          const root = resolve('.');",
    "          const files = [];",
    "          async function walk(directory) {",
    "            for (const entry of await readdir(directory, { withFileTypes: true })) {",
    "              if (entry.name === '.git' || entry.isSymbolicLink()) continue;",
    "              const path = join(directory, entry.name);",
    "              if (entry.isDirectory()) await walk(path);",
    "              else if (entry.isFile()) files.push(path);",
    "            }",
    "          }",
    "          await walk(root);",
    "          const manifests = files.filter((path) => path.endsWith(`${sep}cloudmarkup${sep}cloudmarkup.manifest.json`));",
    "          if (manifests.length === 0) throw new Error('No CloudMarkup Solution package manifest was found.');",
    "          for (const manifestPath of manifests) {",
    "            const packageRoot = dirname(dirname(manifestPath));",
    "            const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));",
    "            if (manifest.kind !== 'cloudmarkup.solution-export-manifest' || manifest.contractVersion !== 1) throw new Error('Unsupported Solution package manifest.');",
    "            for (const entry of [...manifest.files, ...(manifest.repositoryWorkflows?.files ?? [])]) {",
    "              const path = String(entry.path);",
    "              if (path.startsWith('/') || path.includes('\\\\') || path.split('/').some((part) => part === '.' || part === '..')) throw new Error('Unsafe manifest path.');",
    "              const target = path.startsWith('.github/workflows/') ? resolve(root, path) : resolve(packageRoot, path);",
    "              if (relative(root, target).startsWith(`..${sep}`)) throw new Error('Manifest path escaped the repository.');",
    "              const bytes = await readFile(target);",
    "              const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;",
    "              if (digest !== entry.checksum || bytes.byteLength !== entry.sizeBytes) throw new Error(`Package integrity failed for ${path}.`);",
    "            }",
    "            const lock = JSON.parse(await readFile(join(packageRoot, 'cloudmarkup', 'cloudmarkup.lock.json'), 'utf8'));",
    "            if (lock.solutionRevision?.id !== manifest.solutionRevision?.id || lock.solutionRevision?.digest !== manifest.solutionRevision?.digest) throw new Error('Solution lock and manifest do not match.');",
    "          }",
    "          console.log(`Verified ${manifests.length} reviewed CloudMarkup Solution package(s).`);",
    "          CLOUDMARKUP_VERIFY",
  ].join("\n") + "\n";
interface AssemblyState {
  readonly artifactReferences: SolutionExportArtifactReferenceV1[];
  readonly candidates: CandidateFile[];
  readonly diagnostics: SolutionExportDiagnosticV1[];
  readonly ownership: Map<string, SolutionExportOwnershipV1>;
}

function diagnostic(
  code: string,
  message: string,
  path?: string,
  severity: "error" | "warning" | "info" = "error",
): SolutionExportDiagnosticV1 {
  const parsedPath =
    path === undefined
      ? undefined
      : repositoryRelativePathSchema.safeParse(path);
  return path === undefined
    ? { code, message, severity }
    : parsedPath?.success === true
      ? { code, message, path: parsedPath.data, severity }
      : { code, message, severity };
}

function blocked(
  diagnostics: readonly SolutionExportDiagnosticV1[],
  conflicts: readonly SolutionExportConflictV1[] = [],
): SolutionExportResultV1 {
  return {
    conflicts: [...conflicts].sort((left, right) =>
      compareUtf16(left.path, right.path),
    ),
    contractVersion: 1,
    diagnostics: [...diagnostics],
    state: "blocked",
  };
}

function hasErrors(
  diagnostics: readonly SolutionExportDiagnosticV1[],
): boolean {
  return diagnostics.some(({ severity }) => severity === "error");
}

function toolPinsEqual(
  left: {
    readonly digest?: string | undefined;
    readonly id: string;
    readonly version: string;
  },
  right: ExactToolPinV1,
): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.digest === right.digest
  );
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf16);
}

function uniqueSortedReferences(
  values: readonly SolutionExportProvenanceV1["sourceReferences"][number][],
): SolutionExportProvenanceV1["sourceReferences"][number][] {
  const byKey = new Map<string, (typeof values)[number]>();
  for (const value of values) {
    byKey.set(`${value.kind}\u0000${value.id}`, value);
  }
  return [...byKey.values()].sort((left, right) => {
    const kind = compareUtf16(left.kind, right.kind);
    return kind === 0 ? compareUtf16(left.id, right.id) : kind;
  });
}

function exportProvenance(
  revisionId: string,
  sourceReferences: SolutionExportProvenanceV1["sourceReferences"],
  producer: ExactToolPinV1 = EXPORTER,
): SolutionExportProvenanceV1 {
  return {
    producer,
    solutionRevisionId: revisionId,
    sourceReferences: uniqueSortedReferences(
      sourceReferences.length === 0
        ? [{ id: revisionId, kind: "solution-revision" }]
        : sourceReferences,
    ),
  };
}

function defaultOwnership(
  path: string,
  ownership: SolutionExportOwnershipKindV1,
  checksum?: Sha256Digest,
): SolutionExportOwnershipV1 {
  const parsedPath = repositoryRelativePathSchema.parse(path);
  if (ownership === "generated-replaceable") {
    return {
      baselineChecksum: checksum,
      conflictBehavior: "replace-only-when-baseline-matches",
      ownership,
      path: parsedPath,
      regeneration: "verified-replacement",
    };
  }
  if (ownership === "user-owned-extension" || ownership === "user-provided") {
    return {
      conflictBehavior: "preserve-user-content",
      ownership,
      path: parsedPath,
      regeneration: "never",
    };
  }
  return {
    conflictBehavior: "fail-closed",
    ownership,
    path: parsedPath,
    regeneration: "never",
  };
}

function addOwnership(
  state: AssemblyState,
  entry: SolutionExportOwnershipV1,
): void {
  const key = entry.path.normalize("NFC").toLowerCase();
  const existing = state.ownership.get(key);
  if (existing !== undefined && existing.path !== entry.path) {
    state.diagnostics.push(
      diagnostic(
        "EXPORT_PATH_NORMALIZATION_COLLISION",
        "Export paths cannot differ only by case or canonical normalization.",
        entry.path,
      ),
    );
    return;
  }
  if (
    existing !== undefined &&
    (existing.ownership !== entry.ownership ||
      existing.regeneration !== entry.regeneration ||
      existing.conflictBehavior !== entry.conflictBehavior)
  ) {
    state.diagnostics.push(
      diagnostic(
        "EXPORT_OWNERSHIP_AMBIGUOUS",
        "One export path cannot carry competing ownership declarations.",
        entry.path,
      ),
    );
    return;
  }
  state.ownership.set(key, entry);
}

function addCandidate(
  state: AssemblyState,
  request: SolutionExportRequestV1,
  candidate: CandidateFile,
): void {
  const pathIssue = inspectExportPath(
    candidate.path,
    request.target.limits.maxPathBytes,
  );
  if (pathIssue !== undefined) {
    state.diagnostics.push(
      diagnostic(pathIssue.code, pathIssue.message, candidate.path),
    );
    return;
  }
  const mediaIssue = inspectMediaType(
    candidate.path,
    candidate.mediaType,
    candidate.ownership,
  );
  if (mediaIssue !== undefined) {
    state.diagnostics.push(
      diagnostic(mediaIssue.code, mediaIssue.message, candidate.path),
    );
    return;
  }
  if (candidate.bytes.byteLength > request.target.limits.maxFileBytes) {
    state.diagnostics.push(
      diagnostic(
        "EXPORT_FILE_LIMIT_EXCEEDED",
        "Export file exceeds the configured individual byte limit.",
        candidate.path,
      ),
    );
    return;
  }
  const textIssue = inspectTextContent(candidate.mediaType, candidate.bytes);
  if (textIssue !== undefined) {
    state.diagnostics.push(
      diagnostic(textIssue.code, textIssue.message, candidate.path),
    );
    return;
  }
  if (sha256Digest(candidate.bytes) !== candidate.checksum) {
    state.diagnostics.push(
      diagnostic(
        "EXPORT_FILE_CHECKSUM_MISMATCH",
        "Export file checksum does not match its exact bytes.",
        candidate.path,
      ),
    );
    return;
  }
  if (
    canonicalSemanticDigest(candidate.mediaType, candidate.bytes) !==
    candidate.semanticChecksum
  ) {
    state.diagnostics.push(
      diagnostic(
        "EXPORT_FILE_SEMANTIC_CHECKSUM_MISMATCH",
        "Export semantic checksum does not match its normalized content.",
        candidate.path,
      ),
    );
    return;
  }

  const key = candidate.path.normalize("NFC").toLowerCase();
  const duplicate = state.candidates.find(
    (file) => file.path.normalize("NFC").toLowerCase() === key,
  );
  if (duplicate !== undefined) {
    state.diagnostics.push(
      diagnostic(
        duplicate.path === candidate.path
          ? "EXPORT_PATH_DUPLICATE"
          : "EXPORT_PATH_NORMALIZATION_COLLISION",
        "Export file paths must be unique across portable filesystems.",
        candidate.path,
      ),
    );
    return;
  }
  state.candidates.push(candidate);
  addOwnership(
    state,
    defaultOwnership(candidate.path, candidate.ownership, candidate.checksum),
  );
}

function jsonCandidate(
  path: string,
  value: unknown,
  ownership: SolutionExportOwnershipKindV1,
  provenance: SolutionExportProvenanceV1,
): CandidateFile {
  const content = serializeCanonicalJson(value);
  const bytes = encodeUtf8(content);
  const checksum = sha256Digest(bytes);
  return {
    bytes,
    checksum,
    mediaType: "application/json",
    ownership,
    path,
    provenance,
    semanticChecksum: checksum,
  };
}

function textCandidate(
  path: string,
  content: string,
  mediaType: SolutionExportMediaTypeV1,
  ownership: SolutionExportOwnershipKindV1,
  provenance: SolutionExportProvenanceV1,
): CandidateFile {
  const normalizedContent = content.replaceAll("\r\n", "\n");
  const bytes = encodeUtf8(normalizedContent);
  const checksum = sha256Digest(bytes);
  return {
    bytes,
    checksum,
    mediaType,
    ownership,
    path,
    provenance,
    semanticChecksum: checksum,
  };
}

function infrastructureProjectionDigest(
  infrastructure: SolutionExportRequestV1["infrastructure"],
): Sha256Digest {
  const { artifactDigest, ...rawProjection } = infrastructure;
  void artifactDigest;
  const projection = {
    ...rawProjection,
    applicationArtifacts: [...rawProjection.applicationArtifacts].sort(
      (left, right) =>
        compareUtf16(
          serializeCanonicalJson(left),
          serializeCanonicalJson(right),
        ),
    ),
    diagnostics: [...rawProjection.diagnostics].sort((left, right) =>
      compareUtf16(serializeCanonicalJson(left), serializeCanonicalJson(right)),
    ),
    files: [...rawProjection.files].sort((left, right) =>
      compareUtf16(left.path, right.path),
    ),
    policyArtifacts: [...rawProjection.policyArtifacts].sort((left, right) =>
      compareUtf16(left.policyDocumentId, right.policyDocumentId),
    ),
    ...(rawProjection.target === "terraform"
      ? {
          providers: [...rawProjection.providers].sort((left, right) =>
            compareUtf16(left.source, right.source),
          ),
        }
      : {}),
    resources: [...rawProjection.resources].sort((left, right) =>
      compareUtf16(left.resourceId, right.resourceId),
    ),
  };
  return sha256Digest(serializeCanonicalJson(projection));
}

function validateRevisionBindings(
  request: SolutionExportRequestV1,
  diagnostics: SolutionExportDiagnosticV1[],
): void {
  const { architectureDocument, infrastructure, solutionRevision } = request;
  if (
    infrastructure.solutionRevisionId !== solutionRevision.solutionRevisionId
  ) {
    diagnostics.push(
      diagnostic(
        "EXPORT_INFRASTRUCTURE_REVISION_MISMATCH",
        "Infrastructure artifact must bind the exact Solution Revision.",
      ),
    );
  }
  if (
    solutionRevision.architecture.revisionId !==
    architectureDocument.revision.revisionId
  ) {
    diagnostics.push(
      diagnostic(
        "EXPORT_ARCHITECTURE_REVISION_MISMATCH",
        "Architecture document must bind the exact Solution Revision.",
      ),
    );
  }
  const expectedHashes = {
    applicationContracts: getApplicationContractsContentHash(
      architectureDocument.applicationContracts,
    ),
    architectureContent:
      getArchitectureDocumentContentHash(architectureDocument),
    architectureDocument:
      getArchitectureDocumentCanonicalHash(architectureDocument),
    architectureVisual: getArchitectureDocumentVisualHash(architectureDocument),
    externalResources: getExternalResourceReferenceContentHash(
      architectureDocument.externalResources,
    ),
    workload: getWorkloadBehaviorContentHash(
      architectureDocument.workloadBehavior,
    ),
  };
  if (
    solutionRevision.architecture.contentHash !==
      expectedHashes.architectureContent ||
    solutionRevision.architecture.documentHash !==
      expectedHashes.architectureDocument ||
    solutionRevision.architecture.visualHash !==
      expectedHashes.architectureVisual ||
    solutionRevision.workload.contentHash !== expectedHashes.workload ||
    solutionRevision.externalResources.contentHash !==
      expectedHashes.externalResources ||
    solutionRevision.contracts.contentHash !==
      expectedHashes.applicationContracts
  ) {
    diagnostics.push(
      diagnostic(
        "EXPORT_SOLUTION_REVISION_HASH_MISMATCH",
        "Solution Revision hashes must match the exact canonical source projections.",
      ),
    );
  }
  const expectedRecordHashes =
    architectureDocument.applicationContracts.contracts
      .map(getApplicationContractRecordContentHash)
      .sort(compareUtf16);
  if (
    serializeCanonicalJson(expectedRecordHashes) !==
    serializeCanonicalJson(
      [...solutionRevision.contracts.recordHashes].sort(compareUtf16),
    )
  ) {
    diagnostics.push(
      diagnostic(
        "EXPORT_CONTRACT_RECORD_HASH_MISMATCH",
        "Solution Revision contract record hashes must match every exported contract.",
      ),
    );
  }
  if (
    !toolPinsEqual(solutionRevision.versions.catalog, infrastructure.catalog)
  ) {
    diagnostics.push(
      diagnostic(
        "EXPORT_CATALOG_PIN_MISMATCH",
        "Infrastructure and Solution Revision catalog pins must match exactly.",
      ),
    );
  }
  const compilerBinding = solutionRevision.versions.compiler;
  if (
    compilerBinding.state !== "pinned" ||
    !toolPinsEqual(compilerBinding.tool, infrastructure.compiler)
  ) {
    diagnostics.push(
      diagnostic(
        "EXPORT_COMPILER_PIN_MISMATCH",
        "Solution Revision must pin the exact compiler artifact producer.",
      ),
    );
  }
  const expectedPolicies = [...request.target.policyPacks].sort((left, right) =>
    compareUtf16(`${left.id}@${left.version}`, `${right.id}@${right.version}`),
  );
  const revisionPolicies = solutionRevision.versions.policy
    .map((tool) => ({ ...tool }))
    .sort((left, right) =>
      compareUtf16(
        `${left.id}@${left.version}`,
        `${right.id}@${right.version}`,
      ),
    );
  if (
    revisionPolicies.length !== expectedPolicies.length ||
    revisionPolicies.some((tool, index) => {
      const expectedPolicy = expectedPolicies.at(index);
      return (
        expectedPolicy === undefined || !toolPinsEqual(tool, expectedPolicy)
      );
    })
  ) {
    diagnostics.push(
      diagnostic(
        "EXPORT_POLICY_PACK_PIN_MISMATCH",
        "Approved policy packs must equal the Solution Revision policy pins.",
      ),
    );
  }
  if (
    infrastructureProjectionDigest(infrastructure) !==
    infrastructure.artifactDigest
  ) {
    diagnostics.push(
      diagnostic(
        "EXPORT_INFRASTRUCTURE_DIGEST_MISMATCH",
        "Infrastructure artifact digest must hash its exact canonical projection.",
      ),
    );
  }
  if (request.application !== undefined) {
    const application = request.application.artifact;
    if (
      application.solutionRevisionId !== solutionRevision.solutionRevisionId
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_APPLICATION_REVISION_MISMATCH",
          "Application artifact must bind the exact Solution Revision.",
        ),
      );
    }
    const generatorBinding = solutionRevision.versions.applicationGenerator;
    if (
      generatorBinding.state !== "pinned" ||
      !toolPinsEqual(generatorBinding.tool, application.generator)
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_GENERATOR_PIN_MISMATCH",
          "Solution Revision must pin the exact application generator.",
        ),
      );
    }
    const semanticArchitectureHash = solutionRevision.architecture.contentHash;
    const expectedRevisionInputDigest = getSolutionRevisionManifestContentHash({
      ...solutionRevision,
      architecture: {
        ...solutionRevision.architecture,
        documentHash: semanticArchitectureHash,
        visualHash: semanticArchitectureHash,
      },
    });
    if (
      application.sourceManifest.inputDigests.solutionRevision !==
      expectedRevisionInputDigest
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_APPLICATION_REVISION_DIGEST_MISMATCH",
          "Application source must bind the exact semantic Solution Revision digest.",
        ),
      );
    }
  }
  if (request.diagram !== undefined) {
    const diagram = request.diagram.artifact;
    const { artifactDigest, ...diagramContent } = diagram;
    const expectedRevisionDigest = sha256Digest(
      serializeCanonicalJson(solutionRevision),
    );
    const rendererBinding = solutionRevision.versions.diagramRenderer;
    const diagramRenderer = exactToolPinV1Schema.parse(diagram.renderer);
    if (
      artifactDigest !== sha256Digest(serializeCanonicalJson(diagramContent)) ||
      diagram.solutionRevision.id !== solutionRevision.solutionRevisionId ||
      diagram.solutionRevision.digest !== expectedRevisionDigest ||
      diagram.architecture.canonicalHash !==
        solutionRevision.architecture.documentHash ||
      diagram.architecture.contentHash !==
        solutionRevision.architecture.contentHash ||
      diagram.architecture.visualHash !==
        solutionRevision.architecture.visualHash ||
      diagram.catalog.id !== solutionRevision.versions.catalog.id ||
      diagram.catalog.version !== solutionRevision.versions.catalog.version ||
      diagram.catalog.digest !== solutionRevision.versions.catalog.digest ||
      rendererBinding.state !== "pinned" ||
      !toolPinsEqual(rendererBinding.tool, diagramRenderer)
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_DIAGRAM_BINDING_INVALID",
          "Diagram metadata must bind the exact immutable revision, architecture, catalog, and renderer.",
        ),
      );
    }
    const artifactPaths = diagram.files.map(({ path }) => path);
    const suppliedPaths = request.diagram.files
      .map(({ path }) => path)
      .sort(compareUtf16);
    if (
      artifactPaths.length !== suppliedPaths.length ||
      artifactPaths.some((path, index) => path !== suppliedPaths[index])
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_DIAGRAM_FILE_SET_INVALID",
          "Diagram content must contain every exact manifest file once.",
        ),
      );
    }
    const requiredPreviewPath = diagram.files.some(
      ({ path }) => path === "diagram/architecture.svg",
    )
      ? "diagram/architecture.svg"
      : "diagram/architecture.png";
    if (
      !diagram.files.some(({ path }) => path === "diagram/README.md") ||
      !diagram.files.some(({ path }) => path === requiredPreviewPath)
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_DIAGRAM_PREVIEW_MISSING",
          "Diagram output must include its README and an SVG or PNG preview.",
        ),
      );
    }
  }
}

function sortedConformanceDiagrams(request: SolutionExportRequestV1) {
  return [...(request.conformanceDiagrams ?? [])].sort((left, right) =>
    compareUtf16(
      `${left.request.state}\u0000${String(left.request.showDifferences)}`,
      `${right.request.state}\u0000${String(right.request.showDifferences)}`,
    ),
  );
}

function validateConformanceDiagrams(
  request: SolutionExportRequestV1,
  diagnostics: SolutionExportDiagnosticV1[],
): void {
  const revisionId = request.solutionRevision.solutionRevisionId;
  for (const entry of sortedConformanceDiagrams(request)) {
    if (
      entry.request.solutionRevisionId !== revisionId ||
      entry.result.artifact.solutionRevisionId !== revisionId
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_CONFORMANCE_DIAGRAM_REVISION_MISMATCH",
          "Conformance diagrams must bind the exact exported Solution Revision.",
          entry.result.artifact.file.path,
        ),
      );
      continue;
    }
    try {
      CONFORMANCE_DIAGRAM_SERVICE.verify({
        request: entry.request,
        result: entry.result,
      });
    } catch {
      diagnostics.push(
        diagnostic(
          "EXPORT_CONFORMANCE_DIAGRAM_INVALID",
          "Conformance diagram bytes and metadata must reproduce from the exact deterministic request.",
          entry.result.artifact.file.path,
        ),
      );
      continue;
    }
    const pathIssue = inspectExportPath(
      entry.result.artifact.file.path,
      request.target.limits.maxPathBytes,
    );
    if (pathIssue !== undefined) {
      diagnostics.push(
        diagnostic(
          pathIssue.code,
          pathIssue.message,
          entry.result.artifact.file.path,
        ),
      );
    }
  }
}
function architectureProjection(
  request: SolutionExportRequestV1,
): Record<string, unknown> {
  const sourceDocument = normalizeArchitectureDocumentV3(
    request.architectureDocument,
  );
  const {
    applicationContracts,
    externalResources,
    workloadBehavior,
    ...architecture
  } = sourceDocument;
  void applicationContracts;
  void externalResources;
  void workloadBehavior;
  return architecture;
}

function appFileProvenance(
  revisionId: string,
  source: ApplicationGenerationResultV1["artifact"]["sourceFiles"][number],
): SolutionExportProvenanceV1 {
  const references: SolutionExportProvenanceV1["sourceReferences"][number][] =
    [];
  for (const id of source.provenance.contractIds) {
    references.push({ id, kind: "contract" });
  }
  for (const id of source.provenance.edgeIds) {
    references.push({ id, kind: "edge" });
  }
  for (const id of source.provenance.environmentBindingIds) {
    references.push({ id, kind: "environment-binding" });
  }
  for (const id of source.provenance.extensionPointIds) {
    references.push({ id, kind: "extension" });
  }
  for (const id of source.provenance.operationIds) {
    references.push({ id, kind: "operation" });
  }
  for (const id of source.provenance.resourceTargetKeys) {
    references.push({ id, kind: "resource" });
  }
  for (const id of source.provenance.workloadIds) {
    references.push({ id, kind: "workload" });
  }
  if (references.length === 0) {
    references.push({ id: revisionId, kind: "solution-revision" });
  }
  return exportProvenance(revisionId, references, source.provenance.generator);
}

function mapApplicationOwnership(
  ownership: string,
): SolutionExportOwnershipKindV1 {
  return ownership === "generated"
    ? "generated-replaceable"
    : "user-owned-extension";
}

function collectApplicationReferences(
  application: ApplicationGenerationResultV1,
): SolutionExportArtifactReferenceV1[] {
  const references: SolutionExportArtifactReferenceV1[] = [];
  for (const workload of application.artifact.workloadContracts) {
    if (workload.implementationMode === "external-artifact") {
      references.push({
        artifactId: workload.artifact.artifactId,
        digest: workload.artifact.digest,
        kind: "external-artifact",
        ownership: "user-provided",
        state: "immutable-reference",
        workloadId: workload.workloadId,
      });
      continue;
    }
    if ("expectedArtifact" in workload) {
      references.push({
        kind: workload.expectedArtifact.kind,
        ownership:
          workload.implementationMode === "user-provided"
            ? "user-provided"
            : "generated-build-artifact",
        path: workload.expectedArtifact.path,
        state: "required-output",
        workloadId: workload.workloadId,
      });
    }
  }
  return references;
}

function deduplicateArtifactReferences(
  values: readonly SolutionExportArtifactReferenceV1[],
  diagnostics: SolutionExportDiagnosticV1[],
): SolutionExportArtifactReferenceV1[] {
  const byIdentity = new Map<string, SolutionExportArtifactReferenceV1>();
  for (const value of values) {
    const identity =
      value.state === "immutable-reference"
        ? `${value.workloadId}\u0000${value.artifactId}`
        : `${value.workloadId}\u0000${value.path}`;
    const existing = byIdentity.get(identity);
    if (
      existing !== undefined &&
      serializeCanonicalJson(existing) !== serializeCanonicalJson(value)
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_ARTIFACT_REFERENCE_CONFLICT",
          "Artifact reference identity has conflicting immutable metadata.",
        ),
      );
      continue;
    }
    byIdentity.set(identity, value);
  }
  return [...byIdentity.values()].sort((left, right) =>
    compareUtf16(serializeCanonicalJson(left), serializeCanonicalJson(right)),
  );
}

function conformanceDiagramLabel(
  state: NonNullable<
    SolutionExportRequestV1["conformanceDiagrams"]
  >[number]["request"]["state"],
  showDifferences: boolean,
): string {
  const stateLabel =
    state === "current-drift"
      ? "Current drift"
      : `${state.slice(0, 1).toUpperCase()}${state.slice(1)}`;
  return showDifferences ? `${stateLabel} with Differences` : stateLabel;
}

function buildConformanceReadmeSection(
  request: SolutionExportRequestV1,
): string {
  if (request.conformanceDiagrams === undefined) return "";
  const links = sortedConformanceDiagrams(request).map(({ result }) => {
    const artifact = result.artifact;
    const expiresAt = artifact.quality.expiresAt ?? "not declared";
    const lastVerified = artifact.quality.lastVerifiedAt ?? "not established";
    return (
      `- [${conformanceDiagramLabel(artifact.state, artifact.showDifferences)}](${artifact.file.path})` +
      ` - availability \`${artifact.quality.availability}\`; completeness \`${artifact.quality.completeness}\`; ` +
      `freshness \`${artifact.quality.freshness}\`; last verified \`${lastVerified}\`; expires \`${expiresAt}\`; ` +
      `environment \`${artifact.environmentId}\`; report \`${artifact.reportId}\` (\`${artifact.reportDigest}\`); ` +
      `provenance \`${artifact.provenanceDigest}\`; renderer \`${artifact.renderer.id}@${artifact.renderer.version}\``
    );
  });
  return (
    "\n## Conformance evidence diagrams\n\n" +
    "Each link is a read-only projection for one exact evidence state. Completeness, freshness, and provenance remain explicit; these files never remediate drift.\n\n" +
    `${links.join("\n")}\n`
  );
}
function buildReadme(request: SolutionExportRequestV1): string {
  const displayName = sanitizeMarkdownInline(request.target.exportName);
  const revisionId = sanitizeMarkdownInline(
    request.solutionRevision.solutionRevisionId,
  );
  const coverage = sanitizeMarkdownInline(
    request.application?.artifact.coverage.state ??
      request.solutionRevision.generationCoverage.state,
  );
  const infrastructureTarget = request.infrastructure.target;
  const validationLabel =
    infrastructureTarget === "terraform" ? "Terraform" : "CloudFormation";
  const diagram =
    request.diagram === undefined
      ? ""
      : request.diagram.artifact.files.some(
            ({ path }) => path === "diagram/architecture.svg",
          )
        ? "\n## Architecture diagram\n\n![Immutable architecture diagram](diagram/architecture.svg)\n"
        : "\n## Architecture diagram\n\n![Immutable architecture diagram](diagram/architecture.png)\n";
  return (
    `# ${displayName}\n\n` +
    `Solution Revision: \`${revisionId}\`\n\n` +
    `Target: \`${infrastructureTarget}\`\n\n` +
    (request.supplementalFiles.some(
      ({ path }) => path === "cloudmarkup/INFRASTRUCTURE_EXPORT.md",
    )
      ? "Export delivery: **infrastructure only**. Application source generation and builds were omitted; Lambda application code is still required. See [infrastructure export requirements](cloudmarkup/INFRASTRUCTURE_EXPORT.md).\n\n"
      : "") +
    `Generation coverage: \`${coverage}\`\n\n` +
    "This deterministic package contains reviewed source projections and generated artifacts. " +
    `Validation and Evidence placeholders do not claim that ${validationLabel} validation was executed, application source was built, or anything was deployed.\n` +
    (request.externalStageStatus === undefined
      ? ""
      : "External stage status records only digest-bound results produced before export; the exporter did not execute those tools or deploy anything.\n") +
    diagram +
    buildConformanceReadmeSection(request)
  );
}

function addCanonicalSourceFiles(
  state: AssemblyState,
  request: SolutionExportRequestV1,
): void {
  const revisionId = request.solutionRevision.solutionRevisionId;
  const sourceDocument = normalizeArchitectureDocumentV3(
    request.architectureDocument,
  );
  const revisionProvenance = exportProvenance(revisionId, [
    { id: revisionId, kind: "solution-revision" },
  ]);
  const architectureId = sourceDocument.architectureId;
  addCandidate(
    state,
    request,
    jsonCandidate(
      "cloudmarkup/solution.json",
      request.solutionRevision,
      "architecture-as-code-source",
      revisionProvenance,
    ),
  );
  addCandidate(
    state,
    request,
    jsonCandidate(
      "cloudmarkup/architecture.json",
      architectureProjection(request),
      "architecture-as-code-source",
      exportProvenance(revisionId, [
        { id: architectureId, kind: "architecture" },
      ]),
    ),
  );
  addCandidate(
    state,
    request,
    jsonCandidate(
      "cloudmarkup/workloads.json",
      sourceDocument.workloadBehavior,
      "architecture-as-code-source",
      exportProvenance(
        revisionId,
        sourceDocument.workloadBehavior.workloads.map((workload) => ({
          id: workload.id,
          kind: "workload" as const,
        })),
      ),
    ),
  );
  addCandidate(
    state,
    request,
    jsonCandidate(
      "cloudmarkup/external-resources.json",
      sourceDocument.externalResources,
      "architecture-as-code-source",
      exportProvenance(revisionId, [
        {
          id: sourceDocument.externalResources.documentId,
          kind: "architecture",
        },
      ]),
    ),
  );
  addCandidate(
    state,
    request,
    jsonCandidate(
      "cloudmarkup/contracts/application-contracts.json",
      sourceDocument.applicationContracts,
      "architecture-as-code-source",
      exportProvenance(
        revisionId,
        sourceDocument.applicationContracts.contracts.map((contract) => ({
          id: contract.contractId,
          kind: "contract" as const,
        })),
      ),
    ),
  );
}

function addInfrastructureFiles(
  state: AssemblyState,
  request: SolutionExportRequestV1,
): void {
  for (const file of request.infrastructure.files) {
    if (!file.path.startsWith("infrastructure/")) {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_INFRASTRUCTURE_PATH_INVALID",
          "Infrastructure artifacts must stay inside infrastructure/.",
          file.path,
        ),
      );
      continue;
    }
    const mediaType = solutionExportMediaTypeV1Schema.safeParse(file.mediaType);
    if (!mediaType.success) {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_INFRASTRUCTURE_MEDIA_TYPE_UNSUPPORTED",
          "Infrastructure file media type is not export-safe.",
          file.path,
        ),
      );
      continue;
    }
    addCandidate(state, request, {
      bytes: encodeUtf8(file.content),
      checksum: file.checksum,
      mediaType: mediaType.data,
      ownership: "generated-replaceable",
      path: file.path,
      provenance: file.provenance,
      semanticChecksum: file.semanticChecksum,
    });
  }
  addCandidate(
    state,
    request,
    jsonCandidate(
      "cloudmarkup/contracts/application-artifacts.json",
      [...request.infrastructure.applicationArtifacts].sort((left, right) =>
        compareUtf16(
          serializeCanonicalJson(left),
          serializeCanonicalJson(right),
        ),
      ),
      "generated-replaceable",
      exportProvenance(
        request.solutionRevision.solutionRevisionId,
        request.infrastructure.applicationArtifacts.map((artifact) => ({
          id: artifact.workloadId,
          kind: "application-artifact" as const,
        })),
        request.infrastructure.compiler,
      ),
    ),
  );
  addCandidate(
    state,
    request,
    jsonCandidate(
      "cloudmarkup/contracts/generated-resource-provenance.json",
      {
        policies: [...request.infrastructure.policyArtifacts].sort(
          (left, right) =>
            compareUtf16(left.policyDocumentId, right.policyDocumentId),
        ),
        resources: [...request.infrastructure.resources].sort((left, right) =>
          compareUtf16(left.resourceId, right.resourceId),
        ),
      },
      "generated-replaceable",
      exportProvenance(
        request.solutionRevision.solutionRevisionId,
        [
          ...request.infrastructure.resources.map((resource) => ({
            id: resource.resourceId,
            kind: "resource" as const,
          })),
          ...request.infrastructure.policyArtifacts.map((policy) => ({
            id: policy.policyDocumentId,
            kind: "policy" as const,
          })),
        ],
        request.infrastructure.compiler,
      ),
    ),
  );
  state.artifactReferences.push(
    ...request.infrastructure.applicationArtifacts.flatMap(
      (artifact) => artifact.inputs,
    ),
  );
}

function addApplicationFiles(
  state: AssemblyState,
  request: SolutionExportRequestV1,
): void {
  const application = request.application;
  if (application === undefined) {
    return;
  }
  const revisionId = request.solutionRevision.solutionRevisionId;
  for (const source of application.artifact.sourceFiles) {
    const ownership = mapApplicationOwnership(source.ownership);
    if (!("content" in source)) {
      addOwnership(state, defaultOwnership(source.path, ownership));
      if (source.ownership === "generated") {
        state.diagnostics.push(
          diagnostic(
            "EXPORT_APPLICATION_SOURCE_CONTENT_MISSING",
            "Generated application source must carry exact bytes for export.",
            source.path,
          ),
        );
      }
      continue;
    }
    const mediaType = solutionExportMediaTypeV1Schema.safeParse(
      source.mediaType,
    );
    if (!mediaType.success) {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_APPLICATION_MEDIA_TYPE_UNSUPPORTED",
          "Application source media type is not export-safe.",
          source.path,
        ),
      );
      continue;
    }
    addCandidate(state, request, {
      bytes: encodeUtf8(source.content),
      checksum: source.checksum,
      mediaType: mediaType.data,
      ownership,
      path: source.path,
      provenance: appFileProvenance(revisionId, source),
      semanticChecksum: source.semanticChecksum,
    });
  }
  for (const workload of application.artifact.workloadContracts) {
    if (!("sourceFiles" in workload)) {
      continue;
    }
    for (const source of workload.sourceFiles) {
      addOwnership(
        state,
        defaultOwnership(
          source.path,
          mapApplicationOwnership(source.ownership),
        ),
      );
    }
  }
  addCandidate(
    state,
    request,
    jsonCandidate(
      "application/manifest.json",
      application.artifact.sourceManifest,
      "generated-replaceable",
      exportProvenance(
        revisionId,
        [{ id: application.artifactDigest, kind: "application-artifact" }],
        application.artifact.generator,
      ),
    ),
  );
  addCandidate(
    state,
    request,
    jsonCandidate(
      "cloudmarkup/contracts/application-build-contracts.json",
      {
        buildContracts: application.artifact.buildContracts,
        workloadContracts: application.artifact.workloadContracts,
      },
      "generated-replaceable",
      exportProvenance(
        revisionId,
        application.artifact.workloadContracts.map((workload) => ({
          id: workload.workloadId,
          kind: "workload" as const,
        })),
        application.artifact.generator,
      ),
    ),
  );
  addCandidate(
    state,
    request,
    jsonCandidate(
      "cloudmarkup/contracts/generation-coverage.json",
      application.artifact.coverage,
      "generated-replaceable",
      exportProvenance(
        revisionId,
        [
          {
            id: application.artifact.coverage.solutionRevisionId,
            kind: "solution-revision",
          },
        ],
        application.artifact.generator,
      ),
    ),
  );
  state.artifactReferences.push(...collectApplicationReferences(application));
}

function addSupplementalFiles(
  state: AssemblyState,
  request: SolutionExportRequestV1,
): void {
  for (const file of request.supplementalFiles) {
    if (file.path.startsWith(SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT)) {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_WORKFLOW_PATH_RESERVED",
          "Repository workflow paths are reserved for a sealed reviewed workflow artifact.",
          file.path,
        ),
      );
      continue;
    }
    if (file.kind !== "regular-file") {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_NON_REGULAR_FILE_REJECTED",
          "Only regular files may enter an export package.",
          file.path,
        ),
      );
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes =
        file.content.encoding === "utf8"
          ? encodeUtf8(file.content.value)
          : decodeBase64(file.content.value);
    } catch {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_CONTENT_ENCODING_INVALID",
          "Supplemental file encoding is invalid or non-canonical.",
          file.path,
        ),
      );
      continue;
    }
    addCandidate(state, request, {
      bytes,
      checksum: file.checksum,
      mediaType: file.mediaType,
      ownership: file.ownership,
      path: file.path,
      provenance: file.provenance,
      semanticChecksum: file.semanticChecksum,
    });
    if (file.ownership === "generated-build-artifact") {
      const workload = file.provenance.sourceReferences.find(
        ({ kind }) => kind === "workload",
      );
      state.artifactReferences.push({
        artifactId: `artifact-${file.checksum.slice(7, 23)}`,
        digest: file.checksum,
        kind: "generated-build-artifact",
        ownership: file.ownership,
        state: "immutable-reference",
        workloadId: workload?.id ?? "solution",
      });
    }
  }
}

function pathIsInsideTree(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function addReviewedRepositoryWorkflowFiles(
  state: AssemblyState,
  request: SolutionExportRequestV1,
  solutionRevisionDigest: Sha256Digest,
): void {
  const bundle = request.reviewedRepositoryWorkflows;
  if (bundle === undefined) return;
  const { resultDigest, ...digestPayload } = bundle;
  if (
    computeReviewedRepositoryWorkflowsResultDigestV1(digestPayload) !==
    resultDigest
  ) {
    state.diagnostics.push(
      diagnostic(
        "EXPORT_REVIEWED_WORKFLOW_RESULT_DIGEST_MISMATCH",
        "Reviewed repository workflow metadata or bytes no longer match their sealed result digest.",
      ),
    );
    return;
  }
  const revisionId = request.solutionRevision.solutionRevisionId;
  if (
    bundle.solutionRevision.id !== revisionId ||
    bundle.solutionRevision.digest !== solutionRevisionDigest
  ) {
    state.diagnostics.push(
      diagnostic(
        "EXPORT_REVIEWED_WORKFLOW_REVISION_MISMATCH",
        "Reviewed repository workflows belong to a different immutable Solution Revision.",
      ),
    );
    return;
  }
  for (const tree of bundle.requiredPackageTrees) {
    const declared = new Map(
      tree.files.map((file) => [
        file.path.normalize("NFC").toLowerCase(),
        file,
      ]),
    );
    const actual = state.candidates.filter(({ path }) =>
      pathIsInsideTree(path, tree.root),
    );
    const exact =
      actual.length === declared.size &&
      actual.every((candidate) => {
        const binding = declared.get(
          candidate.path.normalize("NFC").toLowerCase(),
        );
        return (
          binding?.path === candidate.path &&
          binding.checksum === candidate.checksum
        );
      });
    if (!exact) {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_REVIEWED_WORKFLOW_PACKAGE_TREE_MISMATCH",
          "A required package tree differs from its exact sealed path and checksum inventory.",
          tree.root,
        ),
      );
    }
  }
  const pending = bundle.files.map((file) => {
    const bytes = encodeUtf8(file.content.value);
    if (
      sha256Digest(bytes) !== file.checksum ||
      canonicalSemanticDigest(file.mediaType, bytes) !== file.semanticChecksum
    ) {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_REVIEWED_WORKFLOW_CONTENT_MISMATCH",
          "Reviewed repository workflow bytes do not match their sealed checksums.",
          file.path,
        ),
      );
    }
    return {
      bytes,
      checksum: file.checksum,
      mediaType: file.mediaType,
      ownership: file.ownership,
      path: file.path,
      provenance: file.provenance,
      semanticChecksum: file.semanticChecksum,
    } satisfies CandidateFile;
  });
  if (hasErrors(state.diagnostics)) return;
  for (const file of pending) {
    addCandidate(state, request, file);
  }
}
function addDiagramFiles(
  state: AssemblyState,
  request: SolutionExportRequestV1,
): void {
  const diagram = request.diagram;
  if (diagram === undefined) return;
  const revisionId = request.solutionRevision.solutionRevisionId;
  for (const metadata of diagram.artifact.files) {
    const supplied = diagram.files.filter(({ path }) => path === metadata.path);
    if (supplied.length !== 1) {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_DIAGRAM_FILE_SET_INVALID",
          "Every diagram manifest file must resolve to exactly one content entry.",
          metadata.path,
        ),
      );
      continue;
    }
    let bytes: Uint8Array;
    try {
      const content = supplied[0]?.content;
      if (content === undefined) throw new TypeError("missing diagram content");
      bytes =
        content.encoding === "utf8"
          ? encodeUtf8(content.value)
          : decodeBase64(content.value);
    } catch {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_DIAGRAM_CONTENT_INVALID",
          "Diagram content encoding must be canonical and bounded.",
          metadata.path,
        ),
      );
      continue;
    }
    if (bytes.byteLength !== metadata.sizeBytes) {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_DIAGRAM_SIZE_MISMATCH",
          "Diagram content size must match its exact renderer metadata.",
          metadata.path,
        ),
      );
      continue;
    }
    addCandidate(state, request, {
      bytes,
      checksum: metadata.checksum,
      mediaType: metadata.mediaType,
      ownership: "generated-replaceable",
      path: metadata.path,
      provenance: exportProvenance(
        revisionId,
        [
          {
            id: request.architectureDocument.architectureId,
            kind: "architecture",
          },
          { id: revisionId, kind: "solution-revision" },
        ],
        exactToolPinV1Schema.parse(diagram.artifact.renderer),
      ),
      semanticChecksum: metadata.semanticChecksum,
    });
  }
}

function addConformanceDiagramFiles(
  state: AssemblyState,
  request: SolutionExportRequestV1,
): void {
  const revisionId = request.solutionRevision.solutionRevisionId;
  for (const entry of sortedConformanceDiagrams(request)) {
    let verified;
    try {
      verified = CONFORMANCE_DIAGRAM_SERVICE.verify({
        request: entry.request,
        result: entry.result,
      });
    } catch {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_CONFORMANCE_DIAGRAM_INVALID",
          "Conformance diagram bytes and metadata must reproduce from the exact deterministic request.",
          entry.result.artifact.file.path,
        ),
      );
      continue;
    }
    const artifact = verified.artifact;
    const bytes = encodeUtf8(verified.svg);
    if (bytes.byteLength !== artifact.file.sizeBytes) {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_CONFORMANCE_DIAGRAM_SIZE_MISMATCH",
          "Conformance diagram bytes must match the renderer-recorded size.",
          artifact.file.path,
        ),
      );
      continue;
    }
    addCandidate(state, request, {
      bytes,
      checksum: artifact.file.checksum,
      mediaType: artifact.file.mediaType,
      ownership: "evidence-artifact",
      path: artifact.file.path,
      provenance: exportProvenance(
        revisionId,
        [
          { id: revisionId, kind: "solution-revision" },
          ...entry.request.provenance.flatMap(
            ({ evidenceIds, provenanceId }) => [
              { id: provenanceId, kind: "evidence" as const },
              ...evidenceIds.map((evidenceId) => ({
                id: evidenceId,
                kind: "evidence" as const,
              })),
            ],
          ),
        ],
        exactToolPinV1Schema.parse(artifact.renderer),
      ),
      semanticChecksum: artifact.svgDigest,
    });
  }
}
function validateExternalStageEvidence(
  request: SolutionExportRequestV1,
  diagnostics: SolutionExportDiagnosticV1[],
): void {
  const status = request.externalStageStatus;
  if (status === undefined) return;
  const validationStage =
    "terraformValidation" in status
      ? (["terraform-validation", status.terraformValidation] as const)
      : ([
          "cloudformation-validation",
          status.cloudFormationValidation,
        ] as const);
  const stages = [
    ...(status.applicationBuild === undefined
      ? []
      : [["application-build", status.applicationBuild] as const]),
    validationStage,
  ];
  for (const [stage, stageStatus] of stages) {
    for (const reference of stageStatus.evidenceRecords) {
      const matching = request.supplementalFiles.filter(
        (file) =>
          file.ownership === "evidence-artifact" &&
          file.provenance.solutionRevisionId ===
            request.solutionRevision.solutionRevisionId &&
          file.provenance.sourceReferences.some(
            ({ id, kind }) =>
              kind === "evidence" && id === reference.evidenceId,
          ),
      );
      if (matching.length !== 1) {
        diagnostics.push(
          diagnostic(
            "EXPORT_EXTERNAL_EVIDENCE_REFERENCE_INVALID",
            "Every external stage Evidence reference must resolve to exactly one revision-bound supplemental file.",
          ),
        );
        continue;
      }
      const file = matching[0];
      if (
        file?.mediaType !== "application/json" ||
        file.content.encoding !== "utf8" ||
        file.checksum !== reference.recordDigest ||
        sha256Digest(encodeUtf8(file.content.value)) !== reference.recordDigest
      ) {
        diagnostics.push(
          diagnostic(
            "EXPORT_EXTERNAL_EVIDENCE_DIGEST_INVALID",
            "External stage Evidence metadata must match exact canonical JSON bytes.",
            file?.path,
          ),
        );
        continue;
      }
      let record: unknown;
      try {
        record = JSON.parse(file.content.value) as unknown;
      } catch {
        diagnostics.push(
          diagnostic(
            "EXPORT_EXTERNAL_EVIDENCE_CONTENT_INVALID",
            "External stage Evidence must contain strict canonical JSON.",
            file.path,
          ),
        );
        continue;
      }
      const parsed = evidenceRecordV1Schema.safeParse(record);
      if (
        !parsed.success ||
        parsed.data.id !== reference.evidenceId ||
        parsed.data.solutionRevisionId !==
          request.solutionRevision.solutionRevisionId ||
        serializeCanonicalJson(parsed.data.environment) !==
          serializeCanonicalJson(status.environment) ||
        parsed.data.checks.length === 0 ||
        parsed.data.checks.some(
          ({ status: checkStatus }) => checkStatus !== "passed",
        ) ||
        serializeCanonicalJson(parsed.data) !== file.content.value
      ) {
        diagnostics.push(
          diagnostic(
            "EXPORT_EXTERNAL_EVIDENCE_CONTENT_INVALID",
            `External ${stage} Evidence must be canonical, passed, and revision-bound.`,
            file.path,
          ),
        );
      }
    }
  }
}

function addGeneratedPackageFiles(
  state: AssemblyState,
  request: SolutionExportRequestV1,
  solutionRevisionDigest: Sha256Digest,
): void {
  const revisionId = request.solutionRevision.solutionRevisionId;
  const provenance = exportProvenance(revisionId, [
    { id: revisionId, kind: "solution-revision" },
  ]);
  if (request.reviewedRepositoryWorkflows === undefined) {
    addCandidate(
      state,
      request,
      textCandidate(
        NO_CREDENTIAL_PULL_REQUEST_WORKFLOW_PATH,
        NO_CREDENTIAL_PULL_REQUEST_WORKFLOW,
        "application/yaml",
        "generated-replaceable",
        provenance,
      ),
    );
  }
  addCandidate(
    state,
    request,
    textCandidate(
      "README.md",
      buildReadme(request),
      "text/markdown",
      "generated-replaceable",
      provenance,
    ),
  );
  addCandidate(
    state,
    request,
    jsonCandidate(
      "cloudmarkup/cloudmarkup.lock.json",
      {
        contractVersion: 1,
        inputs: {
          applicationContracts: request.solutionRevision.contracts.contentHash,
          architecture: request.solutionRevision.architecture.documentHash,
          externalResources:
            request.solutionRevision.externalResources.contentHash,
          workload: request.solutionRevision.workload.contentHash,
        },
        kind: "cloudmarkup.solution-export-lock",
        solutionRevision: {
          digest: solutionRevisionDigest,
          id: revisionId,
        },
        tools: {
          catalog: request.infrastructure.catalog,
          compiler: request.infrastructure.compiler,
          generator: request.application?.artifact.generator ?? null,
          policyPacks: request.target.policyPacks,
          renderer: request.target.renderer,
        },
      },
      "generated-replaceable",
      provenance,
    ),
  );
  if (request.externalStageStatus?.applicationBuild !== undefined) {
    addCandidate(
      state,
      request,
      jsonCandidate(
        "cloudmarkup/application-build/status.json",
        {
          contractVersion: 1,
          externalStage: request.externalStageStatus.applicationBuild,
          kind: "cloudmarkup.application-build-status",
          solutionRevisionId: revisionId,
          state: "not-run-by-export",
        },
        "generated-replaceable",
        provenance,
      ),
    );
  }
  addCandidate(
    state,
    request,
    jsonCandidate(
      "cloudmarkup/validation/status.json",
      {
        contractVersion: 1,
        ...(request.externalStageStatus === undefined
          ? {}
          : {
              externalStage:
                "terraformValidation" in request.externalStageStatus
                  ? request.externalStageStatus.terraformValidation
                  : request.externalStageStatus.cloudFormationValidation,
            }),
        kind: "cloudmarkup.validation-placeholder",
        solutionRevisionId: revisionId,
        state: "not-run-by-export",
      },
      "generated-replaceable",
      provenance,
    ),
  );
  addCandidate(
    state,
    request,
    jsonCandidate(
      "evidence/status.json",
      {
        contractVersion: 1,
        evidenceIdsAtFreeze: request.solutionRevision.evidenceIdsAtFreeze,
        ...(request.externalStageStatus === undefined
          ? {}
          : { externalStages: request.externalStageStatus }),
        kind: "cloudmarkup.evidence-placeholder",
        solutionRevisionId: revisionId,
        state: "not-collected-by-export",
      },
      "generated-replaceable",
      provenance,
    ),
  );
}

function warningsForRequest(
  request: SolutionExportRequestV1,
): SolutionExportManifestV1["warnings"] {
  return [
    ...request.infrastructure.diagnostics,
    ...(request.application?.artifact.diagnostics ?? []),
  ]
    .filter(({ severity }) => severity === "warning")
    .map(({ code, message }) => ({
      code,
      message: sanitizeMarkdownInline(message),
    }))
    .sort((left, right) => {
      const code = compareUtf16(left.code, right.code);
      return code === 0 ? compareUtf16(left.message, right.message) : code;
    });
}

function materializationConflicts(
  request: SolutionExportRequestV1,
  files: readonly CandidateFile[],
  diagnostics: SolutionExportDiagnosticV1[],
): SolutionExportConflictV1[] {
  const existingByKey = new Map<
    string,
    (typeof request.existingFiles)[number]
  >();
  for (const existing of request.existingFiles) {
    const issue = inspectExportPath(
      existing.path,
      request.target.limits.maxPathBytes,
    );
    if (issue !== undefined) {
      diagnostics.push(diagnostic(issue.code, issue.message, existing.path));
      continue;
    }
    if (existing.kind !== "regular-file") {
      diagnostics.push(
        diagnostic(
          "EXPORT_EXISTING_NON_REGULAR_REJECTED",
          "Existing destination inventory may contain only regular files.",
          existing.path,
        ),
      );
      continue;
    }
    const key = existing.path.normalize("NFC").toLowerCase();
    if (existingByKey.has(key)) {
      diagnostics.push(
        diagnostic(
          "EXPORT_EXISTING_PATH_DUPLICATE",
          "Existing destination paths must be unique across portable filesystems.",
          existing.path,
        ),
      );
      continue;
    }
    existingByKey.set(key, existing);
  }

  const conflicts: SolutionExportConflictV1[] = [];
  for (const file of files) {
    const existing = existingByKey.get(
      file.path.normalize("NFC").toLowerCase(),
    );
    if (existing === undefined || existing.currentChecksum === file.checksum) {
      continue;
    }
    const replaceable =
      file.ownership === "generated-replaceable" &&
      existing.ownership === "generated-replaceable" &&
      existing.baselineChecksum === existing.currentChecksum;
    if (replaceable) {
      continue;
    }
    conflicts.push({
      currentChecksum: existing.currentChecksum,
      existingOwnership: existing.ownership,
      path: repositoryRelativePathSchema.parse(file.path),
      proposedChecksum: file.checksum,
      reason:
        "Existing content is user-owned or no longer matches its exact generated baseline.",
    });
  }
  return conflicts;
}

function manifestFileEntry(file: CandidateFile): SolutionExportManifestFileV1 {
  return {
    checksum: file.checksum,
    mediaType: file.mediaType,
    ownership: file.ownership,
    path: repositoryRelativePathSchema.parse(file.path),
    provenance: file.provenance,
    semanticChecksum: file.semanticChecksum,
    sizeBytes: file.bytes.byteLength,
  };
}

function repositoryWorkflowManifestFileEntry(
  file: CandidateFile,
): SolutionExportRepositoryWorkflowsV1["files"][number] {
  if (
    file.mediaType !== "application/yaml" ||
    file.ownership !== "generated-replaceable" ||
    !file.path.startsWith(SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT)
  ) {
    throw new TypeError("Repository workflow candidate metadata is invalid.");
  }
  return {
    checksum: file.checksum,
    mediaType: file.mediaType,
    ownership: file.ownership,
    path: repositoryRelativePathSchema.parse(file.path),
    provenance: file.provenance,
    semanticChecksum: file.semanticChecksum,
    sizeBytes: file.bytes.byteLength,
  };
}

function buildRepositoryWorkflowManifest(
  request: SolutionExportRequestV1,
  files: readonly CandidateFile[],
  solutionRevisionDigest: Sha256Digest,
): SolutionExportRepositoryWorkflowsV1 | undefined {
  const workflowFiles = files.filter(({ path }) =>
    path.startsWith(SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT),
  );
  if (workflowFiles.length === 0) return undefined;
  const reviewed = request.reviewedRepositoryWorkflows;
  if (reviewed !== undefined) {
    return {
      configDigest: reviewed.configDigest,
      contractVersion: 1,
      dependencyLockDigests: reviewed.dependencyLockDigests,
      files: workflowFiles.map(repositoryWorkflowManifestFileEntry),
      generator: reviewed.generator,
      inclusionPolicy: SOLUTION_EXPORT_REPOSITORY_WORKFLOW_INCLUSION_POLICY,
      kind: "cloudmarkup.reviewed-repository-workflows",
      pinRegistryDigest: reviewed.pinRegistryDigest,
      policyDigest: reviewed.policyDigest,
      repository: reviewed.repository,
      requiredPackageTrees: reviewed.requiredPackageTrees,
      resultDigest: reviewed.resultDigest,
      review: reviewed.review,
      solutionRevision: reviewed.solutionRevision,
      validator: reviewed.validator,
    };
  }
  const workflow = workflowFiles[0];
  const lock = files.find(
    ({ path }) => path === "cloudmarkup/cloudmarkup.lock.json",
  );
  if (
    workflow?.path !== NO_CREDENTIAL_PULL_REQUEST_WORKFLOW_PATH ||
    lock === undefined
  ) {
    throw new TypeError(
      "Built-in workflow inventory is missing its exact workflow or package lock.",
    );
  }
  const workflowPath = repositoryRelativePathSchema.parse(workflow.path);
  const pinRegistryDigest = sha256Digest(
    serializeCanonicalJson({
      checkout: "de0fac2e4500dabe0009e67214ff5f5447ce83dd",
      setupNode: "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
    }),
  );
  const lockPath = repositoryRelativePathSchema.parse(lock.path);
  const requiredPackageTrees = [
    {
      files: [{ checksum: lock.checksum, path: lockPath }],
      root: lockPath,
    },
  ];
  const review = {
    environments: [],
    permissions: [
      {
        access: "read" as const,
        explanation:
          "The pull-request validator reads checked-out package content only.",
        scope: "contents",
        workflowPath,
      },
    ],
    roles: [],
    secrets: [],
    triggers: [{ events: ["pull_request"], workflowPath }],
    variables: [],
    workflows: [
      {
        environmentScoped: false,
        path: workflowPath,
        purpose: "Validate exact reviewed Solution package checksums",
      },
    ],
    warnings: [],
  };
  const digestPayload = {
    configDigest: sha256Digest("cloudmarkup.credentialless-validation.v1"),
    contractVersion: 1 as const,
    dependencyLockDigests: [
      { digest: pinRegistryDigest, id: "workflow-action-pins" },
    ],
    files: [
      {
        checksum: workflow.checksum,
        content: {
          encoding: "utf8" as const,
          value: decodeUtf8(workflow.bytes),
        },
        kind: "regular-file" as const,
        mediaType: "application/yaml" as const,
        ownership: "generated-replaceable" as const,
        path: workflowPath,
        provenance: workflow.provenance,
        semanticChecksum: workflow.semanticChecksum,
      },
    ],
    generator: EXPORTER,
    kind: "cloudmarkup.reviewed-repository-workflows" as const,
    pinRegistryDigest,
    policyDigest: workflow.semanticChecksum,
    repository: {
      destinationFolder: "" as const,
      state: "portable-unbound" as const,
    },
    requiredPackageTrees,
    review,
    solutionRevision: {
      digest: solutionRevisionDigest,
      id: request.solutionRevision.solutionRevisionId,
    },
    validator: EXPORTER,
  };
  return {
    ...digestPayload,
    files: workflowFiles.map(repositoryWorkflowManifestFileEntry),
    inclusionPolicy: SOLUTION_EXPORT_REPOSITORY_WORKFLOW_INCLUSION_POLICY,
    resultDigest: sha256Digest(serializeCanonicalJson(digestPayload)),
  };
}

function buildManifest(
  request: SolutionExportRequestV1,
  state: AssemblyState,
  files: readonly CandidateFile[],
  solutionRevisionDigest: Sha256Digest,
  artifactReferences: readonly SolutionExportArtifactReferenceV1[],
): SolutionExportManifestV1 {
  const displayName = sanitizeMarkdownInline(request.target.exportName);
  const archiveFileName = `${portableArchiveStem(request.target.exportName)}.zip`;
  return solutionExportManifestV1Schema.parse({
    application:
      request.application === undefined
        ? null
        : {
            artifactDigest: request.application.artifactDigest,
            generator: request.application.artifact.generator,
          },
    archive: {
      compression: "store",
      ordering: "utf16-code-unit",
      timestamp: SOLUTION_EXPORT_ZIP_EPOCH,
    },
    artifactReferences,
    ...(request.conformanceDiagrams === undefined
      ? {}
      : {
          conformanceDiagrams: sortedConformanceDiagrams(request).map(
            ({ result }) => result.artifact,
          ),
        }),
    diagram: request.diagram?.artifact ?? null,
    contractVersion: 1,
    files: files
      .filter(
        ({ path }) =>
          !path.startsWith(SOLUTION_EXPORT_REPOSITORY_WORKFLOW_ROOT),
      )
      .map(manifestFileEntry),
    generationCoverage: {
      ...(request.application === undefined
        ? {}
        : { artifact: request.application.artifact.coverage }),
      revision: request.solutionRevision.generationCoverage,
    },
    inputs: {
      applicationContracts: request.solutionRevision.contracts.contentHash,
      architectureContent: request.solutionRevision.architecture.contentHash,
      architectureDocument: request.solutionRevision.architecture.documentHash,
      architectureVisual: request.solutionRevision.architecture.visualHash,
      externalResources: request.solutionRevision.externalResources.contentHash,
      workload: request.solutionRevision.workload.contentHash,
    },
    infrastructure: {
      artifactDigest: request.infrastructure.artifactDigest,
    },
    kind: "cloudmarkup.solution-export-manifest",
    limits: request.target.limits,
    repositoryWorkflows: buildRepositoryWorkflowManifest(
      request,
      files,
      solutionRevisionDigest,
    ),
    ownership: [...state.ownership.values()].sort((left, right) =>
      compareUtf16(left.path, right.path),
    ),
    package: { archiveFileName, displayName },
    provenance: {
      artifacts: uniqueSortedStrings(
        artifactReferences.flatMap((reference) =>
          reference.state === "immutable-reference"
            ? [reference.artifactId]
            : [],
        ),
      ),
      contracts: uniqueSortedStrings(
        request.architectureDocument.applicationContracts.contracts.map(
          (contract) => contract.contractId,
        ),
      ),
      policies: uniqueSortedStrings(
        request.infrastructure.policyArtifacts.map(
          (policy) => policy.policyDocumentId,
        ),
      ),
      resources: uniqueSortedStrings(
        request.infrastructure.resources.map((resource) => resource.resourceId),
      ),
    },
    solutionRevision: {
      digest: solutionRevisionDigest,
      id: request.solutionRevision.solutionRevisionId,
    },
    status: {
      evidence: {
        evidenceIdsAtFreeze: [
          ...request.solutionRevision.evidenceIdsAtFreeze,
        ].sort(compareUtf16),
        state: "not-collected-by-export",
      },
      ...(request.externalStageStatus === undefined
        ? {}
        : { externalStages: request.externalStageStatus }),
      validation: { state: "not-run-by-export" },
    },
    target:
      request.infrastructure.target === "terraform"
        ? {
            formatVersion: request.infrastructure.formatVersion,
            kind: request.infrastructure.target,
            providers: [...request.infrastructure.providers].sort(
              (left, right) => compareUtf16(left.source, right.source),
            ),
            requiredTerraformVersion:
              request.infrastructure.requiredTerraformVersion,
          }
        : {
            formatVersion: request.infrastructure.formatVersion,
            kind: request.infrastructure.target,
            localValidation: request.infrastructure.localValidation,
            templateFormat: request.infrastructure.templateFormat,
            templateSpecificationVersion:
              request.infrastructure.templateSpecificationVersion,
          },
    tools: {
      catalog: request.infrastructure.catalog,
      compiler: request.infrastructure.compiler,
      generator: request.application?.artifact.generator ?? null,
      policyPacks: [...request.target.policyPacks].sort((left, right) =>
        compareUtf16(left.id, right.id),
      ),
      renderer: request.target.renderer,
    },
    warnings: warningsForRequest(request),
  });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function verifyConformanceDiagramArtifacts(
  manifest: SolutionExportManifestV1,
  payloadByPath: ReadonlyMap<string, SolutionExportFileV1>,
  diagnostics: SolutionExportDiagnosticV1[],
): void {
  for (const artifact of manifest.conformanceDiagrams ?? []) {
    const { artifactDigest, ...artifactContent } = artifact;
    const file = payloadByPath.get(artifact.file.path);
    const expectedPath = `diagram/conformance/${artifact.state}${artifact.showDifferences ? "-differences" : ""}.svg`;
    const textIssue =
      file === undefined
        ? undefined
        : inspectTextContent(file.mediaType, file.bytes);
    const invalid =
      artifactDigest !==
        sha256Digest(serializeCanonicalJson(artifactContent)) ||
      artifact.provenanceDigest !==
        sha256Digest(serializeCanonicalJson(artifact.provenance)) ||
      artifact.counts.provenance !== artifact.provenance.length ||
      artifact.solutionRevisionId !== manifest.solutionRevision.id ||
      artifact.file.path !== expectedPath ||
      artifact.file.checksum !== artifact.svgDigest ||
      serializeCanonicalJson(artifact.renderer) !==
        serializeCanonicalJson(conformanceDiagramRendererV1Pin) ||
      file?.ownership !== "evidence-artifact" ||
      file.mediaType !== "image/svg+xml" ||
      file.bytes.byteLength !== artifact.file.sizeBytes ||
      file.checksum !== artifact.file.checksum ||
      file.semanticChecksum !== artifact.svgDigest ||
      file.provenance.solutionRevisionId !== manifest.solutionRevision.id ||
      serializeCanonicalJson(file.provenance.producer) !==
        serializeCanonicalJson(artifact.renderer) ||
      serializeCanonicalJson(file.provenance.sourceReferences) !==
        serializeCanonicalJson(
          uniqueSortedReferences([
            { id: manifest.solutionRevision.id, kind: "solution-revision" },
            ...artifact.provenance.flatMap(({ evidenceIds, provenanceId }) => [
              { id: provenanceId, kind: "evidence" as const },
              ...evidenceIds.map((evidenceId) => ({
                id: evidenceId,
                kind: "evidence" as const,
              })),
            ]),
          ]),
        ) ||
      sha256Digest(file.bytes) !== artifact.svgDigest ||
      textIssue !== undefined;
    if (invalid) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_CONFORMANCE_DIAGRAM_INVALID",
          "Conformance diagram metadata, renderer, revision binding, path, size, checksum, provenance, and exact SVG bytes must agree.",
          artifact.file.path,
        ),
      );
    }
  }
}
export function verifySolutionExportArtifact(
  artifact: SolutionExportArtifactV1,
): readonly SolutionExportDiagnosticV1[] {
  const diagnostics: SolutionExportDiagnosticV1[] = [];
  const parsedManifest = solutionExportManifestV1Schema.safeParse(
    artifact.manifest,
  );
  if (!parsedManifest.success) {
    return [
      diagnostic(
        "EXPORT_MANIFEST_SCHEMA_INVALID",
        "Export manifest does not satisfy the strict version-1 contract.",
      ),
    ];
  }
  const manifest = parsedManifest.data;
  const files = [...artifact.files].sort((left, right) =>
    compareUtf16(left.path, right.path),
  );
  const seen = new Set<string>();
  for (const file of files) {
    const issue = inspectExportPath(file.path, manifest.limits.maxPathBytes);
    if (issue !== undefined) {
      diagnostics.push(diagnostic(issue.code, issue.message, file.path));
    }
    const key = file.path.normalize("NFC").toLowerCase();
    if (seen.has(key)) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_DUPLICATE_PATH",
          "Verified file tree contains a duplicate portable path.",
          file.path,
        ),
      );
    }
    seen.add(key);
    if (sha256Digest(file.bytes) !== file.checksum) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_CHECKSUM_MISMATCH",
          "Verified file bytes do not match their checksum.",
          file.path,
        ),
      );
    }
    if (
      canonicalSemanticDigest(file.mediaType, file.bytes) !==
      file.semanticChecksum
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_SEMANTIC_CHECKSUM_MISMATCH",
          "Verified file semantic checksum does not match its content.",
          file.path,
        ),
      );
    }
  }
  const manifestFile = files.find(
    ({ path }) => path === SOLUTION_EXPORT_MANIFEST_PATH,
  );
  if (manifestFile === undefined) {
    diagnostics.push(
      diagnostic(
        "EXPORT_VERIFY_MANIFEST_FILE_MISSING",
        "Export file tree must contain its canonical manifest file.",
      ),
    );
  } else {
    const canonicalManifest = serializeCanonicalJson(manifest);
    if (decodeUtf8(manifestFile.bytes) !== canonicalManifest) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_MANIFEST_CONTENT_MISMATCH",
          "Manifest file bytes must equal the canonical returned manifest.",
          SOLUTION_EXPORT_MANIFEST_PATH,
        ),
      );
    }
    if (sha256Digest(manifestFile.bytes) !== artifact.manifestDigest) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_MANIFEST_DIGEST_MISMATCH",
          "Manifest digest must hash the exact manifest file bytes.",
          SOLUTION_EXPORT_MANIFEST_PATH,
        ),
      );
    }
  }
  const payloadByPath = new Map(
    files
      .filter(({ path }) => path !== SOLUTION_EXPORT_MANIFEST_PATH)
      .map((file) => [file.path, file] as const),
  );
  const declaredEntries = [
    ...manifest.files,
    ...(manifest.repositoryWorkflows?.files ?? []),
  ];
  if (payloadByPath.size !== declaredEntries.length) {
    diagnostics.push(
      diagnostic(
        "EXPORT_VERIFY_MANIFEST_FILE_SET_MISMATCH",
        "Package and repository-workflow inventories must enumerate every non-manifest file exactly once.",
      ),
    );
  }
  for (const entry of declaredEntries) {
    const file = payloadByPath.get(entry.path);
    if (file === undefined) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_MANIFEST_ENTRY_MISMATCH",
          "Manifest entry does not match the exact returned file.",
          entry.path,
        ),
      );
      continue;
    }
    if (
      file.checksum !== entry.checksum ||
      file.semanticChecksum !== entry.semanticChecksum ||
      file.mediaType !== entry.mediaType ||
      file.ownership !== entry.ownership ||
      file.bytes.byteLength !== entry.sizeBytes ||
      serializeCanonicalJson(file.provenance) !==
        serializeCanonicalJson(entry.provenance)
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_MANIFEST_ENTRY_MISMATCH",
          "Manifest entry does not match the exact returned file.",
          entry.path,
        ),
      );
    }
  }
  verifyConformanceDiagramArtifacts(manifest, payloadByPath, diagnostics);
  const workflows = manifest.repositoryWorkflows;
  if (workflows !== undefined) {
    if (workflows.repository.state === "portable-unbound") {
      const portableWorkflow = payloadByPath.get(
        SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH,
      );
      if (
        portableWorkflow === undefined ||
        !bytesEqual(
          portableWorkflow.bytes,
          encodeUtf8(NO_CREDENTIAL_PULL_REQUEST_WORKFLOW),
        )
      ) {
        diagnostics.push(
          diagnostic(
            "EXPORT_VERIFY_PORTABLE_WORKFLOW_CONTENT_MISMATCH",
            "Portable workflow bytes must equal the exact credentialless validation workflow.",
            SOLUTION_EXPORT_CREDENTIALLESS_VALIDATION_WORKFLOW_PATH,
          ),
        );
      }
    }
    if (
      workflows.solutionRevision.id !== manifest.solutionRevision.id ||
      workflows.solutionRevision.digest !== manifest.solutionRevision.digest
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_REPOSITORY_WORKFLOW_REVISION_MISMATCH",
          "Repository workflow inventory belongs to a different immutable Solution Revision.",
        ),
      );
    }
    let workflowDigest: Sha256Digest | undefined;
    try {
      const digestPayload = {
        configDigest: workflows.configDigest,
        contractVersion: 1 as const,
        dependencyLockDigests: workflows.dependencyLockDigests,
        files: workflows.files.map((entry) => {
          const file = payloadByPath.get(entry.path);
          if (file === undefined) {
            throw new TypeError("missing workflow file");
          }
          return {
            checksum: entry.checksum,
            content: {
              encoding: "utf8" as const,
              value: decodeUtf8(file.bytes),
            },
            kind: "regular-file" as const,
            mediaType: "application/yaml" as const,
            ownership: "generated-replaceable" as const,
            path: entry.path,
            provenance: entry.provenance,
            semanticChecksum: entry.semanticChecksum,
          };
        }),
        generator: workflows.generator,
        kind: "cloudmarkup.reviewed-repository-workflows" as const,
        pinRegistryDigest: workflows.pinRegistryDigest,
        policyDigest: workflows.policyDigest,
        repository: workflows.repository,
        requiredPackageTrees: workflows.requiredPackageTrees,
        review: workflows.review,
        solutionRevision: workflows.solutionRevision,
        validator: workflows.validator,
      };
      workflowDigest = sha256Digest(serializeCanonicalJson(digestPayload));
    } catch {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_REPOSITORY_WORKFLOW_CONTENT_INVALID",
          "Repository workflow inventory content must be present and valid UTF-8.",
        ),
      );
    }
    if (
      workflowDigest !== undefined &&
      workflowDigest !== workflows.resultDigest
    ) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_REPOSITORY_WORKFLOW_DIGEST_MISMATCH",
          "Repository workflow bytes or metadata do not match the sealed result digest.",
        ),
      );
    }
    for (const tree of workflows.requiredPackageTrees) {
      const declared = new Map(
        tree.files.map((file) => [
          file.path.normalize("NFC").toLowerCase(),
          file,
        ]),
      );
      const actual = manifest.files.filter(({ path }) =>
        pathIsInsideTree(path, tree.root),
      );
      const exact =
        actual.length === declared.size &&
        actual.every((entry) => {
          const binding = declared.get(
            entry.path.normalize("NFC").toLowerCase(),
          );
          return (
            binding?.path === entry.path && binding.checksum === entry.checksum
          );
        });
      if (!exact) {
        diagnostics.push(
          diagnostic(
            "EXPORT_VERIFY_REPOSITORY_WORKFLOW_PACKAGE_TREE_MISMATCH",
            "Repository workflow package-tree bindings do not match the exact package inventory.",
            tree.root,
          ),
        );
      }
    }
  }
  const decompressedBytes = files.reduce(
    (sum, file) => sum + file.bytes.byteLength,
    0,
  );
  if (
    files.length > manifest.limits.maxFiles ||
    decompressedBytes > manifest.limits.maxDecompressedBytes ||
    artifact.zipBytes.byteLength > manifest.limits.maxArchiveBytes
  ) {
    diagnostics.push(
      diagnostic(
        "EXPORT_VERIFY_LIMIT_EXCEEDED",
        "Returned export exceeds its recorded file or byte limits.",
      ),
    );
  }
  if (sha256Digest(artifact.zipBytes) !== artifact.zipDigest) {
    diagnostics.push(
      diagnostic(
        "EXPORT_VERIFY_ZIP_DIGEST_MISMATCH",
        "ZIP digest must hash the exact returned archive bytes.",
      ),
    );
  }
  if (
    artifact.archiveFileName !== manifest.package.archiveFileName ||
    artifact.archiveFileName !==
      `${portableArchiveStem(manifest.package.displayName)}.zip`
  ) {
    diagnostics.push(
      diagnostic(
        "EXPORT_VERIFY_ARCHIVE_NAME_MISMATCH",
        "Archive filename must equal the sanitized manifest package name.",
      ),
    );
  }
  try {
    const zipEntries = readDeterministicZip(artifact.zipBytes);
    if (zipEntries.length !== files.length) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_ZIP_FILE_SET_MISMATCH",
          "ZIP must contain every returned file exactly once.",
        ),
      );
    }
    for (const [index, file] of files.entries()) {
      const zipEntry = zipEntries[index];
      if (
        zipEntry?.path !== file.path ||
        !bytesEqual(zipEntry.bytes, file.bytes)
      ) {
        diagnostics.push(
          diagnostic(
            "EXPORT_VERIFY_ZIP_ENTRY_MISMATCH",
            "ZIP entries must equal the canonically ordered returned file tree.",
            file.path,
          ),
        );
      }
    }
    const rebuilt = createDeterministicZip(files);
    if (!bytesEqual(rebuilt, artifact.zipBytes)) {
      diagnostics.push(
        diagnostic(
          "EXPORT_VERIFY_ZIP_NOT_REPRODUCIBLE",
          "ZIP bytes must equal an independent deterministic rebuild.",
        ),
      );
    }
  } catch {
    diagnostics.push(
      diagnostic(
        "EXPORT_VERIFY_ZIP_CORRUPT",
        "ZIP structure, CRC, metadata, or entry bounds are invalid.",
      ),
    );
  }
  return diagnostics;
}

/** Reconstruct only an exact retained package; this does not approve or publish it. */
export function restoreSolutionExportArtifact(input: {
  readonly archiveFileName: string;
  readonly fileCount: number;
  readonly manifestBytes: Uint8Array;
  readonly manifestDigest: Sha256Digest;
  readonly solutionRevisionDigest: Sha256Digest;
  readonly solutionRevisionId: string;
  readonly zipBytes: Uint8Array;
  readonly zipDigest: Sha256Digest;
}): SolutionExportArtifactV1 {
  try {
    if (
      !(input.manifestBytes instanceof Uint8Array) ||
      !(input.zipBytes instanceof Uint8Array) ||
      input.manifestBytes.byteLength > 33_554_432 ||
      input.zipBytes.byteLength > 67_108_864 ||
      !Number.isSafeInteger(input.fileCount) ||
      input.fileCount < 1 ||
      input.fileCount > 2_048
    )
      throw new TypeError();
    // Detach caller-owned buffers before parsing or returning any file bytes.
    const zipBytes = input.zipBytes.slice();
    const manifestBytes = input.manifestBytes.slice();
    if (
      sha256Digest(zipBytes) !== input.zipDigest ||
      sha256Digest(manifestBytes) !== input.manifestDigest
    )
      throw new TypeError();
    const manifest = solutionExportManifestV1Schema.parse(
      JSON.parse(decodeUtf8(manifestBytes)) as unknown,
    );
    if (
      serializeCanonicalJson(manifest) !== decodeUtf8(manifestBytes) ||
      manifest.package.archiveFileName !== input.archiveFileName ||
      manifest.solutionRevision.id !== input.solutionRevisionId ||
      manifest.solutionRevision.digest !== input.solutionRevisionDigest
    )
      throw new TypeError();
    const inventory = new Map<string, SolutionExportManifestFileV1>(
      [...manifest.files, ...(manifest.repositoryWorkflows?.files ?? [])].map(
        (file) => [file.path, file] as const,
      ),
    );
    const entries = readDeterministicZip(zipBytes);
    if (entries.length !== input.fileCount) throw new TypeError();
    const files: SolutionExportFileV1[] = entries.map((entry) => {
      if (entry.path === SOLUTION_EXPORT_MANIFEST_PATH)
        return {
          bytes: entry.bytes,
          checksum: input.manifestDigest,
          mediaType: "application/json",
          ownership: "generated-replaceable",
          path: entry.path,
          provenance: exportProvenance(input.solutionRevisionId, [
            { id: input.solutionRevisionId, kind: "solution-revision" },
            { id: "export-manifest", kind: "export" },
          ]),
          semanticChecksum: canonicalSemanticDigest(
            "application/json",
            entry.bytes,
          ),
        };
      const metadata = inventory.get(entry.path);
      if (metadata === undefined) throw new TypeError();
      return {
        bytes: entry.bytes,
        checksum: metadata.checksum,
        mediaType: metadata.mediaType,
        ownership: metadata.ownership,
        path: entry.path,
        provenance: metadata.provenance,
        semanticChecksum: metadata.semanticChecksum,
      };
    });
    const artifact: SolutionExportArtifactV1 = {
      archiveFileName: input.archiveFileName,
      files,
      manifest,
      manifestDigest: input.manifestDigest,
      zipBytes,
      zipDigest: input.zipDigest,
    };
    if (
      verifySolutionExportArtifact(artifact).some(
        ({ severity }) => severity === "error",
      )
    )
      throw new TypeError();
    return artifact;
  } catch {
    // Never expose manifest content, unsafe paths, or decoder/provider errors.
    throw new TypeError(
      "The retained Solution export failed integrity verification.",
    );
  }
}

export function generateSolutionExport(input: unknown): SolutionExportResultV1 {
  const parsed = solutionExportRequestV1Schema.safeParse(input);
  if (!parsed.success) {
    return blocked([
      diagnostic(
        "EXPORT_REQUEST_INVALID",
        "Export request does not satisfy the strict version-1 contract.",
      ),
    ]);
  }
  const request = parsed.data;
  const state: AssemblyState = {
    artifactReferences: [],
    candidates: [],
    diagnostics: [],
    ownership: new Map(),
  };
  validateRevisionBindings(request, state.diagnostics);
  validateConformanceDiagrams(request, state.diagnostics);
  validateExternalStageEvidence(request, state.diagnostics);
  for (const producerDiagnostic of [
    ...request.infrastructure.diagnostics,
    ...(request.application?.artifact.diagnostics ?? []),
  ]) {
    if (producerDiagnostic.severity === "error") {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_PRODUCER_ERROR",
          "Export cannot package an artifact that carries producer errors.",
        ),
      );
      break;
    }
  }
  if (hasErrors(state.diagnostics)) {
    return blocked(state.diagnostics);
  }
  const solutionRevisionDigest = sha256Digest(
    serializeCanonicalJson(request.solutionRevision),
  );
  addCanonicalSourceFiles(state, request);
  addInfrastructureFiles(state, request);
  addApplicationFiles(state, request);
  addSupplementalFiles(state, request);
  addDiagramFiles(state, request);
  addConformanceDiagramFiles(state, request);
  addGeneratedPackageFiles(state, request, solutionRevisionDigest);
  addReviewedRepositoryWorkflowFiles(state, request, solutionRevisionDigest);

  if (state.candidates.length + 1 > request.target.limits.maxFiles) {
    state.diagnostics.push(
      diagnostic(
        "EXPORT_FILE_COUNT_LIMIT_EXCEEDED",
        "Export file count exceeds the configured limit.",
      ),
    );
  }
  const initialDecompressed = state.candidates.reduce(
    (sum, file) => sum + file.bytes.byteLength,
    0,
  );
  if (initialDecompressed > request.target.limits.maxDecompressedBytes) {
    state.diagnostics.push(
      diagnostic(
        "EXPORT_DECOMPRESSED_LIMIT_EXCEEDED",
        "Export payload exceeds the configured decompressed byte limit.",
      ),
    );
  }
  if (hasErrors(state.diagnostics)) {
    return blocked(state.diagnostics);
  }

  const payloadFiles = [...state.candidates].sort((left, right) =>
    compareUtf16(left.path, right.path),
  );
  const artifactReferences = deduplicateArtifactReferences(
    state.artifactReferences,
    state.diagnostics,
  );
  addOwnership(
    state,
    defaultOwnership(SOLUTION_EXPORT_MANIFEST_PATH, "generated-replaceable"),
  );
  const manifest = buildManifest(
    request,
    state,
    payloadFiles,
    solutionRevisionDigest,
    artifactReferences,
  );
  const manifestCandidate = jsonCandidate(
    SOLUTION_EXPORT_MANIFEST_PATH,
    manifest,
    "generated-replaceable",
    exportProvenance(request.solutionRevision.solutionRevisionId, [
      {
        id: request.solutionRevision.solutionRevisionId,
        kind: "solution-revision",
      },
      { id: "export-manifest", kind: "export" },
    ]),
  );
  const files = [...payloadFiles, manifestCandidate].sort((left, right) =>
    compareUtf16(left.path, right.path),
  );
  const conflicts = materializationConflicts(request, files, state.diagnostics);
  if (conflicts.length > 0 || hasErrors(state.diagnostics)) {
    if (conflicts.length > 0) {
      state.diagnostics.push(
        diagnostic(
          "EXPORT_DESTINATION_CONFLICT",
          "Export is blocked because existing destination content is not safely replaceable.",
        ),
      );
    }
    return blocked(state.diagnostics, conflicts);
  }
  const decompressedBytes = files.reduce(
    (sum, file) => sum + file.bytes.byteLength,
    0,
  );
  if (decompressedBytes > request.target.limits.maxDecompressedBytes) {
    return blocked([
      diagnostic(
        "EXPORT_DECOMPRESSED_LIMIT_EXCEEDED",
        "Export including its manifest exceeds the decompressed byte limit.",
      ),
    ]);
  }
  let zipBytes: Uint8Array;
  try {
    zipBytes = createDeterministicZip(files);
  } catch {
    return blocked([
      diagnostic(
        "EXPORT_ZIP_CREATION_FAILED",
        "Export file tree exceeds deterministic ZIP32 bounds.",
      ),
    ]);
  }
  if (zipBytes.byteLength > request.target.limits.maxArchiveBytes) {
    return blocked([
      diagnostic(
        "EXPORT_ARCHIVE_LIMIT_EXCEEDED",
        "Deterministic ZIP exceeds the configured archive byte limit.",
      ),
    ]);
  }
  const exportedFiles: SolutionExportFileV1[] = files.map((file) => ({
    ...file,
    bytes: file.bytes.slice(),
  }));
  const artifact: SolutionExportArtifactV1 = {
    archiveFileName: manifest.package.archiveFileName,
    files: exportedFiles,
    manifest,
    manifestDigest: manifestCandidate.checksum,
    zipBytes,
    zipDigest: sha256Digest(zipBytes),
  };
  const verificationDiagnostics = verifySolutionExportArtifact(artifact);
  if (verificationDiagnostics.some(({ severity }) => severity === "error")) {
    return blocked(verificationDiagnostics);
  }
  return {
    artifact,
    contractVersion: 1,
    diagnostics: [...state.diagnostics, ...verificationDiagnostics],
    state: "ready",
  };
}

export const localSolutionExportService: SolutionExportService = Object.freeze({
  generate: generateSolutionExport,
  verify: verifySolutionExportArtifact,
});
