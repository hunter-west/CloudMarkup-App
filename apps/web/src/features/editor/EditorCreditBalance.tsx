import {
  creditBalanceV1Schema,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  cloudMarkupQueryKeys,
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { AppLink } from "../../routing/index.js";
import { useOptionalLocalOwnerSession } from "../auth/local-owner-session.js";

export function EditorCreditBalance({
  principal,
  organizationId,
}: {
  readonly principal: CurrentPrincipalV1;
  readonly organizationId: string;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const localOwner = useOptionalLocalOwnerSession();
  const organization = principal.organizationContexts.find(
    (value) => value.organizationId === organizationId,
  );
  if (
    runtime === null ||
    localOwner !== null ||
    !organization?.capabilities.includes("commercial.summary.read")
  )
    return null;
  return (
    <VerifiedCreditBalance
      key={
        principal.id + ":" + organizationId + ":" + JSON.stringify(organization)
      }
      runtime={runtime}
      principalId={principal.id}
      organizationId={organizationId}
      authorizationScope={JSON.stringify(organization)}
    />
  );
}

function VerifiedCreditBalance({
  runtime,
  principalId,
  organizationId,
  authorizationScope,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principalId: string;
  readonly organizationId: string;
  readonly authorizationScope: string;
}) {
  const queryKey = useMemo(
    () =>
      [
        ...cloudMarkupQueryKeys.commercialSummary(principalId, organizationId),
        "editor-credit-balance",
        authorizationScope,
      ] as const,
    [principalId, organizationId, authorizationScope],
  );
  const balance = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await runtime.client.request(
        "commercial.credit-balance.get",
        { path: { organizationId } },
      );
      const value = creditBalanceV1Schema.parse(response.data);
      if (signal.aborted || value.organizationId !== organizationId)
        throw new Error("Credit balance scope changed.");
      return value;
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });
  useEffect(
    () => () => {
      void runtime.queryClient.cancelQueries({ queryKey, exact: true });
      runtime.queryClient.removeQueries({ queryKey, exact: true });
    },
    [runtime.queryClient, queryKey],
  );
  const value = balance.isError ? undefined : balance.data;
  const label = balance.isError
    ? "Credits unavailable"
    : value === undefined
      ? "Loading credits…"
      : value.availableCreditUnits.toLocaleString() + " credits";
  return (
    <AppLink
      className="editor-credit-balance"
      to={"/organizations/" + encodeURIComponent(organizationId) + "/usage"}
      title="Available credits exclude reservations. View credit usage and accounting."
    >
      <span>{label}</span>
      {value && value.reservedCreditUnits > 0 ? (
        <small>{value.reservedCreditUnits.toLocaleString()} reserved</small>
      ) : null}
    </AppLink>
  );
}
