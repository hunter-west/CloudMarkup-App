import type { AccountPhotoV1 } from "@cloudmarkup/api-contract";
import type { PrincipalContext, VersionedResult } from "./ports.js";
export interface AccountPhotoApplication {
  get(principal: PrincipalContext): Promise<VersionedResult<AccountPhotoV1>>;
  update(
    principal: PrincipalContext,
    input: unknown,
    expectedEtag: string,
  ): Promise<VersionedResult<AccountPhotoV1>>;
}
