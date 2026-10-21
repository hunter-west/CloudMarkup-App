import { organizationStatus } from "../organizations/organization-status.js";
import { useOptionalLocalOwnerSession } from "../auth/local-owner-session.js";
import { StaffAccessCard } from "../staff/StaffAccessCard.js";
import { AccountAuthenticatorControls } from "./AccountAuthenticatorControls.js";
import { AccountCredentialControls } from "./AccountCredentialControls.js";
import { AccountSessionControls } from "./AccountSessionControls.js";
import {
  OrganizationMemberControls,
  OrganizationRolePermissions,
} from "../organizations/OrganizationMemberControls.js";
import { AccountProfileSettings } from "./AccountProfileSettings.js";
import { ThemeSwitch } from "../../preferences/ThemeSwitch.js";
import {
  ApiClientError,
  type CurrentPrincipalV1,
  type OrganizationMemberV1,
  organizationMemberV1Schema,
  pageMetadataSchema,
  type OrganizationV1,
  type PageMetadata,
} from "@cloudmarkup/api-contract";
import { Disclosure, StatusBadge } from "@cloudmarkup/ui";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  cloudMarkupQueryKeys,
  mapApiError,
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { useUsabilityEvents } from "../../instrumentation/usability-events.js";
import { useNotifications } from "../../notifications/index.js";
import {
  hasLocalMockCapability,
  localMockIdentity,
  type LocalMockIdentity,
} from "../../mock/local-mock-context.js";
import {
  useExperiencePreference,
  useModePreference,
} from "../../preferences/index.js";
import { ModeSwitch } from "../../preferences/ModeSwitch.js";
import { RoutePage } from "../../shell/RoutePage.js";
import { restartNotesApiWalkthrough } from "../onboarding/restart-walkthrough.js";

import { AppLink } from "../../routing/index.js";
import { VerifiedWorkspaceIntegrationSettings } from "./VerifiedWorkspaceIntegrationSettings.js";
import { OrganizationInvitationComposer } from "../organizations/OrganizationInvitationComposer.js";
import "./settings.css";
import { PersonalIntegrationSettings } from "./PersonalIntegrationSettings.js";
type PersonalSettingsSection =
  "profile" | "preferences" | "security" | "integrations";
type OrganizationSettingsSection =
  | "general"
  | "members"
  | "integrations"
  | "roles"
  | "policies"
  | "security"
  | "data";

const personalSettingsTitles: Record<PersonalSettingsSection, string> = {
  profile: "Profile settings",
  preferences: "Experience preferences",
  security: "Personal security",
  integrations: "Personal integrations",
};

const organizationSettingsTitles: Record<OrganizationSettingsSection, string> =
  {
    general: "Organization settings",
    members: "Members",
    integrations: "Integrations",
    roles: "Roles",
    policies: "Product policies",
    security: "Organization security",
    data: "Data controls",
  };

function ExperiencePreferenceSettings({
  localDevelopment,
  projectStartPath,
}: {
  readonly localDevelopment: boolean;
  readonly projectStartPath: string;
}) {
  const preference = useExperiencePreference();
  const { mode, setMode } = useModePreference();
  const usabilityEvents = useUsabilityEvents();
  const { addNotification } = useNotifications();

  return (
    <div className="section-stack">
      <ThemeSwitch settings />
      <ModeSwitch surface="settings" />
      <label className="first-use-teaching">
        <input
          aria-label="Editor tour"
          checked={preference.contextualTeachingEnabled}
          onChange={(event) => {
            preference.setContextualTeachingEnabled(
              event.currentTarget.checked,
            );
          }}
          type="checkbox"
        />
        <span>
          <strong>Editor tour</strong>
          <small>
            {localDevelopment
              ? "Walkthrough prompts follow this setting; Learn stays available in both modes."
              : "Show a step-by-step editor tour. Guided mode recommendations and Learn remain available when the tour is off."}
          </small>
        </span>
      </label>
      {localDevelopment ? (
        <Disclosure summary="Local preview preferences">
          <dl className="editor-inspector-list">
            <div>
              <dt>Preferred provider</dt>
              <dd>AWS</dd>
            </div>
            <div>
              <dt>Default Region</dt>
              <dd>{preference.defaultRegion ?? "Not established"}</dd>
            </div>
            <div>
              <dt>Project start</dt>
              <dd>{preference.startChoice}</dd>
            </div>
            <div>
              <dt>Notes API walkthrough</dt>
              <dd>{preference.notesApiWalkthrough}</dd>
            </div>
          </dl>
        </Disclosure>
      ) : null}
      <div className="form-actions">
        {localDevelopment ? (
          <>
            <button
              className="button button--secondary"
              onClick={() => {
                preference.restartFirstUse();
              }}
              type="button"
            >
              Restart first-use setup
            </button>
            <button
              className="button button--secondary"
              onClick={() => {
                restartNotesApiWalkthrough({
                  experience: preference,
                  mode,
                  setMode,
                  surface: "settings",
                  usabilityEvents,
                });
                addNotification({
                  kind: "info",
                  message:
                    "Guided presentation and contextual teaching are enabled. Open the local notes API template to begin at step 1.",
                  title: "Walkthrough restarted",
                });
              }}
              type="button"
            >
              Restart notes API walkthrough
            </button>
          </>
        ) : (
          <button
            className="button button--secondary"
            onClick={() => {
              preference.restartWalkthrough();
              preference.setContextualTeachingEnabled(true);
              addNotification({
                kind: "info",
                message:
                  "Open a project to take the quick tour of its menus and tools.",
                title: "Editor tour restarted",
              });
            }}
            type="button"
          >
            Restart editor tour
          </button>
        )}
        <AppLink className="button button--quiet" to={projectStartPath}>
          {localDevelopment ? "Open project start" : "Choose an organization"}
        </AppLink>
      </div>
      {preference.storageStatus === "available" ? null : (
        <p role="status">
          Local preference storage is unavailable; this session can continue.
        </p>
      )}
    </div>
  );
}

export function PersonalSettingsPage({
  principal,
  section,
}: {
  readonly principal?: CurrentPrincipalV1;
  readonly section: PersonalSettingsSection;
}) {
  const isPreferences = section === "preferences";
  const usesVerifiedIdentity = principal !== undefined;

  return (
    <RoutePage
      title={personalSettingsTitles[section]}
      eyebrow={
        usesVerifiedIdentity
          ? "Personal account"
          : "Personal settings placeholder"
      }
      description={
        usesVerifiedIdentity && isPreferences
          ? "Choose the guidance that works best for you."
          : usesVerifiedIdentity
            ? section === "security"
              ? "Manage your sign-in and account security."
              : section === "integrations"
                ? "Connect repositories for your personal projects. Organization connections stay separate."
                : "Manage your profile and account preferences."
            : "Personal presentation state remains outside organizations and Architecture Documents."
      }
      routeKey={`personal-settings-${section}`}
    >
      <div className="settings-content">
        {isPreferences ? (
          <section className="feature-card">
            <h2>Appearance and guidance</h2>
            <p>
              Both modes offer the same tools and keep your architecture
              unchanged. Guided recommends next steps and highlights issues to
              fix; Professional keeps guidance concise.
            </p>
            <ExperiencePreferenceSettings
              localDevelopment={!usesVerifiedIdentity}
              projectStartPath={
                usesVerifiedIdentity
                  ? "/organizations"
                  : "/organizations/local-org/projects"
              }
            />
          </section>
        ) : usesVerifiedIdentity ? (
          section === "integrations" ? (
            <VerifiedPersonalIntegrations principal={principal} />
          ) : section === "profile" ? (
            <VerifiedProfileSettings principal={principal} />
          ) : (
            <VerifiedSecuritySettings principal={principal} />
          )
        ) : (
          <section className="state-card state-card--readonly">
            <p className="status-label">Not connected</p>
            <h2>{personalSettingsTitles[section]} are unavailable</h2>
            <p>
              No profile, session, identity-provider, or account-security
              service is connected. The local mock identity is not a verified
              account.
            </p>
          </section>
        )}
      </div>
    </RoutePage>
  );
}

function VerifiedPersonalIntegrations({
  principal,
}: {
  readonly principal: CurrentPrincipalV1;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  return runtime === null ? (
    <p role="alert">Sign in to manage your personal integrations.</p>
  ) : (
    <PersonalIntegrationSettings runtime={runtime} principal={principal} />
  );
}

function VerifiedProfileSettings({
  principal,
}: {
  readonly principal: CurrentPrincipalV1;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const localOwner = useOptionalLocalOwnerSession();
  if (runtime !== null)
    return (
      <div className="section-stack">
        <AccountProfileSettings
          key={principal.id}
          runtime={runtime}
          principal={principal}
        />
        {localOwner === null ? (
          <StaffAccessCard runtime={runtime} principal={principal} />
        ) : null}
      </div>
    );
  return (
    <section aria-labelledby="verified-profile-title" className="feature-card">
      <p className="status-label">Verified account</p>
      <h2 id="verified-profile-title">{principal.displayName}</h2>
      <p>
        This read-only profile comes from the authenticated Cloud Markup
        context. Profile changes are not available in this application.
      </p>
      <dl className="editor-inspector-list">
        <div>
          <dt>Email</dt>
          <dd>{principal.email ?? "Not supplied by the verified identity"}</dd>
        </div>
        <div>
          <dt>Organization access</dt>
          <dd>
            {organizationAccessLabel(principal.organizationContexts.length)}
          </dd>
        </div>
      </dl>
      <PrincipalTechnicalDetails principal={principal} />
    </section>
  );
}

function VerifiedSecuritySettings({
  principal,
}: {
  readonly principal: CurrentPrincipalV1;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const localOwner = useOptionalLocalOwnerSession();
  return (
    <div className="settings-security">
      {runtime && localOwner === null ? (
        <div id="sign-in-settings">
          <AccountCredentialControls
            key={"credentials:" + principal.id}
            runtime={runtime}
            principalId={principal.id}
          />
        </div>
      ) : null}
      {runtime && localOwner === null ? (
        <div id="authenticator-settings">
          <AccountAuthenticatorControls
            key={"authenticator:" + principal.id}
            runtime={runtime}
            principalId={principal.id}
          />
        </div>
      ) : null}
      {runtime ? (
        <div id="session-settings">
          <AccountSessionControls
            key={principal.id}
            runtime={runtime}
            principal={principal}
          />
        </div>
      ) : null}
      {runtime && localOwner === null ? (
        <PrincipalTechnicalDetails principal={principal} />
      ) : (
        <section
          aria-labelledby="verified-security-title"
          className="feature-card"
        >
          <p className="status-label">Verified session</p>
          <h2 id="verified-security-title">Authenticated account</h2>
          <p>
            Cloud Markup received a verified identity for{" "}
            {principal.displayName}.{" "}
            {runtime
              ? "Use the session controls above to manage CloudMarkup access."
              : "Session controls require the authenticated API connection."}
          </p>
          <dl className="editor-inspector-list">
            <div>
              <dt>Identity status</dt>
              <dd>Verified</dd>
            </div>
            {runtime ? null : (
              <div>
                <dt>Email</dt>
                <dd>
                  {principal.email ?? "Not supplied by the verified identity"}
                </dd>
              </div>
            )}
            <div>
              <dt>Sign-in methods</dt>
              <dd>
                {localOwner === null
                  ? "Managed by your sign-in provider"
                  : "Local operator proof configured on this server"}
              </dd>
            </div>
          </dl>
          {localOwner !== null ? (
            <div className="state-card state-card--readonly">
              <h3>Local owner sign-in</h3>
              <p>
                This self-hosted instance uses its server-configured operator
                proof. Change or rotate that proof on the server. CloudMarkup
                does not manage a password, email sign-in, or authenticator for
                local owner mode.
              </p>
            </div>
          ) : null}
          {runtime ? null : (
            <div className="state-card state-card--readonly">
              <h3>Password and sign-in methods</h3>
              <p>
                Password and email controls require the authenticated API
                connection. Your sign-in provider continues to manage them.
              </p>
            </div>
          )}
          <PrincipalTechnicalDetails principal={principal} />
        </section>
      )}
    </div>
  );
}

function PrincipalTechnicalDetails({
  principal,
}: {
  readonly principal: CurrentPrincipalV1;
}) {
  return (
    <details className="settings-technical-details">
      <summary>Technical identity details</summary>
      <dl>
        <div>
          <dt>Principal ID</dt>
          <dd>
            <code>{principal.id}</code>
          </dd>
        </div>
        <div>
          <dt>Resource version</dt>
          <dd>{principal.resourceVersion}</dd>
        </div>
      </dl>
    </details>
  );
}

function organizationAccessLabel(count: number): string {
  if (count === 0) {
    return "No organizations";
  }
  return `${String(count)} organization${count === 1 ? "" : "s"}`;
}

export function OrganizationSettingsPage({
  identity = localMockIdentity,
  organizationId,
  principal,
  section,
}: {
  readonly identity?: LocalMockIdentity;
  readonly organizationId?: string;
  readonly principal?: CurrentPrincipalV1;
  readonly section: OrganizationSettingsSection;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const usesBackend = principal !== undefined || organizationId !== undefined;

  if (!usesBackend) {
    return (
      <LocalOrganizationSettingsPage identity={identity} section={section} />
    );
  }
  if (
    runtime === null ||
    principal === undefined ||
    organizationId === undefined
  ) {
    return <OrganizationSettingsBackendUnavailable section={section} />;
  }

  const organization = principal.organizationContexts.find(
    (candidate) => candidate.organizationId === organizationId,
  );
  if (!organization?.capabilities.includes("organizations.read")) {
    return <OrganizationSettingsPermissionDenied section={section} />;
  }

  const context: VerifiedOrganizationSettingsContext = {
    organization,
    organizationId,
    principal,
    runtime,
  };

  if (section === "general") {
    return <AuthenticatedOrganizationGeneral context={context} />;
  }
  if (section === "integrations") {
    if (!organization.capabilities.includes("integrations.read")) {
      return (
        <OrganizationSettingsPermissionDenied
          context={context}
          section={section}
        />
      );
    }
    return (
      <RoutePage
        title="Integrations"
        description="Manage repository connections for this workspace."
        routeKey={`organization-settings-integrations-${organizationId}`}
      >
        <OrganizationSettingsFrame>
          <VerifiedWorkspaceIntegrationSettings
            runtime={runtime}
            principal={principal}
            organizationId={organizationId}
          />
        </OrganizationSettingsFrame>
      </RoutePage>
    );
  }
  if (section === "members") {
    if (!organization.capabilities.includes("memberships.read")) {
      return (
        <OrganizationSettingsPermissionDenied
          context={context}
          section={section}
        />
      );
    }
    return <AuthenticatedOrganizationMembers context={context} />;
  }

  return <UnavailableOrganizationSettings section={section} />;
}

interface VerifiedOrganizationSettingsContext {
  readonly organization: CurrentPrincipalV1["organizationContexts"][number];
  readonly organizationId: string;
  readonly principal: CurrentPrincipalV1;
  readonly runtime: CloudMarkupQueryRuntime;
}

interface OrganizationSnapshot {
  readonly etag: string;
  readonly organization: OrganizationV1;
}

interface MembershipPage {
  readonly memberships: readonly OrganizationMemberV1[];
  readonly page: PageMetadata;
}

class OrganizationSettingsResponseBindingError extends Error {
  public constructor() {
    super(
      "The organization settings response did not match the requested scope.",
    );
    this.name = "OrganizationSettingsResponseBindingError";
  }
}

function retrySettingsQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof OrganizationSettingsResponseBindingError) return false;
  if (
    error instanceof ApiClientError &&
    [
      "authentication_required",
      "access_denied",
      "not_found",
      "invalid_request",
    ].includes(error.envelope.error.code)
  ) {
    return false;
  }
  return failureCount < 1;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function roleLabel(
  role: VerifiedOrganizationSettingsContext["organization"]["role"],
): string {
  return role === "administrator"
    ? "Administrator"
    : `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

function OrganizationSettingsFrame({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <div className="settings-content">{children}</div>;
}

function AuthenticatedOrganizationGeneral({
  context,
}: {
  readonly context: VerifiedOrganizationSettingsContext;
}) {
  const organizationQuery = useQuery({
    queryKey: cloudMarkupQueryKeys.organization(
      context.principal.id,
      context.organizationId,
    ),
    queryFn: async (): Promise<OrganizationSnapshot> => {
      const response = await context.runtime.client.requestWithMetadata(
        "organizations.get",
        { path: { organizationId: context.organizationId } },
      );
      const organization = response.data.data;
      if (organization.id !== context.organizationId) {
        throw new OrganizationSettingsResponseBindingError();
      }
      // Keep one stable snapshot shape for every consumer of this shared key.
      return { etag: response.metadata.etag, organization };
    },
    retry: retrySettingsQuery,
  });

  return (
    <RoutePage
      title="Organization settings"
      eyebrow={`Verified organization · ${roleLabel(context.organization.role)}`}
      description="Review this organization and your access."
      routeKey={`organization-settings-general-${context.organizationId}`}
    >
      <OrganizationSettingsFrame>
        {organizationQuery.isPending ? (
          <OrganizationSettingsLoading label="Loading organization details" />
        ) : organizationQuery.isError ? (
          <OrganizationSettingsError
            error={organizationQuery.error}
            label="Organization details unavailable"
            onRetry={() => void organizationQuery.refetch()}
          />
        ) : (
          <OrganizationOverview
            context={context}
            organization={organizationQuery.data.organization}
          />
        )}
        <OrganizationMemberControls
          key={context.principal.id + context.organizationId}
          runtime={context.runtime}
          principal={context.principal}
          organizationId={context.organizationId}
          mode="leave"
        />
      </OrganizationSettingsFrame>
    </RoutePage>
  );
}

function OrganizationOverview({
  context,
  organization,
}: {
  readonly context: VerifiedOrganizationSettingsContext;
  readonly organization: OrganizationV1;
}) {
  const status = organizationStatus(organization.lifecycleStatus);

  return (
    <section
      className="organization-overview"
      aria-labelledby="organization-overview-title"
    >
      <div className="organization-overview__heading">
        <div>
          <p className="status-label">Organization overview</p>
          <h2 id="organization-overview-title">{organization.displayName}</h2>
          <p>
            Organization details are read-only. Manage people and connections
            using the settings navigation.
          </p>
        </div>
        <StatusBadge label={status.label} tone={status.tone} />
      </div>
      <dl className="organization-overview__facts">
        <div>
          <dt>Created</dt>
          <dd>{formatDate(organization.createdAt)}</dd>
        </div>
        <div>
          <dt>Your access</dt>
          <dd>{roleLabel(context.organization.role)}</dd>
        </div>
      </dl>
      <details className="settings-technical-details">
        <summary>Technical details</summary>
        <dl>
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
          <div>
            <dt>Record version</dt>
            <dd>{organization.version ?? "Not provided"}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

function AuthenticatedOrganizationMembers({
  context,
}: {
  readonly context: VerifiedOrganizationSettingsContext;
}) {
  const membershipQuery = useInfiniteQuery({
    queryKey: cloudMarkupQueryKeys.memberships(
      context.principal.id,
      context.organizationId,
    ),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<MembershipPage> => {
      const response = await context.runtime.client.request(
        "organization-members.list",
        {
          path: { organizationId: context.organizationId },
          query: {
            "page[limit]": "100",
            ...(pageParam === undefined ? {} : { "page[cursor]": pageParam }),
          },
        },
      );
      const items = response.data.map((item) =>
        organizationMemberV1Schema.parse(item),
      );
      const page = pageMetadataSchema.parse(response.page);
      if (
        items.some(
          (membership, index) =>
            membership.organizationId !== context.organizationId ||
            membership.membershipId <=
              (items[index - 1]?.membershipId ?? pageParam ?? ""),
        ) ||
        (page.hasMore &&
          (items.length === 0 ||
            page.nextCursor !== items.at(-1)?.membershipId))
      ) {
        throw new OrganizationSettingsResponseBindingError();
      }
      return { memberships: items, page };
    },
    getNextPageParam: (lastPage) =>
      lastPage.page.hasMore ? lastPage.page.nextCursor : undefined,
    retry: retrySettingsQuery,
  });
  const memberships =
    membershipQuery.data?.pages.flatMap((page) => page.memberships) ?? [];

  return (
    <RoutePage
      title="Members"
      eyebrow={`Organization settings · ${roleLabel(context.organization.role)}`}
      description="People with access to this organization’s shared projects."
      routeKey={`organization-settings-members-${context.organizationId}`}
    >
      <OrganizationSettingsFrame>
        {membershipQuery.isPending ? (
          <OrganizationSettingsLoading label="Loading organization members" />
        ) : membershipQuery.isError ? (
          <OrganizationSettingsError
            error={membershipQuery.error}
            label="Member directory unavailable"
            onRetry={() => void membershipQuery.refetch()}
          />
        ) : (
          <>
            <MembershipRoster
              hasMore={membershipQuery.hasNextPage}
              isLoadingMore={membershipQuery.isFetchingNextPage}
              memberships={memberships}
              onLoadMore={() => void membershipQuery.fetchNextPage()}
            />
          </>
        )}
        {context.organization.capabilities.includes("memberships.manage") ? (
          <OrganizationInvitationComposer
            key={JSON.stringify([context.principal.id, context.organization])}
            runtime={context.runtime}
            principalId={context.principal.id}
            organizationId={context.organizationId}
            isOwner={
              context.organization.role === "owner" &&
              context.organization.isOwner
            }
          />
        ) : null}
        {context.organization.capabilities.includes("memberships.manage") ? (
          <OrganizationMemberControls
            key={context.principal.id + context.organizationId}
            runtime={context.runtime}
            principal={context.principal}
            organizationId={context.organizationId}
            mode="manage"
          />
        ) : null}
      </OrganizationSettingsFrame>
    </RoutePage>
  );
}

function MembershipRoster({
  hasMore,
  isLoadingMore,
  memberships,
  onLoadMore,
}: {
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  readonly memberships: readonly OrganizationMemberV1[];
  readonly onLoadMore: () => void;
}) {
  return (
    <section
      className="membership-roster"
      aria-labelledby="membership-roster-title"
    >
      <div className="membership-roster__heading">
        <div>
          <p className="status-label">Shared workspace</p>
          <h2 id="membership-roster-title">Organization members</h2>
          <p>
            Active members can access shared projects according to their role.
          </p>
        </div>
        <StatusBadge
          label={`${String(memberships.length)} loaded`}
          tone="read-only"
        />
      </div>
      {memberships.length === 0 ? (
        <div className="membership-roster__empty">
          <h3>No members to show</h3>
          <p>
            No member records are currently available for this organization.
          </p>
        </div>
      ) : (
        <div
          className="membership-table-wrap"
          role="region"
          aria-label="Organization member roster"
          // Named overflow regions need focus so keyboard users can scroll the table.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
        >
          <table className="membership-table">
            <caption className="visually-hidden">
              Organization member roster
            </caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Joined</th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((membership) => (
                <tr key={membership.membershipId}>
                  <th scope="row">{membership.displayName}</th>
                  <td>{roleLabel(membership.role)}</td>
                  <td>
                    <StatusBadge
                      label={
                        membership.status === "active"
                          ? "Active"
                          : membership.status === "removed"
                            ? membership.endReason === "left"
                              ? "Left"
                              : "Removed"
                            : "Suspended"
                      }
                      tone={
                        membership.status === "active" ? "success" : "warning"
                      }
                    />
                  </td>
                  <td>{formatDate(membership.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore ? (
        <button
          className="button button--secondary membership-roster__more"
          disabled={isLoadingMore}
          onClick={onLoadMore}
          type="button"
        >
          {isLoadingMore ? "Loading more members…" : "Load more members"}
        </button>
      ) : null}
      <details className="settings-task">
        <summary>What each role can do</summary>
        <OrganizationRolePermissions />
        <p>
          Authorized invitations can add eligible members. Use Manage member
          access to review role changes, removal or ownership transfer.
        </p>
      </details>
    </section>
  );
}

function OrganizationSettingsLoading({ label }: { readonly label: string }) {
  return (
    <section className="state-card" role="status" aria-live="polite">
      <p className="status-label">Loading</p>
      <h2>{label}</h2>
      <p>Waiting for server-authorized organization data.</p>
    </section>
  );
}

function OrganizationSettingsError({
  error,
  label,
  onRetry,
}: {
  readonly error: unknown;
  readonly label: string;
  readonly onRetry: () => void;
}) {
  return (
    <section className="state-card state-card--error" role="alert">
      <p className="status-label">Could not load settings</p>
      <h2>{label}</h2>
      <p>{mapApiError(error).message}</p>
      <button
        className="button button--secondary"
        onClick={onRetry}
        type="button"
      >
        Try again
      </button>
    </section>
  );
}

function OrganizationSettingsBackendUnavailable({
  section,
}: {
  readonly section: OrganizationSettingsSection;
}) {
  return (
    <RoutePage
      title={organizationSettingsTitles[section]}
      eyebrow="Backend unavailable"
      description="This page requires an authenticated CloudMarkup API session."
      routeKey={`organization-settings-backend-unavailable-${section}`}
    >
      <section className="state-card state-card--error" role="alert">
        <p className="status-label">Service unavailable</p>
        <h2>Organization settings are not configured</h2>
        <p>No local fixture is substituted for server organization data.</p>
      </section>
    </RoutePage>
  );
}

function OrganizationSettingsPermissionDenied({
  context,
  section,
}: {
  readonly context?: VerifiedOrganizationSettingsContext;
  readonly section: OrganizationSettingsSection;
}) {
  const card = (
    <section className="state-card state-card--permission" role="alert">
      <p className="status-label">Permission required</p>
      <h2>This settings section is unavailable</h2>
      <p>No organization or membership details are disclosed.</p>
    </section>
  );

  return (
    <RoutePage
      title="Access unavailable"
      eyebrow="Organization settings"
      description="Access is derived from the verified principal and current organization membership."
      routeKey={`organization-settings-denied-${section}`}
    >
      {context === undefined ? (
        card
      ) : (
        <OrganizationSettingsFrame>{card}</OrganizationSettingsFrame>
      )}
    </RoutePage>
  );
}

function UnavailableOrganizationSettings({
  section,
}: {
  readonly section: OrganizationSettingsSection;
}) {
  return (
    <RoutePage
      title={organizationSettingsTitles[section]}
      eyebrow="Organization settings"
      description="Only implemented, server-authorized settings are shown."
      routeKey={`organization-settings-unavailable-${section}`}
    >
      <OrganizationSettingsFrame>
        <section className="state-card state-card--readonly">
          <p className="status-label">Not available</p>
          <h2>No server-backed contract is available for this section</h2>
          <p>
            CloudMarkup does not infer role administration, policies, security
            controls, retention, export, or deletion actions from a route or
            role label.
          </p>
        </section>
      </OrganizationSettingsFrame>
    </RoutePage>
  );
}

function LocalOrganizationSettingsPage({
  identity,
  section,
}: {
  readonly identity: LocalMockIdentity;
  readonly section: OrganizationSettingsSection;
}) {
  const mayView = hasLocalMockCapability(
    "view-organization-settings",
    identity,
  );
  const requiresUndefinedPolicy =
    section === "roles" || section === "policies" || section === "data";
  const mayManageMembers =
    section !== "members" || hasLocalMockCapability("manage-members", identity);

  return (
    <RoutePage
      title={organizationSettingsTitles[section]}
      eyebrow="Local development fixture"
      description="Synthetic organization behavior for local presentation testing only."
      routeKey={`organization-settings-${section}`}
    >
      {!mayView ? (
        <section className="state-card state-card--permission" role="alert">
          <p className="status-label">Permission required</p>
          <h2>This settings section is unavailable</h2>
          <p>No organization or policy details are disclosed.</p>
        </section>
      ) : (
        <section
          className={`state-card ${
            requiresUndefinedPolicy || !mayManageMembers
              ? "state-card--permission"
              : "state-card--readonly"
          }`}
        >
          <p className="status-label">
            {requiresUndefinedPolicy || !mayManageMembers
              ? "Capability unavailable"
              : "Local fixture only"}
          </p>
          <h2>No organization changes can be made</h2>
          <p>
            {requiresUndefinedPolicy
              ? "The role, policy, retention, export, and deletion contracts remain unresolved. This shell does not invent them."
              : !mayManageMembers
                ? "Membership management is not enabled in the current environment. No guessed role name is used."
                : "This development preview shows no server-derived metadata and provides no mutation request."}
          </p>
        </section>
      )}
    </RoutePage>
  );
}

export type { OrganizationSettingsSection, PersonalSettingsSection };
