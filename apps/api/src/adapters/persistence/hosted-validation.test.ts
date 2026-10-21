import { createHash } from "node:crypto";

import type { CreateValidationRunV1 } from "@cloudmarkup/api-contract";
import { parseArchitectureDocument } from "@cloudmarkup/domain";
import {
  AWS_CATALOG_DIGEST_V1,
  awsCatalogV1,
} from "@cloudmarkup/provider-aws/catalog";
import { describe, expect, it, vi } from "vitest";

import {
  createInitialArchitectureDocument,
  getArchitectureDocumentStorage,
  rebindImmutableArchitectureRevision,
} from "../../application/architecture-document-storage.js";
import { permissionsForRole } from "../../application/authorization.js";
import { ObjectStoreError } from "../../application/persistence.js";
import type {
  AuthorizedOrganizationScope,
  CloudMarkupRepository,
  DraftMetadataRecord,
  StoredObjectState,
} from "../../application/persistence.js";
import type { PrincipalContext } from "../../application/ports.js";
import {
  createHostedValidationOverrides,
  evaluateHostedAwsValidation,
} from "./hosted-validation.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import type { SqlDatabase, SqlRow, SqlStatement } from "./sql.js";

const principal: PrincipalContext = {
  authenticatedAt: "2026-09-05T12:00:00.000Z",
  authenticationSource: "cognito",
  correlationId: "correlation_validation",
  expiresAt: "2026-09-05T13:00:00.000Z",
  principalId: "principal_validation",
  sessionId: "session_validation",
};
const scope: AuthorizedOrganizationScope = {
  ...principal,
  capabilities: permissionsForRole("editor"),
  membershipId: "membership_validation",
  organizationId: "org_validation",
  roleKey: "editor",
};
const projectId = "project_validation";
const draftId = "draft_validation";
const input: CreateValidationRunV1 = {
  contractVersion: 1,
  environment: "production",
  input: { kind: "draft", draftId, draftVersion: 1 },
  target: "draft",
};
const key = "validation-retry-key-0001";

function documentFixture() {
  const document = createInitialArchitectureDocument({
    blank: true,
    infrastructureOnly: true,
    identity: {
      architectureId: "architecture_validation",
      documentId: "document_validation",
      draftId,
      principalId: principal.principalId,
      revisionId: "revision_validation",
    },
  });
  return parseArchitectureDocument({
    ...document,
    provider: { id: awsCatalogV1.artifact.provider.id, region: "us-east-1" },
    catalog: {
      id: awsCatalogV1.artifact.catalog.id,
      version: awsCatalogV1.artifact.catalog.version,
      digest: AWS_CATALOG_DIGEST_V1,
    },
  });
}

async function setup(
  document = documentFixture(),
  purpose:
    "architecture-draft" | "architecture-revision" = "architecture-draft",
) {
  const documentStore = new InMemoryObjectStore();
  const reportStore = new InMemoryObjectStore();
  const storage = getArchitectureDocumentStorage(document);
  const sourceObject = await documentStore.stage(scope, {
    objectId: "object_validation_source",
    contentSha256: storage.contentSha256,
    mediaType: "application/json",
    owner: { organizationId: scope.organizationId, projectId },
    purpose,
    sizeBytes: storage.bytes.length,
    open: async function* () {
      yield storage.bytes;
      await Promise.resolve();
    },
  });
  await documentStore.publish(scope, sourceObject);
  const objects = new Map<string, StoredObjectState>([
    [sourceObject.objectId, { ...sourceObject, lifecycleState: "published" }],
  ]);
  const metadata: DraftMetadataRecord = {
    contentSha256: storage.contentSha256,
    semanticSha256: storage.semanticSha256,
    visualSha256: storage.visualSha256,
    documentObjectId: sourceObject.objectId,
    documentSchemaVersion: 3,
    draftId,
    draftVersion: 1,
    organizationId: scope.organizationId,
    projectId,
  };
  const getDraft = vi.fn().mockResolvedValue(metadata);
  const getRevision = vi.fn().mockResolvedValue(null);
  const resolveOrganizationScope = vi.fn().mockResolvedValue(scope);
  const organizationForProject = vi
    .fn()
    .mockResolvedValue(scope.organizationId);
  const repository = {
    getDraft,
    getRevision,
    resolveOrganizationScope,
    getObject: vi.fn((_scope, id: string) =>
      Promise.resolve(objects.get(id) ?? null),
    ),
    markObjectPublished: vi.fn((_scope, id: string) => {
      const object = objects.get(id);
      if (object !== undefined)
        objects.set(id, { ...object, lifecycleState: "published" });
      return Promise.resolve();
    }),
  } as unknown as CloudMarkupRepository;
  const rows = new Map<string, Record<string, unknown>>();
  const receipts = new Map<string, Record<string, unknown>>();
  const state = {
    active: true,
    role: "editor",
    sourceMatches: true,
    failCompletion: false,
  };
  const statements: SqlStatement[] = [];
  const query = vi.fn(async (statement: SqlStatement) => {
    await Promise.resolve();
    statements.push(statement);
    const t = statement.text.replace(/\s+/gu, " ");
    const v = statement.values;
    const ok = (values: readonly SqlRow[] = [], count = values.length) => ({
      rows: values,
      rowCount: count,
    });
    if (t.includes("SELECT m.role_key"))
      return ok(state.active ? [{ role_key: state.role }] : []);
    if (t.includes("SELECT v.*, i.request_sha256")) {
      const row = rows.get(String(v[2]));
      return ok(
        row !== undefined &&
          row["organization_id"] === v[0] &&
          row["project_id"] === v[1]
          ? [row]
          : [],
      );
    }
    if (t.includes("INSERT INTO idempotency_records")) {
      const id = JSON.stringify(v.slice(0, 3));
      if (!receipts.has(id))
        receipts.set(id, { request_sha256: v[3], resource_id: v[4] });
      return ok([], 1);
    }
    if (t.includes("SELECT request_sha256, resource_id")) {
      const row = receipts.get(JSON.stringify(v));
      return ok(row === undefined ? [] : [row]);
    }
    if (t.includes("SELECT report_object_id")) {
      const row = rows.get(String(v[2]));
      return ok(row === undefined ? [] : [row]);
    }
    if (t.includes("SELECT 1 FROM architecture_"))
      return ok(state.sourceMatches ? [{ ready: 1 }] : []);
    if (t.includes("INSERT INTO stored_objects")) {
      const object: StoredObjectState = {
        objectId: String(v[0]),
        owner: { organizationId: String(v[1]), projectId: String(v[2]) },
        storageProvider: "memory",
        purpose: "validation-report",
        storageKey: String(v[4]),
        objectVersion: String(v[5]),
        ...(v[6] == null ? {} : { entityTag: String(v[6]) }),
        contentSha256: String(v[7]),
        sizeBytes: Number(v[8]),
        mediaType: String(v[9]),
        lifecycleState: "publication-pending",
      };
      objects.set(object.objectId, object);
      return ok([], 1);
    }
    if (t.includes("INSERT INTO validation_runs")) {
      const receipt = [...receipts.values()].find(
        (r) => r["resource_id"] === v[0],
      );
      rows.set(String(v[0]), {
        validation_run_id: v[0],
        organization_id: v[1],
        project_id: v[2],
        input_kind: v[3],
        draft_id: v[4],
        draft_version: v[5],
        revision_id: v[6],
        environment: v[7],
        target: v[8],
        lifecycle_status: "running",
        report_object_id: v[9],
        report_sha256: v[10],
        created_by_principal_id: v[11],
        created_at: "2026-09-05T12:00:00.000Z",
        request_sha256: receipt?.["request_sha256"],
      });
      return ok([], 1);
    }
    if (t.includes("UPDATE validation_runs")) {
      if (state.failCompletion) throw new Error("simulated database outage");
      const row = rows.get(String(v[2]));
      if (row === undefined) return ok();
      row["lifecycle_status"] = "succeeded";
      row["completed_at"] = "2026-09-05T12:00:01.000Z";
      return ok([], 1);
    }
    if (t.includes("UPDATE idempotency_records")) return ok([], 1);
    throw new Error(`Unexpected SQL: ${t}`);
  });
  const database: SqlDatabase = {
    close: () => Promise.resolve(),
    query: query as unknown as SqlDatabase["query"],
    transaction: (work) => work(database),
  };
  const options = {
    database,
    documentStore,
    reportStore,
    repository,
    organizationForProject,
  };
  return {
    app: createHostedValidationOverrides(options),
    options,
    objects,
    rows,
    receipts,
    state,
    statements,
    getDraft,
    getRevision,
    resolveOrganizationScope,
    organizationForProject,
    sourceObject,
    metadata,
    documentStore,
    reportStore,
    query,
  };
}

describe("durable hosted AWS validation", () => {
  it("persists real deterministic provider evidence, returns a typed summary and reads it after application re-composition", async () => {
    const f = await setup();
    const created = await f.app.createValidationRun(
      principal,
      projectId,
      input,
      key,
    );
    expect(created).toMatchObject({
      projectId,
      status: "succeeded",
      input: input.input,
      target: "draft",
      summary: { complete: true },
    });
    expect(f.rows.size).toBe(1);
    expect(f.receipts.size).toBe(1);
    const replay = await createHostedValidationOverrides(
      f.options,
    ).getValidationRun(principal, projectId, created.id);
    expect(replay).toEqual(created);
    const bytes: Uint8Array[] = [];
    const object = [...f.objects.values()].find(
      (o) => o.purpose === "validation-report",
    );
    expect(object).toBeDefined();
    if (object === undefined) throw new Error("missing evidence");
    for await (const chunk of await f.reportStore.open(scope, object))
      bytes.push(chunk);
    const evidence = JSON.parse(Buffer.concat(bytes).toString("utf8")) as {
      report: { executedRules: { ruleId: string }[]; environment: string };
      kind: string;
    };
    expect(evidence.kind).toBe("cloudmarkup.hosted-provider-validation.v1");
    expect(evidence.report.environment).toBe("production");
    expect(
      evidence.report.executedRules.some((rule) =>
        rule.ruleId.startsWith("aws."),
      ),
    ).toBe(true);
    expect(
      f.statements.some(
        (s) =>
          s.text.includes("FOR SHARE") &&
          s.text.includes("pending_document_object_id IS NULL"),
      ),
    ).toBe(true);
  });

  it("replays the original result after the draft changes, without re-reading or evaluating it", async () => {
    const f = await setup();
    const first = await f.app.createValidationRun(
      principal,
      projectId,
      input,
      key,
    );
    f.getDraft.mockRejectedValue(new Error("draft is now different"));
    expect(
      await createHostedValidationOverrides(f.options).createValidationRun(
        principal,
        projectId,
        input,
        key,
      ),
    ).toEqual(first);
    expect(f.getDraft).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-project reuse before touching another source or report", async () => {
    const f = await setup();
    await f.app.createValidationRun(principal, projectId, input, key);
    f.getDraft.mockClear();
    await expect(
      f.app.createValidationRun(principal, "project_other", input, key),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    expect(f.getDraft).not.toHaveBeenCalled();
    expect(f.rows.size).toBe(1);
  });

  it("normalizes RDS Data API timestamps as UTC without host timezone drift", async () => {
    const f = await setup();
    const run = await f.app.createValidationRun(
      principal,
      projectId,
      input,
      key,
    );
    const row = f.rows.get(run.id);
    if (row === undefined) throw new Error("missing run");
    row["created_at"] = "2026-09-05 12:00:00.123456";
    row["completed_at"] = "2026-09-05 12:00:01";
    expect(
      await f.app.getValidationRun(principal, projectId, run.id),
    ).toMatchObject({
      createdAt: "2026-09-05T12:00:00.123Z",
      completedAt: "2026-09-05T12:00:01.000Z",
    });
  });

  it("rejects changed input for a previously used key", async () => {
    const f = await setup();
    await f.app.createValidationRun(principal, projectId, input, key);
    await expect(
      f.app.createValidationRun(
        principal,
        projectId,
        { ...input, environment: "staging" },
        key,
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    expect(f.rows.size).toBe(1);
  });

  it("recovers an uncertain publication with the original report even after the draft changes", async () => {
    const f = await setup();
    const publish = vi
      .spyOn(f.reportStore, "publish")
      .mockRejectedValueOnce(new Error("S3 unavailable"));
    await expect(
      f.app.createValidationRun(principal, projectId, input, key),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(f.rows.size).toBe(1);
    f.getDraft.mockRejectedValue(new Error("draft changed"));
    const row = [...f.rows.values()][0];
    if (row === undefined) throw new Error("missing pending run");
    const pending = await f.app.getValidationRun(
      principal,
      projectId,
      String(row["validation_run_id"]),
    );
    expect(pending).toMatchObject({ status: "running" });
    expect(pending.summary).toBeUndefined();
    expect(
      await createHostedValidationOverrides(f.options).createValidationRun(
        principal,
        projectId,
        input,
        key,
      ),
    ).toMatchObject({ status: "succeeded" });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("uses a newly committed receipt to classify a publication race with different input", async () => {
    const f = await setup();
    const winningInput: CreateValidationRunV1 = {
      ...input,
      environment: "staging",
    };
    const stage = f.reportStore.stage.bind(f.reportStore);
    const publish = vi.spyOn(f.reportStore, "publish");
    vi.spyOn(f.reportStore, "stage").mockImplementationOnce(
      async (owner, content) => {
        // The competing request commits after the outer request's receipt read,
        // before its conflicting bytes enter the publication coordinator.
        await f.app.createValidationRun(
          principal,
          projectId,
          winningInput,
          key,
        );
        return stage(owner, content);
      },
    );
    await expect(
      f.app.createValidationRun(principal, projectId, input, key),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    expect(f.rows.size).toBe(1);
    expect(f.receipts.size).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect([...f.rows.values()][0]?.["environment"]).toBe("staging");
    expect(
      await f.app.createValidationRun(principal, projectId, winningInput, key),
    ).toMatchObject({ status: "succeeded", input: winningInput.input });
  });

  it("does not classify an object conflict as key reuse without a differing SQL receipt", async () => {
    const f = await setup();
    vi.spyOn(f.reportStore, "stage").mockRejectedValueOnce(
      new ObjectStoreError("object-conflict", "Internal object conflict."),
    );
    await expect(
      f.app.createValidationRun(principal, projectId, input, key),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(f.rows.size).toBe(0);
    expect(f.receipts.size).toBe(0);
  });

  it("rechecks current authorization before comparing a receipt after publication failure", async () => {
    const f = await setup();
    vi.spyOn(f.reportStore, "stage").mockImplementationOnce(() => {
      f.state.role = "viewer";
      return Promise.reject(
        new ObjectStoreError("object-conflict", "Internal object conflict."),
      );
    });
    await expect(
      f.app.createValidationRun(principal, projectId, input, key),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(f.rows.size).toBe(0);
    expect(f.receipts.size).toBe(0);
  });

  it("recovers after publication succeeds but the completion transaction fails", async () => {
    const f = await setup();
    f.state.failCompletion = true;
    await expect(
      f.app.createValidationRun(principal, projectId, input, key),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    f.state.failCompletion = false;
    f.getDraft.mockResolvedValue(null);
    expect(
      await f.app.createValidationRun(principal, projectId, input, key),
    ).toMatchObject({ status: "succeeded" });
    expect(f.rows.size).toBe(1);
  });

  it.each(["scope", "principal", "role", "capability", "active"])(
    "fails closed on revoked or mismatched %s",
    async (kind) => {
      const f = await setup();
      if (kind === "scope")
        f.resolveOrganizationScope.mockResolvedValue({
          ...scope,
          organizationId: "org_other",
        });
      if (kind === "principal")
        f.resolveOrganizationScope.mockResolvedValue({
          ...scope,
          principalId: "principal_other",
        });
      if (kind === "role")
        f.resolveOrganizationScope.mockResolvedValue({
          ...scope,
          roleKey: "viewer",
        });
      if (kind === "capability")
        f.resolveOrganizationScope.mockResolvedValue({
          ...scope,
          capabilities: [],
        });
      if (kind === "active") f.state.active = false;
      await expect(
        f.app.createValidationRun(principal, projectId, input, key),
      ).rejects.toMatchObject({
        code:
          kind === "role" || kind === "capability"
            ? "access_denied"
            : "not_found",
      });
      expect(f.getDraft).not.toHaveBeenCalled();
      expect(f.rows.size).toBe(0);
    },
  );

  it("rechecks role revocation inside the transaction", async () => {
    const f = await setup();
    f.state.role = "viewer";
    await expect(
      f.app.createValidationRun(principal, projectId, input, key),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(f.getDraft).not.toHaveBeenCalled();
  });

  it("does not disclose another project's result or unpublished internal integrity checks", async () => {
    const f = await setup();
    const run = await f.app.createValidationRun(
      principal,
      projectId,
      input,
      key,
    );
    await expect(
      f.app.getValidationRun(principal, "project_other", run.id),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      f.app.getValidationRun(principal, projectId, "validation_internal"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it.each([
    "version",
    "changed-before-commit",
    "metadata-digest",
    "object-owner",
    "object-purpose",
    "missing-object",
    "bytes",
  ])("rejects an invalid %s source without completing a run", async (kind) => {
    const f = await setup();
    if (kind === "version")
      f.getDraft.mockResolvedValue({ ...f.metadata, draftVersion: 2 });
    if (kind === "changed-before-commit") f.state.sourceMatches = false;
    if (kind === "metadata-digest")
      f.getDraft.mockResolvedValue({
        ...f.metadata,
        semanticSha256: "a".repeat(64),
      });
    const source = f.objects.get(f.sourceObject.objectId);
    if (source === undefined) throw new Error("missing source");
    if (kind === "object-owner")
      f.objects.set(source.objectId, {
        ...source,
        owner: { organizationId: "org_other", projectId },
      });
    if (kind === "object-purpose")
      f.objects.set(source.objectId, {
        ...source,
        purpose: "validation-report",
      });
    if (kind === "missing-object") f.objects.delete(source.objectId);
    if (kind === "bytes")
      vi.spyOn(f.documentStore, "open").mockResolvedValue(
        (async function* () {
          yield new TextEncoder().encode("{}");
          await Promise.resolve();
        })(),
      );
    await expect(
      f.app.createValidationRun(principal, projectId, input, key),
    ).rejects.toMatchObject({
      code:
        kind === "version" || kind === "changed-before-commit"
          ? "precondition_failed"
          : "service_unavailable",
    });
    expect(f.rows.size).toBe(0);
  });

  it("validates exact immutable revision input without requiring a current draft", async () => {
    const document = rebindImmutableArchitectureRevision({
      architectureDocument: documentFixture(),
      createdAt: "2026-09-05T11:00:00.000Z",
      createdBy: principal.principalId,
      revisionId: "revision_saved",
      revisionNumber: 1,
      sourceDraftId: draftId,
    });
    const f = await setup(document, "architecture-revision");
    const object = f.objects.get(f.sourceObject.objectId);
    if (object === undefined) throw new Error("missing source");
    f.objects.set(object.objectId, {
      ...object,
      purpose: "architecture-revision",
    });
    f.getRevision.mockResolvedValue({
      ...f.metadata,
      revisionId: "revision_saved",
    });
    const result = await f.app.createValidationRun(
      principal,
      projectId,
      {
        ...input,
        input: { kind: "revision", revisionId: "revision_saved" },
        target: "compilation",
      },
      key,
    );
    expect(result).toMatchObject({
      status: "succeeded",
      input: { kind: "revision", revisionId: "revision_saved" },
      target: "compilation",
    });
    expect(f.getDraft).not.toHaveBeenCalled();
  });

  it("rejects tampered published reports rather than claiming validation succeeded", async () => {
    const f = await setup();
    const result = await f.app.createValidationRun(
      principal,
      projectId,
      input,
      key,
    );
    vi.spyOn(f.reportStore, "open").mockResolvedValue(
      (async function* () {
        yield new TextEncoder().encode("{}");
        await Promise.resolve();
      })(),
    );
    await expect(
      f.app.getValidationRun(principal, projectId, result.id),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });

  it("rejects unreviewed catalog versions and digests", () => {
    const document = documentFixture();
    for (const catalog of [
      { ...document.catalog, digest: `sha256:${"0".repeat(64)}` },
      { ...document.catalog, version: "0.13.0" },
    ]) {
      expect(() =>
        evaluateHostedAwsValidation(
          parseArchitectureDocument({ ...document, catalog }),
          input,
        ),
      ).toThrow("current reviewed AWS catalog");
    }
  });

  it("returns actual AWS findings for a DynamoDB resource without point-in-time recovery", () => {
    const document = documentFixture();
    const service = awsCatalogV1.getService("aws.dynamodb.table");
    expect(service).toBeDefined();
    const candidate = parseArchitectureDocument({
      ...document,
      nodes: [
        {
          id: "node_table",
          semantic: {
            deploymentKey: "table",
            resourceType: "aws.dynamodb.table",
            serviceType: "aws.dynamodb.table",
            configuration: {
              schemaId: "aws.dynamodb.table.configuration",
              schemaVersion: "1.0.0",
              values: {
                pointInTimeRecoveryEnabled: { kind: "boolean", value: false },
              },
            },
            lifecycle: { ownership: "user", origin: "user" },
          },
          presentation: { label: "Table", position: { x: 0, y: 0 } },
        },
      ],
    });
    const report = evaluateHostedAwsValidation(candidate, input);
    expect(
      report.findings.some(
        (f) => f.code === "aws.validation.dynamodb-recovery-not-enabled",
      ),
    ).toBe(true);
    for (const semantic of [
      { ...candidate.nodes[0]?.semantic, serviceType: "aws.unknown.service" },
      { ...candidate.nodes[0]?.semantic, resourceType: "aws.unknown.resource" },
      {
        ...candidate.nodes[0]?.semantic,
        configuration: {
          schemaId: "aws.unknown.configuration",
          schemaVersion: "1.0.0",
          values: {},
        },
      },
    ]) {
      const unsupported = parseArchitectureDocument({
        ...candidate,
        nodes: [{ ...candidate.nodes[0], semantic }],
      });
      expect(() => evaluateHostedAwsValidation(unsupported, input)).toThrow(
        "unsupported AWS resource",
      );
    }
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.executedRules.some((r) => r.ruleId.startsWith("aws."))).toBe(
      true,
    );
    expect(
      createHash("sha256").update(JSON.stringify(report)).digest("hex"),
    ).toBe(
      createHash("sha256")
        .update(JSON.stringify(evaluateHostedAwsValidation(candidate, input)))
        .digest("hex"),
    );
  });
});
