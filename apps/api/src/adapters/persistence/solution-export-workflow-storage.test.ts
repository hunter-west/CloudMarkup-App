import { describe, expect, it, vi } from "vitest";
import type {
  ObjectPurpose,
  StoredObjectReference,
} from "../../application/persistence.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import { exportScope } from "./solution-export-artifact-test-helpers.js";
import type { SolutionExportObjectAuthority } from "./solution-export-producer-objects.js";
import {
  solutionExportWorkflowByteLimit,
  SolutionExportWorkflowStorage,
} from "./solution-export-workflow-storage.js";

const MiB = 1024 * 1024;
describe("immutable export object byte boundaries", () => {
  it.each(["checkpoint-state"] as const)(
    "retains the four MiB JSON limit for %s",
    (purpose) => {
      expect(solutionExportWorkflowByteLimit(purpose, "application/json")).toBe(
        4 * MiB,
      );
    },
  );
  it.each([
    "application/vnd.hashicorp.terraform",
    "application/vnd.amazon.cloudformation.template+json",
    "application/yaml",
    "image/svg+xml",
    "text/markdown",
    "text/plain",
    "text/typescript",
  ])("uses a separate closed preview-file bound for %s", (media) => {
    expect(solutionExportWorkflowByteLimit("generated-source", media)).toBe(
      32 * MiB,
    );
    expect(solutionExportWorkflowByteLimit("input-payload", media)).toBe(
      32 * MiB,
    );
    expect(() => solutionExportWorkflowByteLimit("report", media)).toThrow();
  });
  it("allows the larger archive bound only for the exact package purpose and ZIP media", () => {
    expect(
      solutionExportWorkflowByteLimit("export-package", "application/zip"),
    ).toBe(64 * MiB);
    for (const purpose of [
      "report",
      "generated-source",
      "input-payload",
    ] as const)
      expect(() =>
        solutionExportWorkflowByteLimit(purpose, "application/zip"),
      ).toThrow();
    expect(() =>
      solutionExportWorkflowByteLimit(
        "input-payload",
        "application/octet-stream",
      ),
    ).toThrow();
  });
  function fixture() {
    const scope = exportScope();
    const query = vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 }));
    const authorize = vi.fn(() => Promise.resolve(scope));
    const authority: SolutionExportObjectAuthority = {
      ownership: {
        organizationId: scope.organizationId,
        projectId: "project.export",
      },
      permission: "exports.run",
      query,
      scope: authorize,
    };
    const store = new InMemoryObjectStore();
    const storage = new SolutionExportWorkflowStorage(authority, store);
    return { query, authorize, store, storage };
  }
  it("rejects oversized JSON writes before SQL, authorization or object I/O", async () => {
    const f = fixture();
    const stage = vi.spyOn(f.store, "stage");
    await expect(
      f.storage.put(new Uint8Array(4 * MiB + 1), "report", "application/json"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(stage).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
  });
  it.each([
    ["report", "application/json", 4 * MiB + 1],
    ["generated-source", "text/typescript", 32 * MiB + 1],
    ["export-package", "application/zip", 64 * MiB + 1],
  ] satisfies [ObjectPurpose, string, number][])(
    "rejects oversized %s read metadata before opening bytes",
    async (purpose, mediaType, sizeBytes) => {
      const f = fixture();
      const open = vi.spyOn(f.store, "open");
      const reference: StoredObjectReference = {
        objectId: "object.synthetic",
        owner: { organizationId: "org.synthetic", projectId: "project.export" },
        purpose,
        mediaType,
        sizeBytes,
        storageProvider: "memory",
        storageKey: "synthetic",
        objectVersion: "1",
        contentSha256: "a".repeat(64),
      };
      await expect(f.storage.read(reference)).rejects.toMatchObject({
        code: "service_unavailable",
      });
      expect(open).not.toHaveBeenCalled();
      expect(f.query).not.toHaveBeenCalled();
    },
  );
  it("derives distinct immutable addresses for the same content in different projects and organizations", () => {
    const f = fixture();
    const value = { digest: "a".repeat(64), mediaType: "application/json" };
    const original = f.storage.identity("report", value);
    for (const ownership of [
      { ...f.storage.authority.ownership, projectId: "project.other" },
      { ...f.storage.authority.ownership, organizationId: "org.other" },
    ]) {
      const other = new SolutionExportWorkflowStorage(
        { ...f.storage.authority, ownership },
        f.store,
      );
      expect(other.identity("report", value)).not.toBe(original);
    }
    expect(f.storage.identity("evidence", value)).not.toBe(original);
    expect(f.storage.identity("report", value)).toBe(original);
  });
});
