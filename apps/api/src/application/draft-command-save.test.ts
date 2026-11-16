import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  applyGraphCommand,
  parseArchitectureDocument,
  getArchitectureDocumentContentHash,
} from "@cloudmarkup/domain";
import type {
  GraphCommandV1,
  ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";
import {
  configurationKeySchema,
  operationIdSchema,
  serializeArchitectureDocumentV3,
} from "@cloudmarkup/schemas";
import type {
  ApplyDraftCommandV1,
  ProjectEditingLeaseProofV1,
} from "@cloudmarkup/api-contract";
import { createRepositoryBackedApplication } from "./repository-backed-application.js";
import { InMemoryObjectStore } from "../adapters/persistence/memory-object-store.js";
import {
  createDocumentStageInput,
  getArchitectureDocumentStorage,
} from "./architecture-document-storage.js";
import {
  RepositoryError,
  type CloudMarkupRepository,
  type DraftMetadataRecord,
  type StoredObjectState,
} from "./persistence.js";
import type { CloudMarkupApplication } from "./ports.js";
import { hasOnlyDraftPresentationChanges } from "./draft-document-identity.js";

const now = "2026-11-11T17:00:00.000Z";
async function fixture() {
  const document = parseArchitectureDocument(
    JSON.parse(
      await readFile(
        new URL(
          "../../../../packages/test-fixtures/fixtures/architecture-document/v1/valid/representative.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const principal = {
    authenticatedAt: now,
    authenticationSource: "local-development" as const,
    correlationId: "correlation_f1",
    expiresAt: "2026-11-12T17:00:00.000Z",
    principalId: "principal_f1",
    sessionId: "session_f1",
  };
  const scope = {
    ...principal,
    capabilities: ["projects.read", "projects.mutate"] as const,
    membershipId: "membership_f1",
    organizationId: "org_f1",
    roleKey: "owner" as const,
  };
  const lease: ProjectEditingLeaseProofV1 = {
    leaseId: "projectlease_11111111-1111-1111-1111-111111111111",
    token: "a".repeat(42) + "A",
  };
  const objectStore = new InMemoryObjectStore(),
    projectId = "project_f1";
  const staged = await objectStore.stage(
    scope,
    createDocumentStageInput({
      document,
      objectId: "object_f1_initial",
      organizationId: scope.organizationId,
      projectId,
    }),
  );
  await objectStore.publish(scope, staged);
  const objects = new Map<string, StoredObjectState>([
    [staged.objectId, { ...staged, lifecycleState: "published" }],
  ]);
  const storage = getArchitectureDocumentStorage(document);
  let metadata: DraftMetadataRecord = {
    contentSha256: storage.contentSha256,
    documentObjectId: staged.objectId,
    documentSchemaVersion: 3,
    draftId: required(document.revision.sourceDraftId),
    draftVersion: 1,
    organizationId: scope.organizationId,
    projectId,
    semanticSha256: storage.semanticSha256,
    visualSha256: storage.visualSha256,
  };
  const project = {
    createdAt: now,
    currentDraftId: metadata.draftId,
    lifecycleStatus: "active" as const,
    name: "F1 fixture",
    organizationId: scope.organizationId,
    projectId,
    recordVersion: 1,
    updatedAt: now,
  };
  const receipts = new Map<
    string,
    {
      request: string;
      key: string;
      commandId: string;
      metadata: DraftMetadataRecord;
      updatedAt: string;
    }
  >();
  let allowed = true;
  const updateDraft = vi.fn<CloudMarkupRepository["updateDraft"]>(
    (_scope, input, object, context) => {
      return Promise.resolve().then(() => {
        expect(context?.proof).toEqual(lease);
        if (input.expectedDraftVersion !== metadata.draftVersion)
          throw new RepositoryError("version-conflict", "Fixture stale write.");
        objects.set(object.objectId, {
          ...object,
          lifecycleState: "publication-pending",
        });
        metadata = {
          ...metadata,
          contentSha256: input.contentSha256,
          documentObjectId: object.objectId,
          draftVersion: metadata.draftVersion + 1,
          semanticSha256: input.semanticSha256,
          visualSha256: input.visualSha256,
        };
        if (input.command)
          receipts.set(input.command.commandId, {
            request: input.command.requestSha256,
            key: input.command.idempotencyKey,
            commandId: input.command.commandId,
            metadata: { ...metadata },
            updatedAt: now,
          });
        return metadata;
      });
    },
  );
  const repository = {
    resolveOrganizationScope: () =>
      Promise.resolve().then(() => (allowed ? scope : null)),
    getProject: () => Promise.resolve().then(() => project),
    getDraft: () => Promise.resolve().then(() => metadata),
    getObject: (_scope: unknown, objectId: string) =>
      Promise.resolve().then(() => objects.get(objectId) ?? null),
    updateDraft,
    getDraftCommand: (
      _scope: unknown,
      _projectId: string,
      command: {
        commandId: string;
        requestSha256: string;
        idempotencyKey: string;
      },
      context: { proof?: ProjectEditingLeaseProofV1 },
    ) => {
      return Promise.resolve().then(() => {
        if (JSON.stringify(context.proof) !== JSON.stringify(lease))
          throw new RepositoryError("access-denied", "Fixture lease refused.");
        const receipt = receipts.get(command.commandId);
        if (
          receipt &&
          (receipt.request !== command.requestSha256 ||
            receipt.key !== command.idempotencyKey)
        )
          throw new RepositoryError(
            "idempotency-conflict",
            "Fixture receipt differs.",
          );
        return receipt ?? null;
      });
    },
    markObjectPublished: (
      _scope: unknown,
      objectId: string,
      _version: unknown,
      context: { proof?: ProjectEditingLeaseProofV1 },
    ) => {
      return Promise.resolve().then(() => {
        expect(context.proof).toEqual(lease);
        objects.set(objectId, {
          ...required(objects.get(objectId)),
          lifecycleState: "published",
        });
      });
    },
  } as unknown as CloudMarkupRepository;
  const stage = vi.spyOn(objectStore, "stage");
  const app = createRepositoryBackedApplication({
    clock: () => new Date(now),
    draftEditingLeases: "required",
    fallback: {} as CloudMarkupApplication,
    identifierNamespace: "f1",
    objectStore,
    repository,
    organizationForProject: () =>
      Promise.resolve().then(() => scope.organizationId),
    organizationForRequestedScope: () =>
      Promise.resolve().then(() => scope.organizationId),
  });
  return {
    app,
    principal,
    lease,
    document,
    projectId,
    stage,
    updateDraft,
    deny: () => {
      allowed = false;
    },
    etag: () => `"draft:${metadata.draftId}:v${String(metadata.draftVersion)}"`,
    version: () => metadata.draftVersion,
  };
}
const envelope = (document: ArchitectureDocumentV3, id: string) => ({
  schemaVersion: 1 as const,
  commandId: operationIdSchema.parse(id),
  inverseCommandId: operationIdSchema.parse(id + "_inverse"),
  origin: "user" as const,
  target: {
    documentId: document.documentId,
    architectureId: document.architectureId,
    revisionId: document.revision.revisionId,
  },
});

describe("command-consistent draft persistence", () => {
  it("refuses semantic/provenance snapshots before staging while retaining presentation-only writes", async () => {
    const f = await fixture();
    const index = f.document.nodes.findIndex(
      (n) => n.semantic.lifecycle.ownership === "generated",
    );
    const candidates: ArchitectureDocumentV3[] = [];
    for (const change of [
      "configuration",
      "ownership",
      "catalog",
      "metadata",
    ] as const) {
      const candidate = structuredClone(f.document);
      if (change === "configuration")
        required(candidate.nodes[index]).semantic.configuration.values[
          configurationKeySchema.parse("instanceCount")
        ] = { kind: "integer", value: 3 };
      if (change === "ownership")
        required(candidate.nodes[index]).semantic.lifecycle = {
          ownership: "user",
          origin: "user",
        };
      if (change === "catalog")
        candidate.catalog.version =
          "99.0.0" as typeof candidate.catalog.version;
      if (change === "metadata")
        candidate.metadata.source =
          candidate.metadata.source === "user" ? "template" : "user";
      candidates.push(candidate);
    }
    for (const candidate of candidates)
      await expect(
        f.app.saveDraft(
          f.principal,
          f.projectId,
          {
            contractVersion: 1,
            editingLease: f.lease,
            architectureDocument: candidate,
          },
          f.etag(),
        ),
      ).rejects.toMatchObject({
        code: "unsupported_version",
        status: 422,
        fieldIssues: [{ code: "draft.command-history-required" }],
        conflict: { current: { etag: f.etag(), version: 1 } },
      });
    expect(f.stage).not.toHaveBeenCalled();
    expect(f.updateDraft).not.toHaveBeenCalled();
    expect(f.version()).toBe(1);
    const moved = structuredClone(f.document);
    required(moved.nodes[index]).presentation.label = "Reviewed label";
    required(moved.nodes[index]).presentation.position.x += 40;
    const saved = await f.app.saveDraft(
      f.principal,
      f.projectId,
      {
        contractVersion: 1,
        editingLease: f.lease,
        architectureDocument: moved,
      },
      f.etag(),
    );
    expect(
      serializeArchitectureDocumentV3(saved.value.architectureDocument),
    ).toBe(serializeArchitectureDocumentV3(moved));
    expect(f.updateDraft).toHaveBeenCalledTimes(1);
    const adopted = structuredClone(f.document);
    const lifecycle = required(adopted.nodes[index]).semantic.lifecycle;
    if (lifecycle.ownership !== "generated")
      throw new Error("Fixture must be generated.");
    required(adopted.nodes[index]).semantic.lifecycle = {
      ...lifecycle,
      ownership: "adopted",
      adoptedBy: "actor_f1" as never,
      adoptedAt: now as never,
    };
    const changedAudit = structuredClone(adopted);
    const audit = required(changedAudit.nodes[index]).semantic.lifecycle;
    if (audit.ownership !== "adopted")
      throw new Error("Fixture must be adopted.");
    audit.adoptedAt = "2026-11-11T17:01:00.000Z" as never;
    expect(getArchitectureDocumentContentHash(changedAudit)).toBe(
      getArchitectureDocumentContentHash(adopted),
    );
    expect(hasOnlyDraftPresentationChanges(adopted, changedAudit)).toBe(false);
  });

  it("uses authoritative command batches, exact undo and original-ETag receipt replay", async () => {
    const f = await fixture();
    const generated = structuredClone(
      required(
        f.document.nodes.find(
          (n) => n.semantic.lifecycle.ownership === "generated",
        ),
      ),
    );
    generated.id = "node_f1_support" as never;
    generated.semantic.deploymentKey = "f1_support" as never;
    if (generated.semantic.lifecycle.ownership !== "generated")
      throw new Error("Fixture must be generated.");
    generated.semantic.lifecycle.provenance.dependentEdgeIds = [];
    const add = {
      ...envelope(f.document, "command_f1_add"),
      kind: "add-node" as const,
      node: generated,
    };
    const initialTag = f.etag();
    const added = await f.app.applyDraftCommand(
      f.principal,
      f.projectId,
      { contractVersion: 1, command: add, editingLease: f.lease },
      initialTag,
      "request-f1-add-0001",
    );
    const inverse = applyGraphCommand(f.document, add).inversion;
    if (
      inverse.kind !== "available" ||
      inverse.command.kind !== "release-generated-resource"
    )
      throw new Error("Expected release inverse.");
    const replacement = structuredClone(generated);
    replacement.semantic.configuration.values[
      configurationKeySchema.parse("instanceCount")
    ] = {
      kind: "integer",
      value: 3,
    };
    const command: GraphCommandV1 = {
      ...envelope(f.document, "command_f1_replace"),
      kind: "batch",
      commands: [
        inverse.command,
        {
          ...envelope(f.document, "command_f1_readd"),
          kind: "add-node",
          node: replacement,
        },
      ],
    };
    const input: ApplyDraftCommandV1 = {
      contractVersion: 1,
      command,
      editingLease: f.lease,
    };
    const changed = await f.app.applyDraftCommand(
      f.principal,
      f.projectId,
      input,
      added.etag,
      "request-f1-replace-0001",
    );
    expect(
      changed.value.draft.architectureDocument.nodes.find(
        (n) => n.id === generated.id,
      )?.semantic,
    ).toEqual(replacement.semantic);
    const applied = applyGraphCommand(
      added.value.draft.architectureDocument,
      command,
    );
    if (applied.inversion.kind !== "available")
      throw new Error("Expected exact inverse.");
    const undone = await f.app.applyDraftCommand(
      f.principal,
      f.projectId,
      {
        contractVersion: 1,
        command: applied.inversion.command,
        editingLease: f.lease,
      },
      changed.etag,
      "request-f1-undo-0001",
    );
    expect(undone.value.draft.architectureDocument).toEqual(
      added.value.draft.architectureDocument,
    );
    const writes = f.updateDraft.mock.calls.length;
    expect(
      await f.app.applyDraftCommand(
        f.principal,
        f.projectId,
        input,
        added.etag,
        "request-f1-replace-0001",
      ),
    ).toEqual(changed);
    expect(f.updateDraft).toHaveBeenCalledTimes(writes);
    await expect(
      f.app.applyDraftCommand(
        f.principal,
        f.projectId,
        input,
        undone.etag,
        "request-f1-replace-0001",
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    await expect(
      f.app.applyDraftCommand(
        f.principal,
        f.projectId,
        { ...input, editingLease: { ...f.lease, token: "b".repeat(42) + "A" } },
        added.etag,
        "request-f1-replace-0001",
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    const { editingLease: _proof, ...withoutProof } = input;
    void _proof;
    await expect(
      f.app.applyDraftCommand(
        f.principal,
        f.projectId,
        withoutProof,
        added.etag,
        "request-f1-replace-0001",
      ),
    ).rejects.toMatchObject({ code: "precondition_required" });
    f.deny();
    await expect(
      f.app.applyDraftCommand(
        f.principal,
        f.projectId,
        input,
        added.etag,
        "request-f1-replace-0001",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(f.updateDraft).toHaveBeenCalledTimes(writes);
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error("Required synthetic fixture value is missing.");
  return value;
}
