import type {
  StaffAccessV1,
  StaffAccountActionV1,
  StaffAccountDetailV1,
  StaffAccountListV1,
  StaffActionReceiptV1,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext, VersionedResult } from "./ports.js";
/** Platform staff authority is resolved from canonical storage for every call. */
export interface StaffAccountsApplication {
  access(principal: PrincipalContext): Promise<StaffAccessV1>;
  search(
    principal: PrincipalContext,
    input: { readonly q: string; readonly cursor?: string | undefined },
  ): Promise<StaffAccountListV1>;
  get(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<VersionedResult<StaffAccountDetailV1>>;
  act(
    principal: PrincipalContext,
    organizationId: string,
    input: StaffAccountActionV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<StaffActionReceiptV1>;
}
