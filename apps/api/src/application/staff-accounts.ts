import type {
  StaffAccessV1,
  StaffAccountActionV1,
  StaffAccountDetail,
  StaffAccountList,
  StaffActionReceiptV1,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext, VersionedResult } from "./ports.js";
/** Platform staff authority is resolved from canonical storage for every call. */
export interface StaffAccountsApplication {
  access(principal: PrincipalContext): Promise<StaffAccessV1>;
  search(
    principal: PrincipalContext,
    input: {
      readonly q: string;
      readonly cursor?: string | undefined;
    },
    previewVersion?: "2",
  ): Promise<StaffAccountList>;
  get(
    principal: PrincipalContext,
    organizationId: string,
    previewVersion?: "2",
  ): Promise<VersionedResult<StaffAccountDetail>>;
  act(
    principal: PrincipalContext,
    organizationId: string,
    input: StaffAccountActionV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<StaffActionReceiptV1>;
}
