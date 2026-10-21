import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyAsyncJobLifecycleCommandV1 } from "@cloudmarkup/domain";
import {
  createJobAuditOutboxEntryV1,
  DefaultJobFailureClassifier,
  InMemoryFifoJobQueue,
  InMemoryJobAuditPort,
  InMemoryJobHandlerRegistry,
  InMemoryJobOrchestrationDecisionPort,
  JobService,
  JobWorker,
  MutableJobClock,
  SequentialJobIdGenerator,
  type JobHandlerContextV1,
  type JobHandlerV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobTrustedContextV1Schema,
  asyncJobWorkerIdSchema,
  asyncJobAttemptIdSchema,
  namespacedIdentifierSchema,
  serializeCanonicalJson,
  type AsyncJobHandlerOutcomeV1,
} from "@cloudmarkup/schemas";
import { terraformValidationRequestV1Schema } from "@cloudmarkup/terraform-validation-runner";
import { createDurableSolutionExportHandler } from "../../solution-export-worker.js";
import { PostgresAsyncJobRepository } from "./async-job-repository.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { persistedExportRunFixture } from "./solution-export-run-test-helpers.js";
import { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import { SolutionExportProducerObjects } from "./solution-export-producer-objects.js";
import { PostgresSolutionExportTerminalRepository } from "./solution-export-terminal-repository.js";
import { PostgresSolutionExportDownloadRepository } from "./solution-export-download-repository.js";
import { solutionExportExecutionIdentity } from "./solution-export-worker-authority.js";
import {
  exportTerminalIconRegistry,
  exportTerminalIconSet,
  syntheticBoundValidationResult,
} from "./solution-export-terminal-test-helpers.js";
import { sql } from "./sql.js";
import { PostgresSolutionExportTerminalRecovery } from "./solution-export-terminal-recovery.js";
import { SolutionExportPublicationReadiness } from "./solution-export-producer.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_export_recovery_it_${nonce}`;
const marker = `CloudMarkup synthetic export terminal ${nonce}`;
suite(
  "fresh-process export terminal recovery on isolated real PostgreSQL",
  () => {
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
        !/^cm_export_recovery_it_[a-f0-9]{32}$/u.test(schema)
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
            !/^cm_export_recovery_it_[a-f0-9]{32}$/u.test(schema)
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
      await f.publish(
        f.source.generationRequest.workloadBehavior,
        "input-payload",
        f.record.workflowSubmission.request.sources.workloadBehavior.objectId,
      );
      const queued = await f.createRoot();
      await f.repository.insertPreparedRun(f.prepared);
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
      async function claimRoot() {
        const claimed = applyAsyncJobLifecycleCommandV1(queued, {
          kind: "claim",
          at: f.at(2),
          expectedInputDigest: queued.inputDigest,
          expectedRecordVersion: queued.recordVersion,
          attemptId: asyncJobAttemptIdSchema.parse(
            `attempt_${randomUUID().replaceAll("-", "")}`,
          ),
          workerId: asyncJobWorkerIdSchema.parse("worker.integration"),
          leaseExpiresAt: f.at(300),
          dependencies: [],
          handler: {
            family: queued.family,
            handlerId: namespacedIdentifierSchema.parse(
              "cloudmarkup.solution-export.workflow",
            ),
            handlerVersion: "1.0.0",
            resumePolicy: "restart-from-input",
          },
        });
        if (claimed.transition === undefined)
          throw new Error("Expected real workflow handler lease.");
        return jobs.saveWithAudit(claimed.job, queued.recordVersion, [
          createJobAuditOutboxEntryV1({
            actor: {
              kind: "worker",
              workerId: asyncJobWorkerIdSchema.parse("worker.integration"),
            },
            eventType: "attempt-claimed",
            occurredAt: f.at(2),
            record: claimed.job,
            transition: claimed.transition,
          }),
        ]);
      }
      const running = await claimRoot();
      const settings =
        f.record.workflowSubmission.request.targetSettings.stageDescriptors;
      if (!("terraformValidation" in settings))
        throw new Error("Terraform fixture required.");
      const compiler = vi.fn(() =>
        Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: serializeCanonicalJson(f.source.compilation),
          termination: "completed" as const,
        }),
      );
      const validation = vi.fn((input: unknown) =>
        Promise.resolve(
          syntheticBoundValidationResult(
            terraformValidationRequestV1Schema.parse(input),
            settings.terraformValidation,
          ),
        ),
      );
      const build = vi.fn(() =>
        Promise.reject(
          new Error("Infrastructure-only does not execute application builds."),
        ),
      );
      const handler = createDurableSolutionExportHandler({
        database,
        objectStore: f.objects,
        compiler: { executor: { execute: compiler } },
        validation: {
          approvedSettings: settings.terraformValidation,
          runner: { run: validation },
        },
        applicationBuild: {
          approvedSettings: settings.applicationBuild,
          runner: { run: build },
        },
        diagram: {
          catalog: exportTerminalIconRegistry.catalog,
          iconSet: exportTerminalIconSet,
        },
        clock: { now: () => new Date(f.at(4)) },
      });
      const context: JobHandlerContextV1 = {
        attemptNumber: 1,
        checkpoint: undefined,
        correlationId: running.correlationId,
        jobId: running.jobId,
        ownership: running.ownership,
        heartbeat: () => Promise.resolve(),
        isCancellationRequested: () => Promise.resolve(false),
        reportProgress: () => Promise.resolve(),
        saveCheckpoint: () => Promise.resolve(),
      };
      const identity = solutionExportExecutionIdentity(running);
      const terminal = new PostgresSolutionExportTerminalRepository(
        database,
        f.objects,
        identity,
      );
      const reader = new PostgresSolutionExportDownloadRepository(
        database,
        f.objects,
        f.principal,
        authority.ownership,
      );
      const execute = () => handler.execute(running, context);
      async function complete(outcome: Awaited<ReturnType<typeof execute>>) {
        const completedAt =
          outcome.outcome === "failed" && outcome.checkpoint !== undefined
            ? outcome.checkpoint.createdAt
            : f.at(6);
        const transition = applyAsyncJobLifecycleCommandV1(running, {
          kind: "complete-attempt",
          at: completedAt,
          expectedInputDigest: running.inputDigest,
          expectedRecordVersion: running.recordVersion,
          attemptId: asyncJobAttemptIdSchema.parse(identity.attemptId),
          workerId: asyncJobWorkerIdSchema.parse(identity.workerId),
          handler: {
            family: handler.family,
            handlerId: namespacedIdentifierSchema.parse(handler.handlerId),
            handlerVersion: handler.handlerVersion,
            resumePolicy: handler.resumePolicy,
          },
          outcome,
        });
        if (transition.transition === undefined)
          throw new Error("Expected genuine terminal transition.");
        return jobs.saveWithAudit(transition.job, running.recordVersion, [
          createJobAuditOutboxEntryV1({
            actor: {
              kind: "worker",
              workerId: asyncJobWorkerIdSchema.parse(identity.workerId),
            },
            eventType:
              outcome.outcome === "succeeded" ? "job-succeeded" : "job-failed",
            occurredAt: completedAt,
            record: transition.job,
            transition: transition.transition,
          }),
        ]);
      }
      return {
        f,
        running,
        identity,
        handler,
        context,
        compiler,
        validation,
        build,
        terminal,
        reader,
        execute,
        complete,
      };
    }

    function trusted(f: Awaited<ReturnType<typeof persistedExportRunFixture>>) {
      return asyncJobTrustedContextV1Schema.parse({
        actor: { kind: "system", reason: "orphan-reconciler" },
        correlationId: f.principal.correlationId,
        ownership: {
          organizationId: f.selector.organizationId,
          projectId: f.selector.projectId,
        },
      });
    }
    async function completed() {
      const h = await fixture();
      const outcome = await h.execute();
      expect(outcome.outcome).toBe("succeeded");
      const root = await h.complete(outcome);
      return {
        ...h,
        root,
        recovery: new PostgresSolutionExportTerminalRecovery(
          database,
          h.f.objects,
        ),
      };
    }
    async function artifactCount(h: Awaited<ReturnType<typeof completed>>) {
      const found = await database.query(
        sql(
          "SELECT count(*)::int AS count FROM solution_export_artifacts WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3",
          [h.f.selector.organizationId, h.f.selector.projectId, h.root.jobId],
        ),
      );
      return found.rows[0]?.["count"];
    }
    it("projects a genuine failed terminal receipt without an artifact or another execution", async () => {
      const h = await fixture();
      h.compiler.mockImplementationOnce(() =>
        Promise.resolve({
          exitCode: 1,
          stderr: "Synthetic compiler rejection",
          stdout: "",
          termination: "completed" as const,
        }),
      );
      const outcome = await h.execute();
      expect(outcome.outcome).toBe("failed");
      const root = await h.complete(outcome);
      if (outcome.outcome === "failed")
        expect(root.failure).toEqual(outcome.failure);
      const recovery = new PostgresSolutionExportTerminalRecovery(
        database,
        h.f.objects,
      );
      const result = await recovery.recover(trusted(h.f), root.jobId);
      expect(result.job.state).toBe("failed");
      expect(result.job.artifact).toBeUndefined();
      expect(
        await new PostgresSolutionExportTerminalRecovery(
          database,
          h.f.objects,
        ).recover(trusted(h.f), root.jobId),
      ).toEqual(result);
      expect(h.compiler).toHaveBeenCalledTimes(1);
      expect(h.validation).not.toHaveBeenCalled();
    }, 60000);
    it("recovers original compiler failure after the real JobWorker durably saved its checkpoint exactly once", async () => {
      const f = await persistedExportRunFixture(database);
      await f.publish(
        f.source.generationRequest.workloadBehavior,
        "input-payload",
        f.record.workflowSubmission.request.sources.workloadBehavior.objectId,
      );
      const queued = await f.createRoot();
      await f.repository.insertPreparedRun(f.prepared);
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
      const repository = new PostgresAsyncJobRepository({
        database,
        objects: objects.jobPort(
          f.binding.orchestrationInputObjectId,
          queued.inputDigest,
        ),
        ownership: queued.ownership,
      });
      const clock = new MutableJobClock(f.at(2));
      const ids = new SequentialJobIdGenerator(nonce);
      const queue = new InMemoryFifoJobQueue(ids);
      const audit = new InMemoryJobAuditPort();
      const publicationReadiness = new SolutionExportPublicationReadiness(
        authority,
        objects,
        f.repository,
      );
      const settings =
        f.record.workflowSubmission.request.targetSettings.stageDescriptors;
      if (!("terraformValidation" in settings))
        throw new Error("Terraform fixture required.");
      const compiler = vi.fn(() =>
        Promise.resolve({
          exitCode: 1,
          stderr: "Synthetic compiler rejection",
          stdout: "",
          termination: "completed" as const,
        }),
      );
      const validation = vi.fn(() =>
        Promise.reject(new Error("Failed compiler must not reach validation.")),
      );
      const build = vi.fn(() =>
        Promise.reject(
          new Error("Infrastructure-only never builds applications."),
        ),
      );
      const handler = createDurableSolutionExportHandler({
        database,
        objectStore: f.objects,
        compiler: { executor: { execute: compiler } },
        validation: {
          approvedSettings: settings.terraformValidation,
          runner: { run: validation },
        },
        applicationBuild: {
          approvedSettings: settings.applicationBuild,
          runner: { run: build },
        },
        diagram: {
          catalog: exportTerminalIconRegistry.catalog,
          iconSet: exportTerminalIconSet,
        },
        clock,
      });
      let returned: AsyncJobHandlerOutcomeV1 | undefined;
      const observedHandler: JobHandlerV1 = {
        ...handler,
        async execute(record, context) {
          returned = await handler.execute(record, {
            ...context,
            heartbeat: () => {
              // Advance only the synthetic clock; the actual worker persists every heartbeat.
              clock.advance(1_000);
              return context.heartbeat();
            },
          });
          clock.advance(1_000);
          return returned;
        },
      };
      const service = new JobService({
        audit,
        clock,
        ids,
        queue,
        repository,
        publicationReadiness,
        entitlement: {
          evaluate: () =>
            Promise.reject(
              new Error("Recovery never readmits the genuine root."),
            ),
        },
      });
      expect(await service.publishQueuedJob(trusted(f), queued.jobId)).toBe(
        true,
      );
      const worker = new JobWorker({
        audit,
        clock,
        ids,
        queue,
        repository,
        publicationReadiness,
        failureClassifier: new DefaultJobFailureClassifier(),
        handlers: new InMemoryJobHandlerRegistry([observedHandler]),
        orchestration: new InMemoryJobOrchestrationDecisionPort(),
      });
      const root = await worker.runNext("worker.integration", 300_000);
      if (root === null || returned?.outcome !== "failed")
        throw new Error("Expected genuine worker compiler failure.");
      expect(root.state).toBe("failed");
      expect(root.failure).toEqual(returned.failure);
      expect(root.failure?.code).toBe(
        "cloudmarkup.export.compiler-command-failed",
      );
      expect(root.checkpoints).toHaveLength(1);
      expect(root.checkpoints[0]).toEqual(returned.checkpoint);
      expect(Date.parse(root.completedAt ?? "")).toBeGreaterThan(
        Date.parse(root.checkpoints[0]?.createdAt ?? ""),
      );
      const checkpointEvents = await database.query(
        sql(
          "SELECT count(*)::int AS count FROM async_job_events WHERE organization_id=$1 AND job_id=$2 AND event_kind='checkpoint-recorded'",
          [f.selector.organizationId, queued.jobId],
        ),
      );
      expect(checkpointEvents.rows[0]?.["count"]).toBe(1);
      expect(
        audit.events.filter(
          (event) => event.eventType === "checkpoint-recorded",
        ),
      ).toHaveLength(1);
      expect(await repository.get(queued.jobId)).toEqual(root);
      const recovery = new PostgresSolutionExportTerminalRecovery(
        database,
        f.objects,
      );
      expect(await recovery.list(trusted(f))).toEqual([root.jobId]);
      const projected = await recovery.recover(trusted(f), root.jobId);
      expect(projected.job.state).toBe("failed");
      expect(projected.job.artifact).toBeUndefined();
      expect(
        await new PostgresSolutionExportTerminalRecovery(
          database,
          f.objects,
        ).recover(trusted(f), root.jobId),
      ).toEqual(projected);
      expect(await worker.runNext("worker.integration", 300_000)).toBeNull();
      expect(compiler).toHaveBeenCalledTimes(1);
      expect(validation).not.toHaveBeenCalled();
      expect(build).not.toHaveBeenCalled();
      expect(queue.size).toBe(0);
      const artifacts = await database.query(
        sql(
          "SELECT count(*)::int AS count FROM solution_export_artifacts WHERE organization_id=$1 AND project_id=$2 AND solution_export_run_id=$3",
          [f.selector.organizationId, f.selector.projectId, root.jobId],
        ),
      );
      expect(artifacts.rows[0]?.["count"]).toBe(0);
    }, 60000);
    it("leaves attempt-less queued cancellation explicitly unavailable", async () => {
      const f = await persistedExportRunFixture(database);
      await f.createRoot();
      await f.repository.insertPreparedRun(f.prepared);
      const root = await f.cancelRoot();
      expect(root.state).toBe("canceled");
      expect(root.attempts).toEqual([]);
      const recovery = new PostgresSolutionExportTerminalRecovery(
        database,
        f.objects,
      );
      expect(await recovery.list(trusted(f))).toEqual([]);
      await expect(
        recovery.recover(trusted(f), root.jobId),
      ).rejects.toMatchObject({ code: "not_found" });
    }, 60000);
    it("recovers a committed root in fresh instances, without an in-memory execution identity, and publishes once under concurrent replay", async () => {
      const h = await completed();
      const context = trusted(h.f);
      expect(await artifactCount(h)).toBe(0);
      expect(await h.recovery.list(context, 1)).toEqual([h.root.jobId]);
      const results = await Promise.all([
        h.recovery.recover(context, h.root.jobId),
        new PostgresSolutionExportTerminalRecovery(
          database,
          h.f.objects,
        ).recover(context, h.root.jobId),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0].job.state).toBe("succeeded");
      expect(await artifactCount(h)).toBe(1);
      expect(await h.recovery.list(context, 1)).toEqual([]);
      expect(
        await new PostgresSolutionExportTerminalRecovery(
          database,
          h.f.objects,
        ).recover(context, h.root.jobId),
      ).toEqual(results[0]);
      expect(h.compiler).toHaveBeenCalledTimes(1);
      expect(h.validation).toHaveBeenCalledTimes(1);
    }, 60000);
    it("filters another tenant before limit and never reads its objects for a guessed job", async () => {
      const foreign = await completed();
      const h = await completed();
      const open = vi.spyOn(h.f.objects, "open");
      expect(await h.recovery.list(trusted(h.f), 1)).toEqual([h.root.jobId]);
      await expect(
        h.recovery.recover(trusted(h.f), foreign.root.jobId),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(open).not.toHaveBeenCalled();
      expect(await artifactCount(h)).toBe(0);
      expect(await artifactCount(foreign)).toBe(0);
    }, 60000);
    it.each(["viewer", "suspended"] as const)(
      "rechecks current creating-principal authority: %s",
      async (mode) => {
        const h = await completed();
        await database.query(
          mode === "viewer"
            ? sql(
                "UPDATE memberships SET role_key='viewer' WHERE membership_id=$1",
                [h.f.membershipId],
              )
            : sql(
                "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
                [h.f.membershipId],
              ),
        );
        const open = vi.spyOn(h.f.objects, "open");
        expect(await h.recovery.list(trusted(h.f))).toEqual([]);
        await expect(
          h.recovery.recover(trusted(h.f), h.root.jobId),
        ).rejects.toMatchObject({ code: "not_found" });
        expect(open).not.toHaveBeenCalled();
        expect(await artifactCount(h)).toBe(0);
      },
      60000,
    );
    it("refuses a retired current root snapshot, without treating retained stage objects as authority", async () => {
      const h = await completed();
      await database.query(
        sql(
          `UPDATE stored_objects SET lifecycle_state='delete-pending',delete_requested_at=clock_timestamp()
      WHERE object_id=(SELECT snapshot_object_id FROM async_job_record_snapshots WHERE organization_id=$1 AND job_id=$2 AND record_version=$3)`,
          [h.f.selector.organizationId, h.root.jobId, h.root.recordVersion],
        ),
      );
      expect(await h.recovery.list(trusted(h.f))).toEqual([]);
      await expect(
        h.recovery.recover(trusted(h.f), h.root.jobId),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(await artifactCount(h)).toBe(0);
    }, 60000);
    it("retains recoverability across an interrupted immutable read", async () => {
      const h = await completed();
      const open = vi
        .spyOn(h.f.objects, "open")
        .mockRejectedValueOnce(new Error("Synthetic interrupted object read"));
      await expect(
        h.recovery.recover(trusted(h.f), h.root.jobId),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(await artifactCount(h)).toBe(0);
      open.mockRestore();
      expect(
        (
          await new PostgresSolutionExportTerminalRecovery(
            database,
            h.f.objects,
          ).recover(trusted(h.f), h.root.jobId)
        ).job.state,
      ).toBe("succeeded");
      expect(await artifactCount(h)).toBe(1);
    }, 60000);
    it("rejects corrupted root bytes and never publishes a replacement", async () => {
      const h = await completed();
      vi.spyOn(h.f.objects, "open").mockImplementationOnce(() =>
        Promise.resolve(
          (async function* () {
            yield await Promise.resolve(new TextEncoder().encode("{}"));
          })(),
        ),
      );
      await expect(
        h.recovery.recover(trusted(h.f), h.root.jobId),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(await artifactCount(h)).toBe(0);
    }, 60000);
    it("rechecks membership after delayed object I/O before any artifact publication", async () => {
      const h = await completed();
      const original = h.f.objects.open.bind(h.f.objects);
      vi.spyOn(h.f.objects, "open").mockImplementationOnce(
        async (scope, reference) => {
          const stream = await original(scope, reference);
          await database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
              [h.f.membershipId],
            ),
          );
          return stream;
        },
      );
      await expect(
        h.recovery.recover(trusted(h.f), h.root.jobId),
      ).rejects.toThrow();
      expect(await artifactCount(h)).toBe(0);
    }, 60000);
    it("keeps terminal roots with missing immutable receipt unavailable, without reexecuting the worker", async () => {
      const h = await completed();
      const receipt = h.terminal.storage.identity("terminal-receipt", {
        jobId: h.root.jobId,
        attemptId: h.identity.attemptId,
        value: null,
      });
      await database.query(
        sql(
          "UPDATE stored_objects SET lifecycle_state='delete-pending',delete_requested_at=clock_timestamp() WHERE object_id=$1",
          [receipt],
        ),
      );
      await expect(
        h.recovery.recover(trusted(h.f), h.root.jobId),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(await artifactCount(h)).toBe(0);
      expect(h.compiler).toHaveBeenCalledTimes(1);
    }, 60000);
  },
);
