import { resolve } from "node:path";
import { seedLocalProjects } from "../../local-development/local-seed.js";
import {
  applySelfHostMigrationProfile,
  assertSelfHostMigrationProfileReady,
  loadSelfHostMigrationProfile,
  SELF_HOST_PROFILE_ID,
} from "../../self-host/migration-profile.js";
import { FilesystemObjectStore } from "./filesystem-object-store.js";
import { runSeedFile } from "./migrations.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import { OrdinaryRuntimeDatabase } from "./ordinary-runtime-database.js";
import { sql, type SqlDatabase } from "./sql.js";

export interface LocalPersistenceConfiguration {
  readonly migratorUrl: string;
  readonly runtimeUrl: string;
  readonly objectRoot: string;
}

export function parseLocalPersistenceConfiguration(
  environment: NodeJS.ProcessEnv,
): LocalPersistenceConfiguration {
  if (
    environment["NODE_ENV"] === "production" ||
    environment["CLOUDMARKUP_RUNTIME_ENVIRONMENT"] !== "local" ||
    environment["CLOUDMARKUP_LOCAL_MIGRATION_PROFILE"] !== SELF_HOST_PROFILE_ID
  )
    throw new Error(
      "Local persistence requires the explicit standalone PG17 contributor profile.",
    );
  const parse = (value: string | undefined, user: string): URL => {
    let parsed: URL;
    try {
      if (!value) throw new Error();
      parsed = new URL(value);
    } catch {
      throw new Error("Local persistence database configuration is invalid.");
    }
    if (
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      parsed.hostname !== "127.0.0.1" ||
      parsed.username !== user ||
      parsed.pathname !== "/cloudmarkup" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      !/^[1-9][0-9]{3,4}$/u.test(parsed.port) ||
      Number(parsed.port) > 65535 ||
      parsed.password.length === 0
    )
      throw new Error(
        "Local persistence requires separate exact loopback purpose logins.",
      );
    return parsed;
  };
  const migrator = parse(
    environment["CLOUDMARKUP_LOCAL_MIGRATOR_DATABASE_URL"],
    "cloudmarkup_admin",
  );
  const runtime = parse(
    environment["CLOUDMARKUP_DATABASE_URL"],
    "cloudmarkup_beta_api_runtime",
  );
  const objectRoot = environment["CLOUDMARKUP_FILESYSTEM_OBJECT_ROOT"];
  if (migrator.port !== runtime.port || !objectRoot)
    throw new Error(
      "Local persistence requires one database target and an object root.",
    );
  return { migratorUrl: migrator.href, runtimeUrl: runtime.href, objectRoot };
}

/** Refuse existing end-user/hosted identities before applying synthetic fixtures.
 * Keep admission and relational writes under the same relation locks/transaction. */
export async function seedContributorSql(
  database: SqlDatabase,
  file: string,
  seed = runSeedFile,
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.query(
      sql(`LOCK TABLE public.principals,
      public.principal_identity_references,public.organizations,public.memberships
      IN SHARE ROW EXCLUSIVE MODE`),
    );
    const admission = await transaction.query(
      sql(`SELECT
      NOT EXISTS (SELECT 1 FROM public.principals WHERE principal_id NOT IN
        ('principal_local_owner','principal_local_team_owner',
         'principal_local_team_administrator','principal_local_team_editor','principal_local_team_viewer'))
      AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE (organization_id,slug) NOT IN
        (('org_local','local-cloudmarkup'),('org_local_team','local-cloudmarkup-team')))
      AND NOT EXISTS (SELECT 1 FROM public.principal_identity_references
        WHERE identity_provider <> 'local-development' OR issuer <> 'https://identity.example.test/local')
      AND NOT EXISTS (SELECT 1 FROM public.memberships WHERE membership_id NOT IN
        ('membership_local_owner','membership_local_team_owner',
         'membership_local_team_administrator','membership_local_team_editor','membership_local_team_viewer'))
      AS contributor_target`),
    );
    if (
      admission.rowCount !== 1 ||
      admission.rows[0]?.["contributor_target"] !== true
    )
      throw new Error("Contributor seed refuses non-fixture identity data.");
    const borrowed: SqlDatabase = {
      query: (statement) => transaction.query(statement),
      transaction: (work) => work(transaction),
      close: () => Promise.resolve(),
    };
    await seed(borrowed, file);
  });
}

function createDatabase(connectionString: string): SqlDatabase {
  return new PostgresDatabase({
    application_name: "cloudmarkup-local-persistence",
    connectionString,
    max: 2,
  });
}

/** The contributor's restricted API login needs the same guarded helper-lock
 * routing as the standalone/hosted ordinary runtime, never elevated grants. */
export function createLocalRuntimeDatabase(
  connectionString: string,
  factory: (connectionString: string) => SqlDatabase = createDatabase,
): SqlDatabase {
  return new OrdinaryRuntimeDatabase(factory(connectionString), "api");
}

const defaults = {
  createDatabase: (
    connectionString: string,
    purpose: "migrator" | "runtime",
  ): SqlDatabase =>
    purpose === "runtime"
      ? createLocalRuntimeDatabase(connectionString)
      : createDatabase(connectionString),
  loadProfile: loadSelfHostMigrationProfile,
  applyProfile: applySelfHostMigrationProfile,
  assertProfile: assertSelfHostMigrationProfileReady,
  seedSql: seedContributorSql,
  seedProjects: (database: SqlDatabase, objectRoot: string) =>
    seedLocalProjects({
      objectStore: new FilesystemObjectStore(objectRoot),
      repository: new PostgresCloudMarkupRepository(database),
    }),
};

/** Migrate and seed always select the same immutable PG17 installation.
 * Administrative seed SQL and ordinary object publication use different pools. */
export async function runLocalPersistenceCommand(
  command: "migrate" | "seed",
  configuration: LocalPersistenceConfiguration,
  apiDirectory: string,
  dependencies = defaults,
): Promise<number> {
  const profile = await dependencies.loadProfile();
  const migrator = dependencies.createDatabase(
    configuration.migratorUrl,
    "migrator",
  );
  try {
    await dependencies.applyProfile(migrator, profile);
    if (command === "seed")
      await dependencies.seedSql(
        migrator,
        resolve(apiDirectory, "seeds", "0001_local_development.sql"),
      );
  } finally {
    await migrator.close();
  }
  if (command === "migrate") return 0;
  const runtime = dependencies.createDatabase(
    configuration.runtimeUrl,
    "runtime",
  );
  try {
    await dependencies.assertProfile(runtime, profile);
    const projects = await dependencies.seedProjects(
      runtime,
      configuration.objectRoot,
    );
    return projects.length;
  } finally {
    await runtime.close();
  }
}
