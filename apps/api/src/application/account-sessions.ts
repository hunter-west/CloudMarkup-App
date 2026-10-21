import type {
  AccountSessionV1,
  ChangeAccountSessionsV1,
  AccountSessionChangeReceiptV1,
} from "@cloudmarkup/api-contract";
import type { Principal } from "./identity.js";
import type { PrincipalContext, PageOptions } from "./ports.js";
export interface AccountSessionAdmission {
  isActive(principal: Principal): Promise<boolean>;
}
export interface AccountSessionsApplication {
  list(
    principal: PrincipalContext,
    options: Pick<PageOptions, "limit" | "cursor">,
  ): Promise<{
    readonly items: readonly AccountSessionV1[];
    readonly nextCursor?: string;
  }>;
  change(
    principal: PrincipalContext,
    input: ChangeAccountSessionsV1,
    key: string,
  ): Promise<AccountSessionChangeReceiptV1>;
}
