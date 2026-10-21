import { Pool, type PoolConfig } from "pg";
import { ApplicationError } from "../application/errors.js";

import {
  ObjectStoreError,
  RepositoryError,
  isObjectPurpose,
  type ObjectStore,
  type StoredObjectReference,
} from "../application/persistence.js";
import type { ProjectContentStoragePolicy } from "../adapters/persistence/project-content-cleanup.js";
import { DurableFilesystemObjectStore } from "../adapters/persistence/durable-filesystem-object-store.js";
import {
  OrdinaryRuntimeDatabase,
  type OrdinaryRuntimeHost,
} from "../adapters/persistence/ordinary-runtime-database.js";
import { PostgresDatabase } from "../adapters/persistence/postgres-driver.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "../adapters/persistence/sql.js";
import {
  ORDINARY_PERSISTENCE_PURPOSES,
  parseSelfHostPersistenceConfiguration,
  type PublicPersistenceConfiguration,
} from "./persistence-config.js";

function unavailable(): RepositoryError {
  return new RepositoryError(
    "persistence-unavailable",
    "The server persistence runtime is unavailable.",
  );
}

async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(unavailable());
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface PersistenceRuntimeReadiness {
  readonly state: "ready" | "unavailable" | "closed";
  /** Ready establishes filesystem capability and guarded connection identities;
   * it does not establish migrations, business ACL admission, or private pools. */
  readonly ordinaryPurposes: readonly OrdinaryRuntimeHost[];
}
export interface SelfHostPersistenceRuntime {
  readonly databases: Readonly<Record<OrdinaryRuntimeHost, SqlDatabase>>;
  readonly objectStore: ObjectStore &
    Pick<DurableFilesystemObjectStore, "initialize">;
  /** Concrete observed capability; absent injected runtimes cannot select cleanup. */
  readonly projectContentStoragePolicy?: ProjectContentStoragePolicy;
  readonly publicConfiguration: PublicPersistenceConfiguration;
  readiness(): PersistenceRuntimeReadiness;
  checkReadiness(): Promise<PersistenceRuntimeReadiness>;
  close(): Promise<void>;
}
export interface PersistenceRuntimeFactories {
  /** Ownership transfers on return. Return a fresh handle per purpose, with no
   * hidden shared pool. These are trusted server composition/test factories. */
  readonly database?: (
    purpose: OrdinaryRuntimeHost,
    config: PoolConfig,
    onUnavailable: () => void,
  ) => SqlDatabase;
  readonly objectStore?: (root: string) => DurableFilesystemObjectStore;
}

/** Five separately owned pools, never a role switch or an owner connection.
 * The existing guard remains around every repository transaction. Composition
 * can inject the handles directly into existing repositories. Factories may
 * substitute deterministic fixtures; those do not constitute PG admission. */
export async function createSelfHostPersistenceRuntime(
  input: unknown,
  factories: PersistenceRuntimeFactories = {},
): Promise<SelfHostPersistenceRuntime> {
  const config = parseSelfHostPersistenceConfiguration(input);
  const owned = new Set<Pick<SqlDatabase, "close">>();
  const guarded = {} as Record<OrdinaryRuntimeHost, SqlDatabase>;
  let state: PersistenceRuntimeReadiness["state"] = "unavailable";
  let closed = false;
  let closing: Promise<void> | undefined;
  let readinessCheck: Promise<PersistenceRuntimeReadiness> | undefined;
  let failures = 0;
  const activeStorage = new Set<Promise<unknown>>();
  // Read closure state after awaits; close() can run while readiness is pending.
  const isClosed = (): boolean => closed;
  const markUnavailable = () => {
    failures += 1;
    if (!closed) state = "unavailable";
  };
  const snapshot = (): PersistenceRuntimeReadiness =>
    Object.freeze({ state, ordinaryPurposes: ORDINARY_PERSISTENCE_PURPOSES });
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    closed = true;
    state = "closed";
    closing = bounded(
      Promise.allSettled(
        [...owned].map(async (database) => {
          await database.close();
        }),
      ).then(async (results) => {
        await Promise.allSettled([...activeStorage]);
        if (results.some((result) => result.status === "rejected"))
          throw unavailable();
      }),
      config.publicConfiguration.shutdownTimeoutMillis,
    );
    return closing;
  };
  const createDatabase: NonNullable<PersistenceRuntimeFactories["database"]> =
    factories.database ??
    ((_purpose, poolConfig, onUnavailable) => {
      const pool = new Pool(poolConfig);
      pool.on("error", onUnavailable);
      return new PostgresDatabase(pool);
    });
  try {
    for (const purpose of ORDINARY_PERSISTENCE_PURPOSES) {
      const database = createDatabase(
        purpose,
        config.poolConfiguration(purpose),
        markUnavailable,
      );
      if (owned.has(database)) throw unavailable();
      owned.add(database);
      const ordinary = new OrdinaryRuntimeDatabase(database, purpose);
      const safely = async <T>(work: () => Promise<T>): Promise<T> => {
        if (closed) throw unavailable();
        try {
          return await work();
        } catch (error) {
          // An expected application refusal is not itself a persistence outage.
          // Keep the original denial without overriding any pool failure;
          // infrastructure/unknown failures still withdraw admission below.
          if (
            error instanceof ApplicationError &&
            error.status >= 400 &&
            error.status < 500
          )
            throw error;
          if (
            error instanceof RepositoryError &&
            error.code !== "persistence-unavailable"
          )
            throw error;
          markUnavailable();
          throw unavailable();
        }
      };
      guarded[purpose] = Object.freeze({
        close,
        query: <TRow extends SqlRow = SqlRow>(
          statement: SqlStatement,
        ): Promise<SqlResult<TRow>> =>
          safely(() => ordinary.query<TRow>(statement)),
        transaction: <T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> =>
          safely(() => ordinary.transaction(work)),
      } satisfies SqlDatabase);
    }
    const createObjectStore: NonNullable<
      PersistenceRuntimeFactories["objectStore"]
    > =
      factories.objectStore ??
      ((root) => new DurableFilesystemObjectStore(root));
    const objectStore = createObjectStore(config.objectRoot());
    const storageFailure = (error: unknown): ObjectStoreError => {
      if (
        error instanceof ObjectStoreError &&
        error.code !== "storage-unavailable"
      )
        return error;
      markUnavailable();
      return error instanceof ObjectStoreError
        ? error
        : new ObjectStoreError(
            "storage-unavailable",
            "The local object storage is unavailable.",
          );
    };
    const storageAvailable = (): void => {
      if (closed)
        throw new ObjectStoreError(
          "storage-unavailable",
          "The local object storage is unavailable.",
        );
    };
    const safelyStorage = async <T>(work: () => Promise<T>): Promise<T> => {
      storageAvailable();
      const pending = Promise.resolve().then(work);
      activeStorage.add(pending);
      try {
        const result = await pending;
        storageAvailable();
        return result;
      } catch (error) {
        throw storageFailure(error);
      } finally {
        activeStorage.delete(pending);
      }
    };
    const projectContentStoragePolicy = Object.freeze({
      storageProvider: "filesystem",
      configurationSha256: objectStore.configurationSha256,
      assertReferenceCoverage: (tx, binding) =>
        safelyStorage(async () => {
          const observed = await tx.query(
            sql(
              `SELECT organization_id,project_id,object_id,storage_provider,object_purpose,
            storage_key,object_version,entity_tag,content_sha256,size_bytes,media_type
            FROM stored_objects WHERE organization_id=$1 AND project_id=$2
            ORDER BY object_id LIMIT 100001`,
              [binding.organizationId, binding.projectId],
            ),
          );
          if (
            observed.rows.length > 100_000 ||
            observed.rowCount !== observed.rows.length
          )
            throw new ObjectStoreError(
              "storage-unavailable",
              "Project references could not be verified.",
            );
          const references: StoredObjectReference[] = observed.rows.map(
            (row) => {
              const required = (key: string): string => {
                const value = row[key];
                if (typeof value !== "string")
                  throw new ObjectStoreError(
                    "storage-unavailable",
                    "Project references could not be verified.",
                  );
                return value;
              };
              const purpose = required("object_purpose");
              const size = row["size_bytes"];
              if (
                !isObjectPurpose(purpose) ||
                required("storage_provider") !== "filesystem" ||
                (typeof size !== "number" &&
                  (typeof size !== "string" ||
                    !/^(?:0|[1-9][0-9]*)$/u.test(size))) ||
                !Number.isSafeInteger(Number(size)) ||
                Number(size) < 0
              )
                throw new ObjectStoreError(
                  "storage-unavailable",
                  "Project references could not be verified.",
                );
              return {
                owner: {
                  organizationId: required("organization_id"),
                  projectId: required("project_id"),
                },
                objectId: required("object_id"),
                storageProvider: "filesystem",
                purpose,
                storageKey: required("storage_key"),
                objectVersion: required("object_version"),
                entityTag: required("entity_tag"),
                contentSha256: required("content_sha256"),
                mediaType: required("media_type"),
                sizeBytes: Number(size),
              };
            },
          );
          await objectStore.assertProjectReferenceCoverage(binding, references);
        }),
      erasePage: (binding, assertCurrentAuthority) =>
        safelyStorage(() =>
          objectStore.eraseProjectPage(binding, async () => {
            storageAvailable();
            await assertCurrentAuthority();
            storageAvailable();
          }),
        ),
    } satisfies ProjectContentStoragePolicy);
    const observedObjectStore = Object.freeze({
      initialize: () => safelyStorage(() => objectStore.initialize()),
      stage: (scope, input) =>
        safelyStorage(() => objectStore.stage(scope, input)),
      head: (scope, object) =>
        safelyStorage(() => objectStore.head(scope, object)),
      publish: (scope, object) =>
        safelyStorage(() => objectStore.publish(scope, object)),
      discardStaged: (scope, object) =>
        safelyStorage(() => objectStore.discardStaged(scope, object)),
      requestDeletion: (scope, object) =>
        safelyStorage(() => objectStore.requestDeletion(scope, object)),
      open: (scope, object) =>
        safelyStorage(async () => {
          const body = await objectStore.open(scope, object);
          return (async function* () {
            try {
              for await (const chunk of body) {
                storageAvailable();
                yield chunk;
              }
            } catch (error) {
              throw storageFailure(error);
            }
          })();
        }),
    } satisfies ObjectStore & Pick<DurableFilesystemObjectStore, "initialize">);
    const runReadinessCheck =
      async (): Promise<PersistenceRuntimeReadiness> => {
        if (closed) return snapshot();
        const startedFailures = failures;
        state = "unavailable";
        try {
          await bounded(
            (async () => {
              await observedObjectStore.initialize();
              await Promise.all(
                ORDINARY_PERSISTENCE_PURPOSES.map(async (purpose) => {
                  // Empty guarded work checks identity before/after on the same tx.
                  // No ad-hoc SQL is introduced into the closed statement inventory.
                  await guarded[purpose].transaction(() => Promise.resolve());
                }),
              );
            })(),
            config.publicConfiguration.readinessTimeoutMillis,
          );
          if (!isClosed() && failures === startedFailures) state = "ready";
        } catch {
          markUnavailable();
        }
        return snapshot();
      };
    const checkReadiness = (): Promise<PersistenceRuntimeReadiness> => {
      if (closed) return Promise.resolve(snapshot());
      readinessCheck ??= runReadinessCheck().finally(() => {
        readinessCheck = undefined;
      });
      return readinessCheck;
    };
    const runtime: SelfHostPersistenceRuntime = Object.freeze({
      databases: Object.freeze(guarded),
      objectStore: observedObjectStore,
      projectContentStoragePolicy,
      publicConfiguration: config.publicConfiguration,
      readiness: snapshot,
      checkReadiness,
      close,
    });
    if ((await checkReadiness()).state !== "ready") throw unavailable();
    return runtime;
  } catch {
    try {
      await close();
    } catch {
      /* Cleanup failure stays redacted, and all closes were attempted. */
    }
    throw unavailable();
  }
}
