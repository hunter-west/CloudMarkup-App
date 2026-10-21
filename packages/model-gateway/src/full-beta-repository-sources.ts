import { sha256Text } from "@cloudmarkup/schemas";

/** Reviewed synthetic input bytes, not provider results or hosted evidence.
 * Each commit identifies a reproducible Git object graph containing one file.
 * No GitHub repository, credential or customer content is represented here. */
const sources = [
  {
    caseKind: "external-existing-resource",
    evidenceId: "evidence_synthetic_repository_deterministic",
    path: "infrastructure/existing-resource.tf",
    sourceMode: "deterministic",
    content:
      'data "aws_dynamodb_table" "existing" {\n  name = "synthetic-existing-notes"\n}\n',
    commitSha: "07ec16cc01ca621de46bcf42e3491eb6e7eb2fa2",
  },
  {
    caseKind: "deterministic-repository-import",
    evidenceId: "evidence_synthetic_repository_deterministic",
    path: "infrastructure/main.tf",
    sourceMode: "deterministic",
    content:
      'resource "aws_dynamodb_table" "notes" {\n  name         = "synthetic-notes"\n  billing_mode = "PAY_PER_REQUEST"\n  hash_key     = "noteId"\n\n  attribute {\n    name = "noteId"\n    type = "S"\n  }\n\n  point_in_time_recovery { enabled = true }\n  server_side_encryption { enabled = true }\n}\n',
    commitSha: "a0f16fcb1d4c3bd4c2118c7b7c62df24c085aa24",
  },
  {
    caseKind: "ambiguous-source-code-inference",
    evidenceId: "evidence_synthetic_repository_ambiguous",
    path: "application/ambiguous-handler.ts",
    sourceMode: "ambiguous-model-inference",
    content:
      "// Synthetic evaluation input. The caller supplies the storage implementation.\n// No tenant identity, persistence technology, or ownership policy is specified.\nexport async function handle(\n  input: { key: string; value: unknown },\n  store: { put(key: string, value: unknown): Promise<void> },\n): Promise<{ accepted: true }> {\n  await store.put(input.key, input.value);\n  return { accepted: true };\n}\n",
    commitSha: "31e73baa12c9dfcd17f3a11de80a7677a42b4e97",
  },
  {
    caseKind: "designed-observed-mismatch",
    evidenceId: "evidence_synthetic_repository_mismatch",
    path: "infrastructure/observed-mismatch.tf",
    sourceMode: "deterministic",
    content:
      '// The designed resource with deployment key notes is a DynamoDB table.\n// This repository instead declares an S3 bucket; neither side is auto-updated.\nresource "aws_s3_bucket" "notes" {\n  bucket = "synthetic-observed-notes"\n}\n',
    commitSha: "ec949dec9d76e36b927d3aba9c7b7e87bc7d4c6f",
  },
] as const;
export const fullBetaRepositorySourcesV1 = Object.freeze(
  sources.map((source) =>
    Object.freeze({ ...source, contentDigest: sha256Text(source.content) }),
  ),
);
export type FullBetaRepositoryCaseKind = (typeof sources)[number]["caseKind"];
