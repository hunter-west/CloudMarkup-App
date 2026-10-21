import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import type { RdsDataApiDatabase } from "./adapters/persistence/rds-data-driver.js";
import type {
  AuthorizedOrganizationScope,
  CloudMarkupRepository,
  ObjectStore,
} from "./application/persistence.js";
import {
  ProductionIdentityApplication,
  productionIdentityOverrides,
} from "./application/production-identity-application.js";
import type {
  CloudMarkupApplication,
  PrincipalContext,
  PrincipalResolver,
} from "./application/ports.js";
import {
  createProductionRepositoryBackedApplication,
  ProductionReadiness,
  PRODUCTION_READINESS_CHECK_NAME,
} from "./production-composition.js";

const unusedApplication = {} as CloudMarkupApplication;
const anonymousPrincipalResolver: PrincipalResolver = {
  resolve: () => Promise.resolve(null),
};
const principal: PrincipalContext = {
  authenticatedAt: "2026-09-02T12:00:00.000Z",
  authenticationSource: "cognito",
  correlationId: "correlation-beta",
  expiresAt: "2026-09-02T12:30:00.000Z",
  principalId: "principal_beta_subject",
  sessionId: "session-beta",
};

function appWithReadiness(options: {
  readonly databaseQuery: () => Promise<unknown>;
  readonly readBucketVersioning: () => Promise<unknown>;
}) {
  const database = {
    query: options.databaseQuery,
  } as unknown as RdsDataApiDatabase;
  const s3 = {
    send: options.readBucketVersioning,
  } as unknown as S3Client;
  return createApp({
    application: unusedApplication,
    principalResolver: anonymousPrincipalResolver,
    readiness: new ProductionReadiness({
      bucket: "cloudmarkup-beta-content",
      database,
      s3,
    }),
  });
}

describe("production readiness", () => {
  it("returns a contract-valid ready response when PostgreSQL and S3 are ready", async () => {
    expect(PRODUCTION_READINESS_CHECK_NAME).toBe("cognito-rds-s3-v1");
    const databaseQuery = vi.fn(() => Promise.resolve({ rows: [] }));
    const readBucketVersioning = vi.fn(() =>
      Promise.resolve({ Status: "Enabled" }),
    );
    const app = appWithReadiness({ databaseQuery, readBucketVersioning });

    const response = await app.request("/ready");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checks: [
        { name: PRODUCTION_READINESS_CHECK_NAME, status: "ready" },
        { name: "postgresql", status: "ready" },
        { name: "object-storage", status: "ready" },
      ],
      contractVersion: 1,
      service: "cloudmarkup-api",
      status: "ready",
    });
    expect(databaseQuery).toHaveBeenCalledOnce();
    expect(readBucketVersioning).toHaveBeenCalledOnce();
  });

  it("returns bounded not-ready evidence instead of an internal error", async () => {
    const app = appWithReadiness({
      databaseQuery: () => Promise.reject(new Error("unavailable")),
      readBucketVersioning: () => Promise.resolve({ Status: "Suspended" }),
    });

    const response = await app.request("/ready");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      checks: [
        { name: PRODUCTION_READINESS_CHECK_NAME, status: "ready" },
        { name: "postgresql", status: "not-ready" },
        { name: "object-storage", status: "not-ready" },
      ],
      contractVersion: 1,
      service: "cloudmarkup-api",
      status: "not-ready",
    });
  });
});

describe("production application composition", () => {
  it("routes an explicit multi-org selection through the production tenant resolvers", async () => {
    const identity = new ProductionIdentityApplication(
      {} as RdsDataApiDatabase,
    );
    const organizationForRequestedScope = vi
      .spyOn(identity, "organizationForRequestedScope")
      .mockImplementation((_principal, organizationId) =>
        Promise.resolve(
          organizationId === "org_beta_second" ? organizationId : null,
        ),
      );
    const organizationForProject = vi
      .spyOn(identity, "organizationForProject")
      .mockResolvedValue(null);
    const scope: AuthorizedOrganizationScope = {
      ...principal,
      capabilities: ["projects.read"],
      membershipId: "membership_beta_second",
      organizationId: "org_beta_second",
      roleKey: "viewer",
    };
    const resolveOrganizationScope = vi.fn().mockResolvedValue(scope);
    const listProjects = vi.fn().mockResolvedValue({ items: [] });
    const getProject = vi.fn();
    const application = createProductionRepositoryBackedApplication(identity, {
      fallback: {} as CloudMarkupApplication,
      identifierNamespace: "beta",
      objectStore: {} as ObjectStore,
      repository: {
        getProject,
        listProjects,
        resolveOrganizationScope,
      } as unknown as CloudMarkupRepository,
    });

    await expect(
      application.listProjects(principal, "org_beta_second", {
        filters: {},
        limit: 25,
      }),
    ).resolves.toEqual({ items: [] });
    expect(organizationForRequestedScope).toHaveBeenCalledWith(
      principal,
      "org_beta_second",
    );
    expect(resolveOrganizationScope).toHaveBeenCalledWith(
      principal,
      "org_beta_second",
    );

    await expect(
      application.listProjects(principal, "org_beta_foreign", {
        filters: {},
        limit: 25,
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      application.getProject(principal, "project_beta_foreign"),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(organizationForProject).toHaveBeenCalledWith(
      principal,
      "project_beta_foreign",
    );
    expect(resolveOrganizationScope).toHaveBeenCalledTimes(1);
    expect(getProject).not.toHaveBeenCalled();
  });

  it("binds the read-only membership implementation into production overrides", async () => {
    const identity = new ProductionIdentityApplication(
      {} as RdsDataApiDatabase,
    );
    const listMemberships = vi
      .spyOn(identity, "listMemberships")
      .mockResolvedValue({ items: [] });

    const overrides = productionIdentityOverrides(identity);

    expect(Object.keys(overrides).sort()).toEqual([
      "getCurrentPrincipal",
      "getOrganization",
      "listMemberships",
      "listOrganizations",
    ]);
    await expect(
      overrides.listMemberships?.(principal, "org_beta_subject", {
        filters: {},
        limit: 100,
      }),
    ).resolves.toEqual({ items: [] });
    expect(listMemberships).toHaveBeenCalledWith(
      principal,
      "org_beta_subject",
      { filters: {}, limit: 100 },
    );
  });
});
