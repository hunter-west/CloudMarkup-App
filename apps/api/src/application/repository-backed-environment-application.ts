import { createHash } from "node:crypto";

import {
  projectEnvironmentV1Schema,
  type ProjectEnvironmentV1,
} from "@cloudmarkup/api-contract";

import {
  isOrganizationRole,
  permissionsForRole,
  type OrganizationPermission,
} from "./authorization.js";
import { ApplicationError } from "./errors.js";
import { requireRecentAuthentication } from "./identity.js";
import {
  RepositoryError,
  type AuthorizedOrganizationScope,
  type CloudMarkupRepository,
  type ProjectEnvironmentRecord,
} from "./persistence.js";
import type {
  CloudMarkupApplication,
  PrincipalContext,
  VersionedResult,
} from "./ports.js";

type EnvironmentApplication = Pick<
  CloudMarkupApplication,
  | "listProjectEnvironments"
  | "getProjectEnvironment"
  | "createProjectEnvironment"
  | "updateProjectEnvironment"
  | "deleteProjectEnvironment"
>;

export interface RepositoryBackedEnvironmentApplicationOptions {
  readonly clock?: () => Date;
  readonly identifierNamespace: string;
  readonly organizationForProject: (
    principal: PrincipalContext,
    projectId: string,
  ) => Promise<string | null> | string | null;
  readonly repository: CloudMarkupRepository;
}

function unavailable(): never {
  throw new ApplicationError(
    "not_found",
    "The requested resource is unavailable.",
  );
}

function precondition(): never {
  throw new ApplicationError(
    "precondition_failed",
    "The environment changed. Refresh and try again.",
  );
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function mapEnvironment(
  record: ProjectEnvironmentRecord,
): ProjectEnvironmentV1 {
  return projectEnvironmentV1Schema.parse({
    createdAt: record.createdAt,
    environmentType: record.environmentType,
    id: record.environmentId,
    lifecycleStatus: record.lifecycleStatus,
    name: record.name,
    projectId: record.projectId,
    ...(record.region === undefined ? {} : { region: record.region }),
    updatedAt: record.updatedAt,
    version: record.recordVersion,
  });
}

function versioned(
  record: ProjectEnvironmentRecord,
): VersionedResult<ProjectEnvironmentV1> {
  return {
    etag: `"environment:${record.environmentId}:v${String(record.recordVersion)}"`,
    value: mapEnvironment(record),
  };
}

function expectedVersion(environmentId: string, expectedEtag: string): number {
  const prefix = `"environment:${environmentId}:v`;
  if (!expectedEtag.startsWith(prefix) || !expectedEtag.endsWith('"'))
    return precondition();
  const raw = expectedEtag.slice(prefix.length, -1);
  const version = Number(raw);
  if (!/^[1-9][0-9]*$/u.test(raw) || !Number.isSafeInteger(version))
    return precondition();
  return version;
}

async function translate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    if (error instanceof RepositoryError) {
      switch (error.code) {
        case "not-found":
          return unavailable();
        case "access-denied":
          throw new ApplicationError(
            "access_denied",
            "This action is not available for the current account.",
          );
        case "version-conflict":
          return precondition();
        case "idempotency-conflict":
          throw new ApplicationError(
            "idempotency_key_reused",
            "The idempotency key was reused for different input.",
          );
        case "invalid-input":
          throw new ApplicationError(
            "invalid_request",
            "The environment request is invalid.",
          );
        case "persistence-unavailable":
          break;
      }
    }
    throw new ApplicationError(
      "service_unavailable",
      "Project environments are temporarily unavailable.",
    );
  }
}

/** Maps existing durable environment records to the public v1 application. */
export function createRepositoryBackedEnvironmentApplicationOverrides(
  options: RepositoryBackedEnvironmentApplicationOptions,
): EnvironmentApplication {
  if (!/^[a-z][a-z0-9-]{0,31}$/u.test(options.identifierNamespace)) {
    throw new TypeError("The environment identifier namespace is invalid.");
  }
  const repository = options.repository;
  const clock = options.clock ?? (() => new Date());

  async function scopeFor(
    principal: PrincipalContext,
    projectId: string,
    permission: OrganizationPermission,
  ): Promise<AuthorizedOrganizationScope> {
    const organizationId = await options.organizationForProject(
      principal,
      projectId,
    );
    if (organizationId === null) return unavailable();
    const scope = await repository.resolveOrganizationScope(
      principal,
      organizationId,
    );
    if (
      scope?.organizationId !== organizationId ||
      scope.principalId !== principal.principalId
    )
      return unavailable();
    if (
      !isOrganizationRole(scope.roleKey) ||
      !permissionsForRole(scope.roleKey).includes(permission) ||
      !scope.capabilities.includes(permission)
    ) {
      throw new ApplicationError(
        "access_denied",
        "This action is not available for the current account.",
      );
    }
    const project = await repository.getProject(scope, projectId);
    if (
      project?.projectId !== projectId ||
      project.organizationId !== organizationId ||
      project.lifecycleStatus === "deleted" ||
      project.lifecycleStatus === "deletion-pending"
    )
      return unavailable();
    if (
      permission !== "projects.read" &&
      project.lifecycleStatus !== "active"
    ) {
      throw new ApplicationError(
        "conflict",
        "Only an active project's environments can be changed.",
      );
    }
    return scope;
  }

  async function requireEnvironment(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    environmentId: string,
  ): Promise<ProjectEnvironmentRecord> {
    const record = await repository.getProjectEnvironment(
      scope,
      projectId,
      environmentId,
    );
    if (
      record?.organizationId !== scope.organizationId ||
      record.projectId !== projectId ||
      record.environmentId !== environmentId
    )
      return unavailable();
    return record;
  }

  return {
    listProjectEnvironments: (principal, projectId, page) =>
      translate(async () => {
        const scope = await scopeFor(principal, projectId, "projects.read");
        const records = await repository.listProjectEnvironments(
          scope,
          projectId,
        );
        if (
          records.some(
            (record) =>
              record.organizationId !== scope.organizationId ||
              record.projectId !== projectId,
          )
        )
          return unavailable();
        const type = page.filters["type"];
        const values = records.filter(
          (record) => type === undefined || record.environmentType === type,
        );
        const sort = page.sort ?? "name";
        if (!["name", "-name", "createdAt", "-createdAt"].includes(sort))
          throw new ApplicationError(
            "invalid_request",
            "The environment sort is invalid.",
          );
        const field = sort.endsWith("createdAt") ? "createdAt" : "name";
        values.sort((a, b) => {
          const left = a[field];
          const right = b[field];
          const order =
            left === right
              ? a.environmentId < b.environmentId
                ? -1
                : a.environmentId === b.environmentId
                  ? 0
                  : 1
              : left < right
                ? -1
                : 1;
          return sort.startsWith("-") ? -order : order;
        });
        const match =
          page.cursor === undefined
            ? undefined
            : /^environment-offset-([0-9]+)$/u.exec(page.cursor);
        const offset =
          page.cursor === undefined ? 0 : Number(match?.[1] ?? NaN);
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset > values.length ||
          !Number.isSafeInteger(page.limit) ||
          page.limit < 1 ||
          page.limit > 100
        )
          throw new ApplicationError(
            "invalid_request",
            "The environment page is invalid.",
          );
        const items = values
          .slice(offset, offset + page.limit)
          .map(mapEnvironment);
        const nextOffset = offset + items.length;
        return {
          items,
          ...(nextOffset < values.length
            ? { nextCursor: `environment-offset-${String(nextOffset)}` }
            : {}),
        };
      }),
    getProjectEnvironment: (principal, projectId, environmentId) =>
      translate(async () => {
        const scope = await scopeFor(principal, projectId, "projects.read");
        return versioned(
          await requireEnvironment(scope, projectId, environmentId),
        );
      }),
    createProjectEnvironment: (principal, projectId, input, idempotencyKey) =>
      translate(async () => {
        const scope = await scopeFor(
          principal,
          projectId,
          "environments.create",
        );
        const environmentId = `env_${options.identifierNamespace}_${digest([scope.organizationId, principal.principalId, projectId, idempotencyKey]).slice(0, 24)}`;
        return mapEnvironment(
          await repository.createProjectEnvironment(scope, {
            environmentType: input.environmentType,
            name: input.name,
            ...(input.region === undefined ? {} : { region: input.region }),
            environmentId,
            idempotencyKey,
            projectId,
            requestSha256: digest({ projectId, input }),
          }),
        );
      }),
    updateProjectEnvironment: (
      principal,
      projectId,
      environmentId,
      input,
      expectedEtag,
    ) =>
      translate(async () => {
        const scope = await scopeFor(principal, projectId, "projects.mutate");
        const current = await requireEnvironment(
          scope,
          projectId,
          environmentId,
        );
        const version = expectedVersion(environmentId, expectedEtag);
        if (current.recordVersion !== version) return precondition();
        if (current.lifecycleStatus !== "active") return unavailable();
        const region =
          input.region === undefined
            ? current.region
            : (input.region ?? undefined);
        return versioned(
          await repository.updateProjectEnvironment(scope, {
            environmentId,
            environmentType: input.environmentType,
            expectedRecordVersion: version,
            name: input.name,
            projectId,
            ...(region === undefined ? {} : { region }),
          }),
        );
      }),
    deleteProjectEnvironment: (
      principal,
      projectId,
      environmentId,
      expectedEtag,
      idempotencyKey,
    ) =>
      translate(async () => {
        const scope = await scopeFor(principal, projectId, "projects.mutate");
        await requireEnvironment(scope, projectId, environmentId);
        requireRecentAuthentication(principal, clock());
        // Parse the original version without rejecting a completed retry against
        // the current version: the repository claims idempotency before its CAS.
        const version = expectedVersion(environmentId, expectedEtag);
        return versioned(
          await repository.deleteProjectEnvironment(scope, {
            environmentId,
            expectedRecordVersion: version,
            idempotencyKey,
            projectId,
            requestSha256: digest({ projectId, environmentId, expectedEtag }),
          }),
        );
      }),
  };
}
