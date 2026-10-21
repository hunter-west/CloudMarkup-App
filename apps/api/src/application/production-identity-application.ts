import {
  currentPrincipalV1Schema,
  membershipV1Schema,
  organizationV1Schema,
  type CurrentPrincipalV1,
  type MembershipV1,
  type OrganizationV1,
} from "@cloudmarkup/api-contract";

import type { SqlDatabase, SqlRow } from "../adapters/persistence/sql.js";
import { sql } from "../adapters/persistence/sql.js";
import {
  isOrganizationRole,
  permissionsForRole,
  type OrganizationPermission,
  type OrganizationRole,
} from "./authorization.js";
import { ApplicationError } from "./errors.js";
import type {
  CloudMarkupApplication,
  PageOptions,
  PageResult,
  PrincipalContext,
  VersionedResult,
} from "./ports.js";
import { parseDatabaseTimestamp } from "../adapters/persistence/database-timestamp.js";

type ProductionIdentityOverrides = Pick<
  CloudMarkupApplication,
  | "getCurrentPrincipal"
  | "getOrganization"
  | "listMemberships"
  | "listOrganizations"
>;

const BETA_ROLE_CAPABILITIES: Readonly<
  Record<OrganizationRole, readonly OrganizationPermission[]>
> = {
  administrator: [
    "artifacts.read",
    "commercial.summary.read",
    "organizations.read",
    "memberships.read",
    "projects.read",
    "projects.create",
    "projects.mutate",
    "projects.delete",
    "environments.create",
    "revisions.create",
    "validation.run",
  ],
  editor: [
    "artifacts.read",
    "commercial.summary.read",
    "organizations.read",
    "projects.read",
    "projects.create",
    "projects.mutate",
    "environments.create",
    "revisions.create",
    "validation.run",
  ],
  owner: [
    "artifacts.read",
    "commercial.summary.read",
    "organizations.read",
    "memberships.read",
    "projects.read",
    "projects.create",
    "projects.mutate",
    "projects.delete",
    "environments.create",
    "revisions.create",
    "validation.run",
  ],
  viewer: [
    "artifacts.read",
    "commercial.summary.read",
    "organizations.read",
    "projects.read",
  ],
};

/** Server-composed service availability, not caller-supplied permissions. */
export interface ProductionIdentityFeatures {
  readonly githubConnections?: boolean;
  readonly gitlabConnections?: boolean;
  readonly githubExports?: boolean;
  readonly gitlabExports?: boolean;
  readonly nativeInfrastructureExports?: boolean;
  readonly organizationInvitations?: boolean;
}

export function betaCapabilitiesForRole(
  role: OrganizationRole,
  features: ProductionIdentityFeatures = {},
): readonly OrganizationPermission[] {
  const base = BETA_ROLE_CAPABILITIES[role];
  return [
    ...base,
    ...(features.githubExports === true ||
    features.gitlabExports === true ||
    features.nativeInfrastructureExports === true
      ? (["exports.run"] as const)
      : []),
    ...(features.githubConnections === true ||
    features.gitlabConnections === true
      ? (["integrations.read", "integrations.manage"] as const)
      : []),
    ...(features.organizationInvitations === true
      ? (["memberships.manage"] as const)
      : []),
  ].filter((permission) => permissionsForRole(role).includes(permission));
}

type PrincipalRow = SqlRow & {
  readonly display_name: unknown;
  readonly email: unknown;
  readonly principal_id: unknown;
};

type OrganizationContextRow = SqlRow & {
  readonly workspace_kind?: unknown;
  readonly membership_id: unknown;
  readonly organization_id: unknown;
  readonly role_key: unknown;
};

type OrganizationRow = SqlRow & {
  readonly created_at: unknown;
  readonly deletion_requested_at: unknown;
  readonly display_name: unknown;
  readonly lifecycle_status: unknown;
  readonly organization_id: unknown;
  readonly record_version: unknown;
  readonly slug: unknown;
};

type MembershipRow = SqlRow & {
  readonly display_name: unknown;
  readonly joined_at: unknown;
  readonly lifecycle_status: unknown;
  readonly membership_id: unknown;
  readonly organization_id: unknown;
  readonly principal_id: unknown;
  readonly role_key: unknown;
};

function readString(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Date) return value.toISOString();
  throw new ApplicationError(
    "service_unavailable",
    "The account directory is temporarily unavailable.",
  );
}

function readOptionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : readString(value);
}

function readTimestamp(value: unknown): string {
  const parsed = parseDatabaseTimestamp(value);
  if (parsed === undefined) {
    throw new ApplicationError(
      "service_unavailable",
      "The account directory is temporarily unavailable.",
    );
  }
  return parsed;
}

function readNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ApplicationError(
      "service_unavailable",
      "The account directory is temporarily unavailable.",
    );
  }
  return parsed;
}

function readRole(value: unknown): OrganizationRole {
  const role = readString(value);
  if (!isOrganizationRole(role)) {
    throw new ApplicationError(
      "service_unavailable",
      "The account directory is temporarily unavailable.",
    );
  }
  return role;
}

function etag(id: string, version: number): string {
  return `"organization:${id}:v${String(version)}"`;
}

function requirePermission(
  role: OrganizationRole,
  permission: OrganizationPermission,
): void {
  if (!betaCapabilitiesForRole(role).includes(permission)) {
    throw new ApplicationError(
      "access_denied",
      "This action is not available for the current account.",
    );
  }
}

function page<T>(values: readonly T[], options: PageOptions): PageResult<T> {
  const offset = pageOffset(options.cursor);
  if (offset > values.length) {
    throw new ApplicationError(
      "invalid_request",
      "The page cursor is invalid.",
    );
  }
  const items = values.slice(offset, offset + options.limit);
  const nextOffset = offset + items.length;
  return {
    items,
    ...(nextOffset < values.length
      ? { nextCursor: `beta-offset-${String(nextOffset)}` }
      : {}),
  };
}

function pageOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = /^beta-offset-([0-9]+)$/u.exec(cursor);
  const offset = match === null ? -1 : Number.parseInt(match[1] ?? "", 10);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ApplicationError(
      "invalid_request",
      "The page cursor is invalid.",
    );
  }
  return offset;
}

function membershipOrderBy(sort: PageOptions["sort"]): string {
  switch (sort) {
    case undefined:
    case "joinedAt":
      return "m.joined_at ASC, m.membership_id ASC";
    case "-joinedAt":
      return "m.joined_at DESC, m.membership_id DESC";
    case "displayName":
      return "p.display_name ASC, m.membership_id ASC";
    case "-displayName":
      return "p.display_name DESC, m.membership_id DESC";
    default:
      throw new ApplicationError(
        "invalid_request",
        "The membership sort is invalid.",
      );
  }
}

function mapOrganization(row: OrganizationRow): OrganizationV1 {
  const deletionRequestedAt =
    row.deletion_requested_at === null ||
    row.deletion_requested_at === undefined
      ? undefined
      : readTimestamp(row.deletion_requested_at);
  return organizationV1Schema.parse({
    createdAt: readTimestamp(row.created_at),
    ...(deletionRequestedAt === undefined ? {} : { deletionRequestedAt }),
    displayName: readString(row.display_name),
    id: readString(row.organization_id),
    lifecycleStatus: readString(row.lifecycle_status),
    slug: readString(row.slug),
    version: readNumber(row.record_version),
  });
}

/** Production account and tenant reads, always filtered by verified principal. */
export class ProductionIdentityApplication implements ProductionIdentityOverrides {
  readonly #database: SqlDatabase;
  readonly #features: Readonly<Required<ProductionIdentityFeatures>>;

  constructor(
    database: SqlDatabase,
    features: ProductionIdentityFeatures = {},
  ) {
    this.#database = database;
    this.#features = Object.freeze({
      githubConnections: features.githubConnections === true,
      gitlabConnections: features.gitlabConnections === true,
      githubExports: features.githubExports === true,
      gitlabExports: features.gitlabExports === true,
      nativeInfrastructureExports:
        features.nativeInfrastructureExports === true,
      organizationInvitations: features.organizationInvitations === true,
    });
  }

  async organizationForRequestedScope(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<string | null> {
    const result = await this.#database.query<OrganizationContextRow>(
      sql(
        `SELECT m.organization_id, m.membership_id, m.role_key
           FROM memberships AS m
           INNER JOIN organizations AS o
             ON o.organization_id = m.organization_id
            AND o.lifecycle_status = 'active'
           INNER JOIN principals AS p
             ON p.principal_id = m.principal_id
            AND p.lifecycle_status = 'active'
           INNER JOIN organization_roles AS r
             ON r.organization_id = m.organization_id
            AND r.role_key = m.role_key
            AND r.policy_version = 'authorization-v2'
          WHERE m.principal_id = $1
            AND m.organization_id = $2
            AND m.lifecycle_status = 'active'
          ORDER BY m.membership_id
          LIMIT 2`,
        [principal.principalId, organizationId],
      ),
    );
    if (result.rows.length !== 1) return null;
    readRole(result.rows[0]?.role_key);
    const resolvedOrganizationId = readString(result.rows[0]?.organization_id);
    return resolvedOrganizationId === organizationId
      ? resolvedOrganizationId
      : null;
  }

  async organizationForProject(
    principal: PrincipalContext,
    projectId: string,
  ): Promise<string | null> {
    const result = await this.#database.query<OrganizationContextRow>(
      sql(
        `SELECT m.organization_id, m.membership_id, r.role_key
           FROM projects AS project
           INNER JOIN organizations AS o
             ON o.organization_id = project.organization_id
            AND o.lifecycle_status = 'active'
           INNER JOIN memberships AS m
             ON m.organization_id = project.organization_id
            AND m.lifecycle_status = 'active'
           INNER JOIN principals AS p
             ON p.principal_id = m.principal_id
            AND p.lifecycle_status = 'active'
           INNER JOIN organization_roles AS r
             ON r.organization_id = m.organization_id
            AND r.role_key = m.role_key
            AND r.policy_version = 'authorization-v2'
          WHERE m.principal_id = $1
            AND project.project_id = $2
          ORDER BY m.membership_id
          LIMIT 2`,
        [principal.principalId, projectId],
      ),
    );
    if (result.rows.length !== 1) return null;
    readRole(result.rows[0]?.role_key);
    return readString(result.rows[0]?.organization_id);
  }

  async getCurrentPrincipal(
    principal: PrincipalContext,
  ): Promise<CurrentPrincipalV1> {
    const principalResult = await this.#database.query<PrincipalRow>(
      sql(
        `SELECT principal_id, display_name, email
           FROM principals
          WHERE principal_id = $1
            AND lifecycle_status = 'active'
          LIMIT 1`,
        [principal.principalId],
      ),
    );
    const record = principalResult.rows[0];
    if (record === undefined) {
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    }
    const contexts = await this.#database.query<OrganizationContextRow>(
      sql(
        `SELECT m.membership_id, m.organization_id, r.role_key, o.workspace_kind
           FROM memberships AS m
           INNER JOIN organizations AS o
             ON o.organization_id = m.organization_id
            AND o.lifecycle_status = 'active'
           INNER JOIN organization_roles AS r
             ON r.organization_id = m.organization_id
            AND r.role_key = m.role_key
            AND r.policy_version = 'authorization-v2'
          WHERE m.principal_id = $1
            AND m.lifecycle_status = 'active'
          ORDER BY m.organization_id`,
        [principal.principalId],
      ),
    );
    const email = readOptionalString(record.email);
    return currentPrincipalV1Schema.parse({
      displayName: readString(record.display_name),
      ...(email === undefined ? {} : { email }),
      id: readString(record.principal_id),
      organizationContexts: contexts.rows.map((context) => {
        const role = readRole(context.role_key);
        return {
          capabilities: betaCapabilitiesForRole(role, this.#features).filter(
            (permission) =>
              context.workspace_kind !== "personal" ||
              (!permission.startsWith("memberships.") &&
                permission !== "organizations.delete"),
          ),
          isOwner: role === "owner",
          membershipId: readString(context.membership_id),
          organizationId: readString(context.organization_id),
          role,
        };
      }),
      resourceVersion: 1,
    });
  }

  async listOrganizations(
    principal: PrincipalContext,
    options: PageOptions,
  ): Promise<PageResult<OrganizationV1>> {
    const result = await this.#database.query<
      OrganizationRow & { readonly role_key: unknown }
    >(
      sql(
        `SELECT o.organization_id, o.display_name, o.slug,
                o.lifecycle_status, o.record_version, o.created_at,
                o.deletion_requested_at, r.role_key
           FROM organizations AS o
           INNER JOIN memberships AS m
             ON m.organization_id = o.organization_id
            AND m.lifecycle_status = 'active'
           INNER JOIN principals AS p
             ON p.principal_id = m.principal_id
            AND p.lifecycle_status = 'active'
           INNER JOIN organization_roles AS r
             ON r.organization_id = m.organization_id
            AND r.role_key = m.role_key
            AND r.policy_version = 'authorization-v2'
          WHERE m.principal_id = $1
            AND o.lifecycle_status = 'active'
          ORDER BY o.display_name, o.organization_id`,
        [principal.principalId],
      ),
    );
    let organizations = result.rows.map((row) => {
      requirePermission(readRole(row.role_key), "organizations.read");
      return mapOrganization(row);
    });
    const lifecycleStatus = options.filters["lifecycleStatus"];
    if (lifecycleStatus !== undefined) {
      organizations = organizations.filter(
        (organization) => organization.lifecycleStatus === lifecycleStatus,
      );
    }
    if (options.sort === "-displayName") organizations.reverse();
    return page(organizations, options);
  }

  async getOrganization(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<VersionedResult<OrganizationV1>> {
    const result = await this.#database.query<
      OrganizationRow & { readonly role_key: unknown }
    >(
      sql(
        `SELECT o.organization_id, o.display_name, o.slug,
                o.lifecycle_status, o.record_version, o.created_at,
                o.deletion_requested_at, r.role_key
           FROM organizations AS o
           INNER JOIN memberships AS m
             ON m.organization_id = o.organization_id
            AND m.lifecycle_status = 'active'
           INNER JOIN principals AS p
             ON p.principal_id = m.principal_id
            AND p.lifecycle_status = 'active'
           INNER JOIN organization_roles AS r
             ON r.organization_id = m.organization_id
            AND r.role_key = m.role_key
            AND r.policy_version = 'authorization-v2'
          WHERE m.principal_id = $1
            AND o.organization_id = $2
            AND o.lifecycle_status = 'active'
          LIMIT 1`,
        [principal.principalId, organizationId],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    }
    requirePermission(readRole(row.role_key), "organizations.read");
    const value = mapOrganization(row);
    return { etag: etag(value.id, value.version ?? 1), value };
  }

  async listMemberships(
    principal: PrincipalContext,
    organizationId: string,
    options: PageOptions,
  ): Promise<PageResult<MembershipV1>> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100
    ) {
      throw new ApplicationError(
        "invalid_request",
        "The membership page limit is invalid.",
      );
    }
    const offset = pageOffset(options.cursor);
    const status = options.filters["status"];
    if (status !== undefined && status !== "active" && status !== "suspended") {
      throw new ApplicationError(
        "invalid_request",
        "The membership status filter is invalid.",
      );
    }
    const orderBy = membershipOrderBy(options.sort);
    const authorization = await this.#database.query<OrganizationContextRow>(
      sql(
        `SELECT m.membership_id, m.organization_id, r.role_key
           FROM memberships AS m
           INNER JOIN principals AS p
             ON p.principal_id = m.principal_id
            AND p.lifecycle_status = 'active'
           INNER JOIN organizations AS o
             ON o.organization_id = m.organization_id
            AND o.lifecycle_status = 'active'
           INNER JOIN organization_roles AS r
             ON r.organization_id = m.organization_id
            AND r.role_key = m.role_key
            AND r.policy_version = 'authorization-v2'
          WHERE m.principal_id = $1
            AND m.organization_id = $2
            AND m.lifecycle_status = 'active'
          LIMIT 1`,
        [principal.principalId, organizationId],
      ),
    );
    const authorizationContext = authorization.rows[0];
    if (authorizationContext === undefined) {
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    }
    const role = readRole(authorizationContext.role_key);
    requirePermission(role, "memberships.read");
    const authorizationMembershipId = readString(
      authorizationContext.membership_id,
    );

    const result = await this.#database.query<MembershipRow>(
      sql(
        `SELECT m.membership_id, m.organization_id, m.principal_id,
                m.role_key, m.lifecycle_status, m.joined_at, p.display_name
           FROM memberships AS m
           INNER JOIN principals AS p
             ON p.principal_id = m.principal_id
          WHERE m.organization_id = $1
            AND ($5::varchar IS NULL OR m.lifecycle_status = $5)
            AND EXISTS (
              SELECT 1
                FROM memberships AS actor_membership
                INNER JOIN principals AS actor_principal
                  ON actor_principal.principal_id = actor_membership.principal_id
                 AND actor_principal.lifecycle_status = 'active'
                INNER JOIN organizations AS actor_organization
                  ON actor_organization.organization_id = actor_membership.organization_id
                 AND actor_organization.lifecycle_status = 'active'
                INNER JOIN organization_roles AS actor_role
                  ON actor_role.organization_id = actor_membership.organization_id
                 AND actor_role.role_key = actor_membership.role_key
                 AND actor_role.policy_version = 'authorization-v2'
               WHERE actor_membership.membership_id = $2
                 AND actor_membership.principal_id = $3
                 AND actor_membership.organization_id = $1
                 AND actor_membership.lifecycle_status = 'active'
                 AND actor_membership.role_key = $4
            )
          ORDER BY ${orderBy}
          LIMIT $6
          OFFSET $7`,
        [
          organizationId,
          authorizationMembershipId,
          principal.principalId,
          role,
          status ?? null,
          options.limit + 1,
          offset,
        ],
      ),
    );
    const membershipRows = result.rows.slice(0, options.limit);
    const memberships = membershipRows.map((membership) => {
      const membershipRole = readRole(membership.role_key);
      return membershipV1Schema.parse({
        capabilities: [
          ...betaCapabilitiesForRole(membershipRole, this.#features),
        ],
        id: readString(membership.membership_id),
        isOwner: membershipRole === "owner",
        joinedAt: readTimestamp(membership.joined_at),
        organizationId: readString(membership.organization_id),
        principal: {
          displayName: readString(membership.display_name),
          id: readString(membership.principal_id),
        },
        role: membershipRole,
        status: readString(membership.lifecycle_status),
      });
    });
    return {
      items: memberships,
      ...(result.rows.length > options.limit
        ? {
            nextCursor: `beta-offset-${String(offset + memberships.length)}`,
          }
        : {}),
    };
  }
}

export function productionIdentityOverrides(
  application: ProductionIdentityApplication,
): Partial<CloudMarkupApplication> {
  return {
    getCurrentPrincipal: application.getCurrentPrincipal.bind(application),
    getOrganization: application.getOrganization.bind(application),
    listMemberships: application.listMemberships.bind(application),
    listOrganizations: application.listOrganizations.bind(application),
  };
}
