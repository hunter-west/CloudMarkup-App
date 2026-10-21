import { describe, expect, it } from "vitest";

import { matchRoute, normalizePathname, type RouteId } from "./routes.js";

const canonicalRoutes: readonly (readonly [string, RouteId])[] = [
  ["/", "landing"],
  ["/sign-in", "sign-in"],
  ["/sign-up", "sign-in"],
  ["/signup", "sign-in"],
  ["/login", "sign-in"],
  ["/forgot-password", "sign-in"],
  ["/auth/callback", "auth-callback"],
  ["/account/gitlab/callback", "gitlab-link-callback"],
  ["/invitations/invitation-token", "invitation"],
  ["/denied", "denied"],
  ["/unsupported", "unsupported"],
  ["/help/connections", "connection-guidance"],
  ["/not-found", "not-found"],
  ["/settings/invitations", "account-invitations"],
  ["/settings/profile", "profile-settings"],
  ["/settings/preferences", "preference-settings"],
  ["/settings/security", "personal-security-settings"],
  ["/settings/integrations", "personal-integration-settings"],
  ["/organizations", "organizations"],
  ["/organizations/org-1/projects", "projects"],
  ["/organizations/org-1/projects/new", "project-new"],
  ["/organizations/org-1/templates", "templates"],
  ["/organizations/org-1/templates/template-1", "template-detail"],
  ["/organizations/org-1/billing", "billing"],
  ["/organizations/org-1/usage", "usage"],
  ["/organizations/org-1/settings/general", "organization-general-settings"],
  ["/organizations/org-1/settings/members", "organization-member-settings"],
  [
    "/organizations/org-1/settings/integrations",
    "organization-integration-settings",
  ],
  ["/organizations/org-1/settings/roles", "organization-role-settings"],
  ["/organizations/org-1/settings/policies", "organization-policy-settings"],
  ["/organizations/org-1/settings/security", "organization-security-settings"],
  ["/organizations/org-1/settings/data", "organization-data-settings"],
  ["/organizations/org-1/projects/project-1", "project-overview"],
  ["/organizations/org-1/projects/project-1/intent", "project-intent"],
  ["/organizations/org-1/projects/project-1/editor", "project-editor"],
  ["/organizations/org-1/projects/project-1/revisions", "project-revisions"],
  [
    "/organizations/org-1/projects/project-1/revisions/revision-1",
    "project-revision",
  ],
  [
    "/organizations/org-1/projects/project-1/exports/export-job-1",
    "solution-export-job",
  ],
  [
    "/organizations/org-1/projects/project-1/artifacts/artifact-1/review",
    "artifact-review",
  ],
  [
    "/organizations/org-1/projects/project-1/artifacts/artifact-1/export/zip",
    "artifact-export-zip",
  ],
  [
    "/organizations/org-1/projects/project-1/artifacts/artifact-1/export/github",
    "artifact-export-github",
  ],
  [
    "/organizations/org-1/projects/project-1/artifacts/artifact-1/export/gitlab",
    "artifact-export-gitlab",
  ],
  ["/development/visual-gallery", "development-gallery"],
];

describe("matchRoute", () => {
  it.each(canonicalRoutes)("matches %s as %s", (pathname, routeId) => {
    expect(matchRoute(pathname).id).toBe(routeId);
  });

  it("normalizes trailing slashes without changing the selected route", () => {
    expect(normalizePathname("/settings/profile///")).toBe("/settings/profile");
    expect(normalizePathname("/")).toBe("/");

    expect(matchRoute("/settings/profile/")).toEqual({
      id: "profile-settings",
      params: {},
      pathname: "/settings/profile",
    });
  });

  it("returns decoded dynamic values only as route selectors", () => {
    const match = matchRoute(
      "/organizations/team%20one/projects/project-1/revisions/revision%2F2",
    );

    expect(match).toEqual({
      id: "project-revision",
      params: {
        organizationId: "team one",
        projectId: "project-1",
        revisionId: "revision/2",
      },
      pathname:
        "/organizations/team%20one/projects/project-1/revisions/revision%2F2",
    });
  });

  it("matches the static project creation route before project identifiers", () => {
    expect(matchRoute("/organizations/org-1/projects/new")).toMatchObject({
      id: "project-new",
      params: { organizationId: "org-1" },
    });
  });

  it("uses the neutral not-found result for unmatched or malformed paths", () => {
    expect(matchRoute("/organizations/private/projects/unknown/other")).toEqual(
      {
        id: "not-found",
        params: {},
        pathname: "/organizations/private/projects/unknown/other",
      },
    );
    expect(matchRoute("/invitations/%E0%A4%A")).toMatchObject({
      id: "not-found",
      params: {},
    });
    expect(matchRoute("sign-in")).toMatchObject({
      id: "not-found",
      params: {},
    });
  });
});
