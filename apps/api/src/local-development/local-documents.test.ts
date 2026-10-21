import { createHash } from "node:crypto";

import { serializeArchitectureDocumentV3 } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  createLocalArchitectureDocument,
  getLocalDocumentStorage,
  rebindLocalDraftCopy,
} from "./local-documents.js";
import {
  createSeedArchitectureDocument,
  LOCAL_PROJECT_SEEDS,
} from "./local-seed.js";

const CREATED_AT = "2026-08-15T12:00:00.000Z";

describe("credentialless local Architecture Document fixtures", () => {
  it("defines exactly the notes API, infrastructure-only, and workload projects", () => {
    expect(LOCAL_PROJECT_SEEDS.map((seed) => seed.name)).toEqual([
      "notes-api",
      "infrastructure-only",
      "workload",
    ]);

    const documents = LOCAL_PROJECT_SEEDS.map((seed) => ({
      document: createSeedArchitectureDocument(seed),
      seed,
    }));
    expect(
      documents
        .filter(({ seed }) => !seed.infrastructureOnly)
        .every(
          ({ document }) => document.workloadBehavior.workloads.length > 0,
        ),
    ).toBe(true);
    expect(
      documents.find(({ seed }) => seed.infrastructureOnly)?.document
        .workloadBehavior.workloads,
    ).toEqual([]);
    expect(
      new Set(documents.map(({ document }) => document.schemaVersion)),
    ).toEqual(new Set([3]));
  });

  it("uses canonical document bytes and exact storage digests", () => {
    const document = createSeedArchitectureDocument(LOCAL_PROJECT_SEEDS[0]);
    const storage = getLocalDocumentStorage(document);
    expect(new TextDecoder().decode(storage.bytes)).toBe(
      serializeArchitectureDocumentV3(document),
    );
    expect(storage.contentSha256).toBe(
      createHash("sha256").update(storage.bytes).digest("hex"),
    );
    expect(storage.semanticSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.visualSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rebinds a save-as-copy document to new server identities", () => {
    const source = createSeedArchitectureDocument(LOCAL_PROJECT_SEEDS[0]);
    const copied = rebindLocalDraftCopy({
      architectureDocument: source,
      createdAt: CREATED_AT,
      identity: {
        architectureId: "architecture_copy",
        documentId: "document_copy",
        draftId: "draft_copy",
        principalId: "principal_copy",
        revisionId: "document_revision_copy",
      },
    });

    expect(copied.documentId).toBe("document_copy");
    expect(copied.architectureId).toBe("architecture_copy");
    expect(copied.revision).toEqual({
      createdAt: CREATED_AT,
      createdBy: "principal_copy",
      revisionId: "document_revision_copy",
      revisionNumber: 1,
      sourceDraftId: "draft_copy",
    });
    expect(copied.applicationContracts).toMatchObject({
      contractSetId: "architecture_copy",
      documentId: "document_copy",
      revision: {
        createdAt: CREATED_AT,
        createdBy: "principal_copy",
        revisionId: "document_revision_copy",
        revisionNumber: 1,
      },
    });
    expect(copied.externalResources).toMatchObject({
      architectureId: "architecture_copy",
      documentId: "document_copy",
      revision: {
        createdAt: CREATED_AT,
        createdBy: "principal_copy",
        revisionId: "document_revision_copy",
        revisionNumber: 1,
      },
    });
    expect(copied.nodes).toEqual(source.nodes);
    expect(copied.workloadBehavior).toEqual(source.workloadBehavior);
  });

  it("builds a blank local project as infrastructure-only", () => {
    const document = createLocalArchitectureDocument({
      createdAt: CREATED_AT,
      identity: {
        architectureId: "architecture_blank",
        documentId: "document_blank",
        draftId: "draft_blank",
        principalId: "principal_blank",
        revisionId: "document_revision_blank",
      },
      infrastructureOnly: true,
      blank: true,
    });
    expect(document.schemaVersion).toBe(3);
    expect(document.workloadBehavior).toEqual({
      contractVersion: 2,
      workloads: [],
    });
    expect(document.nodes).toEqual([]);
    expect(document.edges).toEqual([]);
  });
});
