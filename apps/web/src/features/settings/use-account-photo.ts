import {
  accountPhotoV1Schema,
  entityTagSchema,
  type AccountPhotoV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
export interface AccountPhotoSnapshot {
  readonly value: AccountPhotoV1;
  readonly etag: string;
}
export function readAccountPhoto(
  principalId: string,
  value: unknown,
  tag: unknown,
): AccountPhotoSnapshot {
  const photo = accountPhotoV1Schema.parse(value);
  if (photo.principalId !== principalId)
    throw Error("Account photo response mismatch");
  return { value: photo, etag: entityTagSchema.parse(tag) };
}
export async function loadAccountPhoto(
  runtime: CloudMarkupQueryRuntime,
  principalId: string,
): Promise<AccountPhotoSnapshot> {
  const result = await runtime.client.requestWithMetadata(
    "account.photo.get",
    {},
  );
  return readAccountPhoto(principalId, result.data.data, result.metadata.etag);
}
export function useAccountPhoto(
  runtime: CloudMarkupQueryRuntime,
  principalId: string,
) {
  return useQuery({
    queryKey: cloudMarkupQueryKeys.accountPhoto(principalId),
    queryFn: () => loadAccountPhoto(runtime, principalId),
    enabled: !runtime.sessionExpired,
    retry: false,
  });
}
