import "./credit-overview.css";
import {
  ApiClientError,
  billingWorkspaceV1Schema,
  creditOverviewV1Schema,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Disclosure } from "@cloudmarkup/ui";

import {
  cloudMarkupQueryKeys,
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import {
  hasLocalMockCapability,
  localMockIdentity,
  type LocalMockIdentity,
} from "../../mock/local-mock-context.js";
import { AppLink, encodeRouteSelector } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import "../settings/settings.css";
import { useOptionalLocalOwnerSession } from "../auth/local-owner-session.js";
import { BillingWorkspacePage } from "./BillingWorkspacePage.js";

type OrganizationContext = CurrentPrincipalV1["organizationContexts"][number];

export interface CommercialPageProps {
  /** Compatibility-only fixture identity for direct presentation tests. */
  readonly identity?: LocalMockIdentity;
  readonly organizationId?: string;
  readonly principal?: CurrentPrincipalV1;
}

interface VerifiedCommercialContext {
  readonly organization: OrganizationContext;
  readonly organizationId: string;
  readonly principal: CurrentPrincipalV1;
  readonly runtime: CloudMarkupQueryRuntime;
}

const COMMERCIAL_RESPONSE_BINDING_ERROR =
  "The commercial response did not match the requested organization scope.";

class CommercialResponseBindingError extends Error {
  public constructor() {
    super(COMMERCIAL_RESPONSE_BINDING_ERROR);
    this.name = "CommercialResponseBindingError";
  }
}

function assertCommercialResponseBinding(
  response: { readonly organizationId: string },
  organizationId: string,
): void {
  if (response.organizationId !== organizationId) {
    throw new CommercialResponseBindingError();
  }
}

function projectsPath(organizationId: string): string {
  return `/organizations/${encodeRouteSelector(organizationId)}/projects`;
}

function commercialContext(
  props: CommercialPageProps,
  runtime: CloudMarkupQueryRuntime | null,
  allowOrganizationRead = false,
): VerifiedCommercialContext | "unavailable" | "denied" | null {
  const usesBackend =
    props.principal !== undefined || props.organizationId !== undefined;
  if (!usesBackend) return null;
  if (
    runtime === null ||
    props.principal === undefined ||
    props.organizationId === undefined
  ) {
    return "unavailable";
  }
  const organization = props.principal.organizationContexts.find(
    (candidate) => candidate.organizationId === props.organizationId,
  );
  if (
    !organization ||
    (!organization.capabilities.includes("commercial.summary.read") &&
      !(
        allowOrganizationRead &&
        organization.capabilities.includes("organizations.read")
      ))
  ) {
    return "denied";
  }
  return {
    organization,
    organizationId: props.organizationId,
    principal: props.principal,
    runtime,
  };
}

function commercialErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return "CloudMarkup could not load the organization commercial summary.";
  }
  switch (error.envelope.error.code) {
    case "authentication_required":
      return "Your session has expired. Sign in again to continue.";
    case "access_denied":
      return "You do not have permission to view this organization summary.";
    case "not_found":
      return "The organization commercial summary is unavailable.";
    case "service_unavailable":
      return "The organization credit summary is temporarily unavailable.";
    default:
      return "CloudMarkup could not load the organization commercial summary.";
  }
}

function retryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof CommercialResponseBindingError) return false;
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

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function CommercialPermissionPlaceholder({
  kind,
  organizationId,
  unavailable = false,
}: {
  readonly kind: "billing" | "usage";
  readonly organizationId: string;
  readonly unavailable?: boolean;
}) {
  return (
    <RoutePage
      title="Access unavailable"
      eyebrow={unavailable ? "Backend unavailable" : "Permission denied"}
      description={
        unavailable
          ? "Sign in again to load this organization’s summary."
          : `You do not have permission to view ${kind} for this organization.`
      }
      routeKey={`${kind}-${unavailable ? "unavailable" : "denied"}`}
    >
      <section
        className={`state-card ${unavailable ? "state-card--error" : "state-card--permission"}`}
        role="alert"
      >
        <p className="status-label">
          {unavailable ? "Service unavailable" : "Permission required"}
        </p>
        <h2>
          No{" "}
          {kind === "billing"
            ? "billing details are"
            : "usage or credit details are"}{" "}
          disclosed
        </h2>
        <p>Ask an organization owner for help, or return to your projects.</p>
        <AppLink
          className="button button--secondary"
          to={projectsPath(organizationId)}
        >
          Return to projects
        </AppLink>
      </section>
    </RoutePage>
  );
}

function SelfHostedCommercialPage({
  kind,
}: {
  readonly kind: "billing" | "usage";
}) {
  return (
    <RoutePage
      eyebrow="Self-hosted instance"
      title={kind === "billing" ? "Plans & billing" : "Usage"}
      routeKey={`self-hosted-${kind}`}
    >
      <section className="state-card state-card--readonly">
        <h2>CloudMarkup commercial accounts are not used here</h2>
        <p>
          Hosted plans, credit balances and billing controls are unavailable in
          local owner mode. AI features and provider calls are disabled in this
          core installation.
        </p>
        <AppLink to="/organizations">Return to workspaces</AppLink>
      </section>
    </RoutePage>
  );
}

export function BillingPage(props: CommercialPageProps = {}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const localOwner = useOptionalLocalOwnerSession();
  if (localOwner !== null) return <SelfHostedCommercialPage kind="billing" />;
  const context = commercialContext(props, runtime, true);
  if (context === null)
    return <LegacyBillingPage identity={props.identity ?? localMockIdentity} />;
  if (context === "unavailable")
    return (
      <CommercialPermissionPlaceholder
        kind="billing"
        organizationId={props.organizationId ?? "organization_unavailable"}
        unavailable
      />
    );
  if (context === "denied")
    return (
      <CommercialPermissionPlaceholder
        kind="billing"
        organizationId={props.organizationId ?? "organization_unavailable"}
      />
    );
  return (
    <BillingWorkspacePage
      key={`${context.principal.id}:${context.organizationId}`}
      runtime={context.runtime}
      principal={context.principal}
      organizationId={context.organizationId}
    />
  );
}

export function UsagePage(props: CommercialPageProps = {}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const localOwner = useOptionalLocalOwnerSession();
  if (localOwner !== null) return <SelfHostedCommercialPage kind="usage" />;
  const context = commercialContext(props, runtime);
  if (context === null)
    return <LegacyUsagePage identity={props.identity ?? localMockIdentity} />;
  if (context === "unavailable")
    return (
      <CommercialPermissionPlaceholder
        kind="usage"
        organizationId={props.organizationId ?? "organization_unavailable"}
        unavailable
      />
    );
  if (context === "denied")
    return (
      <CommercialPermissionPlaceholder
        kind="usage"
        organizationId={props.organizationId ?? "organization_unavailable"}
      />
    );
  return (
    <AuthenticatedUsagePage
      key={JSON.stringify([
        context.principal.id,
        context.organizationId,
        context.organization,
      ])}
      context={context}
    />
  );
}

function AuthenticatedUsagePage({
  context,
}: {
  readonly context: VerifiedCommercialContext;
}) {
  const authorizationScope = JSON.stringify(context.organization);
  const queryKey = useMemo(
    () =>
      [
        ...cloudMarkupQueryKeys.commercialSummary(
          context.principal.id,
          context.organizationId,
        ),
        "credit-overview",
        authorizationScope,
      ] as const,
    [context.principal.id, context.organizationId, authorizationScope],
  );
  const balance = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const [credits, billing] = await Promise.all([
        context.runtime.client.request("commercial.credit-overview.get", {
          path: { organizationId: context.organizationId },
          query: {},
        }),
        context.runtime.client.request("billing.workspace.get", {
          path: { organizationId: context.organizationId },
        }),
      ]);
      if (signal.aborted) throw new Error("Credit summary scope changed.");
      const parsed = creditOverviewV1Schema.safeParse(credits.data);
      if (!parsed.success) throw new CommercialResponseBindingError();
      const overview = parsed.data;
      assertCommercialResponseBinding(overview.balance, context.organizationId);
      assertCommercialResponseBinding(billing.data, context.organizationId);
      return {
        ...overview.balance,
        availableByKind: overview.availableByKind,
        nextExpiration: overview.nextExpiration,
        billing: billingWorkspaceV1Schema.parse(billing.data),
      };
    },
    retry: retryQuery,
    staleTime: 0,
    refetchOnMount: "always",
  });
  useEffect(
    () => () => {
      void context.runtime.queryClient.cancelQueries({ queryKey, exact: true });
      context.runtime.queryClient.removeQueries({ queryKey, exact: true });
    },
    [context.runtime.queryClient, queryKey],
  );
  const value = balance.data;
  const noGrants =
    value?.totalGrantedCreditUnits === 0 &&
    value.netAdjustmentCreditUnits === 0;
  return (
    <RoutePage
      title="Usage"
      eyebrow="Workspace credits"
      description="Your monthly allowance, purchased credits and recorded usage."
      routeKey={`usage-${context.organizationId}`}
    >
      <div className="settings-content usage-content">
        {balance.isPending ? (
          <section className="state-card" role="status" aria-live="polite">
            <p className="status-label">Loading</p>
            <h2>Loading credit summary</h2>
          </section>
        ) : balance.isError ? (
          <section className="state-card state-card--error" role="alert">
            <p className="status-label">Could not load credits</p>
            <h2>Usage summary unavailable</h2>
            <p>{commercialErrorMessage(balance.error)}</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void balance.refetch()}
            >
              Try again
            </button>
          </section>
        ) : (
          value && (
            <>
              <section className="usage-overview" role="status">
                <div className="usage-overview__summary">
                  <p className="status-label">
                    {noGrants
                      ? "No credits granted"
                      : value.exhausted
                        ? "No credits available"
                        : "Credits available"}
                  </p>
                  <h2>
                    {value.availableCreditUnits.toLocaleString()} available
                    credits
                  </h2>
                  <p>
                    {value.billing.subscriptionState === "not-subscribed"
                      ? "Not subscribed. Credits are shown only from recorded grants and usage."
                      : `${value.billing.plans.find((plan) => plan.key === value.billing.currentPlanKey)?.displayName ?? "Subscription"} · ${value.billing.subscriptionState.replaceAll("-", " ")}`}
                  </p>
                  <p>
                    Credit availability does not change your existing
                    permissions to read projects or edit manually.
                  </p>
                </div>
                <div className="form-actions usage-actions">
                  <AppLink
                    className="button button--secondary"
                    to={`/organizations/${encodeRouteSelector(context.organizationId)}/billing`}
                  >
                    View billing
                  </AppLink>
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={balance.isFetching}
                    onClick={() => void balance.refetch()}
                  >
                    Refresh credits
                  </button>
                </div>
              </section>
              <section
                className="usage-sources"
                aria-label="Available credits by source"
              >
                <h2>Available credits by source</h2>
                <div className="metric-grid">
                  <section
                    className="metric-card credit-source-card"
                    aria-label="Monthly credits"
                  >
                    <h3>Monthly credits</h3>
                    <p>{value.availableByKind.monthly.toLocaleString()}</p>
                    <p className="credit-source-description">
                      Unused monthly credits expire at the end of their billing
                      period.
                    </p>
                  </section>
                  <section
                    className="metric-card credit-source-card"
                    aria-label="Purchased credits"
                  >
                    <h3>Purchased credits</h3>
                    <p>{value.availableByKind.purchased.toLocaleString()}</p>
                    <p className="credit-source-description">
                      Top-up packs have no expiration.
                    </p>
                  </section>
                  <section
                    className="metric-card credit-source-card"
                    aria-label="Other credits"
                  >
                    <h3>Other credits</h3>
                    <p>{value.availableByKind.other.toLocaleString()}</p>
                    <p className="credit-source-description">
                      One-time grants, promotions and credit adjustments.
                    </p>
                  </section>
                </div>
                <div className="usage-source-notes">
                  <p>
                    These balances exclude credits reserved for work in
                    progress.
                  </p>
                  <p>
                    {value.reservedCreditUnits.toLocaleString()} credits
                    reserved for work in progress.
                  </p>
                  {value.nextExpiration === null ? (
                    <p>No available credits have a scheduled expiration.</p>
                  ) : (
                    <p>
                      {value.nextExpiration.creditUnits.toLocaleString()}{" "}
                      available credits expire next on{" "}
                      <time dateTime={value.nextExpiration.at}>
                        {formatTimestamp(value.nextExpiration.at)}
                      </time>
                      .
                    </p>
                  )}
                </div>
              </section>
              <Disclosure summary="Credit details and accounting">
                <dl className="usage-accounting">
                  <dt>Total historical grants</dt>
                  <dd>{value.totalGrantedCreditUnits.toLocaleString()}</dd>
                  <dt>Total settled usage</dt>
                  <dd>{value.settledCreditUnits.toLocaleString()}</dd>
                  <dt>Expired credits</dt>
                  <dd>{value.expiredCreditUnits.toLocaleString()}</dd>
                  <dt>Credits awaiting policy resolution</dt>
                  <dd>{value.unresolvedCreditUnits.toLocaleString()}</dd>
                  <dt>Net recorded adjustments</dt>
                  <dd>{value.netAdjustmentCreditUnits.toLocaleString()}</dd>
                </dl>
                <p>
                  Historical grants and settled usage are lifetime accounting
                  totals, not available credits or monthly usage history. Grants
                  can expire or be reduced by recorded adjustments. Subtracting
                  usage from historical grants does not establish your available
                  balance. The available total above also excludes reservations
                  and credits that are not currently eligible to spend.
                </p>
                <p>
                  Credits are not money, provider tokens, a subscription
                  entitlement, or permission to run a request. Paid AI also
                  requires an enabled service and verified entitlement. A return
                  from Checkout never grants credits.
                </p>
                <p>
                  Provider-cost and technical usage details are not disclosed
                  here.
                </p>
              </Disclosure>
              <p className="usage-status-time">
                Balance recorded{" "}
                <time dateTime={value.asOf}>{formatTimestamp(value.asOf)}</time>
                .
              </p>
            </>
          )
        )}
      </div>
    </RoutePage>
  );
}
function LegacyBillingPage({
  identity,
}: {
  readonly identity: LocalMockIdentity;
}) {
  if (!hasLocalMockCapability("view-billing", identity))
    return <LegacyBillingPermissionPlaceholder />;
  return (
    <RoutePage
      title="Billing"
      eyebrow="Organization billing"
      description="Billing data is not available in this workspace."
      routeKey="billing"
    >
      <section className="state-card state-card--warning">
        <p className="status-label">Billing unavailable</p>
        <h2>No verified billing status</h2>
        <p>
          A verified organization summary is required before a plan or payment
          state can be shown.
        </p>
        <Disclosure summary="Why is this unavailable?">
          <p>
            No trusted subscription projection is connected. A redirect alone
            cannot establish billing state, and this account has no verified
            billing-management capability.
          </p>
        </Disclosure>
      </section>
    </RoutePage>
  );
}

function LegacyBillingPermissionPlaceholder() {
  return (
    <RoutePage
      title="Access unavailable"
      eyebrow="Permission denied"
      description="Billing is not enabled in the current environment."
      routeKey="billing-denied"
    >
      <section className="state-card state-card--permission" role="alert">
        <p className="status-label">Permission required</p>
        <h2>No billing details are disclosed</h2>
        <AppLink
          className="button button--secondary"
          to="/organizations/local-org/projects"
        >
          Return to projects
        </AppLink>
      </section>
    </RoutePage>
  );
}

function LegacyUsagePage({
  identity,
}: {
  readonly identity: LocalMockIdentity;
}) {
  if (!hasLocalMockCapability("view-usage", identity)) {
    return (
      <RoutePage
        title="Access unavailable"
        eyebrow="Permission denied"
        description="Usage reporting is not enabled in the current environment."
        routeKey="usage-denied"
      >
        <section className="state-card state-card--permission" role="alert">
          <p className="status-label">Permission required</p>
          <h2>No usage or credit details are disclosed</h2>
          <AppLink
            className="button button--secondary"
            to="/organizations/local-org/projects"
          >
            Return to projects
          </AppLink>
        </section>
      </RoutePage>
    );
  }
  return (
    <RoutePage
      title="Usage"
      eyebrow="Organization usage"
      description="Usage and allowance data is not available in this workspace."
      routeKey="usage"
    >
      <section className="state-card">
        <p className="status-label">Usage unavailable</p>
        <h2>No verified allowance</h2>
        <p>
          A verified organization usage summary is required before current,
          reserved, or shared credits can be shown.
        </p>
        <Disclosure summary="What is missing?">
          <p className="guided-only">
            This workspace cannot yet report how many credits are available or
            used.
          </p>
          <p className="professional-only">
            No organization ledger projection, pricing-policy version, provider
            token count, or cost estimate is loaded.
          </p>
          <p>
            Credits are an allowance, not money, card charges, provider tokens,
            plan entitlement, or proof that a request may run.
          </p>
        </Disclosure>
      </section>
    </RoutePage>
  );
}
