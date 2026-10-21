export const routeIds = [
  "landing",
  "sign-in",
  "auth-callback",
  "gitlab-link-callback",
  "invitation",
  "denied",
  "unsupported",
  "connection-guidance",
  "not-found",
  "staff-accounts",
  "account-invitations",
  "profile-settings",
  "preference-settings",
  "personal-security-settings",
  "personal-integration-settings",
  "organizations",
  "dashboard",
  "projects",
  "project-new",
  "templates",
  "template-detail",
  "billing",
  "usage",
  "organization-general-settings",
  "organization-member-settings",
  "organization-integration-settings",
  "organization-role-settings",
  "organization-policy-settings",
  "organization-security-settings",
  "organization-data-settings",
  "project-overview",
  "project-intent",
  "project-editor",
  "project-revisions",
  "project-revision",
  "solution-export-job",
  "artifact-review",
  "artifact-export-zip",
  "artifact-export-github",
  "artifact-export-gitlab",
  "development-gallery",
] as const;

export type RouteId = (typeof routeIds)[number];

export type RouteParameter =
  | "invitationId"
  | "organizationId"
  | "templateId"
  | "projectId"
  | "revisionId"
  | "exportJobId"
  | "artifactId";

/**
 * Route parameters are untrusted selectors. They do not establish identity,
 * organization membership, ownership, permission, or entitlement.
 */
export type RouteParameters = Readonly<Partial<Record<RouteParameter, string>>>;

export interface RouteMatch {
  readonly id: RouteId;
  readonly params: RouteParameters;
  readonly pathname: string;
}

interface RouteDefinition {
  readonly id: Exclude<RouteId, "not-found"> | "not-found";
  readonly pattern: string;
}

const routeDefinitions = [
  { id: "landing", pattern: "/" },
  { id: "sign-in", pattern: "/sign-in" },
  { id: "sign-in", pattern: "/login" },
  { id: "sign-in", pattern: "/sign-up" },
  { id: "sign-in", pattern: "/signup" },
  { id: "sign-in", pattern: "/forgot-password" },
  { id: "auth-callback", pattern: "/auth/callback" },
  { id: "gitlab-link-callback", pattern: "/account/gitlab/callback" },
  { id: "invitation", pattern: "/invitations/:invitationId" },
  { id: "denied", pattern: "/denied" },
  { id: "unsupported", pattern: "/unsupported" },
  { id: "connection-guidance", pattern: "/help/connections" },
  { id: "not-found", pattern: "/not-found" },
  { id: "staff-accounts", pattern: "/staff/accounts" },
  { id: "account-invitations", pattern: "/settings/invitations" },
  { id: "profile-settings", pattern: "/settings/profile" },
  { id: "preference-settings", pattern: "/settings/preferences" },
  { id: "personal-security-settings", pattern: "/settings/security" },
  { id: "personal-integration-settings", pattern: "/settings/integrations" },
  { id: "organizations", pattern: "/organizations" },
  {
    id: "project-new",
    pattern: "/organizations/:organizationId/projects/new",
  },
  { id: "dashboard", pattern: "/organizations/:organizationId/dashboard" },
  { id: "projects", pattern: "/organizations/:organizationId/projects" },
  { id: "templates", pattern: "/organizations/:organizationId/templates" },
  {
    id: "template-detail",
    pattern: "/organizations/:organizationId/templates/:templateId",
  },
  { id: "billing", pattern: "/organizations/:organizationId/billing" },
  { id: "usage", pattern: "/organizations/:organizationId/usage" },
  {
    id: "organization-general-settings",
    pattern: "/organizations/:organizationId/settings/general",
  },
  {
    id: "organization-member-settings",
    pattern: "/organizations/:organizationId/settings/members",
  },
  {
    id: "organization-integration-settings",
    pattern: "/organizations/:organizationId/settings/integrations",
  },
  {
    id: "organization-role-settings",
    pattern: "/organizations/:organizationId/settings/roles",
  },
  {
    id: "organization-policy-settings",
    pattern: "/organizations/:organizationId/settings/policies",
  },
  {
    id: "organization-security-settings",
    pattern: "/organizations/:organizationId/settings/security",
  },
  {
    id: "organization-data-settings",
    pattern: "/organizations/:organizationId/settings/data",
  },
  {
    id: "project-intent",
    pattern: "/organizations/:organizationId/projects/:projectId/intent",
  },
  {
    id: "project-editor",
    pattern: "/organizations/:organizationId/projects/:projectId/editor",
  },
  {
    id: "project-revisions",
    pattern: "/organizations/:organizationId/projects/:projectId/revisions",
  },
  {
    id: "project-revision",
    pattern:
      "/organizations/:organizationId/projects/:projectId/revisions/:revisionId",
  },
  {
    id: "solution-export-job",
    pattern:
      "/organizations/:organizationId/projects/:projectId/exports/:exportJobId",
  },
  {
    id: "artifact-review",
    pattern:
      "/organizations/:organizationId/projects/:projectId/artifacts/:artifactId/review",
  },
  {
    id: "artifact-export-zip",
    pattern:
      "/organizations/:organizationId/projects/:projectId/artifacts/:artifactId/export/zip",
  },
  {
    id: "artifact-export-gitlab",
    pattern:
      "/organizations/:organizationId/projects/:projectId/artifacts/:artifactId/export/gitlab",
  },
  {
    id: "artifact-export-github",
    pattern:
      "/organizations/:organizationId/projects/:projectId/artifacts/:artifactId/export/github",
  },
  {
    id: "project-overview",
    pattern: "/organizations/:organizationId/projects/:projectId",
  },
  {
    id: "development-gallery",
    pattern: "/development/visual-gallery",
  },
] as const satisfies readonly RouteDefinition[];

const emptyParameters: RouteParameters = Object.freeze({});

export function normalizePathname(pathname: string): string {
  if (pathname === "" || pathname === "/") {
    return "/";
  }

  return pathname.replace(/\/+$/u, "");
}

export function matchRoute(pathname: string): RouteMatch {
  const normalizedPathname = normalizePathname(pathname);

  if (!normalizedPathname.startsWith("/")) {
    return Object.freeze({
      id: "not-found",
      params: emptyParameters,
      pathname: normalizedPathname,
    });
  }

  const pathSegments = getSegments(normalizedPathname);

  for (const definition of routeDefinitions) {
    const patternSegments = getSegments(definition.pattern);

    if (patternSegments.length !== pathSegments.length) {
      continue;
    }

    const params: Partial<Record<RouteParameter, string>> = {};
    let matches = true;

    for (let index = 0; index < patternSegments.length; index += 1) {
      const patternSegment = patternSegments[index];
      const pathSegment = pathSegments[index];

      if (patternSegment === undefined || pathSegment === undefined) {
        matches = false;
        break;
      }

      if (!patternSegment.startsWith(":")) {
        if (patternSegment !== pathSegment) {
          matches = false;
          break;
        }
        continue;
      }

      const parameterName = patternSegment.slice(1) as RouteParameter;
      const decodedValue = decodeSelector(pathSegment);

      if (decodedValue === undefined) {
        matches = false;
        break;
      }

      params[parameterName] = decodedValue;
    }

    if (matches) {
      return Object.freeze({
        id: definition.id,
        params: Object.freeze(params),
        pathname: normalizedPathname,
      });
    }
  }

  return Object.freeze({
    id: "not-found",
    params: emptyParameters,
    pathname: normalizedPathname,
  });
}

function getSegments(pathname: string): readonly string[] {
  if (pathname === "/") {
    return [];
  }

  if (!pathname.startsWith("/")) {
    return [pathname];
  }

  return pathname.slice(1).split("/");
}

function decodeSelector(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}
