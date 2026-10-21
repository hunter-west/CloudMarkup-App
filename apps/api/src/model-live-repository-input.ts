import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { revisionV1Schema } from "@cloudmarkup/api-contract";
import {
  getArchitectureDocumentCanonicalHash,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  frozenFullBetaEvaluationDatasetV1,
  fullBetaRepositorySourcesV1,
  type FullBetaRepositoryCaseKind,
} from "@cloudmarkup/model-gateway";
import { awsCatalogV1, awsCatalogArtifactV1 } from "@cloudmarkup/provider-aws";
import {
  createRepositoryImportService,
  repositoryImportRequestV1Schema,
} from "@cloudmarkup/repository-importer";
import { sha256Text } from "@cloudmarkup/schemas";
import { createInitialArchitectureDocument } from "./application/architecture-document-storage.js";
import { buildSolutionRevisionV1 } from "./application/solution-revision-builder.js";
import { createPinnedTerraformHclInspector } from "./adapters/pinned-terraform-inspector.js";
import {
  createPinnedGoInvocation,
  type PinnedCompilerConfiguration,
} from "./adapters/pinned-go-executable.js";

const createdAt = "2026-09-11T00:00:00.000Z";
const principalId = "principal_frozen_repository_evaluation";
const prefix = "cloudmarkup-frozen-repository-";

/** Canonical synthetic design input. This is not a saved customer revision or
 * an approval. The normal immutable-manifest builder preserves missing evidence. */
export function createModelLiveRepositoryDesign(
  caseKind: FullBetaRepositoryCaseKind,
) {
  const document = parseArchitectureDocument({
    ...createInitialArchitectureDocument({
      identity: {
        architectureId: "architecture_frozen_repository",
        documentId: "document_frozen_repository",
        draftId: "draft_frozen_repository",
        revisionId: "revision_frozen_repository",
        principalId,
      },
      createdAt,
      blank: true,
      infrastructureOnly: true,
    }),
    provider: { id: awsCatalogArtifactV1.provider.id, region: "us-east-1" },
    catalog: {
      id: awsCatalogArtifactV1.catalog.id,
      version: awsCatalogArtifactV1.catalog.version,
      digest: awsCatalogArtifactV1.digest,
    },
    nodes:
      caseKind !== "designed-observed-mismatch"
        ? []
        : [
            {
              id: "node_designed_notes",
              semantic: {
                serviceType: "aws.dynamodb.table",
                resourceType: "aws.dynamodb.table",
                deploymentKey: "notes",
                lifecycle: { origin: "user", ownership: "user" },
                configuration: {
                  schemaId:
                    awsCatalogV1.requireService("aws.dynamodb.table")
                      .configuration.schemaId,
                  schemaVersion: "1.0.0",
                  values: {
                    tableName: { kind: "string", value: "synthetic-notes" },
                    billingMode: { kind: "string", value: "PAY_PER_REQUEST" },
                    partitionKeyName: { kind: "string", value: "noteId" },
                    partitionKeyType: { kind: "string", value: "S" },
                    pointInTimeRecoveryEnabled: {
                      kind: "boolean",
                      value: true,
                    },
                    serverSideEncryptionEnabled: {
                      kind: "boolean",
                      value: true,
                    },
                    deletionProtectionEnabled: { kind: "boolean", value: true },
                  },
                },
              },
              presentation: {
                label: "Designed notes table",
                position: { x: 0, y: 0 },
              },
            },
          ],
  });
  const revision = revisionV1Schema.parse({
    architectureDocument: document,
    catalogDigest: document.catalog.digest,
    catalogId: document.catalog.id,
    catalogVersion: document.catalog.version,
    contentDigest: getArchitectureDocumentCanonicalHash(document),
    createdAt,
    createdBy: { displayName: "Synthetic Evaluation", id: principalId },
    graphSchemaVersion: 3,
    id: document.revision.revisionId,
    projectId: "project_frozen_repository",
    sourceDraftId: "draft_frozen_repository",
    sourceDraftVersion: 1,
    workloadBehaviorVersion: 2,
  });
  return buildSolutionRevisionV1({
    name: "Frozen repository evaluation design",
    revision,
    solutionRevisionId: "solution_frozen_repository",
  });
}

/** Executes the real data-only importer on checked synthetic bytes. No model
 * response, customer content, provider grade or execution authority is accepted.
 * Raw import output stays in the caller's RAM; only reviewed input is materialized. */
export async function prepareModelLiveRepositoryInput(input: {
  readonly caseKind: FullBetaRepositoryCaseKind;
  readonly compiler: PinnedCompilerConfiguration;
}) {
  const source = fullBetaRepositorySourcesV1.find(
    (s) => s.caseKind === input.caseKind,
  );
  const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
    (c) => c.caseKind === input.caseKind,
  );
  const fixture = evaluationCase?.input.repositoryFixtures[0];
  if (
    !source ||
    evaluationCase?.input.repositoryFixtures.length !== 1 ||
    fixture?.path !== source.path ||
    fixture.evidenceId !== source.evidenceId ||
    fixture.contentDigest !== sha256Text(source.content) ||
    fixture.sourceMode !== source.sourceMode
  )
    throw Error("The frozen repository input is unavailable.");
  // Validate the admitted executable even when this particular source has no HCL.
  // Otherwise a source-only case could advertise a ready host with an invalid pin.
  await createPinnedGoInvocation(input.compiler)(() =>
    Promise.resolve(undefined),
  );
  const design = createModelLiveRepositoryDesign(input.caseKind);
  const request = repositoryImportRequestV1Schema.parse({
    contractVersion: 1,
    profile: {
      contractVersion: 1,
      profileId: "cloudmarkup.full-beta.repository-input",
      profileVersion: "1.0.0",
      importedAt: createdAt,
      commitSha: source.commitSha,
      snapshotId: "snapshot_frozen_" + source.caseKind.replaceAll("-", "_"),
      observedSolutionId:
        "observed_frozen_" + source.caseKind.replaceAll("-", "_"),
      sourceId: "cloudmarkup.synthetic-evaluation",
      sourceDescriptor: "Frozen synthetic evaluation input",
      selectedPaths: ["."],
      limits: {
        maximumFileCount: 1,
        maximumFileBytes: 16384,
        maximumTotalBytes: 16384,
      },
    },
    approvedArchitecture: design.revision.architectureDocument,
    solutionRevision: design.manifest,
    catalog: awsCatalogArtifactV1,
  });
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    const path = join(root, ...source.path.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source.content, { encoding: "utf8", flag: "wx" });
    const importer = createRepositoryImportService({
      hclInspector: createPinnedTerraformHclInspector(input.compiler),
    });
    const result = await importer.importRepository({
      sourceDirectory: root,
      request,
    });
    const files = result.snapshot.files;
    if (
      files.length !== 1 ||
      files[0]?.path !== source.path ||
      files[0].checksum !== source.contentDigest ||
      result.snapshot.revision.commitSha !== source.commitSha ||
      (await readFile(path, "utf8")) !== source.content
    )
      throw Error("The frozen repository import changed its source.");
    return { evaluationCase, source, design, result };
  } finally {
    await removeOwnedRepositoryDirectory(root);
  }
}

async function removeOwnedRepositoryDirectory(root: string): Promise<void> {
  const target = resolve(root);
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !basename(target).startsWith(prefix)
  )
    throw Error(
      "The temporary repository input is outside its owned directory.",
    );
  await rm(target, { recursive: true, force: false });
}
