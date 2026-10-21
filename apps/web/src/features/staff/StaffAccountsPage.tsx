import {
  ApiClientError,
  entityTagSchema,
  staffAccountListV1Schema,
  staffAccountDetailV1Schema,
  staffAccountActionV1Schema,
  staffActionReceiptV1Schema,
  type CurrentPrincipalV1,
  type StaffAccountActionV1,
  type StaffAccountDetailV1,
  type StaffPermissionV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  cloudMarkupQueryKeys,
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { AppLink } from "../../routing/index.js";
import { useOptionalLocalOwnerSession } from "../auth/local-owner-session.js";
import { RoutePage } from "../../shell/RoutePage.js";
import "./staff-accounts.css";
import { useStaffAccess } from "./use-staff-access.js";
export function StaffAccountsPage({
  principal,
}: {
  readonly principal?: CurrentPrincipalV1;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const localOwner = useOptionalLocalOwnerSession();
  return (
    <RoutePage
      title="Account administration"
      eyebrow="Platform staff"
      routeKey="staff-accounts"
      description="Find an account, review its credits, and record a support action."
    >
      {runtime && principal && localOwner === null ? (
        <StaffWorkspace
          key={principal.id}
          runtime={runtime}
          principal={principal}
        />
      ) : (
        <p role="alert">Verified staff access is required.</p>
      )}
    </RoutePage>
  );
}
export function StaffWorkspace({
  runtime,
  principal,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principal: CurrentPrincipalV1;
}) {
  const access = useStaffAccess(runtime, principal.id),
    [search, setSearch] = useState(""),
    [submitted, setSubmitted] = useState(""),
    [cursor, setCursor] = useState<string | undefined>(),
    [selected, setSelected] = useState<string | null>(null);
  const permitted = access.data?.permissions.includes("accounts.read") === true;
  const results = useQuery({
    queryKey: ["staff-accounts", principal.id, submitted, cursor],
    enabled: permitted && submitted.length >= 2,
    queryFn: async () =>
      staffAccountListV1Schema.parse(
        (
          await runtime.client.request("staff.accounts.list", {
            query: { q: submitted, ...(cursor ? { cursor } : {}) },
          })
        ).data,
      ),
    retry: false,
    gcTime: 0,
  });
  if (access.isPending) return <p role="status">Checking staff access…</p>;
  if (!permitted)
    return (
      <section className="feature-card" role="alert">
        <h2>Staff access required</h2>
        <p>
          This account does not have platform administration access. Sign in
          with your authorized staff account.
        </p>
        <AppLink className="button button--secondary" to="/settings/profile">
          Back to your account
        </AppLink>
      </section>
    );
  return (
    <div className="staff-workspace section-stack">
      <section className="feature-card">
        <form
          className="staff-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(search.trim());
            setCursor(undefined);
            setSelected(null);
          }}
        >
          <label htmlFor="staff-search">Find an account</label>
          <div className="staff-search__row">
            <input
              id="staff-search"
              type="search"
              minLength={2}
              maxLength={120}
              required
              value={search}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
              }}
              placeholder="Name, account ID, username, or exact email"
            />
            <button className="button button--primary" type="submit">
              Search accounts
            </button>
          </div>
          <p className="staff-help">
            Personal workspaces and organizations have separate credit balances.
          </p>
        </form>
        {submitted && results.isFetching ? (
          <p role="status">Searching accounts…</p>
        ) : null}
        {results.isError ? (
          <p role="alert">
            Account search is unavailable. Try again after checking your
            sign-in.
          </p>
        ) : null}
        {results.data ? (
          <>
            <ul className="staff-account-list" aria-label="Matching accounts">
              {results.data.items.map((item) => (
                <li key={item.organizationId}>
                  <button
                    type="button"
                    className="staff-account-choice"
                    aria-pressed={selected === item.organizationId}
                    onClick={() => {
                      setSelected(item.organizationId);
                    }}
                  >
                    <span>
                      <strong>{item.displayName}</strong>
                      <small>
                        {item.kind === "personal"
                          ? "Personal workspace"
                          : "Organization"}{" "}
                        · {item.billingState}
                      </small>
                    </span>
                    <span className="staff-identifier">
                      {item.billingAccountId}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {results.data.items.length === 0 ? (
              <p role="status">No matching accounts.</p>
            ) : null}
            {results.data.nextCursor ? (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  setCursor(results.data.nextCursor);
                }}
              >
                Next accounts
              </button>
            ) : null}
          </>
        ) : null}
      </section>
      {selected ? (
        <StaffAccount
          key={principal.id + selected}
          runtime={runtime}
          principal={principal}
          organizationId={selected}
          permissions={access.data?.permissions ?? []}
        />
      ) : (
        <p className="staff-help">
          Select an account to review balances and available actions.
        </p>
      )}
    </div>
  );
}
function StaffAccount({
  runtime,
  principal,
  organizationId,
  permissions,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principal: CurrentPrincipalV1;
  readonly organizationId: string;
  readonly permissions: readonly StaffPermissionV1[];
}) {
  const query = useQuery({
    queryKey: ["staff-account", principal.id, organizationId],
    queryFn: async () => {
      const result = await runtime.client.requestWithMetadata(
        "staff.accounts.get",
        { path: { organizationId } },
      );
      const value = staffAccountDetailV1Schema.parse(result.data.data);
      if (value.account.organizationId !== organizationId)
        throw Error("Account response mismatch");
      return { value, etag: entityTagSchema.parse(result.metadata.etag) };
    },
    retry: false,
    gcTime: 0,
  });
  if (query.isPending) return <p role="status">Loading account details…</p>;
  if (query.isError)
    return (
      <section className="feature-card" role="alert">
        <p>
          Account details are unavailable. Verify your staff access and try
          again.
        </p>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => {
            void query.refetch();
          }}
        >
          Reload account
        </button>
      </section>
    );
  const snapshot = query.data,
    detail = snapshot.value;
  return (
    <div className="section-stack">
      <section className="feature-card">
        <p className="status-label">
          {detail.account.kind === "personal"
            ? "Personal workspace"
            : "Organization"}
        </p>
        <h2>{detail.account.displayName}</h2>
        <p>
          {detail.account.planDisplayName ?? "No plan"} ·{" "}
          {detail.account.subscriptionState.replaceAll("-", " ")}
        </p>
        <p className="staff-identifier">{detail.account.billingAccountId}</p>
        {detail.trial ? (
          <section aria-label="Staff trial">
            <h3>Staff trial</h3>
            <p>
              {detail.trial.state} · expires{" "}
              <time dateTime={detail.trial.expiresAt}>
                {new Date(detail.trial.expiresAt).toLocaleString()}
              </time>
            </p>
            <p>
              {detail.trial.availableCreditUnits} of {detail.trial.creditUnits}{" "}
              trial credits available · {detail.trial.reservedCreditUnits}{" "}
              reserved
            </p>
          </section>
        ) : null}
        <dl className="staff-account-stats">
          <div>
            <dt>Available credits</dt>
            <dd>{BigInt(detail.availableCreditUnits).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Reserved credits</dt>
            <dd>{BigInt(detail.reservedCreditUnits).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Expensive operations</dt>
            <dd>
              {detail.account.expensiveOperationsEnabled ? "Enabled" : "Paused"}
            </dd>
          </div>
        </dl>
        <p className="staff-help">
          Complimentary credits fund AI use without a subscription. Account
          pauses and operation limits still apply. No subscription, trial,
          export or team features are added.
        </p>
      </section>
      <StaffActionForm
        key={organizationId}
        runtime={runtime}
        principalId={principal.id}
        snapshot={snapshot}
        permissions={permissions}
        refresh={async () => {
          await Promise.all([
            query.refetch(),
            runtime.queryClient.invalidateQueries({
              queryKey: cloudMarkupQueryKeys.commercialSummary(
                principal.id,
                organizationId,
              ),
            }),
          ]);
        }}
      />
      <section className="feature-card">
        <h2>Complimentary grants</h2>
        {detail.grants.length === 0 ? (
          <p>No complimentary grants recorded.</p>
        ) : (
          <ul className="staff-grant-list">
            {detail.grants.map((grant) => (
              <li key={grant.id}>
                <div>
                  <strong>
                    {BigInt(grant.availableCreditUnits).toLocaleString()} of{" "}
                    {BigInt(grant.creditUnits).toLocaleString()} credits
                    available
                  </strong>
                  <p>
                    Expires {new Date(grant.expiresAt).toLocaleDateString()} ·{" "}
                    {grant.reservedCreditUnits} reserved ·{" "}
                    {grant.consumedCreditUnits} used
                  </p>
                  <p>{grant.reason}</p>
                </div>
                <code className="staff-identifier">{grant.id}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="feature-card">
        <h2>Staff action history</h2>
        <p className="staff-help">
          Latest 100 actions, including grants made by staff to their own
          accounts.
        </p>
        {detail.history.length === 0 ? (
          <p>No staff actions recorded.</p>
        ) : (
          <ol className="staff-history">
            {detail.history.map((item) => (
              <li key={item.actionId}>
                <div>
                  <strong>
                    {item.action === "grant-credits"
                      ? "Credits granted"
                      : item.action === "revoke-credits"
                        ? "Unused credits revoked"
                        : item.action === "grant-trial"
                          ? "Trial granted"
                          : item.action === "revoke-trial"
                            ? "Trial revoked"
                            : item.expensiveOperationsEnabled
                              ? "Operations resumed"
                              : "Operations paused"}
                    {item.creditUnits ? " · " + item.creditUnits : ""}
                  </strong>
                  <time dateTime={item.occurredAt}>
                    {new Date(item.occurredAt).toLocaleString()}
                  </time>
                </div>
                <p>{item.reason}</p>
                <small className="staff-identifier">
                  Staff: {item.actorPrincipalId} · Receipt: {item.actionId}
                </small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
function StaffActionForm({
  runtime,
  principalId,
  snapshot,
  permissions,
  refresh,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principalId: string;
  readonly snapshot: {
    readonly value: StaffAccountDetailV1;
    readonly etag: string;
  };
  readonly permissions: readonly StaffPermissionV1[];
  readonly refresh: () => Promise<void>;
}) {
  const [action, setAction] = useState<StaffAccountActionV1["action"]>(
      permissions.includes("credits.grant")
        ? "grant-credits"
        : permissions.includes("credits.revoke")
          ? "revoke-credits"
          : permissions.includes("trials.grant")
            ? "grant-trial"
            : permissions.includes("trials.revoke")
              ? "revoke-trial"
              : "set-operations",
    ),
    [units, setUnits] = useState("100"),
    [days, setDays] = useState("30"),
    [grantId, setGrantId] = useState(""),
    [reason, setReason] = useState(""),
    [enabled, setEnabled] = useState(false),
    [attempt, setAttempt] = useState<{
      body: StaffAccountActionV1;
      etag: string;
      key: string;
      sent: boolean;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const pending = useRef(false),
    reviewHeading = useRef<HTMLHeadingElement>(null),
    actionHeading = useRef<HTMLHeadingElement>(null),
    attemptKey = attempt?.key,
    account = snapshot.value.account,
    grantBlocked =
      action === "grant-credits" &&
      (account.billingState !== "active" ||
        account.organizationState !== "active");
  useEffect(() => {
    if (attemptKey) reviewHeading.current?.focus();
    else if (message) actionHeading.current?.focus();
  }, [attemptKey, message]);
  if (
    !permissions.some((p) =>
      [
        "credits.grant",
        "credits.revoke",
        "operations.manage",
        "trials.grant",
        "trials.revoke",
      ].includes(p),
    )
  )
    return null;
  function review() {
    if (grantBlocked) return;
    const parsed = staffAccountActionV1Schema.safeParse({
      contractVersion: 1,
      confirmBillingAccountId: account.billingAccountId,
      action,
      reason,
      ...(action === "grant-credits" || action === "grant-trial"
        ? { creditUnits: Number(units), expiresInDays: Number(days) }
        : action === "revoke-credits"
          ? { creditUnits: Number(units), creditGrantId: grantId }
          : action === "revoke-trial"
            ? { trialId: snapshot.value.trial?.id }
            : { enabled }),
    });
    setMessage(null);
    if (!parsed.success) {
      setError(
        "Enter valid credits and expiration, select an existing trial for revocation, and provide a reason of 5–300 characters. Trials allow 1–1,000 credits for 1–30 days.",
      );
      return;
    }
    setError(null);
    setAttempt({
      body: parsed.data,
      etag: snapshot.etag,
      key: crypto.randomUUID(),
      sent: false,
    });
  }
  async function apply() {
    if (!attempt || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setAttempt({ ...attempt, sent: true });
    try {
      const receipt = staffActionReceiptV1Schema.parse(
        (
          await runtime.client.request("staff.accounts.act", {
            path: { organizationId: account.organizationId },
            headers: {
              "if-match": attempt.etag,
              "idempotency-key": attempt.key,
            },
            body: attempt.body,
          })
        ).data,
      );
      if (
        receipt.organizationId !== account.organizationId ||
        receipt.billingAccountId !== account.billingAccountId ||
        receipt.actorPrincipalId !== principalId ||
        receipt.action !== attempt.body.action ||
        (attempt.body.action === "grant-credits" &&
          (receipt.creditUnits !== String(attempt.body.creditUnits) ||
            receipt.creditGrantId === null))
      )
        throw Error("Staff receipt mismatch");
      setAttempt(null);
      setReason("");
      setMessage(
        (receipt.action === "grant-credits" && receipt.creditUnits !== null
          ? BigInt(receipt.creditUnits).toLocaleString() +
            " complimentary credits granted."
          : "Action recorded.") +
          " Receipt: " +
          receipt.actionId,
      );
      await refresh();
    } catch (cause) {
      const failure =
        cause instanceof ApiClientError ? cause.envelope.error : null;
      if (
        failure &&
        [
          "invalid_request",
          "precondition_failed",
          "conflict",
          "not_found",
          "idempotency_key_reused",
        ].includes(failure.code)
      ) {
        setAttempt(null);
        setError(failure.message + " Reload the account and review it again.");
        await refresh();
      } else {
        setError(
          failure?.code === "access_denied" ||
            failure?.code === "authentication_required"
            ? "Sign in again with your staff account before retrying this action. Recent authentication is required."
            : "The result could not be confirmed. Retry this same action to retrieve its receipt safely.",
        );
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="feature-card">
      <h2 ref={actionHeading} tabIndex={-1}>
        Account actions
      </h2>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {grantBlocked ? (
        <p role="status">
          Complimentary credits require an active account. Resolve the account
          suspension, then reload this account. A credit grant does not start a
          subscription or trial.
        </p>
      ) : null}
      {attempt ? (
        <div
          className="staff-review"
          role="region"
          aria-label="Review staff action"
        >
          <h3 ref={reviewHeading} tabIndex={-1}>
            Confirm{" "}
            {attempt.body.action === "grant-credits"
              ? "credit grant"
              : attempt.body.action === "revoke-credits"
                ? "credit revocation"
                : attempt.body.action === "grant-trial"
                  ? "trial grant"
                  : attempt.body.action === "revoke-trial"
                    ? "trial revocation"
                    : "operations change"}
          </h3>
          <p>
            <strong>{account.displayName}</strong>
          </p>
          <p className="staff-identifier">{account.billingAccountId}</p>
          <p>
            {attempt.body.action === "grant-credits" ||
            attempt.body.action === "grant-trial"
              ? attempt.body.creditUnits.toLocaleString() +
                " complimentary credits, expiring in " +
                String(attempt.body.expiresInDays) +
                " days."
              : attempt.body.action === "revoke-credits"
                ? attempt.body.creditUnits.toLocaleString() +
                  " unused credits removed from the selected grant."
                : attempt.body.action === "revoke-trial"
                  ? "End trial access and revoke unused trial credits. Paid access and credits are preserved."
                  : attempt.body.enabled
                    ? "Resume expensive operations, subject to the current plan and balance."
                    : "Pause new expensive operations for this account."}
          </p>
          {attempt.body.action === "grant-trial" ? (
            <p>
              One evaluation trial for this account with all Professional
              features. No subscription or automatic renewal. Access ends at
              expiry or revocation.
            </p>
          ) : null}
          <p>Reason: {attempt.body.reason}</p>
          <p className="staff-help">
            Your verified staff identity and this reason will be recorded in the
            account’s audit history.
          </p>
          <div className="form-actions">
            <button
              className="button button--primary"
              type="button"
              disabled={busy}
              onClick={() => {
                void apply();
              }}
            >
              {busy
                ? "Recording…"
                : attempt.sent
                  ? "Retry same action"
                  : "Confirm action"}
            </button>
            {!attempt.sent ? (
              <button
                className="button button--secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setAttempt(null);
                }}
              >
                Back to editing
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <form
          className="staff-action-form"
          onSubmit={(event) => {
            event.preventDefault();
            review();
          }}
        >
          <label>
            Action
            <select
              value={action}
              onChange={(event) => {
                setAction(
                  event.currentTarget.value as StaffAccountActionV1["action"],
                );
              }}
            >
              {permissions.includes("credits.grant") ? (
                <option value="grant-credits">
                  Grant complimentary credits
                </option>
              ) : null}
              {permissions.includes("credits.revoke") ? (
                <option value="revoke-credits">
                  Revoke unused complimentary credits
                </option>
              ) : null}
              {permissions.includes("trials.grant") ? (
                <option value="grant-trial" disabled={!!snapshot.value.trial}>
                  Grant time-limited trial
                </option>
              ) : null}
              {permissions.includes("trials.revoke") ? (
                <option
                  value="revoke-trial"
                  disabled={
                    !snapshot.value.trial ||
                    snapshot.value.trial.state === "revoked"
                  }
                >
                  Revoke trial access
                </option>
              ) : null}
              {permissions.includes("operations.manage") ? (
                <option value="set-operations">
                  Pause or resume expensive operations
                </option>
              ) : null}
            </select>
          </label>
          {action !== "set-operations" && action !== "revoke-trial" ? (
            <label>
              Credits
              <input
                type="number"
                min={1}
                max={action === "grant-trial" ? 1000 : 100000}
                step={1}
                required
                value={units}
                onChange={(event) => {
                  setUnits(event.currentTarget.value);
                }}
              />
            </label>
          ) : action === "set-operations" ? (
            <label>
              Expensive operations
              <select
                value={String(enabled)}
                onChange={(event) => {
                  setEnabled(event.currentTarget.value === "true");
                }}
              >
                <option value="false">Pause new operations</option>
                <option value="true">Resume operations</option>
              </select>
            </label>
          ) : null}
          {action === "grant-credits" || action === "grant-trial" ? (
            <label>
              Expire after (days)
              <input
                type="number"
                min={1}
                max={action === "grant-trial" ? 30 : 365}
                step={1}
                required
                value={days}
                onChange={(event) => {
                  setDays(event.currentTarget.value);
                }}
              />
            </label>
          ) : null}
          {action === "revoke-credits" ? (
            <label>
              Complimentary grant
              <select
                required
                value={grantId}
                onChange={(event) => {
                  setGrantId(event.currentTarget.value);
                }}
              >
                <option value="">Select a grant</option>
                {snapshot.value.grants
                  .filter((g) => Number(g.availableCreditUnits) > 0)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.availableCreditUnits} available ·{" "}
                      {new Date(g.createdAt).toLocaleString()} · {g.id}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <div className="staff-action-form__reason">
            <label htmlFor="staff-action-reason">Reason</label>
            <input
              id="staff-action-reason"
              aria-describedby="staff-reason-help"
              minLength={5}
              maxLength={300}
              required
              value={reason}
              onChange={(event) => {
                setReason(event.currentTarget.value);
              }}
              placeholder="Testing, support case, or correction"
            />
            <span className="staff-help" id="staff-reason-help">
              Use a brief explanation without passwords, payment details, or
              other sensitive information.
            </span>
          </div>
          <div className="form-actions">
            <button
              className="button button--primary"
              type="submit"
              disabled={grantBlocked}
            >
              Review action
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                void refresh();
              }}
            >
              Reload account
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
