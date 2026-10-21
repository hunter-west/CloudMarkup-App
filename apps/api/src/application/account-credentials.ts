import type {
  AccountCredentialStateV1,
  AccountCredentialResultV1,
  AccountCredentialOutcomeV1,
  ChangeAccountCredentialsV1,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext } from "./ports.js";

/** Authorization is the exact header verified by middleware; never caller-selected body data.
 * Tokens and credential inputs remain in memory and must not enter audit records. */
export interface AccountCredentialsApplication {
  read(
    principal: PrincipalContext,
    authorization: string | undefined,
  ): Promise<AccountCredentialStateV1>;
  change(
    principal: PrincipalContext,
    authorization: string | undefined,
    input: ChangeAccountCredentialsV1,
  ): Promise<AccountCredentialResultV1>;
}
export type AccountCredentialAuditAction =
  | ChangeAccountCredentialsV1["action"]
  | "authenticator-start"
  | "authenticator-verify-enable"
  | "authenticator-cancel-setup"
  | "authenticator-disable";
export interface AccountCredentialAudit {
  begin(
    principal: PrincipalContext,
    attemptId: string,
    action: AccountCredentialAuditAction,
  ): Promise<void>;
  assertCurrent(principal: PrincipalContext, attemptId: string): Promise<void>;
  finish(
    principal: PrincipalContext,
    attemptId: string,
    outcome: AccountCredentialOutcomeV1,
    verifiedContact?: { readonly subject: string; readonly email: string },
  ): Promise<void>;
}

/** Search metadata from a verified provider read; never identity or role authority. */
export interface AccountContactSnapshot {
  readonly email: string | null;
  readonly observedAt: string;
}
export interface AccountVerifiedContactProjection {
  readContact(principal: PrincipalContext): Promise<AccountContactSnapshot>;
  synchronizeVerifiedContact(
    principal: PrincipalContext,
    expectedContact: AccountContactSnapshot,
    contact: { readonly subject: string; readonly email: string | null },
  ): Promise<void>;
}
