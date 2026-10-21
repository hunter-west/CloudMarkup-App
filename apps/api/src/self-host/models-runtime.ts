import { z } from "zod";
import type {
  SelfHostConfiguration,
  SelfHostCredentialResolver,
} from "./configuration.js";
import type { SelfHostPersistenceRuntime } from "./persistence-runtime.js";
import type { LoadedMigration } from "../adapters/persistence/migrations.js";
import { sql, type SqlDatabase } from "../adapters/persistence/sql.js";
import {
  providerDirectQuotaV1Schema,
  PostgresProviderDirectInvocationJournalV1,
} from "../adapters/persistence/provider-direct-invocation-journal.js";
import { createSelfHostModelComposition } from "./model-composition.js";
import {
  RetainedProviderDirectDispatchFence,
  requireRetainedProviderDispatchSettings,
} from "./retained-provider-dispatch.js";

const policySettingsSchema = z
  .object({
    contractVersion: z.literal(1),
    quota: providerDirectQuotaV1Schema,
    statementTimeoutMilliseconds: z.number().int().min(1).max(30000),
    retainedDispatch: z.unknown(),
  })
  .strict();

function unavailable(): never {
  throw Error("The provider-direct runtime is unavailable.");
}

export const PROVIDER_DIRECT_SCHEMA_SHA256 =
  "d0b2c8383c24cc90e2ee0b0cf6f136323d7ab2cfe00dfafa197caa43dfa35b67";
export const PROVIDER_DIRECT_SCHEMA_VERSION = "0137";
export const PROVIDER_DIRECT_SCHEMA_FILE =
  "0137_provider_direct_usage_journal_definitions.sql";

export async function assertSelfHostProviderDirectSchema(
  database: SqlDatabase,
): Promise<void> {
  const result = await database.query(
    sql(`
    SELECT t.relrowsecurity AS row_security,t.relforcerowsecurity AS force_row_security,
      a.prosecdef AS protected_authority,
      owner.rolname='cloudmarkup_admin' AND owner.rolcanlogin AND owner.rolcreaterole
        AND NOT owner.rolsuper AND NOT owner.rolbypassrls AS safe_authority_owner,
      pg_catalog.has_table_privilege(current_user,t.oid,'SELECT') AS can_read,
      pg_catalog.has_table_privilege(current_user,t.oid,'INSERT') AS can_insert,
      NOT pg_catalog.has_table_privilege(current_user,t.oid,'DELETE') AND NOT pg_catalog.has_table_privilege(current_user,t.oid,'TRUNCATE') AS cannot_erase,
      pg_catalog.has_function_privilege(current_user,a.oid,'EXECUTE') AS can_authorize,
      NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(a.proacl,pg_catalog.acldefault('f',a.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS authority_not_public,
      (SELECT bool_and(pg_catalog.has_column_privilege(current_user,t.oid,cols.column_name,'UPDATE')) FROM unnest(ARRAY['state','usage_metadata','usage_sha256','outcome_metadata','outcome_sha256','uncertain_reason','revision','updated_at']) AS cols(column_name)) AS can_record,
      NOT pg_catalog.has_column_privilege(current_user,t.oid,'binding_metadata','UPDATE') AS binding_immutable,
      EXISTS(SELECT 1 FROM pg_catalog.pg_trigger trg WHERE trg.tgrelid=t.oid AND trg.tgname='provider_direct_transition_v1' AND trg.tgenabled='O' AND trg.tgfoid=pg_catalog.to_regprocedure('public.cloudmarkup_provider_direct_journal_transition_v1()')) AS transition_active
    FROM pg_catalog.pg_class t JOIN pg_catalog.pg_namespace namespace ON namespace.oid=t.relnamespace
    CROSS JOIN pg_catalog.pg_proc a JOIN pg_catalog.pg_roles owner ON owner.oid=a.proowner
    WHERE namespace.nspname='public' AND t.relname='provider_direct_invocations_v1'
      AND a.oid=pg_catalog.to_regprocedure('public.cloudmarkup_provider_direct_assert_authority_v1(varchar,varchar,varchar,varchar,varchar,integer,varchar,char,varchar,varchar)')
  `),
  );
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    result.rows.length !== 1 ||
    row === undefined ||
    [
      "row_security",
      "force_row_security",
      "protected_authority",
      "safe_authority_owner",
      "can_read",
      "can_insert",
      "cannot_erase",
      "can_authorize",
      "authority_not_public",
      "can_record",
      "binding_immutable",
      "transition_active",
    ].some((key) => row[key] !== true)
  )
    unavailable();
}

export interface SelfHostModelsRuntime {
  readonly models: ReturnType<typeof createSelfHostModelComposition>;
  readonly checkReadiness: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export async function createSelfHostModelsRuntime(options: {
  readonly configuration: SelfHostConfiguration;
  readonly persistence: SelfHostPersistenceRuntime;
  readonly migrations: readonly LoadedMigration[];
  readonly resolveCredential: SelfHostCredentialResolver;
  readonly signal: AbortSignal;
}): Promise<SelfHostModelsRuntime> {
  const { configuration, persistence, signal } = options;
  const configured = configuration.models;
  if (configured === null) unavailable();
  if (
    !options.migrations.some(
      (migration) =>
        migration.version === PROVIDER_DIRECT_SCHEMA_VERSION &&
        migration.file === PROVIDER_DIRECT_SCHEMA_FILE &&
        migration.checksumSha256 === PROVIDER_DIRECT_SCHEMA_SHA256,
    )
  )
    unavailable();
  const raw: unknown = JSON.parse(
    await options.resolveCredential(
      configured.policyConfigurationReference,
      signal,
    ),
  );
  signal.throwIfAborted();
  const settings = policySettingsSchema.parse(raw);
  if (
    settings.statementTimeoutMilliseconds >
    configured.journalCloseTimeoutMilliseconds
  )
    unavailable();
  const retained = requireRetainedProviderDispatchSettings(
    settings.retainedDispatch,
    configuration.persistence.objectRoot,
  );
  const fence = new RetainedProviderDirectDispatchFence(retained);
  const checkReadiness = async () => {
    await Promise.all([
      fence.assertReady(),
      assertSelfHostProviderDirectSchema(persistence.databases.proposal),
      assertSelfHostProviderDirectSchema(persistence.databases.export),
    ]);
  };
  const journals: PostgresProviderDirectInvocationJournalV1[] = [];
  try {
    await checkReadiness();
    signal.throwIfAborted();
    const createJournal = (purpose: "proposal" | "export") => {
      const journal = new PostgresProviderDirectInvocationJournalV1({
        database: persistence.databases[purpose],
        purpose,
        quota: settings.quota,
        statementTimeoutMilliseconds: settings.statementTimeoutMilliseconds,
        dispatchFence: fence,
      });
      journals.push(journal);
      return journal;
    };
    const models = createSelfHostModelComposition({
      fundingSource: "provider-direct",
      configuration: configured.configuration,
      journals: {
        proposal: createJournal("proposal"),
        export: createJournal("export"),
      },
      resolveCredential: (reference, currentSignal) => {
        if (reference !== configured.configuration.credentialReference)
          unavailable();
        return options.resolveCredential(reference, currentSignal);
      },
      maximumInFlightInvocations: configured.maximumInFlightInvocations,
      initiallyClosed: true,
    });
    return Object.freeze({
      models,
      checkReadiness,
      close: async () => {
        await models.close();
        await fence.close();
      },
    });
  } catch {
    await Promise.allSettled(journals.map((journal) => journal.close()));
    await fence.close();
    unavailable();
  }
}
