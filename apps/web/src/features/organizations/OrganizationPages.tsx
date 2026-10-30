import { organizationStatus } from "./organization-status.js";
import { WorkspaceCreationPanel } from "./WorkspaceCreationPanel.js";
import {
  ApiClientError,
  accountWorkspaceV1Schema,
  type CurrentPrincipalV1,
  type OrganizationV1,
  type PageMetadata,
} from "@cloudmarkup/api-contract";
import { StatusBadge } from "@cloudmarkup/ui";
import { useInfiniteQuery } from "@tanstack/react-query";

import {
  cloudMarkupQueryKeys,
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import {
  localMockIdentity,
  type LocalMockIdentity,
} from "../../mock/local-mock-context.js";
import { AppLink, encodeRouteSelector } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import "./organizations.css";

type OrganizationContext = CurrentPrincipalV1["organizationContexts"][number];

interface OrganizationsPageProps {
  /** Compatibility-only identity for the explicit local development shell. */
  readonly identity?: LocalMockIdentity;
  readonly principal?: CurrentPrincipalV1;
}

interface OrganizationPage {
  readonly organizations: readonly OrganizationV1[];
  readonly page: PageMetadata;
  readonly kinds: Readonly<Record<string, "personal" | "organization">>;
}

class OrganizationIndexResponseBindingError extends Error {
  public constructor() {
    super("The organization list did not match the verified session scope.");
    this.name = "OrganizationIndexResponseBindingError";
  }
}

function retryOrganizationQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof OrganizationIndexResponseBindingError) return false;
  if (
    error instanceof ApiClientError &&
    ["authentication_required", "access_denied", "invalid_request"].includes(
      error.envelope.error.code,
    )
  ) {
    return false;
  }
  return failureCount < 1;
}

function organizationErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return "CloudMarkup could not load your organizations.";
  }
  switch (error.envelope.error.code) {
    case "authentication_required":
      return "Your session has expired. Sign in again to continue.";
    case "access_denied":
      return "You do not have permission to view these organizations.";
    case "service_unavailable":
      return "The organization service is temporarily unavailable.";
    default:
      return "CloudMarkup could not load your organizations.";
  }
}

function roleLabel(role: OrganizationContext["role"]): string {
  return role === "administrator"
    ? "Administrator"
    : `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function organizationRoot(organizationId: string): string {
  return `/organizations/${encodeRouteSelector(organizationId)}`;
}

function contextForOrganization(
  principal: CurrentPrincipalV1,
  organization: OrganizationV1,
): OrganizationContext | undefined {
  return principal.organizationContexts.find(
    (context) => context.organizationId === organization.id,
  );
}

function organizationAuthorizationRevision(
  principal: CurrentPrincipalV1,
): string {
  return JSON.stringify(
    [...principal.organizationContexts]
      .sort((left, right) =>
        left.organizationId.localeCompare(right.organizationId),
      )
      .map((context) => ({
        capabilities: [...context.capabilities].sort(),
        membershipId: context.membershipId,
        organizationId: context.organizationId,
        role: context.role,
      })),
  );
}

function requiredContextForOrganization(
  principal: CurrentPrincipalV1,
  organization: OrganizationV1,
): OrganizationContext {
  const context = contextForOrganization(principal, organization);
  if (!context?.capabilities.includes("organizations.read")) {
    throw new OrganizationIndexResponseBindingError();
  }
  return context;
}

function validateOrganizationPage(
  principal: CurrentPrincipalV1,
  organizations: readonly OrganizationV1[],
  page: PageMetadata,
): void {
  const ids = new Set<string>();
  for (const organization of organizations) {
    if (ids.has(organization.id)) {
      throw new OrganizationIndexResponseBindingError();
    }
    ids.add(organization.id);
    requiredContextForOrganization(principal, organization);
  }
  if (page.hasMore && page.nextCursor === undefined) {
    throw new OrganizationIndexResponseBindingError();
  }
}

export function OrganizationsPage({
  identity = localMockIdentity,
  principal,
}: OrganizationsPageProps) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  if (principal === undefined) {
    return <LocalOrganizationsPage identity={identity} />;
  }
  if (runtime === null) {
    return <OrganizationsBackendUnavailable />;
  }
  return (
    <AuthenticatedOrganizationsPage
      key={principal.id}
      principal={principal}
      runtime={runtime}
    />
  );
}

function AuthenticatedOrganizationsPage({
  principal,
  runtime,
}: {
  readonly principal: CurrentPrincipalV1;
  readonly runtime: CloudMarkupQueryRuntime;
}) {
  const organizationsQuery = useInfiniteQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.organizations(principal.id),
      organizationAuthorizationRevision(principal),
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<OrganizationPage> => {
      const response = await runtime.client.request("organizations.list", {
        query: {
          "page[limit]": "100",
          sort: "displayName",
          ...(pageParam === undefined ? {} : { "page[cursor]": pageParam }),
        },
      });
      validateOrganizationPage(principal, response.data, response.page);
      const workspaces = await runtime.client.request(
        "account.workspaces.list",
        { query: { "page[limit]": "100" } },
      );
      if (workspaces.page.hasMore)
        throw new OrganizationIndexResponseBindingError();
      const kinds: Record<string, "personal" | "organization"> = {};
      for (const entry of workspaces.data) {
        const value = accountWorkspaceV1Schema.parse(entry);
        if (value.principalId !== principal.id || kinds[value.id] !== undefined)
          throw new OrganizationIndexResponseBindingError();
        kinds[value.id] = value.kind;
      }
      if (
        Object.values(kinds).filter((kind) => kind === "personal").length > 1 ||
        response.data.some((item) => kinds[item.id] === undefined)
      )
        throw new OrganizationIndexResponseBindingError();
      return { organizations: response.data, page: response.page, kinds };
    },
    getNextPageParam: (lastPage) =>
      lastPage.page.hasMore ? lastPage.page.nextCursor : undefined,
    retry: retryOrganizationQuery,
  });
  const pages = organizationsQuery.data?.pages ?? [];
  let responseBindingError: OrganizationIndexResponseBindingError | undefined;
  try {
    for (const page of pages) {
      validateOrganizationPage(principal, page.organizations, page.page);
    }
  } catch {
    responseBindingError = new OrganizationIndexResponseBindingError();
  }
  const organizations =
    responseBindingError === undefined
      ? pages.flatMap((page) => page.organizations)
      : [];

  const kinds = Object.assign(
    {},
    ...pages.map((page) => page.kinds),
  ) as Readonly<Record<string, "personal" | "organization">>;
  const personal = organizations.filter(
    (item) => kinds[item.id] === "personal",
  );
  const shared = organizations.filter(
    (item) => kinds[item.id] === "organization",
  );
  return (
    <RoutePage
      title="Personal & organizations"
      eyebrow="Account"
      description="Use your personal workspace for private projects, or choose an organization for shared projects."
      routeKey={`organizations-${principal.id}`}
    >
      <div className="organizations-index">
        {organizationsQuery.isPending ? (
          <section className="state-card" role="status" aria-live="polite">
            <p className="status-label">Loading</p>
            <h2>Loading your organizations</h2>
          </section>
        ) : organizationsQuery.isError || responseBindingError !== undefined ? (
          <section className="state-card state-card--error" role="alert">
            <p className="status-label">Could not load organizations</p>
            <h2>Organization directory unavailable</h2>
            <p>
              {organizationErrorMessage(
                responseBindingError ?? organizationsQuery.error,
              )}
            </p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void organizationsQuery.refetch()}
            >
              Try again
            </button>
          </section>
        ) : organizations.length === 0 ? (
          <section className="state-card" role="status">
            <p className="status-label">Get started</p>
            <h2>Choose how to get started</h2>
            <p>
              Create a personal workspace below for your own projects, or create
              an organization to collaborate.
            </p>
          </section>
        ) : (
          <section
            className="section-stack"
            aria-labelledby="organization-list-title"
          >
            <div className="organizations-index__heading">
              <div>
                <p className="status-label">Personal & organizations</p>
                <h2 id="organization-list-title">Choose where to work</h2>
              </div>
              <StatusBadge
                label={`${String(shared.length)} ${shared.length === 1 ? "organization" : "organizations"} shown`}
                tone="read-only"
              />
            </div>
            <ul
              className="organizations-index__grid"
              aria-label="Personal workspace and organizations"
            >
              {[...personal, ...shared].map((organization) => (
                <OrganizationCard
                  key={organization.id}
                  kind={kinds[organization.id] ?? "organization"}
                  context={requiredContextForOrganization(
                    principal,
                    organization,
                  )}
                  organization={organization}
                />
              ))}
            </ul>
            {organizationsQuery.hasNextPage ? (
              <button
                className="button button--secondary organizations-index__more"
                disabled={organizationsQuery.isFetchingNextPage}
                type="button"
                onClick={() => void organizationsQuery.fetchNextPage()}
              >
                {organizationsQuery.isFetchingNextPage
                  ? "Loading more…"
                  : "Load more organizations"}
              </button>
            ) : null}
          </section>
        )}
        <WorkspaceCreationPanel
          key={principal.id}
          runtime={runtime}
          principal={principal}
          hasPersonal={Object.values(kinds).includes("personal")}
          disabled={
            !organizationsQuery.isSuccess || responseBindingError !== undefined
          }
        />
      </div>
    </RoutePage>
  );
}

function OrganizationCard({
  kind,
  context,
  organization,
}: {
  readonly kind: "personal" | "organization";
  readonly context: OrganizationContext;
  readonly organization: OrganizationV1;
}) {
  const status = organizationStatus(organization.lifecycleStatus);
  const active = organization.lifecycleStatus === "active";
  const root = organizationRoot(organization.id);
  const mayReadProjects =
    active && context.capabilities.includes("projects.read");
  const mayReadSettings =
    active &&
    kind === "organization" &&
    context.capabilities.includes("organizations.read");

  return (
    <li className="organization-card">
      <div className="organization-card__heading">
        <span aria-hidden="true" className="organization-card__mark">
          {organization.displayName.slice(0, 1).toLocaleUpperCase()}
        </span>
        <div>
          <h3>{kind === "personal" ? "Personal" : organization.displayName}</h3>
          <p>
            {kind === "personal"
              ? "Only you"
              : `${roleLabel(context.role)} access`}
          </p>
        </div>
        <StatusBadge label={status.label} tone={status.tone} />
      </div>
      <p className="organization-card__summary">
        {active
          ? kind === "personal"
            ? "Your personal projects and credits belong to your independent account."
            : "Projects in this organization are shared with authorized members."
          : kind === "personal"
            ? "Your personal workspace is currently inactive."
            : "This organization is currently inactive."}
      </p>
      <div className="organization-card__actions">
        {mayReadProjects ? (
          <AppLink className="button button--primary" to={`${root}/dashboard`}>
            Open dashboard
          </AppLink>
        ) : null}
        {mayReadSettings ? (
          <AppLink
            className="button button--secondary"
            to={`${root}/settings/general`}
          >
            Organization settings
          </AppLink>
        ) : null}
      </div>
      {kind === "organization" && (
        <details className="organization-card__details">
          <summary>Organization details</summary>
          <p>
            Membership roles determine who can view or edit shared projects.
            Owners and administrators with invitation access can invite
            registered users from Members settings. Recipients review
            invitations under Account → Invitations.
          </p>
          <dl>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(organization.createdAt)}</dd>
            </div>
            <div>
              <dt>Organization ID</dt>
              <dd>
                <code>{organization.id}</code>
              </dd>
            </div>
            <div>
              <dt>Slug</dt>
              <dd>
                <code>{organization.slug}</code>
              </dd>
            </div>
          </dl>
        </details>
      )}
    </li>
  );
}

function OrganizationsBackendUnavailable() {
  return (
    <RoutePage
      title="Organizations unavailable"
      eyebrow="Service unavailable"
      description="Your organizations could not be loaded."
      routeKey="organizations-backend-unavailable"
    >
      <section className="state-card state-card--error" role="alert">
        <p className="status-label">Service unavailable</p>
        <h2>Organization access is unavailable</h2>
        <p>
          Sign in again to retry. If this continues, contact your organization
          owner for help.
        </p>
      </section>
    </RoutePage>
  );
}

function LocalOrganizationsPage({
  identity,
}: {
  readonly identity: LocalMockIdentity;
}) {
  const root = organizationRoot(identity.organization.id);
  return (
    <RoutePage
      title="Organizations"
      eyebrow="Local development fixture"
      description="This directory is synthetic and does not represent a verified membership."
      routeKey="organizations-local"
    >
      <div className="organizations-index">
        <section className="state-card state-card--warning" role="status">
          <p className="status-label">Local preview only</p>
          <h2>No organization service is connected</h2>
          <p>
            The card below demonstrates layout only. It does not establish
            tenant identity, role, or server access.
          </p>
        </section>
        <ul
          className="organizations-index__grid"
          aria-label="Local organization preview"
        >
          <li className="organization-card">
            <div className="organization-card__heading">
              <span aria-hidden="true" className="organization-card__mark">
                {identity.organization.name.slice(0, 1).toLocaleUpperCase()}
              </span>
              <div>
                <h3>{identity.organization.name}</h3>
                <p>Local mock identity</p>
              </div>
              <StatusBadge label="Not verified" tone="incomplete" />
            </div>
            <div className="organization-card__actions">
              <AppLink
                className="button button--primary"
                to={`${root}/projects`}
              >
                Open local project previews
              </AppLink>
            </div>
          </li>
        </ul>
      </div>
    </RoutePage>
  );
}
