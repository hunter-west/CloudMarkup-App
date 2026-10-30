import {
  accountWorkspaceV1Schema,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";

/** Names and kinds describe the verified tenant; they never grant billing authority. */
export function useBillingScope(
  runtime: CloudMarkupQueryRuntime,
  principal: CurrentPrincipalV1,
  organizationId: string,
) {
  const context = principal.organizationContexts.find(
    (entry) => entry.organizationId === organizationId,
  );
  return useQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.organization(principal.id, organizationId),
      "billing-scope",
      JSON.stringify(context ?? null),
    ],
    enabled: context !== undefined,
    queryFn: async () => {
      const value = accountWorkspaceV1Schema.parse(
        (
          await runtime.client.request("account.workspaces.get", {
            path: { organizationId },
          })
        ).data,
      );
      if (
        value.id !== organizationId ||
        value.principalId !== principal.id ||
        value.role !== context?.role
      )
        throw Error("Billing scope details could not be verified.");
      return value;
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: true,
  });
}
