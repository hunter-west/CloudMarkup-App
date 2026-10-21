import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { canonicalJson, sha256Digest } from "./constants.js";
import { generateApplication } from "./generate.js";
import {
  createNotesGenerationRequest,
  createHttpNoContentFixture,
} from "./test-fixtures.js";
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

function goldenProjection(result: ReturnType<typeof generateApplication>) {
  return {
    artifactDigest: result.artifactDigest,
    coverageDigest: result.artifact.coverageDigest,
    sourceManifestDigest: result.artifact.sourceManifestDigest,
    coverage: result.artifact.coverage,
    buildContracts: result.artifact.buildContracts.map((entry) => ({
      workloadId: entry.contract.workloadId,
      contractDigest: entry.contractDigest,
      entrypoint: entry.contract.entrypoint,
      artifactPath: entry.contract.expectedArtifact.path,
    })),
    files: result.artifact.sourceFiles.map((file) => ({
      path: file.path,
      checksum: file.checksum,
      semanticChecksum: file.semanticChecksum,
      sizeBytes: file.sizeBytes,
      ownership: file.ownership,
      disposition: file.disposition,
    })),
  };
}

async function readGolden(
  filename = "notes-create-source.json",
): Promise<unknown> {
  const source = await readFile(
    new URL("../fixtures/golden/" + filename, import.meta.url),
    "utf8",
  );
  return JSON.parse(source) as unknown;
}

describe("deterministic application source golden", () => {
  it("matches the separately pinned no-content source inventory", async () => {
    expect(
      goldenProjection(generateApplication(createHttpNoContentFixture())),
    ).toEqual(await readGolden("http-no-content-1.0-source.json"));
  });
  it("matches the reviewed complete notes-create source inventory", async () => {
    const request = createNotesGenerationRequest();
    const first = generateApplication(request);
    const second = generateApplication(request);

    expect(first).toEqual(second);
    expect(goldenProjection(first)).toEqual(await readGolden());

    const artifact = first.artifact;
    const manifestByPath = new Map(
      artifact.sourceManifest.files.map((file) => [file.path, file]),
    );

    expect(artifact.sourceManifest.files).toHaveLength(
      artifact.sourceFiles.length,
    );
    expect(artifact.sourceManifest.files.map(({ path }) => path)).not.toContain(
      "application/manifest.json",
    );
    expect(artifact.sourceFiles.map(({ path }) => path)).toEqual(
      [...artifact.sourceFiles.map(({ path }) => path)].sort(),
    );

    for (const file of artifact.sourceFiles) {
      const content = requiredContent(file, file.path);
      expect(content).not.toContain("\r");
      expect(file.checksum).toBe(sha256Digest(content));
      expect(new TextEncoder().encode(content)).toHaveLength(file.sizeBytes);
      expect(manifestByPath.get(file.path)).toEqual({
        path: file.path,
        checksum: file.checksum,
        semanticChecksum: file.semanticChecksum,
        mediaType: file.mediaType,
        sizeBytes: file.sizeBytes,
        ownership: file.ownership,
      });
    }

    expect(artifact.sourceManifestDigest).toBe(
      sha256Digest(canonicalJson(artifact.sourceManifest)),
    );
    expect(first.artifactDigest).toBe(sha256Digest(canonicalJson(artifact)));
    expect(artifact.coverageDigest).toBe(
      sha256Digest(canonicalJson(artifact.coverage)),
    );
    for (const envelope of artifact.buildContracts) {
      expect(envelope.contractDigest).toBe(
        sha256Digest(canonicalJson(envelope.contract)),
      );
      expect(envelope.contract.executionPolicy).toEqual({
        credentials: "deny",
        filesystem: "isolated",
        network: "deny",
        packageScripts: "deny",
        reproducible: true,
      });
      expect(envelope.contract.expectedArtifact.path).toBe(
        "application/artifacts/workload_notes_api/function.zip",
      );
    }

    expect(first.artifact.diagnostics).toEqual([]);
    expect(first.artifact.coverage).toMatchObject({
      state: "complete-supported-pattern",
      missingRequirements: [],
      workloads: [
        {
          state: "complete-supported-pattern",
          representedOperationIds: ["operation_create_note"],
          representedTestIds: [
            "test_contract_create_note",
            "test_unit_create_note",
          ],
          unresolvedBehaviorIds: [],
          missingRequirements: [],
        },
      ],
    });
    expect(
      first.artifact.sourceFiles.some((file) =>
        file.path.startsWith("application/tests/functions/notes_handler/"),
      ),
    ).toBe(true);
    expect(first.artifact.buildContracts).toHaveLength(1);
  });

  it("matches the separately pinned notes 1.1 CRUD source inventory", async () => {
    const result = generateApplication(
      createNotesGenerationRequest({
        identifierSafeGenerator: true,
        entityContractId: "contracts.repair-seed.entity",
        operations: ["create", "read", "update", "delete"],
      }),
    );
    expect(goldenProjection(result)).toEqual(
      await readGolden("notes-identifier-1.1-source.json"),
    );
  });
});
