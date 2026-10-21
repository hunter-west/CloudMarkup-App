import type {
  OrganizationMemberV1,
  OrganizationMembershipReceiptV1,
} from "@cloudmarkup/api-contract";
import type {
  PageOptions,
  PageResult,
  PrincipalContext,
  VersionedResult,
} from "./ports.js";
export interface OrganizationMembersApplication {
  list(
    principal: PrincipalContext,
    organizationId: string,
    options: Pick<PageOptions, "limit" | "cursor">,
  ): Promise<PageResult<OrganizationMemberV1>>;
  own(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<VersionedResult<OrganizationMemberV1>>;
  change(
    principal: PrincipalContext,
    organizationId: string,
    input: unknown,
    etag: string,
    key: string,
  ): Promise<OrganizationMembershipReceiptV1>;
}
