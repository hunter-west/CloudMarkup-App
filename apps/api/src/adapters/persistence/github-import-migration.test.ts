import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../migrations/0016_github_repository_import_sync.sql",
  import.meta.url,
);
const manifestUrl = new URL(
  "../../../migrations/manifest.json",
  import.meta.url,
);

describe("GitHub repository import and refresh migration", () => {
  it("pins the exact migration checksum after Prompt 40A", async () => {
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
    const entry = manifest.migrations.find(({ version }) => version === "0016");
    expect(entry).toEqual({
      checksumSha256: createHash("sha256").update(migration).digest("hex"),
      file: "0016_github_repository_import_sync.sql",
      version: "0016",
    });
  });

  it("preserves immutable snapshot history, review records, progress, and latest subscription configuration", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const table of [
      "github_repository_imports",
      "github_repository_import_progress_events",
      "github_repository_import_reviews",
      "github_repository_import_refresh_subscriptions",
      "github_repository_import_webhook_receipts",
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
    expect(migration).toContain(
      "UNIQUE (organization_id, project_id, idempotency_key_sha256)",
    );
    expect(migration).toContain(
      "UNIQUE (organization_id, project_id, subscription_id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (organization_id, project_id, subscription_id)",
    );
    expect(migration).toContain(
      "github_repository_import_reviews_are_immutable",
    );
    expect(migration).toContain("previous_import_id VARCHAR(128)");
    expect(migration).toContain("commit_sha VARCHAR(64) NOT NULL");
    expect(migration).toContain("snapshot_sha256 VARCHAR(71)");
    expect(migration).toContain(
      "terminal github repository import is immutable",
    );
    expect(migration).toContain(
      "github_repository_import_refresh_target_history_idx",
    );
    expect(migration).not.toContain("refresh_active_target_idx");
  });

  it("stores safe artifacts only and never declares token or raw-content columns", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    expect(migration).toContain("safe_result_json JSONB");
    expect(migration).toContain(
      "GitHub tokens and raw private repository bytes are never stored here",
    );
    expect(migration).not.toMatch(/(?:access|installation)_token\s+/iu);
    expect(migration).not.toMatch(/raw_(?:content|file|state)\s+/iu);
  });
});
