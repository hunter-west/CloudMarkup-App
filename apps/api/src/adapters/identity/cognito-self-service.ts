import { z } from "zod";
import {
  accountCredentialStateV1Schema,
  type AccountCredentialStateV1,
  type AccountCredentialProblemV1,
} from "@cloudmarkup/api-contract";
import { ApplicationError } from "../../application/errors.js";
import {
  parseBearerToken,
  requireRecentAuthentication,
  type PrincipalResolver,
  type PrincipalDirectory,
} from "../../application/identity.js";
import type { PrincipalContext } from "../../application/ports.js";
import { cognitoSubjectSchema } from "./cognito-subject.js";

const endpoint = "https://cognito-idp.us-east-1.amazonaws.com/";
const getUserSchema = z.object({
  Username: z.string().min(1).max(128),
  UserAttributes: z
    .array(
      z.object({
        Name: z.string().min(1).max(64),
        Value: z.string().max(2048),
      }),
    )
    .max(64),
  UserMFASettingList: z.array(z.string().min(1).max(64)).max(8).optional(),
});
type Operation =
  | "GetUser"
  | "ChangePassword"
  | "UpdateUserAttributes"
  | "VerifyUserAttribute"
  | "GetUserAttributeVerificationCode"
  | "AssociateSoftwareToken"
  | "VerifySoftwareToken"
  | "SetUserMFAPreference";
const operations: readonly Operation[] = [
  "GetUser",
  "ChangePassword",
  "UpdateUserAttributes",
  "VerifyUserAttribute",
  "GetUserAttributeVerificationCode",
  "AssociateSoftwareToken",
  "VerifySoftwareToken",
  "SetUserMFAPreference",
];
const problems: Readonly<Record<string, AccountCredentialProblemV1>> = {
  NotAuthorizedException: "reauthenticate",
  PasswordResetRequiredException: "reauthenticate",
  InvalidPasswordException: "password-policy",
  PasswordHistoryPolicyViolationException: "password-policy",
  CodeMismatchException: "incorrect-code",
  ExpiredCodeException: "expired-code",
  AliasExistsException: "email-unavailable",
  TooManyRequestsException: "rate-limited",
  LimitExceededException: "rate-limited",
  InvalidParameterException: "unavailable",
  ConcurrentModificationException: "unavailable",
  SoftwareTokenMFANotFoundException: "unavailable",
  EnableSoftwareTokenMFAException: "incorrect-code",
};
export class ProviderFailure extends Error {
  readonly outcome: "rejected" | "uncertain";
  readonly problem: AccountCredentialProblemV1;
  constructor(
    outcome: "rejected" | "uncertain",
    problem: AccountCredentialProblemV1,
  ) {
    super("The account provider request was not confirmed.");
    this.outcome = outcome;
    this.problem = problem;
  }
}
async function boundedJson(
  response: Response,
  allowEmpty: boolean,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    if (allowEmpty) return {};
    throw new ProviderFailure("uncertain", "unknown");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk: unknown = next.value;
      if (
        !(chunk instanceof Uint8Array) ||
        (length += chunk.byteLength) > 32768
      )
        throw new ProviderFailure("uncertain", "unknown");
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (length === 0 && allowEmpty) return {};
  if (
    !/^application\/(?:json|x-amz-json-1\.[01])(?:\s*;|$)/iu.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw new ProviderFailure("uncertain", "unknown");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new ProviderFailure("uncertain", "unknown");
  }
}

export interface CognitoSelfServiceConfiguration {
  readonly issuer: string;
  /** Requires both application and self-service scopes, with session admission. */
  readonly principalResolver: PrincipalResolver;
  readonly directory: PrincipalDirectory;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}
/** Token authority and fixed-host transport shared by account-security adapters. */
export class CognitoSelfService {
  readonly #config: CognitoSelfServiceConfiguration;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date;
  constructor(config: CognitoSelfServiceConfiguration) {
    if (
      !/^https:\/\/cognito-idp\.us-east-1\.amazonaws\.com\/us-east-1_[A-Za-z0-9]+$/u.test(
        config.issuer,
      )
    )
      throw new TypeError("Invalid account provider configuration.");
    this.#config = Object.freeze({ ...config });
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#now = config.now ?? (() => new Date());
  }
  async identify(
    principal: PrincipalContext,
    authorization: string | undefined,
    recent = false,
  ): Promise<string> {
    const current = await this.#config.principalResolver.resolve(authorization);
    const token = parseBearerToken(authorization);
    if (
      !current ||
      !token ||
      current.authenticationSource !== "cognito" ||
      current.principalId !== principal.principalId ||
      current.sessionId !== principal.sessionId ||
      current.authenticatedAt !== principal.authenticatedAt ||
      current.expiresAt !== principal.expiresAt ||
      !Number.isFinite(Date.parse(current.expiresAt)) ||
      Date.parse(current.expiresAt) <= this.#now().getTime()
    )
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to manage your password and email.",
      );
    if (recent) requireRecentAuthentication(current, this.#now());
    return token;
  }
  async call(
    operation: Operation,
    token: string,
    fields: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) throw new ProviderFailure("rejected", "unavailable");
    if (!operations.includes(operation) || "AccessToken" in fields)
      throw new ProviderFailure("rejected", "unavailable");
    try {
      const response = await this.#fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-amz-json-1.1",
          "x-amz-target": "AWSCognitoIdentityProviderService." + operation,
        },
        body: JSON.stringify({ ...fields, AccessToken: token }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal,
      });
      const value = await boundedJson(
        response,
        response.status === 200 &&
          (operation === "ChangePassword" ||
            operation === "VerifyUserAttribute" ||
            operation === "SetUserMFAPreference"),
      );
      if (response.status !== 200) {
        const parsed = z
          .object({ __type: z.string().max(256) })
          .safeParse(value);
        const name = parsed.success
          ? parsed.data.__type.split("#").at(-1)
          : undefined;
        const problem = name ? problems[name] : undefined;
        if (response.status === 400 && problem)
          throw new ProviderFailure("rejected", problem);
        throw new ProviderFailure("uncertain", "unknown");
      }
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new ProviderFailure("uncertain", "unknown");
      return value;
    } catch (error) {
      if (error instanceof ProviderFailure) throw error;
      throw new ProviderFailure("uncertain", "unknown");
    }
  }
  async state(
    principal: PrincipalContext,
    token: string,
    signal: AbortSignal,
  ): Promise<{ state: AccountCredentialStateV1; subject: string }> {
    const user = getUserSchema.safeParse(
      await this.call("GetUser", token, {}, signal),
    );
    if (!user.success) throw new ProviderFailure("uncertain", "unknown");
    const attributes = new Map<string, string>();
    for (const { Name, Value } of user.data.UserAttributes) {
      if (attributes.has(Name))
        throw new ProviderFailure("uncertain", "unknown");
      attributes.set(Name, Value);
    }
    const subject = attributes.get("sub");
    if (!subject || !cognitoSubjectSchema.safeParse(subject).success)
      throw new ProviderFailure("uncertain", "unknown");
    const mapped = await this.#config.directory.resolveActivePrincipal({
      provider: "cognito",
      issuer: this.#config.issuer,
      subject,
    });
    if (mapped?.principalId !== principal.principalId)
      throw new ProviderFailure("uncertain", "unknown");
    const verified = attributes.get("email_verified");
    if (verified !== undefined && verified !== "true" && verified !== "false")
      throw new ProviderFailure("uncertain", "unknown");
    const parsed = accountCredentialStateV1Schema.safeParse({
      contractVersion: 1,
      principalId: principal.principalId,
      email: attributes.get("email") ?? null,
      emailVerified: verified === "true",
      authenticatorEnabled:
        user.data.UserMFASettingList?.includes("SOFTWARE_TOKEN_MFA") ?? false,
    });
    if (!parsed.success) throw new ProviderFailure("uncertain", "unknown");
    return { state: parsed.data, subject };
  }
}
