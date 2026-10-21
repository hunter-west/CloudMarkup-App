import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { createProductionRepositoryBackedApplication } from "../production-composition.js";
import {
  ProductionIdentityApplication,
  betaCapabilitiesForRole,
} from "./production-identity-application.js";
import type { SqlDatabase } from "../adapters/persistence/sql.js";
import { permissionsForRole } from "./authorization.js";
import {
  RepositoryError,
  type AuthorizedOrganizationScope,
  type CloudMarkupRepository,
  type ObjectStore,
  type ProjectEnvironmentRecord,
  type ProjectRecord,
} from "./persistence.js";
import type { CloudMarkupApplication, PrincipalContext } from "./ports.js";
import { createRepositoryBackedEnvironmentApplicationOverrides } from "./repository-backed-environment-application.js";

const now = "2026-09-05T12:00:00.000Z";
const principal: PrincipalContext = {
  authenticatedAt: now,
  authenticationSource: "cognito",
  correlationId: "correlation_environment",
  expiresAt: "2026-09-05T13:00:00.000Z",
  principalId: "principal_environment",
  sessionId: "session_environment",
};
const project: ProjectRecord = {
  createdAt: now,
  currentDraftId: "draft_environment",
  lifecycleStatus: "active",
  name: "Service architecture",
  organizationId: "org_environment",
  projectId: "project_environment",
  recordVersion: 1,
  updatedAt: now,
};
const environment: ProjectEnvironmentRecord = {
  createdAt: now,
  environmentId: "env_production",
  environmentType: "production",
  lifecycleStatus: "active",
  name: "Production",
  organizationId: project.organizationId,
  projectId: project.projectId,
  recordVersion: 1,
  region: "us-east-1",
  updatedAt: now,
};

function setup() {
  const scope: AuthorizedOrganizationScope = {
    ...principal,
    capabilities: permissionsForRole("editor"),
    membershipId: "membership_environment",
    organizationId: project.organizationId,
    roleKey: "editor",
  };
  const resolveOrganizationScope = vi.fn().mockResolvedValue(scope);
  const getProject = vi.fn().mockResolvedValue(project);
  const getProjectEnvironment = vi.fn().mockResolvedValue(environment);
  const listProjectEnvironments = vi.fn().mockResolvedValue([environment]);
  const createProjectEnvironment = vi
    .fn()
    .mockImplementation((_scope, input: { environmentId: string }) =>
      Promise.resolve({ ...environment, environmentId: input.environmentId }),
    );
  const updateProjectEnvironment = vi
    .fn()
    .mockResolvedValue({ ...environment, recordVersion: 2 });
  const deleteProjectEnvironment = vi.fn().mockResolvedValue({
    ...environment,
    lifecycleStatus: "deletion-pending",
    recordVersion: 2,
  });
  const repository = {
    resolveOrganizationScope,
    getProject,
    getProjectEnvironment,
    listProjectEnvironments,
    createProjectEnvironment,
    updateProjectEnvironment,
    deleteProjectEnvironment,
  } as unknown as CloudMarkupRepository;
  const organizationForProject = vi
    .fn()
    .mockResolvedValue(project.organizationId);
  const options = {
    clock: () => new Date(now),
    identifierNamespace: "beta",
    organizationForProject,
    repository,
  };
  return {
    application: createRepositoryBackedEnvironmentApplicationOverrides(options),
    options,
    scope,
    resolveOrganizationScope,
    getProject,
    getProjectEnvironment,
    listProjectEnvironments,
    createProjectEnvironment,
    updateProjectEnvironment,
    deleteProjectEnvironment,
    organizationForProject,
  };
}

describe("durable production environment application", () => {
  it("composes all environment methods into the real production application", async () => {
    const fixture = setup();
    const identity = new ProductionIdentityApplication({} as SqlDatabase);
    vi.spyOn(identity, "organizationForProject").mockResolvedValue(
      project.organizationId,
    );
    const application = createProductionRepositoryBackedApplication(identity, {
      ...fixture.options,
      fallback: {} as CloudMarkupApplication,
      objectStore: {} as ObjectStore,
    });
    expect(
      await application.getProjectEnvironment(
        principal,
        project.projectId,
        environment.environmentId,
      ),
    ).toMatchObject({
      etag: '"environment:env_production:v1"',
      value: { id: environment.environmentId, version: 1 },
    });
    for (const role of ["owner", "administrator", "editor"] as const)
      expect(betaCapabilitiesForRole(role)).toContain("environments.create");
    expect(betaCapabilitiesForRole("viewer")).not.toContain(
      "environments.create",
    );
  });

  it("passes trusted project scope and stable caller-scoped creation identity to the durable repository", async () => {
    const fixture = setup();
    const input = {
      environmentType: "production" as const,
      name: "Production",
      region: "us-east-1",
    };
    const first = await fixture.application.createProjectEnvironment(
      principal,
      project.projectId,
      input,
      "create-environment-key",
    );
    const second = await fixture.application.createProjectEnvironment(
      principal,
      project.projectId,
      input,
      "create-environment-key",
    );
    expect(second.id).toBe(first.id);
    expect(fixture.createProjectEnvironment).toHaveBeenCalledWith(
      fixture.scope,
      expect.objectContaining({
        ...input,
        environmentId: first.id,
        projectId: project.projectId,
        idempotencyKey: "create-environment-key",
        requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) as unknown,
      }),
    );
    expect(first).not.toHaveProperty("organizationId");
  });

  it("preserves a region when omitted and clears it only when explicitly null", async () => {
    const fixture = setup();
    const input = {
      contractVersion: 1 as const,
      name: "Live",
      environmentType: "production" as const,
    };
    await fixture.application.updateProjectEnvironment(
      principal,
      project.projectId,
      environment.environmentId,
      input,
      '"environment:env_production:v1"',
    );
    expect(fixture.updateProjectEnvironment).toHaveBeenLastCalledWith(
      fixture.scope,
      expect.objectContaining({
        expectedRecordVersion: 1,
        region: "us-east-1",
      }),
    );
    await fixture.application.updateProjectEnvironment(
      principal,
      project.projectId,
      environment.environmentId,
      { ...input, region: null },
      '"environment:env_production:v1"',
    );
    expect(
      fixture.updateProjectEnvironment.mock.calls[1]?.[1],
    ).not.toHaveProperty("region");
  });

  it.each([
    '"environment:env_production:v2"',
    '"environment:env_foreign:v1"',
    'W/"environment:env_production:v1"',
  ])(
    "rejects stale or foreign update preconditions %s",
    async (expectedEtag) => {
      const fixture = setup();
      await expect(
        fixture.application.updateProjectEnvironment(
          principal,
          project.projectId,
          environment.environmentId,
          { contractVersion: 1, name: "Live", environmentType: "production" },
          expectedEtag,
        ),
      ).rejects.toMatchObject({ code: "precondition_failed" });
      expect(fixture.updateProjectEnvironment).not.toHaveBeenCalled();
    },
  );

  it("lets durable deletion idempotency resolve the original ETag after the tombstone transition", async () => {
    const fixture = setup();
    fixture.getProjectEnvironment.mockResolvedValue({
      ...environment,
      lifecycleStatus: "deletion-pending",
      recordVersion: 2,
    });
    const result = await fixture.application.deleteProjectEnvironment(
      principal,
      project.projectId,
      environment.environmentId,
      '"environment:env_production:v1"',
      "delete-environment-key",
    );
    expect(fixture.deleteProjectEnvironment).toHaveBeenCalledWith(
      fixture.scope,
      expect.objectContaining({
        expectedRecordVersion: 1,
        idempotencyKey: "delete-environment-key",
      }),
    );
    expect(result.value.lifecycleStatus).toBe("deletion-pending");
  });

  it("requires recent authentication for a deletion request", async () => {
    const fixture = setup();
    await expect(
      fixture.application.deleteProjectEnvironment(
        { ...principal, authenticatedAt: "2026-09-04T12:00:00.000Z" },
        project.projectId,
        environment.environmentId,
        '"environment:env_production:v1"',
        "delete-environment-key",
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(fixture.deleteProjectEnvironment).not.toHaveBeenCalled();
  });

  it("denies a viewer even when a stored capability array claims write access", async () => {
    const fixture = setup();
    fixture.resolveOrganizationScope.mockResolvedValue({
      ...fixture.scope,
      roleKey: "viewer",
    });
    await expect(
      fixture.application.createProjectEnvironment(
        principal,
        project.projectId,
        { name: "Live", environmentType: "production" },
        "create-key",
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(fixture.createProjectEnvironment).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...project, organizationId: "org_foreign" },
    { ...project, lifecycleStatus: "deleted" },
  ])("hides absent, foreign, or deleted projects", async (record) => {
    const fixture = setup();
    fixture.getProject.mockResolvedValue(record);
    await expect(
      fixture.application.listProjectEnvironments(
        principal,
        project.projectId,
        { filters: {}, limit: 25 },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(fixture.listProjectEnvironments).not.toHaveBeenCalled();
  });

  it("hides cross-project environment guesses", async () => {
    const fixture = setup();
    fixture.getProjectEnvironment.mockResolvedValue({
      ...environment,
      projectId: "project_foreign",
    });
    await expect(
      fixture.application.getProjectEnvironment(
        principal,
        project.projectId,
        environment.environmentId,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a changed principal or organization scope before reading the project", async () => {
    const fixture = setup();
    fixture.resolveOrganizationScope.mockResolvedValue({
      ...fixture.scope,
      principalId: "principal_foreign",
    });
    await expect(
      fixture.application.getProjectEnvironment(
        principal,
        project.projectId,
        environment.environmentId,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(fixture.getProject).not.toHaveBeenCalled();
  });

  it("allows archived reads while rejecting mutations", async () => {
    const fixture = setup();
    fixture.getProject.mockResolvedValue({
      ...project,
      lifecycleStatus: "archived",
    });
    await expect(
      fixture.application.getProjectEnvironment(
        principal,
        project.projectId,
        environment.environmentId,
      ),
    ).resolves.toHaveProperty("value.id", environment.environmentId);
    await expect(
      fixture.application.createProjectEnvironment(
        principal,
        project.projectId,
        { name: "Live", environmentType: "production" },
        "create-key",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("sorts and paginates the authorized filtered environments", async () => {
    const fixture = setup();
    fixture.listProjectEnvironments.mockResolvedValue([
      {
        ...environment,
        environmentId: "env_stage",
        name: "Staging",
        environmentType: "staging",
      },
      {
        ...environment,
        environmentId: "env_z",
        name: "Zulu",
        createdAt: "2026-09-04T12:00:00.000Z",
      },
      environment,
    ]);
    const first = await fixture.application.listProjectEnvironments(
      principal,
      project.projectId,
      { filters: { type: "production" }, limit: 1, sort: "createdAt" },
    );
    expect(first.items.map((value) => value.id)).toEqual(["env_z"]);
    const second = await fixture.application.listProjectEnvironments(
      principal,
      project.projectId,
      {
        ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
        filters: { type: "production" },
        limit: 1,
        sort: "createdAt",
      },
    );
    expect(second.items.map((value) => value.id)).toEqual(["env_production"]);
    expect(second.nextCursor).toBeUndefined();
    await expect(
      fixture.application.listProjectEnvironments(
        principal,
        project.projectId,
        { cursor: "foreign-cursor", filters: {}, limit: 25 },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("translates durable CAS and idempotency failures without leaking internals", async () => {
    const fixture = setup();
    fixture.createProjectEnvironment.mockRejectedValue(
      new RepositoryError("idempotency-conflict", "private query"),
    );
    await expect(
      fixture.application.createProjectEnvironment(
        principal,
        project.projectId,
        { name: "Live", environmentType: "production" },
        "create-key",
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    fixture.updateProjectEnvironment.mockRejectedValue(
      new RepositoryError("version-conflict", "private query"),
    );
    await expect(
      fixture.application.updateProjectEnvironment(
        principal,
        project.projectId,
        environment.environmentId,
        { contractVersion: 1, name: "Live", environmentType: "production" },
        '"environment:env_production:v1"',
      ),
    ).rejects.toMatchObject({ code: "precondition_failed" });
  });

  it("retains transport authentication, schema validation, and ETags", async () => {
    const fixture = setup();
    const app = createApp({
      application: fixture.application as CloudMarkupApplication,
      principalResolver: {
        resolve: (authorization) =>
          Promise.resolve(
            authorization === "Bearer environment-test" ? principal : null,
          ),
      },
      authenticationClock: () => new Date(now),
    });
    const path = `/v1/projects/${project.projectId}/environments`;
    expect((await app.request(path)).status).toBe(401);
    const headers = {
      Authorization: "Bearer environment-test",
      "Content-Type": "application/json",
      "Idempotency-Key": "create-environment-key",
    };
    expect(
      (
        await app.request(path, {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: "Live",
            environmentType: "production",
            organizationId: "org_foreign",
          }),
        })
      ).status,
    ).toBe(400);
    expect(fixture.createProjectEnvironment).not.toHaveBeenCalled();
    const response = await app.request(`${path}/${environment.environmentId}`, {
      headers,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(
      '"environment:env_production:v1"',
    );
  });
});
