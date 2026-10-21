import { describe, expect, it, vi } from "vitest";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { currentAiCanvasIssueFixture } from "../../application/ai-canvas-context-test-helpers.js";
import type {
  AuthorizedOrganizationScope,
  ObjectStore,
} from "../../application/persistence.js";
import type { SolutionExportObjectAuthority } from "./solution-export-producer-objects.js";
import { createBetaProposalBaselineReader } from "./beta-proposal-baseline-reader.js";
import { exportRunBytes, exportRunSha } from "./solution-export-run-codec.js";
import type { SqlStatement } from "./sql.js";

function fixture() {
  const document = currentAiCanvasIssueFixture();
  const bytes = exportRunBytes(document);
  const ownership = { organizationId: "org_test", projectId: "project_test" };
  const scope: AuthorizedOrganizationScope = {
    ...ownership,
    principalId: "actor_test",
    sessionId: "session_test",
    correlationId: "correlation_test",
    membershipId: "member_test",
    roleKey: "owner",
    capabilities: ["projects.mutate"],
  };
  const subject = {
    kind: "draft" as const,
    draftId: "draft_test",
    draftVersion: 1,
    etag: '"draft:draft_test:v1"',
    contentDigest: digestCanonicalValue(document),
  };
  const draft = {
    draft_id: subject.draftId,
    draft_version: "1",
    document_object_id: "object_saved",
    content_sha256: exportRunSha(bytes),
  };
  const metadata = {
    ...ownership,
    organization_id: ownership.organizationId,
    project_id: ownership.projectId,
    object_id: "object_saved",
    storage_provider: "memory",
    storage_key: "saved.json",
    object_version: "v1",
    content_sha256: exportRunSha(bytes),
    size_bytes: bytes.length,
    media_type: "application/json",
    object_purpose: "architecture-draft",
    lifecycle_state: "published",
  };
  const query = vi.fn((statement: SqlStatement) => {
    if (statement.text.includes("FROM projects")) {
      expect(statement.values).toEqual([
        ownership.organizationId,
        ownership.projectId,
        subject.draftId,
        1,
        subject.contentDigest.slice(7),
      ]);
      expect(statement.text).toContain("pending_draft_version IS NULL");
      return Promise.resolve({ rowCount: 1, rows: [draft] });
    }
    expect(statement.values).toEqual([
      ownership.organizationId,
      ownership.projectId,
      "object_saved",
    ]);
    return Promise.resolve({ rowCount: 1, rows: [metadata] });
  });
  const authorize = vi.fn(() => Promise.resolve(scope));
  const authority = {
    ownership,
    permission: "projects.mutate",
    scope: authorize,
    query,
  } as SolutionExportObjectAuthority;
  const open = vi.fn(() =>
    Promise.resolve(
      (async function* () {
        yield await Promise.resolve(bytes);
      })(),
    ),
  );
  const objectStore = { open } as unknown as ObjectStore;
  const assertCurrent = vi.fn(() => Promise.resolve());
  const read = createBetaProposalBaselineReader({
    authority,
    objectStore,
    assertCurrent,
  });
  return {
    document,
    bytes,
    ownership,
    scope,
    subject,
    draft,
    metadata,
    query,
    authorize,
    open,
    assertCurrent,
    read,
  };
}

describe("exact authorized semantic proposal baseline", () => {
  it("reads verified immutable bytes and rechecks the current actor/job and exact draft after object read", async () => {
    const f = fixture();
    expect(await f.read(f)).toEqual(f.document);
    expect(f.open).toHaveBeenCalledOnce();
    expect(f.assertCurrent).toHaveBeenCalledTimes(2);
    expect(f.authorize.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it.each(["tenant", "project", "etag"])(
    "refuses %s mismatch before metadata or object access",
    async (kind) => {
      const f = fixture();
      const ownership = {
        ...f.ownership,
        ...(kind === "tenant" ? { organizationId: "org_other" } : {}),
        ...(kind === "project" ? { projectId: "project_other" } : {}),
      };
      const subject = {
        ...f.subject,
        ...(kind === "etag" ? { etag: '"draft:other:v1"' } : {}),
      };
      await expect(f.read({ ownership, subject })).rejects.toMatchObject({
        code: "precondition_failed",
      });
      expect(f.query).not.toHaveBeenCalled();
      expect(f.open).not.toHaveBeenCalled();
    },
  );
  it.each(["draft", "digest", "deletion"])(
    "refuses stale or erased %s without opening bytes",
    async (kind) => {
      const f = fixture();
      if (kind === "draft") f.draft.draft_version = "2";
      if (kind === "digest") f.draft.content_sha256 = "0".repeat(64);
      if (kind === "deletion") f.metadata.lifecycle_state = "delete-pending";
      await expect(f.read(f)).rejects.toMatchObject({
        code: "precondition_failed",
      });
      expect(f.open).not.toHaveBeenCalled();
    },
  );
  it("refuses revoked actor/job before read and a draft changed while streaming", async () => {
    const revoked = fixture();
    revoked.authorize.mockRejectedValueOnce(new Error("revoked actor"));
    await expect(revoked.read(revoked)).rejects.toThrow("revoked");
    expect(revoked.open).not.toHaveBeenCalled();
    const cancelled = fixture();
    cancelled.assertCurrent.mockRejectedValueOnce(new Error("cancelled job"));
    await expect(cancelled.read(cancelled)).rejects.toThrow("cancelled");
    expect(cancelled.query).not.toHaveBeenCalled();
    const changed = fixture();
    changed.open.mockImplementation(() =>
      Promise.resolve(
        (async function* () {
          yield await Promise.resolve(changed.bytes);
          changed.draft.draft_version = "2";
        })(),
      ),
    );
    await expect(changed.read(changed)).rejects.toMatchObject({
      code: "precondition_failed",
    });
  });
  it("refuses corrupt immutable object bytes", async () => {
    const f = fixture();
    f.open.mockImplementation(() =>
      Promise.resolve(
        (async function* () {
          yield await Promise.resolve(new Uint8Array(f.bytes.length));
        })(),
      ),
    );
    await expect(f.read(f)).rejects.toThrow();
  });
});
