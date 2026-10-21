import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrations.js";

describe("canonical model reservation migration", () => {
  it("pins the twelve-statement addition and every historical SQL checksum", async () => {
    const loaded = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    // This historical migration's exact prefix stays fixed as later, separately
    // checked additions extend the current manifest.
    const migrations = loaded.filter(({ version }) => version <= "0028");
    expect(migrations).toHaveLength(28);
    expect(migrations.at(-1)).toMatchObject({
      version: "0028",
      file: "0028_model_commercial_accounting.sql",
      checksumSha256:
        "c9db4813af35f21aa4d0f22cd5b1b4075ae9fcbe104cea682214437cd1266890",
    });
    expect(migrations.at(-1)?.statements).toHaveLength(12);
    expect(
      migrations.reduce(
        (sum, migration) => sum + migration.statements.length,
        0,
      ),
    ).toBe(455);
    expect(migrations[26]).toMatchObject({
      version: "0027",
      checksumSha256:
        "7609a587fdd1b5392eadf8aa3aa6170a2becc5a7e327b070fdbfe5a0ec8804a9",
    });
    const prior = migrations
      .slice(0, 26)
      .map(({ version, file, checksumSha256 }) => ({
        version,
        file,
        checksumSha256,
      }));
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("bbf10bedb6b4845c94062a6b899b257589be9c388c5a2b9aaeacb17bc940e010");
    expect(
      migrations
        .slice(0, 27)
        .reduce((sum, migration) => sum + migration.statements.length, 0),
    ).toBe(443);
  });
});
