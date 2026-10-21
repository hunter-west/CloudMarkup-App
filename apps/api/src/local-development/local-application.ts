import type { CloudMarkupApplication } from "../application/ports.js";
import type {
  CloudMarkupRepository,
  ObjectStore,
} from "../application/persistence.js";
import { permissionsForRole } from "../application/authorization.js";
import {
  createRepositoryBackedApplication,
  type RepositoryBackedApplicationOptions,
} from "../application/repository-backed-application.js";
import {
  LOCAL_ORGANIZATIONS_BY_PRINCIPAL,
  LOCAL_PRINCIPAL_DISPLAY_NAMES,
} from "./local-principals.js";

export interface RepositoryBackedLocalApplicationOptions {
  readonly clock?: () => Date;
  readonly draftEditingLeases?: "required" | "disabled";
  readonly fallback: CloudMarkupApplication;
  readonly objectStore: ObjectStore;
  readonly repository: CloudMarkupRepository;
  readonly solution?: Pick<
    NonNullable<RepositoryBackedApplicationOptions["solutionRevisions"]>,
    "solutionRecords" | "validation"
  >;
}

export function createRepositoryBackedLocalApplication(
  options: RepositoryBackedLocalApplicationOptions,
): CloudMarkupApplication {
  return createRepositoryBackedApplication({
    draftEditingLeases: options.draftEditingLeases ?? "disabled",
    ...(options.solution === undefined
      ? {}
      : {
          solutionRevisions: {
            principalDisplayName: (principalId: string) =>
              LOCAL_PRINCIPAL_DISPLAY_NAMES[principalId] ?? null,
            ...options.solution,
          },
        }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    fallback: options.fallback,
    identifierNamespace: "local",
    objectStore: options.objectStore,
    organizationForProject: (principal) =>
      LOCAL_ORGANIZATIONS_BY_PRINCIPAL[principal.principalId] ?? null,
    organizationForRequestedScope: (principal, organizationId) =>
      LOCAL_ORGANIZATIONS_BY_PRINCIPAL[principal.principalId] === organizationId
        ? organizationId
        : null,
    repository: options.repository,
  });
}

export function localPermissionsForRole(
  role: Parameters<typeof permissionsForRole>[0],
): readonly string[] {
  return [...permissionsForRole(role)].sort();
}
