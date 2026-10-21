import { createHash } from "node:crypto";

import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import { InMemoryObjectStore } from "../adapters/persistence/memory-object-store.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "../adapters/persistence/sql.js";
import {
  createInitialArchitectureDocument,
  getArchitectureDocumentStorage,
} from "../application/architecture-document-storage.js";
import type {
  AuthorizedOrganizationScope,
  CloudMarkupRepository,
  DraftMetadataRecord,
  ObjectStore,
  StoredObjectReference,
  StoredObjectState,
} from "../application/persistence.js";
import type { CompleteDeterministicValidationInput } from "../application/revision-validation.js";
import { LocalDeterministicValidationBridge } from "./local-validation-bridge.js";

const scope = {
  capabilities: ["projects.read", "projects.mutate", "revisions.create"],
  correlationId: "correlation_local_validation_test",
  membershipId: "membership_local_owner",
  organizationId: "org_local",
  principalId: "principal_local_owner",
  roleKey: "owner",
  sessionId: "session_local_validation_test",
} as const satisfies AuthorizedOrganizationScope;

const projectId = "project_local_infrastructure_only";
const draftId = "draft_local_infrastructure_only";

function validDocumentStorage(principalId: string = scope.principalId) {
  return getArchitectureDocumentStorage(
    createInitialArchitectureDocument({
      blank: true,
      identity: {
        architectureId: "architecture_local_validation",
        documentId: "document_local_validation",
        draftId,
        principalId,
        revisionId: "revision_local_validation_draft",
      },
      infrastructureOnly: true,
    }),
  );
}

function validationInput(
  metadata: DraftMetadataRecord,
  validationRunId = "validation_local_restart_test",
): CompleteDeterministicValidationInput {
  return {
    contentSha256: metadata.contentSha256,
    draftId: metadata.draftId,
    draftVersion: metadata.draftVersion,
    projectId: metadata.projectId,
    semanticSha256: metadata.semanticSha256,
    validationRunId,
    visualSha256: metadata.visualSha256,
  };
}

async function seedDraft(
  objectStore: InMemoryObjectStore,
  bytes: Uint8Array,
  digests: {
    readonly semanticSha256: string;
    readonly visualSha256: string;
  },
): Promise<{
  readonly input: CompleteDeterministicValidationInput;
  readonly metadata: DraftMetadataRecord;
  readonly object: StoredObjectState;
}> {
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const reference = await objectStore.stage(scope, {
    contentSha256,
    mediaType: "application/json",
    objectId: "object_local_validation_draft",
    open: async function* open(): AsyncIterable<Uint8Array> {
      yield bytes;
      await Promise.resolve();
    },
    owner: { organizationId: scope.organizationId, projectId },
    purpose: "architecture-draft",
    sizeBytes: bytes.byteLength,
  });
  await objectStore.publish(scope, reference);
  const metadata: DraftMetadataRecord = {
    contentSha256,
    documentObjectId: reference.objectId,
    documentSchemaVersion: 3,
    draftId,
    draftVersion: 1,
    organizationId: scope.organizationId,
    projectId,
    semanticSha256: digests.semanticSha256,
    visualSha256: digests.visualSha256,
  };
  return {
    input: validationInput(metadata),
    metadata,
    object: { ...reference, lifecycleState: "published" },
  };
}

function repositoryFixture(
  metadata: DraftMetadataRecord,
  object: StoredObjectState,
  markObjectPublished = vi.fn(() => Promise.resolve()),
  resolveAdditionalObject: (
    objectId: string,
  ) => StoredObjectState | null = () => null,
) {
  const getDraft = vi.fn(() => Promise.resolve(metadata));
  const getObject = vi.fn(
    (_scope: AuthorizedOrganizationScope, objectId: string) =>
      Promise.resolve(
        objectId === object.objectId
          ? object
          : resolveAdditionalObject(objectId),
      ),
  );
  return {
    getDraft,
    getObject,
    markObjectPublished,
    repository: {
      getDraft,
      getObject,
      markObjectPublished,
    } as unknown as CloudMarkupRepository,
  };
}

function persistenceMustNotRun() {
  const query = vi.fn(() =>
    Promise.reject(new Error("Invalid draft queried validation persistence.")),
  );
  const transaction = vi.fn(() =>
    Promise.reject(new Error("Invalid draft opened a transaction.")),
  );
  return {
    database: {
      close: () => Promise.resolve(),
      query: query as unknown as SqlDatabase["query"],
      transaction: transaction as unknown as SqlDatabase["transaction"],
    } satisfies SqlDatabase,
    query,
    transaction,
  };
}

async function readAll(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function expectRejectedBeforeEvidence(input: {
  readonly bridgeInput: CompleteDeterministicValidationInput;
  readonly database: SqlDatabase;
  readonly markObjectPublished: ReturnType<typeof vi.fn>;
  readonly objectStore: ObjectStore;
  readonly repository: CloudMarkupRepository;
  readonly stage: ReturnType<typeof vi.fn>;
  readonly transaction: ReturnType<typeof vi.fn>;
}): Promise<void> {
  const bridge = new LocalDeterministicValidationBridge({
    database: input.database,
    objectStore: input.objectStore,
    repository: input.repository,
  });
  await expect(
    bridge.ensureComplete(scope, input.bridgeInput),
  ).rejects.toMatchObject({ code: "persistence-unavailable" });
  expect(input.transaction).not.toHaveBeenCalled();
  expect(input.stage).not.toHaveBeenCalled();
  expect(input.markObjectPublished).not.toHaveBeenCalled();
}

describe("local deterministic validation evidence bridge", () => {
  it("denies validation before repository or persistence access when revision authority is absent", async () => {
    const queryCalled = vi.fn();
    const query: SqlDatabase["query"] = <TRow extends SqlRow = SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> => {
      queryCalled(statement);
      return Promise.reject(
        new Error("Denied validation queried persistence."),
      );
    };
    const database: SqlDatabase = {
      close: () => Promise.resolve(),
      query,
      transaction: <TResult>() =>
        Promise.reject<TResult>(
          new Error("Denied validation opened a transaction."),
        ),
    };
    const getDraft = vi.fn();
    const getObject = vi.fn();
    const markObjectPublished = vi.fn();
    const bridge = new LocalDeterministicValidationBridge({
      database,
      objectStore: new InMemoryObjectStore(),
      repository: {
        getDraft,
        getObject,
        markObjectPublished,
      } as unknown as CloudMarkupRepository,
    });

    await expect(
      bridge.ensureComplete(
        {
          capabilities: ["projects.read"],
          correlationId: "correlation_validation_denied",
          membershipId: "membership_viewer",
          organizationId: "org_local",
          principalId: "principal_viewer",
          roleKey: "viewer",
          sessionId: "session_validation_denied",
        },
        {
          contentSha256: "1".repeat(64),
          draftId: "draft_local_denied",
          draftVersion: 1,
          projectId: "project_local_denied",
          semanticSha256: "2".repeat(64),
          validationRunId: "validation_local_denied",
          visualSha256: "3".repeat(64),
        },
      ),
    ).rejects.toMatchObject({ code: "access-denied" });
    expect(getDraft).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
    expect(queryCalled).not.toHaveBeenCalled();
    expect(markObjectPublished).not.toHaveBeenCalled();
  });

  it("validates canonical stored bytes before publishing exact evidence and replays safely", async () => {
    const events: string[] = [];
    let storedObjectPublished = false;
    let validation:
      | {
          readonly draftId: string;
          readonly draftVersion: number;
          readonly objectId: string;
          readonly reportSha256: string;
          readonly runId: string;
        }
      | undefined;
    const objectStore = new InMemoryObjectStore();
    const storage = validDocumentStorage();
    const fixture = await seedDraft(objectStore, storage.bytes, storage);
    let validationObject: StoredObjectReference | undefined;
    const originalStage = objectStore.stage.bind(objectStore);
    vi.spyOn(objectStore, "stage").mockImplementation(
      async (stageScope, input) => {
        const object = await originalStage(stageScope, input);
        if (input.purpose === "validation-report") {
          validationObject = object;
        }
        return object;
      },
    );

    const query = async <TRow extends SqlRow = SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> => {
      await Promise.resolve();
      if (
        statement.text.includes("SELECT 1") &&
        statement.text.includes("architecture_drafts")
      ) {
        events.push("authorized-exact-draft");
        expect(statement.values.slice(3)).toEqual([
          projectId,
          draftId,
          1,
          storage.contentSha256,
          storage.semanticSha256,
          storage.visualSha256,
          fixture.object.objectId,
          fixture.object.objectVersion,
          fixture.object.sizeBytes,
          3,
        ]);
        return { rowCount: 1, rows: [{} as TRow] };
      }
      if (
        statement.text.includes("FROM validation_runs v") &&
        statement.text.includes("SELECT v.validation_run_id")
      ) {
        events.push("read-validation");
        return validation === undefined
          ? { rowCount: 0, rows: [] }
          : {
              rowCount: 1,
              rows: [
                {
                  content_sha256: storage.contentSha256,
                  document_object_id: fixture.object.objectId,
                  document_schema_version: 3,
                  draft_id: validation.draftId,
                  draft_version: validation.draftVersion,
                  lifecycle_status: "succeeded",
                  organization_id: scope.organizationId,
                  project_id: projectId,
                  report_object_id: validation.objectId,
                  report_sha256: validation.reportSha256,
                  semantic_sha256: storage.semanticSha256,
                  validation_run_id: validation.runId,
                  visual_sha256: storage.visualSha256,
                } as unknown as TRow,
              ],
            };
      }
      if (statement.text.includes("INSERT INTO stored_objects")) {
        events.push("insert-pending-object");
        return { rowCount: 1, rows: [] };
      }
      if (statement.text.includes("INSERT INTO validation_runs")) {
        events.push("insert-running-validation");
        validation = {
          draftId: String(statement.values[3]),
          draftVersion: Number(statement.values[4]),
          objectId: String(statement.values[5]),
          reportSha256: String(statement.values[6]),
          runId: String(statement.values[0]),
        };
        return { rowCount: 1, rows: [] };
      }
      if (statement.text.includes("UPDATE validation_runs v")) {
        events.push("complete-validation");
        return {
          rowCount: storedObjectPublished ? 1 : 0,
          rows: [],
        };
      }
      throw new Error(`Unexpected local validation SQL: ${statement.text}`);
    };
    const executor: SqlExecutor = { query };
    const database: SqlDatabase = {
      close: () => Promise.resolve(),
      query,
      transaction: <TResult>(
        work: (transaction: SqlExecutor) => Promise<TResult>,
      ) => work(executor),
    };
    const markObjectPublished = vi.fn().mockImplementation(async () => {
      await Promise.resolve();
      events.push("publish-object-metadata");
      storedObjectPublished = true;
    });
    const repository = repositoryFixture(
      fixture.metadata,
      fixture.object,
      markObjectPublished,
      (objectId) =>
        validationObject?.objectId === objectId
          ? {
              ...validationObject,
              lifecycleState: storedObjectPublished
                ? "published"
                : "publication-pending",
            }
          : null,
    );
    const bridge = new LocalDeterministicValidationBridge({
      database,
      objectStore,
      repository: repository.repository,
    });

    await bridge.ensureComplete(scope, fixture.input);
    expect(events).toEqual([
      "authorized-exact-draft",
      "read-validation",
      "insert-pending-object",
      "insert-running-validation",
      "publish-object-metadata",
      "complete-validation",
    ]);
    if (validationObject === undefined) {
      throw new Error("The validation report object was not staged.");
    }
    const report: unknown = JSON.parse(
      new TextDecoder().decode(
        await readAll(await objectStore.open(scope, validationObject)),
      ),
    );
    expect(report).toMatchObject({
      checks: [
        "architecture-document-v3-schema",
        "provider-neutral-semantic-invariants",
        "canonical-storage-encoding",
        "exact-draft-identity",
        "published-object-metadata",
        "exact-digest-binding",
      ],
      complete: true,
      document: {
        contentHash: `sha256:${storage.contentSha256}`,
        semanticHash: `sha256:${storage.semanticSha256}`,
        visualHash: `sha256:${storage.visualSha256}`,
      },
      source: {
        draft: {
          documentObjectId: fixture.object.objectId,
          documentSchemaVersion: 3,
        },
        object: {
          objectId: fixture.object.objectId,
          objectVersion: fixture.object.objectVersion,
          sizeBytes: storage.bytes.byteLength,
        },
      },
    });

    events.length = 0;
    await bridge.ensureComplete(scope, fixture.input);
    expect(events).toEqual([
      "authorized-exact-draft",
      "read-validation",
      "complete-validation",
    ]);
    expect(repository.getDraft).toHaveBeenCalledTimes(2);
    expect(repository.getObject).toHaveBeenCalledTimes(4);
    expect(markObjectPublished).toHaveBeenCalledTimes(1);
  });

  it("does not mark validation succeeded when the exact draft changes during report publication", async () => {
    const objectStore = new InMemoryObjectStore();
    const storage = validDocumentStorage();
    const fixture = await seedDraft(objectStore, storage.bytes, storage);
    const transactionQuery = async <TRow extends SqlRow = SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> => {
      await Promise.resolve();
      if (statement.text.includes("SELECT 1")) {
        return { rowCount: 1, rows: [{} as TRow] };
      }
      if (statement.text.includes("SELECT v.validation_run_id")) {
        return { rowCount: 0, rows: [] };
      }
      if (
        statement.text.includes("INSERT INTO stored_objects") ||
        statement.text.includes("INSERT INTO validation_runs")
      ) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(
        `Unexpected validation transaction SQL: ${statement.text}`,
      );
    };
    let completionStatement: SqlStatement | undefined;
    const query = async <TRow extends SqlRow = SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> => {
      await Promise.resolve();
      completionStatement = statement;
      return { rowCount: 0, rows: [] };
    };
    const executor: SqlExecutor = { query: transactionQuery };
    const database: SqlDatabase = {
      close: () => Promise.resolve(),
      query,
      transaction: <TResult>(
        work: (transaction: SqlExecutor) => Promise<TResult>,
      ) => work(executor),
    };
    const markObjectPublished = vi.fn(() => Promise.resolve());
    const repository = repositoryFixture(
      fixture.metadata,
      fixture.object,
      markObjectPublished,
    );
    const bridge = new LocalDeterministicValidationBridge({
      database,
      objectStore,
      repository: repository.repository,
    });

    await expect(
      bridge.ensureComplete(scope, fixture.input),
    ).rejects.toMatchObject({ code: "persistence-unavailable" });
    expect(markObjectPublished).toHaveBeenCalledTimes(1);
    expect(completionStatement?.text).toContain(
      "d.pending_document_object_id IS NULL",
    );
    expect(completionStatement?.text).toContain(
      "d.draft_version = v.draft_version",
    );
    expect(completionStatement?.text).toContain(
      "source_object.object_version = $13",
    );
    expect(completionStatement?.values.slice(7)).toEqual([
      3,
      fixture.object.objectId,
      storage.contentSha256,
      storage.semanticSha256,
      storage.visualSha256,
      fixture.object.objectVersion,
      fixture.object.sizeBytes,
      expect.any(String),
      expect.any(Number),
    ]);
  });

  it("rejects malformed stored bytes before validation persistence or evidence publication", async () => {
    const objectStore = new InMemoryObjectStore();
    const fixture = await seedDraft(
      objectStore,
      new TextEncoder().encode('{"schemaVersion":3}'),
      {
        semanticSha256: "2".repeat(64),
        visualSha256: "3".repeat(64),
      },
    );
    const stage = vi.spyOn(objectStore, "stage");
    stage.mockClear();
    const persistence = persistenceMustNotRun();
    const markObjectPublished = vi.fn(() => Promise.resolve());
    const repository = repositoryFixture(
      fixture.metadata,
      fixture.object,
      markObjectPublished,
    );

    await expectRejectedBeforeEvidence({
      bridgeInput: fixture.input,
      database: persistence.database,
      markObjectPublished,
      objectStore,
      repository: repository.repository,
      stage,
      transaction: persistence.transaction,
    });
  });

  it("rejects schema-valid bytes that violate domain semantics before evidence publication", async () => {
    const document = createInitialArchitectureDocument({
      identity: {
        architectureId: "architecture_local_validation",
        documentId: "document_local_validation",
        draftId,
        principalId: scope.principalId,
        revisionId: "revision_local_validation_draft",
      },
      infrastructureOnly: true,
    });
    const firstNode = document.nodes[0];
    if (firstNode === undefined) {
      throw new Error("The semantic validation fixture requires one node.");
    }
    const bytes = new TextEncoder().encode(
      serializeCanonicalJson({
        ...document,
        nodes: [...document.nodes, firstNode],
      }),
    );
    const objectStore = new InMemoryObjectStore();
    const fixture = await seedDraft(objectStore, bytes, {
      semanticSha256: "2".repeat(64),
      visualSha256: "3".repeat(64),
    });
    const stage = vi.spyOn(objectStore, "stage");
    stage.mockClear();
    const persistence = persistenceMustNotRun();
    const markObjectPublished = vi.fn(() => Promise.resolve());
    const repository = repositoryFixture(
      fixture.metadata,
      fixture.object,
      markObjectPublished,
    );

    await expectRejectedBeforeEvidence({
      bridgeInput: fixture.input,
      database: persistence.database,
      markObjectPublished,
      objectStore,
      repository: repository.repository,
      stage,
      transaction: persistence.transaction,
    });
  });

  it("rejects valid but noncanonical stored JSON before validation persistence or evidence publication", async () => {
    const objectStore = new InMemoryObjectStore();
    const storage = validDocumentStorage();
    const noncanonicalBytes = new TextEncoder().encode(
      JSON.stringify(storage.document, undefined, 2),
    );
    const fixture = await seedDraft(objectStore, noncanonicalBytes, storage);
    const stage = vi.spyOn(objectStore, "stage");
    stage.mockClear();
    const persistence = persistenceMustNotRun();
    const markObjectPublished = vi.fn(() => Promise.resolve());
    const repository = repositoryFixture(
      fixture.metadata,
      fixture.object,
      markObjectPublished,
    );

    await expectRejectedBeforeEvidence({
      bridgeInput: fixture.input,
      database: persistence.database,
      markObjectPublished,
      objectStore,
      repository: repository.repository,
      stage,
      transaction: persistence.transaction,
    });
  });

  it("rejects stored bytes that do not match caller, draft, and object digests before success", async () => {
    const expected = validDocumentStorage("principal_local_alpha");
    const different = validDocumentStorage("principal_local_bravo");
    expect(different.bytes.byteLength).toBe(expected.bytes.byteLength);
    const object: StoredObjectState = {
      contentSha256: expected.contentSha256,
      entityTag: `"${expected.contentSha256}"`,
      lifecycleState: "published",
      mediaType: "application/json",
      objectId: "object_local_validation_draft",
      objectVersion: `sha256-${expected.contentSha256}`,
      owner: { organizationId: scope.organizationId, projectId },
      purpose: "architecture-draft",
      sizeBytes: expected.bytes.byteLength,
      storageKey: "stored/draft/object",
      storageProvider: "memory",
    };
    const metadata: DraftMetadataRecord = {
      contentSha256: expected.contentSha256,
      documentObjectId: object.objectId,
      documentSchemaVersion: 3,
      draftId,
      draftVersion: 1,
      organizationId: scope.organizationId,
      projectId,
      semanticSha256: expected.semanticSha256,
      visualSha256: expected.visualSha256,
    };
    const stage = vi.fn(() =>
      Promise.reject(
        new Error("Digest-mismatched bytes staged validation evidence."),
      ),
    );
    const objectStore = {
      discardStaged: () => Promise.reject(new Error("Unexpected discard.")),
      head: () => Promise.reject(new Error("Unexpected head.")),
      open: () =>
        Promise.resolve(
          (async function* open(): AsyncIterable<Uint8Array> {
            yield different.bytes;
            await Promise.resolve();
          })(),
        ),
      publish: () => Promise.reject(new Error("Unexpected publish.")),
      requestDeletion: () => Promise.reject(new Error("Unexpected delete.")),
      stage,
    } satisfies ObjectStore;
    const persistence = persistenceMustNotRun();
    const markObjectPublished = vi.fn(() => Promise.resolve());
    const repository = repositoryFixture(metadata, object, markObjectPublished);

    await expectRejectedBeforeEvidence({
      bridgeInput: validationInput(metadata),
      database: persistence.database,
      markObjectPublished,
      objectStore,
      repository: repository.repository,
      stage,
      transaction: persistence.transaction,
    });
  });
});
