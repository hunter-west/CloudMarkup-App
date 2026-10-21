import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  InMemoryFifoJobQueue,
  InMemoryJobAuditPort,
  InMemoryJobHandlerRegistry,
  SequentialJobIdGenerator,
  type JobEntitlementPort,
  type JobHandlerV1,
} from "@cloudmarkup/job-framework";
import { sha256DigestSchema } from "@cloudmarkup/schemas";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { persistedExportRunFixture } from "./solution-export-run-test-helpers.js";
import { publicAdmissionRecord } from "./solution-export-admission-test-helpers.js";
import { DurableSolutionExportProducer } from "./solution-export-producer.js";
import { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import { SolutionExportProducerObjects } from "./solution-export-producer-objects.js";
import { PostgresSolutionExportAdmission } from "./solution-export-admission.js";
import { PostgresSolutionExportCancellation } from "./solution-export-cancellation.js";
import {
  EXPORT_ADMISSION_OPERATIONS as OP,
  exportAdmissionHash,
  exportAdmissionKey,
} from "./solution-export-admission-codec.js";
import { exportRunBytes } from "./solution-export-run-codec.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { PostgresSolutionExportTargetPolicy } from "./solution-export-target-policy.js";
import { parseArchitectureDocument } from "@cloudmarkup/domain";
import {
  AWS_CATALOG_DIGEST_V1,
  awsCatalogV1,
} from "@cloudmarkup/provider-aws/catalog";
import type { CloudMarkupApplication } from "../../application/ports.js";
import { createInitialArchitectureDocument } from "../../application/architecture-document-storage.js";
import { ProductionIdentityApplication } from "../../application/production-identity-application.js";
import { createProductionRepositoryBackedApplication } from "../../production-composition.js";
import {
  createProductionSolutionExportMutations,
  type ProductionSolutionExportMutationHost,
} from "../../production-solution-export-mutations.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import { PostgresSolutionRecordRepository } from "./solution-record-repository.js";
import { DeterministicValidationBridge } from "./deterministic-validation-bridge.js";
import {
  admissionRetentionAsOf,
  admissionTerminalFixture,
} from "./solution-export-admission-terminal-test-helpers.js";
import { PostgresSolutionExportTerminalRepository } from "./solution-export-terminal-repository.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_export_admission_it_${nonce}`;
const marker = `CloudMarkup synthetic export admission ${nonce}`;

suite("public export admission on isolated real PostgreSQL", () => {
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
      !/^cm_export_admission_it_[a-f0-9]{32}$/u.test(schema)
    )
      throw new Error("Explicit synthetic loopback database is required.");
    admin = new PostgresDatabase({
      connectionString: configured ?? "",
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    await admin.transaction(async (tx) => {
      await tx.query(sql(`CREATE SCHEMA "${schema}"`));
      await tx.query(sql(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`));
    });
    created = true;
    database = new PostgresDatabase({
      connectionString: configured ?? "",
      max: 8,
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
          !/^cm_export_admission_it_[a-f0-9]{32}$/u.test(schema)
        )
          throw new Error("Refusing unverified synthetic schema cleanup.");
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      }
    } finally {
      await admin?.close();
    }
  }, 30_000);

  async function fixture() {
    const f = await persistedExportRunFixture(database);
    const record = publicAdmissionRecord(f.record);
    const ids = new SequentialJobIdGenerator();
    const queue = new InMemoryFifoJobQueue(ids);
    const publish = vi.spyOn(queue, "publish");
    const evaluate = vi.fn<JobEntitlementPort["evaluate"]>(() =>
      Promise.resolve({
        allowed: true,
        decisionReference:
          record.workflowSubmission.entitlementDecisionReference,
      }),
    );
    const ownership = {
      organizationId: record.organizationId,
      projectId: record.job.projectId,
    };
    const objects = new SolutionExportProducerObjects(
      new SolutionExportRequestAuthority(
        database,
        f.principal,
        ownership,
        "exports.run",
      ),
      f.objects,
    );
    const binding = {
      ...ownership,
      solutionRevisionId: record.job.solutionRevision.solutionRevisionId,
      manifestRecordId: record.job.solutionRevision.manifestRecordId,
      manifestDigest: sha256DigestSchema.parse(
        record.job.solutionRevision.manifestDigest,
      ),
      applicationCodeRequired: false,
      generationCoverage: record.job.generationCoverage,
      workflowSources: record.workflowSubmission.request.sources,
    };
    const revisions = {
      getImmutableBinding: vi.fn(() => Promise.resolve(binding)),
      prepare: async () => {
        await objects.put(
          exportRunBytes(f.source.generationRequest.workloadBehavior),
          "input-payload",
          binding.workflowSources.workloadBehavior.objectId,
        );
      },
    };
    const options = {
      database,
      objectStore: f.objects,
      principal: f.principal,
      ownership,
      revisions,
      queue,
      entitlement: { evaluate },
      ids,
      audit: new InMemoryJobAuditPort(),
    };
    const fresh = () => {
      const producer = new DurableSolutionExportProducer(options);
      return {
        producer,
        admission: new PostgresSolutionExportAdmission(producer),
        cancellation: new PostgresSolutionExportCancellation(producer),
      };
    };
    return {
      ...f,
      record,
      fresh,
      ...fresh(),
      evaluate,
      publish,
      options,
      revisions,
      input: {
        record,
        idempotencyKeyDigest: sha256DigestSchema.parse(f.idempotencyKeyDigest),
      },
    };
  }
  async function counts(jobId: string) {
    return (
      await database.query(
        sql(
          "SELECT (SELECT count(*)::text FROM async_jobs WHERE job_id=$1) AS jobs,(SELECT count(*)::text FROM solution_export_runs WHERE solution_export_run_id=$1) AS runs,(SELECT count(*)::text FROM async_job_attempts WHERE job_id=$1) AS attempts,(SELECT count(*)::text FROM solution_export_artifacts WHERE solution_export_run_id=$1) AS artifacts",
          [jobId],
        ),
      )
    ).rows[0];
  }
  async function commercial(f: Awaited<ReturnType<typeof fixture>>) {
    const id = (prefix: string) =>
      `${prefix}_${randomUUID().replaceAll("-", "")}`;
    const administration = {
      authority: "internal-administration" as const,
      actorId: "synthetic_export_administration",
      actorPrincipalId: f.principal.principalId,
      organizationId: f.record.organizationId,
      correlationId: f.principal.correlationId,
    };
    const repository = new PostgresCommercialPersistenceRepository(database);
    const account = await repository.createBillingAccount(administration, {
      billingAccountId: id("billing"),
    });
    const updated = await repository.updateBillingAccount(administration, {
      expectedRecordVersion: account.recordVersion,
      expensiveOperationsEnabled: true,
      lifecycleStatus: "active",
    });
    const effectiveAt = new Date(Date.now() - 1000).toISOString();
    const subscription = await repository.updateSubscriptionProjection(
      administration,
      {
        billableSeatQuantity: "1",
        billingProvider: "synthetic-billing",
        cancelAtPeriodEnd: false,
        effectiveAt,
        expectedRecordVersion: "0",
        normalizedStatus: "active",
        planVersionId: "planver_pro_2026_08_14_v2",
        providerCustomerReference: id("customer"),
        providerSubscriptionReference: id("subscription"),
        subscriptionProjectionId: id("projection"),
      },
    );
    await repository.updateEntitlementSnapshot(administration, {
      effectiveAt,
      entitlementPolicyVersion: "cloudmarkup-entitlements-v1",
      entitlementSnapshotId: id("entitlement"),
      expensiveOperationsEnabled: true,
      expectedRecordVersion: "0",
      planVersionId: "planver_pro_2026_08_14_v2",
      sourceRecordVersion: subscription.recordVersion,
      subscriptionProjectionId: subscription.subscriptionProjectionId,
    });
    return { repository, administration, account: updated };
  }
  async function terminalFixture() {
    const f = await fixture();
    const selection = await f.admission.select(f.input);
    const queued = await f.admission.resume(selection);
    const execution = await admissionTerminalFixture({
      database,
      producer: f.producer,
      objectStore: f.objects,
      record: queued,
      compilation: f.source.compilation,
      queue: f.options.queue,
      audit: f.options.audit,
      ids: new SequentialJobIdGenerator(randomUUID().replaceAll("-", "")),
    });
    return { ...f, selection, queued, execution };
  }
  async function completedFixture() {
    const f = await terminalFixture();
    const { root, execution } = await f.execution.execute();
    expect(root.state).toBe("succeeded");
    expect(root.checkpoints.length).toBeGreaterThan(0);
    const checkpointCount = await database.query(
      sql(
        "SELECT count(*)::int AS count FROM async_job_events WHERE organization_id=$1 AND job_id=$2 AND event_kind='checkpoint-recorded'",
        [f.record.organizationId, root.jobId],
      ),
    );
    expect(checkpointCount.rows[0]?.["count"]).toBe(root.checkpoints.length);
    const published = await new PostgresSolutionExportTerminalRepository(
      database,
      f.objects,
      execution,
    ).reconcile(root);
    expect(published.job.state).toBe("succeeded");
    expect(published.job.artifact?.downloadAvailability.state).toBe(
      "available",
    );
    return { ...f, root, published };
  }
  async function artifactRows(f: Awaited<ReturnType<typeof completedFixture>>) {
    return (
      await database.query(
        sql(
          "SELECT to_jsonb(a)::text AS metadata FROM solution_export_artifacts a WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3",
          [f.record.organizationId, f.record.job.projectId, f.root.jobId],
        ),
      )
    ).rows;
  }
  it("reuses genuine retained success across a fresh admission without another send, attempt or decision", async () => {
    const f = await completedFixture();
    const beforeRun = await f.producer.runs.getJob({
      ...f.options.ownership,
      jobId: f.root.jobId,
    });
    const beforeArtifact = await artifactRows(f);
    expect(beforeArtifact).toHaveLength(1);
    const sends = f.publish.mock.calls.length;
    const decisions = f.evaluate.mock.calls.length;
    let blockedRetirements = 0;
    function wrapped(executor: SqlExecutor): SqlExecutor {
      return {
        async query<TRow extends SqlRow>(statement: SqlStatement) {
          const result = await executor.query<TRow>(statement);
          if (
            blockedRetirements === 0 &&
            statement.text.includes("ORDER BY object_id FOR SHARE")
          ) {
            const archive = result.rows.find(
              (row) => row["object_purpose"] === "export-package",
            );
            const objectId = archive?.["object_id"];
            if (typeof objectId !== "string")
              throw new Error(
                "The exact retained archive lock was not observed.",
              );
            blockedRetirements++;
            // This real competing SQL writer intentionally does not lock a project.
            // The shared object row itself must fence retirement until alias commit.
            await expect(
              database.transaction(async (tx) => {
                await tx.query(sql("SET LOCAL lock_timeout='100ms'"));
                await tx.query(
                  sql(
                    "UPDATE stored_objects SET lifecycle_state='delete-pending',delete_requested_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND object_id=$3",
                    [f.record.organizationId, f.record.job.projectId, objectId],
                  ),
                );
              }),
            ).rejects.toMatchObject({ code: "55P03" });
          }
          return result;
        },
      };
    }
    const lockedDatabase: SqlDatabase = {
      ...wrapped(database),
      transaction: (work) => database.transaction((tx) => work(wrapped(tx))),
      close: () => Promise.resolve(),
    };
    const producer = new DurableSolutionExportProducer({
      ...f.options,
      database: lockedDatabase,
    });
    const fresh = {
      producer,
      admission: new PostgresSolutionExportAdmission(producer),
    };
    const selected = await fresh.admission.select({
      ...f.input,
      idempotencyKeyDigest: exportAdmissionHash(
        "retained success new caller key",
      ),
    });
    expect(selected).toEqual(f.selection);
    expect(await fresh.admission.resume(selected)).toEqual(f.published);
    expect(await fresh.producer.getRoot(f.published)).toEqual(f.root);
    expect(
      await fresh.producer.runs.getJob({
        ...f.options.ownership,
        jobId: f.root.jobId,
      }),
    ).toEqual(beforeRun);
    expect(await artifactRows(f)).toEqual(beforeArtifact);
    expect(await counts(f.root.jobId)).toEqual({
      jobs: "1",
      runs: "1",
      attempts: "1",
      artifacts: "1",
    });
    expect(f.publish).toHaveBeenCalledTimes(sends);
    expect(f.evaluate).toHaveBeenCalledTimes(decisions);
    expect(blockedRetirements).toBe(1);
    expect(f.execution.calls).toEqual({ compiler: 1, validation: 1, build: 0 });
    expect(
      await f.execution.worker.runNext("worker.admission-terminal", 300_000),
    ).toBeNull();
  }, 60_000);
  it("reuses just before retention expiry and creates one exact successor at the deterministic PostgreSQL as-of boundary", async () => {
    const f = await completedFixture();
    const availability = f.published.job.artifact?.downloadAvailability;
    if (availability?.state !== "available")
      throw new Error("A real retained artifact is required.");
    const expiry = Date.parse(availability.expiresAt);
    expect(expiry).toBe(
      Date.parse(f.root.completedAt ?? "") + 30 * 24 * 60 * 60 * 1000,
    );
    const immutableArtifact = await artifactRows(f);
    const originalRun = await f.producer.runs.getJob({
      ...f.options.ownership,
      jobId: f.root.jobId,
    });
    const sends = f.publish.mock.calls.length;
    const decisions = f.evaluate.mock.calls.length;
    function asOf(at: number) {
      const time = new Date(at).toISOString();
      const controlled = admissionRetentionAsOf(database, time);
      const producer = new DurableSolutionExportProducer({
        ...f.options,
        database: controlled.database,
        // A synthetic fresh verified request, not an expired original credential.
        principal: {
          ...f.principal,
          authenticatedAt: new Date(at - 1000).toISOString(),
          expiresAt: new Date(at + 3_600_000).toISOString(),
        },
        clock: () => new Date(time),
      });
      return {
        ...controlled,
        time,
        admission: new PostgresSolutionExportAdmission(producer),
      };
    }
    const before = asOf(expiry - 1);
    const retained = await before.admission.select({
      ...f.input,
      idempotencyKeyDigest: exportAdmissionHash(
        "one millisecond before retention expiry",
      ),
    });
    expect(retained).toEqual(f.selection);
    expect(await before.admission.resume(retained)).toEqual(f.published);
    expect(before.intercepted).toHaveLength(4);
    // Once expiry is reached, retired package bytes must not trap the next key.
    // Only object lifecycle changes; immutable artifact metadata is untouched.
    const retired = await database.query(
      sql(
        "UPDATE stored_objects SET lifecycle_state='delete-pending',delete_requested_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND object_id=(SELECT archive_object_id FROM solution_export_artifacts WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3)",
        [f.record.organizationId, f.record.job.projectId, f.root.jobId],
      ),
    );
    expect(retired.rowCount).toBe(1);
    const exact = asOf(expiry);
    const next = await exact.admission.select({
      ...f.input,
      idempotencyKeyDigest: exportAdmissionHash(
        "exact immutable retention expiry",
      ),
    });
    expect(exact.intercepted).toHaveLength(1);
    for (const clock of [before, exact]) {
      for (const { original, executed } of clock.intercepted) {
        expect(executed.text).toBe(
          original.text.replace("clock_timestamp()", "$6::timestamptz"),
        );
        expect(executed.text).toContain(
          "retention_expires_at=$5::timestamptz FOR SHARE",
        );
        expect(executed.values).toEqual([...original.values, clock.time]);
        expect(original.values).toEqual([
          f.record.organizationId,
          f.record.job.projectId,
          f.root.jobId,
          f.published.job.artifact?.artifactId,
          availability.expiresAt,
        ]);
      }
    }
    expect(next.admissionGeneration).toBe(2);
    expect(next.initialRecord.job.runSequence).toBe(2);
    expect(next.initialRecord.job.rerunOfJobId).toBe(f.root.jobId);
    expect(next.initialRecord.job.id).not.toBe(f.root.jobId);
    expect(next.createdByPrincipalId).toBe(f.selection.createdByPrincipalId);
    expect(await counts(next.initialRecord.job.id)).toEqual({
      jobs: "0",
      runs: "0",
      attempts: "0",
      artifacts: "0",
    });
    expect(
      await exact.admission.findSelection({
        idempotencyKeyDigest: f.input.idempotencyKeyDigest,
        requestIntentDigest: sha256DigestSchema.parse(
          f.record.requestIntentDigest,
        ),
      }),
    ).toEqual(f.selection);
    // Retain that trusted as-of host time for genuine root creation: historical
    // SQL0012 also requires successor.createdAt >= predecessor artifact expiry.
    // No persisted artifact/SQL lifecycle constraint is rewritten for this test.
    expect(f.publish).toHaveBeenCalledTimes(sends);
    expect(f.evaluate).toHaveBeenCalledTimes(decisions);
    const successor = await exact.admission.resume(next);
    expect(successor.job).toMatchObject({
      state: "queued",
      runSequence: 2,
      rerunOfJobId: f.root.jobId,
    });
    expect(await counts(successor.job.id)).toEqual({
      jobs: "1",
      runs: "1",
      attempts: "0",
      artifacts: "0",
    });
    expect(await artifactRows(f)).toEqual(immutableArtifact);
    expect(
      await f.producer.runs.getJob({
        ...f.options.ownership,
        jobId: f.root.jobId,
      }),
    ).toEqual(originalRun);
    expect(await f.producer.getRoot(f.published)).toEqual(f.root);
    expect(f.execution.calls).toEqual({ compiler: 1, validation: 1, build: 0 });
    expect(f.evaluate).toHaveBeenCalledTimes(decisions + 1);
  }, 60_000);
  it("preserves genuine completion that wins after the cancel key commits but before root cancellation", async () => {
    const f = await terminalFixture();
    const key = exportAdmissionHash("completion wins cancellation race");
    const cancel = f.producer.cancelRoot.bind(f.producer);
    let completed: Awaited<ReturnType<typeof f.execution.execute>> | undefined;
    const rootBoundary = vi
      .spyOn(f.producer, "cancelRoot")
      .mockImplementationOnce(async (record) => {
        const bound = await database.query(
          sql(
            "SELECT lifecycle_status FROM idempotency_records WHERE organization_id=$1 AND operation_name=$2 AND resource_id=$3",
            [f.record.organizationId, OP.cancel, f.queued.job.id],
          ),
        );
        expect(bound.rows).toEqual([{ lifecycle_status: "in-progress" }]);
        completed = await f.execution.execute();
        expect(completed.root.state).toBe("succeeded");
        await new PostgresSolutionExportTerminalRepository(
          database,
          f.objects,
          completed.execution,
        ).reconcile(completed.root);
        return cancel(record);
      });
    const result = await f.cancellation.cancel({
      record: f.queued,
      idempotencyKeyDigest: key,
    });
    rootBoundary.mockRestore();
    if (completed === undefined)
      throw new Error(
        "The real worker did not complete at the cancellation boundary.",
      );
    expect(result.job.state).toBe("succeeded");
    expect(result.job.cancellation).toEqual({ state: "none" });
    expect(result.job.artifact?.downloadAvailability.state).toBe("available");
    expect(await f.producer.getRoot(result)).toEqual(completed.root);
    const beforeRun = await f.producer.runs.getJob({
      ...f.options.ownership,
      jobId: result.job.id,
    });
    expect(
      await f
        .fresh()
        .cancellation.cancel({ record: f.queued, idempotencyKeyDigest: key }),
    ).toEqual(result);
    expect(
      await f.producer.runs.getJob({
        ...f.options.ownership,
        jobId: result.job.id,
      }),
    ).toEqual(beforeRun);
    expect(await counts(result.job.id)).toEqual({
      jobs: "1",
      runs: "1",
      attempts: "1",
      artifacts: "1",
    });
    const cancellations = await database.query(
      sql(
        "SELECT count(*)::int AS count FROM async_job_events WHERE organization_id=$1 AND job_id=$2 AND event_kind IN ('cancellation-requested','job-canceled')",
        [f.record.organizationId, result.job.id],
      ),
    );
    expect(cancellations.rows[0]?.["count"]).toBe(0);
    expect(f.execution.calls).toEqual({ compiler: 1, validation: 1, build: 0 });
    expect(f.evaluate).toHaveBeenCalledTimes(1);
  }, 60_000);
  it("keeps cancellation pending after genuine root completion until the exact terminal publication recovers", async () => {
    const f = await terminalFixture();
    const { root, execution } = await f.execution.execute();
    expect(root.state).toBe("succeeded");
    expect(await counts(root.jobId)).toEqual({
      jobs: "1",
      runs: "1",
      attempts: "1",
      artifacts: "0",
    });
    const input = {
      record: f.queued,
      idempotencyKeyDigest: exportAdmissionHash(
        "completed root before public projection",
      ),
    };
    await expect(f.cancellation.cancel(input)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    expect(
      (
        await f.producer.runs.getJob({
          ...f.options.ownership,
          jobId: root.jobId,
        })
      )?.record.job.state,
    ).toBe("queued");
    expect(await f.producer.getRoot(f.queued)).toEqual(root);
    const pending = await database.query(
      sql(
        "SELECT lifecycle_status,completed_at FROM idempotency_records WHERE organization_id=$1 AND operation_name=$2 AND resource_id=$3",
        [f.record.organizationId, OP.cancel, root.jobId],
      ),
    );
    expect(pending.rows).toEqual([
      { lifecycle_status: "in-progress", completed_at: null },
    ]);
    const published = await new PostgresSolutionExportTerminalRepository(
      database,
      f.objects,
      execution,
    ).reconcile(root);
    expect(await f.fresh().cancellation.cancel(input)).toEqual(published);
    expect(
      (
        await database.query(
          sql(
            "SELECT lifecycle_status,completed_at IS NOT NULL AS completed FROM idempotency_records WHERE organization_id=$1 AND operation_name=$2 AND resource_id=$3",
            [f.record.organizationId, OP.cancel, root.jobId],
          ),
        )
      ).rows,
    ).toEqual([{ lifecycle_status: "completed", completed: true }]);
    expect(await counts(root.jobId)).toEqual({
      jobs: "1",
      runs: "1",
      attempts: "1",
      artifacts: "1",
    });
    expect(f.execution.calls).toEqual({ compiler: 1, validation: 1, build: 0 });
    expect(f.evaluate).toHaveBeenCalledTimes(1);
  }, 60_000);
  it.each(["archive", "root-snapshot"])(
    "refuses retained-success alias publication when the verified %s retires before selection commit",
    async (kind) => {
      const f = await completedFixture();
      const fresh = f.fresh();
      const getArtifact = fresh.admission.downloads.getArtifact.bind(
        fresh.admission.downloads,
      );
      const verified = vi
        .spyOn(fresh.admission.downloads, "getArtifact")
        .mockImplementationOnce(async (selector) => {
          const artifact = await getArtifact(selector);
          expect(artifact).not.toBeNull();
          const retired = await database.query(
            sql(
              kind === "archive"
                ? "UPDATE stored_objects SET lifecycle_state='delete-pending',delete_requested_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND object_id=(SELECT archive_object_id FROM solution_export_artifacts WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3)"
                : "UPDATE stored_objects SET lifecycle_state='delete-pending',delete_requested_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND object_id=(SELECT snapshot_object_id FROM async_job_record_snapshots WHERE organization_id=$1 AND project_id=$2 AND job_id=$3 AND record_version=$4)",
              kind === "archive"
                ? [
                    f.record.organizationId,
                    f.record.job.projectId,
                    f.root.jobId,
                  ]
                : [
                    f.record.organizationId,
                    f.record.job.projectId,
                    f.root.jobId,
                    f.root.recordVersion,
                  ],
            ),
          );
          expect(retired.rowCount).toBe(1);
          return artifact;
        });
      const key = exportAdmissionHash(`retired success ${kind} new alias`);
      await expect(
        fresh.admission.select({ ...f.input, idempotencyKeyDigest: key }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(verified).toHaveBeenCalled();
      expect(
        await f.fresh().admission.findSelection({
          idempotencyKeyDigest: key,
          requestIntentDigest: sha256DigestSchema.parse(
            f.record.requestIntentDigest,
          ),
        }),
      ).toBeNull();
      expect(await counts(f.root.jobId)).toEqual({
        jobs: "1",
        runs: "1",
        attempts: "1",
        artifacts: "1",
      });
      expect(f.execution.calls).toEqual({
        compiler: 1,
        validation: 1,
        build: 0,
      });
      expect(f.evaluate).toHaveBeenCalledTimes(1);
    },
    60_000,
  );
  it("reads the genuine current plan without creating customer credits or requiring billing management", async () => {
    const f = await fixture();
    await commercial(f);
    await database.query(
      sql("UPDATE memberships SET role_key='editor' WHERE membership_id=$1", [
        f.membershipId,
      ]),
    );
    const producer = new DurableSolutionExportProducer(f.options);
    const policy = new PostgresSolutionExportTargetPolicy(
      producer.authority,
      f.record.workflowSubmission.request.targetSettings,
    );
    const binding = await f.revisions.getImmutableBinding();
    const decision = await policy.evaluate({
      binding,
      environment: f.record.job.target.environment,
      organizationId: f.record.organizationId,
      principal: f.principal,
      targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1",
    });
    expect(decision.entitlementDecisionReference).toMatch(
      /^export-decision\.[a-f0-9]{64}$/u,
    );
    const rows = await database.query(
      sql(
        "SELECT (SELECT count(*)::text FROM credit_grants WHERE organization_id=$1) AS grants,(SELECT count(*)::text FROM credit_reservations WHERE organization_id=$1) AS reservations,(SELECT count(*)::text FROM usage_ledger_entries WHERE organization_id=$1) AS ledger",
        [f.record.organizationId],
      ),
    );
    expect(rows.rows[0]).toEqual({
      grants: "0",
      reservations: "0",
      ledger: "0",
    });
    expect(f.evaluate).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  }, 30_000);
  it("joins the public create/cancel facade to a genuine immutable revision, selected root and prepared run", async () => {
    const f = await fixture();
    await commercial(f);
    const identity = new ProductionIdentityApplication(database);
    const repository = new PostgresCloudMarkupRepository(database);
    // This existing fixture fallback has no methods; every method used below is the real SQL/object implementation.
    const application = createProductionRepositoryBackedApplication(identity, {
      fallback: {} as CloudMarkupApplication,
      identifierNamespace: "beta",
      objectStore: f.objects,
      repository,
      solutionRevisions: {
        solutionRecords: new PostgresSolutionRecordRepository(database),
        validation: new DeterministicValidationBridge({
          database,
          identifierNamespace: "beta",
          objectStore: f.objects,
          repository,
        }),
      },
    });
    const initial = createInitialArchitectureDocument({
      blank: true,
      infrastructureOnly: true,
      identity: {
        architectureId: "architecture.export",
        documentId: "document.export",
        draftId: "draft.export",
        principalId: f.principal.principalId,
        revisionId: "revision.export",
      },
    });
    const document = parseArchitectureDocument({
      ...initial,
      provider: { id: awsCatalogV1.artifact.provider.id, region: "us-east-1" },
      catalog: {
        id: awsCatalogV1.artifact.catalog.id,
        version: awsCatalogV1.artifact.catalog.version,
        digest: AWS_CATALOG_DIGEST_V1,
      },
    });
    const created = await application.createProject(
      f.principal,
      f.record.organizationId,
      {
        creationMode: "draft-copy",
        name: "Synthetic public export admission",
        architectureDocument: document,
      },
      `project_${randomUUID()}`,
    );
    const draft = await application.getDraft(f.principal, created.project.id);
    const revision = await application.createSolutionRevision(
      f.principal,
      created.project.id,
      {
        contractVersion: 1,
        draftId: draft.value.id,
        draftVersion: draft.value.version,
        name: "Synthetic immutable export",
      },
      draft.etag,
      `revision_${randomUUID()}`,
    );
    const execute = vi.fn<JobHandlerV1["execute"]>(() =>
      Promise.reject(
        new Error(
          "No compiler or worker execution is part of this admission fixture.",
        ),
      ),
    );
    const handler: JobHandlerV1 = {
      family: "solution-export-orchestration",
      handlerId: "synthetic.export-not-executed",
      handlerVersion: "1",
      resumePolicy: "not-resumable",
      execute,
    };
    const ready = vi.fn<
      ProductionSolutionExportMutationHost["assertCurrentHostReady"]
    >(() => Promise.resolve());
    const entitlement = vi.fn<
      ProductionSolutionExportMutationHost["entitlementForSelection"]
    >((selection) => ({
      evaluate: () =>
        Promise.resolve({
          allowed: true,
          decisionReference:
            selection.initialRecord.workflowSubmission
              .entitlementDecisionReference,
        }),
    }));
    const host: ProductionSolutionExportMutationHost = {
      queue: f.options.queue,
      ids: f.options.ids,
      audit: f.options.audit,
      handlers: new InMemoryJobHandlerRegistry([handler]),
      targetSettings: f.record.workflowSubmission.request.targetSettings,
      assertCurrentHostReady: ready,
      entitlementForSelection: entitlement,
    };
    const options = {
      database,
      objectStore: f.objects,
      identity,
      revisions: application,
      host,
    };
    const input = {
      contractVersion: 1 as const,
      solutionRevisionId: revision.summary.solutionRevisionId,
      environment: { environmentType: "development" as const },
      exportName: "Synthetic public export",
      targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1" as const,
    };
    f.publish.mockImplementation(async (envelope) => {
      expect(await counts(envelope.jobId)).toEqual({
        jobs: "1",
        runs: "1",
        attempts: "0",
        artifacts: "0",
      });
    });
    const first = await createProductionSolutionExportMutations(
      options,
    ).createJob(
      f.principal,
      created.project.id,
      input,
      "synthetic-facade-create-key",
    );
    expect(first.state).toBe("queued");
    expect(first.solutionRevision.solutionRevisionId).toBe(
      revision.summary.solutionRevisionId,
    );
    expect(
      (
        await createProductionSolutionExportMutations(options).createJob(
          f.principal,
          created.project.id,
          input,
          "synthetic-facade-create-key",
        )
      ).id,
    ).toBe(first.id);
    expect(entitlement).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    ready.mockRejectedValue(
      new Error("Synthetic worker host unavailable after admission"),
    );
    const canceled = await createProductionSolutionExportMutations(
      options,
    ).cancelJob(
      f.principal,
      created.project.id,
      first.id,
      "synthetic-facade-cancel-key",
    );
    expect(canceled.state).toBe("canceled");
    expect(await counts(first.id)).toEqual({
      jobs: "1",
      runs: "1",
      attempts: "0",
      artifacts: "0",
    });
    expect(entitlement).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  }, 60_000);
  it("rejects a missing commercial account and a current account kill switch before selecting a run", async () => {
    const f = await fixture();
    const policy = new PostgresSolutionExportTargetPolicy(
      f.producer.authority,
      f.record.workflowSubmission.request.targetSettings,
    );
    const input = {
      binding: await f.revisions.getImmutableBinding(),
      environment: f.record.job.target.environment,
      organizationId: f.record.organizationId,
      principal: f.principal,
      targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1" as const,
    };
    await expect(policy.evaluate(input)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    const c = await commercial(f);
    await c.repository.updateBillingAccount(c.administration, {
      expectedRecordVersion: c.account.recordVersion,
      expensiveOperationsEnabled: false,
      lifecycleStatus: "active",
    });
    await expect(policy.evaluate(input)).rejects.toMatchObject({
      code: "access_denied",
    });
    const rows = await database.query(
      sql(
        "SELECT count(*)::text AS count FROM idempotency_records WHERE organization_id=$1",
        [f.record.organizationId],
      ),
    );
    expect(rows.rows[0]?.["count"]).toBe("0");
  }, 30_000);
  it("commits the exact initial selection before a root and recovers it in a fresh adapter", async () => {
    const f = await fixture();
    const selection = await f.admission.select(f.input);
    expect(selection.initialRecord.job.id).not.toBe(f.record.job.id);
    expect(selection.initialRecord.workflowSubmission.request).toEqual(
      f.record.workflowSubmission.request,
    );
    expect(await counts(selection.initialRecord.job.id)).toEqual({
      jobs: "0",
      runs: "0",
      attempts: "0",
      artifacts: "0",
    });
    expect(f.evaluate).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
    const fresh = f.fresh();
    expect(
      await fresh.admission.findSelection({
        idempotencyKeyDigest: f.input.idempotencyKeyDigest,
        requestIntentDigest: sha256DigestSchema.parse(
          f.record.requestIntentDigest,
        ),
      }),
    ).toEqual(selection);
    f.publish.mockImplementation(async () => {
      expect(await counts(selection.initialRecord.job.id)).toEqual({
        jobs: "1",
        runs: "1",
        attempts: "0",
        artifacts: "0",
      });
      const rows = await database.query(
        sql(
          "SELECT lifecycle_status,expires_at FROM idempotency_records WHERE organization_id=$1 AND operation_name IN ($2,$3)",
          [f.record.organizationId, OP.selection, OP.create],
        ),
      );
      expect(
        rows.rows.every(
          (row) =>
            row["lifecycle_status"] === "completed" &&
            row["expires_at"] === null,
        ),
      ).toBe(true);
    });
    const prepared = await fresh.admission.resume(selection);
    expect(prepared.job.id).toBe(selection.initialRecord.job.id);
    expect(f.evaluate).toHaveBeenCalledTimes(1);
    expect((await f.fresh().admission.resume(selection)).job.id).toBe(
      prepared.job.id,
    );
    expect(f.evaluate).toHaveBeenCalledTimes(1);
  }, 30_000);
  it("replays the original caller alias and rejects changed public intent without a second selection", async () => {
    const f = await fixture();
    const selection = await f.admission.select(f.input);
    expect(await f.fresh().admission.select(f.input)).toEqual(selection);
    await expect(
      f.admission.findSelection({
        idempotencyKeyDigest: f.input.idempotencyKeyDigest,
        requestIntentDigest: exportAdmissionHash("different request"),
      }),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    const rows = await database.query(
      sql(
        "SELECT count(*)::text AS count FROM idempotency_records WHERE organization_id=$1 AND operation_name=$2",
        [f.record.organizationId, OP.selection],
      ),
    );
    expect(rows.rows[0]?.["count"]).toBe("1");
  });
  it("serializes concurrent distinct keys onto the same initial immutable selection", async () => {
    const f = await fixture();
    const selections = await Promise.all([
      f.admission.select(f.input),
      f.fresh().admission.select({
        ...f.input,
        idempotencyKeyDigest: exportAdmissionHash("parallel browser key"),
      }),
    ]);
    expect(selections[0]).toEqual(selections[1]);
    expect(f.evaluate).not.toHaveBeenCalled();
    const rows = await database.query(
      sql(
        "SELECT operation_name,count(*)::text AS count FROM idempotency_records WHERE organization_id=$1 GROUP BY operation_name",
        [f.record.organizationId],
      ),
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        { operation_name: OP.selection, count: "1" },
        { operation_name: OP.primary, count: "1" },
        { operation_name: OP.create, count: "2" },
      ]),
    );
  }, 30_000);
  it("recovers the root-before-run crash without another entitlement or early dispatch", async () => {
    const f = await fixture();
    const selection = await f.admission.select(f.input);
    vi.spyOn(f.producer.runs, "insertPreparedRun").mockRejectedValueOnce(
      new Error("Synthetic interrupted run commit"),
    );
    await expect(f.admission.resume(selection)).rejects.toThrow(
      "Synthetic interrupted run commit",
    );
    expect(await counts(selection.initialRecord.job.id)).toEqual({
      jobs: "1",
      runs: "0",
      attempts: "0",
      artifacts: "0",
    });
    expect(f.publish).not.toHaveBeenCalled();
    expect((await f.fresh().admission.resume(selection)).job.state).toBe(
      "queued",
    );
    expect(f.evaluate).toHaveBeenCalledTimes(1);
  }, 30_000);
  it("returns an exact committed queued run to another authorized actor without sending or changing its creator/version", async () => {
    const f = await fixture();
    const original = await f.admission.select(f.input);
    await f.producer.prepareSelected({
      record: original.initialRecord,
      idempotencyKeyDigest: original.originalIdempotencyKeyDigest,
    });
    expect(f.publish).not.toHaveBeenCalled();
    const principalId = `principal_${randomUUID().replaceAll("-", "")}`;
    await database.transaction(async (tx) => {
      await tx.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic export collaborator')",
          [principalId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'editor')",
          [
            `membership_${randomUUID().replaceAll("-", "")}`,
            f.record.organizationId,
            principalId,
          ],
        ),
      );
    });
    const actor = {
      ...f.principal,
      principalId,
      sessionId: "session.synthetic-collaborator",
    };
    const producer = new DurableSolutionExportProducer({
      ...f.options,
      principal: actor,
    });
    const admission = new PostgresSolutionExportAdmission(producer);
    const version = () =>
      database.query(
        sql(
          "SELECT j.record_version::text AS root_version,r.record_version::text AS run_version,j.idempotency_actor_id,r.created_by_principal_id FROM async_jobs j JOIN solution_export_runs r ON r.root_job_id=j.job_id AND r.organization_id=j.organization_id WHERE j.job_id=$1",
          [original.initialRecord.job.id],
        ),
      );
    const before = await version();
    const selected = await admission.select({
      idempotencyKeyDigest: exportAdmissionHash("collaborator browser key"),
      record: {
        ...f.record,
        createdByPrincipalId: principalId,
        workflowSubmission: {
          ...f.record.workflowSubmission,
          createdByPrincipalId: principalId,
        },
      },
    });
    expect(selected).toEqual(original);
    const replay = await new PostgresSolutionExportAdmission(
      new DurableSolutionExportProducer({ ...f.options, principal: actor }),
    ).resume(selected);
    expect(replay.job.state).toBe("queued");
    expect(replay.createdByPrincipalId).toBe(f.principal.principalId);
    expect(await version()).toEqual(before);
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.evaluate).toHaveBeenCalledTimes(1);
    await expect(
      new PostgresSolutionExportCancellation(producer).cancel({
        record: replay,
        idempotencyKeyDigest: exportAdmissionHash("foreign cancel"),
      }),
    ).rejects.toMatchObject({ code: "access_denied" });
    await f.fresh().admission.resume(original);
    expect(f.publish).toHaveBeenCalledTimes(1);
    expect(f.evaluate).toHaveBeenCalledTimes(1);
  }, 30_000);
  it("recovers a transport acknowledgement failure using the same committed selection/run", async () => {
    const f = await fixture();
    const selection = await f.admission.select(f.input);
    f.publish.mockRejectedValueOnce(new Error("Synthetic uncertain send"));
    await expect(f.admission.resume(selection)).rejects.toThrow(
      "Synthetic uncertain send",
    );
    expect(await counts(selection.initialRecord.job.id)).toEqual({
      jobs: "1",
      runs: "1",
      attempts: "0",
      artifacts: "0",
    });
    expect((await f.fresh().admission.resume(selection)).job.id).toBe(
      selection.initialRecord.job.id,
    );
    expect(f.evaluate).toHaveBeenCalledTimes(1);
  }, 30_000);
  it("keeps a rootless denied alias immutable while a fresh key advances generation, not sequence", async () => {
    const f = await fixture();
    f.evaluate.mockResolvedValueOnce({
      allowed: false,
      decisionReference: "entitlement.synthetic-denied",
      denialCode: "synthetic.denied",
      publicMessage: "job-not-supported",
    });
    const denied = await f.admission.select(f.input);
    await expect(f.admission.resume(denied)).rejects.toMatchObject({
      code: "access_denied",
    });
    expect(await counts(denied.initialRecord.job.id)).toEqual({
      jobs: "0",
      runs: "0",
      attempts: "0",
      artifacts: "0",
    });
    const fresh = f.fresh();
    await expect(fresh.admission.resume(denied)).rejects.toMatchObject({
      code: "access_denied",
    });
    const [next, concurrent] = await Promise.all([
      fresh.admission.select({
        ...f.input,
        idempotencyKeyDigest: exportAdmissionHash("new key after denied claim"),
      }),
      f.fresh().admission.select({
        ...f.input,
        idempotencyKeyDigest: exportAdmissionHash(
          "concurrent new key after denied claim",
        ),
      }),
    ]);
    expect(concurrent).toEqual(next);
    expect(next.admissionGeneration).toBe(2);
    expect(next.initialRecord.job.runSequence).toBe(1);
    expect(next.initialRecord.job.rerunOfJobId).toBeUndefined();
    expect(next.previousAdmission?.generation).toBe(1);
    expect((await fresh.admission.resume(next)).job.runSequence).toBe(1);
    expect(
      await fresh.admission.findSelection({
        idempotencyKeyDigest: f.input.idempotencyKeyDigest,
        requestIntentDigest: sha256DigestSchema.parse(
          f.record.requestIntentDigest,
        ),
      }),
    ).toEqual(denied);
    expect(f.evaluate).toHaveBeenCalledTimes(2);
  }, 30_000);
  it("cancels the actual queued root before its public projection and replays without a fake attempt/artifact", async () => {
    const f = await fixture();
    const selection = await f.admission.select(f.input);
    const current = await f.admission.resume(selection);
    const key = exportAdmissionHash("cancel key");
    vi.spyOn(
      f.producer.runs,
      "commitCancellationProjection",
    ).mockRejectedValueOnce(
      new Error("Synthetic cancellation projection interruption"),
    );
    await expect(
      f.cancellation.cancel({ record: current, idempotencyKeyDigest: key }),
    ).rejects.toThrow("Synthetic cancellation projection interruption");
    expect((await f.producer.getRoot(current))?.state).toBe("canceled");
    expect(
      (
        await f.producer.runs.getJob({
          ...f.options.ownership,
          jobId: current.job.id,
        })
      )?.record.job.state,
    ).toBe("queued");
    const fresh = f.fresh();
    const canceled = await fresh.cancellation.cancel({
      record: current,
      idempotencyKeyDigest: key,
    });
    expect(canceled.job.state).toBe("canceled");
    expect(await counts(current.job.id)).toEqual({
      jobs: "1",
      runs: "1",
      attempts: "0",
      artifacts: "0",
    });
    expect(
      await fresh.cancellation.cancel({
        record: current,
        idempotencyKeyDigest: key,
      }),
    ).toEqual(canceled);
    const next = await fresh.admission.select({
      ...f.input,
      idempotencyKeyDigest: exportAdmissionHash(
        "successor after actual canceled run",
      ),
    });
    expect(next.admissionGeneration).toBe(2);
    expect(next.initialRecord.job.runSequence).toBe(2);
    expect(next.initialRecord.job.rerunOfJobId).toBe(current.job.id);
    await expect(
      fresh.cancellation.cancel({
        record: next.initialRecord,
        idempotencyKeyDigest: key,
      }),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    expect(await counts(next.initialRecord.job.id)).toEqual({
      jobs: "0",
      runs: "0",
      attempts: "0",
      artifacts: "0",
    });
  }, 30_000);
  it("refuses stale cancellation projection versions before committing the exact real-root projection", async () => {
    const f = await fixture();
    const selection = await f.admission.select(f.input);
    const current = await f.admission.resume(selection);
    const commit = f.producer.runs.commitCancellationProjection.bind(
      f.producer.runs,
    );
    vi.spyOn(
      f.producer.runs,
      "commitCancellationProjection",
    ).mockImplementationOnce(async (input) => {
      expect(
        await commit({
          ...input,
          expectedRecordVersion: input.expectedRecordVersion + 1,
        }),
      ).toBe(false);
      expect(
        (
          await f.producer.runs.getJob({
            ...f.options.ownership,
            jobId: current.job.id,
          })
        )?.record.job.state,
      ).toBe("queued");
      return commit(input);
    });
    const canceled = await f.cancellation.cancel({
      record: current,
      idempotencyKeyDigest: exportAdmissionHash("stale projection key"),
    });
    expect(canceled.job.state).toBe("canceled");
    expect(await counts(current.job.id)).toEqual({
      jobs: "1",
      runs: "1",
      attempts: "0",
      artifacts: "0",
    });
  }, 30_000);
  it("retains the last real predecessor across a denied prospective successor", async () => {
    const f = await fixture();
    const first = await f.admission.select(f.input);
    const current = await f.admission.resume(first);
    await f.cancellation.cancel({
      record: current,
      idempotencyKeyDigest: exportAdmissionHash("cancel predecessor"),
    });
    const denied = await f.admission.select({
      ...f.input,
      idempotencyKeyDigest: exportAdmissionHash("denied successor"),
    });
    f.evaluate.mockResolvedValueOnce({
      allowed: false,
      decisionReference: "entitlement.synthetic-denied",
      denialCode: "synthetic.denied",
      publicMessage: "job-not-supported",
    });
    await expect(f.admission.resume(denied)).rejects.toMatchObject({
      code: "access_denied",
    });
    const third = await f.fresh().admission.select({
      ...f.input,
      idempotencyKeyDigest: exportAdmissionHash("successor retry with new key"),
    });
    expect(third.admissionGeneration).toBe(3);
    expect(third.initialRecord.job.runSequence).toBe(2);
    expect(third.initialRecord.job.rerunOfJobId).toBe(current.job.id);
    expect((await f.fresh().admission.resume(third)).job.runSequence).toBe(2);
    expect(await counts(denied.initialRecord.job.id)).toEqual({
      jobs: "0",
      runs: "0",
      attempts: "0",
      artifacts: "0",
    });
  }, 30_000);
  it.each(["viewer", "suspended", "expired", "foreign"])(
    "denies %s authority without an admission/root mutation",
    async (mode) => {
      const f = await fixture();
      if (mode === "viewer")
        await database.query(
          sql(
            "UPDATE memberships SET role_key='viewer' WHERE membership_id=$1",
            [f.membershipId],
          ),
        );
      if (mode === "suspended")
        await database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
            [f.membershipId],
          ),
        );
      const principal =
        mode === "expired"
          ? { ...f.principal, expiresAt: "2020-01-01T00:00:00.000Z" }
          : mode === "foreign"
            ? { ...f.principal, principalId: "principal.foreign" }
            : f.principal;
      const admission = new PostgresSolutionExportAdmission(
        new DurableSolutionExportProducer({ ...f.options, principal }),
      );
      await expect(admission.select(f.input)).rejects.toThrow();
      const rows = await database.query(
        sql(
          "SELECT count(*)::text AS count FROM idempotency_records WHERE organization_id=$1",
          [f.record.organizationId],
        ),
      );
      expect(rows.rows[0]?.["count"]).toBe("0");
      expect(f.evaluate).not.toHaveBeenCalled();
      expect(f.publish).not.toHaveBeenCalled();
    },
  );
  it("fails closed on changed metadata expiry rather than silently treating the alias as absent", async () => {
    const f = await fixture();
    await f.admission.select(f.input);
    const key = exportAdmissionKey(OP.create, {
      organizationId: f.record.organizationId,
      principalId: f.principal.principalId,
      publicKeyDigest: f.input.idempotencyKeyDigest,
    });
    await database.query(
      sql(
        "UPDATE idempotency_records SET expires_at=clock_timestamp() WHERE organization_id=$1 AND operation_name=$2 AND idempotency_key_sha256=$3",
        [f.record.organizationId, OP.create, key],
      ),
    );
    await expect(
      f.fresh().admission.findSelection({
        idempotencyKeyDigest: f.input.idempotencyKeyDigest,
        requestIntentDigest: sha256DigestSchema.parse(
          f.record.requestIntentDigest,
        ),
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(f.evaluate).not.toHaveBeenCalled();
  });
});
