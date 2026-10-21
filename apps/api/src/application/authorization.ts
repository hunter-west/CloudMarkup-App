import {
  apiOperationsV1,
  type ApiOperationId,
} from "@cloudmarkup/api-contract";

import { ApplicationError } from "./errors.js";
import { requireRecentAuthentication, type Principal } from "./identity.js";

export const ORGANIZATION_ROLES = [
  "owner",
  "administrator",
  "editor",
  "viewer",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const AUTHORIZATION_POLICY_VERSION = "authorization-v2" as const;

export const ORGANIZATION_PERMISSIONS = [
  "organizations.read",
  "memberships.read",
  "memberships.manage",
  "memberships.assign-owner",
  "projects.read",
  "projects.create",
  "projects.mutate",
  "projects.delete",
  "environments.create",
  "revisions.create",
  "validation.run",
  "generation.run",
  "exports.run",
  "artifacts.read",
  "integrations.read",
  "integrations.manage",
  "audit.read",
  "commercial.summary.read",
  "commercial.expensive.use",
  "billing.manage",
  "usage.read-technical",
  "organizations.delete",
] as const;

export type OrganizationPermission = (typeof ORGANIZATION_PERMISSIONS)[number];

const viewerPermissions = [
  "organizations.read",
  "projects.read",
  "artifacts.read",
  "commercial.summary.read",
] as const satisfies readonly OrganizationPermission[];

const editorPermissions = [
  ...viewerPermissions,
  "projects.create",
  "projects.mutate",
  "environments.create",
  "revisions.create",
  "validation.run",
  "generation.run",
  "exports.run",
  "integrations.read",
  "commercial.expensive.use",
] as const satisfies readonly OrganizationPermission[];

const administratorPermissions = [
  ...editorPermissions,
  "memberships.read",
  "memberships.manage",
  "projects.delete",
  "integrations.manage",
  "audit.read",
  "billing.manage",
  "usage.read-technical",
] as const satisfies readonly OrganizationPermission[];

export const ROLE_PERMISSIONS: Readonly<
  Record<OrganizationRole, readonly OrganizationPermission[]>
> = {
  administrator: administratorPermissions,
  editor: editorPermissions,
  owner: [
    ...administratorPermissions,
    "memberships.assign-owner",
    "organizations.delete",
  ],
  viewer: viewerPermissions,
};

type ProtectedOperationId = {
  [
    TOperationId in ApiOperationId
  ]: (typeof apiOperationsV1)[TOperationId]["security"] extends "principal"
    ? TOperationId
    : never;
}[ApiOperationId];

export type ApiAuthorizationRequirement =
  | { readonly kind: "principal" }
  | {
      readonly kind: "organization-permission";
      readonly permission: OrganizationPermission;
    };

/** Adding a protected operation fails type-check until its policy is explicit. */
export const API_AUTHORIZATION_REQUIREMENTS = {
  // Each staff adapter additionally checks canonical platform authorization in its transaction.
  "staff.access.get": { kind: "principal" },
  "staff.accounts.list": { kind: "principal" },
  "staff.accounts.get": { kind: "principal" },
  "staff.accounts.act": { kind: "principal" },
  "gitlab-export-reviews.create": {
    kind: "organization-permission",
    permission: "exports.run",
  },
  "gitlab-exports.advance": {
    kind: "organization-permission",
    permission: "exports.run",
  },
  "gitlab-exports.get": {
    kind: "organization-permission",
    permission: "integrations.read",
  },
  "gitlab-projects.discover": {
    permission: "integrations.read",
    kind: "organization-permission",
  },
  "gitlab-project-selections.list": {
    permission: "integrations.read",
    kind: "organization-permission",
  },
  "gitlab-project-selections.update": {
    permission: "integrations.manage",
    kind: "organization-permission",
  },
  "gitlab-link-intents.create": {
    kind: "organization-permission",
    permission: "integrations.manage",
  },
  "gitlab-link-completions.create": {
    kind: "organization-permission",
    permission: "integrations.manage",
  },
  "gitlab-connections.list": {
    kind: "organization-permission",
    permission: "integrations.read",
  },
  "gitlab-connections.get": {
    kind: "organization-permission",
    permission: "integrations.read",
  },
  "gitlab-connections.disconnect": {
    kind: "organization-permission",
    permission: "integrations.manage",
  },
  "account.authenticator.get": { kind: "principal" },
  "account.authenticator.start": { kind: "principal" },
  "account.authenticator.change": { kind: "principal" },
  "account.credentials.get": { kind: "principal" },
  "account.credentials.change": { kind: "principal" },
  "account.sessions.list": { kind: "principal" },
  "account.sessions.change": { kind: "principal" },
  "organization-members.list": {
    kind: "organization-permission",
    permission: "memberships.read",
  },
  "account.membership.get": { kind: "principal" },
  // The application checks manager/owner authority per command. Actor-only leave
  // and immutable receipt replay remain available after loss of membership.
  "organization-members.change": { kind: "principal" },
  "organization-member-invitations.create": {
    kind: "organization-permission",
    permission: "memberships.manage",
  },
  "organization-member-invitations.list": {
    kind: "organization-permission",
    permission: "memberships.manage",
  },
  "account.invitations.list": { kind: "principal" },
  "account.invitations.accept": { kind: "principal" },
  "account.invitations.decline": { kind: "principal" },
  "account.profile.get": { kind: "principal" },
  "account.profile.update": { kind: "principal" },
  "account.photo.get": { kind: "principal" },
  "account.photo.update": { kind: "principal" },
  "account.workspaces.get": { kind: "principal" },
  "account.workspaces.list": { kind: "principal" },
  "account.organizations.create": { kind: "principal" },
  "account.personal-workspace.create": { kind: "principal" },
  "beta-infrastructure-jobs.create": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "beta-infrastructure-jobs.get": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "beta-infrastructure-jobs.credits.get": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "beta-infrastructure-jobs.cancel": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "beta-infrastructure-proposals.create": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "ai-intent-previews.accept": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "accepted-intents.get": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "ai-intent-previews.create": {
    kind: "organization-permission",
    permission: "commercial.expensive.use",
  },
  "ai-intent-previews.acknowledge": {
    kind: "organization-permission",
    permission: "commercial.expensive.use",
  },
  "organization-invitations.create": {
    kind: "organization-permission",
    permission: "memberships.manage",
  },
  "organization-invitations.revoke": {
    kind: "organization-permission",
    permission: "memberships.manage",
  },
  "organization-invitations.accept": { kind: "principal" },
  "billing.workspace.get": {
    kind: "organization-permission",
    permission: "commercial.summary.read",
  },
  "billing.checkout.create": {
    kind: "organization-permission",
    permission: "billing.manage",
  },
  "billing.top-ups.get": {
    kind: "organization-permission",
    permission: "commercial.summary.read",
  },
  "billing.top-ups.checkout.create": {
    kind: "organization-permission",
    permission: "billing.manage",
  },
  "billing.portal.create": {
    kind: "organization-permission",
    permission: "billing.manage",
  },
  "artifacts.get": {
    kind: "organization-permission",
    permission: "artifacts.read",
  },
  "artifacts.list": {
    kind: "organization-permission",
    permission: "artifacts.read",
  },
  "audit-events.list": {
    kind: "organization-permission",
    permission: "audit.read",
  },
  "commercial.credit-overview.get": {
    kind: "organization-permission",
    permission: "commercial.summary.read",
  },
  "commercial.credit-balance.get": {
    kind: "organization-permission",
    permission: "commercial.summary.read",
  },
  "commercial.current-plan.get": {
    kind: "organization-permission",
    permission: "commercial.summary.read",
  },
  "continuous-conformance.get": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "continuous-conformance.export-diagram": {
    kind: "organization-permission",
    permission: "exports.run",
  },
  "continuous-conformance.review-action": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "downloads.list": {
    kind: "organization-permission",
    permission: "artifacts.read",
  },
  "project-editing-leases.get": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "project-editing-leases.acquire": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "project-editing-leases.renew": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "project-editing-leases.release": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "drafts.apply-command": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "drafts.get": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "drafts.save": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "environments.create": {
    kind: "organization-permission",
    permission: "environments.create",
  },
  "environments.delete": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "environments.get": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "environments.list": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "environments.update": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "export-jobs.create": {
    kind: "organization-permission",
    permission: "exports.run",
  },
  "export-jobs.get": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "solution-export-artifacts.diff": {
    kind: "organization-permission",
    permission: "artifacts.read",
  },
  "solution-export-artifacts.file-preview": {
    kind: "organization-permission",
    permission: "artifacts.read",
  },
  "solution-export-artifacts.get": {
    kind: "organization-permission",
    permission: "artifacts.read",
  },
  "solution-export-download-grants.create": {
    kind: "organization-permission",
    permission: "artifacts.read",
  },
  "solution-export-download-grants.consume": {
    kind: "organization-permission",
    permission: "artifacts.read",
  },
  "solution-export-jobs.cancel": {
    kind: "organization-permission",
    permission: "exports.run",
  },
  "solution-export-jobs.create": {
    kind: "organization-permission",
    permission: "exports.run",
  },
  "solution-export-jobs.get": {
    kind: "organization-permission",
    permission: "artifacts.read",
  },
  "solution-export-jobs.credits.get": {
    kind: "organization-permission",
    permission: "artifacts.read",
  },
  "generation-jobs.create": {
    kind: "organization-permission",
    permission: "generation.run",
  },
  "generation-jobs.get": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "github-repository-discovery.read": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "github-repository-imports.create": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "github-repository-imports.list": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "github-repository-import-reviews.create": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "github-repository-refresh-subscriptions.create": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "github-export-previews.create": {
    kind: "organization-permission",
    permission: "exports.run",
  },
  "github-exports.create": {
    kind: "organization-permission",
    permission: "exports.run",
  },
  "github-installation-link-completions.create": {
    kind: "organization-permission",
    permission: "integrations.manage",
  },
  "github-installation-link-intents.create": {
    kind: "organization-permission",
    permission: "integrations.manage",
  },
  "github-installations.list": {
    kind: "organization-permission",
    permission: "integrations.read",
  },
  "github-repositories.list": {
    kind: "organization-permission",
    permission: "integrations.read",
  },
  "github-repository-branches.list": {
    kind: "organization-permission",
    permission: "integrations.read",
  },
  "integrations.list": {
    kind: "organization-permission",
    permission: "integrations.read",
  },
  "memberships.list": {
    kind: "organization-permission",
    permission: "memberships.read",
  },
  "organizations.delete": {
    kind: "organization-permission",
    permission: "organizations.delete",
  },
  "organizations.get": {
    kind: "organization-permission",
    permission: "organizations.read",
  },
  "organizations.list": { kind: "principal" },
  "preferences.get": { kind: "principal" },
  "preferences.update": { kind: "principal" },
  "principal.get": { kind: "principal" },
  "projects.archive": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "projects.create": {
    kind: "organization-permission",
    permission: "projects.create",
  },
  "projects.delete": {
    kind: "organization-permission",
    permission: "projects.delete",
  },
  "projects.get": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "projects.list": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "projects.rename": {
    kind: "organization-permission",
    permission: "projects.mutate",
  },
  "revisions.create": {
    kind: "organization-permission",
    permission: "revisions.create",
  },
  "revisions.get": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "revisions.list": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "solution-revisions.create": {
    kind: "organization-permission",
    permission: "revisions.create",
  },
  "solution-revisions.get": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "solution-revisions.list": {
    kind: "organization-permission",
    permission: "projects.read",
  },
  "validation-runs.create": {
    kind: "organization-permission",
    permission: "validation.run",
  },
  "validation-runs.get": {
    kind: "organization-permission",
    permission: "projects.read",
  },
} as const satisfies Readonly<
  Record<ProtectedOperationId, ApiAuthorizationRequirement>
>;

export interface AuthorizedOrganizationContext {
  readonly correlationId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly principal: Principal;
  readonly role: OrganizationRole;
}

export type SensitiveActionFamily =
  "role" | "integration" | "billing" | "export" | "destructive";

export interface SensitiveAuditEvent {
  readonly action: string;
  readonly actorPrincipalId: string;
  readonly authorizationPolicyVersion: typeof AUTHORIZATION_POLICY_VERSION;
  readonly correlationId: string;
  readonly family: SensitiveActionFamily;
  readonly occurredAt: string;
  readonly organizationId: string;
  readonly outcome: "succeeded" | "denied" | "failed";
  readonly safeSummary: string;
  readonly targetId?: string;
  readonly targetKind:
    | "organization"
    | "membership"
    | "project"
    | "artifact"
    | "integration"
    | "billing-account"
    | "job";
}

export interface SensitiveAuditSink {
  append(event: SensitiveAuditEvent): Promise<void>;
}

export function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

export function permissionsForRole(
  role: OrganizationRole,
): readonly OrganizationPermission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleAllows(
  role: OrganizationRole,
  permission: OrganizationPermission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function requireOrganizationPermission(
  role: OrganizationRole,
  permission: OrganizationPermission,
): void {
  if (!roleAllows(role, permission)) {
    throw new ApplicationError(
      "access_denied",
      "This action is not available for the current account.",
    );
  }
}

export async function runSensitiveAction<TValue>(input: {
  readonly action: string;
  readonly auditSink: SensitiveAuditSink;
  readonly context: AuthorizedOrganizationContext;
  readonly family: SensitiveActionFamily;
  readonly now: () => Date;
  readonly operation: () => Promise<TValue> | TValue;
  readonly permission: OrganizationPermission;
  readonly safeSummary: string;
  readonly targetId?: string;
  readonly targetKind: SensitiveAuditEvent["targetKind"];
}): Promise<TValue> {
  const baseEvent = {
    action: input.action,
    actorPrincipalId: input.context.principal.principalId,
    authorizationPolicyVersion: AUTHORIZATION_POLICY_VERSION,
    correlationId: input.context.correlationId,
    family: input.family,
    organizationId: input.context.organizationId,
    safeSummary: input.safeSummary,
    ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
    targetKind: input.targetKind,
  } as const;

  try {
    requireOrganizationPermission(input.context.role, input.permission);
    requireRecentAuthentication(input.context.principal, input.now());
  } catch (error) {
    await input.auditSink.append({
      ...baseEvent,
      occurredAt: input.now().toISOString(),
      outcome: "denied",
    });
    throw error;
  }

  try {
    const result = await input.operation();
    await input.auditSink.append({
      ...baseEvent,
      occurredAt: input.now().toISOString(),
      outcome: "succeeded",
    });
    return result;
  } catch (error) {
    await input.auditSink.append({
      ...baseEvent,
      occurredAt: input.now().toISOString(),
      outcome: "failed",
    });
    throw error;
  }
}
