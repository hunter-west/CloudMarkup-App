import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  SendMessageCommand,
  SQSClient,
  type SendMessageCommandOutput,
} from "@aws-sdk/client-sqs";
import { deriveAsyncJobQueueEnvelopeV1 } from "@cloudmarkup/domain";
import {
  DefaultJobFailureClassifier,
  InMemoryFifoJobQueue,
  InMemoryJobAuditPort,
  InMemoryJobHandlerRegistry,
  InMemoryJobOrchestrationDecisionPort,
  JobService,
  JobWorker,
  MutableJobClock,
  SequentialJobIdGenerator,
  type JobHandlerV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobQueueEnvelopeV1Schema,
  asyncJobTrustedContextV1Schema,
  type AsyncJobQueueEnvelopeV1,
} from "@cloudmarkup/schemas";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDurableSolutionExportHandler } from "../../solution-export-worker.js";
import { SqsJobPublisherV1 } from "../sqs-job-publisher.js";
import { PostgresAsyncJobRepository } from "./async-job-repository.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { persistedExportRunFixture } from "./solution-export-run-test-helpers.js";
import { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import { SolutionExportProducerObjects } from "./solution-export-producer-objects.js";
import { SolutionExportPublicationReadiness } from "./solution-export-producer.js";
import { PostgresSolutionExportTerminalRecovery } from "./solution-export-terminal-recovery.js";
import {
  exportTerminalIconRegistry,
  exportTerminalIconSet,
} from "./solution-export-terminal-test-helpers.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_sqs_publish_it_${nonce}`;
const marker = `CloudMarkup synthetic SQS publication ${nonce}`;
const target = {
  queueArn: "arn:aws:sqs:us-east-1:123456789012:synthetic-export.fifo",
  queueUrl:
    "https://sqs.us-east-1.amazonaws.com/123456789012/synthetic-export.fifo",
  region: "us-east-1",
};

suite("SQS publication with genuine durable export worker fences", () => {
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
      !/^cm_sqs_publish_it_[a-f0-9]{32}$/u.test(schema)
    ) {
      throw new Error("Explicit synthetic loopback database is required.");
    }
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
          !/^cm_sqs_publish_it_[a-f0-9]{32}$/u.test(schema)
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
    const newRepository = () =>
      new PostgresAsyncJobRepository({
        database,
        ownership: queued.ownership,
        objects: objects.jobPort(
          f.binding.orchestrationInputObjectId,
          queued.inputDigest,
        ),
      });
    const repository = newRepository();
    const publicationReadiness = new SolutionExportPublicationReadiness(
      authority,
      objects,
      f.repository,
    );
    const clock = new MutableJobClock(f.at(2));
    const ids = new SequentialJobIdGenerator(randomUUID().replaceAll("-", ""));
    const audit = new InMemoryJobAuditPort();
    const client = new SQSClient({ region: target.region, maxAttempts: 1 });
    const physical: AsyncJobQueueEnvelopeV1[] = [];
    let loseAcknowledgement = false;
    const send = vi.fn<
      (command: SendMessageCommand) => Promise<SendMessageCommandOutput>
    >((command) => {
      if (
        !(command instanceof SendMessageCommand) ||
        typeof command.input.MessageBody !== "string"
      )
        throw new Error("Expected synthetic SQS send.");
      const body = command.input.MessageBody;
      physical.push(asyncJobQueueEnvelopeV1Schema.parse(JSON.parse(body)));
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        return Promise.reject(
          new Error("Synthetic accepted send acknowledgement lost."),
        );
      }
      return Promise.resolve({
        $metadata: { httpStatusCode: 200 },
        MessageId: `synthetic-${String(physical.length)}`,
        MD5OfMessageBody: createHash("md5").update(body).digest("hex"),
      });
    });
    // The real SDK instance remains the adapter input; no AWS request is sent.
    Object.defineProperty(client, "send", { value: send });
    const publisher = new SqsJobPublisherV1({
      client,
      target,
      ownership: queued.ownership,
      now: () => clock.now(),
    });
    const entitlement = {
      evaluate: vi.fn(() =>
        Promise.reject(new Error("Publication cannot readmit a root.")),
      ),
    };
    const reservation = {
      reserve: vi.fn(() =>
        Promise.reject(new Error("Publication cannot reserve credits.")),
      ),
    };
    const newService = () =>
      new JobService({
        audit,
        clock,
        ids,
        publisher,
        repository: newRepository(),
        publicationReadiness,
        entitlement,
        reservation,
      });
    const trusted = asyncJobTrustedContextV1Schema.parse({
      actor: { kind: "system", reason: "scheduler" },
      correlationId: f.principal.correlationId,
      ownership: queued.ownership,
    });

    // This remains a complete test JobQueue. Independent transport deliveries are
    // injected at receive; its publish implementation is not relabelled at-least-once.
    const queue = new InMemoryFifoJobQueue(ids);
    const receive = vi.spyOn(queue, "receive");
    const acknowledge = vi.spyOn(queue, "acknowledge");
    const inject = (value: AsyncJobQueueEnvelopeV1) => {
      receive.mockResolvedValueOnce({
        deliveryId: ids.nextId("queue-delivery"),
        envelope: structuredClone(value),
        leaseExpiresAt: new Date(clock.now().getTime() + 300_000).toISOString(),
      });
    };
    const settings =
      f.record.workflowSubmission.request.targetSettings.stageDescriptors;
    if (!("terraformValidation" in settings))
      throw new Error("Expected Terraform fixture.");
    const compiler = vi.fn(() =>
      Promise.resolve({
        exitCode: 1,
        stderr: "Synthetic compiler rejection",
        stdout: "",
        termination: "completed" as const,
      }),
    );
    const validation = vi.fn(() =>
      Promise.reject(new Error("Failed compiler cannot validate.")),
    );
    const build = vi.fn(() =>
      Promise.reject(
        new Error("Infrastructure-only cannot build applications."),
      ),
    );
    const handler = createDurableSolutionExportHandler({
      database,
      objectStore: f.objects,
      clock,
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
    });
    const observed: JobHandlerV1 = {
      ...handler,
      async execute(record, context) {
        const outcome = await handler.execute(record, {
          ...context,
          heartbeat: () => {
            clock.advance(1000);
            return context.heartbeat();
          },
        });
        clock.advance(1000);
        return outcome;
      },
    };
    const newWorker = () =>
      new JobWorker({
        audit,
        clock,
        ids,
        queue,
        repository: newRepository(),
        publicationReadiness,
        failureClassifier: new DefaultJobFailureClassifier(),
        handlers: new InMemoryJobHandlerRegistry([observed]),
        orchestration: new InMemoryJobOrchestrationDecisionPort(),
      });
    return {
      f,
      queued,
      clock,
      repository,
      newRepository,
      newService,
      newWorker,
      trusted,
      physical,
      inject,
      send,
      compiler,
      validation,
      build,
      entitlement,
      reservation,
      acknowledge,
      loseNextAcknowledgement: () => {
        loseAcknowledgement = true;
      },
    };
  }

  async function expectSingleLogicalFailure(
    h: Awaited<ReturnType<typeof fixture>>,
  ) {
    const root = await h.repository.get(h.queued.jobId);
    expect(root?.state).toBe("failed");
    expect(root?.failure?.code).toBe(
      "cloudmarkup.export.compiler-command-failed",
    );
    expect(root?.attempts).toHaveLength(1);
    expect(root?.checkpoints).toHaveLength(1);
    expect(h.compiler).toHaveBeenCalledTimes(1);
    expect(h.validation).not.toHaveBeenCalled();
    expect(h.build).not.toHaveBeenCalled();
    expect(h.entitlement.evaluate).not.toHaveBeenCalled();
    expect(h.reservation.reserve).not.toHaveBeenCalled();
    const events = await database.query(
      sql(
        "SELECT event_kind,count(*)::int AS count FROM async_job_events WHERE organization_id=$1 AND job_id=$2 AND event_kind IN ('checkpoint-recorded','attempt-claimed') GROUP BY event_kind ORDER BY event_kind",
        [h.f.selector.organizationId, h.queued.jobId],
      ),
    );
    expect(events.rows).toEqual([
      { event_kind: "attempt-claimed", count: 1 },
      { event_kind: "checkpoint-recorded", count: 1 },
    ]);
    const recovery = new PostgresSolutionExportTerminalRecovery(
      database,
      h.f.objects,
    );
    const recoveryContext = asyncJobTrustedContextV1Schema.parse({
      ...h.trusted,
      actor: { kind: "system", reason: "orphan-reconciler" },
    });
    const recovered = await recovery.recover(recoveryContext, h.queued.jobId);
    expect(recovered.job.state).toBe("failed");
    expect(recovered.job.artifact).toBeUndefined();
    expect(
      await new PostgresSolutionExportTerminalRecovery(
        database,
        h.f.objects,
      ).recover(recoveryContext, h.queued.jobId),
    ).toEqual(recovered);
    expect(h.compiler).toHaveBeenCalledTimes(1);
  }

  it("reconciles an accepted send with lost ACK in a fresh service after five minutes, but executes and accounts only once", async () => {
    const h = await fixture();
    h.loseNextAcknowledgement();
    await expect(
      h.newService().publishQueuedJob(h.trusted, h.queued.jobId),
    ).rejects.toMatchObject({ code: "job.publication-uncertain" });
    expect(await h.repository.get(h.queued.jobId)).toEqual(h.queued);
    h.clock.advance(300_001);
    expect(await h.newService().reconcileQueuedPublications(h.trusted)).toBe(1);
    expect(h.physical).toEqual([
      deriveAsyncJobQueueEnvelopeV1(h.queued),
      deriveAsyncJobQueueEnvelopeV1(h.queued),
    ]);
    for (const delivery of h.physical) h.inject(delivery);
    expect((await h.newWorker().runNext("worker.first", 300_000))?.state).toBe(
      "failed",
    );
    const terminal = await h.repository.get(h.queued.jobId);
    expect(
      await h.newWorker().runNext("worker.late-duplicate", 300_000),
    ).toEqual(terminal);
    await expectSingleLogicalFailure(h);
    expect(h.acknowledge).toHaveBeenCalledTimes(2);
    expect(await h.newService().reconcileQueuedPublications(h.trusted)).toBe(0);
    expect(h.send).toHaveBeenCalledTimes(2);
  }, 60_000);

  it("allows at most one real worker attempt under simultaneous duplicate delivery", async () => {
    const h = await fixture();
    expect(
      await h.newService().publishQueuedJob(h.trusted, h.queued.jobId),
    ).toBe(true);
    const value = h.physical[0];
    if (value === undefined) throw new Error("Expected accepted envelope.");
    h.inject(value);
    h.inject(value);
    const results = await Promise.allSettled([
      h.newWorker().runNext("worker.first", 300_000),
      h.newWorker().runNext("worker.racing", 300_000),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({ code: "job.write-conflict" });
    await expectSingleLogicalFailure(h);
    // A losing transport delivery can be redelivered independently after its lease.
    h.inject(value);
    await h.newWorker().runNext("worker.redelivery", 300_000);
    expect(h.compiler).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("keeps cancellation authoritative for already accepted physical messages", async () => {
    const h = await fixture();
    await h.newService().publishQueuedJob(h.trusted, h.queued.jobId);
    const canceled = await h.f.cancelRoot();
    for (const value of h.physical) h.inject(value);
    expect(await h.newWorker().runNext("worker.after-cancel", 300_000)).toEqual(
      canceled,
    );
    expect(
      await h.newService().publishQueuedJob(h.trusted, h.queued.jobId),
    ).toBe(false);
    expect(h.compiler).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(canceled.attempts).toHaveLength(0);
  }, 60_000);

  it.each(["scope", "input", "version"] as const)(
    "acknowledges %s drift without executing or altering the real root",
    async (kind) => {
      const h = await fixture();
      const original = deriveAsyncJobQueueEnvelopeV1(h.queued);
      const changed = asyncJobQueueEnvelopeV1Schema.parse({
        ...original,
        ...(kind === "scope"
          ? { ownership: { ...original.ownership, projectId: "project.other" } }
          : kind === "input"
            ? { inputDigest: `sha256:${"f".repeat(64)}` }
            : { recordVersion: original.recordVersion + 1 }),
      });
      h.inject(changed);
      await h.newWorker().runNext("worker.drift", 300_000);
      expect(await h.repository.get(h.queued.jobId)).toEqual(h.queued);
      expect(h.compiler).not.toHaveBeenCalled();
      expect(h.acknowledge).toHaveBeenCalledTimes(1);
    },
    60_000,
  );

  it("does not publish an expired canonical job even though envelopes carry no invented expiry", async () => {
    const h = await fixture();
    h.clock.advance(3_600_000);
    expect(
      await h.newService().publishQueuedJob(h.trusted, h.queued.jobId),
    ).toBe(false);
    h.inject(deriveAsyncJobQueueEnvelopeV1(h.queued));
    await expect(
      h.newWorker().runNext("worker.after-expiry", 300_000),
    ).rejects.toMatchObject({ code: "job.runtime-or-expiry-exhausted" });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.compiler).not.toHaveBeenCalled();
    expect(await h.repository.get(h.queued.jobId)).toEqual(h.queued);
  }, 60_000);
});
