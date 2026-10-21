import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../migrations/0009_canonical_solution_records.sql",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../../migrations/manifest.json",
  import.meta.url,
);

const recordKinds = [
  "repository-snapshot",
  "observed-solution",
  "reconciliation-proposal",
  "solution-revision-manifest",
  "ai-authored-extension",
  "active-issue",
  "evidence",
] as const;

describe("canonical solution-record migration", () => {
  it("pins migration 0009 after the existing immutable sequence", async () => {
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
    const entry = manifest.migrations.find(({ version }) => version === "0009");

    expect(entry).toEqual({
      checksumSha256: createHash("sha256").update(migration).digest("hex"),
      file: "0009_canonical_solution_records.sql",
      version: "0009",
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

  it("admits every canonical record kind as matching object metadata", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    recordKinds.forEach((kind) => {
      expect(
        migration.match(new RegExp(`'${kind}'`, "gu"))?.length ?? 0,
      ).toBeGreaterThanOrEqual(2);
    });
    expect(migration).toContain(
      "object_record.object_purpose = NEW.record_kind",
    );
    expect(migration).toContain(
      "object_record.content_sha256 = NEW.content_sha256",
    );
  });

  it("enforces tenant ownership, immutable lineage, and one manifest per Solution Revision", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain(
      "FOREIGN KEY (organization_id, project_id, content_object_id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (organization_id, project_id, architecture_revision_id)",
    );
    expect(migration).toContain("previous_solution_record_id");
    expect(migration).toContain("solution_records_are_immutable");
    expect(migration).toContain("reject_immutable_row_change()");
    expect(migration).toContain("solution_manifest_identity_unique_idx");
    expect(migration).toContain(
      "ON solution_records (organization_id, project_id, subject_id)",
    );
    expect(migration).toContain(
      "WHERE record_kind = 'solution-revision-manifest'",
    );
  });

  it("keeps legacy revisions and sensitive payloads untouched", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).not.toMatch(/ALTER TABLE architecture_revisions/iu);
    expect(migration).not.toMatch(
      /(?:raw_prompt|prompt_text|credential|secret_value|repository_token|payload_bytes)/iu,
    );
  });
});
