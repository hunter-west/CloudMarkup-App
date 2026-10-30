import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  SendMessageCommand,
  SQSClient,
  type SendMessageCommandOutput,
} from "@aws-sdk/client-sqs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyAsyncJobLifecycleCommandV1,
  hashCanonicalValue,
  BETA_EXPORT_PRO_PLAN_ID,
} from "@cloudmarkup/domain";
import {
  createJobAuditOutboxEntryV1,
  type JobHandlerContextV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobWorkerIdSchema,
  asyncJobCheckpointV1Schema,
  type AsyncJobCheckpointV1,
  asyncJobAttemptIdSchema,
  namespacedIdentifierSchema,
} from "@cloudmarkup/schemas";
import {
  createNativeInfrastructureWorkflowFixture,
  createNativeExportDiagramFixture,
} from "../../solution-export-native-test-helpers.js";
import {
  createDurableSolutionExportHandler,
  type DurableSolutionExportHandlerOptions,
} from "../../solution-export-worker.js";
import {
  createProductionSolutionExportTargetSettings,
  loadProductionSolutionExportProfile,
} from "../../production-solution-export-profile.js";
import { collectProductionSolutionExportAssets } from "../../production-solution-export-assets.js";
import { assertProductionSolutionExportRequest } from "../../production-solution-export-host.js";
import { assertProductionSolutionExportStageAdmission } from "../../production-solution-export-stage-admission.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";

type StageAdmissionInput = Parameters<
  NonNullable<
    DurableSolutionExportHandlerOptions["assertCurrentStageAdmission"]
  >
>[0];
import { BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES } from "../../solution-export-limits.js";
import { createPinnedSolutionExportCompilerExecutor } from "../pinned-export-compiler.js";
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
} from "./solution-export-terminal-test-helpers.js";
import { sql } from "./sql.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";
import type { CloudMarkupApplication } from "../../application/ports.js";
import { ObjectStoreError } from "../../application/persistence.js";
import { createRepositoryBackedApplication } from "../../application/repository-backed-application.js";
import { awsCatalogArtifactV1 } from "@cloudmarkup/provider-aws/catalog";
import { ProductionIdentityApplication } from "../../application/production-identity-application.js";
import { createProductionRepositoryBackedApplication } from "../../production-composition.js";
import { createProductionSolutionExportHost } from "../../production-solution-export-host.js";
import { createProductionSolutionExportMutations } from "../../production-solution-export-mutations.js";
import { createProductionSolutionExportReads } from "../../production-solution-export-reads.js";
import { ProductionSolutionExportAudit } from "../../production-solution-export-audit.js";
import {
  PRODUCTION_SOLUTION_EXPORT_PROFILE,
  type ProductionSolutionExportEnvironment,
} from "../../production-solution-export-environment.js";
import {
  createSolutionExportDeliveredWorker,
  createSolutionExportQueueHandler,
} from "../../solution-export-consumer.js";
import { DeterministicValidationBridge } from "./deterministic-validation-bridge.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import { PostgresSolutionRecordRepository } from "./solution-record-repository.js";
import { PostgresProjectEditingLeases } from "./project-editing-leases.js";

async function removeSyntheticTemporaryRoot(
  root: string | undefined,
): Promise<void> {
  if (root === undefined) return;
  if (
    dirname(root) !== resolve(tmpdir()) ||
    !basename(root).startsWith("cloudmarkup-real-cfn-host-")
  ) {
    throw new Error("Refusing unverified temporary cleanup.");
  }
  await rm(root, { recursive: true, force: true });
}

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"];
const executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
const suite =
  configured && executablePath && executableSha256 ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = "cm_cfn_host_it_" + nonce;
const marker = "CloudMarkup synthetic CFN host " + nonce;
suite(
  "restricted CloudFormation host with real PostgreSQL and the pinned Go compiler",
  () => {
    let admin: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let created = false;
    let temporaryRoot: string | undefined;
    let assetRoot: string | undefined;
    let admittedProduction:
      | Awaited<ReturnType<typeof loadProductionSolutionExportProfile>>
      | undefined;
    beforeAll(async () => {
      temporaryRoot = await mkdtemp(
        join(tmpdir(), "cloudmarkup-real-cfn-host-"),
      );
      assetRoot = await mkdtemp(
        join(tmpdir(), "cloudmarkup-real-cfn-host-assets-"),
      );
      const assets = collectProductionSolutionExportAssets();
      const iconBundlePath = join(assetRoot, "diagram-icons.json");
      await writeFile(iconBundlePath, assets.iconBundle.bytes, {
        flag: "wx",
        mode: 0o600,
      });
      await mkdir(join(assetRoot, "fonts"));
      const fonts = assets.runtimeFiles.filter(({ path }) =>
        path.startsWith("cloudmarkup-export/fonts/"),
      );
      expect(fonts).toHaveLength(2);
      for (const font of fonts)
        await writeFile(
          join(assetRoot, "fonts", basename(font.path)),
          font.bytes,
          { flag: "wx", mode: 0o600 },
        );
      const settings = createProductionSolutionExportTargetSettings({
        compilerExecutableSha256: executableSha256 ?? "",
        iconBundleSha256: assets.iconBundle.sha256,
      });
      admittedProduction = await loadProductionSolutionExportProfile({
        compiler: {
          executablePath: executablePath ?? "",
          executableSha256: executableSha256 ?? "",
        },
        iconBundlePath,
        iconBundleSha256: assets.iconBundle.sha256,
        targetSettingsDigest: settings.digest,
      });
      const url = new URL(configured ?? "");
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.search !== "" ||
        url.hash !== "" ||
        !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname) ||
        !/^cm_cfn_host_it_[a-f0-9]{32}$/u.test(schema)
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
            !/^cm_cfn_host_it_[a-f0-9]{32}$/u.test(schema)
          )
            throw new Error("Refusing unverified synthetic schema cleanup.");
          await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
        }
      } finally {
        try {
          await admin?.close();
        } finally {
          try {
            await removeSyntheticTemporaryRoot(temporaryRoot);
          } finally {
            await removeSyntheticTemporaryRoot(assetRoot);
          }
        }
      }
    }, 30_000);

    async function fixture(
      target: "terraform" | "cloudformation" = "cloudformation",
      commercialEnabled = false,
    ) {
      if (temporaryRoot === undefined)
        throw new Error("Expected initialized temporary directory.");
      const productionProfile = commercialEnabled
        ? admittedProduction
        : undefined;
      if (commercialEnabled && productionProfile === undefined)
        throw new Error("Expected the actual admitted production profile.");
      const productionSettings = productionProfile?.targetSettings;
      const nativeSource =
        target === "cloudformation"
          ? await createNativeInfrastructureWorkflowFixture({
              executablePath: executablePath ?? "",
              executableSha256: executableSha256 ?? "",
              temporaryRoot,
              ...(productionSettings === undefined
                ? {}
                : { targetSettings: productionSettings }),
            })
          : undefined;
      const f = await persistedExportRunFixture(database, target, nativeSource);
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
      const billing = commercialEnabled ? await commercial(f) : undefined;
      const running = await f.startRoot();
      const executor = createPinnedSolutionExportCompilerExecutor({
        executablePath: executablePath ?? "",
        executableSha256: executableSha256 ?? "",
        temporaryRoot,
      });
      const compiler = vi.fn(executor.execute.bind(executor));
      let beforeStage:
        ((input: StageAdmissionInput) => Promise<void>) | undefined;
      const stageAdmission = vi.fn(async (input: StageAdmissionInput) => {
        if (productionSettings === undefined)
          throw new Error("Missing actual production settings.");
        await beforeStage?.(input);
        await assertProductionSolutionExportStageAdmission(
          input,
          productionSettings,
        );
      });
      const handler = createDurableSolutionExportHandler({
        executionProfile: "cloudformation-infrastructure-only",
        database,
        objectStore: f.objects,
        ...(productionSettings === undefined
          ? {}
          : {
              assertCurrentStageAdmission: stageAdmission,
              assertRequestHostBinding: (request) => {
                assertProductionSolutionExportRequest(
                  request,
                  productionSettings,
                );
              },
            }),
        compiler: { executor: { execute: compiler } },
        diagram:
          target === "cloudformation"
            ? (productionProfile?.diagram ??
              (await createNativeExportDiagramFixture()))
            : {
                catalog: exportTerminalIconRegistry.catalog,
                iconSet: exportTerminalIconSet,
              },
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
          capturedCheckpoints.push(
            asyncJobCheckpointV1Schema.parse(checkpoint),
          );
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
          latest = await jobs.saveWithAudit(
            recorded.job,
            latest.recordVersion,
            [
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
            ],
          );
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
        compiler,
        executor,
        terminal,
        reader,
        execute,
        complete,
        billing,
        stageAdmission,
        setBeforeStage: (
          hook: (input: StageAdmissionInput) => Promise<void>,
        ) => {
          beforeStage = hook;
        },
      };
    }
    async function commercial(
      f: Awaited<ReturnType<typeof persistedExportRunFixture>>,
    ) {
      const id = (prefix: string) =>
        prefix + "_" + randomUUID().replaceAll("-", "");
      const administration = {
        authority: "internal-administration" as const,
        actorId: "synthetic_cfn_export_administration",
        actorPrincipalId: f.principal.principalId,
        organizationId: f.record.organizationId,
        correlationId: f.principal.correlationId,
      };
      const repository = new PostgresCommercialPersistenceRepository(database);
      const account = await repository.createBillingAccount(administration, {
        billingAccountId: id("billing"),
      });
      const active = await repository.updateBillingAccount(administration, {
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
          planVersionId: BETA_EXPORT_PRO_PLAN_ID,
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
        planVersionId: BETA_EXPORT_PRO_PLAN_ID,
        sourceRecordVersion: subscription.recordVersion,
        subscriptionProjectionId: subscription.subscriptionProjectionId,
      });
      return {
        disable: () =>
          repository.updateBillingAccount(administration, {
            expectedRecordVersion: active.recordVersion,
            expensiveOperationsEnabled: false,
            lifecycleStatus: "active",
          }),
      };
    }
    async function artifactCount(jobId: string) {
      return (
        await database.query(
          sql(
            "SELECT COUNT(*)::int AS count FROM solution_export_artifacts WHERE solution_export_run_id=$1",
            [jobId],
          ),
        )
      ).rows[0]?.["count"];
    }

    it.each([false, true])(
      "saves through the leased production application and delivers that exact immutable revision to a verified download (interrupted manifest publication: %s)",
      async (interruptManifestPublication) => {
        if (
          temporaryRoot === undefined ||
          assetRoot === undefined ||
          admittedProduction === undefined
        )
          throw new Error("Expected the staged actual production profile.");
        const admitted = admittedProduction;
        const native = await createNativeInfrastructureWorkflowFixture({
          executablePath: executablePath ?? "",
          executableSha256: executableSha256 ?? "",
          temporaryRoot,
          targetSettings: admitted.targetSettings,
        });
        // Reuse only synthetic tenant setup and the source architecture. This new
        // project's manifest and export job are created by actual application paths.
        const f = await persistedExportRunFixture(
          database,
          "cloudformation",
          native,
        );
        await commercial(f);
        const roundTrips: string[] = [];
        const dataApiDatabase = withDataApiTypes(database, (operation) =>
          roundTrips.push(operation),
        );
        const identity = new ProductionIdentityApplication(dataApiDatabase);
        const repository = new PostgresCloudMarkupRepository(dataApiDatabase, {
          draftEditingLeases: "required",
        });
        const selectedTools = {
          compiler: {
            state: "pinned" as const,
            tool: admitted.targetSettings.stageDescriptors.compiler.adapter,
          },
          diagramRenderer: {
            state: "pinned" as const,
            tool: admitted.targetSettings.stageDescriptors.diagramRenderer
              .adapter,
          },
        };
        const selectToolsForFreeze = vi.fn(() =>
          Promise.resolve(structuredClone(selectedTools)),
        );
        const applicationOptions = {
          draftEditingLeases: "required" as const,
          fallback: {} as CloudMarkupApplication,
          identifierNamespace: "beta-save-export",
          objectStore: f.objects,
          repository,
          solutionRevisions: {
            selectToolsForFreeze,
            solutionRecords: new PostgresSolutionRecordRepository(
              dataApiDatabase,
            ),
            validation: new DeterministicValidationBridge({
              database: dataApiDatabase,
              identifierNamespace: "beta-save-export",
              objectStore: f.objects,
              repository,
            }),
          },
        };
        const application = createProductionRepositoryBackedApplication(
          identity,
          applicationOptions,
        );
        const blankKey = "blank-" + randomUUID();
        const blankInput = {
          creationMode: "blank" as const,
          name: "Synthetic AWS blank project",
        };
        const blank = await application.createProject(
          f.principal,
          f.record.organizationId,
          blankInput,
          blankKey,
        );
        const blankDraft = await application.getDraft(
          f.principal,
          blank.project.id,
        );
        expect(blankDraft.value.architectureDocument).toMatchObject({
          provider: {
            id: awsCatalogArtifactV1.provider.id,
            region: "us-east-1",
          },
          catalog: {
            id: awsCatalogArtifactV1.catalog.id,
            version: awsCatalogArtifactV1.catalog.version,
            digest: awsCatalogArtifactV1.digest,
          },
          nodes: [],
          edges: [],
          workloadBehavior: { workloads: [] },
        });
        expect(
          (
            await application.createProject(
              f.principal,
              f.record.organizationId,
              blankInput,
              blankKey,
            )
          ).project.id,
        ).toBe(blank.project.id);
        await expect(
          application.createProject(
            f.principal,
            f.record.organizationId,
            { ...blankInput, name: "Changed request" },
            blankKey,
          ),
        ).rejects.toMatchObject({ code: "idempotency_key_reused" });
        const legacyApplication = createRepositoryBackedApplication({
          ...applicationOptions,
          organizationForProject: (principal, id) =>
            identity.organizationForProject(principal, id),
          organizationForRequestedScope: (principal, id) =>
            identity.organizationForRequestedScope(principal, id),
        });
        const legacyKey = "legacy-" + randomUUID();
        const legacy = await legacyApplication.createProject(
          f.principal,
          f.record.organizationId,
          blankInput,
          legacyKey,
        );
        expect(
          (
            await application.createProject(
              f.principal,
              f.record.organizationId,
              blankInput,
              legacyKey,
            )
          ).project.id,
        ).toBe(legacy.project.id);
        expect(
          (await application.getDraft(f.principal, legacy.project.id)).value
            .architectureDocument.catalog.id,
        ).toBe("example.cloud.catalog");
        const created = await application.createProject(
          f.principal,
          f.record.organizationId,
          {
            creationMode: "draft-copy",
            name: "Synthetic saved CloudFormation project",
            architectureDocument: native.generationRequest.architectureDocument,
          },
          "create-" + randomUUID(),
        );
        const projectId = created.project.id;
        const draft = await application.getDraft(f.principal, projectId);
        const leases = new PostgresProjectEditingLeases(dataApiDatabase);
        const token = randomBytes(32).toString("base64url");
        const lease = await leases.acquire(f.principal, projectId, { token });
        if (lease.state !== "owned")
          throw new Error("Expected the synthetic editing lease.");
        const saved = await application.saveDraft(
          f.principal,
          projectId,
          {
            contractVersion: 1,
            architectureDocument: draft.value.architectureDocument,
            editingLease: { leaseId: lease.leaseId, token },
          },
          draft.etag,
        );
        const saveInput = {
          contractVersion: 1 as const,
          draftId: saved.value.id,
          draftVersion: saved.value.version,
          name: "First saved revision",
        };
        const saveKey = "save-" + randomUUID();
        // A fresh reader and idempotent retry cannot depend on a current host or
        // silently replace an already frozen selection after a restart.
        const unavailableSelector = vi.fn(() =>
          Promise.reject(
            new Error("Do not select tools for an immutable read."),
          ),
        );
        const restarted = createProductionRepositoryBackedApplication(
          identity,
          {
            ...applicationOptions,
            solutionRevisions: {
              ...applicationOptions.solutionRevisions,
              selectToolsForFreeze: unavailableSelector,
            },
          },
        );
        async function freezeRevision() {
          if (!interruptManifestPublication)
            return application.createSolutionRevision(
              f.principal,
              projectId,
              saveInput,
              saved.etag,
              saveKey,
            );
          const publish = f.objects.publish.bind(f.objects);
          let interrupted = false;
          const publication = vi
            .spyOn(f.objects, "publish")
            .mockImplementation(async (scope, object) => {
              if (
                object.purpose === "solution-revision-manifest" &&
                !interrupted
              ) {
                interrupted = true;
                throw new ObjectStoreError(
                  "storage-unavailable",
                  "Synthetic manifest publication interruption.",
                );
              }
              return publish(scope, object);
            });
          try {
            await expect(
              application.createSolutionRevision(
                f.principal,
                projectId,
                saveInput,
                saved.etag,
                saveKey,
              ),
            ).rejects.toMatchObject({ code: "service_unavailable" });
            expect(interrupted).toBe(true);
            expect(selectToolsForFreeze).toHaveBeenCalledTimes(1);
            const pending = await database.query(
              sql(
                "SELECT solution_record_id FROM solution_records WHERE organization_id=$1 AND project_id=$2 AND record_kind='solution-revision-manifest'",
                [f.record.organizationId, projectId],
              ),
            );
            expect(pending.rows).toHaveLength(1);
            const pendingId = pending.rows[0]?.["solution_record_id"];
            if (typeof pendingId !== "string")
              throw new Error(
                "Expected the original pending manifest identity.",
              );
            await expect(
              restarted.getSolutionRevision(f.principal, projectId, pendingId),
            ).rejects.toMatchObject({ code: "not_found" });
            return await restarted.createSolutionRevision(
              f.principal,
              projectId,
              saveInput,
              saved.etag,
              saveKey,
            );
          } finally {
            publication.mockRestore();
          }
        }
        const revision = await freezeRevision();
        expect(revision.manifest.versions.compiler).toEqual(
          selectedTools.compiler,
        );
        expect(revision.manifest.versions.diagramRenderer).toEqual(
          selectedTools.diagramRenderer,
        );
        expect(revision.manifest.evidenceIdsAtFreeze).toEqual([]);
        expect(revision.manifest.generationCoverage.evidence).toEqual([]);
        expect(selectToolsForFreeze).toHaveBeenCalledTimes(1);
        expect(
          await restarted.getSolutionRevision(
            f.principal,
            projectId,
            revision.summary.solutionRevisionId,
          ),
        ).toEqual(revision);
        expect(
          await restarted.createSolutionRevision(
            f.principal,
            projectId,
            saveInput,
            saved.etag,
            saveKey,
          ),
        ).toEqual(revision);
        expect(unavailableSelector).not.toHaveBeenCalled();
        const ownership = {
          organizationId: f.record.organizationId,
          projectId,
        };
        const config: ProductionSolutionExportEnvironment = {
          enabled: true,
          profile: PRODUCTION_SOLUTION_EXPORT_PROFILE,
          queue: {
            region: "us-east-1",
            queueArn:
              "arn:aws:sqs:us-east-1:123456789012:cloudmarkup-beta-solution-exports.fifo",
            queueUrl:
              "https://sqs.us-east-1.amazonaws.com/123456789012/cloudmarkup-beta-solution-exports.fifo",
          },
          accountId: "123456789012",
          databaseArn:
            "arn:aws:rds:us-east-1:123456789012:cluster:synthetic-save-export",
          databaseName: "cloudmarkup",
          databaseSecretArn:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:synthetic-save-export",
          contentBucket: "cloudmarkup-beta-synthetic-content",
          documentPrefix: "documents/v1/organizations/",
          compiler: {
            executablePath: executablePath ?? "",
            executableSha256: executableSha256 ?? "",
          },
          iconBundlePath: join(assetRoot, "diagram-icons.json"),
          iconBundleSha256:
            collectProductionSolutionExportAssets().iconBundle.sha256,
          targetSettingsDigest: admitted.targetSettings.digest,
        };
        const client = new SQSClient({ region: "us-east-1", maxAttempts: 1 });
        const deliveredBodies: string[] = [];
        const send = vi
          .fn<
            (command: SendMessageCommand) => Promise<SendMessageCommandOutput>
          >()
          .mockImplementation((command) => {
            if (
              !(command instanceof SendMessageCommand) ||
              typeof command.input.MessageBody !== "string"
            )
              throw new Error(
                "Only the actual bounded export publication is supported.",
              );
            expect(command.input.QueueUrl).toBe(config.queue.queueUrl);
            const body = command.input.MessageBody;
            deliveredBodies.push(body);
            return Promise.resolve({
              MessageId: "synthetic_saved_export",
              MD5OfMessageBody: createHash("md5").update(body).digest("hex"),
              $metadata: { httpStatusCode: 200 },
            });
          });
        // Intercept the actual Promise-based overload used by the publisher.
        Object.defineProperty(client, "send", { value: send });
        try {
          const host = createProductionSolutionExportHost({
            config,
            database: dataApiDatabase,
            objectStore: f.objects,
            admitted,
            ownership,
            principalId: f.principal.principalId,
            client,
          });
          const mutations = createProductionSolutionExportMutations({
            database: dataApiDatabase,
            objectStore: f.objects,
            identity,
            revisions: restarted,
            host,
          });
          const request = {
            contractVersion: 1 as const,
            solutionRevisionId: revision.summary.solutionRevisionId,
            environment: { environmentType: "development" as const },
            exportName: "Saved infrastructure",
            targetProfileId:
              "cloudmarkup.export.cloudformation-nodejs24-v1" as const,
          };
          const exportKey = "export-" + randomUUID();
          const beforeCreation = roundTrips.length;
          const queued = await mutations.createJob(
            f.principal,
            projectId,
            request,
            exportKey,
          );
          // Baseline: 2,116 Data API round trips. Keep admission below this
          // regression ceiling without removing current tenant/lifecycle checks.
          expect(roundTrips.length - beforeCreation).toBeLessThanOrEqual(600);
          expect(queued.state).toBe("queued");
          expect(queued.solutionRevision.solutionRevisionId).toBe(
            revision.summary.solutionRevisionId,
          );
          expect(deliveredBodies).toHaveLength(1);
          expect(
            (
              await mutations.createJob(
                f.principal,
                projectId,
                request,
                exportKey,
              )
            ).id,
          ).toBe(queued.id);
          // Recovery republishes the same queued job; physical delivery can repeat.
          expect(send).toHaveBeenCalledTimes(2);
          expect(deliveredBodies).toEqual([
            deliveredBodies[0],
            deliveredBodies[0],
          ]);
          expect(send.mock.calls[1]?.[0].input).toEqual(
            send.mock.calls[0]?.[0].input,
          );
          const reads = createProductionSolutionExportReads({
            database: dataApiDatabase,
            objectStore: f.objects,
            identity,
          });
          expect(
            (await reads.getJob(f.principal, projectId, queued.id)).artifact,
          ).toBeUndefined();
          const executor = createPinnedSolutionExportCompilerExecutor({
            ...config.compiler,
            temporaryRoot,
          });
          const execute = vi.fn(executor.execute.bind(executor));
          const audit = new ProductionSolutionExportAudit(
            dataApiDatabase,
            ownership,
          );
          const worker = createSolutionExportDeliveredWorker({
            executionProfile: "cloudformation-infrastructure-only",
            database: dataApiDatabase,
            objectStore: f.objects,
            compiler: { executor: { execute } },
            diagram: admitted.diagram,
            assertCurrentStageAdmission: (input) =>
              assertProductionSolutionExportStageAdmission(
                input,
                admitted.targetSettings,
                true,
              ),
            assertRequestHostBinding: (input) => {
              assertProductionSolutionExportRequest(
                input,
                admitted.targetSettings,
              );
            },
            clock: { now: () => new Date() },
            audit,
            publisher: {
              contractVersion: 1,
              publish: () =>
                Promise.reject(
                  new Error("The original delivery owns retry wakeup."),
                ),
            },
            workerId: "worker.saved-export." + randomUUID(),
          });
          const consume = createSolutionExportQueueHandler({
            expectedQueueArn: config.queue.queueArn,
            worker,
          });
          const event = {
            Records: [
              {
                messageId: "synthetic_saved_export",
                body: deliveredBodies[0],
                eventSource: "aws:sqs",
                eventSourceARN: config.queue.queueArn,
              },
            ],
          };
          expect(await consume(event)).toEqual({ batchItemFailures: [] });
          await audit.flush();
          const completed = await reads.getJob(
            f.principal,
            projectId,
            queued.id,
          );
          expect(completed, JSON.stringify(completed)).toMatchObject({
            state: "succeeded",
          });
          const artifactId = completed.artifact?.artifactId;
          if (artifactId === undefined)
            throw new Error(
              "Expected a verified artifact from the actual saved revision.",
            );
          expect(await artifactCount(queued.id)).toBe(1);
          expect(execute).toHaveBeenCalledTimes(1);
          const artifact = await reads.getArtifact(
            f.principal,
            projectId,
            artifactId,
          );
          expect(artifact.solutionRevisionId).toBe(
            revision.summary.solutionRevisionId,
          );
          expect(
            artifact.files.some(
              ({ path }) =>
                path.endsWith(".json") && path.startsWith("infrastructure/"),
            ),
          ).toBe(true);
          const template = artifact.files.find(
            ({ mediaType }) =>
              mediaType ===
              "application/vnd.amazon.cloudformation.template+json",
          );
          if (template === undefined)
            throw new Error("Expected an actual CloudFormation template.");
          const preview = await reads.getFilePreview(
            f.principal,
            projectId,
            artifactId,
            template.id,
          );
          expect(preview.truncated).toBe(false);
          const cloudFormation: unknown = JSON.parse(preview.content);
          expect(cloudFormation).toMatchObject({
            AWSTemplateFormatVersion: "2010-09-09",
          });
          expect(cloudFormation).toHaveProperty("Resources");
          expect(preview.content).toContain("AWS::SQS::Queue");
          expect(
            artifact.files.some(({ mediaType }) => mediaType === "image/png"),
          ).toBe(true);
          expect(
            artifact.files.some(
              ({ mediaType }) => mediaType === "image/svg+xml",
            ),
          ).toBe(true);
          const grant = await reads.createDownloadGrant(
            f.principal,
            projectId,
            artifactId,
            "download-" + randomUUID(),
          );
          const downloaded = await reads.download(
            f.principal,
            projectId,
            artifactId,
            grant.id,
          );
          expect(downloaded.bytes.byteLength).toBe(artifact.sizeBytes);
          expect(downloaded.bytes.byteLength).toBeGreaterThan(0);
          expect(downloaded.digest).toBe(artifact.digest);
          expect(
            "sha256:" +
              createHash("sha256").update(downloaded.bytes).digest("hex"),
          ).toBe(artifact.digest);
          // Redelivery recovers exactly the persisted terminal outcome; no compiler
          // replay, extra artifact or new source selection is allowed.
          expect(await consume(event)).toEqual({ batchItemFailures: [] });
          expect(execute).toHaveBeenCalledTimes(1);
          expect(await artifactCount(queued.id)).toBe(1);
          expect(
            await restarted.getSolutionRevision(
              f.principal,
              projectId,
              revision.summary.solutionRevisionId,
            ),
          ).toEqual(revision);
          expect(unavailableSelector).not.toHaveBeenCalled();
          expect(
            (
              await database.query(
                sql(
                  "SELECT (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS reservations,(SELECT count(*)::int FROM usage_ledger_entries WHERE organization_id=$1) AS ledger",
                  [ownership.organizationId],
                ),
              )
            ).rows[0],
          ).toEqual({ reservations: 0, ledger: 0 });
          expect(await readdir(temporaryRoot)).toEqual([]);
          // The complete worker/download path previously made over 10,000
          // round trips. Keep current checks while bounding metadata overhead.
          expect(roundTrips.length).toBeLessThanOrEqual(7_500);
        } finally {
          send.mockReset();
          client.destroy();
        }
      },
      60_000,
    );

    it("executes real compilation and download with the production settings and current successor Pro policy", async () => {
      const h = await fixture("cloudformation", true);
      const outcome = await h.execute();
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        outcome: "succeeded",
      });
      if (
        outcome.outcome !== "succeeded" ||
        outcome.output.family !== "solution-export-orchestration"
      )
        throw new Error("Expected real export output.");
      const root = await h.complete(outcome);
      await h.terminal.reconcile(root);
      const artifact = await h.reader.getArtifact({
        ...h.f.selector,
        artifactId: outcome.output.verifiedPackage.artifactId,
      });
      expect(artifact?.zipBytes.byteLength).toBeGreaterThan(0);
      expect(
        h.stageAdmission.mock.calls.filter(
          ([input]) => input.stage === "persist-output",
        ),
      ).toHaveLength(2);
      expect(h.compiler).toHaveBeenCalledTimes(1);
      expect(await artifactCount(root.jobId)).toBe(1);
    }, 60_000);
    it("denies a queued export before compilation when current expensive operations are disabled", async () => {
      const h = await fixture("cloudformation", true);
      await h.billing?.disable();
      const outcome = await h.execute();
      expect(outcome).toMatchObject({ outcome: "failed" });
      expect(h.compiler).not.toHaveBeenCalled();
      const root = await h.complete(outcome);
      expect((await h.terminal.reconcile(root)).job.state).toBe("failed");
      expect(await artifactCount(root.jobId)).toBe(0);
    }, 60_000);
    it("rechecks current commercial access before the first durable archive write", async () => {
      const h = await fixture("cloudformation", true);
      let revoked = false;
      h.setBeforeStage(async ({ stage }) => {
        if (stage === "persist-output" && !revoked) {
          revoked = true;
          await h.billing?.disable();
        }
      });
      const staged = vi.spyOn(h.f.objects, "stage");
      const outcome = await h.execute();
      expect(outcome).toMatchObject({ outcome: "failed" });
      expect(revoked).toBe(true);
      expect(h.compiler).toHaveBeenCalledTimes(1);
      expect(
        staged.mock.calls.filter(
          ([, input]) => input.mediaType === "application/zip",
        ),
      ).toHaveLength(0);
      const root = await h.complete(outcome);
      expect((await h.terminal.reconcile(root)).job.state).toBe("failed");
      expect(await artifactCount(root.jobId)).toBe(0);
    }, 60_000);
    it("withholds the download when current commercial access is revoked during archive persistence", async () => {
      const h = await fixture("cloudformation", true);
      const originalStage = h.f.objects.stage.bind(h.f.objects);
      let revoked = false;
      vi.spyOn(h.f.objects, "stage").mockImplementation(
        async (scope, input) => {
          const result = await originalStage(scope, input);
          if (input.mediaType === "application/zip" && !revoked) {
            revoked = true;
            if (h.billing === undefined)
              throw new Error("Expected seeded billing.");
            await h.billing.disable();
          }
          return result;
        },
      );
      const outcome = await h.execute();
      expect(revoked).toBe(true);
      expect(outcome).toMatchObject({ outcome: "failed" });
      expect(h.compiler).toHaveBeenCalledTimes(1);
      expect(
        h.stageAdmission.mock.calls.filter(
          ([input]) => input.stage === "persist-output",
        ),
      ).toHaveLength(2);
      const root = await h.complete(outcome);
      expect((await h.terminal.reconcile(root)).job.state).toBe("failed");
      expect(await artifactCount(root.jobId)).toBe(0);
    }, 60_000);
    it("compiles, validates and retains CloudFormation without application or Terraform executors, then recovers publication exactly once", async () => {
      const h = await fixture();
      const outcome = await h.execute();
      expect(outcome, JSON.stringify(outcome)).toMatchObject({
        outcome: "succeeded",
      });
      if (
        outcome.outcome !== "succeeded" ||
        outcome.output.family !== "solution-export-orchestration"
      )
        throw new Error("Expected real verified CloudFormation output.");
      expect(h.compiler).toHaveBeenCalledTimes(1);
      expect(h.compiler.mock.calls[0]?.[0].args).toContain("cloudformation");
      const selector = {
        ...h.f.selector,
        artifactId: outcome.output.verifiedPackage.artifactId,
      };
      expect(await h.reader.getArtifact(selector)).toBeNull();
      const root = await h.complete(outcome);
      const publish = vi.spyOn(h.f.objects, "publish");
      publish.mockRejectedValueOnce(
        new Error("Synthetic recoverable publication interruption."),
      );
      await expect(h.terminal.reconcile(root)).rejects.toThrow(
        "Synthetic recoverable",
      );
      expect(await artifactCount(root.jobId)).toBe(0);
      publish.mockRestore();
      const first = await h.terminal.reconcile(root);
      expect(first.job.state).toBe("succeeded");
      expect(
        first.job.stages.find(
          ({ stage }) => stage === "cloudformation-validation",
        )?.status,
      ).toBe("succeeded");
      expect(
        first.job.stages.some(({ stage }) => stage === "terraform-validation"),
      ).toBe(false);
      expect(await h.terminal.reconcile(root)).toEqual(first);
      expect(await artifactCount(root.jobId)).toBe(1);
      expect(h.compiler).toHaveBeenCalledTimes(1);
      const retained = await h.reader.getArtifact(selector);
      if (retained === null) throw new Error("Expected retained archive.");
      expect(
        retained.artifact.files.some(
          ({ mediaType }) =>
            mediaType === "application/vnd.amazon.cloudformation.template+json",
        ),
      ).toBe(true);
      expect(retained.zipBytes.byteLength).toBe(retained.artifact.sizeBytes);
      expect(retained.zipBytes.byteLength).toBeLessThanOrEqual(
        BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES,
      );
      expect([...retained.zipBytes.slice(0, 2)]).toEqual([80, 75]);
      await expect(
        h.reader.getArtifact({ ...selector, organizationId: "org.foreign" }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        h.terminal.reconcile({
          ...root,
          recordVersion: root.recordVersion + 1,
        }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      if (temporaryRoot === undefined)
        throw new Error("Expected initialized temporary directory.");
      expect(await readdir(temporaryRoot)).toEqual([]);
    }, 60_000);
    it("rejects Terraform before launching the compiler and retains a truthful failed outcome", async () => {
      const h = await fixture("terraform");
      const outcome = await h.execute();
      expect(outcome).toMatchObject({ outcome: "failed" });
      expect(h.compiler).not.toHaveBeenCalled();
      const root = await h.complete(outcome);
      if (outcome.outcome !== "failed")
        throw new Error("Expected failed outcome.");
      expect(root.failure).toEqual(outcome.failure);
      const identity = solutionExportExecutionIdentity(h.running);
      const receiptId = h.terminal.storage.identity("terminal-receipt", {
        jobId: identity.jobId,
        attemptId: identity.attemptId,
        value: null,
      });
      const metadata = await h.terminal.storage.metadata(receiptId);
      if (metadata === null) throw new Error("Expected retained receipt.");
      const receipt = await h.terminal.storage.readJson(metadata.reference);
      expect(receipt).toMatchObject({
        result: { outcome: { failure: root.failure } },
      });
      expect((await h.terminal.reconcile(root)).job.state).toBe("failed");
      expect(await artifactCount(root.jobId)).toBe(0);
    }, 60_000);
    it("rejects publication when current tenant membership is revoked during real compilation", async () => {
      const h = await fixture();
      h.compiler.mockImplementationOnce(async (command) => {
        const result = await h.executor.execute(command);
        expect(result.exitCode).toBe(0);
        await database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
            [h.f.membershipId],
          ),
        );
        return result;
      });
      await expect(h.execute()).rejects.toBeDefined();
      expect(h.compiler).toHaveBeenCalledTimes(1);
      expect(await artifactCount(h.running.jobId)).toBe(0);
      if (temporaryRoot === undefined)
        throw new Error("Expected initialized temporary directory.");
      expect(await readdir(temporaryRoot)).toEqual([]);
    }, 60_000);
    it("honors current cancellation after real compilation without publishing an archive", async () => {
      const h = await fixture();
      h.compiler.mockImplementationOnce(async (command) => {
        const result = await h.executor.execute(command);
        expect(result.exitCode).toBe(0);
        await h.f.cancelRoot();
        return result;
      });
      await expect(h.execute()).resolves.toEqual({ outcome: "canceled" });
      expect(h.compiler).toHaveBeenCalledTimes(1);
      expect(await artifactCount(h.running.jobId)).toBe(0);
    }, 60_000);
  },
);
