import { createSelfHostNativeExportAdapter } from "./native-export-adapter.js";
import {
  asyncJobQueueEnvelopeV1Schema,
  type AsyncJobQueueEnvelopeV1,
} from "@cloudmarkup/schemas";
import type { JobQueuePublisherV1 } from "@cloudmarkup/job-framework";
import { ApplicationError } from "../application/errors.js";
import { createBetaInfrastructureApplication } from "../application/beta-infrastructure.js";
import { betaProposalCommandPreparerV1 } from "../application/beta-proposal-command-preparer.js";
import { createBetaInfrastructureJobs } from "../application/beta-infrastructure-jobs.js";
import { createBetaInfrastructureWorker } from "../beta-infrastructure-worker.js";
import { createProviderDirectProposalGenerator } from "./provider-direct-proposal-generator.js";
import { PROVIDER_DIRECT_PROPOSAL_JOB_PREFIX_V1 } from "../application/provider-direct-proposal-funding.js";
import { ActiveProjectRequestAuthority } from "../adapters/persistence/solution-export-authority.js";
import { createBetaProposalBaselineReader } from "../adapters/persistence/beta-proposal-baseline-reader.js";
import { sql, type SqlDatabase } from "../adapters/persistence/sql.js";
import { createProjectWriteFencedObjectStore } from "../adapters/persistence/project-content-write-fence.js";
import type {
  SelfHostAdapterContext,
  SelfHostConfiguredAdapter,
  SelfHostManagedWorker,
  SelfHostRuntimeFactories,
} from "./runtime.js";
import { z } from "zod";

function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "The configured runtime adapter is unavailable.",
  );
}

/** Only a wake hint is volatile. Real persisted job records form the queue and
 * are rescanned on restart. Each shared worker still verifies current durable
 * ownership, attempt, input, funding and publication before it can dispatch.
 * Keyset pages include terminal jobs so committed outcomes/receipts can recover. */
export function createSelfHostJobPoller(options: {
  readonly purpose: "proposal" | "export";
  readonly database: SqlDatabase;
  readonly family: "architecture-proposal" | "solution-export-orchestration";
  readonly directPredicate: {
    readonly column: "job_id" | "entitlement_decision_reference";
    readonly prefix: string;
  };
  readonly intervalMilliseconds: number;
  readonly process: (
    envelope: AsyncJobQueueEnvelopeV1,
    signal: AbortSignal,
  ) => Promise<unknown>;
}): {
  readonly worker: SelfHostManagedWorker;
  readonly publisher: JobQueuePublisherV1;
} {
  if (
    !Number.isInteger(options.intervalMilliseconds) ||
    options.intervalMilliseconds < 100 ||
    options.intervalMilliseconds > 60000
  )
    unavailable();
  if (!/^[a-z][a-z0-9.-]+$/u.test(options.directPredicate.prefix))
    unavailable();
  if (
    !["job_id", "entitlement_decision_reference"].includes(
      options.directPredicate.column,
    ) ||
    (options.purpose === "proposal"
      ? options.family !== "architecture-proposal"
      : options.family !== "solution-export-orchestration")
  )
    unavailable();
  options = { ...options, directPredicate: { ...options.directPredicate } };
  let started = false,
    stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let cursor = "";
  const controller = new AbortController();
  const hasStopped = () => stopped;
  const schedule = (milliseconds: number) => {
    if (!started || stopped || timer !== undefined || active !== undefined)
      return;
    timer = setTimeout(() => {
      timer = undefined;
      void tick();
    }, milliseconds);
    timer.unref();
  };
  const tick = (): Promise<void> => {
    if (stopped || !started) return Promise.resolve();
    if (active !== undefined) return active;
    active = (async () => {
      const result = await options.database.query(
        sql(
          `SELECT job_id,organization_id,project_id,
        family,input_sha256,correlation_id,record_version,attempt_count,
        to_char(COALESCE((SELECT a.retry_not_before FROM async_job_attempts a
          WHERE a.organization_id=async_jobs.organization_id AND a.job_id=async_jobs.job_id
            AND a.attempt_number=async_jobs.attempt_count
            AND a.lifecycle_status IN ('failed','orphaned') AND a.retry_disposition='retry'),
          queued_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS available_at
        FROM async_jobs WHERE family=$1 AND parent_job_id IS NULL
          AND ${options.directPredicate.column} LIKE $2 AND job_id>$3
        ORDER BY job_id LIMIT 25`,
          [options.family, options.directPredicate.prefix + "%", cursor],
        ),
      );
      if (result.rows.length === 0) {
        cursor = "";
        return;
      }
      for (const row of result.rows) {
        if (hasStopped()) break;
        const envelope = asyncJobQueueEnvelopeV1Schema.parse({
          contractVersion: 1,
          jobId: row["job_id"],
          family: row["family"],
          ownership: {
            organizationId: row["organization_id"],
            projectId: row["project_id"],
          },
          inputDigest: "sha256:" + String(row["input_sha256"]),
          correlationId: row["correlation_id"],
          recordVersion: Number(row["record_version"]),
          attemptNumber: Number(row["attempt_count"]) + 1,
          availableAt: row["available_at"],
        });
        cursor = envelope.jobId;
        // Per-job refusal/uncertainty is durably owned by the shared worker;
        // one revoked/deleted tenant must not starve later authorized work.
        try {
          await options.process(envelope, controller.signal);
        } catch {
          /* Next durable scan can recover. */
        }
      }
    })()
      .catch(() => {
        /* Observed persistence marks query errors unavailable. */
      })
      .finally(() => {
        active = undefined;
        schedule(options.intervalMilliseconds);
      });
    return active;
  };
  const stopAdmissions = () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const drain = async () => {
    await active;
  };
  return {
    publisher: {
      contractVersion: 1,
      publish: (value) => {
        const envelope = asyncJobQueueEnvelopeV1Schema.parse(value);
        if (stopped || envelope.family !== options.family)
          return Promise.reject(
            new ApplicationError(
              "service_unavailable",
              "Job publication is unavailable.",
            ),
          );
        schedule(0);
        return Promise.resolve();
      },
    },
    worker: {
      purpose: options.purpose,
      start: () => {
        if (stopped) unavailable();
        started = true;
        schedule(0);
        return Promise.resolve();
      },
      stopAdmissions,
      cancel: () => {
        stopAdmissions();
        controller.abort();
      },
      drain,
      close: () => {
        closing ??= (async () => {
          stopAdmissions();
          controller.abort();
          await drain();
        })();
        return closing;
      },
    },
  };
}

export function createSelfHostProposalAdapter(
  context: SelfHostAdapterContext,
): SelfHostConfiguredAdapter {
  const settings = z
    .object({
      schemaVersion: z.literal(1),
      pollIntervalMilliseconds: z.number().int().min(100).max(60000),
    })
    .strict()
    .parse(context.privateSettings);
  const models = context.models;
  if (models === undefined) unavailable();
  const apiObjects = createProjectWriteFencedObjectStore({
    database: context.persistence.databases.api,
    storageNamespace: "documents",
    delegate: context.persistence.objectStore,
    ...(context.projectContentWriteHistory === undefined
      ? {}
      : { history: context.projectContentWriteHistory }),
  });
  const workerObjects = createProjectWriteFencedObjectStore({
    database: context.persistence.databases.proposal,
    storageNamespace: "documents",
    delegate: context.persistence.objectStore,
    ...(context.projectContentWriteHistory === undefined
      ? {}
      : { history: context.projectContentWriteHistory }),
  });
  const generate = createProviderDirectProposalGenerator({
    models,
    preparer: betaProposalCommandPreparerV1,
  });
  const proposals = createBetaInfrastructureApplication({
    application: context.getApplication(),
    // Preparation is shared business logic; the producer never dispatches.
    // An attempted jobless call fails instead of obtaining an ambient policy.
    model: () =>
      Promise.reject(
        new ApplicationError(
          "service_unavailable",
          "Generation requires a verified durable attempt.",
        ),
      ),
    applicability: {
      preparer: betaProposalCommandPreparerV1,
      forPrincipal: (principal, ownership) =>
        createBetaProposalBaselineReader({
          authority: new ActiveProjectRequestAuthority(
            context.persistence.databases.api,
            principal,
            ownership,
            "projects.mutate",
          ),
          objectStore: apiObjects,
        }),
    },
  });
  const polling = createSelfHostJobPoller({
    purpose: "proposal",
    database: context.persistence.databases.proposal,
    family: "architecture-proposal",
    directPredicate: {
      column: "job_id",
      prefix: PROVIDER_DIRECT_PROPOSAL_JOB_PREFIX_V1,
    },
    intervalMilliseconds: settings.pollIntervalMilliseconds,
    process: (envelope, signal) => {
      signal.throwIfAborted();
      return delivered.process(envelope);
    },
  });
  const delivered = createBetaInfrastructureWorker({
    fundingSource: "provider-direct",
    database: context.persistence.databases.proposal,
    objectStore: workerObjects,
    proposals,
    generateProviderDirect: generate,
    publisher: () => polling.publisher,
  });
  const jobs = createBetaInfrastructureJobs({
    fundingSource: "provider-direct",
    database: context.persistence.databases.api,
    objectStore: apiObjects,
    application: context.getApplication(),
    proposals,
    publisher: () => polling.publisher,
  });
  return {
    api: { betaInfrastructureJobs: jobs },
    fundingSource: "provider-direct",
    worker: polling.worker,
    assertReady: async () => {
      if (context.persistence.readiness().state !== "ready") unavailable();
      const result = await context.persistence.databases.proposal.query(
        sql(
          "SELECT pg_catalog.has_table_privilege(current_user,'public.async_jobs','SELECT') AS allowed",
        ),
      );
      if (result.rowCount !== 1 || result.rows[0]?.["allowed"] !== true)
        unavailable();
    },
    close: () => Promise.resolve(), // Poller is owned separately; pools/models are borrowed.
  };
}

/** Reviewed code references only; other integrations remain unconfigured. */
export function createSelfHostAdapterRegistry(): NonNullable<
  SelfHostRuntimeFactories["adapters"]
> {
  return Object.freeze({
    proposalJobs: {
      reference: "self-host.proposal-jobs-v1",
      create: (context: SelfHostAdapterContext) =>
        Promise.resolve(createSelfHostProposalAdapter(context)),
    },
    solutionExports: {
      reference: "self-host.solution-exports-v1",
      create: createSelfHostNativeExportAdapter,
    },
  });
}
