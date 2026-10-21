import {
  APPLICATION_GENERATION_V1_LIMITS,
  existingApplicationFileV1Schema,
  type ApplicationGenerationResultV1,
  type ApplicationSourceFileV1,
  type ExistingApplicationFileV1,
} from "@cloudmarkup/schemas";
import { beforeAll, describe, expect, it } from "vitest";

import { sha256Digest } from "./constants.js";
import { generateApplication } from "./generate.js";
import { createNotesGenerationRequest } from "./test-fixtures.js";

const handlerPath = "application/src/functions/notes_handler/index.ts";
const extensionPath =
  "application/src/functions/notes_handler/extensions/custom.ts";
function requiredContent(value: unknown, path: string): string {
  if (
    value === null ||
    typeof value !== "object" ||
    !("content" in value) ||
    typeof value.content !== "string"
  ) {
    throw new Error(`Missing generated content for ${path}.`);
  }
  return value.content;
}

function existingInventory(value: unknown): ExistingApplicationFileV1 {
  return existingApplicationFileV1Schema.parse(value);
}

function sourceFile(
  result: ApplicationGenerationResultV1,
  path: string,
): ApplicationSourceFileV1 {
  const file = result.artifact.sourceFiles.find(
    (candidate) => candidate.path === path,
  );
  if (file === undefined) {
    throw new Error(`Missing generated source ${path}.`);
  }
  return file;
}

function generatedInventory(
  file: ApplicationSourceFileV1,
  checksum: string = file.checksum,
  baselineChecksum: string = checksum,
): ExistingApplicationFileV1 {
  return existingInventory({
    path: file.path,
    mediaType: file.mediaType,
    ownership: "generated",
    currentChecksum: checksum,
    baselineChecksum,
    semanticChecksum: checksum,
    sizeBytes: file.sizeBytes,
  });
}

function userInventory(
  path: string,
  ownership: "user-owned" | "approved-extension" = "user-owned",
): ExistingApplicationFileV1 {
  return existingInventory({
    path,
    mediaType: "text/typescript",
    ownership,
    currentChecksum: sha256Digest(`synthetic current bytes for ${path}`),
    semanticChecksum: sha256Digest(`synthetic semantic bytes for ${path}`),
    sizeBytes: 41,
  });
}

function diffFor(result: ApplicationGenerationResultV1, path: string) {
  const entry = result.artifact.diff.files.find(
    (candidate) => candidate.path === path,
  );
  expect(entry, `missing diff ${path}`).toBeDefined();
  return entry;
}

describe("deterministic application regeneration", () => {
  let baseline: ApplicationGenerationResultV1;

  beforeAll(() => {
    baseline = generateApplication(createNotesGenerationRequest());
  });

  it("creates every absent path and never proposes deletion", () => {
    const result = baseline;

    expect(
      result.artifact.sourceFiles.every(
        (file) => file.disposition === "create",
      ),
    ).toBe(true);
    expect(
      result.artifact.diff.files.every((file) => file.change === "create"),
    ).toBe(true);
  });

  it("marks an exact generated baseline unchanged without returning content", () => {
    const handler = sourceFile(baseline, handlerPath);
    const result = generateApplication(
      createNotesGenerationRequest({
        existingFiles: [generatedInventory(handler)],
      }),
    );
    const regenerated = sourceFile(result, handlerPath);

    expect(regenerated).toMatchObject({
      disposition: "unchanged",
      checksum: handler.checksum,
      ownership: "generated",
    });
    expect(regenerated).not.toHaveProperty("content");
    expect(diffFor(result, handlerPath)).toMatchObject({ change: "unchanged" });
  });

  it("replaces only an unmodified exact generated baseline", () => {
    const handler = sourceFile(baseline, handlerPath);
    const handlerContent = requiredContent(handler, handlerPath);
    const oldChecksum = sha256Digest("synthetic older generated handler");
    const result = generateApplication(
      createNotesGenerationRequest({
        existingFiles: [generatedInventory(handler, oldChecksum)],
      }),
    );
    const regenerated = sourceFile(result, handlerPath);

    expect(regenerated).toMatchObject({
      disposition: "replace",
      previousChecksum: oldChecksum,
      baselineChecksum: oldChecksum,
      checksum: handler.checksum,
      content: handlerContent,
    });
    expect(diffFor(result, handlerPath)).toMatchObject({
      change: "replace",
      beforeChecksum: oldChecksum,
      afterChecksum: handler.checksum,
    });
  });

  it.each(["user-owned", "approved-extension"] as const)(
    "preserves an existing %s extension without inspecting or echoing bytes",
    (ownership) => {
      const existing = userInventory(extensionPath, ownership);
      const result = generateApplication(
        createNotesGenerationRequest({ existingFiles: [existing] }),
      );
      const preserved = sourceFile(result, extensionPath);

      expect(preserved).toMatchObject({
        disposition: "preserve",
        ownership,
        checksum: existing.currentChecksum,
      });
      expect(preserved).not.toHaveProperty("content");
      expect(diffFor(result, extensionPath)).toMatchObject({
        change: "preserve",
        beforeChecksum: existing.currentChecksum,
        afterChecksum: existing.currentChecksum,
      });
    },
  );

  it("fails closed when generated bytes differ from their exact baseline", () => {
    const handler = sourceFile(baseline, handlerPath);
    const currentChecksum = sha256Digest("synthetic locally modified handler");
    const baselineChecksum = sha256Digest(
      "synthetic recorded handler baseline",
    );
    const result = generateApplication(
      createNotesGenerationRequest({
        existingFiles: [
          generatedInventory(handler, currentChecksum, baselineChecksum),
        ],
      }),
    );

    expect(
      result.artifact.sourceFiles.some((file) => file.path === handlerPath),
    ).toBe(false);
    expect(diffFor(result, handlerPath)).toMatchObject({
      change: "conflict",
      beforeChecksum: currentChecksum,
    });
    expect(result.artifact.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "APPLICATION_SOURCE_CONFLICT",
        severity: "error",
      }),
    );
  });

  it("fails closed when user content occupies a generated path", () => {
    const existing = userInventory(handlerPath);
    const result = generateApplication(
      createNotesGenerationRequest({ existingFiles: [existing] }),
    );

    expect(diffFor(result, handlerPath)).toMatchObject({
      change: "conflict",
      ownership: "user-owned",
    });
    expect(
      result.artifact.sourceFiles.some((file) => file.path === handlerPath),
    ).toBe(false);
  });

  it("retains generated orphans for review and preserves unrelated user files", () => {
    const generatedOrphanPath = "application/src/legacy-generated.ts";
    const generatedOrphanChecksum = sha256Digest("synthetic orphan baseline");
    const userOrphanPath = "application/src/user-notes.ts";
    const userOrphan = userInventory(userOrphanPath);
    const result = generateApplication(
      createNotesGenerationRequest({
        existingFiles: [
          existingInventory({
            path: generatedOrphanPath,
            mediaType: "text/typescript",
            ownership: "generated",
            currentChecksum: generatedOrphanChecksum,
            baselineChecksum: generatedOrphanChecksum,
            semanticChecksum: generatedOrphanChecksum,
            sizeBytes: 31,
          }),
          userOrphan,
        ],
      }),
    );

    expect(diffFor(result, generatedOrphanPath)).toMatchObject({
      change: "conflict",
      beforeChecksum: generatedOrphanChecksum,
    });
    expect(
      result.artifact.sourceFiles.some(
        (file) => file.path === generatedOrphanPath,
      ),
    ).toBe(false);
    expect(diffFor(result, userOrphanPath)).toMatchObject({
      change: "preserve",
    });
    expect(sourceFile(result, userOrphanPath)).toMatchObject({
      disposition: "preserve",
      checksum: userOrphan.currentChecksum,
      ownership: "user-owned",
    });
  });

  it("removes the Prompt 32A envelope and blocks the workload when its generated handoff path conflicts", () => {
    const buildFile = baseline.artifact.sourceFiles.find((file) =>
      file.path.startsWith("application/build-contracts/"),
    );
    if (buildFile === undefined) {
      throw new Error("Missing generated build-contract source.");
    }
    const currentChecksum = sha256Digest(
      "synthetic locally modified build contract",
    );
    const baselineChecksum = sha256Digest(
      "synthetic recorded build-contract baseline",
    );
    const result = generateApplication(
      createNotesGenerationRequest({
        existingFiles: [
          generatedInventory(buildFile, currentChecksum, baselineChecksum),
        ],
      }),
    );
    const buildPath = buildFile.path;

    expect(result.artifact.buildContracts).toEqual([]);
    expect(result.artifact.sourceManifest.buildContracts).toEqual([]);
    expect(
      result.artifact.sourceFiles.some((file) => file.path === buildPath),
    ).toBe(false);
    expect(diffFor(result, buildPath)).toMatchObject({
      change: "conflict",
      beforeChecksum: currentChecksum,
    });
    expect(result.artifact.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "APPLICATION_BUILD_HANDOFF_CONFLICT",
        severity: "error",
        source: {
          document: "repository",
          path: buildPath,
          workloadId: "workload_notes_api",
        },
      }),
    );
    expect(result.artifact.workloadContracts[0]).toMatchObject({
      readiness: "generation-blocked",
      ownershipReadiness: "not-safe-to-materialize",
    });
    expect(result.artifact.coverage).toMatchObject({
      state: "target-unsupported",
      workloads: [expect.objectContaining({ state: "target-unsupported" })],
    });
    expect(
      result.artifact.diff.semantic.some(
        (entry) => entry.kind === "build-contract",
      ),
    ).toBe(false);
  });

  it("returns a schema-valid blocked result when the source and diff file bound would overflow", () => {
    const existingFiles = Array.from(
      { length: APPLICATION_GENERATION_V1_LIMITS.files },
      (_, index) => {
        const path = `application/existing/file-${String(index).padStart(2, "0")}.txt`;
        const checksum = sha256Digest(
          `synthetic preserved file ${String(index)}`,
        );
        return existingInventory({
          path,
          mediaType: "text/plain",
          ownership: "user-owned",
          currentChecksum: checksum,
          semanticChecksum: checksum,
          sizeBytes: 1,
        });
      },
    );

    const result = generateApplication(
      createNotesGenerationRequest({ existingFiles }),
    );

    expect(result.artifact.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "APPLICATION_SOURCE_BOUND_EXCEEDED",
        severity: "error",
        source: { document: "repository", path: "application" },
      }),
    );
    expect(result.artifact.sourceFiles).toHaveLength(
      APPLICATION_GENERATION_V1_LIMITS.files,
    );
    expect(result.artifact.diff.files).toHaveLength(
      APPLICATION_GENERATION_V1_LIMITS.files,
    );
    expect(
      result.artifact.sourceFiles.every(
        (file) => file.disposition === "preserve",
      ),
    ).toBe(true);
    expect(
      result.artifact.diff.files.every((file) => file.change === "preserve"),
    ).toBe(true);
    expect(result.artifact.buildContracts).toEqual([]);
    expect(result.artifact.sourceManifest.buildContracts).toEqual([]);
    expect(result.artifact.workloadContracts[0]).toMatchObject({
      readiness: "generation-blocked",
      ownershipReadiness: "not-safe-to-materialize",
    });
    expect(result.artifact.coverage).toMatchObject({
      state: "target-unsupported",
      workloads: [expect.objectContaining({ state: "target-unsupported" })],
    });
  });
});
