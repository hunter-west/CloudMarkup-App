import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyAsyncJobLifecycleCommandV1,
  deriveAsyncJobQueueEnvelopeV1,
} from "@cloudmarkup/domain";
import { createJobAuditOutboxEntryV1 } from "@cloudmarkup/job-framework";
import { asyncJobTrustedContextV1Schema } from "@cloudmarkup/schemas";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { persistedExportRunFixture } from "./solution-export-run-test-helpers.js";
import { claimInitialSolutionExport } from "./solution-export-initial-claim.js";
import { reconcileOrphanedSolutionExport } from "./solution-export-execution-repository.js";
import {
  solutionExportExecutionIdentity,
  SolutionExportWorkerAuthority,
} from "./solution-export-worker-authority.js";
import { PostgresSolutionExportTerminalRecovery } from "./solution-export-terminal-recovery.js";
import { PostgresAsyncJobRepository } from "./async-job-repository.js";
import { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import { SolutionExportProducerObjects } from "./solution-export-producer-objects.js";
import { SolutionExportWorkflowStorage } from "./solution-export-workflow-storage.js";
import {
  loadSolutionExportOrphanReceipt,
  solutionExportOrphanReceiptId,
} from "./solution-export-orphan-objects.js";
import { createSolutionExportDeliveredWorker } from "../../solution-export-consumer.js";
import {
  exportTerminalIconRegistry,
  exportTerminalIconSet,
} from "./solution-export-terminal-test-helpers.js";
import { solutionExportOrphanTransition } from "./solution-export-orphan-receipt.js";
import { exportRunBytes, exportRunSha } from "./solution-export-run-codec.js";
import { sql, type SqlDatabase } from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_export_orphan_it_${nonce}`;
const marker = `CloudMarkup synthetic orphan export ${nonce}`;
suite("actual orphan export terminal settlement on isolated PostgreSQL", () => {
  let admin: PostgresDatabase | undefined;
  let database: PostgresDatabase;
  let opened: PostgresDatabase | undefined;
  let created = false;
  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname) ||
      !/^cm_export_orphan_it_[a-f0-9]{32}$/u.test(schema)
    )
      throw new Error("Explicit synthetic loopback database is required.");
    admin = new PostgresDatabase({
      connectionString: configured ?? "",
      max: 1,
      connectionTimeoutMillis: 15_000,
    });
    await admin.transaction(async (tx) => {
      await tx.query(sql(`CREATE SCHEMA "${schema}"`));
      await tx.query(sql(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`));
    });
    created = true;
    database = new PostgresDatabase({
      connectionString: configured ?? "",
      max: 8,
      connectionTimeoutMillis: 15_000,
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
          !/^cm_export_orphan_it_[a-f0-9]{32}$/u.test(schema)
        )
          throw new Error("Refusing unverified synthetic schema cleanup.");
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      }
    } finally {
      await admin?.close();
    }
  }, 30_000);

  type Kind =
    "attempts" | "runtime" | "expired" | "cancel" | "expired-cancel" | "retry";
  async function fixture(kind: Kind = "attempts", wait = true) {
    const f = await persistedExportRunFixture(database, "cloudformation");
    await f.publish(
      f.source.generationRequest.workloadBehavior,
      "input-payload",
      f.record.workflowSubmission.request.sources.workloadBehavior.objectId,
    );
    const expiresAt = kind.startsWith("expired")
      ? new Date(Date.now() + 5000).toISOString()
      : undefined;
    const queued = await f.createRoot(expiresAt, {
      attemptCount: kind === "attempts" ? 1 : 3,
      ...(kind === "runtime" ? { runtimeSeconds: 1 } : {}),
    });
    await f.repository.insertPreparedRun(f.prepared);
    const envelope = deriveAsyncJobQueueEnvelopeV1(queued);
    const claimed = await claimInitialSolutionExport({
      database,
      objectStore: f.objects,
      envelope,
      workerId: "worker.actual-orphan",
      leaseMilliseconds: 1000,
    });
    const identity = solutionExportExecutionIdentity(claimed);
    const authority = new SolutionExportRequestAuthority(
      database,
      f.principal,
      {
        organizationId: f.selector.organizationId,
        projectId: f.selector.projectId,
      },
      "exports.run",
    );
    const objects = new SolutionExportProducerObjects(authority, f.objects);
    const jobs = new PostgresAsyncJobRepository({
      database,
      objects: objects.jobPort(
        f.binding.orchestrationInputObjectId,
        queued.inputDigest,
      ),
      ownership: queued.ownership,
    });
    async function cancel() {
      const current = await jobs.get(queued.jobId);
      if (current === null) throw new Error("Synthetic root absent.");
      const context = asyncJobTrustedContextV1Schema.parse({
        actor: { kind: "principal", actorId: f.principal.principalId },
        correlationId: f.principal.correlationId,
        ownership: queued.ownership,
      });
      const result = applyAsyncJobLifecycleCommandV1(current, {
        kind: "request-cancellation",
        at: new Date().toISOString(),
        expectedInputDigest: current.inputDigest,
        expectedRecordVersion: current.recordVersion,
        context,
      });
      if (result.transition === undefined)
        throw new Error("Actual cancellation transition required.");
      return jobs.saveWithAudit(result.job, current.recordVersion, [
        createJobAuditOutboxEntryV1({
          actor: context.actor,
          eventType: "cancellation-requested",
          occurredAt: result.transition.at,
          record: result.job,
          transition: result.transition,
        }),
      ]);
    }
    if (kind === "cancel" || kind === "expired-cancel") await cancel();
    if (wait) {
      const deadline = kind.startsWith("expired")
        ? expiresAt
        : claimed.attempts.at(-1)?.lease?.leaseExpiresAt;
      if (deadline === undefined) throw new Error("Synthetic deadline absent.");
      await delay(Math.max(0, Date.parse(deadline) - Date.now() + 25));
    }
    const trusted = asyncJobTrustedContextV1Schema.parse({
      actor: { kind: "system", reason: "orphan-reconciler" },
      correlationId: f.principal.correlationId,
      ownership: queued.ownership,
    });
    const recovery = new PostgresSolutionExportTerminalRecovery(
      database,
      f.objects,
    );
    const input = { database, objectStore: f.objects, identity };
    const storage = new SolutionExportWorkflowStorage(
      new SolutionExportWorkerAuthority(database, identity, "orphan-reconcile"),
      f.objects,
    );
    return {
      ...f,
      queued,
      claimed,
      identity,
      envelope,
      jobs,
      cancel,
      trusted,
      recovery,
      input,
      storage,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function counts(f: Fixture) {
    const result = await database.query(
      sql(
        `SELECT j.lifecycle_status,j.record_version,x.lifecycle_status AS export_state,
      (SELECT count(*)::int FROM solution_export_artifacts a WHERE a.organization_id=j.organization_id AND a.solution_export_run_id=j.job_id) AS artifacts,
      (SELECT count(*)::int FROM async_job_events e WHERE e.organization_id=j.organization_id AND e.job_id=j.job_id AND e.event_kind='orphan-reconciled') AS settlements
      FROM async_jobs j JOIN solution_export_runs x ON x.organization_id=j.organization_id AND x.root_job_id=j.job_id WHERE j.organization_id=$1 AND j.project_id=$2 AND j.job_id=$3`,
        [f.selector.organizationId, f.selector.projectId, f.queued.jobId],
      ),
    );
    return result.rows[0];
  }
  it("settles actual attempt exhaustion and acknowledges repeated consumer delivery without executing a compiler", async () => {
    const f = await fixture();
    const root = await reconcileOrphanedSolutionExport(f.input);
    expect(root.state).toBe("failed");
    expect(root.failure?.code).toBe("cloudmarkup.job.attempt-limit-exceeded");
    expect(root.attempts.at(-1)?.state).toBe("orphaned");
    const retained = await loadSolutionExportOrphanReceipt(
      f.storage,
      f.identity,
      root,
    );
    expect(retained?.prior).toEqual(f.claimed);
    const compiler = vi.fn(() =>
      Promise.reject(new Error("Orphan recovery cannot compile.")),
    );
    const worker = createSolutionExportDeliveredWorker({
      executionProfile: "cloudformation-infrastructure-only",
      database,
      objectStore: f.objects,
      compiler: { executor: { execute: compiler } },
      diagram: {
        catalog: exportTerminalIconRegistry.catalog,
        iconSet: exportTerminalIconSet,
      },
      clock: { now: () => new Date() },
      audit: { append: () => Promise.resolve() },
      publisher: {
        contractVersion: 1,
        publish: () =>
          Promise.reject(
            new Error("Orphan recovery cannot publish a queue message."),
          ),
      },
      workerId: "worker.redelivery-proof",
    });
    await expect(worker.processEnvelope(f.envelope)).resolves.toEqual({
      state: "completed",
      jobId: root.jobId,
    });
    await expect(worker.processEnvelope(f.envelope)).resolves.toEqual({
      state: "completed",
      jobId: root.jobId,
    });
    expect(compiler).not.toHaveBeenCalled();
    expect(await reconcileOrphanedSolutionExport(f.input)).toEqual(root);
    const result = await f.recovery.recover(f.trusted, root.jobId);
    expect(result.job.state).toBe("failed");
    expect(result.job.evidence).toEqual([]);
    expect(result.job.artifact).toBeUndefined();
    expect(result.job.diagnostics[0]?.code).toBe(root.failure?.code);
    expect(await counts(f)).toMatchObject({
      lifecycle_status: "failed",
      export_state: "failed",
      artifacts: 0,
      settlements: 1,
    });
  }, 30_000);
  it.each(["runtime", "expired", "cancel", "expired-cancel"] as const)(
    "settles canonical %s with exact root evidence and no artifact",
    async (kind) => {
      const f = await fixture(kind);
      const root = await reconcileOrphanedSolutionExport(f.input);
      const expected = kind.startsWith("expired")
        ? "expired"
        : kind === "cancel"
          ? "canceled"
          : "failed";
      expect(root.state).toBe(expected);
      expect(await f.recovery.list(f.trusted)).toContain(root.jobId);
      const result = await f.recovery.recover(f.trusted, root.jobId);
      expect(result.job.state).toBe(
        expected === "expired" ? "failed" : expected,
      );
      expect(result.job.artifact).toBeUndefined();
      expect(result.job.evidence).toEqual([]);
      if (kind.startsWith("expired")) {
        expect(root.failure).toBeUndefined();
        expect(result.job.diagnostics[0]?.code).toBe("cloudmarkup.job.expired");
      }
      if (kind === "expired-cancel")
        expect(result.job.cancellation.state).toBe("requested");
      if (kind === "cancel")
        expect(result.job.cancellation.state).toBe("acknowledged");
      await expect(f.recovery.recover(f.trusted, root.jobId)).resolves.toEqual(
        result,
      );
      expect(await counts(f)).toMatchObject({ artifacts: 0, settlements: 1 });
    },
    30_000,
  );
  it("denies a live lease and foreign tenant before reading any object", async () => {
    const f = await fixture("attempts", false);
    const before = await counts(f);
    const read = vi.spyOn(f.objects, "open");
    await expect(reconcileOrphanedSolutionExport(f.input)).rejects.toThrow();
    await expect(
      reconcileOrphanedSolutionExport({
        ...f.input,
        identity: { ...f.identity, organizationId: "org.foreign-orphan" },
      }),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(await counts(f)).toEqual(before);
  }, 30_000);
  it("denies revoked creator authority before receipt publication", async () => {
    const f = await fixture();
    const before = await counts(f);
    await database.query(
      sql(
        "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
        [f.membershipId],
      ),
    );
    const read = vi.spyOn(f.objects, "open");
    await expect(reconcileOrphanedSolutionExport(f.input)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(await counts(f)).toEqual(before);
  }, 30_000);
  it("commits at most one terminal root/audit under concurrent settlement", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      reconcileOrphanedSolutionExport(f.input),
      reconcileOrphanedSolutionExport(f.input),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const root = await reconcileOrphanedSolutionExport(f.input);
    await f.recovery.recover(f.trusted, root.jobId);
    expect(await counts(f)).toMatchObject({ artifacts: 0, settlements: 1 });
  }, 30_000);
  it("reuses the exact published receipt after root/audit rollback", async () => {
    const f = await fixture();
    const before = await counts(f);
    const failing: SqlDatabase = {
      query: (s) => database.query(s),
      close: () => Promise.resolve(),
      transaction: (work) =>
        database.transaction((tx) =>
          work({
            query(statement) {
              if (statement.text.startsWith("INSERT INTO async_job_events"))
                throw new Error("Synthetic orphan audit interruption");
              return tx.query(statement);
            },
          }),
        ),
    };
    await expect(
      reconcileOrphanedSolutionExport({ ...f.input, database: failing }),
    ).rejects.toThrow("Synthetic orphan audit interruption");
    expect(await counts(f)).toEqual(before);
    const first = await loadSolutionExportOrphanReceipt(
      f.storage,
      f.identity,
      undefined,
      f.claimed.recordVersion,
    );
    expect(first).not.toBeNull();
    const root = await reconcileOrphanedSolutionExport(f.input);
    const second = await loadSolutionExportOrphanReceipt(
      f.storage,
      f.identity,
      root,
    );
    expect(second?.receipt).toEqual(first?.receipt);
    expect(root).toEqual(first?.job);
    await f.recovery.recover(f.trusted, root.jobId);
    expect(await counts(f)).toMatchObject({ artifacts: 0, settlements: 1 });
  }, 30_000);
  it("finishes interrupted receipt publication before exact root settlement", async () => {
    const f = await fixture();
    const before = await counts(f);
    const id = solutionExportOrphanReceiptId(
      f.storage,
      f.identity,
      f.claimed.recordVersion,
    );
    const original = f.objects.publish.bind(f.objects);
    let interrupted = false;
    const publish = vi
      .spyOn(f.objects, "publish")
      .mockImplementation((scope, reference) => {
        if (reference.objectId === id && !interrupted) {
          interrupted = true;
          return Promise.reject(
            new Error("Synthetic orphan receipt interruption"),
          );
        }
        return original(scope, reference);
      });
    await expect(reconcileOrphanedSolutionExport(f.input)).rejects.toThrow(
      "Synthetic orphan receipt interruption",
    );
    expect(await counts(f)).toEqual(before);
    expect((await f.storage.metadata(id))?.state).toBe("publication-pending");
    publish.mockRestore();
    const root = await reconcileOrphanedSolutionExport(f.input);
    expect((await f.storage.metadata(id))?.state).toBe("published");
    await f.recovery.recover(f.trusted, root.jobId);
    expect(await counts(f)).toMatchObject({ artifacts: 0, settlements: 1 });
  }, 30_000);
  it("does not let a stale pending receipt pin a newer cancellation", async () => {
    const f = await fixture();
    const id = solutionExportOrphanReceiptId(
      f.storage,
      f.identity,
      f.claimed.recordVersion,
    );
    const original = f.objects.publish.bind(f.objects);
    let canceled = false;
    const publish = vi
      .spyOn(f.objects, "publish")
      .mockImplementation(async (scope, reference) => {
        await original(scope, reference);
        if (reference.objectId === id && !canceled) {
          canceled = true;
          await f.cancel();
        }
      });
    await expect(reconcileOrphanedSolutionExport(f.input)).rejects.toThrow();
    publish.mockRestore();
    const root = await reconcileOrphanedSolutionExport(f.input);
    expect(root.state).toBe("canceled");
    const retained = await loadSolutionExportOrphanReceipt(
      f.storage,
      f.identity,
      root,
    );
    expect(retained?.receipt.priorRecordVersion).toBe(
      f.claimed.recordVersion + 1,
    );
    expect(retained?.reference.objectId).not.toBe(id);
    const result = await f.recovery.recover(f.trusted, root.jobId);
    expect(result.job.cancellation.state).toBe("acknowledged");
    expect(await counts(f)).toMatchObject({ artifacts: 0, settlements: 1 });
  }, 30_000);
  it("denies a published lookalike prior snapshot that is not the actual immutable journal entry", async () => {
    const f = await fixture();
    const before = await counts(f);
    const lookalike = await f.publish(
      f.claimed,
      "report",
      "object.lookalike-orphan-" + nonce,
    );
    const at = new Date().toISOString();
    const result = solutionExportOrphanTransition(f.claimed, at);
    const body = {
      contractVersion: 1,
      kind: "cloudmarkup.solution-export-orphan-terminal-receipt",
      execution: f.identity,
      prepared: f.record,
      priorRecordVersion: f.claimed.recordVersion,
      priorSnapshot: {
        contractVersion: 1,
        objectId: lookalike.objectId,
        purpose: "report",
        mediaType: "application/json",
        digest: "sha256:" + lookalike.contentSha256,
        sizeBytes: lookalike.sizeBytes,
      },
      reconciledAt: at,
      terminalState: result.job.state,
      terminalRootDigest: "sha256:" + exportRunSha(exportRunBytes(result.job)),
    };
    await f.storage.put(
      exportRunBytes(body),
      "report",
      "application/json",
      solutionExportOrphanReceiptId(
        f.storage,
        f.identity,
        f.claimed.recordVersion,
      ),
    );
    await expect(reconcileOrphanedSolutionExport(f.input)).rejects.toThrow();
    expect(await counts(f)).toEqual(before);
  }, 30_000);
});
