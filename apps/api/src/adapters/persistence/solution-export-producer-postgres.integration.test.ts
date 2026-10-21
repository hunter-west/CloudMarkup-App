import { modelIntentExtractionResponseV1Schema } from "@cloudmarkup/schemas";
import { PostgresAiIntentAcceptance } from "./ai-intent-acceptance.js";
import { createPreviewAuthorityFixture } from "./ai-intent-preview-authority-test-helpers.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  InMemoryFifoJobQueue,
  InMemoryJobAuditPort,
  SequentialJobIdGenerator,
} from "@cloudmarkup/job-framework";
import { sha256DigestSchema } from "@cloudmarkup/schemas";
import { parseArchitectureDocument } from "@cloudmarkup/domain";
import {
  AWS_CATALOG_DIGEST_V1,
  awsCatalogV1,
} from "@cloudmarkup/provider-aws/catalog";
import { createInitialArchitectureDocument } from "../../application/architecture-document-storage.js";
import type { CloudMarkupApplication } from "../../application/ports.js";
import { ProductionIdentityApplication } from "../../application/production-identity-application.js";
import { createProductionRepositoryBackedApplication } from "../../production-composition.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import { PostgresSolutionRecordRepository } from "./solution-record-repository.js";
import { DeterministicValidationBridge } from "./deterministic-validation-bridge.js";
import { PostgresSolutionExportRevisionRepository } from "./solution-export-revision-repository.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { persistedExportRunFixture } from "./solution-export-run-test-helpers.js";
import { DurableSolutionExportProducer } from "./solution-export-producer.js";
import { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import { SolutionExportProducerObjects } from "./solution-export-producer-objects.js";
import { exportRunBytes, exportRunSha } from "./solution-export-run-codec.js";
import { sql } from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_export_producer_it_${nonce}`;
const marker = `CloudMarkup synthetic export producer ${nonce}`;
suite("durable export producer on isolated real PostgreSQL", () => {
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
      !/^cm_export_producer_it_[a-f0-9]{32}$/u.test(schema)
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
          !/^cm_export_producer_it_[a-f0-9]{32}$/u.test(schema)
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
    const ids = new SequentialJobIdGenerator();
    const queue = new InMemoryFifoJobQueue(ids);
    const publish = vi.spyOn(queue, "publish");
    const entitlement = {
      evaluate: vi.fn(() =>
        Promise.resolve({
          allowed: true,
          decisionReference:
            f.record.workflowSubmission.entitlementDecisionReference,
        }),
      ),
    };
    const ownership = {
      organizationId: f.record.organizationId,
      projectId: f.record.job.projectId,
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
      solutionRevisionId: f.record.job.solutionRevision.solutionRevisionId,
      manifestRecordId: f.record.job.solutionRevision.manifestRecordId,
      manifestDigest: sha256DigestSchema.parse(
        f.record.job.solutionRevision.manifestDigest,
      ),
      applicationCodeRequired: false,
      generationCoverage: f.record.job.generationCoverage,
      workflowSources: f.record.workflowSubmission.request.sources,
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
    const producer = new DurableSolutionExportProducer({
      database,
      objectStore: f.objects,
      principal: f.principal,
      ownership,
      revisions,
      queue,
      entitlement,
      ids,
      audit: new InMemoryJobAuditPort(),
    });
    return {
      ...f,
      producer,
      revisions,
      queue,
      publish,
      entitlement,
      input: { record: f.record, idempotencyKeyDigest: f.idempotencyKeyDigest },
    };
  }
  async function counts(jobId: string) {
    return (
      await database.query(
        sql(
          "SELECT (SELECT count(*)::text FROM async_jobs WHERE job_id=$1) AS jobs,(SELECT count(*)::text FROM solution_export_runs WHERE solution_export_run_id=$1) AS runs",
          [jobId],
        ),
      )
    ).rows[0];
  }
  it("admits a genuine root, commits exact inputs/run before dispatch, and replays without another entitlement", async () => {
    const f = await fixture();
    f.publish.mockImplementation(async () => {
      expect(await counts(f.record.job.id)).toEqual({ jobs: "1", runs: "1" });
    });
    const first = await f.producer.prepare(f.input);
    expect(first.dispatched).toBe(true);
    const replay = await f.producer.prepare(f.input);
    expect(replay.record).toEqual(first.record);
    expect(f.entitlement.evaluate).toHaveBeenCalledTimes(1);
    expect(await counts(f.record.job.id)).toEqual({ jobs: "1", runs: "1" });
  });
  it("recovers a root committed before prepared insertion without premature publication", async () => {
    const f = await fixture();
    vi.spyOn(f.producer.runs, "insertPreparedRun").mockRejectedValueOnce(
      new Error("Synthetic interrupted prepared commit"),
    );
    await expect(f.producer.prepare(f.input)).rejects.toThrow(
      "Synthetic interrupted",
    );
    expect(await counts(f.record.job.id)).toEqual({ jobs: "1", runs: "0" });
    expect(f.publish).not.toHaveBeenCalled();
    expect((await f.producer.prepare(f.input)).dispatched).toBe(true);
    expect(f.entitlement.evaluate).toHaveBeenCalledTimes(1);
  });
  it("retries a lost queue acknowledgement from the same committed root/run", async () => {
    const f = await fixture();
    f.publish.mockRejectedValueOnce(
      new Error("Synthetic lost delivery acknowledgement"),
    );
    await expect(f.producer.prepare(f.input)).rejects.toThrow(
      "Synthetic lost delivery",
    );
    expect(await counts(f.record.job.id)).toEqual({ jobs: "1", runs: "1" });
    expect((await f.producer.prepare(f.input)).dispatched).toBe(true);
    expect(f.entitlement.evaluate).toHaveBeenCalledTimes(1);
  });
  it("recovers interrupted object publication without a fake root or queue emission", async () => {
    const f = await fixture();
    const real = f.objects.publish.bind(f.objects);
    let failed = false;
    vi.spyOn(f.objects, "publish").mockImplementation(async (scope, object) => {
      if (!failed && object.purpose === "report") {
        failed = true;
        throw new Error("Synthetic storage interruption");
      }
      await real(scope, object);
    });
    await expect(f.producer.prepare(f.input)).rejects.toThrow(
      "Synthetic storage interruption",
    );
    expect(f.publish).not.toHaveBeenCalled();
    expect((await f.producer.prepare(f.input)).dispatched).toBe(true);
  });
  it.each(["viewer", "revoked", "expired", "foreign"])(
    "denies %s actor without root or queue mutation",
    async (mode) => {
      const f = await fixture();
      if (mode === "viewer")
        await database.query(
          sql(
            "UPDATE memberships SET role_key='viewer' WHERE membership_id=$1",
            [f.membershipId],
          ),
        );
      if (mode === "revoked")
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
      const producer = new DurableSolutionExportProducer({
        ...f.producer.options,
        principal,
      });
      await expect(producer.prepare(f.input)).rejects.toThrow();
      expect(await counts(f.record.job.id)).toEqual({ jobs: "0", runs: "0" });
      expect(f.publish).not.toHaveBeenCalled();
    },
  );
  it("checks revocation after source I/O before admission", async () => {
    const f = await fixture();
    f.revisions.prepare = async () => {
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
          [f.membershipId],
        ),
      );
    };
    await expect(f.producer.prepare(f.input)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await counts(f.record.job.id)).toEqual({ jobs: "0", runs: "0" });
    expect(f.publish).not.toHaveBeenCalled();
  });
  it("scopes identical derived content to two real organizations and refuses a foreign identity", async () => {
    const a = await fixture();
    const b = await fixture();
    const bytes = exportRunBytes({
      contractVersion: 1,
      synthetic: "same workload",
    });
    const digest = `sha256:${exportRunSha(bytes)}`;
    const aId = a.producer.objects.identity("workload-input", digest);
    const bId = b.producer.objects.identity("workload-input", digest);
    expect(aId).not.toBe(bId);
    const first = await a.producer.objects.put(bytes, "input-payload", aId);
    const second = await b.producer.objects.put(bytes, "input-payload", bId);
    expect(first.contentSha256).toBe(second.contentSha256);
    await expect(b.producer.objects.read(first)).rejects.toThrow();
    await expect(
      b.producer.objects.put(bytes, "input-payload", aId),
    ).rejects.toThrow();
  });
  it("coalesces concurrent exact-key retries into one root/admission/prepared run", async () => {
    const f = await fixture();
    await Promise.allSettled([
      f.producer.prepare(f.input),
      f.producer.prepare(f.input),
    ]);
    expect((await f.producer.prepare(f.input)).dispatched).toBe(true);
    expect(await counts(f.record.job.id)).toEqual({ jobs: "1", runs: "1" });
    expect(f.entitlement.evaluate).toHaveBeenCalledTimes(1);
  });
  it("keeps a prepared run undispatched when a declared source was never published", async () => {
    const f = await fixture();
    f.revisions.prepare = () => Promise.resolve();
    expect((await f.producer.prepare(f.input)).dispatched).toBe(false);
    expect(await counts(f.record.job.id)).toEqual({ jobs: "1", runs: "1" });
    expect(f.publish).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "reads a real production-created immutable revision without GET writes and publishes only its derived workload (accepted Intent: %s)",
    async (includeIntent) => {
      const f = await fixture();
      const identity = new ProductionIdentityApplication(database);
      const repository = new PostgresCloudMarkupRepository(database);
      const acceptedIntents = new PostgresAiIntentAcceptance({
        database,
        repository,
        objectStore: f.objects,
      });
      const app = createProductionRepositoryBackedApplication(identity, {
        fallback: {} as CloudMarkupApplication,
        identifierNamespace: "beta",
        objectStore: f.objects,
        repository,
        solutionRevisions: {
          acceptedIntents,
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
        provider: {
          id: awsCatalogV1.artifact.provider.id,
          region: "us-east-1",
        },
        catalog: {
          id: awsCatalogV1.artifact.catalog.id,
          version: awsCatalogV1.artifact.catalog.version,
          digest: AWS_CATALOG_DIGEST_V1,
        },
      });
      const createdProject = await app.createProject(
        f.principal,
        f.record.organizationId,
        {
          creationMode: "draft-copy",
          name: "Synthetic immutable producer",
          architectureDocument: document,
        },
        `project_${randomUUID()}`,
      );
      const draft = await app.getDraft(f.principal, createdProject.project.id);
      const accepted = includeIntent
        ? await (async () => {
            const preview = await createPreviewAuthorityFixture(
              database,
              {
                organizationId: f.record.organizationId,
                projectId: createdProject.project.id,
                userId: f.principal.principalId,
                jobId: `job_${randomUUID()}`,
              },
              300000,
              { draftId: draft.value.id, version: draft.value.version },
            );
            await preview.disconnect();
            return acceptedIntents.accept(
              preview.authority.principal,
              createdProject.project.id,
              {
                contractVersion: 1,
                candidate: modelIntentExtractionResponseV1Schema.parse(
                  preview.preview.result.response,
                ),
                editingProof: preview.authority.editingProof,
              },
              draft.etag,
              `accept_${randomUUID()}`,
            );
          })()
        : undefined;
      const solution = await app.createSolutionRevision(
        f.principal,
        createdProject.project.id,
        {
          contractVersion: 1,
          draftId: draft.value.id,
          draftVersion: draft.value.version,
          name: "Synthetic immutable input",
          ...(accepted === undefined
            ? {}
            : { acceptedIntentId: accepted.acceptedIntentId }),
        },
        draft.etag,
        `revision_${randomUUID()}`,
      );
      expect(solution.manifest.intent).toMatchObject(
        accepted === undefined
          ? { state: "not-applicable" }
          : {
              state: "included",
              id: accepted.acceptedIntentId,
              version: 1,
              contentHash: accepted.intentDigest,
            },
      );
      expect(
        await app.getSolutionRevision(
          f.principal,
          createdProject.project.id,
          solution.summary.solutionRevisionId,
        ),
      ).toEqual(solution);
      const ownership = {
        organizationId: f.record.organizationId,
        projectId: createdProject.project.id,
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
      const readRevision = vi.fn(app.getSolutionRevision.bind(app));
      const revisions = new PostgresSolutionExportRevisionRepository(
        objects,
        readRevision,
      );
      const selector = {
        ...ownership,
        solutionRevisionId: solution.summary.solutionRevisionId,
      };
      const countObjects = async () =>
        (
          await database.query(
            sql(
              "SELECT count(*)::text AS count FROM stored_objects WHERE organization_id=$1 AND project_id=$2",
              [ownership.organizationId, ownership.projectId],
            ),
          )
        ).rows[0]?.["count"];
      const before = await countObjects();
      const binding = await revisions.getImmutableBinding(selector);
      expect(await countObjects()).toBe(before);
      expect(binding?.generationCoverage).toEqual(
        solution.summary.generationCoverage,
      );
      if (binding === null)
        throw new Error("Expected exact immutable binding.");
      expect(
        await objects.metadata(
          binding.workflowSources.workloadBehavior.objectId,
        ),
      ).toBeNull();
      await revisions.prepare(binding);
      expect(
        (
          await objects.metadata(
            binding.workflowSources.workloadBehavior.objectId,
          )
        )?.state,
      ).toBe("published");
      expect(await revisions.getImmutableBinding(selector)).toEqual(binding);
      expect(readRevision).toHaveBeenCalledOnce();
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
          [f.membershipId],
        ),
      );
      await expect(
        revisions.getImmutableBinding(selector),
      ).rejects.toMatchObject({ code: "not_found" });
    },
  );
});
