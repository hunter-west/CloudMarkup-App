import {
  ApiClientError,
  creditTopUpWorkspaceV1Schema,
  hostedBillingSessionV1Schema,
  type CreateCreditTopUpV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import {
  openBillingWindow,
  HostedBillingWindowError,
  type HostedBillingWindow,
} from "./billing-hosted-window.js";
type PackKey = CreateCreditTopUpV1["packKey"];
export function CreditTopUpSection({
  runtime,
  principalId,
  organizationId,
  authorizationScope,
  disabled,
  openHosted,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principalId: string;
  readonly organizationId: string;
  readonly authorizationScope: string;
  readonly disabled: boolean;
  readonly openHosted?: ((url: string) => void) | undefined;
}) {
  const [pending, setPending] = useState<PackKey | null>(null),
    [error, setError] = useState<string | null>(null);
  const active = useRef(false),
    busy = useRef(false),
    popup = useRef<HostedBillingWindow | null>(null),
    keys = useRef(new Map<PackKey, string>());
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      popup.current?.close();
      popup.current = null;
    };
  }, []);
  const workspace = useQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.commercialSummary(principalId, organizationId),
      "credit-top-ups",
      authorizationScope,
    ],
    queryFn: async () => {
      const result = await runtime.client.request("billing.top-ups.get", {
        path: { organizationId },
      });
      const value = creditTopUpWorkspaceV1Schema.parse(result.data);
      if (value.organizationId !== organizationId)
        throw Error("Credit purchase scope mismatch");
      return value;
    },
    retry: false,
    refetchOnWindowFocus: true,
  });
  const { refetch } = workspace,
    latest = workspace.data?.latestPurchase;
  useEffect(() => {
    if (latest?.state === "fulfilled" || latest?.state === "expired")
      keys.current.clear();
  }, [latest?.id, latest?.state]);
  useEffect(() => {
    if (latest?.state === "fulfilled") {
      void runtime.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.commercialSummary(
          principalId,
          organizationId,
        ),
      });
    }
  }, [
    latest?.id,
    latest?.state,
    runtime.queryClient,
    principalId,
    organizationId,
  ]);
  useEffect(() => {
    if (latest?.state !== "pending" && latest?.state !== "created") return;
    let reads = 0;
    const timer = window.setInterval(() => {
      void refetch();
      reads += 1;
      if (reads >= 12) window.clearInterval(timer);
    }, 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, [latest?.id, latest?.state, refetch]);
  function isActive() {
    return active.current;
  }
  async function purchase(packKey: PackKey) {
    if (
      disabled ||
      busy.current ||
      !active.current ||
      !workspace.data?.canPurchase
    )
      return;
    busy.current = true;
    setPending(packKey);
    setError(null);
    const key = keys.current.get(packKey) ?? "topup-" + crypto.randomUUID();
    keys.current.set(packKey, key);
    try {
      if (openHosted === undefined)
        popup.current = openBillingWindow(() => {
          if (isActive()) void refetch();
        });
      const response = await runtime.client.request(
        "billing.top-ups.checkout.create",
        {
          path: { organizationId },
          headers: { "idempotency-key": key },
          body: { contractVersion: 1, packKey },
        },
      );
      const session = hostedBillingSessionV1Schema.parse(response.data);
      if (
        session.organizationId !== organizationId ||
        session.kind !== "checkout"
      )
        throw Error("Credit checkout scope mismatch");
      if (isActive()) {
        if (openHosted) openHosted(session.url);
        else popup.current?.navigate(session.url);
        popup.current = null;
        void refetch();
      }
    } catch (cause) {
      if (isActive()) {
        setError(
          cause instanceof HostedBillingWindowError
            ? cause.message
            : cause instanceof ApiClientError &&
                cause.envelope.error.code === "conflict"
              ? "Your existing purchase is still pending or has completed. Refresh its status before starting another."
              : cause instanceof ApiClientError &&
                  ["authentication_required", "access_denied"].includes(
                    cause.envelope.error.code,
                  )
                ? "Sign in again as an account owner or administrator to buy credits."
                : "Credit Checkout could not be opened. Try again with the same purchase.",
        );
        void refetch();
      }
    } finally {
      popup.current?.close();
      popup.current = null;
      if (isActive()) {
        busy.current = false;
        setPending(null);
      }
    }
  }
  const value = workspace.data;
  return (
    <section className="billing-top-ups" aria-labelledby="credit-top-ups-title">
      <div className="billing-current">
        <div>
          <h2 id="credit-top-ups-title">Credit top-ups</h2>
          <p>Extra credits for your account. Purchased credits never expire.</p>
        </div>
        <button
          type="button"
          className="button button--secondary"
          disabled={pending !== null || workspace.isFetching}
          onClick={() => void refetch()}
        >
          Refresh credit status
        </button>
      </div>
      {workspace.isPending ? (
        <p role="status">Loading credit packs…</p>
      ) : workspace.isError ? (
        <p role="alert">
          Credit packs are unavailable. Refresh credit status to try again.
        </p>
      ) : (
        value && (
          <>
            <p>
              <strong>
                {BigInt(value.availableCreditUnits).toLocaleString()}
              </strong>{" "}
              credits available in this workspace.
            </p>
            {value.mode === "disabled" ? (
              <p className="billing-availability">
                Credit purchases are not enabled yet.
              </p>
            ) : !value.canPurchase ? (
              <p className="billing-availability">
                An active subscription and an owner or administrator account are
                required to buy credits.
              </p>
            ) : null}
            {latest?.needsReview ? (
              <p role="status">
                This purchase needs billing review. Its recorded credit history
                has been retained.
              </p>
            ) : latest?.state === "fulfilled" ? (
              <p role="status">
                Payment verified. Your purchased credits are available.
              </p>
            ) : latest?.state === "pending" || latest?.state === "created" ? (
              <p role="status">
                Payment has not been confirmed yet. Resume Checkout or refresh
                credit status.
              </p>
            ) : latest?.state === "expired" ? (
              <p role="status">
                The previous Checkout expired. You can start a new purchase.
              </p>
            ) : null}
            {error && <p role="alert">{error}</p>}
            <div
              className="billing-plan-grid billing-top-up-grid"
              role="group"
              aria-label="Credit packs"
            >
              {value.packs.map((pack) => (
                <section className="billing-plan" key={pack.key}>
                  <h3>{pack.creditUnits.toLocaleString()} credits</h3>
                  <p className="billing-plan-price">
                    <strong>
                      {new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: pack.currency,
                        maximumFractionDigits: 0,
                      }).format(Number(pack.priceMicros) / 1000000)}
                    </strong>
                    <span>one time</span>
                  </p>
                  <p>No expiration</p>
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={
                      disabled ||
                      !value.canPurchase ||
                      pending !== null ||
                      ((latest?.state === "pending" ||
                        latest?.state === "created") &&
                        latest.packKey !== pack.key)
                    }
                    onClick={() => void purchase(pack.key)}
                  >
                    {pending === pack.key
                      ? "Opening Stripe…"
                      : (latest?.state === "pending" ||
                            latest?.state === "created") &&
                          latest.packKey === pack.key
                        ? "Resume Checkout"
                        : `Buy ${pack.creditUnits.toLocaleString()} credits`}
                  </button>
                </section>
              ))}
            </div>
            <p className="billing-availability">
              Monthly credits expire at the end of the billing period. Top-up
              credits remain until used. Credits are added only after payment
              verification.
            </p>
          </>
        )
      )}
    </section>
  );
}
