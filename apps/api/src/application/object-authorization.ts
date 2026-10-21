import { ApplicationError } from "./errors.js";
import type { Principal } from "./identity.js";
import {
  isOrganizationRole,
  requireOrganizationPermission,
  type AuthorizedOrganizationContext,
  type OrganizationPermission,
  type OrganizationRole,
} from "./authorization.js";

export type PrincipalLifecycleState = "active" | "suspended" | "deleted";
export type MembershipLifecycleState = "active" | "suspended" | "deleted";
export type JobObjectKind = "validation" | "generation" | "export";

export interface MembershipAuthorizationRecord {
  readonly membershipId: string;
  readonly role: string;
  readonly status: MembershipLifecycleState;
}

export interface ProjectAuthorizationRecord {
  readonly organizationId: string;
  readonly projectId: string;
}

export interface ChildObjectAuthorizationRecord {
  readonly objectId: string;
  readonly organizationId: string;
  readonly projectId: string;
}

export interface OrganizationObjectAuthorizationRecord {
  readonly objectId: string;
  readonly organizationId: string;
}

export interface AuthorizationStore {
  getArtifact(
    artifactId: string,
  ): Promise<ChildObjectAuthorizationRecord | null>;
  getAuditEvent(
    auditEventId: string,
  ): Promise<OrganizationObjectAuthorizationRecord | null>;
  getIntegration(
    integrationId: string,
  ): Promise<OrganizationObjectAuthorizationRecord | null>;
  getJob(
    kind: JobObjectKind,
    jobId: string,
  ): Promise<ChildObjectAuthorizationRecord | null>;
  getMembership(
    principalId: string,
    organizationId: string,
  ): Promise<MembershipAuthorizationRecord | null>;
  getPrincipalState(
    principalId: string,
  ): Promise<PrincipalLifecycleState | null>;
  getProject(projectId: string): Promise<ProjectAuthorizationRecord | null>;
  getRevision(
    revisionId: string,
  ): Promise<ChildObjectAuthorizationRecord | null>;
}

function notFound(): ApplicationError {
  return new ApplicationError(
    "not_found",
    "The requested resource is unavailable.",
  );
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError(
    "authentication_required",
    "Authentication is required.",
  );
}

export class ObjectAuthorizationService {
  readonly #store: AuthorizationStore;

  constructor(store: AuthorizationStore) {
    this.#store = store;
  }

  async authorizeOrganization(
    principal: Principal,
    correlationId: string,
    organizationId: string,
    permission: OrganizationPermission,
  ): Promise<AuthorizedOrganizationContext> {
    await this.#requireActivePrincipal(principal);
    const membership = await this.#store.getMembership(
      principal.principalId,
      organizationId,
    );
    if (
      membership?.status !== "active" ||
      !isOrganizationRole(membership.role)
    ) {
      throw notFound();
    }

    requireOrganizationPermission(membership.role, permission);
    return {
      correlationId,
      membershipId: membership.membershipId,
      organizationId,
      principal,
      role: membership.role,
    };
  }

  async authorizeProject(
    principal: Principal,
    correlationId: string,
    projectId: string,
    permission: OrganizationPermission,
  ): Promise<AuthorizedOrganizationContext> {
    await this.#requireActivePrincipal(principal);
    const project = await this.#store.getProject(projectId);
    if (project === null) {
      throw notFound();
    }
    return this.authorizeOrganization(
      principal,
      correlationId,
      project.organizationId,
      permission,
    );
  }

  async authorizeRevision(
    principal: Principal,
    correlationId: string,
    projectId: string,
    revisionId: string,
    permission: OrganizationPermission,
  ): Promise<AuthorizedOrganizationContext> {
    return this.#authorizeProjectChild(
      principal,
      correlationId,
      projectId,
      await this.#afterActivePrincipal(principal, () =>
        this.#store.getRevision(revisionId),
      ),
      permission,
    );
  }

  async authorizeJob(
    principal: Principal,
    correlationId: string,
    projectId: string,
    kind: JobObjectKind,
    jobId: string,
    permission: OrganizationPermission,
  ): Promise<AuthorizedOrganizationContext> {
    return this.#authorizeProjectChild(
      principal,
      correlationId,
      projectId,
      await this.#afterActivePrincipal(principal, () =>
        this.#store.getJob(kind, jobId),
      ),
      permission,
    );
  }

  async authorizeArtifact(
    principal: Principal,
    correlationId: string,
    projectId: string,
    artifactId: string,
    permission: OrganizationPermission = "artifacts.read",
  ): Promise<AuthorizedOrganizationContext> {
    return this.#authorizeProjectChild(
      principal,
      correlationId,
      projectId,
      await this.#afterActivePrincipal(principal, () =>
        this.#store.getArtifact(artifactId),
      ),
      permission,
    );
  }

  async authorizeIntegration(
    principal: Principal,
    correlationId: string,
    organizationId: string,
    integrationId: string,
    permission: OrganizationPermission,
  ): Promise<AuthorizedOrganizationContext> {
    const integration = await this.#afterActivePrincipal(principal, () =>
      this.#store.getIntegration(integrationId),
    );
    if (integration?.organizationId !== organizationId) {
      throw notFound();
    }
    return this.authorizeOrganization(
      principal,
      correlationId,
      organizationId,
      permission,
    );
  }

  async authorizeAuditEvent(
    principal: Principal,
    correlationId: string,
    organizationId: string,
    auditEventId: string,
  ): Promise<AuthorizedOrganizationContext> {
    const event = await this.#afterActivePrincipal(principal, () =>
      this.#store.getAuditEvent(auditEventId),
    );
    if (event?.organizationId !== organizationId) {
      throw notFound();
    }
    return this.authorizeOrganization(
      principal,
      correlationId,
      organizationId,
      "audit.read",
    );
  }

  async #afterActivePrincipal<TValue>(
    principal: Principal,
    read: () => Promise<TValue>,
  ): Promise<TValue> {
    await this.#requireActivePrincipal(principal);
    return read();
  }

  async #authorizeProjectChild(
    principal: Principal,
    correlationId: string,
    projectId: string,
    child: ChildObjectAuthorizationRecord | null,
    permission: OrganizationPermission,
  ): Promise<AuthorizedOrganizationContext> {
    if (child?.projectId !== projectId) {
      throw notFound();
    }
    const project = await this.#store.getProject(projectId);
    if (project?.organizationId !== child.organizationId) {
      throw notFound();
    }
    return this.authorizeOrganization(
      principal,
      correlationId,
      child.organizationId,
      permission,
    );
  }

  async #requireActivePrincipal(principal: Principal): Promise<void> {
    const state = await this.#store.getPrincipalState(principal.principalId);
    if (state !== "active") {
      throw authenticationRequired();
    }
  }
}

export function roleFromAuthorizedContext(
  context: AuthorizedOrganizationContext,
): OrganizationRole {
  return context.role;
}
