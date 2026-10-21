import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrations.js";

describe("canonical model terminal accounting migration", () => {
  it("pins the additive terminal bridge and unchanged historical migrations", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    const prefix = migrations.filter(({ version }) => version <= "0029");
    expect(prefix).toHaveLength(29);
    expect(prefix.at(-1)).toMatchObject({
      version: "0029",
      file: "0029_model_commercial_terminal_accounting.sql",
      checksumSha256:
        "5a645ed4cbdc1cf9799f959a7391f74cac55629ebf4bd96522c755cf4c0d5efc",
    });
    expect(prefix.at(-1)?.statements).toHaveLength(11);
    expect(
      prefix.reduce((sum, entry) => sum + entry.statements.length, 0),
    ).toBe(466);
    const prior = prefix
      .slice(0, 28)
      .map(({ version, file, checksumSha256 }) => ({
        version,
        file,
        checksumSha256,
      }));
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("f1dd9dc0b5c6bfbf89da90110ec3d42dcf2525d31d484e6e861a95beaf8966e1");
  });
});
