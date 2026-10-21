import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../migrations/0013_model_gateway_commercial_lifecycle.sql",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../../migrations/manifest.json",
  import.meta.url,
);

describe("Prompt 34A model commercial migration", () => {
  it("pins migration 0013 after the Solution Export read model", async () => {
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
      manifest.migrations.find(({ version }) => version === "0013"),
    ).toEqual({
      checksumSha256: createHash("sha256").update(migration).digest("hex"),
      file: "0013_model_gateway_commercial_lifecycle.sql",
      version: "0013",
    });
    expect(
      manifest.migrations.findIndex(({ version }) => version === "0013"),
    ).toBe(
      manifest.migrations.findIndex(({ version }) => version === "0012") + 1,
    );
  });

  it("keeps pricing and normalization immutable, effective-dated, and separate", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    expect(migration).toContain("CREATE TABLE model_provider_pricing_versions");
    expect(migration).toContain(
      "CREATE TABLE credit_normalization_policy_versions",
    );
    expect(migration).toContain(
      "model_provider_pricing_windows_do_not_overlap",
    );
    expect(migration).toContain(
      "credit_normalization_policy_windows_do_not_overlap",
    );
    expect(migration).toContain(
      "model_provider_pricing_versions_are_immutable",
    );
    expect(migration).toContain(
      "credit_normalization_policy_versions_are_immutable",
    );
    expect(migration).toContain("disabled-pricing-unavailable");
    expect(migration).toContain("operating_buffer_basis_points");
    expect(migration).toContain("credit_unit_micros");
    expect(migration).not.toContain("stripe_price");
  });

  it("attaches append-only model detail to the canonical Prompt 24A ledger", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    expect(migration).toContain("CREATE TABLE model_usage_event_details");
    expect(migration).toContain(
      "REFERENCES usage_ledger_entries(organization_id, ledger_entry_id)",
    );
    expect(migration).toContain("model_usage_event_details_are_immutable");
    expect(migration).toContain("canonical_model_usage_events_v1");
    expect(migration).toContain("related_credit_ledger_event_id");
    expect(migration).toContain("model_usage_event_id");
    expect(migration).toContain("model_usage_idempotency_key_sha256");
    expect(migration).toContain("multi_call_workflow_id");
    expect(migration).toContain("reconciliation_state");
  });

  it("stores complete technical units and explicitly blocks raw model content", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const field of [
      "input_units",
      "output_units",
      "cache_read_units",
      "cache_write_units",
      "total_units",
      "provider_specific_units",
      "estimated_provider_cost_micros",
      "reserved_credit_units",
      "charged_credit_units",
      "compensated_credit_units",
      "attempts",
      "latency_milliseconds",
      "failure_category",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain(
      '"(rawPrompt|rawResponse|promptText|responseText)"',
    );
    expect(migration).not.toMatch(
      /raw_prompt\s+(?:TEXT|JSONB)|raw_response\s+(?:TEXT|JSONB)/iu,
    );
  });
});
