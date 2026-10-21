import type {
  AccountWorkspaceV1,
  CreateAccountOrganizationV1,
} from "@cloudmarkup/api-contract";
import type { PageOptions, PageResult, PrincipalContext } from "./ports.js";
export interface AccountWorkspacesApplication {
  get(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<AccountWorkspaceV1>;
  list(
    principal: PrincipalContext,
    options: PageOptions,
  ): Promise<PageResult<AccountWorkspaceV1>>;
  createOrganization(
    principal: PrincipalContext,
    input: CreateAccountOrganizationV1,
    idempotencyKey: string,
  ): Promise<AccountWorkspaceV1>;
  createPersonal(principal: PrincipalContext): Promise<AccountWorkspaceV1>;
}
