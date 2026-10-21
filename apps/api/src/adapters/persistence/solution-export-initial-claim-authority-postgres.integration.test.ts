import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../../application/errors.js";
import { closeProjectContentWrites } from "./project-content-write-fence.js";
import {
  createAsyncJobFailureV1,
  deriveAsyncJobQueueEnvelopeV1,
} from "@cloudmarkup/domain";
import {
  DefaultJobFailureClassifier,
  JobWorker,
  type JobHandlerV1,
} from "@cloudmarkup/job-framework";
import {
  serializeCanonicalJson,
  type AsyncJobQueueEnvelopeV1,
} from "@cloudmarkup/schemas";
import { terraformValidationRequestV1Schema } from "@cloudmarkup/terraform-validation-runner";
import {
  goCompilationResultV1Schema,
  type SolutionExportCompilerCommandExecutor,
} from "@cloudmarkup/solution-export-workflow";
import { createPinnedSolutionExportCompilerExecutor } from "../pinned-export-compiler.js";
import {
  createSolutionExportDeliveredWorker,
  createSolutionExportQueueHandler,
} from "../../solution-export-consumer.js";
import {
  exportTerminalIconRegistry,
  exportTerminalIconSet,
  syntheticBoundValidationResult,
} from "./solution-export-terminal-test-helpers.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { persistedExportRunFixture } from "./solution-export-run-test-helpers.js";
import { authorizeSolutionExportInitialClaim } from "./solution-export-initial-claim-authority.js";
import {
  claimInitialSolutionExport,
  claimSolutionExport,
} from "./solution-export-initial-claim.js";
import {
  createSolutionExportExecutionRepository,
  retryOrphanedSolutionExport,
} from "./solution-export-execution-repository.js";
import {
  solutionExportExecutionIdentity,
  SolutionExportWorkerAuthority,
} from "./solution-export-worker-authority.js";
import {
  sql,
  type SqlExecutor,
  type SqlDatabase,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_export_initial_claim_it_${nonce}`;
const marker = `CloudMarkup synthetic initial export authority ${nonce}`;
function signal() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: () => {
      if (resolve === undefined) throw new Error("Synthetic signal absent");
      resolve();
    },
  };
}

suite(
  "initial export claim and execution persistence on isolated real PostgreSQL",
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
        !/^cm_export_initial_claim_it_[a-f0-9]{32}$/u.test(schema)
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
            !/^cm_export_initial_claim_it_[a-f0-9]{32}$/u.test(schema)
          )
            throw new Error("Refusing unverified synthetic schema cleanup.");
          await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
        }
      } finally {
        await admin?.close();
      }
    }, 30_000);

    async function fixture(prepared = true) {
      const f = await persistedExportRunFixture(database);
      await f.publish(
        f.source.generationRequest.workloadBehavior,
        "input-payload",
        f.record.workflowSubmission.request.sources.workloadBehavior.objectId,
      );
      const root = await f.createRoot();
      if (prepared) await f.repository.insertPreparedRun(f.prepared);
      return { ...f, root, envelope: deriveAsyncJobQueueEnvelopeV1(root) };
    }
    async function workerFixture() {
      const f = await fixture();
      const workerId = "worker.persisted-execution";
      const claimed = await claimInitialSolutionExport({
        database,
        objectStore: f.objects,
        envelope: f.envelope,
        workerId,
      });
      const repository = await createSolutionExportExecutionRepository({
        database,
        objectStore: f.objects,
        claimed,
      });
      const execute = vi.fn<JobHandlerV1["execute"]>().mockResolvedValue({
        outcome: "failed",
        failure: createAsyncJobFailureV1("handler-permanent-failure"),
      });
      const handler: JobHandlerV1 = {
        family: "solution-export-orchestration",
        handlerId: "cloudmarkup.solution-export.workflow",
        handlerVersion: "1.0.0",
        resumePolicy: "restart-from-input",
        execute,
      };
      const publish = vi.fn(() => Promise.resolve());
      const worker = new JobWorker({
        audit: { append: () => Promise.resolve() },
        clock: { now: () => new Date() },
        failureClassifier: new DefaultJobFailureClassifier(),
        handlers: {
          get: (family) => (family === handler.family ? handler : null),
        },
        ids: { nextId: (kind) => `${kind}.${randomUUID()}` },
        orchestration: {
          record: () =>
            Promise.reject(new Error("A self-root export has no parent.")),
        },
        publisher: { contractVersion: 1, publish },
        repository,
      });
      return { ...f, workerId, claimed, repository, execute, publish, worker };
    }
    async function consumerFixture(
      executor?: SolutionExportCompilerCommandExecutor,
    ) {
      const f = await fixture();
      const settings =
        f.record.workflowSubmission.request.targetSettings.stageDescriptors;
      if (!("terraformValidation" in settings))
        throw new Error("Synthetic Terraform fixture required.");
      const compiler = vi.fn(
        (
          input: Parameters<
            SolutionExportCompilerCommandExecutor["execute"]
          >[0],
        ) =>
          executor?.execute(input) ??
          Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: serializeCanonicalJson(f.source.compilation),
            termination: "completed" as const,
          }),
      );
      const validation = vi.fn((value: unknown) =>
        Promise.resolve(
          syntheticBoundValidationResult(
            terraformValidationRequestV1Schema.parse(value),
            settings.terraformValidation,
          ),
        ),
      );
      const publisher = {
        contractVersion: 1 as const,
        publish: vi.fn(() => Promise.resolve()),
      };
      const worker = createSolutionExportDeliveredWorker({
        database,
        objectStore: f.objects,
        workerId: "worker.delivered-export",
        clock: { now: () => new Date() },
        audit: { append: () => Promise.resolve() },
        publisher,
        compiler: { executor: { execute: compiler } },
        validation: {
          approvedSettings: settings.terraformValidation,
          runner: { run: validation },
        },
        applicationBuild: {
          approvedSettings: settings.applicationBuild,
          runner: {
            run: () =>
              Promise.reject(
                new Error(
                  "Infrastructure fixture must not build applications.",
                ),
              ),
          },
        },
        diagram: {
          catalog: exportTerminalIconRegistry.catalog,
          iconSet: exportTerminalIconSet,
        },
      });
      const queueArn =
        "arn:aws:sqs:us-east-1:123456789012:cloudmarkup-beta-jobs.fifo";
      const consume = createSolutionExportQueueHandler({
        expectedQueueArn: queueArn,
        worker,
      });
      const event = {
        Records: [
          {
            messageId: "delivery_export_test",
            body: serializeCanonicalJson(f.envelope),
            eventSource: "aws:sqs",
            eventSourceARN: queueArn,
          },
        ],
      };
      return { ...f, compiler, validation, publisher, worker, consume, event };
    }
    it("runs a delivered export through genuine PG lifecycle and reconciles artifacts before ACK", async () => {
      const f = await consumerFixture();
      expect(await f.consume(f.event)).toEqual({ batchItemFailures: [] });
      expect(f.compiler).toHaveBeenCalledTimes(1);
      const run = await f.repository.getJob(f.selector);
      expect(run?.record.job.state).toBe("succeeded");
      expect(run?.record.job.artifact?.fileCount).toBeGreaterThan(0);
      expect(await f.consume(f.event)).toEqual({ batchItemFailures: [] });
      expect(f.compiler).toHaveBeenCalledTimes(1);
      expect(f.publisher.publish).not.toHaveBeenCalled();
      // All persisted stages and duplicate reconciliation take about 50 seconds
      // on the Windows loopback fixture; retain bounded integration headroom.
    }, 90_000);
    it.skipIf(
      process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"] === undefined,
    )(
      "rejects a historical compiler-bound revision through the current compiler without publishing success",
      async () => {
        const f = await consumerFixture(
          createPinnedSolutionExportCompilerExecutor({
            executablePath:
              process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"] ?? "",
            executableSha256:
              process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"] ?? "",
          }),
        );
        const delivery = await f.consume(f.event);
        expect(f.compiler).toHaveBeenCalledTimes(1);
        const result = f.compiler.mock.results[0];
        if (result?.type !== "return")
          throw new Error("Compiler result absent.");
        const compilation = await result.value;
        expect(compilation).toMatchObject({
          exitCode: 2,
          termination: "completed",
        });
        const output = goCompilationResultV1Schema.parse(
          JSON.parse(compilation.stdout) as unknown,
        );
        expect(compilation.stderr).toBe("");
        expect(compilation.exitCode).toBe(2);
        // This immutable fixture retains its historical compiler pin. The current
        // executable must reject it before target-resource validation.
        expect(output.diagnostics?.map(({ code }) => code)).toEqual([
          "COMPAT_SOLUTION_COMPILER_MISMATCH",
        ]);
        const job = (await f.repository.getJob(f.selector))?.record.job;
        expect(job?.state).toBe("failed");
        expect(job?.artifact).toBeUndefined();
        expect(delivery).toEqual({ batchItemFailures: [] });
        expect(f.validation).not.toHaveBeenCalled();
        expect(await f.consume(f.event)).toEqual({ batchItemFailures: [] });
        expect(f.compiler).toHaveBeenCalledTimes(1);
      },
      60_000,
    );
    it("retains export recovery content while a deleted project's canonical work is unfinished", async () => {
      const f = await fixture();
      const selector = {
        organizationId: f.record.organizationId,
        projectId: f.record.job.projectId,
      };
      await database.query(
        sql(
          "UPDATE projects SET lifecycle_status='deletion-pending',deletion_requested_at=clock_timestamp(),record_version=record_version+1 WHERE organization_id=$1 AND project_id=$2",
          [selector.organizationId, selector.projectId],
        ),
      );
      expect((await closeProjectContentWrites(database, selector)).ready).toBe(
        false,
      );
    });

    it("commits a real worker progress and terminal failure with its attempt and audit", async () => {
      const f = await workerFixture();
      const completed = await f.worker.runInitialClaimed(f.claimed, f.workerId);
      expect(completed.state).toBe("failed");
      expect(f.execute).toHaveBeenCalledTimes(1);
      expect(f.publish).not.toHaveBeenCalled();
      expect(await f.repository.get(completed.jobId)).toEqual(completed);
      const rows = await database.query(
        sql(
          "SELECT j.lifecycle_status,a.lifecycle_status AS attempt_state,(SELECT count(*) FROM async_job_events e WHERE e.organization_id=j.organization_id AND e.job_id=j.job_id AND e.event_kind='job-failed') AS terminal_events FROM async_jobs j JOIN async_job_attempts a ON a.organization_id=j.organization_id AND a.job_id=j.job_id WHERE j.job_id=$1",
          [completed.jobId],
        ),
      );
      expect(rows.rows).toEqual([
        {
          lifecycle_status: "failed",
          attempt_state: "failed",
          terminal_events: "1",
        },
      ]);
      await expect(
        f.worker.runInitialClaimed(f.claimed, f.workerId),
      ).rejects.toThrow();
      expect(f.execute).toHaveBeenCalledTimes(1);
    });

    it("admits only an exact due retry from the same immutable root", async () => {
      const f = await workerFixture();
      f.execute.mockResolvedValueOnce({
        outcome: "failed",
        failure: createAsyncJobFailureV1("handler-transient-failure"),
      });
      const queued = await f.worker.runInitialClaimed(f.claimed, f.workerId);
      expect(queued.state).toBe("queued");
      const retry = deriveAsyncJobQueueEnvelopeV1(queued);
      expect(retry.attemptNumber).toBe(2);
      const claim = (envelope: unknown) =>
        claimSolutionExport({
          database,
          objectStore: f.objects,
          envelope,
          workerId: "worker.retry-export",
        });
      await expect(claim(retry)).rejects.toThrow();
      await delay(Math.max(0, Date.parse(retry.availableAt) - Date.now()) + 25);
      const before = await state(queued.jobId);
      await expect(claim(f.envelope)).rejects.toThrow();
      await expect(claim({ ...retry, attemptNumber: 3 })).rejects.toThrow();
      await expect(
        claim({ ...retry, availableAt: f.envelope.availableAt }),
      ).rejects.toThrow();
      expect(await state(queued.jobId)).toEqual(before);
      const claimed = await claim(retry);
      expect(claimed.attempts).toHaveLength(2);
      expect(claimed.input).toEqual(f.claimed.input);
      expect(claimed.progress?.completedUnits).toBe(
        queued.progress?.completedUnits,
      );
      const repository = await createSolutionExportExecutionRepository({
        database,
        objectStore: f.objects,
        claimed,
      });
      const execute = vi.fn<JobHandlerV1["execute"]>().mockResolvedValue({
        outcome: "failed",
        failure: createAsyncJobFailureV1("handler-permanent-failure"),
      });
      const worker = new JobWorker({
        audit: { append: () => Promise.resolve() },
        clock: { now: () => new Date() },
        failureClassifier: new DefaultJobFailureClassifier(),
        handlers: {
          get: () => ({
            family: "solution-export-orchestration",
            handlerId: "cloudmarkup.solution-export.workflow",
            handlerVersion: "1.0.0",
            resumePolicy: "restart-from-input",
            execute,
          }),
        },
        ids: { nextId: (kind) => `${kind}.${randomUUID()}` },
        orchestration: {
          record: () => Promise.reject(new Error("Self-root export")),
        },
        publisher: { contractVersion: 1, publish: f.publish },
        repository,
      });
      expect(
        (await worker.runClaimed(claimed, "worker.retry-export")).state,
      ).toBe("failed");
      await expect(
        worker.runClaimed(claimed, "worker.retry-export"),
      ).rejects.toThrow();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(f.publish).not.toHaveBeenCalled();
    }, 30_000);

    it("allows only one concurrent persisted execution of a delivered initial claim", async () => {
      const f = await workerFixture();
      const results = await Promise.allSettled([
        f.worker.runInitialClaimed(f.claimed, f.workerId),
        f.worker.runInitialClaimed(f.claimed, f.workerId),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(f.execute).toHaveBeenCalledTimes(1);
    });

    it("rejects a revoked creator and an unrelated root before handler execution", async () => {
      const f = await workerFixture();
      await expect(f.repository.get("job.foreign")).rejects.toThrow();
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.selector.organizationId, f.principal.principalId],
        ),
      );
      await expect(
        f.worker.runInitialClaimed(f.claimed, f.workerId),
      ).rejects.toThrow();
      expect(f.execute).not.toHaveBeenCalled();
    });
    it("atomically claims with a real attempt and audit, with no object I/O under SQL locks", async () => {
      const f = await fixture();
      let transactions = 0;
      const tracked: SqlDatabase = {
        query: (statement) => database.query(statement),
        close: () => Promise.resolve(),
        transaction: (work) =>
          database.transaction(async (tx) => {
            transactions += 1;
            try {
              return await work(tx);
            } finally {
              transactions -= 1;
            }
          }),
      };
      const open = f.objects.open.bind(f.objects);
      const stage = f.objects.stage.bind(f.objects);
      const publish = f.objects.publish.bind(f.objects);
      const readSpy = vi
        .spyOn(f.objects, "open")
        .mockImplementation((scope, reference) => {
          expect(transactions).toBe(0);
          return open(scope, reference);
        });
      vi.spyOn(f.objects, "stage").mockImplementation((scope, input) => {
        expect(transactions).toBe(0);
        return stage(scope, input);
      });
      vi.spyOn(f.objects, "publish").mockImplementation((scope, reference) => {
        expect(transactions).toBe(0);
        return publish(scope, reference);
      });
      const claimed = await claimInitialSolutionExport({
        database: tracked,
        objectStore: f.objects,
        envelope: f.envelope,
        workerId: "worker.initial-claim-test",
      });
      expect(readSpy).toHaveBeenCalled();
      expect(claimed.state).toBe("running");
      expect(claimed.recordVersion).toBe(f.root.recordVersion + 1);
      expect(claimed.attempts).toHaveLength(1);
      expect(await state(f.root.jobId)).toMatchObject({
        lifecycle_status: "running",
        attempts: "1",
      });
      const events = await database.query(
        sql(
          "SELECT event_kind FROM async_job_events WHERE organization_id=$1 AND job_id=$2 AND event_kind='attempt-claimed'",
          [f.record.organizationId, f.root.jobId],
        ),
      );
      expect(events.rows).toHaveLength(1);
      await expect(
        new SolutionExportWorkerAuthority(
          database,
          solutionExportExecutionIdentity(claimed),
        ).scope(),
      ).resolves.toMatchObject({ principalId: f.principal.principalId });
      await expect(
        claimInitialSolutionExport({
          database,
          objectStore: f.objects,
          envelope: f.envelope,
          workerId: "worker.duplicate-claim-test",
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(await state(f.root.jobId)).toMatchObject({ attempts: "1" });
    });

    async function expiredExecution() {
      const f = await fixture();
      const claimed = await claimInitialSolutionExport({
        database,
        objectStore: f.objects,
        envelope: f.envelope,
        workerId: "worker.expired-export",
        leaseMilliseconds: 2000,
      });
      const expiresAt = claimed.attempts.at(-1)?.lease?.leaseExpiresAt;
      if (expiresAt === undefined)
        throw new Error("Expected a persisted lease.");
      await delay(Math.max(0, Date.parse(expiresAt) - Date.now() + 25));
      return {
        ...f,
        claimed,
        identity: solutionExportExecutionIdentity(claimed),
      };
    }

    it("retries an expired worker once from the exact immutable input and fences the old worker", async () => {
      const f = await expiredExecution();
      const stale = new SolutionExportWorkerAuthority(database, f.identity);
      await expect(stale.scope()).rejects.toThrow();
      const retried = await retryOrphanedSolutionExport({
        database,
        objectStore: f.objects,
        identity: f.identity,
      });
      expect(retried.state).toBe("queued");
      expect(retried.input).toEqual(f.claimed.input);
      expect(retried.attempts.at(-1)?.state).toBe("orphaned");
      expect(retried.recordVersion).toBe(f.claimed.recordVersion + 1);
      await expect(stale.scope()).rejects.toThrow();
      await expect(
        retryOrphanedSolutionExport({
          database,
          objectStore: f.objects,
          identity: f.identity,
        }),
      ).rejects.toThrow();
      const envelope = deriveAsyncJobQueueEnvelopeV1(retried);
      const delayMs = Math.max(
        0,
        Date.parse(envelope.availableAt) - Date.now() + 25,
      );
      expect(delayMs).toBeLessThan(60_000);
      await delay(delayMs);
      const next = await claimSolutionExport({
        database,
        objectStore: f.objects,
        envelope,
        workerId: "worker.replacement-export",
      });
      expect(next.attempts).toHaveLength(2);
      expect(next.attempts.at(-1)?.state).toBe("running");
      await expect(stale.scope()).rejects.toThrow();
      const audits = await database.query(
        sql(
          "SELECT count(*)::text AS count FROM async_job_events WHERE organization_id=$1 AND job_id=$2 AND event_kind='orphan-reconciled'",
          [f.selector.organizationId, f.root.jobId],
        ),
      );
      expect(audits.rows[0]?.["count"]).toBe("1");
    }, 90_000);

    it("permits only one concurrent orphan retry", async () => {
      const f = await expiredExecution();
      const results = await Promise.allSettled(
        [0, 1].map(() =>
          retryOrphanedSolutionExport({
            database,
            objectStore: f.objects,
            identity: f.identity,
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(await state(f.root.jobId)).toMatchObject({
        lifecycle_status: "queued",
        attempts: "1",
      });
    });

    it("refuses orphan authority for a live worker or a different tenant", async () => {
      const f = await workerFixture();
      const identity = solutionExportExecutionIdentity(f.claimed);
      await expect(
        retryOrphanedSolutionExport({
          database,
          objectStore: f.objects,
          identity,
        }),
      ).rejects.toThrow();
      await expect(
        retryOrphanedSolutionExport({
          database,
          objectStore: f.objects,
          identity: { ...identity, organizationId: "org.unrelated-export" },
        }),
      ).rejects.toThrow();
      expect(await state(f.root.jobId)).toMatchObject({
        lifecycle_status: "running",
        attempts: "1",
      });
      expect(f.execute).not.toHaveBeenCalled();
    });

    it.each(["revoked creator", "project deletion"])(
      "denies orphan retry after %s without changing the root",
      async (change) => {
        const f = await expiredExecution();
        const before = await state(f.root.jobId);
        if (change === "revoked creator") {
          await database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
              [f.membershipId],
            ),
          );
        } else {
          await database.query(
            sql(
              "UPDATE projects SET lifecycle_status='deletion-pending',deletion_requested_at=clock_timestamp(),record_version=record_version+1 WHERE organization_id=$1 AND project_id=$2",
              [f.selector.organizationId, f.selector.projectId],
            ),
          );
        }
        const read = vi.spyOn(f.objects, "open");
        await expect(
          retryOrphanedSolutionExport({
            database,
            objectStore: f.objects,
            identity: f.identity,
          }),
        ).rejects.toThrow();
        expect(await state(f.root.jobId)).toEqual(before);
        expect(read).not.toHaveBeenCalled();
      },
    );

    it("rolls back orphan retry when its audit cannot commit", async () => {
      const f = await expiredExecution();
      const before = await state(f.root.jobId);
      const failing: SqlDatabase = {
        query: (statement) => database.query(statement),
        close: () => Promise.resolve(),
        transaction: (work) =>
          database.transaction((tx) =>
            work({
              query: (statement) => {
                if (statement.text.startsWith("INSERT INTO async_job_events"))
                  throw new Error("Synthetic orphan audit failure");
                return tx.query(statement);
              },
            }),
          ),
      };
      await expect(
        retryOrphanedSolutionExport({
          database: failing,
          objectStore: f.objects,
          identity: f.identity,
        }),
      ).rejects.toThrow("Synthetic orphan audit failure");
      expect(await state(f.root.jobId)).toEqual(before);
      await expect(
        retryOrphanedSolutionExport({
          database,
          objectStore: f.objects,
          identity: f.identity,
        }),
      ).resolves.toMatchObject({ state: "queued" });
    });

    it("uses the existing FIFO delivery to recover a lost worker without executing during recovery", async () => {
      const f = await consumerFixture();
      const claimed = await claimInitialSolutionExport({
        database,
        objectStore: f.objects,
        envelope: f.envelope,
        workerId: "worker.lost-delivery",
        leaseMilliseconds: 2000,
      });
      expect(await f.consume(f.event)).toEqual({
        batchItemFailures: [{ itemIdentifier: "delivery_export_test" }],
      });
      expect(await state(f.root.jobId)).toMatchObject({
        lifecycle_status: "running",
      });
      const expiresAt = claimed.attempts.at(-1)?.lease?.leaseExpiresAt;
      if (expiresAt === undefined) throw new Error("Expected a lease.");
      await delay(Math.max(0, Date.parse(expiresAt) - Date.now() + 25));
      expect(await f.consume(f.event)).toEqual({
        batchItemFailures: [{ itemIdentifier: "delivery_export_test" }],
      });
      expect(await state(f.root.jobId)).toMatchObject({
        lifecycle_status: "queued",
        attempts: "1",
      });
      expect(f.compiler).not.toHaveBeenCalled();
      expect(f.validation).not.toHaveBeenCalled();
      expect(f.publisher.publish).not.toHaveBeenCalled();
    });

    it("commits exactly one attempt for concurrent delivered copies", async () => {
      const f = await fixture();
      const results = await Promise.allSettled(
        ["worker.race-a", "worker.race-b"].map((workerId) =>
          claimInitialSolutionExport({
            database,
            objectStore: f.objects,
            envelope: f.envelope,
            workerId,
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(await state(f.root.jobId)).toMatchObject({
        lifecycle_status: "running",
        attempts: "1",
      });
    });

    it("rolls back root and attempt when audit insertion fails", async () => {
      const f = await fixture();
      const before = await state(f.root.jobId);
      const failing: SqlDatabase = {
        query: (statement) => database.query(statement),
        close: () => Promise.resolve(),
        transaction: (work) =>
          database.transaction((tx) =>
            work({
              query: (statement) => {
                if (statement.text.startsWith("INSERT INTO async_job_events"))
                  throw new Error("Synthetic audit insertion failure");
                return tx.query(statement);
              },
            }),
          ),
      };
      await expect(
        claimInitialSolutionExport({
          database: failing,
          objectStore: f.objects,
          envelope: f.envelope,
          workerId: "worker.audit-failure",
        }),
      ).rejects.toThrow("Synthetic audit insertion failure");
      expect(await state(f.root.jobId)).toEqual(before);
    });

    it("does not claim after creator revocation during snapshot publication", async () => {
      const f = await fixture();
      const before = await state(f.root.jobId);
      const publish = f.objects.publish.bind(f.objects);
      vi.spyOn(f.objects, "publish").mockImplementation(
        async (scope, reference) => {
          await publish(scope, reference);
          await database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
              [f.membershipId],
            ),
          );
        },
      );
      await expect(
        claimInitialSolutionExport({
          database,
          objectStore: f.objects,
          envelope: f.envelope,
          workerId: "worker.revoked-publication",
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(await state(f.root.jobId)).toEqual(before);
    });

    it("rejects corrupted immutable source bytes before starting an attempt", async () => {
      const f = await fixture();
      const before = await state(f.root.jobId);
      const open = f.objects.open.bind(f.objects);
      vi.spyOn(f.objects, "open").mockImplementation((scope, reference) =>
        reference.purpose === "architecture-revision"
          ? Promise.resolve(
              (async function* () {
                yield await Promise.resolve(new Uint8Array([123, 125]));
              })(),
            )
          : open(scope, reference),
      );
      await expect(
        claimInitialSolutionExport({
          database,
          objectStore: f.objects,
          envelope: f.envelope,
          workerId: "worker.corrupt-source",
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(await state(f.root.jobId)).toEqual(before);
    });

    async function state(jobId: string) {
      return (
        await database.query(
          sql(
            `SELECT j.record_version::text,j.lifecycle_status,j.attempt_count,
       (SELECT count(*)::text FROM async_job_attempts a WHERE a.organization_id=j.organization_id AND a.job_id=j.job_id) AS attempts,
       (SELECT count(*)::text FROM async_job_events e WHERE e.organization_id=j.organization_id AND e.job_id=j.job_id) AS events
       FROM async_jobs j WHERE j.job_id=$1`,
            [jobId],
          ),
        )
      ).rows[0];
    }
    async function authorize(envelope: AsyncJobQueueEnvelopeV1) {
      return database.transaction((tx) =>
        authorizeSolutionExportInitialClaim(tx, envelope),
      );
    }

    it("derives the genuine persisted requester and current canonical rights without creating an attempt/session", async () => {
      const f = await fixture();
      const before = await state(f.root.jobId);
      const binding = await authorize(f.envelope);
      expect(binding.context).toEqual({
        actor: { kind: "principal", actorId: f.principal.principalId },
        correlationId: f.root.correlationId,
        ownership: f.root.ownership,
      });
      expect(binding.envelope).toEqual(f.envelope);
      expect(binding.runRecordVersion).toBe(1);
      expect(binding.role).toBe("owner");
      expect(binding).not.toHaveProperty("principal");
      expect(binding).not.toHaveProperty("sessionId");
      expect(binding).not.toHaveProperty("attemptId");
      expect(() => solutionExportExecutionIdentity(f.root)).toThrow();
      expect(await state(f.root.jobId)).toEqual(before);
    });
    it.each(["administrator", "editor"] as const)(
      "uses current %s rights without changing the original creator",
      async (role) => {
        const f = await fixture();
        await database.query(
          sql("UPDATE memberships SET role_key=$1 WHERE membership_id=$2", [
            role,
            f.membershipId,
          ]),
        );
        const binding = await authorize(f.envelope);
        expect(binding.role).toBe(role);
        expect(binding.context.actor).toEqual({
          kind: "principal",
          actorId: f.principal.principalId,
        });
      },
    );
    it.each([
      "viewer",
      "membership",
      "principal",
      "project",
      "organization",
    ] as const)(
      "denies current %s authority before any attempt/audit write",
      async (kind) => {
        const f = await fixture();
        const before = await state(f.root.jobId);
        const mutation = {
          viewer: sql(
            "UPDATE memberships SET role_key='viewer' WHERE membership_id=$1",
            [f.membershipId],
          ),
          membership: sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
            [f.membershipId],
          ),
          principal: sql(
            "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
            [f.principal.principalId],
          ),
          project: sql(
            "UPDATE projects SET lifecycle_status='archived' WHERE organization_id=$1 AND project_id=$2",
            [f.record.organizationId, f.record.job.projectId],
          ),
          organization: sql(
            "UPDATE organizations SET lifecycle_status='suspended' WHERE organization_id=$1",
            [f.record.organizationId],
          ),
        }[kind];
        await database.query(mutation);
        await expect(authorize(f.envelope)).rejects.toMatchObject({
          code: kind === "viewer" ? "access_denied" : "not_found",
        });
        expect(await state(f.root.jobId)).toEqual(before);
      },
    );
    it("rejects cross-tenant and cross-project selectors without exposing the actual creator", async () => {
      const f = await fixture();
      const foreign = await fixture();
      const before = await state(f.root.jobId);
      for (const ownership of [
        foreign.envelope.ownership,
        {
          ...f.envelope.ownership,
          projectId: foreign.envelope.ownership.projectId,
        },
      ]) {
        await expect(
          authorize({ ...f.envelope, ownership }),
        ).rejects.toMatchObject({ code: "not_found" });
      }
      expect(await state(f.root.jobId)).toEqual(before);
    });
    it.each(["version", "digest", "correlation", "availability"] as const)(
      "rejects an altered %s against the original queued envelope",
      async (kind) => {
        const f = await fixture();
        const before = await state(f.root.jobId);
        const input = {
          ...f.envelope,
          ...(kind === "version"
            ? { recordVersion: f.envelope.recordVersion + 1 }
            : {}),
          ...(kind === "digest"
            ? { inputDigest: `sha256:${"f".repeat(64)}` }
            : {}),
          ...(kind === "correlation"
            ? { correlationId: "correlation.foreign" }
            : {}),
          ...(kind === "availability" ? { availableAt: f.at(1) } : {}),
        };
        await expect(
          database.transaction((tx) =>
            authorizeSolutionExportInitialClaim(tx, input),
          ),
        ).rejects.toMatchObject({ code: "conflict" });
        expect(await state(f.root.jobId)).toEqual(before);
      },
    );
    it("refuses a genuine allowed root until its prepared run is committed", async () => {
      const f = await fixture(false);
      const before = await state(f.root.jobId);
      await expect(authorize(f.envelope)).rejects.toMatchObject({
        code: "not_found",
      });
      expect(await state(f.root.jobId)).toEqual(before);
    });
    it.each(["root", "prepared"] as const)(
      "refuses a retired exact %s snapshot without creating an attempt",
      async (kind) => {
        const f = await fixture();
        const before = await state(f.root.jobId);
        const objectId =
          kind === "prepared"
            ? f.prepared.snapshot.objectId
            : (
                await database.query(
                  sql(
                    "SELECT snapshot_object_id FROM async_job_record_snapshots WHERE organization_id=$1 AND job_id=$2 AND record_version=$3",
                    [
                      f.record.organizationId,
                      f.root.jobId,
                      f.root.recordVersion,
                    ],
                  ),
                )
              ).rows[0]?.["snapshot_object_id"];
        if (typeof objectId !== "string")
          throw new Error("Synthetic snapshot absent");
        await database.query(
          sql(
            "UPDATE stored_objects SET lifecycle_state='delete-pending',delete_requested_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND object_id=$3",
            [f.record.organizationId, f.record.job.projectId, objectId],
          ),
        );
        await expect(authorize(f.envelope)).rejects.toMatchObject({
          code: "not_found",
        });
        expect(await state(f.root.jobId)).toEqual(before);
      },
    );
    it("rejects an initial delivery after a genuine existing claim and preserves the running authority path", async () => {
      const f = await fixture();
      const running = await f.startRoot();
      const before = await state(f.root.jobId);
      await expect(authorize(f.envelope)).rejects.toMatchObject({
        code: "conflict",
      });
      const worker = new SolutionExportWorkerAuthority(
        database,
        solutionExportExecutionIdentity(running),
      );
      expect((await worker.scope()).principalId).toBe(f.principal.principalId);
      expect(await state(f.root.jobId)).toEqual(before);
      expect(before?.["attempts"]).toBe("1");
    });
    it("rejects the original envelope after genuine queued cancellation", async () => {
      const f = await fixture();
      await f.cancelRoot();
      const before = await state(f.root.jobId);
      await expect(authorize(f.envelope)).rejects.toMatchObject({
        code: "conflict",
      });
      expect(await state(f.root.jobId)).toEqual(before);
    });
    it.each(["viewer", "suspended"] as const)(
      "rechecks a %s winner when canonical authority changes during the SQL wait",
      async (change) => {
        const f = await fixture();
        const before = await state(f.root.jobId);
        const held = signal();
        const release = signal();
        const queried = signal();
        let holderPid: number | undefined;
        let waiterPid: number | undefined;
        const mutation = database.transaction(async (tx) => {
          const pid = (await tx.query(sql("SELECT pg_backend_pid() AS pid")))
            .rows[0]?.["pid"];
          if (typeof pid !== "number")
            throw new Error("Synthetic holder backend absent");
          holderPid = pid;
          await tx.query(
            change === "viewer"
              ? sql(
                  "UPDATE memberships SET role_key='viewer' WHERE membership_id=$1",
                  [f.membershipId],
                )
              : sql(
                  "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
                  [f.membershipId],
                ),
          );
          held.resolve();
          await release.promise;
        });
        const mutationOutcome = mutation.then(
          () => ({ ok: true }),
          (error: unknown) => ({ error }),
        );
        await Promise.race([
          held.promise,
          mutationOutcome.then(() => {
            throw new Error(
              "Synthetic authority holder did not establish its lock",
            );
          }),
        ]);
        const result = database
          .transaction(async (tx) => {
            const pid = (await tx.query(sql("SELECT pg_backend_pid() AS pid")))
              .rows[0]?.["pid"];
            if (typeof pid !== "number")
              throw new Error("Synthetic waiter backend absent");
            waiterPid = pid;
            const observed: SqlExecutor = {
              query<TRow extends SqlRow>(
                statement: SqlStatement,
              ): Promise<SqlResult<TRow>> {
                if (statement.text.includes("FOR SHARE OF x,actor,m,o,r"))
                  queried.resolve();
                return tx.query<TRow>(statement);
              },
            };
            return authorizeSolutionExportInitialClaim(observed, f.envelope);
          })
          .then(
            () => ({ ok: true }),
            (error: unknown) => ({ error }),
          );
        async function blockedByHolder() {
          if (holderPid === undefined || waiterPid === undefined)
            throw new Error("Synthetic PostgreSQL backend identity absent");
          return (
            await database.query(
              sql(
                "SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked",
                [waiterPid, holderPid],
              ),
            )
          ).rows[0]?.["blocked"];
        }
        try {
          await Promise.race([
            queried.promise,
            result.then(() => {
              throw new Error("Synthetic authority query was not reached");
            }),
          ]);
          // Sending a query does not establish a lock wait. Observe the real
          // waiter/holder pair before permitting the membership change to commit.
          let blocked = await blockedByHolder();
          for (
            let remaining = 100;
            blocked !== true && remaining > 0;
            remaining -= 1
          ) {
            await delay(10);
            blocked = await blockedByHolder();
          }
          expect(blocked).toBe(true);
        } finally {
          release.resolve();
          await mutationOutcome;
          await result;
        }
        expect(await mutationOutcome).toEqual({ ok: true });
        // At READ COMMITTED, the changed membership can no longer join the
        // role row from this statement's original snapshot. Both closed denial
        // paths are valid during the wait; neither may authorize a claim.
        const outcome = await result;
        if (
          !("error" in outcome) ||
          !(outcome.error instanceof ApplicationError)
        )
          throw new Error(
            "Synthetic revoked authority did not produce an application denial.",
          );
        expect(
          change === "viewer" ? ["access_denied", "not_found"] : ["not_found"],
        ).toContain(outcome.error.code);
        // A fresh statement sees the committed canonical role and must preserve
        // the exact ordinary denial contract, independently of the race result.
        await expect(authorize(f.envelope)).rejects.toMatchObject({
          code: change === "viewer" ? "access_denied" : "not_found",
        });
        expect(await state(f.root.jobId)).toEqual(before);
      },
    );
    it("rejects genuine job expiry crossed while waiting for an exact published-object row lock", async () => {
      // The deadline is part of the real original creation claim. Never UPDATE
      // immutable job/snapshot dates or replace the production clock predicate.
      const f = await persistedExportRunFixture(database);
      const deadline = (
        await database.query(
          sql(
            `SELECT to_char((clock_timestamp() + interval '8 seconds') AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at`,
          ),
        )
      ).rows[0]?.["expires_at"];
      if (typeof deadline !== "string")
        throw new Error("Synthetic database deadline absent");
      const root = await f.createRoot(deadline);
      await f.repository.insertPreparedRun(f.prepared);
      const envelope = deriveAsyncJobQueueEnvelopeV1(root);
      const before = await state(root.jobId);
      expect(root.expiresAt).toBe(deadline);
      expect((await authorize(envelope)).envelope).toEqual(envelope);

      const held = signal();
      const beginExpiryWait = signal();
      const expiredWhileHeld = signal();
      const release = signal();
      const objectQuerySent = signal();
      let holderPid: number | undefined;
      let waiterPid: number | undefined;
      let finalClockSeen = false;
      const holder = database.transaction(async (tx) => {
        await tx.query(sql("SET LOCAL statement_timeout=20000"));
        const pid = (await tx.query(sql("SELECT pg_backend_pid() AS pid")))
          .rows[0]?.["pid"];
        if (typeof pid !== "number")
          throw new Error("Synthetic holder backend absent");
        holderPid = pid;
        await tx.query(
          sql(
            "SELECT object_id FROM stored_objects WHERE organization_id=$1 AND project_id=$2 AND object_id=$3 FOR NO KEY UPDATE",
            [
              f.record.organizationId,
              f.record.job.projectId,
              f.prepared.workflowRequest.objectId,
            ],
          ),
        );
        held.resolve();
        await beginExpiryWait.promise;
        await tx.query(
          sql(
            `SELECT pg_sleep(LEAST(10.0, GREATEST(0.0,
          EXTRACT(EPOCH FROM (expires_at-clock_timestamp())))) + 0.075)
         FROM async_jobs WHERE organization_id=$1 AND project_id=$2 AND job_id=$3`,
            [f.record.organizationId, f.record.job.projectId, root.jobId],
          ),
        );
        const expired = (
          await tx.query(
            sql(
              "SELECT expires_at <= clock_timestamp() AS expired FROM async_jobs WHERE organization_id=$1 AND project_id=$2 AND job_id=$3",
              [f.record.organizationId, f.record.job.projectId, root.jobId],
            ),
          )
        ).rows[0]?.["expired"];
        expect(expired).toBe(true);
        expiredWhileHeld.resolve();
        await release.promise;
      });
      const holderOutcome = holder.then(
        () => ({ ok: true }),
        (error: unknown) => ({ error }),
      );
      await Promise.race([
        held.promise,
        holderOutcome.then(() => {
          throw new Error("Synthetic holder did not establish its lock");
        }),
      ]);
      const waiter = database
        .transaction(async (tx) => {
          await tx.query(sql("SET LOCAL statement_timeout=20000"));
          const pid = (await tx.query(sql("SELECT pg_backend_pid() AS pid")))
            .rows[0]?.["pid"];
          if (typeof pid !== "number")
            throw new Error("Synthetic waiter backend absent");
          waiterPid = pid;
          const observed: SqlExecutor = {
            query<TRow extends SqlRow>(
              statement: SqlStatement,
            ): Promise<SqlResult<TRow>> {
              if (statement.text.includes("ORDER BY object_id FOR SHARE"))
                objectQuerySent.resolve();
              if (
                statement.text.startsWith(
                  "SELECT (j.expires_at IS NULL OR j.expires_at > clock_timestamp())",
                )
              )
                finalClockSeen = true;
              return tx.query<TRow>(statement);
            },
          };
          return authorizeSolutionExportInitialClaim(observed, envelope);
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      async function blockingStatus() {
        if (holderPid === undefined || waiterPid === undefined)
          throw new Error("Synthetic PostgreSQL backend identity absent");
        return (
          await database.query(
            sql(
              `SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked,
          expires_at > clock_timestamp() AS current
         FROM async_jobs WHERE organization_id=$3 AND project_id=$4 AND job_id=$5`,
              [
                waiterPid,
                holderPid,
                f.record.organizationId,
                f.record.job.projectId,
                root.jobId,
              ],
            ),
          )
        ).rows[0];
      }
      try {
        await Promise.race([
          objectQuerySent.promise,
          waiter.then(() => {
            throw new Error("Synthetic waiter did not reach its metadata lock");
          }),
        ]);
        // Establish an actual PostgreSQL blocker while the genuine persisted
        // deadline is still current; scheduling a query alone is not evidence.
        let blocked = await blockingStatus();
        for (
          let remaining = 100;
          blocked?.["blocked"] !== true && remaining > 0;
          remaining -= 1
        ) {
          await delay(10);
          blocked = await blockingStatus();
        }
        expect(blocked).toMatchObject({ blocked: true, current: true });
        expect(finalClockSeen).toBe(false);
        beginExpiryWait.resolve();
        await Promise.race([
          expiredWhileHeld.promise,
          holderOutcome.then(() => {
            throw new Error("Synthetic holder did not witness expiry");
          }),
        ]);
        expect(await blockingStatus()).toMatchObject({
          blocked: true,
          current: false,
        });
      } finally {
        beginExpiryWait.resolve();
        release.resolve();
        await holderOutcome;
        await waiter;
      }
      expect(await holderOutcome).toEqual({ ok: true });
      expect(await waiter).toMatchObject({ error: { code: "conflict" } });
      expect(finalClockSeen).toBe(true);
      expect(await state(root.jobId)).toEqual(before);
      expect(
        (
          await database.query(
            sql(
              "SELECT to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS expires_at FROM async_jobs WHERE job_id=$1",
              [root.jobId],
            ),
          )
        ).rows[0]?.["expires_at"],
      ).toBe(deadline);
    }, 30_000);
    it("holds creator, exact root/run/snapshot and published metadata locks until the caller transaction ends", async () => {
      const f = await fixture();
      const before = await state(f.root.jobId);
      await database.transaction(async (tx) => {
        const binding = await authorizeSolutionExportInitialClaim(
          tx,
          f.envelope,
        );
        const probes = [
          sql(
            "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 FOR NO KEY UPDATE NOWAIT",
            [f.record.organizationId, f.record.job.projectId],
          ),
          sql(
            "SELECT principal_id FROM principals WHERE principal_id=$1 FOR NO KEY UPDATE NOWAIT",
            [f.principal.principalId],
          ),
          sql(
            "SELECT membership_id FROM memberships WHERE membership_id=$1 FOR NO KEY UPDATE NOWAIT",
            [f.membershipId],
          ),
          sql(
            "SELECT organization_id FROM organizations WHERE organization_id=$1 FOR NO KEY UPDATE NOWAIT",
            [f.record.organizationId],
          ),
          sql(
            "SELECT role_key FROM organization_roles WHERE organization_id=$1 AND role_key='owner' FOR NO KEY UPDATE NOWAIT",
            [f.record.organizationId],
          ),
          sql(
            "SELECT job_id FROM async_jobs WHERE job_id=$1 FOR NO KEY UPDATE NOWAIT",
            [f.root.jobId],
          ),
          sql(
            "SELECT solution_export_run_id FROM solution_export_runs WHERE solution_export_run_id=$1 FOR NO KEY UPDATE NOWAIT",
            [f.root.jobId],
          ),
          sql(
            "SELECT job_id FROM async_job_creation_claims WHERE organization_id=$1 AND job_id=$2 FOR NO KEY UPDATE NOWAIT",
            [f.record.organizationId, f.root.jobId],
          ),
          sql(
            "SELECT job_id FROM async_job_record_snapshots WHERE organization_id=$1 AND job_id=$2 AND record_version=$3 FOR NO KEY UPDATE NOWAIT",
            [f.record.organizationId, f.root.jobId, f.root.recordVersion],
          ),
          ...[
            binding.rootSnapshot.objectId,
            f.prepared.snapshot.objectId,
            f.prepared.workflowRequest.objectId,
            f.prepared.orchestrationInput.objectId,
            f.record.workflowSubmission.request.sources.solutionRevision
              .objectId,
          ].map((objectId) =>
            sql(
              "SELECT object_id FROM stored_objects WHERE organization_id=$1 AND project_id=$2 AND object_id=$3 FOR NO KEY UPDATE NOWAIT",
              [f.record.organizationId, f.record.job.projectId, objectId],
            ),
          ),
        ];
        for (const probe of probes) {
          await expect(
            database.transaction((other) => other.query(probe)),
          ).rejects.toMatchObject({ code: "55P03" });
        }
      });
      expect(await state(f.root.jobId)).toEqual(before);
    });
  },
);
