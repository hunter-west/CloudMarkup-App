import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import {
  canonicalSemanticDigest,
  sha256Digest,
  solutionExportManifestV1Schema,
} from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import {
  applyArchitectureRepositoryUpdate,
  loadArchitectureRepository,
  planArchitectureRepositoryUpdate,
} from "./repository.js";
import {
  architectureCliFixtureArtifact,
  writeArchitectureCliFixtureRepository,
} from "./test-fixtures.js";

async function withFixture(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await writeArchitectureCliFixtureRepository();
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe("architecture CLI repository boundary", () => {
  it("loads a canonical locked manifest and complete regular-file inventory", async () => {
    await withFixture(async (root) => {
      const repository = await loadArchitectureRepository(root);
      expect(repository.files.has("infrastructure/main.tf")).toBe(true);
      expect(repository.lock.solutionRevision.id).toBe(
        repository.solutionRevision.solutionRevisionId,
      );
    });
  });

  it("rejects lock/version substitution without exposing file content", async () => {
    await withFixture(async (root) => {
      const lockPath = join(root, "cloudmarkup", "cloudmarkup.lock.json");
      const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
        solutionRevision: { digest: string };
      };
      lock.solutionRevision.digest = `sha256:${"0".repeat(64)}`;
      await writeFile(lockPath, serializeCanonicalJson(lock));

      await expect(loadArchitectureRepository(root)).rejects.toThrow(
        "bindings differ",
      );
    });
  });

  it("rejects unmanifested output and links", async () => {
    await withFixture(async (root) => {
      await writeFile(
        join(root, "infrastructure", "orphan.tf"),
        'resource "x" "y" {}\n',
      );
      await expect(loadArchitectureRepository(root)).rejects.toThrow(
        "unmanifested output",
      );
    });
  });

  it("validates present root workflow inventory, permits omission, and ignores unrelated workflows", async () => {
    await withFixture(async (root) => {
      const workflowPath = ".github/workflows/cloudmarkup-validate.yml";
      const workflowBytes = new TextEncoder().encode(
        ["name: CloudMarkup validation", ""].join(String.fromCharCode(10)),
      );
      const manifestPath = join(
        root,
        "cloudmarkup",
        "cloudmarkup.manifest.json",
      );
      const manifest = solutionExportManifestV1Schema.parse(
        JSON.parse(await readFile(manifestPath, "utf8")),
      );
      const provenance = manifest.files[0]?.provenance;
      if (provenance === undefined) {
        throw new Error("Fixture requires one manifest file.");
      }
      const workflowDirectory = join(root, ".github", "workflows");
      await mkdir(workflowDirectory, { recursive: true });
      await writeFile(join(root, ...workflowPath.split("/")), workflowBytes);
      await writeFile(
        join(workflowDirectory, "customer-owned.yml"),
        ["name: Customer workflow", ""].join(String.fromCharCode(10)),
      );
      const workflowEntry = {
        checksum: sha256Digest(workflowBytes),
        mediaType: "application/yaml" as const,
        ownership: "generated-replaceable" as const,
        path: workflowPath,
        provenance,
        semanticChecksum: canonicalSemanticDigest(
          "application/yaml",
          workflowBytes,
        ),
        sizeBytes: workflowBytes.byteLength,
      };
      const nextManifest = solutionExportManifestV1Schema.parse({
        ...manifest,
        repositoryWorkflows: {
          configDigest: sha256Digest("workflow-config"),
          contractVersion: 1,
          dependencyLockDigests: [
            { digest: sha256Digest("action-pins"), id: "action-pin-registry" },
          ],
          files: [workflowEntry],
          generator: provenance.producer,
          inclusionPolicy:
            "explicit-workflow-permission-and-confirmation-required",
          kind: "cloudmarkup.reviewed-repository-workflows",
          pinRegistryDigest: sha256Digest("action-pins"),
          policyDigest: sha256Digest("workflow-policy"),
          repository: { destinationFolder: "", state: "portable-unbound" },
          requiredPackageTrees: [],
          resultDigest: sha256Digest("workflow-result"),
          review: {
            environments: [],
            permissions: [
              {
                access: "read",
                explanation: "Reads reviewed package files.",
                scope: "contents",
                workflowPath,
              },
            ],
            roles: [],
            secrets: [],
            triggers: [{ events: ["pull_request"], workflowPath }],
            variables: [],
            workflows: [
              {
                environmentScoped: false,
                path: workflowPath,
                purpose: "Validate reviewed package files",
              },
            ],
            warnings: [],
          },
          solutionRevision: manifest.solutionRevision,
          validator: provenance.producer,
        },
        ownership: [
          ...manifest.ownership,
          {
            conflictBehavior: "replace-only-when-baseline-matches",
            ownership: "generated-replaceable",
            path: workflowPath,
            regeneration: "verified-replacement",
          },
        ],
      });
      await writeFile(manifestPath, serializeCanonicalJson(nextManifest));

      const repository = await loadArchitectureRepository(root);
      expect(repository.files.has(workflowPath)).toBe(true);
      expect(repository.files.has(".github/workflows/customer-owned.yml")).toBe(
        false,
      );
      await rm(join(root, ...workflowPath.split("/")));
      const workflowless = await loadArchitectureRepository(root);
      expect(workflowless.files.has(workflowPath)).toBe(false);
    });
  });

  it("retains mandatory legacy manifest-file workflow compatibility", async () => {
    await withFixture(async (root) => {
      const workflowPath = ".github/workflows/cloudmarkup-validate.yml";
      const workflowBytes = new TextEncoder().encode("name: legacy\n");
      const manifestPath = join(
        root,
        "cloudmarkup",
        "cloudmarkup.manifest.json",
      );
      const manifest = solutionExportManifestV1Schema.parse(
        JSON.parse(await readFile(manifestPath, "utf8")),
      );
      const provenance = manifest.files[0]?.provenance;
      if (provenance === undefined) {
        throw new Error("Missing fixture provenance.");
      }
      await mkdir(join(root, ".github", "workflows"), { recursive: true });
      await writeFile(join(root, ...workflowPath.split("/")), workflowBytes);
      const legacyManifest = solutionExportManifestV1Schema.parse({
        ...manifest,
        files: [
          ...manifest.files,
          {
            checksum: sha256Digest(workflowBytes),
            mediaType: "application/yaml",
            ownership: "generated-replaceable",
            path: workflowPath,
            provenance,
            semanticChecksum: canonicalSemanticDigest(
              "application/yaml",
              workflowBytes,
            ),
            sizeBytes: workflowBytes.byteLength,
          },
        ],
        ownership: [
          ...manifest.ownership,
          {
            conflictBehavior: "replace-only-when-baseline-matches",
            ownership: "generated-replaceable",
            path: workflowPath,
            regeneration: "verified-replacement",
          },
        ],
      });
      await writeFile(manifestPath, serializeCanonicalJson(legacyManifest));
      expect(
        (await loadArchitectureRepository(root)).files.has(workflowPath),
      ).toBe(true);
      await rm(join(root, ...workflowPath.split("/")));
      await expect(loadArchitectureRepository(root)).rejects.toThrow();
    });
  });
  it("plans and applies only baseline-matched generated replacement", async () => {
    await withFixture(async (root) => {
      const repository = await loadArchitectureRepository(root);
      const changed = architectureCliFixtureArtifact(true);
      const plan = planArchitectureRepositoryUpdate(repository, changed);
      expect(plan.writes.map(({ path }) => path)).toEqual([
        "infrastructure/main.tf",
        "cloudmarkup/cloudmarkup.manifest.json",
      ]);

      await applyArchitectureRepositoryUpdate(repository, changed);
      expect(
        await readFile(join(root, "infrastructure", "main.tf"), "utf8"),
      ).toContain(">= 1.9.0");
    });
  });

  it("fails closed on malicious paths and user-owned conflicts", async () => {
    await withFixture(async (root) => {
      const repository = await loadArchitectureRepository(root);
      const artifact = architectureCliFixtureArtifact();
      const firstFile = artifact.files[0];
      if (firstFile === undefined)
        throw new Error("Fixture requires one file.");
      const unsafe = {
        ...artifact,
        files: [
          ...artifact.files,
          {
            ...firstFile,
            path: "../outside.txt",
          },
        ],
      };
      expect(() =>
        planArchitectureRepositoryUpdate(repository, unsafe),
      ).toThrow();

      const windowsPath = {
        ...artifact,
        files: [
          ...artifact.files,
          { ...firstFile, path: "infrastructure\\outside.tf" },
        ],
      };
      expect(() =>
        planArchitectureRepositoryUpdate(repository, windowsPath),
      ).toThrow();

      const changed = architectureCliFixtureArtifact(true);
      const userOwned = {
        ...changed,
        files: changed.files.map((entry) =>
          entry.path === "infrastructure/main.tf"
            ? { ...entry, ownership: "user-provided" as const }
            : entry,
        ),
      };
      expect(() =>
        planArchitectureRepositoryUpdate(repository, userOwned),
      ).toThrow("cannot replace non-generated");
      expect(await lstat(root)).toBeDefined();
    });
  });
});
