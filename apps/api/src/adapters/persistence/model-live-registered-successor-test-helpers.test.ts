import { expect, it, vi } from "vitest";
import {
  loadRegisteredEvaluationSuccessor,
  requireRegisteredEvaluationSuccessor,
} from "./model-live-registered-successor-test-helpers.js";

it.each([
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
  "0131",
  "0134",
  "0135",
  "0136",
  "0137",
  "0138",
] as const)("admits only the complete reviewed %s ledger", async (version) => {
  const migrations = await loadRegisteredEvaluationSuccessor(version);
  const rows = migrations.map((migration) => ({
    version: migration.version,
    checksum_sha256: migration.checksumSha256,
    applied_at: "2026-09-18T00:00:00.000Z",
  }));
  const database = {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
  await expect(requireRegisteredEvaluationSuccessor(database)).resolves.toEqual(
    rows,
  );
  // Every inferred-version branch keeps its own valid prefix above. The common
  // count/order/checksum rejection loop needs the oldest and current boundary
  // prefixes, rather than another full source authentication for every version.
  if (version === "0138")
    await expect(
      requireRegisteredEvaluationSuccessor(database, "0059"),
    ).rejects.toThrow("complete exact registered prefix");
  if (version !== "0059" && version !== "0138") return;
  for (const invalid of [
    rows.slice(1),
    [...rows.slice(0, -1), { ...rows.at(-1), checksum_sha256: "0".repeat(64) }],
    [
      ...rows,
      {
        version: "0080",
        checksum_sha256: "0".repeat(64),
        applied_at: "2026-09-18T00:00:00.000Z",
      },
    ],
  ]) {
    database.query.mockResolvedValue({
      rows: invalid,
      rowCount: invalid.length,
    });
    await expect(
      requireRegisteredEvaluationSuccessor(database),
    ).rejects.toThrow("complete exact registered prefix");
  }
});

it("admits only the exact published 0098 plus additive 0138 fixture ledger", async () => {
  const current = await loadRegisteredEvaluationSuccessor("0138");
  const rows = [...current.slice(0, 80), ...current.slice(-1)].map(
    (migration) => ({
      version: migration.version,
      checksum_sha256: migration.checksumSha256,
      applied_at: "2026-10-15T00:00:00.000Z",
    }),
  );
  const database = {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
  const latest = rows.at(-1);
  if (!latest) throw Error("Expected reviewed staff-credit migration");
  await expect(requireRegisteredEvaluationSuccessor(database)).resolves.toEqual(
    rows,
  );
  for (const invalid of [
    rows.slice(1),
    [...rows.slice(0, -1), { ...latest, checksum_sha256: "0".repeat(64) }],
    [
      ...rows.slice(0, 40),
      ...rows.slice(41, 42),
      ...rows.slice(40, 41),
      ...rows.slice(42),
    ],
  ]) {
    database.query.mockResolvedValue({
      rows: invalid,
      rowCount: invalid.length,
    });
    await expect(
      requireRegisteredEvaluationSuccessor(database),
    ).rejects.toThrow("complete exact registered prefix");
  }
  database.query.mockResolvedValue({ rows, rowCount: rows.length });
  await expect(
    requireRegisteredEvaluationSuccessor(database, "0138"),
  ).rejects.toThrow("complete exact registered prefix");
});
