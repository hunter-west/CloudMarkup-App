import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  modelIntentExtractionResponseV1Schema,
  digestCanonicalValue,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { parseIntentDocument } from "@cloudmarkup/domain";
import { PostgresAiIntentAcceptance } from "./ai-intent-acceptance.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createPreviewAuthorityFixture } from "./ai-intent-preview-authority-test-helpers.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import { sql, type SqlDatabase } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
integration("explicit accepted Intent on isolated real PostgreSQL", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 60000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture(completed = true) {
    const tenant = await harness.tenant();
    const f = await createPreviewAuthorityFixture(harness.database, {
      organizationId: tenant.scope.organizationId,
      projectId: tenant.scope.projectId,
      userId: tenant.scope.userId,
      jobId: `job_${randomUUID()}`,
    });
    if (completed) await f.disconnect();
    const objectStore = new InMemoryObjectStore();
    const repository = new PostgresCloudMarkupRepository(harness.database, {
      draftEditingLeases: "required",
    });
    const errors: unknown[] = [];
    const database: SqlDatabase = {
      query: harness.database.query.bind(harness.database),
      close: () => Promise.resolve(),
      transaction: (work) =>
        harness.database.transaction(async (tx) => {
          try {
            return await work(tx);
          } catch (e) {
            errors.push(e);
            throw e;
          }
        }),
    };
    const acceptance = new PostgresAiIntentAcceptance({
      database,
      repository,
      objectStore,
    });
    const input = {
      contractVersion: 1 as const,
      candidate: modelIntentExtractionResponseV1Schema.parse(
        f.preview.result.response,
      ),
      editingProof: f.authority.editingProof,
    };
    const key = `accept_${randomUUID()}`;
    const accept = () =>
      acceptance.accept(
        f.authority.principal,
        tenant.scope.projectId,
        input,
        f.authority.baseline.draftEtag,
        key,
      );
    const release = () =>
      f.leases.release(
        f.authority.principal,
        tenant.scope.projectId,
        f.authority.editingProof,
      );
    return {
      ...f,
      tenant,
      acceptance,
      input,
      key,
      accept,
      release,
      objectStore,
      repository,
      errors,
    };
  }
  async function counts(org: string) {
    return (
      await harness.database.query(
        sql(
          `SELECT
      (SELECT count(*)::int FROM accepted_intents WHERE organization_id=$1) AS accepted,
      (SELECT count(*)::int FROM audit_events WHERE organization_id=$1 AND action='ai-intent.accepted') AS audits,
      (SELECT count(*)::int FROM stored_objects WHERE organization_id=$1 AND object_purpose='accepted-intent') AS objects`,
          [org],
        ),
      )
    ).rows[0];
  }
  it("publishes only explicitly accepted Intent with one atomic receipt and audit; concurrent retries return exact content", async () => {
    const f = await fixture();
    const attempts = await Promise.allSettled([f.accept(), f.accept()]);
    expect(f.errors).toEqual([]);
    expect(attempts.every((r) => r.status === "fulfilled")).toBe(true);
    const result = await f.accept();
    expect(result.intentDocument).toEqual(
      parseIntentDocument(f.input.candidate.intentDocument),
    );
    expect(result.outputDigest).toBe(digestCanonicalValue(f.input.candidate));
    expect(result.intentDigest).toBe(
      digestCanonicalValue(
        parseIntentDocument(f.input.candidate.intentDocument),
      ),
    );
    expect(
      await f.acceptance.get(
        f.authority.principal,
        f.tenant.scope.projectId,
        result.acceptedIntentId,
      ),
    ).toEqual(result);
    expect(await counts(f.tenant.scope.organizationId)).toEqual({
      accepted: 1,
      audits: 1,
      objects: 1,
    });
    const stored = (
      await harness.database.query(
        sql(
          "SELECT content_object_id FROM accepted_intents WHERE organization_id=$1",
          [f.tenant.scope.organizationId],
        ),
      )
    ).rows[0];
    const object = await f.repository.getObject(
      f.tenant.authorized,
      String(stored?.["content_object_id"]),
    );
    expect(object).toMatchObject({
      lifecycleState: "published",
      purpose: "accepted-intent",
    });
    if (!object) throw Error("Expected accepted content.");
    const chunks: Uint8Array[] = [];
    for await (const chunk of await f.objectStore.open(
      f.tenant.authorized,
      object,
    ))
      chunks.push(chunk);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(
      serializeCanonicalJson(
        parseIntentDocument(f.input.candidate.intentDocument),
      ),
    );
    expect(f.invocations).toBe(1);
    expect(f.commercial.accounting.reserveCalls).toBe(1);
  });
  it("does not turn missing completion into acceptance", async () => {
    const f = await fixture(false);
    await expect(f.accept()).rejects.toMatchObject({ code: "conflict" });
    expect(await counts(f.tenant.scope.organizationId)).toEqual({
      accepted: 0,
      audits: 0,
      objects: 0,
    });
  });
  it("rejects a schema-valid candidate whose exact output digest differs", async () => {
    const f = await fixture();
    const changed = structuredClone(f.input);
    changed.candidate.intentDocument.application.summary += " changed";
    await expect(
      f.acceptance.accept(
        f.authority.principal,
        f.tenant.scope.projectId,
        changed,
        f.authority.baseline.draftEtag,
        f.key,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await counts(f.tenant.scope.organizationId)).toEqual({
      accepted: 0,
      audits: 0,
      objects: 0,
    });
  });
  it.each(["lease", "draft", "pending-draft", "session", "proof"])(
    "rejects stale original %s authority without accepted storage",
    async (change) => {
      const f = await fixture();
      if (change === "lease") await f.release();
      if (change === "draft") await f.advanceDraft(true);
      if (change === "pending-draft") await f.advanceDraft(false);
      const principal =
        change === "session"
          ? { ...f.authority.principal, sessionId: `session_${randomUUID()}` }
          : f.authority.principal;
      const input =
        change === "proof"
          ? {
              ...f.input,
              editingProof: {
                ...f.input.editingProof,
                token: randomBytes(32).toString("base64url"),
              },
            }
          : f.input;
      await expect(
        f.acceptance.accept(
          principal,
          f.tenant.scope.projectId,
          input,
          f.authority.baseline.draftEtag,
          f.key,
        ),
      ).rejects.toMatchObject({ code: "precondition_failed" });
      expect(await counts(f.tenant.scope.organizationId)).toEqual({
        accepted: 0,
        audits: 0,
        objects: 0,
      });
    },
  );
  it("recovers an already committed acceptance after publication failure and lease release", async () => {
    const f = await fixture();
    const publish = vi
      .spyOn(f.objectStore, "publish")
      .mockRejectedValueOnce(Error("Synthetic storage outage"));
    await expect(f.accept()).rejects.toMatchObject({
      code: "service_unavailable",
    });
    expect(await counts(f.tenant.scope.organizationId)).toEqual({
      accepted: 1,
      audits: 1,
      objects: 1,
    });
    await f.release();
    const result = await f.accept();
    expect(result.intentDocument).toEqual(
      parseIntentDocument(f.input.candidate.intentDocument),
    );
    expect(publish).toHaveBeenCalledTimes(2);
    expect(await counts(f.tenant.scope.organizationId)).toEqual({
      accepted: 1,
      audits: 1,
      objects: 1,
    });
    expect(f.invocations).toBe(1);
  });
  it("rechecks original authority after staging and rolls back the receipt and audit", async () => {
    const f = await fixture();
    const original = f.objectStore.stage.bind(f.objectStore);
    vi.spyOn(f.objectStore, "stage").mockImplementationOnce(async (...args) => {
      const object = await original(...args);
      await f.release();
      return object;
    });
    await expect(f.accept()).rejects.toMatchObject({
      code: "precondition_failed",
    });
    expect(await counts(f.tenant.scope.organizationId)).toEqual({
      accepted: 0,
      audits: 0,
      objects: 0,
    });
  });
  it("denies cross-tenant reads and acceptance without disclosing records", async () => {
    const f = await fixture(),
      other = await fixture();
    const result = await f.accept();
    await expect(
      f.acceptance.get(
        other.authority.principal,
        f.tenant.scope.projectId,
        result.acceptedIntentId,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      f.acceptance.accept(
        other.authority.principal,
        f.tenant.scope.projectId,
        f.input,
        f.authority.baseline.draftEtag,
        f.key,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("keeps retry requests exact and accepted metadata immutable", async () => {
    const f = await fixture();
    const result = await f.accept();
    await expect(
      f.acceptance.accept(
        f.authority.principal,
        f.tenant.scope.projectId,
        f.input,
        f.authority.baseline.draftEtag,
        `accept_${randomUUID()}`,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      harness.database.query(
        sql(
          "UPDATE accepted_intents SET request_sha256=$2 WHERE accepted_intent_id=$1",
          [result.acceptedIntentId, "b".repeat(64)],
        ),
      ),
    ).rejects.toBeDefined();
    await expect(
      harness.database.query(
        sql(
          "UPDATE stored_objects SET content_sha256=$2 WHERE organization_id=$1 AND object_purpose='accepted-intent'",
          [f.tenant.scope.organizationId, "b".repeat(64)],
        ),
      ),
    ).rejects.toBeDefined();
    expect(await f.accept()).toEqual(result);
  });
  it("generic object publication cannot create accepted content without the closed receipt", async () => {
    const f = await fixture();
    const content = Buffer.from(
      serializeCanonicalJson(
        parseIntentDocument(f.input.candidate.intentDocument),
      ),
    );
    const object = await f.objectStore.stage(f.tenant.authorized, {
      objectId: `object_${randomUUID()}`,
      owner: {
        organizationId: f.tenant.scope.organizationId,
        projectId: f.tenant.scope.projectId,
      },
      purpose: "accepted-intent",
      contentSha256: digestCanonicalValue(
        parseIntentDocument(f.input.candidate.intentDocument),
      ).slice(7),
      sizeBytes: content.length,
      mediaType: "application/json",
      open: async function* () {
        yield await Promise.resolve(content);
      },
    });
    await expect(
      harness.database.query(
        sql(
          `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,storage_key,object_version,content_sha256,size_bytes,media_type,created_by_principal_id) VALUES($1,$2,$3,'memory','accepted-intent',$4,$5,$6,$7,'application/json',$8)`,
          [
            object.objectId,
            f.tenant.scope.organizationId,
            f.tenant.scope.projectId,
            object.storageKey,
            object.objectVersion,
            object.contentSha256,
            object.sizeBytes,
            f.tenant.scope.userId,
          ],
        ),
      ),
    ).rejects.toBeDefined();
    expect(await counts(f.tenant.scope.organizationId)).toEqual({
      accepted: 0,
      audits: 0,
      objects: 0,
    });
  });
  it("rejects detected secret content without staging or accepting anything", async () => {
    const f = await fixture();
    const input = structuredClone(f.input);
    input.candidate.intentDocument.application.summary =
      "AWS access key: " + "AKIA" + "0".repeat(16);
    const stage = vi.spyOn(f.objectStore, "stage");
    await expect(
      f.acceptance.accept(
        f.authority.principal,
        f.tenant.scope.projectId,
        input,
        f.authority.baseline.draftEtag,
        f.key,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(stage).not.toHaveBeenCalled();
    expect(await counts(f.tenant.scope.organizationId)).toEqual({
      accepted: 0,
      audits: 0,
      objects: 0,
    });
  });
  it("denies expired current authentication even for an already accepted record", async () => {
    const f = await fixture();
    const result = await f.accept();
    const expired = {
      ...f.authority.principal,
      authenticatedAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-02T00:00:00.000Z",
    };
    await expect(
      f.acceptance.get(
        expired,
        f.tenant.scope.projectId,
        result.acceptedIntentId,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      f.acceptance.accept(
        expired,
        f.tenant.scope.projectId,
        f.input,
        f.authority.baseline.draftEtag,
        f.key,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("rechecks membership after reading accepted object bytes", async () => {
    const f = await fixture();
    const result = await f.accept();
    const original = f.objectStore.open.bind(f.objectStore);
    vi.spyOn(f.objectStore, "open").mockImplementationOnce(async (...args) => {
      const stream = await original(...args);
      await harness.database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.tenant.scope.organizationId, f.tenant.scope.userId],
        ),
      );
      return stream;
    });
    await expect(
      f.acceptance.get(
        f.authority.principal,
        f.tenant.scope.projectId,
        result.acceptedIntentId,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
