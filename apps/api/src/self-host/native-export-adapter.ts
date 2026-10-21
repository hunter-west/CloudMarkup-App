import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import { runtimeExportCapabilitiesV1Schema } from "@cloudmarkup/api-contract";
import { solutionRevisionToolSelectionsV1Schema } from "../application/solution-revision-builder.js";
import { ApplicationError } from "../application/errors.js";
import { PROVIDER_DIRECT_EXPORT_FUNDING_PREFIX_V1 } from "../application/provider-direct-export-funding.js";
import { createProjectWriteFencedObjectStore } from "../adapters/persistence/project-content-write-fence.js";
import { createPinnedSolutionExportCompilerExecutor } from "../adapters/pinned-export-compiler.js";
import { verifyPinnedGoExecutableBytes } from "../adapters/pinned-go-executable.js";
import { SolutionExportRequestAuthority } from "../adapters/persistence/solution-export-authority.js";
import { PostgresSolutionExportDownloadRepository } from "../adapters/persistence/solution-export-download-repository.js";
import { exportRunEqual } from "../adapters/persistence/solution-export-run-codec.js";
import { sql } from "../adapters/persistence/sql.js";
import { loadProductionSolutionExportProfile } from "../production-solution-export-profile.js";
import {
  assertProductionInfrastructureBinding,
  assertProductionSolutionExportRequest,
  selectProductionApplicationDelivery,
} from "../production-solution-export-host.js";
import { createProductionSolutionExportMutations } from "../production-solution-export-mutations.js";
import { createProductionSolutionExportReads } from "../production-solution-export-reads.js";
import { ProductionSolutionExportAudit } from "../production-solution-export-audit.js";
import {
  createDurableSolutionExportHandler,
  type DurableSolutionExportHandlerOptions,
} from "../solution-export-worker.js";
import { createSolutionExportDeliveredWorker } from "../solution-export-consumer.js";
import { createSelfHostJobPoller } from "./adapter-registry.js";
import {
  createSelfHostDirectExportTargetPolicy,
  selfHostNativeExportAdmissionReference,
} from "./direct-export-policy.js";
import type {
  SelfHostAdapterContext,
  SelfHostConfiguredAdapter,
} from "./runtime.js";

const absolutePath = z.string().min(1).max(4096).refine(isAbsolute);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const settingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    compiler: z
      .object({ executablePath: absolutePath, executableSha256: sha })
      .strict(),
    iconBundlePath: absolutePath,
    iconBundleSha256: sha,
    targetSettingsDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    pollIntervalMilliseconds: z.number().int().min(100).max(60000),
  })
  .strict();
function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "The standalone native export is unavailable.",
  );
}

/** Same native profile, deterministic compiler/renderer and durable shared
 * export workflow as hosted beta. Only the commercial admission is replaced by
 * current exports.run authority. No model, credit, plan or SQS is fabricated. */
export async function createSelfHostNativeExportAdapter(
  context: SelfHostAdapterContext,
): Promise<SelfHostConfiguredAdapter> {
  const settings = settingsSchema.parse(context.privateSettings);
  context.signal.throwIfAborted();
  const admitted = await loadProductionSolutionExportProfile(settings);
  const assertNativeReady = async () => {
    if (context.persistence.readiness().state !== "ready") unavailable();
    await verifyPinnedGoExecutableBytes(settings.compiler);
    const current = await loadProductionSolutionExportProfile(settings);
    if (!exportRunEqual(current.targetSettings, admitted.targetSettings))
      unavailable();
  };
  await assertNativeReady();
  context.signal.throwIfAborted();
  // The container's private /tmp is intentionally noexec. Stage the verified
  // compiler in the existing owner-only storage volume and remove each private
  // invocation directory immediately after execution.
  const executableTemporaryRoot = dirname(
    context.configuration.persistence.objectRoot,
  );
  const temporaryRootStat = await lstat(executableTemporaryRoot);
  if (
    !temporaryRootStat.isDirectory() ||
    temporaryRootStat.isSymbolicLink() ||
    (temporaryRootStat.mode & 0o077) !== 0 ||
    (process.getuid !== undefined && temporaryRootStat.uid !== process.getuid())
  )
    unavailable();
  const database = context.persistence.databases.export;
  const fenced = (purpose: "api" | "export") =>
    createProjectWriteFencedObjectStore({
      database: context.persistence.databases[purpose],
      storageNamespace: "documents",
      delegate: context.persistence.objectStore,
      ...(context.projectContentWriteHistory === undefined
        ? {}
        : { history: context.projectContentWriteHistory }),
    });
  const objects = fenced("export"),
    apiObjects = fenced("api");
  const tools = solutionRevisionToolSelectionsV1Schema.parse({
    compiler: {
      state: "pinned",
      tool: admitted.targetSettings.stageDescriptors.compiler.adapter,
    },
    diagramRenderer: {
      state: "pinned",
      tool: admitted.targetSettings.stageDescriptors.diagramRenderer.adapter,
    },
  });
  const requestReference = (
    request: Parameters<typeof assertProductionSolutionExportRequest>[0],
    ownership: { organizationId: string; projectId: string },
    principalId: string,
  ) =>
    selfHostNativeExportAdmissionReference({
      ownership,
      principalId,
      manifestDigest: request.subject.manifestDigest,
      targetSettingsDigest: request.targetSettings.digest,
      targetProfileId: request.targetProfileId,
      environment: request.environment,
    });
  const handlerOptions: DurableSolutionExportHandlerOptions = {
    fundingSource: "provider-direct",
    executionProfile: "cloudformation-infrastructure-only",
    database,
    objectStore: objects,
    compiler: {
      executor: createPinnedSolutionExportCompilerExecutor({
        ...settings.compiler,
        temporaryRoot: executableTemporaryRoot,
      }),
    },
    diagram: admitted.diagram,
    clock: { now: () => new Date() },
    assertRequestHostBinding: (request) => {
      assertProductionSolutionExportRequest(request, admitted.targetSettings);
      if (request.applicationSource !== undefined) unavailable();
    },
    assertCurrentStageAdmission: async ({ authority, prepared }) => {
      await authority.scope();
      await assertNativeReady();
      const submission = prepared.workflowSubmission;
      assertProductionSolutionExportRequest(
        submission.request,
        admitted.targetSettings,
      );
      if (
        submission.request.applicationSource !== undefined ||
        submission.entitlementDecisionReference !==
          requestReference(
            submission.request,
            authority.ownership,
            authority.identity.actorId,
          )
      )
        unavailable();
      await authority.scope();
    },
    readPreviousPackage: async (input, authority) => {
      if (input.previous === undefined) unavailable();
      const stored = await new PostgresSolutionExportDownloadRepository(
        authority,
        objects,
        authority,
        authority.ownership,
      ).getArtifact({
        ...authority.ownership,
        artifactId: input.previous.artifactId,
      });
      if (
        stored === null ||
        !exportRunEqual(stored.workflowPackage, input.previous)
      )
        unavailable();
      return stored.verifiedArtifact;
    },
  };
  const reportedWorkerFailures = new Set<string>();
  const polling = createSelfHostJobPoller({
    purpose: "export",
    database,
    family: "solution-export-orchestration",
    directPredicate: {
      column: "entitlement_decision_reference",
      prefix: PROVIDER_DIRECT_EXPORT_FUNDING_PREFIX_V1,
    },
    intervalMilliseconds: settings.pollIntervalMilliseconds,
    process: async (envelope, signal) => {
      signal.throwIfAborted();
      if (envelope.ownership.projectId === undefined) unavailable();
      const ownership = {
        organizationId: envelope.ownership.organizationId,
        projectId: envelope.ownership.projectId,
      };
      const audit = new ProductionSolutionExportAudit(database, ownership);
      const delivered = createSolutionExportDeliveredWorker({
        ...handlerOptions,
        audit,
        publisher: polling.publisher,
        workerId: "worker.self-host-export." + randomUUID(),
        diagnostics: ({ stage, outcome, reason }) => {
          if (outcome !== "failed") return;
          // Fixed vocabulary only: never print SQL, job IDs, tenant data or provider output.
          const category = `${stage}:${reason ?? "unclassified"}`;
          if (reportedWorkerFailures.has(category)) return;
          reportedWorkerFailures.add(category);
          process.stderr.write(`Standalone export worker ${category}\n`);
        },
      });
      await delivered.processEnvelope(envelope);
      await audit.flush();
    },
  });
  const handler = createDurableSolutionExportHandler(handlerOptions);
  const mutations = createProductionSolutionExportMutations({
    database: context.persistence.databases.api,
    objectStore: apiObjects,
    identity: context.identity,
    revisions: context.getApplication(),
    host: ({ principal, ownership }) =>
      Promise.resolve({
        fundingSource: "provider-direct",
        localRestrictedInsert: true,
        targetSettings: admitted.targetSettings,
        createDirectTargetPolicy: ({ authority, targetSettings }) => {
          if (!exportRunEqual(targetSettings, admitted.targetSettings))
            unavailable();
          return createSelfHostDirectExportTargetPolicy({
            authority,
            targetSettings,
            assertNativeReady,
          });
        },
        assertCurrentHostReady: async (actor, selectedOwnership) => {
          if (
            actor.principalId !== principal.principalId ||
            !exportRunEqual(selectedOwnership, ownership)
          )
            unavailable();
          await new SolutionExportRequestAuthority(
            context.persistence.databases.api,
            principal,
            ownership,
            "exports.run",
          ).scope();
          await assertNativeReady();
        },
        assertImmutableBindingSupported: (binding) => {
          assertProductionInfrastructureBinding(binding);
          if (
            binding.selectedTools === undefined ||
            !exportRunEqual(binding.selectedTools, tools)
          )
            throw new ApplicationError(
              "unsupported_version",
              "Save a revision with the configured export tools before exporting.",
            );
        },
        selectApplicationDelivery: selectProductionApplicationDelivery,
        handlers: {
          get: (family) => (family === handler.family ? handler : null),
        },
        ids: { nextId: (kind) => kind + "." + randomUUID() },
        audit: new ProductionSolutionExportAudit(
          context.persistence.databases.api,
          ownership,
        ),
        publisher: polling.publisher,
        entitlementForSelection: (selection) => ({
          evaluate: async (input) => {
            const selected = selection.initialRecord;
            if (
              input.family !== handler.family ||
              input.jobId !== selected.job.id ||
              input.context.actor.kind !== "principal" ||
              input.context.actor.actorId !== principal.principalId ||
              selection.createdByPrincipalId !== principal.principalId ||
              selection.organizationId !== ownership.organizationId ||
              selection.projectId !== ownership.projectId ||
              !exportRunEqual(input.context.ownership, ownership)
            )
              unavailable();
            assertProductionSolutionExportRequest(
              selected.workflowSubmission.request,
              admitted.targetSettings,
            );
            if (
              selected.workflowSubmission.request.applicationSource !==
              undefined
            )
              unavailable();
            await new SolutionExportRequestAuthority(
              context.persistence.databases.api,
              principal,
              ownership,
              "exports.run",
            ).scope();
            await assertNativeReady();
            const reference = requestReference(
              selected.workflowSubmission.request,
              ownership,
              principal.principalId,
            );
            if (
              selected.workflowSubmission.entitlementDecisionReference !==
              reference
            )
              unavailable();
            return { allowed: true, decisionReference: reference };
          },
        }),
      }),
  });
  const reads = createProductionSolutionExportReads({
    database: context.persistence.databases.api,
    objectStore: apiObjects,
    identity: context.identity,
  });
  return {
    fundingSource: "provider-direct",
    api: {
      solutionExports: {
        ...reads,
        ...mutations,
      },
      solutionExportCredits: {
        get: async (principal, projectId, jobId) => {
          // The same request-bound read first proves current project access
          // and existence; provider-direct exports never reserve paid credits.
          await reads.getJob(principal, projectId, jobId);
          return { contractVersion: 1, jobId, state: "not-metered" };
        },
      },
    },
    selectToolsForFreeze: async () => {
      await assertNativeReady();
      return tools;
    },
    exportCapabilities: runtimeExportCapabilitiesV1Schema.parse({
      schemaVersion: 1,
      exports: {
        targets: ["cloudformation"],
        workload: "infrastructure-only",
        maximumBytes: 4194304,
      },
    }),
    worker: polling.worker,
    assertReady: async () => {
      await assertNativeReady();
      const result = await database.query(
        sql(
          "SELECT pg_catalog.has_column_privilege(current_user,'public.solution_export_runs','solution_export_run_id','SELECT') AS allowed",
        ),
      );
      if (result.rowCount !== 1 || result.rows[0]?.["allowed"] !== true)
        unavailable();
    },
    close: () => Promise.resolve(), // Poller is separately owned; pools are borrowed.
  };
}
