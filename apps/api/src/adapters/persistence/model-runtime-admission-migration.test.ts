import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrations.js";

describe("additive normal-runtime metadata migration", () => {
  it("pins the fourteen-statement addition and every previous migration checksum", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    expect(migrations).toHaveLength(120);
    const admissionMigration = migrations.find(
      ({ version }) => version === "0027",
    );
    expect(admissionMigration).toMatchObject({
      version: "0027",
      file: "0027_model_runtime_admissions.sql",
      checksumSha256:
        "7609a587fdd1b5392eadf8aa3aa6170a2becc5a7e327b070fdbfe5a0ec8804a9",
    });
    expect(admissionMigration?.statements).toHaveLength(14);
    expect(
      migrations.reduce(
        (sum, migration) => sum + migration.statements.length,
        0,
      ),
    ).toBe(1367);
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
        .slice(0, 26)
        .reduce((sum, migration) => sum + migration.statements.length, 0),
    ).toBe(429);
  });
});
