import { staffAccessV1Schema } from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import type { CloudMarkupQueryRuntime } from "../../api/index.js";
const accessKey = (id: string) => ["staff-access", id] as const;
export function useStaffAccess(runtime: CloudMarkupQueryRuntime, id: string) {
  return useQuery({
    queryKey: accessKey(id),
    queryFn: async () =>
      staffAccessV1Schema.parse(
        (await runtime.client.request("staff.access.get", {})).data,
      ),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}
