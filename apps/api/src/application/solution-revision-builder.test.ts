import { acceptedIntentV1Schema } from "@cloudmarkup/api-contract";
import { parseIntentDocument } from "@cloudmarkup/domain";
import { testIntent } from "@cloudmarkup/model-gateway/testing";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { readFileSync } from "node:fs";

import { revisionV1Schema } from "@cloudmarkup/api-contract";
import {
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getWorkloadBehaviorContentHash,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import {
  buildSolutionRevisionV1,
  solutionRevisionToolSelectionsV1Schema,
} from "./solution-revision-builder.js";

const CREATED_AT = "2026-08-15T12:00:00.000Z";
const DIGEST = `sha256:${"0".repeat(64)}`;

function infrastructureOnlyRevision() {
  const document = parseArchitectureDocument({
    architectureId: "architecture_local",
    assumptions: [
      {
        id: "assumption_local",
        origin: "user",
        statement: "The service remains infrastructure-only.",
        status: "accepted",
      },
    ],
    catalog: {
      digest: DIGEST,
      id: "aws.cloudmarkup",
      version: "1.0.0",
    },
    compilerCompatibility: {
      inputContractVersion: 1,
      minimumCompilerVersion: "1.0.0",
    },
    documentId: "document_local",
    edges: [],
    kind: "cloudmarkup.architecture-document",
    metadata: {
      serialization: {
        canonicalization: "cloudmarkup.canonical-json.v1",
        encoding: "utf-8",
        mediaType: "application/json",
      },
      source: "user",
    },
    nodes: [],
    outputs: [],
    provider: { id: "aws.cloudmarkup", region: "us-east-1" },
    revision: {
      createdAt: CREATED_AT,
      createdBy: "principal_local",
      revisionId: "document_revision_local",
      revisionNumber: 1,
      sourceDraftId: "draft_local",
    },
    schemaVersion: 2,
    unresolvedRequirements: [],
    variables: [],
    workloadBehavior: { contractVersion: 1, workloads: [] },
  });

  return revisionV1Schema.parse({
    architectureDocument: document,
    catalogDigest: document.catalog.digest,
    catalogId: document.catalog.id,
    catalogVersion: document.catalog.version,
    contentDigest: getArchitectureDocumentCanonicalHash(document),
    createdAt: CREATED_AT,
    createdBy: { displayName: "Local Owner", id: "principal_local" },
    documentDigest: getArchitectureDocumentCanonicalHash(document),
    graphSchemaVersion: 1,
    id: "revision_local",
    name: "Infrastructure baseline",
    projectId: "project_local",
    sourceDraftId: "draft_local",
    sourceDraftVersion: 1,
    storageStatus: "published",
    workloadBehaviorVersion: 2,
  });
}

function sourceOwnershipRevision() {
  const source = JSON.parse(
    readFileSync(
      new URL(
        "../../../../packages/test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as unknown;
  const baseDocument = parseArchitectureDocument(source);
  const workload = baseDocument.workloadBehavior.workloads[0];
  if (workload === undefined) {
    throw new TypeError("Representative document must include a Workload.");
  }
  const document = parseArchitectureDocument({
    ...baseDocument,
    workloadBehavior: {
      ...baseDocument.workloadBehavior,
      workloads: [
        {
          ...workload,
          sourceOwnership: [
            {
              baselineDigest: DIGEST,
              conflictBehavior: "fail-closed",
              declarationId: "ownership_generated_file",
              ownerId: "generator.application",
              ownership: "generated",
              path: "application/src/generated.ts",
              pathKind: "file",
              regeneration: "replace-when-baseline-matches",
              semanticDiff: { strategy: "byte-exact" },
            },
            {
              conflictBehavior: "preserve-user-content",
              declarationId: "ownership_user_directory",
              ownerId: "user.application",
              ownership: "user-owned",
              path: "application/manual",
              pathKind: "directory",
              regeneration: "never",
              semanticDiff: { strategy: "byte-exact" },
            },
            {
              conflictBehavior: "require-reviewed-resolution",
              declarationId: "ownership_ai_file",
              ownerId: "extension.application",
              ownership: "ai-authored",
              path: "application/src/ai.ts",
              pathKind: "file",
              regeneration: "require-reviewed-operation",
              semanticDiff: { strategy: "structured-language" },
            },
            {
              baselineDigest: DIGEST,
              conflictBehavior: "preserve-user-content",
              declarationId: "ownership_user_file",
              ownerId: "user.application",
              ownership: "user-owned",
              path: "application/src/user.ts",
              pathKind: "file",
              regeneration: "never",
              semanticDiff: { strategy: "structured-language" },
            },
          ],
        },
        ...baseDocument.workloadBehavior.workloads.slice(1),
      ],
    },
  });
  const documentDigest = getArchitectureDocumentCanonicalHash(document);
  return revisionV1Schema.parse({
    architectureDocument: document,
    catalogDigest: document.catalog.digest,
    catalogId: document.catalog.id,
    catalogVersion: document.catalog.version,
    contentDigest: documentDigest,
    createdAt: document.revision.createdAt,
    createdBy: {
      displayName: "Source Ownership Owner",
      id: "principal_source_ownership",
    },
    documentDigest,
    graphSchemaVersion: 1,
    id: "revision_source_ownership",
    name: "Source ownership baseline",
    projectId: "project_source_ownership",
    sourceDraftId: document.revision.sourceDraftId,
    sourceDraftVersion: document.revision.revisionNumber,
    storageStatus: "published",
    workloadBehaviorVersion: 2,
  });
}

describe("buildSolutionRevisionV1", () => {
  it("freezes exact document, Workload, contract, assumption, and infrastructure-only coverage bindings", () => {
    const revision = infrastructureOnlyRevision();
    const solutionRevision = buildSolutionRevisionV1({
      name: "Infrastructure baseline",
      revision,
      solutionRevisionId: "solution_revision_local",
    });

    expect(solutionRevision.manifest.architecture).toMatchObject({
      documentHash: getArchitectureDocumentCanonicalHash(
        revision.architectureDocument,
      ),
      revisionId: revision.id,
      schemaVersion: 3,
    });
    expect(solutionRevision.manifest.workload).toEqual({
      contentHash: getWorkloadBehaviorContentHash(
        revision.architectureDocument.workloadBehavior,
      ),
      contractVersion: 2,
    });
    expect(solutionRevision.manifest.contracts).toMatchObject({
      contentHash: getApplicationContractsContentHash(
        revision.architectureDocument.applicationContracts,
      ),
      contractVersion: 1,
      recordHashes: [],
    });
    expect(solutionRevision.manifest.assumptions).toEqual(["assumption_local"]);
    expect(solutionRevision.summary.generationCoverage).toMatchObject({
      missingRequirements: [],
      solutionRevisionId: "solution_revision_local",
      state: "infrastructure-only",
      workloads: [],
    });
  });

  it("freezes exact file ownership without pre-accepting candidate extensions", () => {
    const revision = sourceOwnershipRevision();
    const solutionRevision = buildSolutionRevisionV1({
      name: "Source ownership baseline",
      revision,
      solutionRevisionId: "solution_revision_source_ownership",
    });

    expect(solutionRevision.manifest.aiExtensionIds).toEqual([]);
    expect(solutionRevision.manifest.sourceOwnership).toEqual([
      {
        conflictBehavior: "semantic-diff-and-review",
        ownerId: "extension.application",
        ownership: "ai-authored",
        path: "application/src/ai.ts",
      },
      {
        conflictBehavior: "replace-exact-owned-content",
        contentHash: DIGEST,
        ownerId: "generator.application",
        ownership: "generated",
        path: "application/src/generated.ts",
      },
      {
        conflictBehavior: "preserve-user-content",
        contentHash: DIGEST,
        ownerId: "user.application",
        ownership: "user-owned",
        path: "application/src/user.ts",
      },
    ]);
    expect(
      solutionRevision.manifest.sourceOwnership.some(
        ({ path }) => path === "application/manual",
      ),
    ).toBe(false);
  });
});

describe("accepted Intent revision binding", () => {
  function fixture() {
    const revision = infrastructureOnlyRevision();
    const intentDocument = parseIntentDocument(testIntent);
    const acceptedIntent = acceptedIntentV1Schema.parse({
      contractVersion: 1,
      acceptedIntentId: "accepted_intent_" + "a".repeat(48),
      projectId: revision.projectId,
      createdAt: CREATED_AT,
      createdByPrincipalId: revision.createdBy.id,
      sourceDraftId: revision.sourceDraftId,
      sourceDraftVersion: revision.sourceDraftVersion,
      invocationId: "preview_test_binding",
      outputDigest: DIGEST,
      intentDigest: digestCanonicalValue(intentDocument),
      intentDocument,
    });
    return {
      revision,
      acceptedIntent,
      name: "Accepted requirements",
      solutionRevisionId: "solution_revision_intent",
    };
  }
  it("includes only the exact immutable accepted record identity, version and digest", () => {
    const f = fixture(),
      result = buildSolutionRevisionV1(f);
    expect(result.manifest.intent).toEqual({
      state: "included",
      id: f.acceptedIntent.acceptedIntentId,
      version: 1,
      contentHash: f.acceptedIntent.intentDigest,
    });
    expect(result.revision).toEqual(f.revision);
  });
  it.each(["project", "draft", "future-version", "digest"])(
    "rejects %s mismatches",
    (change) => {
      const f = fixture();
      if (change === "project") f.acceptedIntent.projectId = "project_other";
      if (change === "draft") f.acceptedIntent.sourceDraftId = "draft_other";
      if (change === "future-version") f.acceptedIntent.sourceDraftVersion++;
      if (change === "digest")
        f.acceptedIntent.intentDigest = "sha256:" + "b".repeat(64);
      expect(() => buildSolutionRevisionV1(f)).toThrow("accepted Intent");
    },
  );
});

describe("frozen export tool selection", () => {
  it("pins the selected tools without fabricating execution or changing coverage", () => {
    const input = {
      name: "Export baseline",
      revision: infrastructureOnlyRevision(),
      solutionRevisionId: "solution_revision_tools",
    };
    const baseline = buildSolutionRevisionV1(input);
    const selectedTools = solutionRevisionToolSelectionsV1Schema.parse({
      compiler: {
        state: "pinned",
        tool: {
          id: "cloudmarkup.iac-compiler",
          version: "1.1.0",
          digest: DIGEST,
        },
      },
      diagramRenderer: {
        state: "pinned",
        tool: {
          id: "cloudmarkup.diagram-renderer",
          version: "1.1.0",
          digest: DIGEST,
        },
      },
    });
    const selected = buildSolutionRevisionV1({ ...input, selectedTools });
    expect(selected.manifest.versions.compiler).toEqual(selectedTools.compiler);
    expect(selected.manifest.versions.diagramRenderer).toEqual(
      selectedTools.diagramRenderer,
    );
    expect(selected.manifest.generationCoverage).toEqual(
      baseline.manifest.generationCoverage,
    );
    expect(selected.manifest.evidenceIdsAtFreeze).toEqual([]);
    expect(selected.manifest.generationCoverage.evidence).toEqual([]);
    expect({
      ...selected.manifest,
      versions: baseline.manifest.versions,
    }).toEqual(baseline.manifest);
    expect(selected.manifest.versions.compiler).not.toBe(
      selectedTools.compiler,
    );
    expect(() =>
      buildSolutionRevisionV1({
        ...input,
        selectedTools: {
          ...selectedTools,
          compiler: {
            ...selectedTools.compiler,
            state: "pinned",
            tool: { id: "invalid id", version: "1.1.0", digest: DIGEST },
          },
        } as never,
      }),
    ).toThrow();
  });
});
