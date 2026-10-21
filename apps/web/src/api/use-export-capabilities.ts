import { runtimeExportCapabilitiesV1Schema } from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useOptionalCloudMarkupQueryRuntime } from "./cloudmarkup-query-context.js";
import { cloudMarkupQueryKeys } from "./query-keys.js";

export function useExportCapabilities() {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const loader = runtime?.loadExportCapabilities;
  const query = useQuery({
    queryKey: [...cloudMarkupQueryKeys.root, "runtime", "exports"],
    enabled: loader !== undefined,
    retry: false,
    queryFn: async ({ signal }) => {
      if (loader === undefined)
        throw new Error("Export availability is unavailable.");
      return runtimeExportCapabilitiesV1Schema.parse(await loader(signal));
    },
  });
  if (loader === undefined)
    return {
      state: "fixture" as const,
      message:
        "Save a Solution Revision to choose an export format and review its files.",
    };
  if (query.isError)
    return {
      state: "error" as const,
      message: "We couldn't check export availability. Please try again.",
      retry: () => {
        void query.refetch();
      },
    };
  if (query.isPending)
    return {
      state: "loading" as const,
      message: "Checking available export formats…",
    };
  if (query.data.exports.targets.length === 0)
    return {
      state: "unavailable" as const,
      message:
        "Hosted exports are not available in this beta yet. You can keep designing and save a revision for later.",
    };
  return {
    state: "available" as const,
    message:
      "Export CloudFormation from infrastructure-only revisions with an eligible active Professional plan. Packages can be up to 4 MiB. We'll check your plan and project when you generate.",
  };
}
