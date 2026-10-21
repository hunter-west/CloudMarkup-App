import {
  ApiClientError,
  accountWorkspaceV1Schema,
  organizationMemberV1Schema,
  organizationMembershipReceiptV1Schema,
  pageMetadataSchema,
  type OrganizationMemberV1,
  type OrganizationMembershipReceiptV1,
  type ChangeOrganizationMembershipV1,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { Dialog } from "@cloudmarkup/ui";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { useInvitationAction } from "./recipient-invitation-state.js";
interface Props {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principal: CurrentPrincipalV1;
  readonly organizationId: string;
  readonly mode: "manage" | "leave";
}
interface Attempt {
  readonly input: ChangeOrganizationMembershipV1;
  readonly etag: string;
  readonly key: string;
  readonly description: string;
  readonly receipt?: OrganizationMembershipReceiptV1;
  readonly dispatched?: boolean;
}
export function OrganizationRolePermissions() {
  return (
    <dl
      className="member-access-permissions"
      aria-label="Organization role permissions"
    >
      <div>
        <dt>Viewer</dt>
        <dd>Read projects and credit summaries.</dd>
      </div>
      <div>
        <dt>Editor</dt>
        <dd>
          Create and edit projects, use shared GitHub repositories, and run paid
          workflows within the organization’s plan and credits.
        </dd>
      </div>
      <div>
        <dt>Administrator</dt>
        <dd>
          Editor permissions plus integration and billing management. Invite,
          change or remove editors and viewers.
        </dd>
      </div>
      <div>
        <dt>Owner</dt>
        <dd>
          Administrator permissions plus appointing administrators, transferring
          ownership and organization deletion.
        </dd>
      </div>
    </dl>
  );
}
async function ownMember(
  runtime: CloudMarkupQueryRuntime,
  principalId: string,
  organizationId: string,
) {
  const response = await runtime.client.requestWithMetadata(
    "account.membership.get",
    { path: { organizationId } },
  );
  const value = organizationMemberV1Schema.parse(response.data.data);
  if (
    value.principalId !== principalId ||
    value.organizationId !== organizationId ||
    response.metadata.etag !== value.etag
  )
    throw Error("Membership response mismatch");
  return value;
}
async function roster(
  runtime: CloudMarkupQueryRuntime,
  organizationId: string,
) {
  const items: OrganizationMemberV1[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const response = await runtime.client.request("organization-members.list", {
      path: { organizationId },
      query: {
        "page[limit]": "100",
        ...(cursor ? { "page[cursor]": cursor } : {}),
      },
    });
    const page = pageMetadataSchema.parse(response.page),
      batch = response.data.map((item) =>
        organizationMemberV1Schema.parse(item),
      );
    for (const item of batch) {
      if (
        item.organizationId !== organizationId ||
        item.membershipId <= (items.at(-1)?.membershipId ?? "")
      )
        throw Error("Membership roster mismatch");
      items.push(item);
    }
    if (!page.hasMore) return items;
    if (batch.length === 0 || page.nextCursor !== items.at(-1)?.membershipId)
      throw Error("Membership cursor mismatch");
    cursor = page.nextCursor;
  }
  throw Error("Membership roster is too large to confirm");
}
function message(error: unknown) {
  if (error instanceof ApiClientError) {
    switch (error.envelope.error.code) {
      case "precondition_failed":
        return "Membership details changed. Reload them before reviewing a new change.";
      case "authentication_required":
        return "Sign in again, then retry this attempt.";
      case "access_denied":
        return "Recent sign-in and permission for this action are required. Sign in again to retry.";
      case "not_found":
        return "This membership is no longer available to your account.";
      case "conflict":
        return error.envelope.error.message;
    }
  }
  return "The result could not be confirmed. Retry this same attempt to check its outcome.";
}
export function OrganizationMemberControls({
  runtime,
  principal,
  organizationId,
  mode,
}: Props) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(""),
    [role, setRole] = useState<"administrator" | "editor" | "viewer">("viewer"),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [reloadRequired, setReloadRequired] = useState(false);
  const saved = useRef<Attempt | null>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const action = useInvitationAction(runtime, principal.id, "membership");
  const details = useQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.memberships(principal.id, organizationId),
      "controls",
      mode,
    ],
    enabled: open && !runtime.sessionExpired,
    retry: false,
    queryFn: async () => {
      const workspace = accountWorkspaceV1Schema.parse(
        (
          await runtime.client.request("account.workspaces.get", {
            path: { organizationId },
          })
        ).data,
      );
      if (
        workspace.id !== organizationId ||
        workspace.principalId !== principal.id
      )
        throw Error("Workspace response mismatch");
      const own = await ownMember(runtime, principal.id, organizationId);
      if (workspace.role !== own.role)
        throw Error("Workspace membership response mismatch");
      return {
        own,
        kind: workspace.kind,
        members:
          mode === "manage" &&
          workspace.kind === "organization" &&
          own.status === "active" &&
          (own.role === "owner" || own.role === "administrator")
            ? await roster(runtime, organizationId)
            : [],
      };
    },
  });
  const snapshot = details.data,
    own = snapshot?.own;
  const eligible =
    snapshot?.members.filter(
      (item) =>
        item.principalId !== principal.id &&
        item.role !== "owner" &&
        item.status !== "removed" &&
        (own?.role === "owner" || item.role !== "administrator"),
    ) ?? [];
  const target =
    eligible.find((item) => item.membershipId === selected) ?? eligible[0];
  function review(
    input: ChangeOrganizationMembershipV1,
    member: OrganizationMemberV1,
    description: string,
  ) {
    const next = {
      input,
      etag: member.etag,
      key: "membership_" + crypto.randomUUID(),
      description,
    };
    saved.current = next;
    setAttempt(next);
    setReloadRequired(false);
    action.setError(null);
  }
  async function confirm() {
    const current = saved.current;
    if (current === null || !action.begin()) return;
    try {
      let receipt = current.receipt;
      if (!receipt) {
        await action.verifyActor();
        if (!action.mounted()) return;
        saved.current = { ...current, dispatched: true };
        setAttempt(saved.current);
        receipt = organizationMembershipReceiptV1Schema.parse(
          (
            await runtime.client.request("organization-members.change", {
              path: { organizationId },
              headers: {
                "if-match": current.etag,
                "idempotency-key": current.key,
              },
              body: current.input,
            })
          ).data,
        );
        const expectedIds =
          current.input.action === "transfer-ownership"
            ? [current.input.membershipId, current.input.targetMembershipId]
            : [current.input.membershipId];
        if (
          receipt.organizationId !== organizationId ||
          receipt.actorPrincipalId !== principal.id ||
          receipt.action !== current.input.action ||
          receipt.members.some(
            (member, index) => member.membershipId !== expectedIds[index],
          )
        )
          throw Error("Membership receipt mismatch");
        const outcomes = receipt.members;
        const first = outcomes[0];
        if (!first) throw Error("Membership receipt is empty");
        if (
          (current.input.action === "set-role" &&
            (first.role !== current.input.role || first.status !== "active")) ||
          ((current.input.action === "remove" ||
            current.input.action === "leave") &&
            first.status !== "removed") ||
          (current.input.action === "transfer-ownership" &&
            (first.role !== "administrator" ||
              outcomes[1]?.role !== "owner" ||
              outcomes.some((item) => item.status !== "active")))
        )
          throw Error("Membership outcome mismatch");
        if (!action.mounted()) return;
        saved.current = { ...current, dispatched: true, receipt };
        setAttempt(saved.current);
      }
      const currentOwn = await ownMember(runtime, principal.id, organizationId);
      const currentMembers =
        current.input.action === "leave"
          ? [currentOwn]
          : await roster(runtime, organizationId);
      for (const applied of receipt.members) {
        const latest = currentMembers.find(
          (item) => item.membershipId === applied.membershipId,
        );
        if (
          latest?.principalId !== applied.principalId ||
          latest.version < applied.version ||
          (latest.version === applied.version &&
            (latest.role !== applied.role || latest.status !== applied.status))
        )
          throw Error("Membership change readback mismatch");
      }
      const actor = await action.verifyActor(),
        context = actor.organizationContexts.find(
          (item) => item.organizationId === organizationId,
        );
      if (
        currentOwn.status === "active"
          ? context?.membershipId !== currentOwn.membershipId ||
            context.role !== currentOwn.role
          : context !== undefined
      )
        throw Error("Current membership authority mismatch");
      if (!action.mounted()) return;
      await runtime.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.memberships(
          principal.id,
          organizationId,
        ),
        refetchType: "none",
      });
      await runtime.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.organizations(principal.id),
        refetchType: "none",
      });
      if (!action.mounted()) return;
      runtime.queryClient.setQueryData(
        cloudMarkupQueryKeys.currentPrincipal(),
        actor,
      );
      saved.current = null;
      setAttempt(null);
      setOpen(false);
      action.setMessage(
        "Membership change recorded. Current access has been refreshed.",
      );
      await runtime.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.memberships(
          principal.id,
          organizationId,
        ),
      });
    } catch (error) {
      if (action.mounted()) {
        action.setError(message(error));
        if (
          !saved.current?.receipt &&
          error instanceof ApiClientError &&
          [
            "precondition_failed",
            "conflict",
            "invalid_request",
            "idempotency_key_reused",
          ].includes(error.envelope.error.code)
        )
          setReloadRequired(true);
      }
    } finally {
      action.end();
    }
  }
  async function reload() {
    if (!action.begin()) return;
    try {
      const result = await details.refetch();
      if (result.isError) throw result.error;
      if (!action.mounted()) return;
      saved.current = null;
      setAttempt(null);
      setReloadRequired(false);
    } catch (error) {
      if (action.mounted()) action.setError(message(error));
    } finally {
      action.end();
    }
  }
  const disabled = action.busy || runtime.sessionExpired;
  return (
    <section
      className="member-access-controls"
      aria-label={
        mode === "manage"
          ? "Manage member access"
          : "Your organization membership"
      }
    >
      <button
        ref={trigger}
        className="button button--secondary"
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        {mode === "manage" ? "Manage member access" : "Leave organization"}
      </button>
      {action.message ? <p role="status">{action.message}</p> : null}
      <Dialog
        open={open}
        returnFocusRef={trigger}
        onClose={() => {
          if (!action.busy) setOpen(false);
        }}
        title={
          mode === "manage" ? "Manage member access" : "Leave organization"
        }
      >
        {action.error ? <p role="alert">{action.error}</p> : null}
        {action.error || runtime.sessionExpired ? (
          <button
            className="button button--secondary"
            disabled={action.busy}
            type="button"
            onClick={() => void action.signIn()}
          >
            Sign in again
          </button>
        ) : null}
        {attempt ? (
          <div className="section-stack">
            <p>{attempt.description}</p>
            <p>
              Changes take effect for shared project access. Billing history and
              personal workspaces are retained.
            </p>
            {reloadRequired ? (
              <button
                className="button button--secondary"
                type="button"
                disabled={disabled}
                onClick={() => void reload()}
              >
                Reload membership details
              </button>
            ) : (
              <button
                className="button button--primary"
                type="button"
                disabled={disabled}
                onClick={() => void confirm()}
              >
                {action.busy
                  ? "Confirming…"
                  : attempt.receipt
                    ? "Refresh changed access"
                    : "Confirm membership change"}
              </button>
            )}
            {!attempt.dispatched ? (
              <button
                className="button button--quiet"
                type="button"
                disabled={disabled}
                onClick={() => {
                  saved.current = null;
                  setAttempt(null);
                }}
              >
                Back to member details
              </button>
            ) : null}
            <p>
              Close this window to pause. Your attempt stays available in this
              tab.
            </p>
          </div>
        ) : details.isPending ? (
          <p role="status">Loading current membership…</p>
        ) : details.isError ? (
          <div>
            <p role="alert">Current membership details could not be loaded.</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void details.refetch()}
            >
              Retry member details
            </button>
          </div>
        ) : snapshot?.kind === "personal" ? (
          <p>
            Your personal workspace belongs only to you and cannot be left or
            transferred.
          </p>
        ) : own?.status !== "active" ? (
          <p>You no longer have active membership in this organization.</p>
        ) : mode === "manage" &&
          own.role !== "owner" &&
          own.role !== "administrator" ? (
          <p role="alert">
            Only an owner or administrator can manage member access. Your
            current role is {own.role}.
          </p>
        ) : mode === "leave" ? (
          <div className="section-stack">
            <p>
              Leaving removes your access to this organization’s shared
              projects. An owner must transfer ownership or leave another active
              owner in place first.
            </p>
            <button
              className="button button--secondary"
              type="button"
              disabled={disabled}
              onClick={() => {
                review(
                  {
                    contractVersion: 1,
                    action: "leave",
                    membershipId: own.membershipId,
                  },
                  own,
                  "Leave this organization? Rejoining will require a new invitation.",
                );
              }}
            >
              Review leaving organization
            </button>
          </div>
        ) : (
          <div className="member-access-form">
            <OrganizationRolePermissions />
            <p>
              Your current role:{" "}
              <strong>
                {own.role === "owner" ? "Owner" : "Administrator"}
              </strong>
              .
              {own.role === "administrator"
                ? " You cannot change owners, administrators or your own role."
                : " Use ownership transfer to appoint a new owner; you then become an administrator."}
            </p>
            {target ? (
              <>
                <label>
                  Member
                  <select
                    value={target.membershipId}
                    disabled={disabled}
                    onChange={(event) => {
                      setSelected(event.currentTarget.value);
                    }}
                  >
                    {eligible.map((member) => (
                      <option
                        key={member.membershipId}
                        value={member.membershipId}
                      >
                        {member.displayName} — {member.role} ({member.status})
                      </option>
                    ))}
                  </select>
                </label>
                <p className="member-access-id">
                  {target.username ? "@" + target.username + " · " : ""}
                  {target.principalId}
                </p>
                {target.status === "active" ? (
                  <>
                    <label>
                      New role
                      <select
                        value={role}
                        disabled={disabled}
                        onChange={(event) => {
                          setRole(event.currentTarget.value as typeof role);
                        }}
                      >
                        {own.role === "owner" ? (
                          <option value="administrator">Administrator</option>
                        ) : null}
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </label>
                    <p>
                      {role === "viewer"
                        ? "Viewer access permits reading projects and credit summaries."
                        : role === "editor"
                          ? "Editor access includes workflows that can spend this organization’s credits."
                          : "Administrator access includes member, integration and billing management."}
                    </p>
                    <button
                      className="button button--secondary"
                      type="button"
                      disabled={disabled || role === target.role}
                      onClick={() => {
                        review(
                          {
                            contractVersion: 1,
                            action: "set-role",
                            membershipId: target.membershipId,
                            role,
                          },
                          target,
                          "Change " +
                            target.displayName +
                            " to " +
                            role +
                            "? Pending invitations they issued will be closed.",
                        );
                      }}
                    >
                      Review role change
                    </button>
                  </>
                ) : null}
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    review(
                      {
                        contractVersion: 1,
                        action: "remove",
                        membershipId: target.membershipId,
                      },
                      target,
                      "Remove " +
                        target.displayName +
                        " from this organization? Rejoining will require a new invitation.",
                    );
                  }}
                >
                  Review member removal
                </button>
                {own.role === "owner" && target.status === "active" ? (
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      review(
                        {
                          contractVersion: 1,
                          action: "transfer-ownership",
                          membershipId: own.membershipId,
                          targetMembershipId: target.membershipId,
                          targetVersion: target.version,
                        },
                        own,
                        "Transfer ownership to " +
                          target.displayName +
                          "? You will become an administrator. The new owner can manage billing and organization access.",
                      );
                    }}
                  >
                    Review ownership transfer
                  </button>
                ) : null}
              </>
            ) : (
              <p>
                No other members are eligible for these actions. Invite a member
                before transferring ownership.
              </p>
            )}
          </div>
        )}
      </Dialog>
    </section>
  );
}
