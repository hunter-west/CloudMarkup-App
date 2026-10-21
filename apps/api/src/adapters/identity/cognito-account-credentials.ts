import {
  changeAccountCredentialsV1Schema,
  type AccountCredentialResultV1,
} from "@cloudmarkup/api-contract";
import type {
  AccountCredentialAudit,
  AccountCredentialsApplication,
  AccountVerifiedContactProjection,
} from "../../application/account-credentials.js";
import { ApplicationError } from "../../application/errors.js";
import {
  CognitoSelfService,
  ProviderFailure,
  type CognitoSelfServiceConfiguration,
} from "./cognito-self-service.js";

export interface CognitoAccountCredentialsConfiguration extends CognitoSelfServiceConfiguration {
  readonly audit: AccountCredentialAudit;
  readonly contactProjection: AccountVerifiedContactProjection;
}
/** One durable attempt with a shared eight-second provider budget; no credential persistence or retries. */
export class CognitoAccountCredentials implements AccountCredentialsApplication {
  readonly #client: CognitoSelfService;
  readonly #audit: AccountCredentialAudit;
  readonly #contactProjection: AccountVerifiedContactProjection;
  constructor(config: CognitoAccountCredentialsConfiguration) {
    this.#client = new CognitoSelfService(config);
    this.#audit = config.audit;
    this.#contactProjection = config.contactProjection;
  }
  read: AccountCredentialsApplication["read"] = async (
    principal,
    authorization,
  ) => {
    principal = Object.freeze({ ...principal });
    const signal = AbortSignal.timeout(8000);
    const token = await this.#client.identify(principal, authorization);
    try {
      const expectedContact =
        await this.#contactProjection.readContact(principal);
      const { state, subject } = await this.#client.state(
        principal,
        token,
        signal,
      );
      await this.#client.identify(principal, authorization);
      await this.#contactProjection.synchronizeVerifiedContact(
        principal,
        expectedContact,
        {
          subject,
          email: state.emailVerified ? state.email : null,
        },
      );
      return state;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "service_unavailable",
        "Account security information could not be checked.",
      );
    }
  };
  change: AccountCredentialsApplication["change"] = async (
    principal,
    authorization,
    input,
  ) => {
    principal = Object.freeze({ ...principal });
    const signal = AbortSignal.timeout(8000);
    const parsed = changeAccountCredentialsV1Schema.safeParse(input);
    if (!parsed.success)
      throw new ApplicationError(
        "invalid_request",
        "The account change is invalid.",
      );
    const command = parsed.data;
    const token = await this.#client.identify(principal, authorization, true);
    try {
      await this.#client.state(principal, token, signal);
    } catch {
      throw new ApplicationError(
        "service_unavailable",
        "Account security could not be checked. No change was started.",
      );
    }
    await this.#audit.begin(principal, command.attemptId, command.action);
    const base = {
      contractVersion: 1 as const,
      principalId: principal.principalId,
      attemptId: command.attemptId,
      action: command.action,
    };
    let dispatched = false;
    let mutationConfirmed = false;
    try {
      await this.#client.identify(principal, authorization, true);
      await this.#audit.assertCurrent(principal, command.attemptId);
      dispatched = true;
      switch (command.action) {
        case "password-change":
          await this.#client.call(
            "ChangePassword",
            token,
            {
              PreviousPassword: command.currentPassword,
              ProposedPassword: command.newPassword,
            },
            signal,
          );
          break;
        case "email-start":
          await this.#client.call(
            "UpdateUserAttributes",
            token,
            {
              UserAttributes: [{ Name: "email", Value: command.email }],
            },
            signal,
          );
          break;
        case "email-confirm":
          await this.#client.call(
            "VerifyUserAttribute",
            token,
            {
              AttributeName: "email",
              Code: command.code,
            },
            signal,
          );
          break;
        case "email-resend":
          await this.#client.call(
            "GetUserAttributeVerificationCode",
            token,
            {
              AttributeName: "email",
            },
            signal,
          );
          break;
      }
      mutationConfirmed = true;
      const result = await this.#client.state(principal, token, signal);
      if (command.action === "email-confirm" && !result.state.emailVerified)
        throw new ProviderFailure("uncertain", "unknown");
      await this.#client.identify(principal, authorization);
      await this.#audit.assertCurrent(principal, command.attemptId);
      await this.#audit.finish(
        principal,
        command.attemptId,
        "succeeded",
        result.state.emailVerified && result.state.email !== null
          ? { subject: result.subject, email: result.state.email }
          : undefined,
      );
      return {
        ...base,
        outcome: "succeeded",
        problem: null,
        state: result.state,
      };
    } catch (error) {
      const outcome = mutationConfirmed
        ? "uncertain"
        : error instanceof ProviderFailure
          ? error.outcome
          : dispatched
            ? "uncertain"
            : "rejected";
      const problem =
        error instanceof ProviderFailure
          ? error.problem
          : dispatched
            ? "unknown"
            : "reauthenticate";
      await this.#audit
        .finish(principal, command.attemptId, outcome)
        .catch(() => undefined);
      return {
        ...base,
        outcome,
        problem,
        state: null,
      } satisfies AccountCredentialResultV1;
    }
  };
}
