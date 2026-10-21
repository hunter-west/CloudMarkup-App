import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import {
  canonicalSemanticDigest,
  encodeUtf8,
  sha256Digest,
  solutionExportManifestV1Schema,
  type SolutionExportFileV1,
} from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import {
  ARCHITECTURE_CLI_EXIT_CODES,
  architectureCliCommandResultV1Schema,
} from "./contracts.js";
import { runArchitectureCliExecutable } from "./executable.js";
import {
  ARCHITECTURE_CLI_CONFORMANCE_INPUT_PATH,
  createManifestDeclaredConformancePortV1,
} from "./manifest-conformance-source.js";
import { writeArchitectureCliFixtureRepository } from "./test-fixtures.js";

const ENVIRONMENT_ID = "environment.cli" as const;
const MANIFEST_PATH = "cloudmarkup/cloudmarkup.manifest.json" as const;
const VERIFIED_AT = "2026-08-29T11:30:00.000Z" as const;
const EVALUATED_AT = "2026-08-29T12:00:00.000Z" as const;
const evidenceByLayer = {
  designed: "approved-documents",
  imported: "repository-snapshot",
  generated: "generated-manifest",
  planned: "cloud-plan-change-set",
  deployed: "deployment-smoke-integration",
  "current-drift": "read-only-drift",
} as const;
const sourceKindByLayer = {
  designed: "architecture-document",
  imported: "repository-snapshot",
  generated: "generated-manifest",
  planned: "terraform-plan",
  deployed: "deployment-attestation",
  "current-drift": "read-only-drift-result",
} as const;
const layers = [
  "designed",
  "imported",
  "generated",
  "planned",
  "deployed",
  "current-drift",
] as const;

async function installConformanceInput(
  root: string,
  ownership: SolutionExportFileV1["ownership"] = "evidence-artifact",
) {
  const manifestPath = join(root, ...MANIFEST_PATH.split("/"));
  const manifest = solutionExportManifestV1Schema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const provenance = manifest.files[0]?.provenance;
  if (provenance === undefined) {
    throw new Error("The CLI fixture requires one manifest provenance record.");
  }
  const revision = manifest.solutionRevision;
  const document = {
    contractVersion: 1,
    evaluation: {
      contractVersion: 1,
      environment: {
        environmentId: ENVIRONMENT_ID,
        environmentType: "test",
      },
      evaluatedSolutionRevision: revision,
      layers: layers.map((layer) => ({
        availability: "available",
        boundSolutionRevision: revision,
        completeness: "complete",
        declaredFreshness: "current",
        evidenceIds: [`evidence.${layer}`],
        evidenceType: evidenceByLayer[layer],
        ...(layer === "planned" ||
        layer === "deployed" ||
        layer === "current-drift"
          ? { environmentId: ENVIRONMENT_ID }
          : {}),
        ...(layer === "planned" || layer === "current-drift"
          ? { explicitExpiresAt: "2026-08-29T13:00:00.000Z" }
          : {}),
        facts: [],
        integrity: "verified",
        layer,
        sources: [
          {
            digest: sha256Digest(`source:${layer}`),
            kind: sourceKindByLayer[layer],
            observedAt: VERIFIED_AT,
            solutionRevisionId: revision.id,
            sourceId: `source.${layer}`,
          },
        ],
        verifiedAt: VERIFIED_AT,
      })),
      projectId: "project.cli",
    },
    kind: "cloudmarkup.continuous-conformance-input",
  } as const;
  const bytes = encodeUtf8(serializeCanonicalJson(document));
  const entry = {
    checksum: sha256Digest(bytes),
    mediaType: "application/json" as const,
    ownership,
    path: ARCHITECTURE_CLI_CONFORMANCE_INPUT_PATH,
    provenance,
    semanticChecksum: canonicalSemanticDigest("application/json", bytes),
    sizeBytes: bytes.byteLength,
  };
  const nextManifest = solutionExportManifestV1Schema.parse({
    ...manifest,
    files: [...manifest.files, entry].sort((left, right) =>
      left.path === right.path ? 0 : left.path < right.path ? -1 : 1,
    ),
    ownership: [
      ...manifest.ownership,
      {
        conflictBehavior:
          ownership === "generated-replaceable"
            ? "replace-only-when-baseline-matches"
            : "fail-closed",
        ownership,
        path: ARCHITECTURE_CLI_CONFORMANCE_INPUT_PATH,
        regeneration:
          ownership === "generated-replaceable"
            ? "verified-replacement"
            : "never",
      },
    ].sort((left, right) =>
      left.path === right.path ? 0 : left.path < right.path ? -1 : 1,
    ),
  });
  const inputPath = join(
    root,
    ...ARCHITECTURE_CLI_CONFORMANCE_INPUT_PATH.split("/"),
  );
  await mkdir(join(inputPath, ".."), { recursive: true });
  await writeFile(inputPath, bytes);
  await writeFile(manifestPath, serializeCanonicalJson(nextManifest));
  return { bytes, inputPath };
}

async function runConformance(root: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runArchitectureCliExecutable({
    args: [
      "conformance",
      "--root",
      root,
      "--environment",
      ENVIRONMENT_ID,
      "--format",
      "json",
    ],
    conformance: createManifestDeclaredConformancePortV1({
      clock: () => new Date(EVALUATED_AT),
    }),
    registrations: [],
    stderr: { write: (value) => stderr.push(value) },
    stdout: { write: (value) => stdout.push(value) },
  });
  expect(stderr).toEqual([]);
  const result = architectureCliCommandResultV1Schema.parse(
    JSON.parse(stdout.join("")),
  );
  expect(exitCode).toBe(result.exitCode);
  return result;
}

describe("manifest-declared CLI conformance source", () => {
  it("admits canonical manifest bytes but never promotes self-attested cloud layers", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      const { bytes, inputPath } = await installConformanceInput(root);
      expect(new Uint8Array(await readFile(inputPath))).toEqual(bytes);

      const result = await runConformance(root);

      expect(result).toMatchObject({
        conformance: {
          layers: layers.map((layer) => ({
            availability: "unavailable",
            completeness: "unknown",
            freshness: "invalid",
            layer,
          })),
          mutationPolicy: "review-only-no-auto-remediation",
        },
        evidence: { current: 0, failed: 6, stale: 0 },
        exitCode: ARCHITECTURE_CLI_EXIT_CODES.drift,
        state: "drift",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when admitted conformance bytes no longer match their manifest checksum", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      const { bytes, inputPath } = await installConformanceInput(root);
      await writeFile(inputPath, new Uint8Array([...bytes, 0x20]));

      await expect(runConformance(root)).resolves.toMatchObject({
        diagnostics: [{ code: "cloudmarkup.cli.repository-invalid" }],
        exitCode: ARCHITECTURE_CLI_EXIT_CODES.validation,
        state: "failed",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when conformance bytes are not listed by the export manifest", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      const inputPath = join(
        root,
        ...ARCHITECTURE_CLI_CONFORMANCE_INPUT_PATH.split("/"),
      );
      await mkdir(join(inputPath, ".."), { recursive: true });
      await writeFile(inputPath, "{}\n");

      await expect(runConformance(root)).resolves.toMatchObject({
        diagnostics: [{ code: "cloudmarkup.cli.repository-invalid" }],
        exitCode: ARCHITECTURE_CLI_EXIT_CODES.validation,
        state: "failed",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when the manifest gives conformance bytes generated-file ownership", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      await installConformanceInput(root, "generated-replaceable");

      await expect(runConformance(root)).resolves.toMatchObject({
        diagnostics: [{ code: "cloudmarkup.cli.pipeline-failed" }],
        exitCode: ARCHITECTURE_CLI_EXIT_CODES.pipeline,
        state: "failed",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
