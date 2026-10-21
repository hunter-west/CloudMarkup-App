import {
  ApiClientError,
  createRecipientOrganizationInvitationV1Schema,
  currentPlanEntitlementsV1Schema,
  organizationInvitationRoleV1Schema,
  organizationInvitationV1Schema,
  recipientOrganizationInvitationV1Schema,
  type CreateRecipientOrganizationInvitationV1,
  type RecipientOrganizationInvitationV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { invitationErrorMessage } from "./organization-invitation-errors.js";
import {
  confirmInvitation,
  useInvitationAction,
  useInvitations,
} from "./recipient-invitation-state.js";
import "./organization-invitations.css";

interface Attempt {
  readonly key: string;
  readonly body: CreateRecipientOrganizationInvitationV1;
}
export function OrganizationInvitationComposer({
  runtime,
  principalId,
  organizationId,
  isOwner,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principalId: string;
  readonly organizationId: string;
  readonly isOwner: boolean;
}) {
  const scope = { principalId, organizationId };
  const list = useInvitations(runtime, scope),
    action = useInvitationAction(runtime, principalId);
  const [kind, setKind] = useState<"username" | "user-id">("username"),
    [recipient, setRecipient] = useState(""),
    [role, setRole] =
      useState<CreateRecipientOrganizationInvitationV1["role"]>("editor"),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [editable, setEditable] = useState(false);
  const plan = useQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.commercialSummary(principalId, organizationId),
      "invitation-plan",
    ],
    queryFn: async () => {
      const value = currentPlanEntitlementsV1Schema.parse(
        (
          await runtime.client.request("commercial.current-plan.get", {
            path: { organizationId },
          })
        ).data,
      );
      if (value.organizationId !== organizationId)
        throw Error("Sharing plan scope mismatch");
      return value;
    },
    enabled: !runtime.sessionExpired,
    retry: false,
    staleTime: 0,
  });
  const capacity = plan.data?.limits.find(
    (item) => item.key === "active-members" && item.scope === "organization",
  );
  async function refresh() {
    const result = await list.refetch();
    if (result.isError) throw Error("Invitation list unavailable");
  }
  async function create(replacement?: RecipientOrganizationInvitationV1) {
    const body =
      replacement === undefined
        ? {
            contractVersion: 1,
            role,
            recipient:
              kind === "username"
                ? { kind, username: recipient }
                : { kind, userId: recipient.trim() },
          }
        : {
            contractVersion: 1,
            role: replacement.role,
            recipient: {
              kind: "user-id",
              userId: replacement.recipient.principalId,
            },
          };
    const parsed =
      createRecipientOrganizationInvitationV1Schema.safeParse(body);
    if (attempt === null && !parsed.success) {
      action.setError(
        "Enter an exact user ID or a username of 3–32 letters, numbers or underscores, beginning with a letter.",
      );
      return;
    }
    if (!action.begin()) return;
    const selected =
      attempt ??
      (parsed.success
        ? { key: `member-invitation-${crypto.randomUUID()}`, body: parsed.data }
        : null);
    if (selected === null) {
      action.end();
      return;
    }
    setAttempt(selected);
    setEditable(false);
    let written = false;
    try {
      const value = recipientOrganizationInvitationV1Schema.parse(
        (
          await runtime.client.request(
            "organization-member-invitations.create",
            {
              path: { organizationId },
              headers: { "idempotency-key": selected.key },
              body: selected.body,
            },
          )
        ).data,
      );
      written = true;
      if (
        value.organizationId !== organizationId ||
        value.role !== selected.body.role ||
        (selected.body.recipient.kind === "user-id" &&
          value.recipient.principalId !== selected.body.recipient.userId)
      )
        throw Error("Invitation write mismatch");
      const confirmed = await confirmInvitation(runtime, scope, value.id);
      if (
        confirmed.recipient.principalId !== value.recipient.principalId ||
        confirmed.role !== value.role
      )
        throw Error("Invitation recipient mismatch");
      const actor = await action.verifyActor();
      if (
        !actor.organizationContexts.some(
          (item) =>
            item.organizationId === organizationId &&
            item.capabilities.includes("memberships.manage"),
        )
      )
        throw Error("Invitation authority changed");
      if (!action.mounted()) return;
      await refresh();
      if (!action.mounted()) return;
      setAttempt(null);
      setRecipient("");
      action.setMessage(
        confirmed.status === "pending"
          ? `Invitation sent to ${confirmed.recipient.displayName}. They can accept it under Account → Invitations.`
          : `Invitation ${confirmed.status}.`,
      );
    } catch (cause) {
      if (action.mounted()) {
        setEditable(
          !written &&
            cause instanceof ApiClientError &&
            [400, 403, 404, 409, 422].includes(cause.status),
        );
        action.setError(
          cause instanceof ApiClientError &&
            cause.envelope.error.code === "not_found"
            ? "This recipient or workspace is unavailable. Check the exact user ID or username."
            : invitationErrorMessage(cause),
        );
      }
    } finally {
      action.end();
    }
  }
  async function revoke(item: RecipientOrganizationInvitationV1) {
    if (!action.begin()) return;
    try {
      const value = organizationInvitationV1Schema.parse(
        (
          await runtime.client.request("organization-invitations.revoke", {
            path: { organizationId, invitationId: item.id },
          })
        ).data,
      );
      if (
        value.id !== item.id ||
        value.organizationId !== organizationId ||
        value.status !== "revoked"
      )
        throw Error("Revocation mismatch");
      const confirmed = await confirmInvitation(runtime, scope, item.id);
      if (!["revoked", "declined"].includes(confirmed.status))
        throw Error("Revocation readback mismatch");
      await action.verifyActor();
      if (!action.mounted()) return;
      await refresh();
      if (action.mounted()) action.setMessage("Invitation revoked.");
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
      aria-labelledby="invite-member-title"
    >
      <h2 id="invite-member-title">Invite a member</h2>
      <p>
        Invite an existing CloudMarkup user by their exact username or user ID.
        They choose whether to join.
      </p>
      {plan.data === undefined ? (
        <p role="status">
          {plan.isError
            ? "Sharing plan unavailable. Eligibility is checked when you invite and when the recipient joins."
            : "Checking the current sharing plan…"}
        </p>
      ) : (
        <p>
          {plan.data.plan.displayName}
          {capacity === undefined
            ? ""
            : ` · ${String(capacity.maximum)} total members, including the owner.`}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
        className="organization-invitation__form"
      >
        <label>
          Find member by
          <select
            value={kind}
            disabled={disabled || attempt !== null}
            onChange={(event) => {
              setKind(
                event.target.value === "user-id" ? "user-id" : "username",
              );
              setRecipient("");
            }}
          >
            <option value="username">Username</option>
            <option value="user-id">User ID</option>
          </select>
        </label>
        <label>
          {kind === "username" ? "Member username" : "Member user ID"}
          <input
            autoComplete="off"
            spellCheck={false}
            value={recipient}
            maxLength={128}
            disabled={disabled || attempt !== null}
            onChange={(event) => {
              setRecipient(event.target.value);
            }}
          />
        </label>
        <label>
          New member role
          <select
            value={role}
            disabled={disabled || attempt !== null}
            onChange={(event) => {
              setRole(
                organizationInvitationRoleV1Schema.parse(event.target.value),
              );
            }}
          >
            <option value="editor">Editor — create and edit projects</option>
            <option value="viewer">Viewer — review projects</option>
            {isOwner ? (
              <option value="administrator">
                Administrator — manage workspace access
              </option>
            ) : null}
          </select>
        </label>
        <div className="organization-invitation__actions">
          <button
            className="button button--primary"
            disabled={disabled}
            type="submit"
          >
            {action.busy
              ? "Updating invitation…"
              : attempt === null
                ? "Send invitation"
                : "Retry same invitation"}
          </button>
          {editable && attempt !== null ? (
            <button
              className="button button--secondary"
              disabled={disabled}
              type="button"
              onClick={() => {
                setAttempt(null);
                setEditable(false);
                action.setError(null);
              }}
            >
              Edit recipient
            </button>
          ) : null}
        </div>
      </form>
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
      <div className="organization-invitation__actions">
        <h3>Invitations</h3>
        <button
          className="button button--quiet"
          type="button"
          disabled={disabled || list.isFetching}
          onClick={() => void list.refetch()}
        >
          Refresh invitations
        </button>
      </div>
      {list.isPending ? (
        <p role="status">Loading invitations…</p>
      ) : list.isError ? (
        <p role="alert">
          Invitations could not be loaded. Refresh to try again.
        </p>
      ) : (
        <>
          {list.data.pages.every((page) => page.items.length === 0) ? (
            <p>No invitations yet.</p>
          ) : (
            <ul className="recipient-invitation-list">
              {list.data.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.recipient.displayName}</strong>
                      <p>
                        {item.recipient.username === null
                          ? item.recipient.principalId
                          : `@${item.recipient.username}`}{" "}
                        · {item.role} · {item.status}
                      </p>
                      <small>
                        Expires {new Date(item.expiresAt).toLocaleString()}
                      </small>
                    </div>
                    {item.status === "pending" ? (
                      <button
                        className="button button--secondary"
                        type="button"
                        disabled={disabled || attempt !== null}
                        aria-label={`Revoke invitation for ${item.recipient.displayName}`}
                        onClick={() => void revoke(item)}
                      >
                        Revoke
                      </button>
                    ) : item.status === "expired" ||
                      item.status === "revoked" ? (
                      <button
                        className="button button--secondary"
                        type="button"
                        disabled={
                          disabled ||
                          attempt !== null ||
                          (!isOwner && item.role === "administrator")
                        }
                        aria-label={`Invite ${item.recipient.displayName} again`}
                        onClick={() => void create(item)}
                      >
                        Invite again
                      </button>
                    ) : null}
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
      <details>
        <summary>How invitations work</summary>
        <p>
          Invitations expire after 24 hours and do not reserve a member slot.
          The recipient finds them under Account → Invitations. Their personal
          projects and credits remain separate.
        </p>
        <p>
          To renew a pending invitation, revoke it first, then invite that same
          user again. Declined invitations are kept as history.
        </p>
      </details>
    </section>
  );
}
