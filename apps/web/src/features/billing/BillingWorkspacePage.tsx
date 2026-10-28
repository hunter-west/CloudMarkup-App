import { CreditTopUpSection } from "./CreditTopUpSection.js";
import {
  ApiClientError,
  billingWorkspaceV1Schema,
  hostedBillingSessionV1Schema,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import { Disclosure } from "@cloudmarkup/ui";
import { useEffect, useRef, useState } from "react";

import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { useAppLocation } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import "../settings/settings.css";
import {
  HostedBillingWindowError,
  openBillingWindow,
  type HostedBillingWindow,
} from "./billing-hosted-window.js";
import "./billing-workspace.css";

type CheckoutPlan = "starter" | "pro";
type BillingAction = "portal" | CheckoutPlan;

function message(error: unknown, action?: BillingAction): string {
  if (error instanceof HostedBillingWindowError) return error.message;
  if (error instanceof ApiClientError) {
    switch (error.envelope.error.code) {
      case "authentication_required":
        return "Your session expired. Sign in again to continue.";
      case "access_denied":
        return "An owner or administrator with a recent sign-in is required. Sign in again if you manage this organization.";
      case "conflict":
        return action === "portal"
          ? "Billing management could not be opened. Refresh status and try again."
          : "Checkout could not be opened yet. Your billing status has been refreshed. Try again shortly.";
      case "service_unavailable":
        return "Billing is temporarily unavailable. No billing change has been confirmed. Refresh billing status before retrying a pending action.";
      default:
        return "The billing request could not be completed. Please try again.";
    }
  }
  return "CloudMarkup could not complete the billing request. Please try again.";
}

interface BillingWorkspacePageProps {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principal: CurrentPrincipalV1;
  readonly organizationId: string;
  readonly openHosted?: (url: string) => void;
}

export function BillingWorkspacePage(props: BillingWorkspacePageProps) {
  // This verified context partitions presentation state only. The server still
  // authorizes every read and hosted-session request independently.
  const authorizationScope = JSON.stringify([
    props.principal.id,
    props.organizationId,
    props.principal.organizationContexts.find(
      (context) => context.organizationId === props.organizationId,
    ) ?? null,
  ]);
  return (
    <ScopedBillingWorkspacePage
      key={authorizationScope}
      authorizationScope={authorizationScope}
      {...props}
    />
  );
}

function ScopedBillingWorkspacePage({
  authorizationScope,
  runtime,
  principal,
  organizationId,
  openHosted,
}: BillingWorkspacePageProps & { readonly authorizationScope: string }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reservedWindow = useRef<HostedBillingWindow | null>(null);
  const [returnedWindow, setReturnedWindow] = useState<{
    readonly plan: string | null;
    readonly state: string;
  } | null>(null);
  const busy = useRef(false);
  const keys = useRef(new Map<string, string>());
  const activeScope = useRef(false);
  useEffect(() => {
    activeScope.current = true;
    return () => {
      // The server may have accepted the request. Leaving this scope must not
      // redirect another page or actor when the hosted response arrives later.
      activeScope.current = false;
      reservedWindow.current?.close();
      reservedWindow.current = null;
    };
  }, []);
  const isActiveScope = () => activeScope.current;
  const workspace = useQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.commercialSummary(principal.id, organizationId),
      "billing-workspace",
      authorizationScope,
    ] as const,
    queryFn: async () => {
      const response = await runtime.client.request("billing.workspace.get", {
        path: { organizationId },
      });
      if (response.data.organizationId !== organizationId)
        throw new Error("Billing scope mismatch.");
      return billingWorkspaceV1Schema.parse(response.data);
    },
    retry: false,
    refetchOnWindowFocus: true,
  });

  const verifiedState = workspace.data
    ? JSON.stringify([
        workspace.data.accountState,
        workspace.data.subscriptionState,
        workspace.data.currentPlanKey,
        workspace.data.canCheckout,
        workspace.data.canManage,
      ])
    : null;
  const previousVerifiedState = useRef<string | null>(null);
  useEffect(() => {
    if (verifiedState === null) return;
    const previous = previousVerifiedState.current;
    previousVerifiedState.current = verifiedState;
    if (previous === null || previous === verifiedState) return;
    // Only a verified server transition refreshes the other commercial views.
    // Credit and export eligibility still come from their authenticated reads.
    const queryKey = cloudMarkupQueryKeys.commercialSummary(
      principal.id,
      organizationId,
    );
    void runtime.queryClient.invalidateQueries({
      queryKey,
      predicate: (query) =>
        query.queryKey[queryKey.length] !== "billing-workspace",
    });
  }, [verifiedState, runtime.queryClient, principal.id, organizationId]);

  const location = useAppLocation();
  const returnedFromCheckout =
    new URLSearchParams(location.search).get("checkout") === "returned";
  const subscriptionState = workspace.data?.subscriptionState;
  const waitingForReturnUpdate =
    (returnedFromCheckout && subscriptionState === "not-subscribed") ||
    (returnedWindow !== null &&
      returnedWindow.state === subscriptionState &&
      returnedWindow.plan === workspace.data?.currentPlanKey);
  const { refetch } = workspace;
  useEffect(() => {
    if (!waitingForReturnUpdate || workspace.isError) return;
    // A redirect only starts bounded read-only reconciliation feedback.
    // It never grants a subscription or repeats a checkout request.
    let reads = 0;
    const timer = window.setInterval(() => {
      void refetch();
      reads += 1;
      if (reads >= 12) window.clearInterval(timer);
    }, 5_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refetch, waitingForReturnUpdate, returnedWindow, workspace.isError]);

  async function start(kind: BillingAction) {
    if (
      busy.current ||
      !isActiveScope() ||
      !workspace.data ||
      (kind === "portal"
        ? !workspace.data.canManage
        : !workspace.data.canCheckout)
    )
      return;
    busy.current = true;
    setPending(kind);
    setError(null);
    let key = keys.current.get(kind) ?? "billing-" + crypto.randomUUID();
    keys.current.set(kind, key);
    const request = () =>
      kind === "portal"
        ? runtime.client.request("billing.portal.create", {
            path: { organizationId },
            headers: { "idempotency-key": key },
            body: { contractVersion: 1 },
          })
        : runtime.client.request("billing.checkout.create", {
            path: { organizationId },
            headers: { "idempotency-key": key },
            body: { contractVersion: 1, planKey: kind },
          });
    try {
      if (openHosted === undefined)
        reservedWindow.current = openBillingWindow(() => {
          if (!isActiveScope()) return;
          setReturnedWindow({
            plan: workspace.data.currentPlanKey,
            state: workspace.data.subscriptionState,
          });
          void workspace.refetch();
        });
      let response;
      try {
        response = await request();
      } catch (cause) {
        if (
          kind === "portal" ||
          !(cause instanceof ApiClientError) ||
          cause.envelope.error.code !== "conflict"
        )
          throw cause;
        const current = await workspace.refetch();
        if (!isActiveScope()) return;
        if (current.data?.canManage && !current.data.canCheckout) return;
        if (current.isError || !current.data?.canCheckout) throw cause;
        // One confirmed conflict can mean the server retired an expired
        // checkout. The same click retries once; only the server can replace
        // its durable attempt after verifying terminal provider state.
        key = "billing-" + crypto.randomUUID();
        keys.current.set(kind, key);
        response = await request();
      }
      const session = hostedBillingSessionV1Schema.parse(response.data);
      if (
        session.organizationId !== organizationId ||
        session.kind !== (kind === "portal" ? "portal" : "checkout")
      )
        throw new Error("Billing session scope mismatch.");
      if (isActiveScope()) {
        if (openHosted !== undefined) openHosted(session.url);
        else reservedWindow.current?.navigate(session.url);
        reservedWindow.current = null;
      }
    } catch (cause) {
      if (isActiveScope()) setError(message(cause, kind));
    } finally {
      reservedWindow.current?.close();
      reservedWindow.current = null;
      if (isActiveScope()) {
        busy.current = false;
        setPending(null);
      }
    }
  }

  const value = workspace.data;
  return (
    <RoutePage
      title="Billing"
      eyebrow="Workspace billing"
      description="Choose a plan or manage your subscription securely with Stripe."
      routeKey={`billing-${organizationId}`}
    >
      <div className="settings-content billing-workspace">
        {value?.mode === "stripe-sandbox" && (
          <p className="billing-sandbox-note">
            <span className="status-label">Sandbox</span> Test payments only. Do
            not enter real payment details.
          </p>
        )}
        {workspace.isPending ? (
          <p role="status">Loading plans and subscription…</p>
        ) : workspace.isError ? (
          <section className="state-card state-card--error" role="alert">
            <h2>Billing summary unavailable</h2>
            <p>{message(workspace.error)}</p>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void workspace.refetch()}
            >
              Try again
            </button>
          </section>
        ) : (
          value && (
            <>
              <section
                className="billing-current"
                aria-label="Current subscription"
              >
                <div>
                  <p className="status-label">Current subscription</p>
                  <h2>
                    {value.subscriptionState === "not-subscribed"
                      ? "Not subscribed"
                      : (value.plans.find(
                          (plan) => plan.key === value.currentPlanKey,
                        )?.displayName ?? "Subscription pending")}
                  </h2>
                  <p>
                    {value.subscriptionState === "not-subscribed"
                      ? value.canCheckout
                        ? "Choose a plan below to continue to secure Checkout."
                        : "Plan previews are available below."
                      : value.subscriptionState.replaceAll("-", " ")}
                  </p>
                </div>
                <div className="billing-actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={pending !== null || workspace.isFetching}
                    onClick={() => void workspace.refetch()}
                  >
                    Refresh status
                  </button>
                  {value.canManage && (
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={pending !== null}
                      onClick={() => void start("portal")}
                    >
                      {pending === "portal"
                        ? "Opening Stripe…"
                        : "Manage billing"}
                    </button>
                  )}
                </div>
              </section>
              {value.mode === "disabled" && (
                <p role="status" className="billing-availability">
                  Plan previews are available. Sandbox Checkout and subscription
                  management are still being connected.
                </p>
              )}
              {value.mode !== "disabled" &&
                !value.canCheckout &&
                !value.canManage && (
                  <p className="billing-availability">
                    {value.accountState === "suspended" ||
                    value.accountState === "closed"
                      ? "Billing changes are unavailable while this billing account is suspended or closed."
                      : "Billing changes are unavailable for your account. Ask an organization owner for help."}
                  </p>
                )}
              {error && (
                <div role="alert" className="state-card state-card--error">
                  <p>{error}</p>
                </div>
              )}
              <section
                className="billing-section"
                aria-labelledby="monthly-plans-title"
              >
                <h2 id="monthly-plans-title">Monthly plans</h2>
                <div
                  className="billing-plan-grid"
                  role="group"
                  aria-label="Monthly plans"
                >
                  {value.plans.map((plan) => (
                    <section
                      className="billing-plan"
                      key={plan.key}
                      aria-labelledby={`billing-plan-${plan.key}`}
                    >
                      <h3 id={`billing-plan-${plan.key}`}>
                        {plan.displayName}
                      </h3>
                      <p className="billing-plan-price">
                        <strong>
                          {new Intl.NumberFormat(undefined, {
                            style: "currency",
                            currency: plan.currency,
                            maximumFractionDigits: 0,
                          }).format(
                            Number(plan.monthlyPriceMicros) / 1_000_000,
                          )}
                        </strong>
                        <span>/ month</span>
                      </p>
                      <p>
                        {plan.monthlyCreditUnits.toLocaleString()} shared
                        organization AI credits per paid month.
                      </p>
                      <p className="billing-plan-description">
                        {plan.key === "starter"
                          ? "For individual architecture projects."
                          : "For larger projects and reviewed repository export."}
                      </p>
                      <button
                        type="button"
                        className={`button ${plan.key === "pro" ? "button--primary" : "button--secondary"}`}
                        disabled={!value.canCheckout || pending !== null}
                        onClick={() => void start(plan.key)}
                      >
                        {pending === plan.key
                          ? "Opening Stripe…"
                          : value.currentPlanKey === plan.key &&
                              value.subscriptionState !== "canceled"
                            ? "Current plan"
                            : `Continue with ${plan.displayName}`}
                      </button>
                    </section>
                  ))}
                </div>
              </section>
              <CreditTopUpSection
                runtime={runtime}
                principalId={principal.id}
                organizationId={organizationId}
                authorizationScope={authorizationScope}
                disabled={pending !== null}
                openHosted={openHosted}
              />
              <Disclosure summary="Payment, credits and availability">
                <p>
                  Stripe hosts Checkout, payment methods, invoices and
                  cancellation. Returning from Checkout does not activate a
                  plan: this page updates only after verified payment
                  processing.
                </p>
                <p>
                  Credits are shared by this organization. AI and export actions
                  still require an enabled service and the applicable plan
                  permissions. A subscription does not enable an unfinished
                  integration or deploy customer infrastructure.
                </p>
                <p>
                  No automatic overages or trial periods.{" "}
                  {value.mode === "stripe-live"
                    ? "Paid plans renew monthly until canceled. Credit packs are one-time purchases."
                    : "Live charges are not enabled in this environment."}
                </p>
              </Disclosure>
              <p className="billing-status-time">
                Status checked{" "}
                <time dateTime={value.asOf}>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(value.asOf))}
                </time>
              </p>
            </>
          )
        )}
      </div>
    </RoutePage>
  );
}
