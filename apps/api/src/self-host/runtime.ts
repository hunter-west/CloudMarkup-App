import {
  createSelfHostModelsRuntime,
  type SelfHostModelsRuntime,
} from "./models-runtime.js";
import type { SelfHostModelComposition } from "./model-composition.js";
import { Hono } from "hono";
import { createSelfHostCoreAdapters } from "./core-adapters.js";
import {
  runtimeExportCapabilitiesV1Schema,
  runtimeAiCapabilitiesV1Schema,
  UNAVAILABLE_RUNTIME_AI_CAPABILITIES_V1,
  type RuntimeExportCapabilitiesV1,
} from "@cloudmarkup/api-contract";
import type { SelfHostCredentialResolver } from "./configuration.js";

import { createApp, type ApiDependencies } from "../app.js";
import {
  createCorrelationMiddleware,
  errorResponse,
  securityHeadersMiddleware,
  type ApiEnvironment,
  type ApiContext,
} from "../transport/http.js";
import { ApplicationError } from "../application/errors.js";
import type { CloudMarkupApplication } from "../application/ports.js";
import {
  ProductionIdentityApplication,
  productionIdentityOverrides,
} from "../application/production-identity-application.js";
import { createProductionRepositoryBackedApplication } from "../production-composition.js";
import type { CognitoTokenVerifier } from "../adapters/identity/cognito-jwt-principal-resolver.js";
import { PostgresCloudMarkupRepository } from "../adapters/persistence/repositories.js";
import { PostgresSolutionRecordRepository } from "../adapters/persistence/solution-record-repository.js";
import { PostgresAiIntentAcceptance } from "../adapters/persistence/ai-intent-acceptance.js";
import { PostgresProjectEditingLeases } from "../adapters/persistence/project-editing-leases.js";
import { PostgresAccountWorkspaces } from "../adapters/persistence/account-workspaces.js";
import { PostgresAccountProfile } from "../adapters/persistence/account-profile.js";
import { PostgresAccountPhoto } from "../adapters/persistence/account-photo.js";
import { PostgresOrganizationMembers } from "../adapters/persistence/organization-members.js";
import { PostgresOrganizationInvitationRepository } from "../adapters/persistence/organization-invitations.js";
import { PostgresStaffAccounts } from "../adapters/persistence/staff-accounts.js";
import { DeterministicValidationBridge } from "../adapters/persistence/deterministic-validation-bridge.js";
import { createHostedValidationOverrides } from "../adapters/persistence/hosted-validation.js";
import { createProjectWriteFencedObjectStore } from "../adapters/persistence/project-content-write-fence.js";
import type { LoadedMigration } from "../adapters/persistence/migrations.js";
import {
  loadSelfHostMigrationProfile,
  assertSelfHostMigrationProfileReady,
} from "./migration-profile.js";
import { sql, type SqlDatabase } from "../adapters/persistence/sql.js";
import { createProductionOrganizationInvitations } from "../production-organization-invitations.js";
import { createProductionAiIntentPreviewAcknowledgements } from "../production-ai-intent-preview-acknowledgements.js";
import { createProductionSolutionExportReads } from "../production-solution-export-reads.js";
import {
  createSelfHostPersistenceRuntime,
  type SelfHostPersistenceRuntime,
} from "./persistence-runtime.js";
import { ORDINARY_PERSISTENCE_PURPOSES } from "./persistence-config.js";
import {
  parseSelfHostConfiguration,
  SELF_HOST_ADAPTER_NAMES,
  type SelfHostAdapterName,
  type SelfHostConfiguration,
} from "./configuration.js";
import { randomUUID } from "node:crypto";
import type { CleanupHistoryPort } from "../application/project-cleanup-history.js";

export interface SelfHostManagedWorker {
  readonly purpose: "proposal" | "export" | "cleanup" | "billing";
  start(): Promise<void>;
  stopAdmissions(): void;
  cancel(): void;
  drain(): Promise<void>;
  close(): Promise<void>;
}
export interface SelfHostConfiguredAdapter {
  readonly projectContentWriteHistory?: CleanupHistoryPort;
  readonly api?: Partial<ApiDependencies>;
  readonly applicationOverrides?: Partial<CloudMarkupApplication>;
  readonly worker?: SelfHostManagedWorker;
  readonly fundingSource?: "provider-direct";
  readonly repositoryOptions?: Pick<
    NonNullable<ConstructorParameters<typeof PostgresCloudMarkupRepository>[1]>,
    "onProjectDeletionCommitted" | "cleanupWakeAdmission"
  >;
  readonly selectToolsForFreeze?: NonNullable<
    Parameters<
      typeof createProductionRepositoryBackedApplication
    >[1]["solutionRevisions"]
  >["selectToolsForFreeze"];
  readonly exportCapabilities?: RuntimeExportCapabilitiesV1;
  readonly applicationSourceV3?: boolean;
  assertReady(): Promise<void>;
  /** Only adapter-owned clients/leases; database handles are borrowed. */
  close(): Promise<void>;
}
export interface SelfHostAdapterContext {
  readonly projectContentWriteHistory?: CleanupHistoryPort;
  readonly configuration: SelfHostConfiguration;
  readonly signal: AbortSignal;
  readonly privateSettings: unknown;
  readonly resolveCredential: SelfHostCredentialResolver;
  readonly persistence: SelfHostPersistenceRuntime;
  readonly identity: ProductionIdentityApplication;
  readonly getApplication: () => CloudMarkupApplication;
  readonly models: SelfHostModelComposition | undefined;
}
export interface SelfHostRuntimeFactories {
  /** Factories are trusted production composition, not startup-file JS/module
   * selectors. Configured references must match an actually registered factory. */
  readonly adapters?: Partial<
    Record<
      SelfHostAdapterName,
      {
        readonly reference: string;
        create(
          context: SelfHostAdapterContext,
        ): Promise<SelfHostConfiguredAdapter>;
      }
    >
  >;
  readonly resolveCredential: SelfHostCredentialResolver;
  readonly persistence?: typeof createSelfHostPersistenceRuntime;
  readonly readMigrations?: () => Promise<readonly LoadedMigration[]>;
  readonly assertMigrationProfileReady?: (
    database: SqlDatabase,
  ) => Promise<void>;
  readonly tokenVerifier?: CognitoTokenVerifier;
}
export interface SelfHostShutdownObservation {
  readonly state: "closed" | "incomplete";
  readonly resourcesDisposed: boolean;
}
export interface SelfHostRuntime {
  readonly app: Hono<ApiEnvironment>;
  readonly configuration: Pick<
    SelfHostConfiguration,
    "server" | "shutdownGraceMilliseconds"
  >;
  adapterLedger(): readonly {
    readonly name: string;
    readonly state: "configured" | "unconfigured";
  }[];
  checkReadiness(): Promise<
    readonly { readonly name: string; readonly ready: boolean }[]
  >;
  stopAdmissions(): void;
  close(): Promise<SelfHostShutdownObservation>;
}

const adapterFields: Readonly<
  Record<SelfHostAdapterName, readonly (keyof ApiDependencies)[]>
> = {
  proposalJobs: ["betaInfrastructure", "betaInfrastructureJobs"],
  solutionExports: [
    "solutionExports",
    "solutionExportReads",
    "solutionExportCredits",
  ],
  projectCleanup: [],
  billing: ["billing", "billingWorkspace"],
  commercial: [],
  github: [
    "githubExports",
    "githubImports",
    "githubInstallationCallback",
    "githubWebhooks",
  ],
  gitlab: ["gitlabConnections", "gitlabExports"],
  continuousConformance: ["continuousConformance"],
};
const workerPurposes = {
  proposalJobs: "proposal",
  solutionExports: "export",
  projectCleanup: "cleanup",
  billing: "billing",
} as const;
const readinessAdapterName = (name: SelfHostAdapterName): string =>
  name.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
const closedExports: RuntimeExportCapabilitiesV1 = {
  schemaVersion: 1,
  exports: { targets: [], workload: null, maximumBytes: 4194304 },
};
function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "The configured self-host service is unavailable.",
  );
}
function unavailableApplication(): CloudMarkupApplication {
  return new Proxy(
    {},
    {
      get: () => () =>
        Promise.reject(
          new ApplicationError(
            "service_unavailable",
            "The requested service adapter is not configured.",
          ),
        ),
    },
  ) as CloudMarkupApplication;
}
async function within<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new ApplicationError(
              "service_unavailable",
              "The self-host operation did not complete within its bound.",
            ),
          );
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Verify the real installed canonical ledger; never create tables, run
 * migrations, switch roles, or accept a caller-supplied ready Boolean. */
export async function assertSelfHostSchema(
  database: SqlDatabase,
  migrations: readonly LoadedMigration[],
  expectedVersion: string,
): Promise<void> {
  if (migrations.length === 0 || migrations.at(-1)?.version !== expectedVersion)
    unavailable();
  const result = await database.query(
    sql("SELECT version, checksum_sha256 FROM cloudmarkup_schema_migrations"),
  );
  if (
    result.rowCount !== migrations.length ||
    result.rows.length !== migrations.length
  )
    unavailable();
  const seen = new Set<string>();
  for (const row of result.rows) {
    const version = row["version"];
    const checksum = row["checksum_sha256"];
    if (
      typeof version !== "string" ||
      seen.has(version) ||
      !migrations.some(
        (migration) =>
          migration.version === version &&
          migration.checksumSha256 === checksum,
      )
    )
      unavailable();
    seen.add(version);
  }
}

/** Shared API and services. Synthetic substitutes can be injected in tests;
 * production has no memory persistence, fake identity or no-op journal fallback.
 * Optional integrations keep the existing routes and honest unavailable states.
 * The registered job factories must use the current shared per-attempt funding
 * seam; source/key presence alone can never enable AI/export capabilities. */
export async function createSelfHostRuntime(
  raw: unknown,
  factories: SelfHostRuntimeFactories,
): Promise<SelfHostRuntime> {
  const configuration = parseSelfHostConfiguration(raw);
  if (
    (factories.readMigrations === undefined) !==
    (factories.assertMigrationProfileReady === undefined)
  )
    unavailable();
  // Refuse missing/mismatched factories before any credential acquisition.
  for (const name of SELF_HOST_ADAPTER_NAMES) {
    const binding = configuration.adapters[name];
    if (
      binding !== null &&
      factories.adapters?.[name]?.reference !== binding.adapterReference
    )
      unavailable();
  }
  let persistence: SelfHostPersistenceRuntime | undefined;
  let modelRuntime: SelfHostModelsRuntime | undefined;
  const adapters = new Map<SelfHostAdapterName, SelfHostConfiguredAdapter>();
  const workers = new Set<SelfHostManagedWorker>();
  const closedOwned = new Set<object>();
  const closeOwned = async (resource: { close(): Promise<void> }) => {
    if (closedOwned.has(resource)) return;
    closedOwned.add(resource);
    await resource.close();
  };
  const inFlightRequests = new Set<Promise<void>>();
  const pendingOperations = new Set<Promise<unknown>>();
  const startupController = new AbortController();
  const track = <T>(work: Promise<T>): Promise<T> => {
    pendingOperations.add(work);
    void work.then(
      () => pendingOperations.delete(work),
      () => pendingOperations.delete(work),
    );
    return work;
  };
  let accepting = false;
  let closing = false;
  const isClosing = () => closing;
  let ready = false;
  let admissionsStopped = false;
  let shutdown: Promise<SelfHostShutdownObservation> | undefined;
  let checking:
    | Promise<readonly { readonly name: string; readonly ready: boolean }[]>
    | undefined;
  let shutdownProblems = false;
  const safelyStop = (work: () => void) => {
    try {
      work();
    } catch {
      shutdownProblems = true;
    }
  };

  const stopAdmissions = () => {
    accepting = false;
    ready = false;
    if (admissionsStopped) return;
    admissionsStopped = true;
    if (modelRuntime !== undefined)
      safelyStop(() => modelRuntime?.models.stopAdmissions());
    for (const worker of workers)
      safelyStop(() => {
        worker.stopAdmissions();
      });
  };
  const close = (): Promise<SelfHostShutdownObservation> => {
    if (shutdown !== undefined) return shutdown;
    closing = true;
    startupController.abort();
    if (modelRuntime !== undefined)
      safelyStop(() => modelRuntime?.models.cancel());
    stopAdmissions();
    for (const worker of workers)
      safelyStop(() => {
        worker.cancel();
      });
    const dispose = (async (): Promise<SelfHostShutdownObservation> => {
      // A timed-out wait does not finish its underlying factory/readiness/SQL
      // operation. Keep borrowed resources alive until that actual work settles.
      await Promise.allSettled([...pendingOperations]);
      const drains = await Promise.allSettled([
        ...inFlightRequests,
        ...(modelRuntime === undefined ? [] : [modelRuntime.models.drain()]),
        ...(checking === undefined ? [] : [checking]),
        ...[...workers].map(async (worker) => {
          await worker.drain();
        }),
      ]);
      if (drains.some((result) => result.status === "rejected")) {
        // No confirmed outcome/recovery drain: keep journal/storage/pools alive.
        return { state: "incomplete", resourcesDisposed: false };
      }
      const closes = await Promise.allSettled(
        [...workers].map((worker) => closeOwned(worker)),
      );
      if (modelRuntime !== undefined) {
        try {
          await modelRuntime.close();
        } catch {
          return { state: "incomplete", resourcesDisposed: false };
        }
      }
      const adapterCloses = await Promise.allSettled(
        [...adapters.values()].map((adapter) => closeOwned(adapter)),
      );
      let poolsDisposed = false;
      try {
        await persistence?.close();
        poolsDisposed = true;
      } catch {
        /* Underlying Pool.end may still be running. */
      }
      return {
        state:
          !shutdownProblems &&
          poolsDisposed &&
          [...closes, ...adapterCloses].every(
            (result) => result.status === "fulfilled",
          )
            ? "closed"
            : "incomplete",
        resourcesDisposed:
          !shutdownProblems &&
          poolsDisposed &&
          [...closes, ...adapterCloses].every(
            (result) => result.status === "fulfilled",
          ),
      };
    })();
    // The work remains alive if this wait expires: do not forcibly dispose
    // persistence while an actual model/job/journal operation is still draining.
    shutdown = within(dispose, configuration.shutdownGraceMilliseconds).catch(
      () => ({ state: "incomplete" as const, resourcesDisposed: false }),
    );
    return shutdown;
  };
  try {
    const credentialSignal = AbortSignal.any([
      startupController.signal,
      AbortSignal.timeout(configuration.persistence.readinessTimeoutMillis),
    ]);
    const databases = Object.fromEntries(
      await within(
        track(
          Promise.all(
            ORDINARY_PERSISTENCE_PURPOSES.map(async (purpose) => {
              const { passwordReference, ...connection } =
                configuration.persistence.databases[purpose];
              const password = await factories.resolveCredential(
                passwordReference,
                credentialSignal,
              );
              return [purpose, { ...connection, password }] as const;
            }),
          ),
        ),
        configuration.persistence.readinessTimeoutMillis,
      ),
    );
    persistence = await (
      factories.persistence ?? createSelfHostPersistenceRuntime
    )({
      objectRoot: configuration.persistence.objectRoot,
      readinessTimeoutMillis: configuration.persistence.readinessTimeoutMillis,
      shutdownTimeoutMillis: configuration.persistence.shutdownTimeoutMillis,
      databases,
    });
    const ownedPersistence = persistence;
    let migrations: readonly LoadedMigration[];
    let assertProfileReady: (database: SqlDatabase) => Promise<void>;
    if (
      factories.readMigrations !== undefined &&
      factories.assertMigrationProfileReady !== undefined
    ) {
      migrations = await within(
        track(factories.readMigrations()),
        configuration.persistence.readinessTimeoutMillis,
      );
      assertProfileReady = factories.assertMigrationProfileReady;
    } else {
      const profile = await within(
        track(loadSelfHostMigrationProfile()),
        configuration.persistence.readinessTimeoutMillis,
      );
      migrations = profile.migrations;
      assertProfileReady = (database) =>
        assertSelfHostMigrationProfileReady(database, profile);
    }
    await within(
      track(
        assertSelfHostSchema(
          ownedPersistence.databases.api,
          migrations,
          configuration.persistence.expectedSchemaVersion,
        ),
      ),
      configuration.persistence.readinessTimeoutMillis,
    );
    const apiDatabase = ownedPersistence.databases.api;
    await within(
      track(
        Promise.all(
          ORDINARY_PERSISTENCE_PURPOSES.map((purpose) =>
            assertProfileReady(ownedPersistence.databases[purpose]),
          ),
        ),
      ),
      configuration.persistence.readinessTimeoutMillis,
    );
    if (configuration.models !== null) {
      await within(
        track(
          (async () => {
            modelRuntime = await createSelfHostModelsRuntime({
              configuration,
              persistence: ownedPersistence,
              migrations,
              resolveCredential: factories.resolveCredential,
              signal: credentialSignal,
            });
            // Ownership transfers even if the bounded startup wait already expired.
            // close waits for this actual factory before disposing borrowed handles.
            if (isClosing()) modelRuntime.models.cancel();
          })(),
        ),
        configuration.persistence.readinessTimeoutMillis,
      );
    }
    const identity = new ProductionIdentityApplication(apiDatabase, {
      organizationInvitations: true,
      githubConnections: configuration.adapters.github !== null,
      githubExports: configuration.adapters.github !== null,
      gitlabConnections: configuration.adapters.gitlab !== null,
      gitlabExports: configuration.adapters.gitlab !== null,
      nativeInfrastructureExports:
        configuration.adapters.solutionExports !== null,
    });
    let application: CloudMarkupApplication | undefined;
    const createAdapter = async (name: SelfHostAdapterName) => {
      const binding = configuration.adapters[name];
      if (binding === null) return;
      const signal = AbortSignal.any([
        startupController.signal,
        AbortSignal.timeout(configuration.persistence.readinessTimeoutMillis),
      ]);
      const work = track(
        (async () => {
          const registered = factories.adapters?.[name];
          if (registered === undefined) unavailable();
          const settingsText = await factories.resolveCredential(
            binding.configurationReference,
            signal,
          );
          signal.throwIfAborted();
          const privateSettings: unknown = JSON.parse(settingsText);
          const projectContentWriteHistory =
            adapters.get("projectCleanup")?.projectContentWriteHistory;
          const adapter = await registered.create({
            configuration,
            signal,
            privateSettings,
            resolveCredential: (reference, signal) => {
              if (!binding.credentialReferences.includes(reference))
                unavailable();
              return factories.resolveCredential(reference, signal);
            },
            identity,
            persistence: ownedPersistence,
            models: modelRuntime?.models,
            ...(projectContentWriteHistory === undefined
              ? {}
              : { projectContentWriteHistory }),
            getApplication: () => {
              if (application === undefined) unavailable();
              return application;
            },
          });
          // Transfer ownership before validation so every created resource is closed.
          if ([...adapters.values()].includes(adapter)) unavailable();
          adapters.set(name, adapter);
          if (
            adapter.projectContentWriteHistory !== undefined &&
            name !== "projectCleanup"
          )
            unavailable();
          if (adapter.worker !== undefined) {
            const repeated = workers.has(adapter.worker);
            workers.add(adapter.worker);
            if (closing) {
              safelyStop(() => adapter.worker?.stopAdmissions());
              safelyStop(() => adapter.worker?.cancel());
            }
            if (
              !(name in workerPurposes) ||
              adapter.worker.purpose !==
                workerPurposes[name as keyof typeof workerPurposes] ||
              repeated
            )
              unavailable();
          }
          if (
            adapter.api !== undefined &&
            Object.keys(adapter.api).some(
              (field) =>
                !adapterFields[name].includes(field as keyof ApiDependencies),
            )
          )
            unavailable();
          if (
            (name === "proposalJobs" ||
              name === "projectCleanup" ||
              name === "solutionExports") &&
            adapter.worker === undefined
          )
            unavailable();
          if (
            name === "proposalJobs" &&
            (modelRuntime === undefined ||
              adapter.fundingSource !== "provider-direct" ||
              adapter.api?.betaInfrastructureJobs === undefined)
          )
            unavailable();
          if (adapter.applicationSourceV3 === true) unavailable();
          if (
            name === "solutionExports" &&
            adapter.api?.solutionExports === undefined
          )
            unavailable();
          signal.throwIfAborted();
          await adapter.assertReady();
          signal.throwIfAborted();
        })(),
      );
      await within(work, configuration.persistence.readinessTimeoutMillis);
    };
    await createAdapter("projectCleanup");
    const projectContentWriteHistory =
      adapters.get("projectCleanup")?.projectContentWriteHistory;
    const objectStore = createProjectWriteFencedObjectStore({
      database: apiDatabase,
      storageNamespace: "documents",
      delegate: ownedPersistence.objectStore,
      ...(projectContentWriteHistory === undefined
        ? {}
        : { history: projectContentWriteHistory }),
    });
    const evidenceStore = createProjectWriteFencedObjectStore({
      database: apiDatabase,
      storageNamespace: "evidence",
      delegate: ownedPersistence.objectStore,
      ...(projectContentWriteHistory === undefined
        ? {}
        : { history: projectContentWriteHistory }),
    });
    const repository = new PostgresCloudMarkupRepository(apiDatabase, {
      draftEditingLeases: "required",
      ...adapters.get("projectCleanup")?.repositoryOptions,
    });
    const acceptedIntents = new PostgresAiIntentAcceptance({
      database: apiDatabase,
      repository,
      objectStore,
    });
    const overrides: Partial<CloudMarkupApplication> = {
      ...productionIdentityOverrides(identity),
      ...createHostedValidationOverrides({
        database: apiDatabase,
        documentStore: objectStore,
        reportStore: evidenceStore,
        repository,
        organizationForProject: (principal, projectId) =>
          identity.organizationForProject(principal, projectId),
      }),
      ...(configuration.adapters.projectCleanup === null
        ? {
            deleteProject: () =>
              Promise.reject(
                new ApplicationError(
                  "service_unavailable",
                  "The project cleanup adapter is not configured.",
                ),
              ),
          }
        : {}),
    };
    const composeApplication = () => {
      const selectToolsForFreeze =
        adapters.get("solutionExports")?.selectToolsForFreeze;
      return createProductionRepositoryBackedApplication(identity, {
        draftEditingLeases: "required",
        identifierNamespace: "self-host",
        repository,
        objectStore,
        fallback: unavailableApplication(),
        additionalOverrides: overrides,
        solutionRevisions: {
          acceptedIntents,
          solutionRecords: new PostgresSolutionRecordRepository(apiDatabase),
          validation: new DeterministicValidationBridge({
            database: apiDatabase,
            identifierNamespace: "self-host",
            repository,
            objectStore: evidenceStore,
          }),
          ...(selectToolsForFreeze === undefined
            ? {}
            : { selectToolsForFreeze }),
        },
      });
    };
    application = composeApplication();
    for (const name of [
      "commercial",
      "billing",
      "github",
      "gitlab",
      "continuousConformance",
      "solutionExports",
      "proposalJobs",
    ] as const) {
      if (configuration.adapters[name] === null) continue;
      await createAdapter(name);
      Object.assign(overrides, adapters.get(name)?.applicationOverrides);
      application = composeApplication();
    }
    const core = await within(
      track(
        createSelfHostCoreAdapters({
          configuration,
          database: apiDatabase,
          resolveCredential: factories.resolveCredential,
          signal: credentialSignal,
          ...(factories.tokenVerifier === undefined
            ? {}
            : { tokenVerifier: factories.tokenVerifier }),
        }),
      ),
      configuration.persistence.readinessTimeoutMillis,
    );
    const publicOrigin = configuration.server.publicOrigin;
    const accountOriginMode =
      configuration.identity.mode === "local-owner"
        ? "local-owner"
        : "hosted-cognito";
    const adapterApi: Partial<ApiDependencies> = {};
    for (const adapter of adapters.values())
      Object.assign(adapterApi, adapter.api);
    const exportAdapter = adapters.get("solutionExports");
    const exportCapabilities = runtimeExportCapabilitiesV1Schema.parse(
      exportAdapter?.exportCapabilities ?? closedExports,
    );
    const aiCapabilities = runtimeAiCapabilitiesV1Schema.parse({
      schemaVersion: 1,
      proposalVersions:
        adapters.has("proposalJobs") && modelRuntime !== undefined ? [6] : [],
      applicationSources: [],
    });
    const isReady = () =>
      ready &&
      accepting &&
      !closing &&
      ownedPersistence.readiness().state === "ready";
    const runChecks = async (signal: AbortSignal) => {
      const withdrawn = () => closing || signal.aborted;
      const checks: { name: string; ready: boolean }[] = [];
      if (withdrawn()) {
        ready = false;
        return [{ name: "admission", ready: false }];
      }
      try {
        checks.push({
          name: "persistence",
          ready: (await ownedPersistence.checkReadiness()).state === "ready",
        });
      } catch {
        checks.push({ name: "persistence", ready: false });
      }
      if (withdrawn()) {
        ready = false;
        return [{ name: "admission", ready: false }];
      }
      try {
        await assertSelfHostSchema(
          apiDatabase,
          migrations,
          configuration.persistence.expectedSchemaVersion,
        );
        await Promise.all(
          ORDINARY_PERSISTENCE_PURPOSES.map((purpose) =>
            assertProfileReady(ownedPersistence.databases[purpose]),
          ),
        );
        await core.assertReady();
        checks.push({ name: "schema", ready: true });
      } catch {
        checks.push({ name: "schema", ready: false });
      }
      if (withdrawn()) {
        ready = false;
        return [{ name: "admission", ready: false }];
      }
      if (modelRuntime !== undefined) {
        try {
          await modelRuntime.checkReadiness();
          checks.push({ name: "provider-direct-journal", ready: true });
        } catch {
          checks.push({ name: "provider-direct-journal", ready: false });
        }
      }
      for (const [name, adapter] of adapters) {
        if (withdrawn()) break;
        try {
          await adapter.assertReady();
          checks.push({ name: readinessAdapterName(name), ready: true });
        } catch {
          checks.push({ name: readinessAdapterName(name), ready: false });
        }
      }
      ready =
        !withdrawn() &&
        ownedPersistence.readiness().state === "ready" &&
        checks.every((check) => check.ready);
      return Object.freeze([
        { name: "admission", ready: !withdrawn() && accepting && ready },
        ...checks,
      ]);
    };
    const checkReadiness = () => {
      if (closing)
        return Promise.resolve([{ name: "admission", ready: false }]);
      checking ??= within(
        track(
          runChecks(
            AbortSignal.timeout(
              configuration.persistence.readinessTimeoutMillis,
            ),
          ),
        ),
        configuration.persistence.readinessTimeoutMillis,
      )
        .catch(() => {
          ready = false;
          return [{ name: "admission", ready: false }];
        })
        .finally(() => {
          checking = undefined;
        });
      return checking;
    };
    const inner = createApp({
      ...adapterApi,
      application,
      ...core.api,
      runtimeAiCapabilities: aiCapabilities,
      runtimeExportCapabilities: exportCapabilities,
      readiness: { check: checkReadiness },
      accountProfile: {
        publicOrigin,
        mode: accountOriginMode,
        application: new PostgresAccountProfile(apiDatabase),
      },
      accountPhoto: {
        publicOrigin,
        mode: accountOriginMode,
        application: new PostgresAccountPhoto(apiDatabase),
      },
      accountWorkspaces: {
        publicOrigin,
        mode: accountOriginMode,
        application: new PostgresAccountWorkspaces(apiDatabase),
      },
      organizationMembers: {
        publicOrigin,
        mode: accountOriginMode,
        application: new PostgresOrganizationMembers(apiDatabase),
      },
      organizationInvitations:
        createProductionOrganizationInvitations(apiDatabase),
      recipientOrganizationInvitations: {
        publicOrigin,
        mode: accountOriginMode,
        application: new PostgresOrganizationInvitationRepository(apiDatabase),
      },
      staffAccounts: {
        publicOrigin,
        mode: accountOriginMode,
        application: new PostgresStaffAccounts(apiDatabase),
      },
      projectEditingLeases: new PostgresProjectEditingLeases(apiDatabase),
      aiIntentAcceptance: acceptedIntents,
      aiIntentPreviewAcknowledgements:
        createProductionAiIntentPreviewAcknowledgements(apiDatabase),
      solutionExportReads:
        adapterApi.solutionExportReads ??
        createProductionSolutionExportReads({
          database: apiDatabase,
          objectStore,
          identity,
        }),
    });
    const app = new Hono<ApiEnvironment>();
    app.use(
      "*",
      createCorrelationMiddleware(() => randomUUID()),
    );
    app.use("*", securityHeadersMiddleware());
    app.use("*", async (context: ApiContext, next) => {
      if (context.req.path === "/health" || context.req.path === "/ready")
        return next();
      if (context.req.path === "/runtime-config" && !isReady()) {
        const views = context.req.queries("view");
        if (views?.length === 1 && views[0] === "ai") {
          context.header("Cache-Control", "no-store");
          return context.json(UNAVAILABLE_RUNTIME_AI_CAPABILITIES_V1);
        }
        if (views?.length === 1 && views[0] === "exports") {
          context.header("Cache-Control", "no-store");
          return context.json(closedExports);
        }
      }
      if (
        !isReady() ||
        inFlightRequests.size >= configuration.server.maximumInFlightRequests
      ) {
        return errorResponse(
          context,
          new ApplicationError(
            "service_unavailable",
            "The self-host API is temporarily unavailable.",
          ),
        );
      }
      let finish: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      inFlightRequests.add(pending);
      try {
        await next();
      } finally {
        finish?.();
        inFlightRequests.delete(pending);
      }
    });
    app.route("/", inner);
    accepting = true;
    if (!(await checkReadiness()).every((check) => check.ready)) unavailable();
    modelRuntime?.models.startAdmissions();
    for (const worker of workers)
      await within(
        track(worker.start()),
        configuration.persistence.readinessTimeoutMillis,
      );
    return Object.freeze({
      app,
      configuration: {
        server: configuration.server,
        shutdownGraceMilliseconds: configuration.shutdownGraceMilliseconds,
      },
      adapterLedger: () =>
        Object.freeze(
          SELF_HOST_ADAPTER_NAMES.map((name) => ({
            name,
            state: adapters.has(name)
              ? ("configured" as const)
              : ("unconfigured" as const),
          })),
        ),
      checkReadiness,
      stopAdmissions,
      close,
    });
  } catch {
    await close();
    throw new ApplicationError(
      "service_unavailable",
      "The self-host runtime could not be admitted.",
    );
  }
}
