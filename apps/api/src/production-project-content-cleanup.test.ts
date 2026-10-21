import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { loadMigrations } from "./adapters/persistence/migrations.js";
import type {
  SqlDatabase,
  SqlRow,
  SqlResult,
} from "./adapters/persistence/sql.js";
import {
  createProjectCleanupScheduledHandler,
  readProjectCleanupEnvironment,
} from "./production-project-content-cleanup.js";

const account = "123456789012",
  region = "us-east-1";
const scheduleArn = `arn:aws:events:${region}:${account}:rule/cloudmarkup-beta-project-content-cleanup`;
function environment() {
  return {
    CLOUDMARKUP_ENVIRONMENT: "beta",
    AWS_REGION: region,
    CLOUDMARKUP_ACCOUNT_ID: account,
    CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
    CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: "true",
    CLOUDMARKUP_DATABASE_ARN: `arn:aws:rds:${region}:${account}:cluster:cloudmarkup-beta-postgresql`,
    CLOUDMARKUP_DATABASE_SECRET_ARN: `arn:aws:secretsmanager:${region}:${account}:secret:cloudmarkup-beta/database/admin-ABC123`,
    CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
    CLOUDMARKUP_CONTENT_BUCKET: `cloudmarkup-beta-${account}-${region}-content`,
    CLOUDMARKUP_CLEANUP_SCHEDULE_ARN: scheduleArn,
  };
}
function fixture(enabled = true) {
  const rows: SqlRow[] = [
    {
      version: "0138",
      checksum_sha256:
        "b5cd0bcb42f94baaa6266ed43e0222a89af7c4bd2b84535d9e6949a5c7a0ad4b",
    },
  ];
  const observed = vi.fn();
  const database: SqlDatabase = {
    query<T extends SqlRow>(): Promise<SqlResult<T>> {
      observed();
      return Promise.resolve({ rowCount: rows.length, rows: rows as T[] });
    },
    close: () => Promise.resolve(),
    transaction: async (work) => work(database),
  };
  const cleanup = {
    listPending: vi.fn(() =>
      Promise.resolve([
        { organizationId: "org_pending", projectId: "project_pending" },
      ]),
    ),
    process: vi.fn(() => Promise.resolve({ state: "completed" as const })),
  };
  const configuration = readProjectCleanupEnvironment({
    ...environment(),
    CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: String(enabled),
  });
  const handler = createProjectCleanupScheduledHandler({
    configuration,
    database,
    cleanup,
  });
  const event = {
    source: "aws.events",
    "detail-type": "Scheduled Event",
    account,
    region,
    resources: [scheduleArn],
  };
  return { handler, cleanup, observed, event, rows };
}
describe("the dedicated project content cleanup host", () => {
  it("binds the host and its fixture to the actual latest reviewed migration", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../migrations/", import.meta.url)),
    );
    const latest = migrations.at(-1);
    const preceding = migrations.at(-2);
    if (latest === undefined || preceding === undefined)
      throw new Error("Expected reviewed migration history.");
    expect(latest.version).toBe("0138");
    expect(environment().CLOUDMARKUP_EXPECTED_SCHEMA_VERSION).toBe(
      latest.version,
    );
    const f = fixture();
    expect(f.rows).toEqual([
      { version: latest.version, checksum_sha256: latest.checksumSha256 },
    ]);
    await expect(f.handler(f.event)).resolves.toMatchObject({
      enabled: true,
      considered: 1,
    });
    const stale = fixture();
    stale.rows.splice(0, stale.rows.length, {
      version: latest.version,
      checksum_sha256: preceding.checksumSha256,
    });
    await expect(stale.handler(stale.event)).rejects.toThrow();
    expect(stale.cleanup.listPending).not.toHaveBeenCalled();
  });
  it("has an explicit disabled state with no database or storage work", async () => {
    const f = fixture(false);
    expect(await f.handler(null)).toEqual({ enabled: false });
    expect(f.observed).not.toHaveBeenCalled();
    expect(f.cleanup.listPending).not.toHaveBeenCalled();
  });
  it.each(Object.keys(environment()))(
    "requires a valid exact %s setting",
    (key) => {
      expect(() =>
        readProjectCleanupEnvironment({ ...environment(), [key]: "" }),
      ).toThrow();
      expect(() =>
        readProjectCleanupEnvironment({
          ...environment(),
          [key]: "unexpected",
        }),
      ).toThrow();
    },
  );
  it.each([
    null,
    {},
    { source: "other" },
    { account: "999999999999" },
    { region: "eu-west-1" },
    { resources: [] },
    { resources: [scheduleArn, scheduleArn] },
    { resources: [scheduleArn + "-other"] },
    { "detail-type": "other" },
  ])(
    "rejects invalid delivery before any data access (%j)",
    async (override) => {
      const f = fixture();
      const event = override === null ? null : { ...f.event, ...override };
      // An empty override is a valid envelope; test the genuinely empty event.
      await expect(
        f.handler(
          override !== null && Object.keys(override).length === 0 ? {} : event,
        ),
      ).rejects.toThrow();
      expect(f.observed).not.toHaveBeenCalled();
      expect(f.cleanup.process).not.toHaveBeenCalled();
    },
  );
  it.each([
    { rows: [] },
    { rows: [{ version: "0138" }] },
    {
      rows: [
        {
          version: "0055",
          checksum_sha256:
            "aaa6e796d8139ab3d3789de119d46f429232585f4b4c20778674c2379a797237",
        },
      ],
    },
    {
      rows: [
        {
          version: "0057",
          checksum_sha256:
            "67b5381a6e46f30d3b71635d7fddd6d047a73c66e808106a21e685697a656184",
        },
      ],
    },
    {
      rows: [
        {
          version: "0136",
          checksum_sha256:
            "b058d620143fb9924fb07f2f43317b25c9112a8d695549121140adbde338d778",
        },
      ],
    },
    {
      rows: [
        {
          version: "0138",
          checksum_sha256:
            "67b5381a6e46f30d3b71635d7fddd6d047a73c66e808106a21e685697a656184",
        },
      ],
    },
    { rows: [{ version: "0138", checksum_sha256: "0".repeat(64) }] },
  ])(
    "requires the exact migration ledger before listing candidates",
    async ({ rows }) => {
      const f = fixture();
      if (
        rows[0]?.version === "0138" &&
        !Object.hasOwn(rows[0], "checksum_sha256")
      ) {
        const control = fixture();
        await expect(control.handler(control.event)).resolves.toMatchObject({
          enabled: true,
          considered: 1,
        });
      }
      f.rows.splice(0, f.rows.length, ...rows);
      await expect(f.handler(f.event)).rejects.toThrow(
        "The cleanup schema binding is invalid.",
      );
      expect(f.cleanup.listPending).not.toHaveBeenCalled();
    },
  );
  it("selects one canonical pending project and returns no project identifiers", async () => {
    const f = fixture();
    expect(
      await f.handler({
        ...f.event,
        detail: { projectId: "attacker-selected" },
      }),
    ).toEqual({ enabled: true, considered: 1, completed: 1, pending: 0 });
    expect(f.cleanup.listPending).toHaveBeenCalledWith(1);
    expect(f.cleanup.process).toHaveBeenCalledWith({
      organizationId: "org_pending",
      projectId: "project_pending",
    });
  });
});
