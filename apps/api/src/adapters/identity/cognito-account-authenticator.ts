import { z } from "zod";
import {
  accountRecoveryContactV1Schema,
  startAccountAuthenticatorV1Schema,
  changeAccountAuthenticatorV1Schema,
  type AccountRecoveryContactV1,
  type AccountAuthenticatorStateV1,
  type AccountAuthenticatorProblemV1,
} from "@cloudmarkup/api-contract";
import type {
  AccountAuthenticatorApplication,
  AccountAuthenticatorJournal,
} from "../../application/account-authenticator.js";
import { ApplicationError } from "../../application/errors.js";
import type { PrincipalContext } from "../../application/ports.js";
import {
  CognitoSelfService,
  ProviderFailure,
  type CognitoSelfServiceConfiguration,
} from "./cognito-self-service.js";

export interface CognitoAccountAuthenticatorConfiguration extends CognitoSelfServiceConfiguration {
  readonly journal: AccountAuthenticatorJournal;
  readonly recoveryContact?: AccountRecoveryContactV1;
}
const secret = z
  .string()
  .regex(/^[A-Z2-7]{16,128}$/iu)
  .transform((value) => value.toUpperCase());
const verify = z.object({ Status: z.enum(["SUCCESS", "ERROR"]) });
/** Each change is explicit and token-authorized; setup secrets leave this adapter only once. */
export class CognitoAccountAuthenticator implements AccountAuthenticatorApplication {
  readonly #client: CognitoSelfService;
  readonly #journal: AccountAuthenticatorJournal;
  readonly #contact: AccountRecoveryContactV1 | null;
  constructor(config: CognitoAccountAuthenticatorConfiguration) {
    this.#client = new CognitoSelfService(config);
    this.#journal = config.journal;
    this.#contact =
      config.recoveryContact === undefined
        ? null
        : accountRecoveryContactV1Schema.parse(config.recoveryContact);
  }
  async #state(
    principal: PrincipalContext,
    token: string,
    signal: AbortSignal,
  ): Promise<AccountAuthenticatorStateV1> {
    const { state } = await this.#client.state(principal, token, signal);
    return {
      contractVersion: 1,
      principalId: principal.principalId,
      enabled: state.authenticatorEnabled,
      enrollmentAvailable:
        this.#contact !== null && !state.authenticatorEnabled,
      recoveryContact: this.#contact,
      enrollment: await this.#journal.read(principal),
    };
  }
  read: AccountAuthenticatorApplication["read"] = async (
    principal,
    authorization,
  ) => {
    principal = Object.freeze({ ...principal });
    const signal = AbortSignal.timeout(8000);
    const token = await this.#client.identify(principal, authorization);
    try {
      const state = await this.#state(principal, token, signal);
      await this.#client.identify(principal, authorization);
      return state;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "service_unavailable",
        "Authenticator settings could not be checked.",
      );
    }
  };
  start: AccountAuthenticatorApplication["start"] = async (
    principal,
    authorization,
    input,
  ) => {
    principal = Object.freeze({ ...principal });
    const command = startAccountAuthenticatorV1Schema.safeParse(input);
    if (!command.success)
      throw new ApplicationError(
        "invalid_request",
        "The authenticator setup request is invalid.",
      );
    const base = {
      contractVersion: 1 as const,
      principalId: principal.principalId,
      attemptId: command.data.attemptId,
      action: "start" as const,
    };
    const signal = AbortSignal.timeout(8000);
    const token = await this.#client.identify(principal, authorization, true);
    const before = await this.#state(principal, token, signal).catch(
      (error: unknown) => {
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError(
          "service_unavailable",
          "Authenticator settings could not be checked. No change was started.",
        );
      },
    );
    if (before.enabled || this.#contact === null)
      return {
        ...base,
        outcome: "rejected",
        problem: before.enabled ? "already-enabled" : "recovery-unavailable",
        state: null,
        secretCode: null,
      };
    await this.#journal.begin(principal, command.data.attemptId, "start");
    let dispatched = false;
    let changed = false;
    try {
      await this.#client.identify(principal, authorization, true);
      await this.#journal.assertCurrent(principal, command.data.attemptId);
      dispatched = true;
      const response = await this.#client.call(
        "AssociateSoftwareToken",
        token,
        {},
        signal,
      );
      changed = true;
      const parsed = z.object({ SecretCode: secret }).safeParse(response);
      if (!parsed.success) throw new ProviderFailure("uncertain", "unknown");
      const { state } = await this.#client.state(principal, token, signal);
      if (state.authenticatorEnabled)
        throw new ProviderFailure("uncertain", "unknown");
      await this.#client.identify(principal, authorization, true);
      await this.#journal.assertCurrent(principal, command.data.attemptId);
      await this.#journal.finish(
        principal,
        command.data.attemptId,
        "succeeded",
      );
      const enrollment = await this.#journal.read(principal);
      if (
        enrollment?.id !== command.data.attemptId ||
        enrollment.status !== "ready" ||
        !enrollment.currentSession
      )
        throw new ProviderFailure("uncertain", "unknown");
      return {
        ...base,
        outcome: "succeeded",
        problem: null,
        state: { ...before, enrollment },
        secretCode: parsed.data.SecretCode,
      };
    } catch (error) {
      const result = this.#failure(error, dispatched, changed);
      await this.#journal
        .finish(principal, command.data.attemptId, result.outcome)
        .catch(() => undefined);
      return { ...base, ...result, state: null, secretCode: null };
    }
  };
  change: AccountAuthenticatorApplication["change"] = async (
    principal,
    authorization,
    input,
  ) => {
    principal = Object.freeze({ ...principal });
    const parsed = changeAccountAuthenticatorV1Schema.safeParse(input);
    if (!parsed.success)
      throw new ApplicationError(
        "invalid_request",
        "The authenticator change is invalid.",
      );
    const command = parsed.data;
    const base = {
      contractVersion: 1 as const,
      principalId: principal.principalId,
      attemptId: command.attemptId,
      action: command.action,
    };
    const signal = AbortSignal.timeout(8000);
    const token = await this.#client.identify(principal, authorization, true);
    const before = await this.#state(principal, token, signal).catch(
      (error: unknown) => {
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError(
          "service_unavailable",
          "Authenticator settings could not be checked. No change was started.",
        );
      },
    );
    if (
      command.action === "verify-enable" &&
      (before.enabled || this.#contact === null)
    )
      return {
        ...base,
        outcome: "rejected",
        problem: before.enabled ? "already-enabled" : "recovery-unavailable",
        state: null,
      };
    if (command.action === "disable" && !before.enabled)
      return {
        ...base,
        outcome: "rejected",
        problem: "not-enabled",
        state: null,
      };
    await this.#journal.begin(
      principal,
      command.attemptId,
      command.action,
      command.action === "disable" ? undefined : command.enrollmentId,
    );
    let dispatched = false;
    let changed = false;
    try {
      await this.#client.identify(principal, authorization, true);
      await this.#journal.assertCurrent(principal, command.attemptId);
      if (command.action === "verify-enable") {
        dispatched = true;
        const response = await this.#client.call(
          "VerifySoftwareToken",
          token,
          { UserCode: command.code },
          signal,
        );
        changed = true;
        const verification = verify.safeParse(response);
        if (!verification.success)
          throw new ProviderFailure("uncertain", "unknown");
        if (verification.data.Status === "ERROR") {
          changed = false;
          throw new ProviderFailure("rejected", "incorrect-code");
        }
        await this.#client.identify(principal, authorization, true);
        await this.#journal.assertCurrent(principal, command.attemptId);
        await this.#client.call(
          "SetUserMFAPreference",
          token,
          { SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } },
          signal,
        );
      } else if (command.action === "disable") {
        dispatched = true;
        await this.#client.call(
          "SetUserMFAPreference",
          token,
          { SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false } },
          signal,
        );
        changed = true;
      }
      const { state: provider } = await this.#client.state(
        principal,
        token,
        signal,
      );
      if (
        command.action !== "cancel-setup" &&
        provider.authenticatorEnabled !== (command.action === "verify-enable")
      )
        throw new ProviderFailure("uncertain", "unknown");
      await this.#client.identify(principal, authorization, true);
      await this.#journal.assertCurrent(principal, command.attemptId);
      changed = true;
      await this.#journal.finish(principal, command.attemptId, "succeeded");
      const enrollment = await this.#journal.read(principal);
      if (enrollment !== null)
        throw new ProviderFailure("uncertain", "unknown");
      return {
        ...base,
        outcome: "succeeded",
        problem: null,
        state: {
          ...before,
          enabled: provider.authenticatorEnabled,
          enrollmentAvailable:
            this.#contact !== null && !provider.authenticatorEnabled,
          enrollment,
        },
      };
    } catch (error) {
      const result = this.#failure(error, dispatched, changed);
      await this.#journal
        .finish(principal, command.attemptId, result.outcome)
        .catch(() => undefined);
      return { ...base, ...result, state: null };
    }
  };
  #failure(
    error: unknown,
    dispatched: boolean,
    changed: boolean,
  ): {
    outcome: "rejected" | "uncertain";
    problem: AccountAuthenticatorProblemV1;
  } {
    const outcome = changed
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
    return { outcome, problem };
  }
}
