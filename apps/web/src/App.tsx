import { AccountInvitationsPage } from "./features/organizations/AccountInvitationsPage.js";
import type { CurrentPrincipalV1 } from "@cloudmarkup/api-contract";
import { BrandLockup, StatusBadge } from "@cloudmarkup/ui";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import { AppErrorBoundary } from "./app/AppErrorBoundary.js";
import { BillingReturnPage } from "./features/billing/BillingReturnPage.js";
import { readBillingWindowReturn } from "./features/billing/billing-hosted-window.js";
import {
  AssistantWorkspaceProvider,
  type AssistantWorkspaceHostInputV1,
} from "./features/assistant/index.js";
import {
  AuthenticatedSessionBoundary,
  cloudMarkupQueryKeys,
  useOptionalCloudMarkupQueryRuntime,
} from "./api/index.js";
import {
  AuthCallbackPage,
  InvitationPage,
  SignInPage,
  PublicEntrySessionBoundary,
} from "./features/auth/AuthPages.js";
import { LandingPage } from "./features/auth/LandingPage.js";
import {
  signInPathForReturn,
  signInReturnPathFromSearch,
} from "./features/auth/sign-in-return-path.js";
import { CognitoSignOutProvider } from "./features/auth/CognitoSignOutProvider.js";
import { LocalOwnerSignInPage } from "./features/auth/LocalOwnerSignInPage.js";
import type { LocalOwnerBrowserSession } from "./features/auth/local-owner-browser-auth.js";
import { LocalOwnerSessionProvider } from "./features/auth/local-owner-session-context.js";
import { useOptionalLocalOwnerSession } from "./features/auth/local-owner-session.js";
import { mayRenderLocalMockIdentity } from "./features/auth/mock-identity-boundary.js";
import {
  BillingPage,
  UsagePage,
} from "./features/billing/BillingUsagePages.js";
import { ConnectionGuidancePage } from "./features/editor/ConnectionGuidancePage.js";
import {
  ArtifactReviewPage,
  EditorMain,
  EditorRoute,
  ExportConfirmationPage,
  GitHubExportPage,
  GitLabExportPage,
  RevisionDetailPage,
  RevisionsPage,
  SolutionExportPage,
  TemplateDetailPage,
  TemplatesPage,
} from "./app/DeferredRoutes.js";
import type { CandidateReviewHostInputV1 } from "./features/generation/index.js";
import { DashboardPage } from "./features/dashboard/DashboardPage.js";
import { OrganizationsPage } from "./features/organizations/OrganizationPages.js";
import {
  NewProjectPage,
  ProjectIntentPage,
  ProjectOverviewPage,
  ProjectsPage,
} from "./features/projects/ProjectPages.js";
import {
  OrganizationSettingsPage,
  PersonalSettingsPage,
} from "./features/settings/SettingsPages.js";
import {
  NotFoundPage,
  PermissionDeniedPage,
  UnsupportedPage,
} from "./features/system/SystemPages.js";
import {
  localMockIdentity,
  localMockProjectIds,
} from "./mock/local-mock-context.js";
import { UsabilityEventsProvider } from "./instrumentation/UsabilityEventsProvider.js";
import { NotificationProvider } from "./notifications/index.js";
import {
  ExperiencePreferenceProvider,
  ModePreferenceProvider,
} from "./preferences/index.js";
import {
  AppLink,
  RouterProvider,
  useAppLocation,
  useNavigate,
  useRouteMatch,
} from "./routing/index.js";
import type { RouteId, RouteMatch } from "./routing/index.js";
import { AppShell, type AppShellIdentity } from "./shell/AppShell.js";
import { GitHubLinkCallbackPage } from "./features/exports/GitHubLinkCallbackPage.js";
import { readAndRemoveGitHubInstallationLinkCallback } from "./features/exports/github-installation-link-callback.js";

import { GitLabLinkCallbackPage } from "./features/exports/GitLabLinkCallbackPage.js";
import { readAndRemoveGitLabLinkCallback } from "./features/exports/gitlab-link-callback.js";

const publicRouteIds: ReadonlySet<RouteId> = new Set([
  "landing",
  "auth-callback",
  "invitation",
  "sign-in",
]);

const StaffAccountsPage = lazy(async () => ({
  default: (await import("./features/staff/StaffAccountsPage.js"))
    .StaffAccountsPage,
}));

export interface AppProps {
  readonly assistantWorkspace?: AssistantWorkspaceHostInputV1;
  readonly candidateReview?: CandidateReviewHostInputV1;
  readonly developmentGallery?: ReactNode;
  readonly localOwnerSession?: LocalOwnerBrowserSession;
}

export function App({
  assistantWorkspace,
  candidateReview,
  developmentGallery,
  localOwnerSession,
}: AppProps = {}) {
  return (
    <AppErrorBoundary>
      <AssistantWorkspaceProvider value={assistantWorkspace}>
        <RouterProvider>
          {localOwnerSession === undefined ? (
            <CognitoSignOutProvider>
              <ApplicationRouteBoundary
                candidateReview={candidateReview}
                developmentGallery={developmentGallery}
              />
            </CognitoSignOutProvider>
          ) : (
            <LocalOwnerSessionProvider session={localOwnerSession}>
              <ApplicationRouteBoundary
                candidateReview={candidateReview}
                developmentGallery={developmentGallery}
              />
            </LocalOwnerSessionProvider>
          )}
        </RouterProvider>
      </AssistantWorkspaceProvider>
    </AppErrorBoundary>
  );
}

function ApplicationRouteBoundary({
  candidateReview,
  developmentGallery,
}: {
  readonly candidateReview: CandidateReviewHostInputV1 | undefined;
  readonly developmentGallery: ReactNode | undefined;
}) {
  const route = useRouteMatch();
  const location = useAppLocation();
  const localOwner = useOptionalLocalOwnerSession();
  const [gitlabCallback] = useState(() =>
    route.id === "gitlab-link-callback"
      ? readAndRemoveGitLabLinkCallback()
      : undefined,
  );
  const [githubCallback] = useState(() =>
    route.id === "organization-integration-settings" ||
    route.id === "artifact-export-github"
      ? readAndRemoveGitHubInstallationLinkCallback()
      : { present: false },
  );

  const [billingReturn] = useState(() =>
    localOwner === null && route.id === "billing"
      ? readBillingWindowReturn()
      : null,
  );
  if (localOwner === null && route.id === "billing" && billingReturn !== null)
    return (
      <PublicShell>
        <BillingReturnPage returnId={billingReturn} />
      </PublicShell>
    );

  if (route.id === "gitlab-link-callback")
    return (
      <PublicShell>
        <GitLabLinkCallbackPage
          {...(gitlabCallback ? { callback: gitlabCallback } : {})}
        />
      </PublicShell>
    );

  if (githubCallback.present) {
    return (
      <PublicShell>
        <GitHubLinkCallbackPage
          {...(githubCallback.callback === undefined
            ? {}
            : { callback: githubCallback.callback })}
        />
      </PublicShell>
    );
  }

  if (publicRouteIds.has(route.id)) {
    return (
      <PublicShell>
        {localOwner === null ? (
          <PublicEntrySessionBoundary>
            {renderPublicRoute(route, location.search) ?? <NotFoundPage />}
          </PublicEntrySessionBoundary>
        ) : (
          (renderPublicRoute(route, location.search) ?? <NotFoundPage />)
        )}
      </PublicShell>
    );
  }

  if (
    localOwner !== null &&
    localOwner.session.getValidAccessToken() === undefined
  )
    return (
      <LocalOwnerSignInRedirect
        path={location.pathname + location.search + location.hash}
      />
    );

  const developmentSearch = new URLSearchParams(location.search);
  const explicitDevelopmentFixture =
    import.meta.env.DEV &&
    (developmentSearch.get("fixture") !== null ||
      (route.id === "project-editor" &&
        developmentSearch.get("start") !== null));
  if (explicitDevelopmentFixture) {
    return (
      <LegacyPrivateApplication
        candidateReview={candidateReview}
        developmentGallery={developmentGallery}
        route={route}
        search={location.search}
      />
    );
  }

  return (
    <AuthenticatedSessionBoundary
      {...(mayRenderLocalMockIdentity(import.meta.env.DEV)
        ? {
            fallback: () => (
              <LegacyPrivateApplication
                candidateReview={candidateReview}
                developmentGallery={developmentGallery}
                route={route}
                search={location.search}
              />
            ),
          }
        : {})}
    >
      {({ principal }) => (
        <PrivatePresentationProviders actorId={principal.id}>
          <AuthenticatedApplication
            candidateReview={candidateReview}
            developmentGallery={developmentGallery}
            principal={principal}
            route={route}
            search={location.search}
          />
        </PrivatePresentationProviders>
      )}
    </AuthenticatedSessionBoundary>
  );
}

function PrivatePresentationProviders({
  actorId,
  children,
}: {
  readonly actorId: string;
  readonly children: ReactNode;
}) {
  return (
    <ModePreferenceProvider actorId={actorId}>
      <ExperiencePreferenceProvider actorId={actorId}>
        <UsabilityEventsProvider>
          <NotificationProvider>{children}</NotificationProvider>
        </UsabilityEventsProvider>
      </ExperiencePreferenceProvider>
    </ModePreferenceProvider>
  );
}

function AuthenticatedApplication({
  candidateReview,
  developmentGallery,
  principal,
  route,
  search,
}: {
  readonly candidateReview: CandidateReviewHostInputV1 | undefined;
  readonly developmentGallery: ReactNode | undefined;
  readonly principal: CurrentPrincipalV1;
  readonly route: RouteMatch;
  readonly search: string;
}) {
  const requestedOrganizationId = route.params.organizationId;
  const organizationContext = principal.organizationContexts.find(
    (context) => context.organizationId === requestedOrganizationId,
  );
  const navigationOrganizationId = useNavigationOrganizationId(
    principal,
    organizationContext,
  );
  const accountIdentity = verifiedShellIdentity(principal, null);

  if (
    requestedOrganizationId !== undefined &&
    organizationContext === undefined
  ) {
    return (
      <AppShell identity={accountIdentity}>
        <PermissionDeniedPage />
      </AppShell>
    );
  }

  if (organizationContext === undefined) {
    if (!routeRequiresOrganizationContext(route.id)) {
      return (
        <AppShell
          identity={accountIdentity}
          navigationOrganizationId={navigationOrganizationId}
        >
          {renderAuthenticatedRoute(
            route,
            search,
            candidateReview,
            developmentGallery,
            principal,
            "unavailable",
          )}
        </AppShell>
      );
    }
    return (
      <AppShell identity={accountIdentity}>
        <PermissionDeniedPage />
      </AppShell>
    );
  }

  return (
    <VerifiedOrganizationIdentityBoundary
      organizationContext={organizationContext}
      principal={principal}
    >
      {(identity) =>
        route.id === "project-editor" ? (
          <EditorRoute
            organizationId={organizationContext.organizationId}
            principal={principal}
            projectId={route.params.projectId ?? "unavailable"}
            shellIdentity={identity}
          />
        ) : (
          <AppShell identity={identity}>
            {renderAuthenticatedRoute(
              route,
              search,
              candidateReview,
              developmentGallery,
              principal,
              organizationContext.organizationId,
            )}
          </AppShell>
        )
      }
    </VerifiedOrganizationIdentityBoundary>
  );
}

function useNavigationOrganizationId(
  principal: CurrentPrincipalV1,
  organizationContext:
    CurrentPrincipalV1["organizationContexts"][number] | undefined,
): string | null {
  const organizationId = organizationContext?.organizationId;
  const membershipId = organizationContext?.membershipId;
  const [lastWorkspace, setLastWorkspace] = useState<{
    readonly principalId: string;
    readonly membershipId: string;
    readonly organizationId: string;
  } | null>(null);

  // This session-local hint supplies return links only. Every tenant route and
  // request still resolves its own authorization from the current principal.
  /* eslint-disable react-hooks/set-state-in-effect -- Remember the last explicit
     route selection without persisting it or treating it as tenant authority. */
  useEffect(() => {
    if (organizationId !== undefined && membershipId !== undefined) {
      setLastWorkspace({
        principalId: principal.id,
        membershipId,
        organizationId,
      });
    }
  }, [membershipId, organizationId, principal.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const rememberedContext =
    lastWorkspace?.principalId === principal.id
      ? principal.organizationContexts.find(
          (context) =>
            context.organizationId === lastWorkspace.organizationId &&
            context.membershipId === lastWorkspace.membershipId,
        )
      : undefined;
  return organizationId ?? rememberedContext?.organizationId ?? null;
}

function verifiedShellIdentity(
  principal: CurrentPrincipalV1,
  organization: AppShellIdentity["organization"],
): AppShellIdentity {
  return {
    actorId: principal.id,
    displayName: principal.displayName,
    kind: "verified",
    organization,
  };
}

function VerifiedOrganizationIdentityBoundary({
  children,
  organizationContext,
  principal,
}: {
  readonly children: (identity: AppShellIdentity) => ReactNode;
  readonly organizationContext: CurrentPrincipalV1["organizationContexts"][number];
  readonly principal: CurrentPrincipalV1;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const organizationId = organizationContext.organizationId;
  const organizationQuery = useQuery({
    enabled: runtime !== null,
    queryKey: [
      ...cloudMarkupQueryKeys.organization(principal.id, organizationId),
      "shell-display-name",
      organizationContext.membershipId,
    ],
    queryFn: async () => {
      if (runtime === null) {
        throw new Error("The authenticated API is unavailable.");
      }
      const response = await runtime.client.request("account.workspaces.get", {
        path: { organizationId },
      });
      if (
        response.data.id !== organizationId ||
        response.data.principalId !== principal.id
      ) {
        throw new Error("The organization response binding is invalid.");
      }
      return { name: response.data.displayName, kind: response.data.kind };
    },
  });
  const organizationName = organizationQuery.isSuccess
    ? organizationQuery.data.name
    : organizationQuery.isError
      ? "Organization unavailable"
      : "Loading organization…";

  return children(
    verifiedShellIdentity(principal, {
      id: organizationId,
      name: organizationName,
      capabilities: organizationContext.capabilities,
      kind: organizationQuery.isSuccess
        ? organizationQuery.data.kind
        : "unavailable",
    }),
  );
}

function routeRequiresOrganizationContext(routeId: RouteId): boolean {
  return !new Set<RouteId>([
    "connection-guidance",
    "denied",
    "development-gallery",
    "not-found",
    "personal-security-settings",
    "personal-integration-settings",
    "preference-settings",
    "account-invitations",
    "profile-settings",
    "staff-accounts",
    "organizations",
    "unsupported",
  ]).has(routeId);
}

function ConfiguredLandingPage() {
  return useOptionalLocalOwnerSession() === null ? (
    <LandingPage />
  ) : (
    <LocalOwnerSignInPage />
  );
}
function ConfiguredSignInPage() {
  const localOwner = useOptionalLocalOwnerSession();
  const location = useAppLocation();
  if (localOwner === null) return <SignInPage />;
  return ["/sign-up", "/signup", "/forgot-password"].includes(
    location.pathname,
  ) ? (
    <NotFoundPage />
  ) : (
    <LocalOwnerSignInPage />
  );
}
function ConfiguredAuthCallbackPage({ search }: { readonly search: string }) {
  return useOptionalLocalOwnerSession() === null ? (
    <AuthCallbackPage search={search} />
  ) : (
    <NotFoundPage />
  );
}
function LocalOwnerSignInRedirect({ path }: { readonly path: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(signInPathForReturn(path), { replace: true });
  }, [navigate, path]);
  return <p role="status">Opening local sign-in...</p>;
}

function renderPublicRoute(
  route: RouteMatch,
  search: string,
): ReactNode | undefined {
  switch (route.id) {
    case "landing":
      return <ConfiguredLandingPage />;
    case "sign-in":
      return <ConfiguredSignInPage />;
    case "auth-callback":
      return <ConfiguredAuthCallbackPage search={search} />;
    case "gitlab-link-callback":
      return <GitLabLinkCallbackPage />;
    case "invitation":
      return <InvitationPage key={route.params.invitationId} />;
    default:
      return undefined;
  }
}

function renderAuthenticatedRoute(
  route: RouteMatch,
  search: string,
  candidateReview: CandidateReviewHostInputV1 | undefined,
  developmentGallery: ReactNode | undefined,
  principal: CurrentPrincipalV1,
  organizationId: string,
): ReactNode {
  const projectId = route.params.projectId ?? "unavailable";
  const revisionId = route.params.revisionId ?? "unavailable";
  const artifactId = route.params.artifactId ?? "unavailable";
  const exportJobId = route.params.exportJobId ?? "unavailable";

  switch (route.id) {
    case "landing":
    case "sign-in":
    case "auth-callback":
    case "gitlab-link-callback":
    case "invitation":
      return renderPublicRoute(route, search) ?? <NotFoundPage />;
    case "denied":
      return <PermissionDeniedPage />;
    case "unsupported":
      return <UnsupportedPage />;
    case "connection-guidance":
      return <ConnectionGuidancePage />;
    case "account-invitations":
      return <AccountInvitationsPage principal={principal} />;
    case "staff-accounts":
      return (
        <Suspense fallback={<p role="status">Loading administration…</p>}>
          <StaffAccountsPage principal={principal} />
        </Suspense>
      );
    case "profile-settings":
      return <PersonalSettingsPage principal={principal} section="profile" />;
    case "preference-settings":
      return (
        <PersonalSettingsPage principal={principal} section="preferences" />
      );
    case "personal-security-settings":
      return <PersonalSettingsPage principal={principal} section="security" />;
    case "personal-integration-settings":
      return (
        <PersonalSettingsPage principal={principal} section="integrations" />
      );
    case "organizations":
      return <OrganizationsPage principal={principal} />;
    case "dashboard":
      return (
        <DashboardPage organizationId={organizationId} principal={principal} />
      );
    case "projects":
      return (
        <ProjectsPage organizationId={organizationId} principal={principal} />
      );
    case "project-new":
      return (
        <NewProjectPage organizationId={organizationId} principal={principal} />
      );
    case "templates":
      return <TemplatesPage organizationId={organizationId} />;
    case "template-detail":
      return (
        <TemplateDetailPage
          organizationId={organizationId}
          principal={principal}
          templateId={route.params.templateId ?? "unavailable"}
        />
      );
    case "billing":
      return (
        <BillingPage organizationId={organizationId} principal={principal} />
      );
    case "usage":
      return (
        <UsagePage organizationId={organizationId} principal={principal} />
      );
    case "organization-general-settings":
      return (
        <OrganizationSettingsPage
          organizationId={organizationId}
          principal={principal}
          section="general"
        />
      );
    case "organization-member-settings":
      return (
        <OrganizationSettingsPage
          organizationId={organizationId}
          principal={principal}
          section="members"
        />
      );
    case "organization-integration-settings":
      return (
        <OrganizationSettingsPage
          organizationId={organizationId}
          principal={principal}
          section="integrations"
        />
      );
    case "organization-role-settings":
      return (
        <OrganizationSettingsPage
          organizationId={organizationId}
          principal={principal}
          section="roles"
        />
      );
    case "organization-policy-settings":
      return (
        <OrganizationSettingsPage
          organizationId={organizationId}
          principal={principal}
          section="policies"
        />
      );
    case "organization-security-settings":
      return (
        <OrganizationSettingsPage
          organizationId={organizationId}
          principal={principal}
          section="security"
        />
      );
    case "organization-data-settings":
      return (
        <OrganizationSettingsPage
          organizationId={organizationId}
          principal={principal}
          section="data"
        />
      );
    case "project-overview":
      return (
        <ProjectOverviewPage
          organizationId={organizationId}
          principal={principal}
          projectId={projectId}
        />
      );
    case "project-intent":
      return (
        <ProjectIntentPage
          organizationId={organizationId}
          principal={principal}
          projectId={projectId}
        />
      );
    case "project-editor":
      return <EditorMain projectId={projectId} />;
    case "project-revisions":
      return (
        <RevisionsPage
          organizationId={organizationId}
          principal={principal}
          projectId={projectId}
        />
      );
    case "project-revision":
      return (
        <RevisionDetailPage
          organizationId={organizationId}
          principal={principal}
          projectId={projectId}
          revisionId={revisionId}
        />
      );
    case "solution-export-job":
      return (
        <SolutionExportPage
          exportJobId={exportJobId}
          organizationId={organizationId}
          principal={principal}
          projectId={projectId}
        />
      );
    case "artifact-review":
      return (
        <ArtifactReviewPage
          artifactId={artifactId}
          candidateReview={candidateReview}
          principalId={principal.id}
          organizationId={organizationId}
          projectId={projectId}
        />
      );
    case "artifact-export-zip":
      return (
        <ExportConfirmationPage
          artifactId={artifactId}
          kind="zip"
          organizationId={organizationId}
          projectId={projectId}
        />
      );
    case "artifact-export-gitlab":
      return (
        <GitLabExportPage
          artifactId={artifactId}
          organizationId={organizationId}
          principal={principal}
          projectId={projectId}
        />
      );
    case "artifact-export-github":
      return (
        <GitHubExportPage
          artifactId={artifactId}
          organizationId={organizationId}
          principal={principal}
          projectId={projectId}
        />
      );
    case "development-gallery":
      return developmentGallery ?? <NotFoundPage />;
    case "not-found":
      return <NotFoundPage />;
  }
}

function LegacyPrivateApplication({
  developmentGallery,
  candidateReview,
  route,
  search,
}: {
  readonly developmentGallery: ReactNode | undefined;
  readonly candidateReview: CandidateReviewHostInputV1 | undefined;
  readonly route: RouteMatch;
  readonly search: string;
}) {
  return (
    <PrivatePresentationProviders actorId={localMockIdentity.actorId}>
      <LegacyPrivateRoutes
        developmentGallery={developmentGallery}
        candidateReview={candidateReview}
        route={route}
        search={search}
      />
    </PrivatePresentationProviders>
  );
}

function LegacyPrivateRoutes({
  developmentGallery,
  candidateReview,
  route,
  search,
}: {
  readonly developmentGallery: ReactNode | undefined;
  readonly candidateReview: CandidateReviewHostInputV1 | undefined;
  readonly route: RouteMatch;
  readonly search: string;
}) {
  if (route.id === "organizations") {
    return (
      <AppShell
        identity={{ ...localMockIdentity, organization: null }}
        navigationOrganizationId={localMockIdentity.organization.id}
      >
        <OrganizationsPage identity={localMockIdentity} />
      </AppShell>
    );
  }

  const targetsAnotherOrganization =
    route.params.organizationId !== undefined &&
    route.params.organizationId !== localMockIdentity.organization.id;
  const targetsUnknownProject =
    route.params.projectId !== undefined &&
    !localMockProjectIds.has(route.params.projectId);
  const page = targetsAnotherOrganization ? (
    <PermissionDeniedPage />
  ) : targetsUnknownProject ? (
    <NotFoundPage />
  ) : (
    renderLegacyRoute(route, search, candidateReview, developmentGallery)
  );

  if (
    route.id === "project-editor" &&
    !targetsAnotherOrganization &&
    !targetsUnknownProject
  ) {
    return <EditorRoute projectId={route.params.projectId ?? "unavailable"} />;
  }

  return <AppShell>{page}</AppShell>;
}

function renderLegacyRoute(
  route: RouteMatch,
  search: string,
  candidateReview: CandidateReviewHostInputV1 | undefined,
  developmentGallery: ReactNode | undefined,
): ReactNode {
  const projectId = route.params.projectId ?? "unavailable";
  const revisionId = route.params.revisionId ?? "unavailable";
  const artifactId = route.params.artifactId ?? "unavailable";
  const exportJobId = route.params.exportJobId ?? "unavailable";

  switch (route.id) {
    case "landing":
    case "sign-in":
    case "auth-callback":
    case "gitlab-link-callback":
    case "invitation":
      return renderPublicRoute(route, search) ?? <NotFoundPage />;
    case "denied":
      return <PermissionDeniedPage />;
    case "unsupported":
      return <UnsupportedPage />;
    case "connection-guidance":
      return <ConnectionGuidancePage />;
    case "account-invitations":
      return <AccountInvitationsPage />;
    case "staff-accounts":
      return (
        <Suspense fallback={<p role="status">Loading administration…</p>}>
          <StaffAccountsPage />
        </Suspense>
      );
    case "profile-settings":
      return <PersonalSettingsPage section="profile" />;
    case "preference-settings":
      return <PersonalSettingsPage section="preferences" />;
    case "personal-security-settings":
      return <PersonalSettingsPage section="security" />;
    case "personal-integration-settings":
      return <PersonalSettingsPage section="integrations" />;
    case "organizations":
      return <OrganizationsPage identity={localMockIdentity} />;
    case "dashboard":
      return <DashboardPage />;
    case "projects":
      return <ProjectsPage identity={localMockIdentity} />;
    case "project-new":
      return <NewProjectPage identity={localMockIdentity} />;
    case "templates":
      return (
        <TemplatesPage
          localFixturesEnabled
          organizationId={localMockIdentity.organization.id}
        />
      );
    case "template-detail":
      return (
        <TemplateDetailPage
          localFixturesEnabled
          organizationId={localMockIdentity.organization.id}
          templateId={route.params.templateId ?? "unavailable"}
        />
      );
    case "billing":
      return <BillingPage />;
    case "usage":
      return <UsagePage />;
    case "organization-general-settings":
      return <OrganizationSettingsPage section="general" />;
    case "organization-member-settings":
      return <OrganizationSettingsPage section="members" />;
    case "organization-integration-settings":
      return <OrganizationSettingsPage section="integrations" />;
    case "organization-role-settings":
      return <OrganizationSettingsPage section="roles" />;
    case "organization-policy-settings":
      return <OrganizationSettingsPage section="policies" />;
    case "organization-security-settings":
      return <OrganizationSettingsPage section="security" />;
    case "organization-data-settings":
      return <OrganizationSettingsPage section="data" />;
    case "project-overview":
      return <ProjectOverviewPage projectId={projectId} />;
    case "project-intent":
      return <ProjectIntentPage projectId={projectId} />;
    case "project-editor":
      return <EditorMain projectId={projectId} />;
    case "project-revisions":
      return <RevisionsPage projectId={projectId} />;
    case "project-revision":
      return (
        <RevisionDetailPage projectId={projectId} revisionId={revisionId} />
      );
    case "solution-export-job":
      return (
        <SolutionExportPage exportJobId={exportJobId} projectId={projectId} />
      );
    case "artifact-review":
      return (
        <ArtifactReviewPage
          artifactId={artifactId}
          candidateReview={candidateReview}
          principalId={localMockIdentity.actorId}
          organizationId={localMockIdentity.organization.id}
          projectId={projectId}
        />
      );
    case "artifact-export-zip":
      return (
        <ExportConfirmationPage
          artifactId={artifactId}
          kind="zip"
          organizationId={localMockIdentity.organization.id}
          projectId={projectId}
        />
      );
    case "artifact-export-gitlab":
      return <GitLabExportPage artifactId={artifactId} projectId={projectId} />;
    case "artifact-export-github":
      return <GitHubExportPage artifactId={artifactId} projectId={projectId} />;
    case "development-gallery":
      return developmentGallery ?? <NotFoundPage />;
    case "not-found":
      return <NotFoundPage />;
  }
}

export function PublicShell({
  children,
  development = import.meta.env.DEV,
}: {
  readonly children: ReactNode;
  readonly development?: boolean;
}) {
  const location = useAppLocation();
  const localOwner = useOptionalLocalOwnerSession();
  const returnPath = signInReturnPathFromSearch(location.search);
  const entrySearch =
    returnPath === undefined
      ? ""
      : "?" + new URLSearchParams({ returnTo: returnPath }).toString();
  return (
    <div className="public-app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="public-app-shell__header">
        <div className="public-app-shell__brand">
          <AppLink aria-label="CloudMarkup home" className="brand-link" to="/">
            <BrandLockup markSrc="/app-icon-192.png" />
          </AppLink>
          <StatusBadge
            label={
              localOwner !== null
                ? "Self-hosted"
                : development
                  ? "Preview"
                  : "Beta"
            }
            tone="incomplete"
          />
        </div>
        {localOwner === null ? (
          <nav className="public-app-shell__nav" aria-label="Main navigation">
            {location.pathname === "/" ? (
              <a className="public-app-shell__workflow-link" href="#workflow">
                How it works
              </a>
            ) : null}
            <AppLink to={"/login" + entrySearch}>Log in</AppLink>
            <AppLink
              className="button button--primary"
              to={"/signup" + entrySearch}
            >
              Sign up <span aria-hidden="true">→</span>
            </AppLink>
          </nav>
        ) : null}
      </header>
      <main className="public-app-shell__main" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
