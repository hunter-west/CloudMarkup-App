import {
  membershipIdSchema,
  organizationIdSchema,
  principalIdSchema,
} from "@cloudmarkup/api-contract";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlStatement,
} from "../adapters/persistence/sql.js";
import {
  assertSelfHostMigrationProfileReady,
  loadSelfHostMigrationProfile,
  SELF_HOST_PROFILE_ID,
  type SelfHostMigrationProfile,
} from "./migration-profile.js";

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const roles = ["administrator", "editor", "owner", "viewer"] as const;
const fields = [
  "principalId",
  "ownerDisplayName",
  "organizationId",
  "organizationDisplayName",
  "slug",
  "membershipId",
] as const;

export interface LocalOwnerSeedInput {
  readonly principalId: string;
  readonly ownerDisplayName: string;
  readonly organizationId: string;
  readonly organizationDisplayName: string;
  readonly slug: string;
  readonly membershipId: string;
}

export interface LocalOwnerSeedReceipt {
  readonly profileId: typeof SELF_HOST_PROFILE_ID;
  readonly sourceManifestSha256: string;
  readonly principalId: string;
  readonly organizationId: string;
  readonly membershipId: string;
}

export class LocalOwnerBootstrapError extends Error {
  readonly code = "local-owner-bootstrap-refused";
  constructor() {
    super("The standalone local owner could not be initialized.");
    this.name = "LocalOwnerBootstrapError";
  }
}

function refuse(): never {
  throw new LocalOwnerBootstrapError();
}

function displayName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    Array.from(value).length <= 120 &&
    !/\p{C}/u.test(value)
  );
}

export function parseLocalOwnerSeedInput(value: unknown): LocalOwnerSeedInput {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    refuse();
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    refuse();
  const input = value as Record<string, unknown>;
  const principalId = principalIdSchema.safeParse(input["principalId"]);
  const organizationId = organizationIdSchema.safeParse(
    input["organizationId"],
  );
  const membershipId = membershipIdSchema.safeParse(input["membershipId"]);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some(
      (key) => !fields.includes(key as (typeof fields)[number]),
    ) ||
    !principalId.success ||
    !organizationId.success ||
    !membershipId.success ||
    !displayName(input["ownerDisplayName"]) ||
    !displayName(input["organizationDisplayName"]) ||
    typeof input["slug"] !== "string" ||
    input["slug"].length > 80 ||
    !slug.test(input["slug"])
  )
    refuse();
  if (
    new Set([principalId.data, organizationId.data, membershipId.data]).size !==
    3
  )
    refuse();
  return Object.freeze({
    principalId: principalId.data,
    ownerDisplayName: input["ownerDisplayName"],
    organizationId: organizationId.data,
    organizationDisplayName: input["organizationDisplayName"],
    slug: input["slug"],
    membershipId: membershipId.data,
  });
}

function sameSource(
  supplied: unknown,
  current: SelfHostMigrationProfile,
): boolean {
  if (
    typeof supplied !== "object" ||
    supplied === null ||
    Array.isArray(supplied)
  )
    return false;
  const offered = supplied as Readonly<Record<string, unknown>>;
  const identity = offered["identity"];
  const migrations = offered["migrations"];
  if (
    typeof identity !== "object" ||
    identity === null ||
    Array.isArray(identity) ||
    !Array.isArray(migrations)
  )
    return false;
  const metadata = identity as Readonly<Record<string, unknown>>;
  if (
    metadata["profileId"] !== SELF_HOST_PROFILE_ID ||
    metadata["profileVersion"] !== 1 ||
    metadata["engineMajor"] !== 17 ||
    metadata["owner"] !== "cloudmarkup_admin" ||
    metadata["bootstrapGrantor"] !== "cloudmarkup_owner" ||
    metadata["manifestSha256"] !== current.identity.manifestSha256 ||
    metadata["canonicalManifestSha256"] !==
      current.identity.canonicalManifestSha256 ||
    metadata["identityChecksumSha256"] !==
      current.identity.identityChecksumSha256 ||
    metadata["privateReceiptChecksumSha256"] !==
      current.identity.privateReceiptChecksumSha256 ||
    migrations.length !== current.migrations.length
  )
    return false;
  const entries: readonly unknown[] = migrations;
  return Array.from(entries).every((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      return false;
    const row = entry as Readonly<Record<string, unknown>>;
    const expected = current.migrations.at(index);
    return (
      expected !== undefined &&
      row["version"] === expected.version &&
      row["file"] === expected.file &&
      row["checksumSha256"] === expected.checksumSha256
    );
  });
}

async function expectInserted(
  executor: SqlExecutor,
  statement: SqlStatement,
  column: string,
  expected: string,
): Promise<void> {
  const result = await executor.query(statement);
  if (
    result.rowCount !== 1 ||
    result.rows.length !== 1 ||
    result.rows.at(0)?.[column] !== expected
  )
    refuse();
}

/** Explicit migrator-only operation after the standalone PG17 profile is fully
 * installed. No API runtime, sign-in request, Cognito mapping, role creation,
 * grant activation, or demo project invokes this function. It deliberately
 * refuses any existing identity/workspace data instead of adopting it. */
export async function seedLocalOwnerWorkspace(
  database: SqlDatabase,
  profile: SelfHostMigrationProfile,
  inputValue: LocalOwnerSeedInput,
): Promise<LocalOwnerSeedReceipt> {
  const input = parseLocalOwnerSeedInput(inputValue);
  try {
    const current = await loadSelfHostMigrationProfile();
    if (!sameSource(profile, current)) refuse();
    return await database.transaction(async (tx) => {
      // READ COMMITTED gives the post-lock empty-state query a fresh snapshot.
      // SERIALIZABLE could retain a profile-read snapshot from before an
      // ordinary writer committed while this operation waited for the lock.
      await tx.query(sql("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"));
      await tx.query(
        sql("SET LOCAL search_path TO public, pg_catalog, pg_temp"),
      );
      await tx.query(sql("SET LOCAL row_security TO on"));
      // Share the canonical migration operator lock; never race a schema apply.
      await tx.query(sql("SELECT pg_advisory_xact_lock($1)", [21_000_000]));
      // The shared readiness checker also admits ordinary runtime logins.
      // Seeding is stricter: it must run as the actual admin login, without
      // an effective-role switch or a runtime pool standing in for the owner.
      const actor = await tx.query(
        sql(
          "SELECT session_user::text AS login,current_user::text AS effective_role",
        ),
      );
      if (
        actor.rowCount !== 1 ||
        actor.rows.length !== 1 ||
        actor.rows.at(0)?.["login"] !== "cloudmarkup_admin" ||
        actor.rows.at(0)?.["effective_role"] !== "cloudmarkup_admin"
      )
        refuse();
      // H's readiness checker uses only query(). Bind it to this already
      // locked transaction; any future use of transaction()/close() on the
      // assertion fails closed instead of silently opening another pool.
      await assertSelfHostMigrationProfileReady(tx as SqlDatabase, current);
      // Ordinary onboarding writers do not take the migration advisory lock.
      // Hold relation locks through the fresh empty-state read and every insert.
      await tx.query(
        sql(`LOCK TABLE public.principals, public.principal_identity_references,
          public.organizations, public.organization_roles, public.memberships
          IN SHARE ROW EXCLUSIVE MODE`),
      );

      const prior = await tx.query(
        sql(`SELECT
          EXISTS(SELECT 1 FROM public.principals) AS principals,
          EXISTS(SELECT 1 FROM public.principal_identity_references) AS identity_references,
          EXISTS(SELECT 1 FROM public.organizations) AS organizations,
          EXISTS(SELECT 1 FROM public.organization_roles) AS organization_roles,
          EXISTS(SELECT 1 FROM public.memberships) AS memberships`),
      );
      if (
        prior.rowCount !== 1 ||
        prior.rows.length !== 1 ||
        [
          "principals",
          "identity_references",
          "organizations",
          "organization_roles",
          "memberships",
        ].some((key) => prior.rows.at(0)?.[key] !== false)
      )
        refuse();

      await expectInserted(
        tx,
        sql(
          `INSERT INTO public.principals
            (principal_id,application_record_version,display_name,lifecycle_status)
           VALUES($1,1,$2,'active') RETURNING principal_id`,
          [input.principalId, input.ownerDisplayName],
        ),
        "principal_id",
        input.principalId,
      );
      await expectInserted(
        tx,
        sql(
          `INSERT INTO public.organizations
            (organization_id,storage_contract_version,display_name,slug,
             lifecycle_status,record_version,workspace_kind,personal_owner_principal_id)
           VALUES($1,1,$2,$3,'active',1,'personal',$4)
           RETURNING organization_id`,
          [
            input.organizationId,
            input.organizationDisplayName,
            input.slug,
            input.principalId,
          ],
        ),
        "organization_id",
        input.organizationId,
      );
      const insertedRoles = await tx.query(
        sql(
          `INSERT INTO public.organization_roles
            (organization_id,role_key,policy_version,is_owner,capabilities)
           SELECT $1,role.role_key,'authorization-v2',role.role_key='owner',
             public.cloudmarkup_authorization_v2_permissions(role.role_key)
           FROM (VALUES ('owner'),('administrator'),('editor'),('viewer')) AS role(role_key)
           RETURNING role_key`,
          [input.organizationId],
        ),
      );
      if (
        insertedRoles.rowCount !== roles.length ||
        insertedRoles.rows.length !== roles.length ||
        JSON.stringify(
          insertedRoles.rows.map((row) => row["role_key"]).sort(),
        ) !== JSON.stringify(roles)
      )
        refuse();
      await expectInserted(
        tx,
        sql(
          `INSERT INTO public.memberships
            (membership_id,organization_id,principal_id,role_key,
             lifecycle_status,record_version)
           VALUES($1,$2,$3,'owner','active',1) RETURNING membership_id`,
          [input.membershipId, input.organizationId, input.principalId],
        ),
        "membership_id",
        input.membershipId,
      );
      return Object.freeze({
        profileId: SELF_HOST_PROFILE_ID,
        sourceManifestSha256: current.identity.manifestSha256,
        principalId: input.principalId,
        organizationId: input.organizationId,
        membershipId: input.membershipId,
      });
    });
  } catch {
    // Operator output must not expose database/catalog details or configuration.
    refuse();
  }
}
