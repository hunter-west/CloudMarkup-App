import { describe, expect, it } from "vitest";

import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "../adapters/persistence/sql.js";
import { ApplicationError } from "./errors.js";
import { ORGANIZATION_ROLES, permissionsForRole } from "./authorization.js";
import {
  betaCapabilitiesForRole,
  ProductionIdentityApplication,
} from "./production-identity-application.js";
import type { PrincipalContext } from "./ports.js";

const principal: PrincipalContext = {
  authenticatedAt: "2026-09-02T12:00:00.000Z",
  authenticationSource: "cognito",
  correlationId: "correlation-beta",
  expiresAt: "2026-09-02T12:30:00.000Z",
  principalId: "principal_beta_subject",
  sessionId: "session-beta",
};

class HandlerDatabase implements SqlDatabase {
  readonly statements: SqlStatement[] = [];
  readonly #handler: (statement: SqlStatement) => SqlResult;

  constructor(handler: (statement: SqlStatement) => SqlResult) {
    this.#handler = handler;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    this.statements.push(statement);
    return Promise.resolve(this.#handler(statement) as SqlResult<TRow>);
  }

  transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this);
  }
}

function result(rows: readonly SqlRow[]): SqlResult {
  return { rowCount: rows.length, rows };
}

describe("ProductionIdentityApplication", () => {
  it("maps only the verified principal's canonical active membership", async () => {
    const database = new HandlerDatabase((statement) => {
      if (statement.text.includes("FROM principals")) {
        return result([
          {
            display_name: "Beta user",
            email: null,
            principal_id: principal.principalId,
          },
        ]);
      }
      return result([
        {
          membership_id: "membership_beta_subject",
          organization_id: "org_beta_subject",
          role_key: "owner",
        },
      ]);
    });
    const application = new ProductionIdentityApplication(database);

    await expect(application.getCurrentPrincipal(principal)).resolves.toEqual({
      displayName: "Beta user",
      id: principal.principalId,
      organizationContexts: [
        {
          capabilities: [...betaCapabilitiesForRole("owner")],
          isOwner: true,
          membershipId: "membership_beta_subject",
          organizationId: "org_beta_subject",
          role: "owner",
        },
      ],
      resourceVersion: 1,
    });
    expect(database.statements).toHaveLength(2);
    expect(
      database.statements.every((statement) =>
        statement.values.includes(principal.principalId),
      ),
    ).toBe(true);
  });

  it("advertises only the enabled canonical beta capabilities", () => {
    const ownerCapabilities = betaCapabilitiesForRole("owner");
    const administratorCapabilities = betaCapabilitiesForRole("administrator");
    const editorCapabilities = betaCapabilitiesForRole("editor");
    const viewerCapabilities = betaCapabilitiesForRole("viewer");

    expect(ownerCapabilities).toContain("memberships.read");
    expect(administratorCapabilities).toContain("memberships.read");
    expect(editorCapabilities).not.toContain("memberships.read");
    expect(viewerCapabilities).not.toContain("memberships.read");
    for (const capabilities of [
      ownerCapabilities,
      administratorCapabilities,
      editorCapabilities,
      viewerCapabilities,
    ]) {
      expect(capabilities).toContain("commercial.summary.read");
      expect(capabilities).toContain("artifacts.read");
      expect(capabilities).not.toContain("commercial.expensive.use");
      expect(capabilities).not.toContain("usage.read-technical");
      expect(capabilities).not.toContain("memberships.manage");
      expect(capabilities).not.toContain("memberships.assign-owner");
    }
    expect(ownerCapabilities).toContain("revisions.create");
    expect(ownerCapabilities).not.toContain("integrations.read");
    expect(ownerCapabilities).not.toContain("generation.run");
    expect(ownerCapabilities).not.toContain("exports.run");
    expect(ownerCapabilities).not.toContain("billing.manage");
  });

  it("advertises configured native exports without paid or AI authority", () => {
    const base = betaCapabilitiesForRole("owner");
    const enabled = betaCapabilitiesForRole("owner", {
      nativeInfrastructureExports: true,
    });
    expect(enabled).toEqual([...base, "exports.run"]);
    expect(enabled).not.toContain("commercial.expensive.use");
    expect(enabled).not.toContain("generation.run");
    expect(
      betaCapabilitiesForRole("owner", {
        nativeInfrastructureExports: "true" as unknown as boolean,
      }),
    ).toEqual(base);
  });

  it.each(ORGANIZATION_ROLES)(
    "advertises only canonical GitHub connection permissions for %s when composed",
    (role) => {
      const enabled = betaCapabilitiesForRole(role, {
        githubConnections: true,
      });
      const disabled = betaCapabilitiesForRole(role, {
        githubConnections: false,
      });
      expect(disabled).toEqual(betaCapabilitiesForRole(role));
      expect(enabled).toEqual([
        ...disabled,
        ...(["integrations.read", "integrations.manage"] as const).filter(
          (permission) => permissionsForRole(role).includes(permission),
        ),
      ]);
      expect(enabled.includes("integrations.read")).toBe(role !== "viewer");
      expect(enabled.includes("integrations.manage")).toBe(
        role === "owner" || role === "administrator",
      );
      expect(
        enabled.every((permission) =>
          permissionsForRole(role).includes(permission),
        ),
      ).toBe(true);
      expect(enabled).not.toContain("exports.run");
      expect(enabled).not.toContain("generation.run");
      expect(enabled).not.toContain("commercial.expensive.use");
    },
  );

  it.each([false, true])(
    "captures GitHub availability %s once for every current-principal role",
    async (githubConnections) => {
      const database = new HandlerDatabase((statement) =>
        statement.text.includes("FROM principals")
          ? result([
              {
                display_name: "Beta user",
                email: null,
                principal_id: principal.principalId,
              },
            ])
          : result(
              ORGANIZATION_ROLES.map((role) => ({
                membership_id: `membership_${role}`,
                organization_id: `org_${role}`,
                role_key: role,
              })),
            ),
      );
      const features = { githubConnections };
      const application = new ProductionIdentityApplication(database, features);
      features.githubConnections = !githubConnections;
      const current = await application.getCurrentPrincipal(principal);
      expect(current.organizationContexts).toHaveLength(4);
      for (const context of current.organizationContexts)
        expect(context.capabilities).toEqual(
          betaCapabilitiesForRole(context.role, { githubConnections }),
        );
      expect(
        database.statements.every((statement) =>
          statement.values.includes(principal.principalId),
        ),
      ).toBe(true);
    },
  );

  it("does not enable connections from a truthy non-Boolean option", () => {
    expect(
      betaCapabilitiesForRole("owner", {
        githubConnections: "true" as unknown as boolean,
      }),
    ).toEqual(betaCapabilitiesForRole("owner"));
  });

  it.each(ORGANIZATION_ROLES)(
    "advertises invitation management only for canonical %s authority when composed",
    (role) => {
      const enabled = betaCapabilitiesForRole(role, {
        githubConnections: true,
        organizationInvitations: true,
      });
      const disabled = betaCapabilitiesForRole(role, {
        githubConnections: true,
        organizationInvitations: false,
      });
      expect(enabled).toEqual([
        ...disabled,
        ...(role === "owner" || role === "administrator"
          ? ["memberships.manage"]
          : []),
      ]);
      expect(
        enabled.every((permission) =>
          permissionsForRole(role).includes(permission),
        ),
      ).toBe(true);
      expect(enabled).not.toContain("memberships.assign-owner");
      expect(enabled).not.toContain("exports.run");
      expect(
        betaCapabilitiesForRole(role, {
          organizationInvitations: "true" as unknown as boolean,
        }),
      ).toEqual(betaCapabilitiesForRole(role));
    },
  );

  it.each([false, true])(
    "snapshots invitation availability %s rather than retaining mutable caller options",
    async (organizationInvitations) => {
      const database = new HandlerDatabase((statement) =>
        statement.text.includes("FROM principals")
          ? result([
              {
                display_name: "Beta user",
                email: null,
                principal_id: principal.principalId,
              },
            ])
          : result(
              ORGANIZATION_ROLES.map((role) => ({
                membership_id: `membership_${role}`,
                organization_id: `org_${role}`,
                role_key: role,
              })),
            ),
      );
      const features = { githubConnections: true, organizationInvitations };
      const application = new ProductionIdentityApplication(database, features);
      features.organizationInvitations = !organizationInvitations;
      const current = await application.getCurrentPrincipal(principal);
      for (const context of current.organizationContexts)
        expect(context.capabilities).toEqual(
          betaCapabilitiesForRole(context.role, {
            githubConnections: true,
            organizationInvitations,
          }),
        );
    },
  );

  it.each([
    ["owner", false],
    ["administrator", false],
    ["owner", true],
    ["administrator", true],
  ] as const)(
    "allows an active %s to list canonical memberships with GitHub availability %s",
    async (actorRole, githubConnections) => {
      const database = new HandlerDatabase((statement) => {
        if (statement.text.includes("p.display_name")) {
          return result([
            {
              display_name: "Owner account",
              joined_at: "2026-09-02T12:00:00.000Z",
              lifecycle_status: "active",
              membership_id: "membership_owner",
              organization_id: "org_beta_subject",
              principal_id: "principal_owner",
              role_key: "owner",
            },
            {
              display_name: "Editor account",
              joined_at: "2026-09-03T12:00:00.000Z",
              lifecycle_status: "active",
              membership_id: "membership_editor",
              organization_id: "org_beta_subject",
              principal_id: "principal_editor",
              role_key: "editor",
            },
          ]);
        }
        return result([
          {
            membership_id: "membership_beta_subject",
            organization_id: "org_beta_subject",
            role_key: actorRole,
          },
        ]);
      });
      const application = new ProductionIdentityApplication(database, {
        githubConnections,
      });

      await expect(
        application.listMemberships(principal, "org_beta_subject", {
          filters: {},
          limit: 100,
        }),
      ).resolves.toEqual({
        items: [
          {
            capabilities: [
              ...betaCapabilitiesForRole("owner", { githubConnections }),
            ],
            id: "membership_owner",
            isOwner: true,
            joinedAt: "2026-09-02T12:00:00.000Z",
            organizationId: "org_beta_subject",
            principal: {
              displayName: "Owner account",
              id: "principal_owner",
            },
            role: "owner",
            status: "active",
          },
          {
            capabilities: [
              ...betaCapabilitiesForRole("editor", { githubConnections }),
            ],
            id: "membership_editor",
            isOwner: false,
            joinedAt: "2026-09-03T12:00:00.000Z",
            organizationId: "org_beta_subject",
            principal: {
              displayName: "Editor account",
              id: "principal_editor",
            },
            role: "editor",
            status: "active",
          },
        ],
      });
      expect(database.statements).toHaveLength(2);
      expect(database.statements[0]?.values).toEqual([
        principal.principalId,
        "org_beta_subject",
      ]);
      expect(database.statements[0]?.text).toContain(
        "o.lifecycle_status = 'active'",
      );
      expect(database.statements[1]?.values).toEqual([
        "org_beta_subject",
        "membership_beta_subject",
        principal.principalId,
        actorRole,
        null,
        101,
        0,
      ]);
      expect(database.statements[1]?.text).toContain(
        "ORDER BY m.joined_at ASC, m.membership_id ASC",
      );
      expect(database.statements[1]?.text).toContain("LIMIT $6");
      expect(database.statements[1]?.text).toContain(
        "actor_membership.lifecycle_status = 'active'",
      );
    },
  );

  it.each([
    {
      expectedOrder: ["membership_alpha_a", "membership_alpha_b"],
      expectedOrderBy: "p.display_name ASC, m.membership_id ASC",
      sort: "displayName",
    },
    {
      expectedOrder: ["membership_zulu", "membership_alpha_b"],
      expectedOrderBy: "p.display_name DESC, m.membership_id DESC",
      sort: "-displayName",
    },
  ] as const)(
    "pushes $sort ordering and stable page boundaries into the membership query",
    async ({ expectedOrder, expectedOrderBy, sort }) => {
      const database = new HandlerDatabase((statement) => {
        if (!statement.text.includes("p.display_name")) {
          return result([
            {
              membership_id: "membership_beta_subject",
              organization_id: "org_beta_subject",
              role_key: "owner",
            },
          ]);
        }
        const ascending = statement.text.includes("display_name ASC");
        const rows = [
          {
            display_name: "Alpha account",
            joined_at: "2026-09-03T12:00:00.000Z",
            lifecycle_status: "active",
            membership_id: "membership_alpha_a",
            organization_id: "org_beta_subject",
            principal_id: "principal_alpha_a",
            role_key: "editor",
          },
          {
            display_name: "Alpha account",
            joined_at: "2026-09-02T12:00:00.000Z",
            lifecycle_status: "active",
            membership_id: "membership_alpha_b",
            organization_id: "org_beta_subject",
            principal_id: "principal_alpha_b",
            role_key: "viewer",
          },
          {
            display_name: "Zulu account",
            joined_at: "2026-09-01T12:00:00.000Z",
            lifecycle_status: "active",
            membership_id: "membership_zulu",
            organization_id: "org_beta_subject",
            principal_id: "principal_zulu",
            role_key: "administrator",
          },
        ];
        return result(ascending ? rows : [...rows].reverse());
      });
      const application = new ProductionIdentityApplication(database);

      const firstPage = await application.listMemberships(
        principal,
        "org_beta_subject",
        { filters: { status: "active" }, limit: 2, sort },
      );

      expect(firstPage.items.map((membership) => membership.id)).toEqual(
        expectedOrder,
      );
      expect(firstPage.nextCursor).toBe("beta-offset-2");
      const listStatement = database.statements[1];
      expect(listStatement?.text).toContain(`ORDER BY ${expectedOrderBy}`);
      expect(listStatement?.text).toContain(
        "($5::varchar IS NULL OR m.lifecycle_status = $5)",
      );
      expect(listStatement?.values).toEqual([
        "org_beta_subject",
        "membership_beta_subject",
        principal.principalId,
        "owner",
        "active",
        3,
        0,
      ]);
    },
  );

  it("rejects an invalid membership cursor before any tenant query", async () => {
    const database = new HandlerDatabase(() => result([]));
    const application = new ProductionIdentityApplication(database);

    await expect(
      application.listMemberships(principal, "org_beta_subject", {
        cursor: "not-a-beta-cursor",
        filters: {},
        limit: 25,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(database.statements).toHaveLength(0);
  });

  it.each(["editor", "viewer"] as const)(
    "denies an active %s membership list without reading tenant members",
    async (actorRole) => {
      const database = new HandlerDatabase(() =>
        result([
          {
            membership_id: "membership_beta_subject",
            organization_id: "org_beta_subject",
            role_key: actorRole,
          },
        ]),
      );
      const application = new ProductionIdentityApplication(database);

      const attempt = application.listMemberships(
        principal,
        "org_beta_subject",
        { filters: {}, limit: 100 },
      );
      await expect(attempt).rejects.toBeInstanceOf(ApplicationError);
      await expect(attempt).rejects.toMatchObject({ code: "access_denied" });
      expect(database.statements).toHaveLength(1);
    },
  );

  it("denies a cross-tenant membership list without reading tenant members", async () => {
    const database = new HandlerDatabase(() => result([]));
    const application = new ProductionIdentityApplication(database);

    const attempt = application.listMemberships(principal, "org_other_tenant", {
      filters: {},
      limit: 100,
    });
    await expect(attempt).rejects.toBeInstanceOf(ApplicationError);
    await expect(attempt).rejects.toMatchObject({ code: "not_found" });
    expect(database.statements).toHaveLength(1);
    expect(database.statements[0]?.values).toEqual([
      principal.principalId,
      "org_other_tenant",
    ]);
  });

  it("authorizes either explicitly requested organization for a multi-org principal", async () => {
    const database = new HandlerDatabase((statement) =>
      result([
        {
          membership_id: `membership_${String(statement.values[1])}`,
          organization_id: statement.values[1],
          role_key: "owner",
        },
      ]),
    );
    const application = new ProductionIdentityApplication(database);

    await expect(
      application.organizationForRequestedScope(principal, "org_one"),
    ).resolves.toBe("org_one");
    await expect(
      application.organizationForRequestedScope(principal, "org_two"),
    ).resolves.toBe("org_two");
    expect(database.statements[0]?.text).toContain(
      "r.policy_version = 'authorization-v2'",
    );
    expect(database.statements.map((statement) => statement.values)).toEqual([
      [principal.principalId, "org_one"],
      [principal.principalId, "org_two"],
    ]);
  });

  it.each([
    { label: "unknown", rows: [] },
    {
      label: "ambiguous",
      rows: [
        {
          membership_id: "membership_duplicate_one",
          organization_id: "org_requested",
          role_key: "owner",
        },
        {
          membership_id: "membership_duplicate_two",
          organization_id: "org_requested",
          role_key: "owner",
        },
      ],
    },
    {
      label: "mismatched",
      rows: [
        {
          membership_id: "membership_foreign",
          organization_id: "org_foreign",
          role_key: "owner",
        },
      ],
    },
  ] as const)(
    "fails closed for a $label requested organization result",
    async ({ rows }) => {
      const database = new HandlerDatabase(() => result(rows));
      const application = new ProductionIdentityApplication(database);

      await expect(
        application.organizationForRequestedScope(principal, "org_requested"),
      ).resolves.toBeNull();
    },
  );

  it("resolves a project organization only through active canonical membership", async () => {
    const database = new HandlerDatabase(() =>
      result([
        {
          membership_id: "membership_project_owner",
          organization_id: "org_project_owner",
          role_key: "owner",
        },
      ]),
    );
    const application = new ProductionIdentityApplication(database);

    await expect(
      application.organizationForProject(principal, "project_selected"),
    ).resolves.toBe("org_project_owner");
    expect(database.statements[0]?.values).toEqual([
      principal.principalId,
      "project_selected",
    ]);
    expect(database.statements[0]?.text).toContain("project.project_id = $2");
    expect(database.statements[0]?.text).toContain(
      "o.lifecycle_status = 'active'",
    );
    expect(database.statements[0]?.text).toContain(
      "m.lifecycle_status = 'active'",
    );
    expect(database.statements[0]?.text).toContain(
      "p.lifecycle_status = 'active'",
    );
    expect(database.statements[0]?.text).toContain(
      "r.policy_version = 'authorization-v2'",
    );
  });

  it.each([
    { label: "not found", rows: [] },
    {
      label: "ambiguous",
      rows: [
        {
          membership_id: "membership_one",
          organization_id: "org_one",
          role_key: "owner",
        },
        {
          membership_id: "membership_two",
          organization_id: "org_two",
          role_key: "owner",
        },
      ],
    },
  ] as const)(
    "does not disclose a $label project tenant resolution",
    async ({ rows }) => {
      const database = new HandlerDatabase(() => result(rows));
      const application = new ProductionIdentityApplication(database);

      await expect(
        application.organizationForProject(principal, "project_opaque"),
      ).resolves.toBeNull();
    },
  );

  it("denies a cross-tenant organization lookup without a disclosure", async () => {
    const database = new HandlerDatabase(() => result([]));
    const application = new ProductionIdentityApplication(database);

    const attempt = application.getOrganization(principal, "org_other_tenant");
    await expect(attempt).rejects.toBeInstanceOf(ApplicationError);
    await expect(attempt).rejects.toMatchObject({ code: "not_found" });
    expect(database.statements[0]?.values).toEqual([
      principal.principalId,
      "org_other_tenant",
    ]);
    expect(database.statements[0]?.text).toContain(
      "o.lifecycle_status = 'active'",
    );
    expect(database.statements[0]?.text).toContain(
      "r.policy_version = 'authorization-v2'",
    );
  });

  it("fails closed instead of returning an inactive organization", async () => {
    const database = new HandlerDatabase((statement) =>
      statement.text.includes("o.lifecycle_status = 'active'")
        ? result([])
        : result([
            {
              created_at: "2026-09-02T12:00:00.000Z",
              deletion_requested_at: null,
              display_name: "Suspended workspace",
              lifecycle_status: "suspended",
              organization_id: "org_suspended",
              record_version: "1",
              role_key: "owner",
              slug: "suspended-workspace",
            },
          ]),
    );
    const application = new ProductionIdentityApplication(database);

    await expect(
      application.getOrganization(principal, "org_suspended"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("filters organization reads through the verified principal id", async () => {
    const database = new HandlerDatabase(() =>
      result([
        {
          created_at: "2026-09-02T12:00:00.000Z",
          deletion_requested_at: null,
          display_name: "Beta workspace",
          lifecycle_status: "active",
          organization_id: "org_beta_subject",
          record_version: "1",
          role_key: "owner",
          slug: "beta-subject",
        },
      ]),
    );
    const application = new ProductionIdentityApplication(database);

    await expect(
      application.listOrganizations(principal, {
        filters: {},
        limit: 100,
      }),
    ).resolves.toMatchObject({
      items: [{ id: "org_beta_subject", lifecycleStatus: "active" }],
    });
    expect(database.statements[0]?.values).toEqual([principal.principalId]);
    expect(database.statements[0]?.text).toContain("INNER JOIN memberships");
    expect(database.statements[0]?.text).toContain(
      "o.lifecycle_status = 'active'",
    );
    expect(database.statements[0]?.text).toContain(
      "r.policy_version = 'authorization-v2'",
    );
  });

  it("fails closed when an organization list row has no canonical role", async () => {
    const database = new HandlerDatabase(() =>
      result([
        {
          created_at: "2026-09-02T12:00:00.000Z",
          deletion_requested_at: null,
          display_name: "Unbound workspace",
          lifecycle_status: "active",
          organization_id: "org_unbound",
          record_version: "1",
          role_key: "stale-role",
          slug: "unbound-workspace",
        },
      ]),
    );
    const application = new ProductionIdentityApplication(database);

    await expect(
      application.listOrganizations(principal, { filters: {}, limit: 100 }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(database.statements[0]?.text).toContain(
      "r.policy_version = 'authorization-v2'",
    );
  });
});
