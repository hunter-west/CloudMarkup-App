import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { splitPostgresStatements } from "./migrations.js";

const migrationUrl = new URL(
  "../../../migrations/0018_billing_audit_target_compatibility.sql",
  import.meta.url,
);
const stripeMigrationUrl = new URL(
  "../../../migrations/0008_stripe_billing_adapter.sql",
  import.meta.url,
);
const githubExportMigrationUrl = new URL(
  "../../../migrations/0014_github_app_repository_export.sql",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../../migrations/manifest.json",
  import.meta.url,
);

const allowedTargetKinds = [
  "organization",
  "membership",
  "project",
  "draft",
  "revision",
  "artifact",
  "integration",
  "billing-account",
  "installation",
  "repository",
  "preview",
  "webhook",
  "export",
  "job",
] as const;

describe("billing audit target compatibility migration", () => {
  it("pins additive migration 0018 after 0017 without changing historical migrations", async () => {
    const [migration, stripeMigration, githubExportMigration, manifestText] =
      await Promise.all([
        readFile(migrationUrl),
        readFile(stripeMigrationUrl),
        readFile(githubExportMigrationUrl),
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
      manifest.migrations.find(({ version }) => version === "0018"),
    ).toEqual({
      checksumSha256: createHash("sha256").update(migration).digest("hex"),
      file: "0018_billing_audit_target_compatibility.sql",
      version: "0018",
    });
    expect(
      manifest.migrations.findIndex(({ version }) => version === "0018"),
    ).toBe(
      manifest.migrations.findIndex(({ version }) => version === "0017") + 1,
    );
    expect(manifest.migrations.at(-1)?.version).toBe("0138");
    expect(createHash("sha256").update(stripeMigration).digest("hex")).toBe(
      "bc85458cf94571e8c766889e0b44d2ef13e21cfe3a6269fba0ac6795cb6e849c",
    );
    expect(
      createHash("sha256").update(githubExportMigration).digest("hex"),
    ).toBe("0ae026617c28409031e1eaa900835acb6ab0bca08b7ca38be80cbe7618942791");
  });

  it("restores billing-account while keeping unsupported target kinds rejected by an exact whitelist", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const statements = splitPostgresStatements(migration);
    const targetKindsCheck =
      /ADD CONSTRAINT audit_events_target_kind_check CHECK \(\s*target_kind IN \(([\s\S]*?)\)\s*\)/u.exec(
        migration,
      );
    const targetKinds = [
      ...(targetKindsCheck?.[1] ?? "").matchAll(/'([^']+)'/gu),
    ].map((match) => match[1]);

    expect(statements).toHaveLength(1);
    expect(migration.match(/ALTER TABLE audit_events/gu)).toHaveLength(1);
    expect(migration.match(/DROP CONSTRAINT/gu)).toHaveLength(1);
    expect(migration.match(/ADD CONSTRAINT/gu)).toHaveLength(1);
    expect(targetKindsCheck?.[1]).toBeDefined();
    expect(targetKinds).toEqual(allowedTargetKinds);
    expect(new Set(targetKinds).size).toBe(allowedTargetKinds.length);
    expect(migration).not.toContain("audit_events_target_kind_v2_check");
    expect(migration).not.toMatch(/\b(?:DELETE|INSERT|TRUNCATE|UPDATE)\b/iu);
  });
});
