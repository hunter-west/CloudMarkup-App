import { createHash } from "node:crypto";

import type {
  ExternalPrincipalReference,
  PrincipalDirectory,
} from "../../application/identity.js";
import type { SqlDatabase, SqlExecutor, SqlRow } from "../persistence/sql.js";
import { sql } from "../persistence/sql.js";

type PrincipalMappingRow = SqlRow & {
  readonly lifecycle_status: unknown;
  readonly principal_id: unknown;
};

interface BetaPrincipalIdentifiers {
  readonly identityReferenceId: string;
  readonly lockKey: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly slug: string;
  readonly suffix: string;
}

function stableIdentifiers(
  reference: ExternalPrincipalReference,
): BetaPrincipalIdentifiers {
  const identityDigest = createHash("sha256")
    .update(
      `${reference.provider}\u0000${reference.issuer}\u0000${reference.subject}`,
      "utf8",
    )
    .digest("hex");
  const suffix = identityDigest.slice(0, 32);
  return {
    identityReferenceId: `identity_beta_${suffix}`,
    lockKey: identityDigest,
    membershipId: `membership_beta_${suffix}`,
    organizationId: `org_beta_${suffix}`,
    principalId: `principal_beta_${suffix}`,
    slug: `beta-${suffix}`,
    suffix,
  };
}

async function findMapping(
  executor: SqlExecutor,
  reference: ExternalPrincipalReference,
): Promise<PrincipalMappingRow | undefined> {
  const result = await executor.query<PrincipalMappingRow>(
    sql(
      `SELECT p.principal_id, p.lifecycle_status
         FROM principal_identity_references AS identity_reference
         INNER JOIN principals AS p
           ON p.principal_id = identity_reference.principal_id
        WHERE identity_reference.identity_provider = $1
          AND identity_reference.issuer = $2
          AND identity_reference.subject_reference = $3
        LIMIT 1`,
      [reference.provider, reference.issuer, reference.subject],
    ),
  );
  return result.rows[0];
}

function activePrincipal(
  row: PrincipalMappingRow | undefined,
): { readonly principalId: string } | null | undefined {
  if (row === undefined) return undefined;
  return typeof row.principal_id === "string" &&
    row.lifecycle_status === "active"
    ? { principalId: row.principal_id }
    : null;
}

/**
 * Verified beta bootstrap boundary. A verified Cognito subject receives one personal
 * deterministic tenant; token claims never select an organization or role.
 */
export class BetaCognitoPrincipalDirectory implements PrincipalDirectory {
  readonly #database: SqlDatabase;
  readonly #issuer: string;

  constructor(options: {
    readonly database: SqlDatabase;
    readonly issuer: string;
  }) {
    let issuer: URL;
    try {
      issuer = new URL(options.issuer);
    } catch {
      throw new TypeError("The Cognito issuer is invalid.");
    }
    if (
      issuer.protocol !== "https:" ||
      issuer.username.length > 0 ||
      issuer.password.length > 0 ||
      issuer.search.length > 0 ||
      issuer.hash.length > 0 ||
      options.issuer !== issuer.toString().replace(/\/$/u, "")
    ) {
      throw new TypeError("The Cognito issuer is invalid.");
    }
    this.#database = options.database;
    this.#issuer = options.issuer;
  }

  async resolveActivePrincipal(
    reference: ExternalPrincipalReference,
  ): Promise<{ readonly principalId: string } | null> {
    const provider: unknown = reference.provider;
    if (
      provider !== "cognito" ||
      reference.issuer !== this.#issuer ||
      reference.subject.length === 0 ||
      reference.subject.length > 255
    ) {
      return null;
    }

    const existing = activePrincipal(
      await findMapping(this.#database, reference),
    );
    if (existing !== undefined) return existing;

    const identifiers = stableIdentifiers(reference);
    return this.#database.transaction(async (transaction) => {
      await transaction.query(
        sql("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          identifiers.lockKey,
        ]),
      );

      const afterLock = activePrincipal(
        await findMapping(transaction, reference),
      );
      if (afterLock !== undefined) return afterLock;

      await transaction.query(
        sql(
          `INSERT INTO principals (
             principal_id, application_record_version, display_name,
             lifecycle_status, created_at, updated_at
           ) VALUES ($1, 1, $2, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (principal_id) DO NOTHING`,
          [
            identifiers.principalId,
            `Beta user ${identifiers.suffix.slice(0, 8)}`,
          ],
        ),
      );
      await transaction.query(
        sql(
          `INSERT INTO organizations (
             organization_id, storage_contract_version, display_name, slug,
             lifecycle_status, record_version, created_at, updated_at, workspace_kind, personal_owner_principal_id
           ) VALUES ($1, 1, $2, $3, 'active', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'personal', $4)
           ON CONFLICT (organization_id) DO NOTHING`,
          [
            identifiers.organizationId,
            "Personal",
            identifiers.slug,
            identifiers.principalId,
          ],
        ),
      );
      await transaction.query(
        sql(
          `INSERT INTO organization_roles (
             organization_id, role_key, policy_version, is_owner,
             capabilities, created_at, updated_at
           )
           SELECT $1, canonical_role.role_key, 'authorization-v2',
                  canonical_role.role_key = 'owner',
                  cloudmarkup_authorization_v2_permissions(canonical_role.role_key),
                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
             FROM (VALUES ('owner'), ('administrator'), ('editor'), ('viewer'))
                    AS canonical_role(role_key)
           ON CONFLICT (organization_id, role_key) DO NOTHING`,
          [identifiers.organizationId],
        ),
      );
      await transaction.query(
        sql(
          `INSERT INTO memberships (
             membership_id, organization_id, principal_id, role_key,
             lifecycle_status, record_version, joined_at, updated_at
           ) VALUES ($1, $2, $3, 'owner', 'active', 1,
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (membership_id) DO NOTHING`,
          [
            identifiers.membershipId,
            identifiers.organizationId,
            identifiers.principalId,
          ],
        ),
      );
      await transaction.query(
        sql(
          `INSERT INTO principal_identity_references (
             identity_reference_id, principal_id, identity_provider, issuer,
             subject_reference, created_at
           ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
           ON CONFLICT (identity_provider, issuer, subject_reference) DO NOTHING`,
          [
            identifiers.identityReferenceId,
            identifiers.principalId,
            reference.provider,
            reference.issuer,
            reference.subject,
          ],
        ),
      );

      return activePrincipal(await findMapping(transaction, reference)) ?? null;
    });
  }
}
