import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrations.js";

describe("additive original preview authority migration", () => {
  it("pins eight metadata-only statements, exact manifest and unchanged first thirty SQL identities", async () => {
    const currentMigrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    // Keep this historical schema-31 proof independent of later additions.
    const migrations = currentMigrations.slice(0, 31);
    expect(migrations).toHaveLength(31);
    expect(
      migrations.reduce((total, item) => total + item.statements.length, 0),
    ).toBe(477);
    expect(migrations.at(-1)).toMatchObject({
      version: "0031",
      file: "0031_ai_intent_preview_authorities.sql",
      checksumSha256:
        "ea47087d559a9957209b255819f8a4a273a4a1aa8354ce9eb3c554123bb607db",
    });
    expect(migrations.at(-1)?.statements).toHaveLength(8);
    const manifest = {
      storageContractVersion: 1,
      migrations: migrations.map(({ version, file, checksumSha256 }) => ({
        version,
        file,
        checksumSha256,
      })),
    };
    const digest = (value: unknown) =>
      createHash("sha256")
        .update(JSON.stringify(value, null, 2) + "\n")
        .digest("hex");
    expect(digest(manifest)).toBe(
      "e27e942f8e4e502cdda0c7ed1698e321c979bf92d13edd03268e81aeebba8a24",
    );
    expect(
      digest({ ...manifest, migrations: manifest.migrations.slice(0, 30) }),
    ).toBe("212b028d6e2dba0904aa748e83e2606523b27383b06f900281a089f4a33be447");
    expect(
      migrations
        .slice(0, 30)
        .reduce((total, item) => total + item.statements.length, 0),
    ).toBe(469);
  });
});
