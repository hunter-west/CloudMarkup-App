import {
  currentPrincipalV1Schema,
  pageMetadataSchema,
  recipientOrganizationInvitationV1Schema,
  type RecipientOrganizationInvitationV1,
} from "@cloudmarkup/api-contract";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import {
  browserCognitoAuthSession,
  startCognitoSignInWithPopup,
} from "../auth/cognito-browser-auth.js";
import { useOptionalLocalOwnerSession } from "../auth/local-owner-session.js";

export interface InvitationScope {
  readonly principalId: string;
  readonly organizationId?: string;
}
export async function invitationPage(
  runtime: CloudMarkupQueryRuntime,
  scope: InvitationScope,
  cursor?: string,
) {
  const query = {
    "page[limit]": "100",
    ...(cursor === undefined ? {} : { "page[cursor]": cursor }),
  };
  const result =
    scope.organizationId === undefined
      ? await runtime.client.request("account.invitations.list", { query })
      : await runtime.client.request("organization-member-invitations.list", {
          path: { organizationId: scope.organizationId },
          query,
        });
  const items = result.data.map((item) =>
    recipientOrganizationInvitationV1Schema.parse(item),
  );
  const page = pageMetadataSchema.parse(result.page);
  if (
    items.some(
      (item, index) =>
        (scope.organizationId === undefined
          ? item.recipient.principalId !== scope.principalId
          : item.organizationId !== scope.organizationId) ||
        (index === 0
          ? cursor !== undefined && item.id <= cursor
          : item.id <= (items[index - 1]?.id ?? "")),
    ) ||
    (page.hasMore &&
      (items.length === 0 || page.nextCursor !== items.at(-1)?.id))
  )
    throw Error("Invitation response mismatch");
  return { items, page };
}
export function useInvitations(
  runtime: CloudMarkupQueryRuntime,
  scope: InvitationScope,
) {
  return useInfiniteQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.principal(scope.principalId),
      "recipient-invitations",
      scope.organizationId ?? "inbox",
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => invitationPage(runtime, scope, pageParam),
    getNextPageParam: (last) =>
      last.page.hasMore ? last.page.nextCursor : undefined,
    enabled: !runtime.sessionExpired,
    staleTime: 0,
    retry: false,
  });
}
/** Bounded readback; an unusually large history fails closed and retains the attempt. */
export async function confirmInvitation(
  runtime: CloudMarkupQueryRuntime,
  scope: InvitationScope,
  id: string,
): Promise<RecipientOrganizationInvitationV1> {
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    const page = await invitationPage(runtime, scope, cursor);
    const found = page.items.find((item) => item.id === id);
    if (found !== undefined) return found;
    if (!page.page.hasMore) break;
    cursor = page.page.nextCursor;
  }
  throw Error("Invitation readback unavailable");
}
/** The containing component is keyed by verified actor and organization authority. */
export function useInvitationAction(
  runtime: CloudMarkupQueryRuntime,
  principalId: string,
  subject: "invitation" | "membership" | "session" = "invitation",
) {
  const localOwner = useOptionalLocalOwnerSession();
  const alive = useRef(false),
    pending = useRef(false),
    controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  function mounted() {
    return alive.current;
  }
  function begin() {
    if (pending.current || runtime.sessionExpired || !mounted()) return false;
    pending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    return true;
  }
  function end() {
    pending.current = false;
    if (mounted()) setBusy(false);
  }
  async function verifyActor() {
    const actor = currentPrincipalV1Schema.parse(
      (await runtime.client.request("principal.get", {})).data,
    );
    if (actor.id !== principalId) throw Error("Invitation account changed");
    return actor;
  }
  function currentSignIn(next: AbortController) {
    return mounted() && !next.signal.aborted;
  }
  async function signIn() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const next = new AbortController();
    controller.current = next;
    try {
      if (localOwner === null) {
        await startCognitoSignInWithPopup(browserCognitoAuthSession, {
          signal: next.signal,
        });
      } else {
        // Keep the current route mounted while the local proof page overlays it.
        // The pending idempotency key/body survives a successful reauthentication.
        await localOwner.reauthenticate(next.signal);
      }
      if (!currentSignIn(next)) return;
      const actor = currentPrincipalV1Schema.parse(
        (await runtime.client.request("principal.get", {})).data,
      );
      if (!currentSignIn(next)) return;
      runtime.resumeSession();
      runtime.queryClient.setQueryData(
        cloudMarkupQueryKeys.currentPrincipal(),
        actor,
      );
      setMessage(
        actor.id === principalId
          ? `Sign-in refreshed. Retry the same ${subject} attempt to continue.`
          : subject === "invitation"
            ? "The signed-in account changed. Open Invitations for that account."
            : subject === "membership"
              ? "The signed-in account changed. Reopen membership settings for that account."
              : "The signed-in account changed. Reopen security settings for that account.",
      );
    } catch {
      if (mounted())
        setError(
          `Sign-in was not completed. Your ${subject} attempt remains in this tab.`,
        );
    } finally {
      end();
    }
  }
  return {
    busy,
    error,
    message,
    mounted,
    begin,
    end,
    verifyActor,
    signIn,
    setError,
    setMessage,
  };
}
