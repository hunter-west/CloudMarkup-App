import type {
  AccountAuthenticatorEnrollmentV1,
  AccountAuthenticatorStateV1,
  AccountAuthenticatorStartResultV1,
  AccountAuthenticatorChangeResultV1,
  StartAccountAuthenticatorV1,
  ChangeAccountAuthenticatorV1,
  AccountCredentialOutcomeV1,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext } from "./ports.js";
export interface AccountAuthenticatorApplication {
  read(
    principal: PrincipalContext,
    authorization: string | undefined,
  ): Promise<AccountAuthenticatorStateV1>;
  start(
    principal: PrincipalContext,
    authorization: string | undefined,
    input: StartAccountAuthenticatorV1,
  ): Promise<AccountAuthenticatorStartResultV1>;
  change(
    principal: PrincipalContext,
    authorization: string | undefined,
    input: ChangeAccountAuthenticatorV1,
  ): Promise<AccountAuthenticatorChangeResultV1>;
}
export type AccountAuthenticatorAction =
  "start" | ChangeAccountAuthenticatorV1["action"];
/** Metadata only. No setup key, provider token, password, or verification code is admitted. */
export interface AccountAuthenticatorJournal {
  read(
    principal: PrincipalContext,
  ): Promise<AccountAuthenticatorEnrollmentV1 | null>;
  begin(
    principal: PrincipalContext,
    attemptId: string,
    action: AccountAuthenticatorAction,
    enrollmentId?: string,
  ): Promise<AccountAuthenticatorEnrollmentV1 | null>;
  assertCurrent(principal: PrincipalContext, attemptId: string): Promise<void>;
  finish(
    principal: PrincipalContext,
    attemptId: string,
    outcome: AccountCredentialOutcomeV1,
  ): Promise<void>;
}
