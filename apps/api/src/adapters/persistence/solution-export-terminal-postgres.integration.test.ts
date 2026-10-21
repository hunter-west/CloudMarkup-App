import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyAsyncJobLifecycleCommandV1,
  hashCanonicalValue,
} from "@cloudmarkup/domain";
import {
  createJobAuditOutboxEntryV1,
  type JobHandlerContextV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobCheckpointV1Schema,
  type AsyncJobCheckpointV1,
  asyncJobWorkerIdSchema,
  asyncJobAttemptIdSchema,
  namespacedIdentifierSchema,
  serializeCanonicalJson,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { TEST_TARGET_SETTINGS } from "@cloudmarkup/solution-export-workflow/testing";
import { terraformValidationRequestV1Schema } from "@cloudmarkup/terraform-validation-runner";
import {
  solutionExportArtifactResponseV1Schema,
  solutionExportDownloadGrantResponseV1Schema,
} from "@cloudmarkup/api-contract";
import { createApp } from "../../app.js";
import {
  InMemoryCloudMarkupApplication,
  FixedPrincipalResolver,
} from "../../testing/in-memory-adapters.js";
import { ProductionIdentityApplication } from "../../application/production-identity-application.js";
import { DefaultSolutionExportReadApplication } from "../../application/solution-export-reads.js";
import { createProductionSolutionExportReads } from "../../production-solution-export-reads.js";
import { createDurableSolutionExportHandler } from "../../solution-export-worker.js";
import { createNativeExportDiagramFixture } from "../../solution-export-native-test-helpers.js";
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
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_export_terminal_it_${nonce}`;
const marker = `CloudMarkup synthetic export terminal ${nonce}`;
suite("durable export terminal on isolated real PostgreSQL", () => {
  let admin: PostgresDatabase | undefined;
  let database: PostgresDatabase;
  let opened: PostgresDatabase | undefined;
  let created = false;
  let historicalCompatibilityRows: {
    readonly runs: readonly SqlRow[];
    readonly files: readonly SqlRow[];
  };
  let historicalProgressId: string;
  let historicalArtifactId: string;
  async function historicalRows() {
    const runs = await database.query(
      sql(
        "SELECT row_to_json(r)::text AS body FROM solution_export_runs r WHERE solution_export_run_id=$1",
        [historicalProgressId],
      ),
    );
    const files = await database.query(
      sql(
        "SELECT row_to_json(f)::text AS body FROM solution_export_artifact_files f WHERE solution_export_artifact_id=$1 AND media_type='application/yaml' ORDER BY solution_export_file_id",
        [historicalArtifactId],
      ),
    );
    return { runs: runs.rows, files: files.rows };
  }
  function alteredRootProjection(
    field: string,
    value: string | number,
  ): SqlDatabase {
    function wrapped(executor: SqlExecutor): SqlExecutor {
      return {
        async query<TRow extends SqlRow>(statement: SqlStatement) {
          const result = await executor.query<TRow>(statement);
          return statement.text.includes("AS root_record_version")
            ? {
                ...result,
                rows: result.rows.map((row) => ({ ...row, [field]: value })),
              }
            : result;
        },
      };
    }
    return {
      ...wrapped(database),
      transaction: (work) => database.transaction((tx) => work(wrapped(tx))),
      close: database.close.bind(database),
    };
  }
  // Exercise a database collation whose path order differs from canonical UTF-16.
  function withNoncanonicalFileOrder(): SqlDatabase {
    function wrapped(executor: SqlExecutor): SqlExecutor {
      return {
        async query<TRow extends SqlRow>(statement: SqlStatement) {
          const result = await executor.query<TRow>(statement);
          if (
            !statement.text.startsWith(
              "SELECT * FROM solution_export_artifact_files",
            )
          )
            return result;
          return {
            ...result,
            rows: [...result.rows].sort((left, right) => {
              const a = String(left["repository_path"]);
              const b = String(right["repository_path"]);
              return a < b ? 1 : a > b ? -1 : 0;
            }),
          };
        },
      };
    }
    return {
      ...wrapped(database),
      transaction: (work) => database.transaction((tx) => work(wrapped(tx))),
      close: database.close.bind(database),
    };
  }
  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname) ||
      !/^cm_export_terminal_it_[a-f0-9]{32}$/u.test(schema)
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
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    await runMigrations(
      database,
      migrations.filter(({ version }) => version < "0054"),
    );
    const constraints = await database.query(
      sql(
        "SELECT conname FROM pg_constraint WHERE conrelid IN ('solution_export_runs'::regclass,'solution_export_artifact_files'::regclass) ORDER BY conname",
      ),
    );
    expect(constraints.rows.map((row) => row["conname"])).toEqual(
      expect.arrayContaining([
        "solution_export_runs_target_profile_id_check",
        "solution_export_runs_progress_stage_v2_check",
        "solution_export_artifact_files_media_type_v2_check",
      ]),
    );
    const legacy = await fixture();
    const completed = await legacy.terminal.reconcile(
      await legacy.complete(await legacy.execute()),
    );
    if (completed.job.artifact === undefined)
      throw new Error("Expected genuine retained Terraform fixture output.");
    historicalArtifactId = completed.job.artifact.artifactId;
    const progressing = await persistedExportRunFixture(database);
    await progressing.createRoot();
    await progressing.repository.insertPreparedRun(progressing.prepared);
    historicalProgressId = progressing.record.job.id;
    // Exercise predecessor SQL metadata values directly; this is not execution-stage evidence.
    await database.query(
      sql(
        "UPDATE solution_export_runs SET progress_stage='diagram-rendering',record_version=record_version+1 WHERE solution_export_run_id=$1",
        [historicalProgressId],
      ),
    );
    historicalCompatibilityRows = await historicalRows();
    expect(historicalCompatibilityRows.runs).toHaveLength(1);
    expect(historicalCompatibilityRows.files.length).toBeGreaterThan(0);
    await runMigrations(
      database,
      migrations.filter(({ version }) => version <= "0055"),
    );
    expect(await historicalRows()).toEqual(historicalCompatibilityRows);
    await runMigrations(database, migrations);
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
          !/^cm_export_terminal_it_[a-f0-9]{32}$/u.test(schema)
        )
          throw new Error("Refusing unverified synthetic schema cleanup.");
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      }
    } finally {
      await admin?.close();
    }
  }, 30_000);
  async function fixture(
    shortLease = false,
    target: "terraform" | "cloudformation" = "terraform",
  ) {
    const f = await persistedExportRunFixture(database, target);
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
    async function claimShortLease() {
      const claimed = applyAsyncJobLifecycleCommandV1(queued, {
        kind: "claim",
        at: f.at(2),
        expectedInputDigest: queued.inputDigest,
        expectedRecordVersion: queued.recordVersion,
        attemptId: asyncJobAttemptIdSchema.parse(
          `attempt_${randomUUID().replaceAll("-", "")}`,
        ),
        workerId: asyncJobWorkerIdSchema.parse("worker.integration"),
        leaseExpiresAt: new Date(Date.now() + 3000).toISOString(),
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
        throw new Error("Expected real short lease.");
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
    const running = shortLease ? await claimShortLease() : await f.startRoot();
    const settings = TEST_TARGET_SETTINGS.stageDescriptors;
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
    const diagram =
      target === "cloudformation"
        ? await createNativeExportDiagramFixture()
        : {
            catalog: exportTerminalIconRegistry.catalog,
            iconSet: exportTerminalIconSet,
          };
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
      diagram,
      clock: { now: () => new Date(f.at(4)) },
    });
    const capturedCheckpoints: AsyncJobCheckpointV1[] = [];
    const context: JobHandlerContextV1 = {
      attemptNumber: 1,
      checkpoint: undefined,
      correlationId: running.correlationId,
      jobId: running.jobId,
      ownership: running.ownership,
      heartbeat: () => Promise.resolve(),
      isCancellationRequested: () => Promise.resolve(false),
      reportProgress: () => Promise.resolve(),
      saveCheckpoint: (checkpoint) => {
        capturedCheckpoints.push(asyncJobCheckpointV1Schema.parse(checkpoint));
        return Promise.resolve();
      },
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
      const registration = {
        family: handler.family,
        handlerId: namespacedIdentifierSchema.parse(handler.handlerId),
        handlerVersion: handler.handlerVersion,
        resumePolicy: handler.resumePolicy,
      };
      let latest = running;
      // This manually staged harness captures context calls during execute().
      // Replay their actual lifecycle/audit commits at the original checkpoint
      // times before completing, as JobWorker.saveCheckpoint does in production.
      for (const checkpoint of capturedCheckpoints) {
        const recorded = applyAsyncJobLifecycleCommandV1(latest, {
          kind: "record-checkpoint",
          at: checkpoint.createdAt,
          expectedInputDigest: latest.inputDigest,
          expectedRecordVersion: latest.recordVersion,
          attemptId: asyncJobAttemptIdSchema.parse(identity.attemptId),
          workerId: asyncJobWorkerIdSchema.parse(identity.workerId),
          handler: registration,
          checkpoint,
        });
        if (recorded.transition === undefined)
          throw new Error("Expected real checkpoint transition.");
        latest = await jobs.saveWithAudit(recorded.job, latest.recordVersion, [
          createJobAuditOutboxEntryV1({
            actor: {
              kind: "worker",
              workerId: asyncJobWorkerIdSchema.parse(identity.workerId),
            },
            eventType: "checkpoint-recorded",
            occurredAt: checkpoint.createdAt,
            record: recorded.job,
            transition: recorded.transition,
          }),
        ]);
      }
      const saved = capturedCheckpoints.at(-1);
      const head = latest.checkpoints.at(-1);
      // Match JobWorker's exact already-saved checkpoint normalization. Never
      // discard an unconfirmed, changed, stale, or foreign outcome checkpoint.
      const completedOutcome =
        outcome.outcome === "failed" &&
        outcome.checkpoint !== undefined &&
        saved !== undefined &&
        head !== undefined &&
        latest.latestCheckpointId === head.checkpointId &&
        head.attemptNumber === latest.attempts.at(-1)?.attemptNumber &&
        head.inputDigest === latest.inputDigest &&
        hashCanonicalValue(head) === hashCanonicalValue(saved) &&
        hashCanonicalValue(head) === hashCanonicalValue(outcome.checkpoint)
          ? { outcome: "failed" as const, failure: outcome.failure }
          : outcome;
      const transition = applyAsyncJobLifecycleCommandV1(latest, {
        kind: "complete-attempt",
        at: f.at(6),
        expectedInputDigest: latest.inputDigest,
        expectedRecordVersion: latest.recordVersion,
        attemptId: asyncJobAttemptIdSchema.parse(identity.attemptId),
        workerId: asyncJobWorkerIdSchema.parse(identity.workerId),
        handler: registration,
        outcome: completedOutcome,
      });
      if (transition.transition === undefined)
        throw new Error("Expected real terminal transition.");
      return jobs.saveWithAudit(transition.job, latest.recordVersion, [
        createJobAuditOutboxEntryV1({
          actor: {
            kind: "worker",
            workerId: asyncJobWorkerIdSchema.parse(identity.workerId),
          },
          eventType:
            outcome.outcome === "succeeded" ? "job-succeeded" : "job-failed",
          occurredAt: f.at(6),
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
  it("preserves pre-0054 Terraform diagram progress and actual retained YAML file rows byte-for-byte", async () => {
    expect(await historicalRows()).toEqual(historicalCompatibilityRows);
    expect(
      JSON.parse(String(historicalCompatibilityRows.runs[0]?.["body"])),
    ).toMatchObject({ progress_stage: "diagram-rendering" });
    for (const row of historicalCompatibilityRows.files)
      expect(JSON.parse(String(row["body"]))).toMatchObject({
        media_type: "application/yaml",
      });
  });
  it.each(["terraform", "cloudformation"] as const)(
    "serves all six production read routes from retained %s SQL state despite noncanonical database file ordering",
    async (target) => {
      const h = await fixture(false, target);
      const outcome = await h.execute();
      expect(outcome, serializeCanonicalJson(outcome)).toMatchObject({
        outcome: "succeeded",
      });
      const published = await h.terminal.reconcile(await h.complete(outcome));
      if (target === "cloudformation") {
        expect(h.validation).not.toHaveBeenCalled();
        expect(h.build).not.toHaveBeenCalled();
        expect(
          published.job.evidence.some(
            (entry) =>
              entry.kind === "cloudformation-validation" &&
              entry.stage === "cloudformation-validation",
          ),
        ).toBe(true);
        expect(
          published.job.evidence.some(
            (entry) => entry.kind === "terraform-validation",
          ),
        ).toBe(false);
      }
      const artifactId = published.job.artifact?.artifactId;
      if (artifactId === undefined)
        throw new Error("Expected retained terminal artifact.");
      const reads = createProductionSolutionExportReads({
        database: withNoncanonicalFileOrder(),
        objectStore: h.f.objects,
        identity: new ProductionIdentityApplication(database),
      });
      const app = createApp({
        application: new InMemoryCloudMarkupApplication({}),
        solutionExportReads: reads,
        principalResolver: new FixedPrincipalResolver({
          "Bearer synthetic-terminal": h.f.principal,
        }),
      });
      const headers = {
        authorization: "Bearer synthetic-terminal",
        "content-type": "application/json",
        "idempotency-key": "synthetic-production-read",
      };
      const projectPath = `/v1/projects/${h.f.selector.projectId}`;
      const path = `${projectPath}/solution-export-artifacts/${artifactId}`;
      const countGrants = async () =>
        (
          await database.query(
            sql(
              "SELECT COUNT(*)::int AS count FROM solution_export_download_grants WHERE organization_id=$1",
              [h.f.selector.organizationId],
            ),
          )
        ).rows[0]?.["count"];
      expect((await app.request(path)).status).toBe(401);
      expect(
        (
          await app.request(
            `${projectPath}/solution-export-jobs/${h.f.selector.jobId}`,
            { headers },
          )
        ).status,
      ).toBe(200);
      const artifactResponse = await app.request(path, { headers });
      expect(artifactResponse.status).toBe(200);
      const artifact = solutionExportArtifactResponseV1Schema.parse(
        await artifactResponse.json(),
      ).data;
      const paths = artifact.files.map((file) => file.path);
      expect(paths.length).toBeGreaterThan(1);
      expect(paths).toEqual([...paths].sort());
      const file = artifact.files.find(
        (file) =>
          file.previewAvailable &&
          (target === "terraform" ||
            file.mediaType ===
              "application/vnd.amazon.cloudformation.template+json"),
      );
      if (file === undefined)
        throw new Error("Expected retained preview file.");
      expect(
        (await app.request(`${path}/files/${file.id}/preview`, { headers }))
          .status,
      ).toBe(200);
      expect((await app.request(`${path}/diff`, { headers })).status).toBe(200);
      expect(await countGrants()).toBe(0);
      const responses = await Promise.all(
        [0, 1].map(
          async () =>
            await app.request(`${path}/download-grants`, {
              method: "POST",
              headers,
              body: JSON.stringify({ contractVersion: 1 }),
            }),
        ),
      );
      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      const grants = await Promise.all(
        responses.map(
          async (response) =>
            solutionExportDownloadGrantResponseV1Schema.parse(
              await response.json(),
            ).data,
        ),
      );
      expect(grants[0]).toEqual(grants[1]);
      expect(await countGrants()).toBe(1);
      const grant = grants[0];
      if (grant === undefined)
        throw new Error("Expected current download grant.");
      const download = await app.request(grant.url, { headers });
      expect(download.status).toBe(200);
      expect(download.headers.get("cache-control")).toBe("private, no-store");
      expect(download.headers.get("content-type")).toBe("application/zip");
      expect(download.headers.get("x-cloudmarkup-content-sha256")).toBe(
        artifact.digest,
      );
      expect((await download.arrayBuffer()).byteLength).toBe(
        artifact.sizeBytes,
      );
      // Canonical viewers may read artifacts; this does not grant export mutation.
      await database.query(
        sql("UPDATE memberships SET role_key='viewer' WHERE membership_id=$1", [
          h.f.membershipId,
        ]),
      );
      expect((await app.request(path, { headers })).status).toBe(200);
      expect(
        (
          await app.request(
            `${projectPath}/solution-export-jobs/${h.f.selector.jobId}/cancel`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ contractVersion: 1 }),
            },
          )
        ).status,
      ).toBe(503);
      expect(
        (
          await app.request(`${projectPath}/solution-export-jobs`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              contractVersion: 1,
              environment: published.job.target.environment,
              exportName: "Synthetic read only",
              solutionRevisionId:
                published.job.solutionRevision.solutionRevisionId,
              targetProfileId: published.targetProfileId,
            }),
          })
        ).status,
      ).toBe(503);
      const foreign = await persistedExportRunFixture(database);
      expect(
        (
          await app.request(
            path.replace(h.f.selector.projectId, foreign.selector.projectId),
            { headers },
          )
        ).status,
      ).toBe(404);
      await expect(
        reads.download(
          foreign.principal,
          h.f.selector.projectId,
          artifactId,
          grant.id,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
          [h.f.membershipId],
        ),
      );
      expect((await app.request(path, { headers })).status).toBe(404);
      expect((await app.request(grant.url, { headers })).status).toBe(404);
      expect(await countGrants()).toBe(1);
    },
    60000,
  );
  it("does not create a durable grant when the host transport is smaller than retained bytes", async () => {
    const h = await fixture();
    const published = await h.terminal.reconcile(
      await h.complete(await h.execute()),
    );
    const artifactId = published.job.artifact?.artifactId;
    if (artifactId === undefined)
      throw new Error("Expected retained terminal artifact.");
    const artifact = await h.reader.getArtifact({
      ...h.f.selector,
      artifactId,
    });
    if (artifact === null) throw new Error("Expected exact retained bytes.");
    const authority = new SolutionExportRequestAuthority(
      database,
      h.f.principal,
      h.f.selector,
      "artifacts.read",
    );
    const reads = new DefaultSolutionExportReadApplication({
      maximumDownloadBytes: artifact.zipBytes.length - 1,
      access: {
        authorizeProject: async () => {
          await authority.scope();
          return h.f.selector;
        },
      },
      repository: {
        getArtifact: (input) => h.reader.getArtifact(input),
        getJob: async (input) =>
          (await h.f.repository.getJob(input))?.record ?? null,
        getDownloadGrant: (input) => h.reader.getDownloadGrant(input),
        reserveDownloadGrant: (input) => h.reader.reserveDownloadGrant(input),
      },
    });
    expect(
      (
        await reads.getArtifact(
          h.f.principal,
          h.f.selector.projectId,
          artifactId,
        )
      ).downloadAvailability.state,
    ).toBe("available");
    await expect(
      reads.createDownloadGrant(
        h.f.principal,
        h.f.selector.projectId,
        artifactId,
        "synthetic-over-limit",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(
      (
        await database.query(
          sql(
            "SELECT COUNT(*)::int AS count FROM solution_export_download_grants WHERE organization_id=$1",
            [h.f.selector.organizationId],
          ),
        )
      ).rows[0]?.["count"],
    ).toBe(0);
  }, 60000);
  it("denies current membership revoked during retained object I/O", async () => {
    const h = await fixture();
    const published = await h.terminal.reconcile(
      await h.complete(await h.execute()),
    );
    const artifactId = published.job.artifact?.artifactId;
    if (artifactId === undefined)
      throw new Error("Expected retained terminal artifact.");
    const reads = createProductionSolutionExportReads({
      database,
      objectStore: h.f.objects,
      identity: new ProductionIdentityApplication(database),
    });
    const open = h.f.objects.open.bind(h.f.objects);
    const spy = vi
      .spyOn(h.f.objects, "open")
      .mockImplementationOnce(async (...args) => {
        const bytes = await open(...args);
        await database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
            [h.f.membershipId],
          ),
        );
        return bytes;
      });
    try {
      await expect(
        reads.getArtifact(h.f.principal, h.f.selector.projectId, artifactId),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      // The existing immutable I/O reader deliberately sanitizes its inner
      // authority error; it must still withhold all retained content.
      expect(
        (
          await database.query(
            sql(
              "SELECT lifecycle_status FROM memberships WHERE membership_id=$1",
              [h.f.membershipId],
            ),
          )
        ).rows[0]?.["lifecycle_status"],
      ).toBe("suspended");
    } finally {
      spy.mockRestore();
    }
  }, 60000);
  it.each(["preview", "diff", "grant", "download"] as const)(
    "withholds %s when final authority I/O crosses the verified deadline",
    async (operation) => {
      const h = await fixture();
      const published = await h.terminal.reconcile(
        await h.complete(await h.execute()),
      );
      const artifactId = published.job.artifact?.artifactId;
      if (artifactId === undefined)
        throw new Error("Expected retained terminal artifact.");
      let now = new Date();
      const clock = () => now;
      const reads = createProductionSolutionExportReads({
        database,
        objectStore: h.f.objects,
        identity: new ProductionIdentityApplication(database),
        clock,
      });
      const artifact = await reads.getArtifact(
        h.f.principal,
        h.f.selector.projectId,
        artifactId,
      );
      if (artifact.downloadAvailability.state !== "available")
        throw new Error("Expected immutable retained artifact deadline.");
      // Use actual immutable metadata. Only the request clock advances after
      // final SQL authority; no persisted artifact or constraint is changed.
      const expires =
        operation === "grant" || operation === "download"
          ? new Date(now.getTime() + 301000)
          : new Date(artifact.downloadAvailability.expiresAt);
      const file = artifact.files.find((file) => file.previewAvailable);
      if (file === undefined)
        throw new Error("Expected retained preview file.");
      const grant =
        operation === "download"
          ? await reads.createDownloadGrant(
              h.f.principal,
              h.f.selector.projectId,
              artifactId,
              "synthetic-expiry-download",
            )
          : undefined;
      let calls = 0;
      const scope = vi
        .spyOn(SolutionExportRequestAuthority.prototype, "scope")
        .mockImplementation(async function (
          this: SolutionExportRequestAuthority,
        ) {
          // Execute scope's genuine transaction/authorization implementation.
          const result = await this.withScope((_tx, authorized) =>
            Promise.resolve(authorized),
          );
          if (this.clock === clock && ++calls === 3) now = expires;
          return result;
        });
      try {
        const pending =
          operation === "preview"
            ? reads.getFilePreview(
                h.f.principal,
                h.f.selector.projectId,
                artifactId,
                file.id,
              )
            : operation === "diff"
              ? reads.getArtifactDiff(
                  h.f.principal,
                  h.f.selector.projectId,
                  artifactId,
                )
              : operation === "grant"
                ? reads.createDownloadGrant(
                    h.f.principal,
                    h.f.selector.projectId,
                    artifactId,
                    "synthetic-expiry-create",
                  )
                : reads.download(
                    h.f.principal,
                    h.f.selector.projectId,
                    artifactId,
                    grant?.id ?? "downloadgrant_missing",
                  );
        await expect(pending).rejects.toMatchObject({ code: "not_found" });
        expect(calls).toBe(3);
      } finally {
        scope.mockRestore();
      }
    },
    60000,
  );
  it.each(["grant", "download"] as const)(
    "withholds %s revoked during the final authority wait",
    async (operation) => {
      const h = await fixture();
      const published = await h.terminal.reconcile(
        await h.complete(await h.execute()),
      );
      const artifactId = published.job.artifact?.artifactId;
      if (artifactId === undefined)
        throw new Error("Expected retained terminal artifact.");
      const clock = () => new Date();
      const reads = createProductionSolutionExportReads({
        database,
        objectStore: h.f.objects,
        identity: new ProductionIdentityApplication(database),
        clock,
      });
      const grant =
        operation === "download"
          ? await reads.createDownloadGrant(
              h.f.principal,
              h.f.selector.projectId,
              artifactId,
              "synthetic-final-revocation",
            )
          : undefined;
      let calls = 0;
      const scope = vi
        .spyOn(SolutionExportRequestAuthority.prototype, "scope")
        .mockImplementation(async function (
          this: SolutionExportRequestAuthority,
        ) {
          // Execute scope's genuine transaction/authorization implementation.
          const result = await this.withScope((_tx, authorized) =>
            Promise.resolve(authorized),
          );
          if (this.clock === clock && ++calls === 3) {
            const revoked = await database.query(
              sql(
                "UPDATE solution_export_download_grants SET revoked_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND solution_export_artifact_id=$4 AND revoked_at IS NULL RETURNING solution_export_download_grant_id",
                [
                  h.f.selector.organizationId,
                  h.f.selector.projectId,
                  h.f.principal.principalId,
                  artifactId,
                ],
              ),
            );
            expect(revoked.rowCount).toBe(1);
          }
          return result;
        });
      try {
        const pending =
          operation === "grant"
            ? reads.createDownloadGrant(
                h.f.principal,
                h.f.selector.projectId,
                artifactId,
                "synthetic-final-revocation",
              )
            : reads.download(
                h.f.principal,
                h.f.selector.projectId,
                artifactId,
                grant?.id ?? "downloadgrant_missing",
              );
        await expect(pending).rejects.toMatchObject({ code: "not_found" });
        expect(calls).toBe(3);
        expect(
          (
            await database.query(
              sql(
                "SELECT COUNT(*)::int AS count FROM solution_export_download_grants WHERE organization_id=$1",
                [h.f.selector.organizationId],
              ),
            )
          ).rows[0]?.["count"],
        ).toBe(1);
      } finally {
        scope.mockRestore();
      }
    },
    60000,
  );
  it("finds only the exact retained target baseline after real terminal publication", async () => {
    const h = await fixture();
    const target = {
      organizationId: h.f.selector.organizationId,
      projectId: h.f.selector.projectId,
      environment: h.f.record.job.target.environment,
      targetProfileId: h.f.record.targetProfileId,
      targetSettingsDigest: sha256DigestSchema.parse(
        h.f.record.job.target.settingsDigest,
      ),
    };
    expect(await h.reader.findLatestArtifact(target)).toBeNull();
    const outcome = await h.execute();
    const root = await h.complete(outcome);
    expect(await h.reader.findLatestArtifact(target)).toBeNull();
    const published = await h.terminal.reconcile(root);
    const foreign = await fixture();
    await foreign.terminal.reconcile(
      await foreign.complete(await foreign.execute()),
    );
    const artifact = await h.reader.findLatestArtifact(target);
    expect(artifact?.artifact.id).toBe(published.job.artifact?.artifactId);
    expect(artifact?.zipBytes.length).toBe(artifact?.artifact.sizeBytes);
    expect(await h.reader.findLatestArtifact(target)).toEqual(artifact);
    const read = h.reader.getArtifact.bind(h.reader);
    const unavailable = vi
      .spyOn(h.reader, "getArtifact")
      .mockResolvedValue(null);
    await expect(h.reader.findLatestArtifact(target)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    unavailable.mockRestore();
    const mutable = structuredClone(target);
    const mutate = vi
      .spyOn(h.reader, "getArtifact")
      .mockImplementation(async (input) => {
        const result = await read(input);
        mutable.environment.environmentType = "production";
        mutable.organizationId = foreign.f.selector.organizationId;
        return result;
      });
    expect(await h.reader.findLatestArtifact(mutable)).toEqual(artifact);
    mutate.mockRestore();
    for (const changed of [
      { environment: { environmentType: "production" as const } },
      {
        environment: {
          ...target.environment,
          environmentId: "env_absent",
        },
      },
      { targetProfileId: "cloudmarkup.export.cloudformation-nodejs24-v1" },
      {
        targetSettingsDigest: sha256DigestSchema.parse(
          `sha256:${"f".repeat(64)}`,
        ),
      },
    ]) {
      expect(
        await h.reader.findLatestArtifact({ ...target, ...changed }),
      ).toBeNull();
    }
    await expect(
      h.reader.findLatestArtifact({
        ...target,
        organizationId: foreign.f.selector.organizationId,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      h.reader.findLatestArtifact({
        ...target,
        projectId: foreign.f.selector.projectId,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      h.reader.findLatestArtifact({ ...target, targetProfileId: "unreviewed" }),
    ).rejects.toMatchObject({ code: "not_found" });
    const expired = new PostgresSolutionExportDownloadRepository(
      database,
      h.f.objects,
      {
        ...h.f.principal,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      h.reader.authority.ownership,
    );
    await expect(expired.findLatestArtifact(target)).rejects.toMatchObject({
      code: "authentication_required",
    });
    expect(h.compiler).toHaveBeenCalledTimes(1);
    expect(h.validation).toHaveBeenCalledTimes(1);
  }, 60000);
  it("reauthorizes latest baseline after artifact I/O and never returns a revoked member's bytes", async () => {
    const h = await fixture();
    await h.terminal.reconcile(await h.complete(await h.execute()));
    const read = h.reader.getArtifact.bind(h.reader);
    const spy = vi
      .spyOn(h.reader, "getArtifact")
      .mockImplementation(async (input) => {
        const artifact = await read(input);
        await database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
            [h.f.selector.organizationId, h.f.principal.principalId],
          ),
        );
        return artifact;
      });
    await expect(
      h.reader.findLatestArtifact({
        organizationId: h.f.selector.organizationId,
        projectId: h.f.selector.projectId,
        environment: h.f.record.job.target.environment,
        targetProfileId: h.f.record.targetProfileId,
        targetSettingsDigest: sha256DigestSchema.parse(
          h.f.record.job.target.settingsDigest,
        ),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  }, 60000);
  it("retains real workflow bytes before root completion, then publishes exactly once and serves a principal-bound grant", async () => {
    const h = await fixture();
    const outcome = await h.execute();
    expect(outcome).toMatchObject({ outcome: "succeeded" });
    if (
      outcome.outcome !== "succeeded" ||
      outcome.output.family !== "solution-export-orchestration"
    )
      throw new Error("Expected verified synthetic output.");
    expect(h.compiler).toHaveBeenCalledTimes(1);
    expect(h.validation).toHaveBeenCalledTimes(1);
    expect(h.build).not.toHaveBeenCalled();
    const selector = {
      ...h.f.selector,
      artifactId: outcome.output.verifiedPackage.artifactId,
    };
    expect(await h.reader.getArtifact(selector)).toBeNull();
    await expect(h.terminal.reconcile(h.running)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    const root = await h.complete(outcome);
    expect(await h.reader.getArtifact(selector)).toBeNull();
    const first = await h.terminal.reconcile(root);
    expect(first.job.progress.completedStages).toBe(8);
    expect(await h.terminal.reconcile(root)).toEqual(first);
    const artifact = await h.reader.getArtifact(selector);
    expect(artifact).not.toBeNull();
    if (artifact === null) throw new Error("Expected retained bytes.");
    expect(
      artifact.artifact.files.some(
        (file) => file.mediaType === "application/yaml",
      ),
    ).toBe(true);
    expect(artifact.zipBytes.length).toBe(artifact.artifact.sizeBytes);
    for (const [field, value] of [
      ["root_record_version", root.recordVersion + 1],
      ["root_attempt_id", "attempt.foreign"],
      ["root_attempt_number", 99],
      ["root_worker_id", "worker.foreign"],
    ] as const) {
      const reader = new PostgresSolutionExportDownloadRepository(
        alteredRootProjection(field, value),
        h.f.objects,
        h.f.principal,
        {
          organizationId: selector.organizationId,
          projectId: selector.projectId,
        },
      );
      await expect(reader.getArtifact(selector)).rejects.toMatchObject({
        code: "service_unavailable",
      });
    }
    for (const storage of [h.reader.storage, h.terminal.storage]) {
      const metadata = storage.metadata.bind(storage);
      const spy = vi
        .spyOn(storage, "metadata")
        .mockImplementation(async (id) => {
          const value = await metadata(id);
          return value?.reference.purpose === "artifact-manifest"
            ? {
                ...value,
                reference: {
                  ...value.reference,
                  sizeBytes: 4 * 1024 * 1024 + 1,
                },
              }
            : value;
        });
      const open = vi.spyOn(h.f.objects, "open");
      await expect(
        storage === h.reader.storage
          ? h.reader.getArtifact(selector)
          : h.terminal.reconcile(root),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(
        open.mock.calls.some(
          ([, reference]) => reference.purpose === "artifact-manifest",
        ),
      ).toBe(false);
      open.mockRestore();
      spy.mockRestore();
    }
    await expect(
      h.reader.getArtifact({ ...selector, organizationId: "org.other" }),
    ).rejects.toMatchObject({ code: "not_found" });
    const expiredReader = new PostgresSolutionExportDownloadRepository(
      database,
      h.f.objects,
      {
        ...h.f.principal,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      {
        organizationId: selector.organizationId,
        projectId: selector.projectId,
      },
    );
    await expect(expiredReader.getArtifact(selector)).rejects.toMatchObject({
      code: "authentication_required",
    });
    const grantId = `downloadgrant_${randomUUID().replaceAll("-", "")}`;
    const requested = {
      organizationId: selector.organizationId,
      projectId: selector.projectId,
      artifactId: selector.artifactId,
      principalId: h.f.principal.principalId,
      grant: {
        contractVersion: 1 as const,
        id: grantId,
        artifactId: selector.artifactId,
        digest: artifact.artifact.digest,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        fileName: artifact.artifact.archiveFileName,
        mediaType: "application/zip" as const,
        sizeBytes: artifact.zipBytes.length,
        url: `/v1/projects/${selector.projectId}/solution-export-artifacts/${selector.artifactId}/download-grants/${grantId}/content`,
      },
    };
    const input = {
      artifact,
      grant: requested,
      idempotencyKeyDigest:
        `sha256:${hashCanonicalValue(grantId).slice(7)}` as const,
    };
    const granted = await h.reader.reserveDownloadGrant(input);
    const excessive = {
      ...requested,
      grant: {
        ...requested.grant,
        id: `downloadgrant_${randomUUID().replaceAll("-", "")}`,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    };
    excessive.grant.url = `/v1/projects/${selector.projectId}/solution-export-artifacts/${selector.artifactId}/download-grants/${excessive.grant.id}/content`;
    await expect(
      h.reader.reserveDownloadGrant({
        ...input,
        grant: excessive,
        idempotencyKeyDigest: `sha256:${hashCanonicalValue(excessive.grant.id).slice(7)}`,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      await h.reader.reserveDownloadGrant({
        ...input,
        grant: {
          ...requested,
          grant: {
            ...requested.grant,
            expiresAt: new Date(Date.now() + 120000).toISOString(),
          },
        },
      }),
    ).toEqual(granted);
    const grantSelector = {
      ...selector,
      grantId,
      principalId: h.f.principal.principalId,
    };
    expect(await h.reader.getDownloadGrant(grantSelector)).toEqual(granted);
    await expect(
      h.reader.getDownloadGrant({
        ...grantSelector,
        principalId: "principal.other",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await database.query(
      sql("UPDATE memberships SET role_key='viewer' WHERE membership_id=$1", [
        h.f.membershipId,
      ]),
    );
    expect(await h.reader.getArtifact(selector)).not.toBeNull();
    await database.query(
      sql(
        "UPDATE solution_export_download_grants SET revoked_at=clock_timestamp() WHERE solution_export_download_grant_id=$1",
        [grantId],
      ),
    );
    expect(await h.reader.getDownloadGrant(grantSelector)).toBeNull();
    const freshId = `downloadgrant_${randomUUID().replaceAll("-", "")}`;
    const fresh = await h.reader.reserveDownloadGrant({
      ...input,
      idempotencyKeyDigest: `sha256:${hashCanonicalValue(freshId).slice(7)}`,
      grant: {
        ...requested,
        grant: {
          ...requested.grant,
          id: freshId,
          url: `/v1/projects/${selector.projectId}/solution-export-artifacts/${selector.artifactId}/download-grants/${freshId}/content`,
        },
      },
    });
    expect(
      await h.reader.getDownloadGrant({ ...grantSelector, grantId: freshId }),
    ).toEqual(fresh);
    // A retained package never substitutes for a currently published root snapshot.
    await database.query(
      sql(
        `UPDATE stored_objects SET lifecycle_state='delete-pending',delete_requested_at=clock_timestamp() WHERE object_id=(
      SELECT snapshot_object_id FROM async_job_record_snapshots WHERE organization_id=$1 AND job_id=$2 AND record_version=$3)`,
        [h.identity.organizationId, root.jobId, root.recordVersion],
      ),
    );
    expect(await h.reader.getArtifact(selector)).toBeNull();
    expect(
      await h.reader.getDownloadGrant({ ...grantSelector, grantId: freshId }),
    ).toBeNull();
    await database.query(
      sql(
        "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
        [h.f.membershipId],
      ),
    );
    await expect(h.reader.getArtifact(selector)).rejects.toMatchObject({
      code: "not_found",
    });
  }, 60000);
  it("blocks provider continuation and receipt publication after current membership is revoked", async () => {
    const h = await fixture();
    h.compiler.mockImplementationOnce(async () => {
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
          [h.f.membershipId],
        ),
      );
      return {
        exitCode: 0,
        stderr: "",
        stdout: serializeCanonicalJson(h.f.source.compilation),
        termination: "completed" as const,
      };
    });
    await expect(h.execute()).rejects.toBeDefined();
    expect(h.validation).not.toHaveBeenCalled();
    expect(
      (
        await database.query(
          sql(
            "SELECT COUNT(*)::int AS count FROM solution_export_artifacts WHERE solution_export_run_id=$1",
            [h.running.jobId],
          ),
        )
      ).rows[0]?.["count"],
    ).toBe(0);
  }, 60000);
  it("retries interrupted terminal object I/O without recompilation or a partial artifact", async () => {
    const h = await fixture();
    const outcome = await h.execute();
    expect(outcome.outcome).toBe("succeeded");
    const root = await h.complete(outcome);
    const publish = vi.spyOn(h.f.objects, "publish");
    publish.mockRejectedValueOnce(
      new Error("Synthetic recoverable object interruption."),
    );
    await expect(h.terminal.reconcile(root)).rejects.toThrow(
      "Synthetic recoverable",
    );
    expect(
      (
        await database.query(
          sql(
            "SELECT COUNT(*)::int AS count FROM solution_export_artifacts WHERE solution_export_run_id=$1",
            [root.jobId],
          ),
        )
      ).rows[0]?.["count"],
    ).toBe(0);
    publish.mockRestore();
    expect((await h.terminal.reconcile(root)).job.state).toBe("succeeded");
    expect(h.compiler).toHaveBeenCalledTimes(1);
    const badRoot = { ...root, recordVersion: root.recordVersion + 1 };
    await expect(h.terminal.reconcile(badRoot)).rejects.toMatchObject({
      code: "service_unavailable",
    });
  }, 60000);
  it.each(["cancellation", "lease-expiry"] as const)(
    "stops late %s at an executor boundary without continuing or publishing an artifact",
    async (change) => {
      const h = await fixture(change === "lease-expiry");
      h.compiler.mockImplementationOnce(async () => {
        if (change === "cancellation") await h.f.cancelRoot();
        else
          await database.query(
            sql(
              "SELECT pg_sleep(LEAST(4,GREATEST(0,EXTRACT(EPOCH FROM (lease_expires_at-clock_timestamp()))))+0.02) FROM async_job_attempts WHERE organization_id=$1 AND job_id=$2 AND attempt_id=$3",
              [
                h.identity.organizationId,
                h.identity.jobId,
                h.identity.attemptId,
              ],
            ),
          );
        return {
          exitCode: 0,
          stderr: "",
          stdout: serializeCanonicalJson(h.f.source.compilation),
          termination: "completed" as const,
        };
      });
      if (change === "cancellation") {
        await expect(h.execute()).resolves.toEqual({ outcome: "canceled" });
      } else {
        await expect(h.execute()).rejects.toBeDefined();
      }
      expect(h.compiler).toHaveBeenCalledTimes(1);
      expect(h.validation).not.toHaveBeenCalled();
      const receiptId = h.terminal.storage.identity("terminal-receipt", {
        jobId: h.identity.jobId,
        attemptId: h.identity.attemptId,
        value: null,
      });
      expect(
        (
          await database.query(
            sql(
              "SELECT COUNT(*)::int AS count FROM stored_objects WHERE object_id=$1",
              [receiptId],
            ),
          )
        ).rows[0]?.["count"],
      ).toBe(change === "cancellation" ? 1 : 0);
      expect(
        (
          await database.query(
            sql(
              "SELECT COUNT(*)::int AS count FROM solution_export_artifacts WHERE solution_export_run_id=$1",
              [h.identity.jobId],
            ),
          )
        ).rows[0]?.["count"],
      ).toBe(0);
    },
    60000,
  );
});
