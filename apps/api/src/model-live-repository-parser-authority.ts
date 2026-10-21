import { z } from "zod";
import {
  REPOSITORY_IMPORTER_ID,
  REPOSITORY_IMPORTER_VERSION,
  verifyRepositoryImport,
  type RepositoryImportResultV1,
} from "@cloudmarkup/repository-importer";
import { sha256DigestSchema } from "@cloudmarkup/schemas";
import type { PinnedCompilerConfiguration } from "./adapters/pinned-go-executable.js";

/** Fixed host-version selection, never an importer execution override. */
export function requireModelLiveRepositoryImporter(
  expected: "1.0.1" | "1.0.2",
): void {
  if (REPOSITORY_IMPORTER_VERSION !== expected)
    throw new Error("The exact repository parser version is unavailable.");
}

/** Metadata only. Actual authority comes from the pinned parser, issued input
 * and completed scoped journal, never from parsing this shape. */
export const modelLiveRepositoryParserAuthorityV1Schema = z
  .object({
    importerId: z.literal("cloudmarkup.repository-importer"),
    importerVersion: z.literal("1.0.2"),
    snapshotDigest: sha256DigestSchema,
    resultDigest: sha256DigestSchema,
    compilerExecutableDigest: sha256DigestSchema,
  })
  .strict();

export function createModelLiveRepositoryParserAuthority(input: {
  readonly result: RepositoryImportResultV1;
  readonly expectedSnapshotDigest: string;
  readonly compiler: PinnedCompilerConfiguration;
}) {
  requireModelLiveRepositoryImporter("1.0.2");
  const snapshot = input.result.snapshot;
  const verification = verifyRepositoryImport(input.result);
  if (
    snapshot.importer.importerId !== REPOSITORY_IMPORTER_ID ||
    snapshot.importer.importerVersion !== REPOSITORY_IMPORTER_VERSION ||
    snapshot.snapshotDigest !== input.expectedSnapshotDigest ||
    input.result.facts.some(
      (fact) => fact.parser.version !== REPOSITORY_IMPORTER_VERSION,
    ) ||
    verification.errors.some(
      (error) => error.code === "cloudmarkup.import.result-integrity-invalid",
    ) ||
    !/^[a-f0-9]{64}$/u.test(input.compiler.executableSha256)
  )
    throw new Error("The actual repository parser evidence is unavailable.");
  // Negative conformance findings are valid observations and remain untouched.
  return modelLiveRepositoryParserAuthorityV1Schema.parse({
    importerId: snapshot.importer.importerId,
    importerVersion: snapshot.importer.importerVersion,
    snapshotDigest: snapshot.snapshotDigest,
    resultDigest: input.result.resultDigest,
    compilerExecutableDigest: "sha256:" + input.compiler.executableSha256,
  });
}

/** Frozen synthetic source + importer 1.0.2; not a parser execution receipt. */
export const MODEL_LIVE_IMPORTER_102_SNAPSHOT_DIGESTS: Readonly<
  Record<string, string>
> = Object.freeze({
  evaluation_case_external_existing_resource_full_beta_v1:
    "sha256:a5bf9cf1c617ddd88cd0e6da964b928cba5b819850d514a3d5e77947167a80bf",
  evaluation_case_deterministic_repository_import_full_beta_v1:
    "sha256:a2e18f93cf3954d1d7f29ac498f0594789e5899a2e2d8a3e503cf97f798a5885",
  evaluation_case_ambiguous_source_code_inference_full_beta_v1:
    "sha256:41ed7c1d13568ad5d2040b833a230b7ce5969b778c838b67eff6fad73055bae2",
  evaluation_case_designed_observed_mismatch_full_beta_v1:
    "sha256:a62c049d0a25d20ece52426261a1bd04c4f566018c6eacc515f749e831d49e3b",
});
