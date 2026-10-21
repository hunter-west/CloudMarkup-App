import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../migrations/0010_provider_neutral_async_jobs.sql",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../../migrations/manifest.json",
  import.meta.url,
);

const families = [
  "intent-extraction",
  "architecture-proposal",
  "workload-contract-proposal",
  "graph-workload-operation-proposal",
  "iac-compilation",
  "application-source-generation",
  "application-build-test-package",
  "static-validation",
  "diagram-rendering",
  "combined-export-packaging",
  "github-repository-export",
  "customer-owned-plan-evidence",
  "deployment-evidence",
  "smoke-integration-evidence",
  "drift-evidence",
  "billing-usage-reconciliation",
] as const;

const statuses = [
  "queued",
  "running",
  "awaiting-user-input",
  "succeeded",
  "failed",
  "canceled",
  "expired",
  "superseded",
] as const;

describe("provider-neutral async-job migration", () => {
  it("pins migration 0010 after the canonical solution records", async () => {
    const [migration, manifestText] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(manifestUrl, "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as {
      readonly migrations: readonly {
        readonly checksumSha256: string;
        readonly file: string;
        readonly version: string;
      }[];
    };

    expect(
      manifest.migrations.find(({ version }) => version === "0010"),
    ).toEqual({
      checksumSha256: createHash("sha256").update(migration).digest("hex"),
      file: "0010_provider_neutral_async_jobs.sql",
      version: "0010",
    });
    expect(manifest.migrations.map(({ version }) => version)).toEqual([
      "0001",
      "0002",
      "0003",
      "0004",
      "0005",
      "0006",
      "0007",
      "0008",
      "0009",
      "0010",
      "0011",
      "0012",
      "0013",
      "0014",
      "0015",
      "0016",
      "0017",
      "0018",
      "0019",
      "0020",
      "0021",
      "0022",
      "0023",
      "0024",
      "0025",
      "0026",
      "0027",
      "0028",
      "0029",
      "0030",
      "0031",
      "0032",
      "0033",
      "0034",
      "0035",
      "0036",
      "0037",
      "0038",
      "0039",
      "0040",
      "0041",
      "0042",
      "0043",
      "0044",
      "0045",
      "0046",
      "0047",
      "0048",
      "0049",
      "0050",
      "0051",
      "0052",
      "0053",
      "0054",
      "0055",
      "0056",
      "0057",
      "0058",
      "0059",
      "0078",
      "0079",
      "0080",
      "0081",
      "0082",
      "0083",
      "0084",
      "0085",
      "0086",
      "0087",
      "0088",
      "0089",
      "0090",
      "0091",
      "0092",
      "0093",
      "0094",
      "0095",
      "0096",
      "0097",
      "0098",
      "0099",
      "0100",
      "0101",
      "0102",
      "0103",
      "0104",
      "0105",
      "0106",
      "0107",
      "0108",
      "0109",
      "0110",
      "0111",
      "0112",
      "0113",
      "0114",
      "0115",
      "0116",
      "0117",
      "0118",
      "0119",
      "0120",
      "0121",
      "0122",
      "0123",
      "0124",
      "0125",
      "0126",
      "0127",
      "0128",
      "0129",
      "0130",
      "0131",
      "0132",
      "0133",
      "0134",
      "0135",
      "0136",
      "0137",
      "0138",
    ]);
  });

  it("stores every v1 family and lifecycle state", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    families.forEach((family) => {
      expect(migration).toContain(`'${family}'`);
    });
    statuses.forEach((status) => {
      expect(migration).toContain(`'${status}'`);
    });
    expect(migration).toContain("CREATE TABLE async_jobs");
    expect(migration).toContain("CREATE TABLE async_job_attempts");
    expect(migration).toContain("CREATE TABLE async_job_checkpoints");
    expect(migration).toContain("CREATE TABLE async_job_events");
  });

  it("pins exact subjects, tenant ownership, limits, and idempotency", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("draft_version BIGINT");
    expect(migration).toContain("draft_strong_etag");
    expect(migration).toContain("draft_content_sha256");
    expect(migration).toContain("solution_revision_id");
    expect(migration).toContain("solution_manifest_record_id");
    expect(migration).toContain("solution_manifest_sha256");
    expect(migration).toContain(
      "UNIQUE (organization_id, idempotency_scope, idempotency_key_sha256)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (organization_id, project_id, solution_manifest_record_id)",
    );
    expect(migration).toContain("max_runtime_seconds");
    expect(migration).toContain("max_referenced_input_bytes");
    expect(migration).toContain("max_output_bytes");
    expect(migration).toContain("max_checkpoints");
    expect(migration).toContain("max_artifacts");
    expect(migration).toContain("max_inline_input_bytes");
    expect(migration).toContain("max_checkpoint_bytes");
  });

  it("keeps resumability, Evidence output, expiry, and audit references explicit", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("failure_classification");
    expect(migration).toContain("retry_disposition");
    expect(migration).toContain("lease_expires_at");
    expect(migration).toContain("heartbeat_at");
    expect(migration).toContain("resumed_from_checkpoint_id");
    expect(migration).not.toContain("resumable BOOLEAN");
    expect(migration).toContain("CREATE TABLE async_job_evidence_outputs");
    expect(migration).toContain("evidence_solution_record_id");
    expect(migration).toContain("environment_type");
    expect(migration).toContain("expires_at TIMESTAMPTZ");
    expect(migration).toContain("async_job_events_are_immutable");
    expect(migration).toContain("correlation_id");
  });

  it("stores bounded references rather than normal-record payload bodies", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("'input-payload'");
    expect(migration).toContain("'checkpoint-state'");
    expect(migration).toContain("'evidence'");
    expect(migration).not.toMatch(
      /raw_(?:input|output|prompt|response)|payload_json|credential_value|access_token|private_key|BYTEA/iu,
    );
  });
});
