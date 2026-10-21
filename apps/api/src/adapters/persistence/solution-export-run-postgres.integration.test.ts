import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { PostgresSolutionExportRunRepository } from "./solution-export-run-repository.js";
import { persistedExportRunFixture } from "./solution-export-run-test-helpers.js";
import { sql, type SqlDatabase } from "./sql.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_export_run_it_${nonce}`;
const marker = `CloudMarkup synthetic prepared export journal ${nonce}`;
function loopbackUrl(): string {
  let parsed: URL;
  try {
    parsed = new URL(configuredUrl ?? "");
  } catch {
    throw new Error("An explicit loopback PostgreSQL URL is required.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  )
    throw new Error(
      "Only an explicit loopback PostgreSQL database without overrides is supported.",
    );
  return configuredUrl ?? "";
}

integrationDescribe(
  "prepared export journal on isolated real PostgreSQL",
  () => {
    let admin: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let created = false;
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_export_run_it_[a-f0-9]{32}$/u.test(schema))
        throw new Error("Unsafe synthetic schema.");
      admin = new PostgresDatabase({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      await admin.transaction(async (tx) => {
        await tx.query(sql(`CREATE SCHEMA "${schema}"`));
        await tx.query(sql(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`));
      });
      created = true;
      database = new PostgresDatabase({
        connectionString,
        max: 6,
        connectionTimeoutMillis: 5000,
        options: `-c search_path=${schema} -c timezone=Pacific/Honolulu -c statement_timeout=5000`,
      });
      opened = database;
      await runMigrations(
        database,
        await loadHistoricalBetaMigrations(
          fileURLToPath(new URL("../../../migrations", import.meta.url)),
        ),
      );
    }, 60_000);
    afterAll(async () => {
      try {
        await opened?.close();
        if (created && admin !== undefined) {
          const found = await admin.query(
            sql(
              "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
              [schema],
            ),
          );
          if (
            found.rows[0]?.["marker"] !== marker ||
            !/^cm_export_run_it_[a-f0-9]{32}$/u.test(schema)
          )
            throw new Error(
              "Refusing cleanup of an unverified synthetic schema.",
            );
          await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
        }
      } finally {
        await admin?.close();
      }
    }, 30_000);
    async function admitted() {
      const fixture = await persistedExportRunFixture(database);
      await fixture.createRoot();
      return fixture;
    }
    async function count(jobId: string) {
      return (
        await database.query(
          sql(
            "SELECT count(*)::text AS count FROM solution_export_runs WHERE solution_export_run_id=$1",
            [jobId],
          ),
        )
      ).rows[0]?.["count"];
    }
    it("requires a genuine completed allowed root admission before any prepared insertion", async () => {
      const f = await persistedExportRunFixture(database);
      await expect(
        f.repository.insertPreparedRun(f.prepared),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(await count(f.record.job.id)).toBe("0");
      const root = await f.createRoot();
      expect(root.state).toBe("queued");
      expect(await f.repository.insertPreparedRun(f.prepared)).toEqual({
        created: true,
        run: { record: f.record, recordVersion: 1 },
      });
      expect(await f.repository.getJob(f.selector)).toEqual({
        record: f.record,
        recordVersion: 1,
      });
    });
    it("serializes same-key exact prepared replay and does not create a second run or async root", async () => {
      const f = await admitted();
      const results = await Promise.all([
        f.repository.insertPreparedRun(f.prepared),
        f.repository.insertPreparedRun(f.prepared),
      ]);
      expect(results.map((result) => result.created).sort()).toEqual([
        false,
        true,
      ]);
      expect(await count(f.record.job.id)).toBe("1");
      expect(
        (
          await database.query(
            sql(
              "SELECT count(*)::text AS count FROM async_jobs WHERE job_id=$1",
              [f.record.job.id],
            ),
          )
        ).rows[0]?.["count"],
      ).toBe("1");
    });
    it("refuses altered request identity and another key instead of creating or rebinding a root", async () => {
      const f = await admitted();
      await expect(
        f.repository.insertPreparedRun({
          ...f.prepared,
          idempotencyKeyDigest: `sha256:${"a".repeat(64)}`,
        }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      await f.repository.insertPreparedRun(f.prepared);
      const changed = await f.checkpoint({
        ...f.record,
        requestIntentDigest: `sha256:${"b".repeat(64)}`,
      });
      await expect(
        f.repository.insertPreparedRun(changed),
      ).rejects.toMatchObject({ code: "idempotency_key_reused" });
      expect(await count(f.record.job.id)).toBe("1");
    });
    it("only mirrors a genuine root transition, uses SQL version CAS and rejects stale/regressive updates", async () => {
      const f = await admitted();
      await f.repository.insertPreparedRun(f.prepared);
      const next = await f.checkpoint({
        ...f.record,
        job: { ...f.record.job, state: "running", updatedAt: f.at(2) },
      });
      await expect(
        f.repository.compareAndSaveJob({
          prepared: next,
          expectedRecordVersion: 1,
          expectedState: "queued",
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      await f.startRoot();
      const outcomes = await Promise.all([
        f.repository.compareAndSaveJob({
          prepared: next,
          expectedRecordVersion: 1,
          expectedState: "queued",
        }),
        f.repository.compareAndSaveJob({
          prepared: next,
          expectedRecordVersion: 1,
          expectedState: "queued",
        }),
      ]);
      expect(outcomes.sort()).toEqual([false, true]);
      expect(await f.repository.getJob(f.selector)).toEqual({
        record: next.record,
        recordVersion: 2,
      });
      expect(
        await f.repository.compareAndSaveJob({
          prepared: next,
          expectedRecordVersion: 1,
          expectedState: "queued",
        }),
      ).toBe(false);
      const regressive = await f.checkpoint({
        ...f.record,
        job: { ...f.record.job, updatedAt: f.at(3) },
      });
      await expect(
        f.repository.compareAndSaveJob({
          prepared: regressive,
          expectedRecordVersion: 2,
          expectedState: "running",
        }),
      ).rejects.toMatchObject({ code: "conflict" });
    });
    it("projects exact root cancellation without inventing terminal completion or clearing the cancellation fence", async () => {
      const f = await admitted();
      await f.repository.insertPreparedRun(f.prepared);
      await f.startRoot();
      const running = await f.checkpoint({
        ...f.record,
        job: { ...f.record.job, state: "running", updatedAt: f.at(2) },
      });
      await f.repository.compareAndSaveJob({
        prepared: running,
        expectedRecordVersion: 1,
        expectedState: "queued",
      });
      const canceled = await f.checkpoint({
        ...running.record,
        job: {
          ...running.record.job,
          state: "cancellation-requested",
          cancellation: { state: "requested", requestedAt: f.at(3) },
          updatedAt: f.at(3),
        },
      });
      await expect(
        f.repository.compareAndSaveJob({
          prepared: canceled,
          expectedRecordVersion: 2,
          expectedState: "running",
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      await f.cancelRoot();
      expect(
        await f.repository.compareAndSaveJob({
          prepared: canceled,
          expectedRecordVersion: 2,
          expectedState: "running",
        }),
      ).toBe(true);
      expect((await f.repository.getJob(f.selector))?.record.job).toMatchObject(
        {
          state: "cancellation-requested",
          cancellation: { state: "requested", requestedAt: f.at(3) },
        },
      );
    });
    it("allows current viewer reads but denies viewer mutations, cross-tenant and expired sessions", async () => {
      const f = await admitted();
      await f.repository.insertPreparedRun(f.prepared);
      await database.query(
        sql("UPDATE memberships SET role_key='viewer' WHERE membership_id=$1", [
          f.membershipId,
        ]),
      );
      expect((await f.repository.getJob(f.selector))?.record).toEqual(f.record);
      await expect(
        f.repository.insertPreparedRun(f.prepared),
      ).rejects.toMatchObject({ code: "access_denied" });
      const other = await admitted();
      await expect(f.repository.getJob(other.selector)).rejects.toMatchObject({
        code: "not_found",
      });
      const expired = new PostgresSolutionExportRunRepository({
        database,
        objectStore: f.objects,
        principal: { ...f.principal, expiresAt: f.at(0) },
      });
      await expect(expired.getJob(f.selector)).rejects.toMatchObject({
        code: "authentication_required",
      });
    });
    it.each(["membership", "principal", "project"] as const)(
      "denies fresh reads after %s revocation or deletion",
      async (kind) => {
        const f = await admitted();
        await f.repository.insertPreparedRun(f.prepared);
        if (kind === "membership")
          await database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
              [f.membershipId],
            ),
          );
        if (kind === "principal")
          await database.query(
            sql(
              "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
              [f.principal.principalId],
            ),
          );
        if (kind === "project")
          await database.query(
            sql(
              "UPDATE projects SET lifecycle_status='archived' WHERE project_id=$1",
              [f.record.job.projectId],
            ),
          );
        await expect(f.repository.getJob(f.selector)).rejects.toMatchObject({
          code: "not_found",
        });
      },
    );
    it("does not retain SQL locks during object reads and reauthorizes before adopting read data", async () => {
      const f = await admitted();
      await f.repository.insertPreparedRun(f.prepared);
      let activeTransactions = 0;
      const tracked: SqlDatabase = {
        close: () => Promise.resolve(),
        query: (statement) => database.query(statement),
        transaction: (work) =>
          database.transaction(async (tx) => {
            activeTransactions += 1;
            try {
              return await work(tx);
            } finally {
              activeTransactions -= 1;
            }
          }),
      };
      const open = vi
        .spyOn(f.objects, "open")
        .mockImplementationOnce(async (scope, reference) => {
          expect(activeTransactions).toBe(0);
          await database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
              [f.membershipId],
            ),
          );
          open.mockRestore();
          return f.objects.open(scope, reference);
        });
      const repo = new PostgresSolutionExportRunRepository({
        database: tracked,
        objectStore: f.objects,
        principal: f.principal,
      });
      await expect(repo.getJob(f.selector)).rejects.toMatchObject({
        code: "not_found",
      });
      expect(activeTransactions).toBe(0);
    });
    it("leaves no SQL run on interrupted or corrupt object reads and retries without a second root", async () => {
      const f = await admitted();
      const open = vi
        .spyOn(f.objects, "open")
        .mockRejectedValueOnce(new Error("Synthetic object read interruption"));
      await expect(f.repository.insertPreparedRun(f.prepared)).rejects.toThrow(
        "Synthetic object read interruption",
      );
      expect(await count(f.record.job.id)).toBe("0");
      open.mockImplementationOnce(() =>
        Promise.resolve(
          (async function* () {
            yield await Promise.resolve(new Uint8Array([123, 125]));
          })(),
        ),
      );
      await expect(
        f.repository.insertPreparedRun(f.prepared),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(await count(f.record.job.id)).toBe("0");
      open.mockRestore();
      expect((await f.repository.insertPreparedRun(f.prepared)).created).toBe(
        true,
      );
    });
    it("rejects wrong-purpose, cross-owner and body-substituted immutable references", async () => {
      const f = await admitted();
      for (const snapshot of [
        { ...f.prepared.snapshot, purpose: "report" as const },
        {
          ...f.prepared.snapshot,
          owner: {
            organizationId: "organization.other",
            projectId: f.record.job.projectId,
          },
        },
        await f.publish({ unrelated: true }, "checkpoint-state"),
      ])
        await expect(
          f.repository.insertPreparedRun({ ...f.prepared, snapshot }),
        ).rejects.toThrow();
      expect(await count(f.record.job.id)).toBe("0");
    });
  },
);
