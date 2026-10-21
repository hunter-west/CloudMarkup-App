import type { AccountProfileV1 } from "@cloudmarkup/api-contract";
import type { PrincipalContext, VersionedResult } from "./ports.js";
export interface AccountProfileApplication {
  get(principal: PrincipalContext): Promise<VersionedResult<AccountProfileV1>>;
  update(
    principal: PrincipalContext,
    input: unknown,
    expectedEtag: string,
  ): Promise<VersionedResult<AccountProfileV1>>;
}
