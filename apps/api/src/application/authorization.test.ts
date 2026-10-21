import { apiOperationsV1 } from "@cloudmarkup/api-contract";
import { describe, expect, it, vi } from "vitest";

import { ApplicationError } from "./errors.js";
import {
  API_AUTHORIZATION_REQUIREMENTS,
  AUTHORIZATION_POLICY_VERSION,
  ORGANIZATION_ROLES,
  ROLE_PERMISSIONS,
  roleAllows,
  runSensitiveAction,
  type AuthorizedOrganizationContext,
  type SensitiveAuditEvent,
} from "./authorization.js";
import type { Principal } from "./identity.js";
import {
  ObjectAuthorizationService,
  type AuthorizationStore,
  type ChildObjectAuthorizationRecord,
  type JobObjectKind,
  type MembershipAuthorizationRecord,
  type OrganizationObjectAuthorizationRecord,
  type PrincipalLifecycleState,
  type ProjectAuthorizationRecord,
} from "./object-authorization.js";

const NOW = new Date("2026-08-02T12:00:00.000Z");

function principal(
  principalId: string,
  authenticatedAt = "2026-08-02T11:59:00.000Z",
): Principal {
  return {
    authenticatedAt,
    authenticationSource: "test",
    expiresAt: "2026-08-02T13:00:00.000Z",
    principalId,
    sessionId: `session_${principalId}`,
  };
}

function expectCode(error: unknown, code: ApplicationError["code"]): void {
  expect(error).toBeInstanceOf(ApplicationError);
  expect((error as ApplicationError).code).toBe(code);
}

class TestAuthorizationStore implements AuthorizationStore {
  readonly artifacts = new Map<string, ChildObjectAuthorizationRecord>();
  readonly auditEvents = new Map<
    string,
    OrganizationObjectAuthorizationRecord
  >();
  readonly integrations = new Map<
    string,
    OrganizationObjectAuthorizationRecord
  >();
  readonly jobs = new Map<string, ChildObjectAuthorizationRecord>();
  readonly memberships = new Map<string, MembershipAuthorizationRecord>();
  readonly principals = new Map<string, PrincipalLifecycleState>();
  readonly projects = new Map<string, ProjectAuthorizationRecord>();
  readonly revisions = new Map<string, ChildObjectAuthorizationRecord>();
  projectReads = 0;

  getPrincipalState(
    principalId: string,
  ): Promise<PrincipalLifecycleState | null> {
    return Promise.resolve(this.principals.get(principalId) ?? null);
  }

  getMembership(
    principalId: string,
    organizationId: string,
  ): Promise<MembershipAuthorizationRecord | null> {
    return Promise.resolve(
      this.memberships.get(`${principalId}:${organizationId}`) ?? null,
    );
  }

  getProject(projectId: string): Promise<ProjectAuthorizationRecord | null> {
    this.projectReads += 1;
    return Promise.resolve(this.projects.get(projectId) ?? null);
  }

  getRevision(
    revisionId: string,
  ): Promise<ChildObjectAuthorizationRecord | null> {
    return Promise.resolve(this.revisions.get(revisionId) ?? null);
  }

  getJob(
    kind: JobObjectKind,
    jobId: string,
  ): Promise<ChildObjectAuthorizationRecord | null> {
    return Promise.resolve(this.jobs.get(`${kind}:${jobId}`) ?? null);
  }

  getArtifact(
    artifactId: string,
  ): Promise<ChildObjectAuthorizationRecord | null> {
    return Promise.resolve(this.artifacts.get(artifactId) ?? null);
  }

  getIntegration(
    integrationId: string,
  ): Promise<OrganizationObjectAuthorizationRecord | null> {
    return Promise.resolve(this.integrations.get(integrationId) ?? null);
  }

  getAuditEvent(
    auditEventId: string,
  ): Promise<OrganizationObjectAuthorizationRecord | null> {
    return Promise.resolve(this.auditEvents.get(auditEventId) ?? null);
  }
}

function seededAuthorization() {
  const store = new TestAuthorizationStore();
  for (const id of [
    "principal_owner",
    "principal_admin",
    "principal_editor",
    "principal_viewer",
    "principal_stale",
  ]) {
    store.principals.set(id, "active");
  }
  store.principals.set("principal_deleted", "deleted");

  const memberships = [
    ["principal_owner", "org_a", "membership_owner", "owner", "active"],
    ["principal_admin", "org_a", "membership_admin", "administrator", "active"],
    ["principal_editor", "org_a", "membership_editor", "editor", "active"],
    ["principal_viewer", "org_a", "membership_viewer", "viewer", "active"],
    ["principal_stale", "org_a", "membership_stale", "owner", "suspended"],
    ["principal_owner", "org_b", "membership_owner_b", "viewer", "active"],
  ] as const;
  for (const [
    principalId,
    organizationId,
    membershipId,
    role,
    status,
  ] of memberships) {
    store.memberships.set(`${principalId}:${organizationId}`, {
      membershipId,
      role,
      status,
    });
  }

  store.projects.set("project_a", {
    organizationId: "org_a",
    projectId: "project_a",
  });
  store.projects.set("project_b", {
    organizationId: "org_b",
    projectId: "project_b",
  });
  const child = {
    objectId: "revision_a",
    organizationId: "org_a",
    projectId: "project_a",
  };
  store.revisions.set("revision_a", child);
  store.jobs.set("validation:validation_a", {
    ...child,
    objectId: "validation_a",
  });
  store.jobs.set("generation:generation_a", {
    ...child,
    objectId: "generation_a",
  });
  store.jobs.set("export:export_a", { ...child, objectId: "export_a" });
  store.artifacts.set("artifact_a", { ...child, objectId: "artifact_a" });
  store.integrations.set("integration_a", {
    objectId: "integration_a",
    organizationId: "org_a",
  });
  store.auditEvents.set("audit_a", {
    objectId: "audit_a",
    organizationId: "org_a",
  });

  return { service: new ObjectAuthorizationService(store), store };
}

describe("authorization policy v2", () => {
  it("assigns an explicit requirement to every protected operation", () => {
    const protectedOperations = Object.entries(apiOperationsV1)
      .filter(([, operation]) => operation.security === "principal")
      .map(([operationId]) => operationId)
      .sort();
    expect(Object.keys(API_AUTHORIZATION_REQUIREMENTS).sort()).toEqual(
      protectedOperations,
    );
  });

  it("uses monotonic canonical role permissions", () => {
    expect(ORGANIZATION_ROLES).toEqual([
      "owner",
      "administrator",
      "editor",
      "viewer",
    ]);
    expect(roleAllows("viewer", "projects.read")).toBe(true);
    expect(roleAllows("viewer", "commercial.summary.read")).toBe(true);
    expect(roleAllows("viewer", "commercial.expensive.use")).toBe(false);
    expect(roleAllows("viewer", "integrations.read")).toBe(false);
    expect(roleAllows("viewer", "billing.manage")).toBe(false);
    expect(roleAllows("viewer", "usage.read-technical")).toBe(false);
    expect(roleAllows("viewer", "projects.mutate")).toBe(false);
    expect(roleAllows("editor", "exports.run")).toBe(true);
    expect(roleAllows("editor", "integrations.read")).toBe(true);
    expect(roleAllows("editor", "integrations.manage")).toBe(false);
    expect(roleAllows("editor", "commercial.expensive.use")).toBe(true);
    expect(roleAllows("editor", "billing.manage")).toBe(false);
    expect(roleAllows("editor", "usage.read-technical")).toBe(false);
    expect(roleAllows("editor", "memberships.read")).toBe(false);
    expect(roleAllows("administrator", "audit.read")).toBe(true);
    expect(roleAllows("administrator", "billing.manage")).toBe(true);
    expect(roleAllows("administrator", "usage.read-technical")).toBe(true);
    expect(roleAllows("administrator", "memberships.assign-owner")).toBe(false);
    expect(roleAllows("owner", "memberships.assign-owner")).toBe(true);
    expect(new Set(ROLE_PERMISSIONS.owner).size).toBe(
      ROLE_PERMISSIONS.owner.length,
    );
  });
});

describe("tenant isolation matrix", () => {
  it.each([
    ["principal_owner", true],
    ["principal_admin", true],
    ["principal_editor", true],
    ["principal_viewer", false],
  ] as const)(
    "enforces project mutation for %s",
    async (principalId, allowed) => {
      const { service } = seededAuthorization();
      const attempt = service.authorizeProject(
        principal(principalId),
        "correlation_matrix",
        "project_a",
        "projects.mutate",
      );
      if (allowed) {
        await expect(attempt).resolves.toMatchObject({
          organizationId: "org_a",
        });
      } else {
        await expect(attempt).rejects.toSatisfy((error: unknown) => {
          expectCode(error, "access_denied");
          return true;
        });
      }
    },
  );

  it("returns the same not-found result for guessed IDs, cross-tenant access, and stale membership", async () => {
    const { service } = seededAuthorization();
    const attempts = [
      service.authorizeProject(
        principal("principal_viewer"),
        "correlation_guess",
        "project_guessed",
        "projects.read",
      ),
      service.authorizeProject(
        principal("principal_admin"),
        "correlation_cross",
        "project_b",
        "projects.read",
      ),
      service.authorizeProject(
        principal("principal_stale"),
        "correlation_stale",
        "project_a",
        "projects.read",
      ),
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toMatchObject({
        code: "not_found",
        message: "The requested resource is unavailable.",
      });
    }
  });

  it("rejects a deleted principal before looking up a guessed object", async () => {
    const { service, store } = seededAuthorization();
    await expect(
      service.authorizeProject(
        principal("principal_deleted"),
        "correlation_deleted",
        "project_a",
        "projects.read",
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(store.projectReads).toBe(0);
  });

  it("checks exact project parents for revisions, every job kind, and artifacts", async () => {
    const { service } = seededAuthorization();
    const actor = principal("principal_owner");
    await expect(
      service.authorizeRevision(
        actor,
        "correlation_revision",
        "project_b",
        "revision_a",
        "projects.read",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    for (const [kind, jobId] of [
      ["validation", "validation_a"],
      ["generation", "generation_a"],
      ["export", "export_a"],
    ] as const) {
      await expect(
        service.authorizeJob(
          actor,
          `correlation_${kind}`,
          "project_a",
          kind,
          jobId,
          "projects.read",
        ),
      ).resolves.toMatchObject({ organizationId: "org_a" });
    }
    await expect(
      service.authorizeArtifact(
        actor,
        "correlation_artifact",
        "project_b",
        "artifact_a",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("checks integration and audit ownership before applying their administrator permissions", async () => {
    const { service } = seededAuthorization();
    const administrator = principal("principal_admin");
    await expect(
      service.authorizeIntegration(
        administrator,
        "correlation_integration",
        "org_a",
        "integration_a",
        "integrations.read",
      ),
    ).resolves.toMatchObject({ role: "administrator" });
    await expect(
      service.authorizeAuditEvent(
        administrator,
        "correlation_audit",
        "org_b",
        "audit_a",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.authorizeIntegration(
        principal("principal_editor"),
        "correlation_editor",
        "org_a",
        "integration_a",
        "integrations.read",
      ),
    ).resolves.toMatchObject({ role: "editor" });
  });
});

describe("recent authentication and sensitive audit hooks", () => {
  const context: AuthorizedOrganizationContext = {
    correlationId: "correlation_sensitive",
    membershipId: "membership_owner",
    organizationId: "org_a",
    principal: principal("principal_owner"),
    role: "owner",
  };

  it.each(["role", "billing", "export"] as const)(
    "audits a successful %s action",
    async (family) => {
      const events: SensitiveAuditEvent[] = [];
      const result = await runSensitiveAction({
        action: `${family}.changed`,
        auditSink: {
          append: (event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        context,
        family,
        now: () => NOW,
        operation: () => "done",
        permission:
          family === "role"
            ? "memberships.manage"
            : family === "billing"
              ? "billing.manage"
              : "exports.run",
        safeSummary: "Sensitive action completed.",
        targetKind:
          family === "role"
            ? "membership"
            : family === "billing"
              ? "billing-account"
              : "job",
      });
      expect(result).toBe("done");
      expect(events).toEqual([
        expect.objectContaining({
          authorizationPolicyVersion: AUTHORIZATION_POLICY_VERSION,
          family,
          outcome: "succeeded",
        }),
      ]);
    },
  );

  it("denies stale authentication before work and records a safe denial", async () => {
    const events: SensitiveAuditEvent[] = [];
    const operation = vi.fn();
    await expect(
      runSensitiveAction({
        action: "integration.disconnected",
        auditSink: {
          append: (event) => {
            events.push(event);
            return Promise.resolve();
          },
        },
        context: {
          ...context,
          principal: principal("principal_owner", "2026-08-02T11:00:00.000Z"),
        },
        family: "integration",
        now: () => NOW,
        operation,
        permission: "integrations.manage",
        safeSummary: "Integration disconnect requested.",
        targetKind: "integration",
      }),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(operation).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({ outcome: "denied" })]);
  });
});
