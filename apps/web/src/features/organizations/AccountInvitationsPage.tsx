import {
  acceptedOrganizationInvitationV1Schema,
  recipientOrganizationInvitationV1Schema,
  type AcceptedOrganizationInvitationV1,
  type CurrentPrincipalV1,
  type RecipientOrganizationInvitationV1,
} from "@cloudmarkup/api-contract";
import { useState } from "react";
import {
  cloudMarkupQueryKeys,
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { AppLink } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import "../settings/settings.css";
import { invitationErrorMessage } from "./organization-invitation-errors.js";
import {
  confirmInvitation,
  useInvitationAction,
  useInvitations,
} from "./recipient-invitation-state.js";
import "./organization-invitations.css";

export function AccountInvitationsPage({
  principal,
}: {
  readonly principal?: CurrentPrincipalV1;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  return (
    <RoutePage
      title="Invitations"
      eyebrow="Account"
      description="Choose which organizations you want to join. Your personal workspace stays separate."
      routeKey="account-invitations"
    >
      <div className="settings-content">
        {runtime === null || principal === undefined ? (
          <p role="alert">Sign in to view your invitations.</p>
        ) : (
          <InvitationInbox
            key={principal.id}
            runtime={runtime}
            principal={principal}
          />
        )}
      </div>
    </RoutePage>
  );
}
export function InvitationInbox({
  runtime,
  principal,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principal: CurrentPrincipalV1;
}) {
  const scope = { principalId: principal.id };
  const list = useInvitations(runtime, scope),
    action = useInvitationAction(runtime, principal.id);
  const [receipts, setReceipts] = useState<
    Readonly<Record<string, AcceptedOrganizationInvitationV1>>
  >({});
  const [access, setAccess] = useState<Readonly<Record<string, string>>>({});
  async function decide(
    item: RecipientOrganizationInvitationV1,
    decision: "accept" | "decline",
  ) {
    if (!action.begin()) return;
    try {
      if (decision === "accept") {
        let receipt = receipts[item.id];
        if (receipt === undefined && item.status !== "accepted") {
          receipt = acceptedOrganizationInvitationV1Schema.parse(
            (
              await runtime.client.request("account.invitations.accept", {
                path: { invitationId: item.id },
                body: { contractVersion: 1 },
              })
            ).data,
          );
          if (receipt.organizationId !== item.organizationId)
            throw Error("Invitation acceptance mismatch");
          if (!action.mounted()) return;
          const saved = receipt;
          setReceipts((previous) => ({ ...previous, [item.id]: saved }));
        }
        const confirmed = await confirmInvitation(runtime, scope, item.id);
        if (
          confirmed.status !== "accepted" ||
          confirmed.organizationId !== item.organizationId ||
          confirmed.role !== item.role
        )
          throw Error("Invitation acceptance readback mismatch");
        const actor = await action.verifyActor();
        const membership = actor.organizationContexts.find(
          (context) =>
            context.organizationId === item.organizationId &&
            context.capabilities.includes("projects.read") &&
            (receipt === undefined ||
              context.membershipId === receipt.membershipId),
        );
        if (membership === undefined)
          throw Error("Joined workspace access is not current");
        if (!action.mounted()) return;
        runtime.queryClient.setQueryData(
          cloudMarkupQueryKeys.currentPrincipal(),
          actor,
        );
        await runtime.queryClient.invalidateQueries({
          queryKey: cloudMarkupQueryKeys.organizations(principal.id),
        });
        if (!action.mounted()) return;
        setAccess((previous) => ({
          ...previous,
          [item.id]: `/organizations/${encodeURIComponent(item.organizationId)}/projects`,
        }));
        action.setMessage(
          `Access to ${item.organizationName} is current as ${membership.role}. Your personal workspace is unchanged.`,
        );
      } else {
        const value = recipientOrganizationInvitationV1Schema.parse(
          (
            await runtime.client.request("account.invitations.decline", {
              path: { invitationId: item.id },
              body: { contractVersion: 1 },
            })
          ).data,
        );
        if (
          value.id !== item.id ||
          value.recipient.principalId !== principal.id ||
          value.organizationId !== item.organizationId
        )
          throw Error("Invitation decline mismatch");
        const confirmed = await confirmInvitation(runtime, scope, item.id);
        if (confirmed.status !== "declined")
          throw Error("Invitation decline readback mismatch");
        await action.verifyActor();
        if (!action.mounted()) return;
        action.setMessage(`Invitation to ${item.organizationName} declined.`);
      }
      const refreshed = await list.refetch();
      if (refreshed.isError)
        throw Error("Invitation list could not be refreshed");
    } catch (cause) {
      if (action.mounted()) action.setError(invitationErrorMessage(cause));
    } finally {
      action.end();
    }
  }
  const disabled = action.busy || runtime.sessionExpired;
  return (
    <section
      className="organization-invitation"
      aria-labelledby="account-invitations-title"
    >
      <div className="organization-invitation__actions">
        <h2 id="account-invitations-title">Your invitations</h2>
        <button
          className="button button--quiet"
          type="button"
          disabled={disabled || list.isFetching}
          onClick={() => {
            setAccess({});
            void list.refetch();
          }}
        >
          Refresh invitations
        </button>
      </div>
      <p>
        Accept only invitations from organizations you recognize. Joining gives
        you the role shown below.
      </p>
      {action.message === null ? null : <p role="status">{action.message}</p>}
      {action.error === null ? null : <p role="alert">{action.error}</p>}
      {action.error === null && !runtime.sessionExpired ? null : (
        <button
          className="button button--secondary"
          type="button"
          disabled={action.busy}
          onClick={() => void action.signIn()}
        >
          Sign in again
        </button>
      )}
      {list.isPending ? (
        <p role="status">Loading invitations…</p>
      ) : list.isError ? (
        <p role="alert">
          Your invitations could not be loaded. Refresh to try again.
        </p>
      ) : (
        <>
          {list.data.pages.every((page) => page.items.length === 0) ? (
            <p>You have no organization invitations.</p>
          ) : (
            <ul className="recipient-invitation-list">
              {list.data.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <li key={item.id}>
                    <div>
                      <h3>{item.organizationName}</h3>
                      <p>
                        {item.role} · {item.status}
                      </p>
                      <small>
                        Expires {new Date(item.expiresAt).toLocaleString()}
                      </small>
                    </div>
                    <div className="organization-invitation__actions">
                      {access[item.id] !== undefined ? (
                        <AppLink
                          className="button button--primary"
                          to={access[item.id] ?? "/organizations"}
                        >
                          Open workspace
                        </AppLink>
                      ) : item.status === "accepted" ||
                        receipts[item.id] !== undefined ? (
                        <button
                          className="button button--secondary"
                          type="button"
                          disabled={disabled}
                          onClick={() => void decide(item, "accept")}
                        >
                          Refresh workspace access
                        </button>
                      ) : item.status === "pending" ? (
                        <>
                          <button
                            className="button button--primary"
                            type="button"
                            disabled={disabled}
                            aria-label={`Accept invitation to ${item.organizationName}`}
                            onClick={() => void decide(item, "accept")}
                          >
                            Accept
                          </button>
                          <button
                            className="button button--secondary"
                            type="button"
                            disabled={disabled}
                            aria-label={`Decline invitation to ${item.organizationName}`}
                            onClick={() => void decide(item, "decline")}
                          >
                            Decline
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
            </ul>
          )}
          {list.hasNextPage ? (
            <button
              className="button button--secondary"
              type="button"
              disabled={disabled || list.isFetching}
              onClick={() => void list.fetchNextPage()}
            >
              Load more invitations
            </button>
          ) : null}
        </>
      )}
      <AppLink to="/settings/profile">
        Find your username and user ID in your profile
      </AppLink>
    </section>
  );
}
