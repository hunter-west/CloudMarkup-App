import { PostgresAccountSessions } from "../adapters/persistence/account-sessions.js";
import type { SqlDatabase } from "../adapters/persistence/sql.js";
import { LocalOwnerIdentity } from "./local-owner-identity.js";
import { PostgresLocalOwnerSessionStore } from "./local-owner-session-store.js";

export interface LocalOwnerCompositionOptions {
  readonly bindHost: string;
  readonly publicOrigin: string;
  readonly ownerPrincipalId: string;
  readonly operatorSecret: Uint8Array;
  readonly database: SqlDatabase;
  readonly now?: () => number;
}

/** A standalone runtime opts in explicitly. Hosted compositions never call
 * this helper and retain their Cognito-only account-session defaults. */
export function createLocalOwnerComposition(
  options: LocalOwnerCompositionOptions,
) {
  const service = new LocalOwnerIdentity({
    enabled: true,
    bindHost: options.bindHost,
    publicOrigin: options.publicOrigin,
    ownerPrincipalId: options.ownerPrincipalId,
    operatorSecret: options.operatorSecret,
    sessions: new PostgresLocalOwnerSessionStore(options.database),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return {
    principalResolver: service,
    localOwnerSessions: { publicOrigin: options.publicOrigin, service },
    accountSessions: {
      application: new PostgresAccountSessions(options.database, {
        authenticationSource: "local-owner",
      }),
      publicOrigin: options.publicOrigin,
      mode: "local-owner" as const,
    },
  };
}
