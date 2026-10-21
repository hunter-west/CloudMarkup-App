import { CLOSED_ACCOUNT_ACCESS_V1 } from "@cloudmarkup/api-contract";
import type { SelfHostCredentialResolver } from "./configuration.js";
import type { ApiDependencies } from "../app.js";
import { ApplicationError } from "../application/errors.js";
import {
  CognitoJwtPrincipalResolver,
  type CognitoTokenVerifier,
} from "../adapters/identity/cognito-jwt-principal-resolver.js";
import { PostgresPrincipalDirectory } from "../adapters/identity/postgres-principal-directory.js";
import { BetaCognitoPrincipalDirectory } from "../adapters/identity/beta-cognito-principal-directory.js";
import { BrowserRefreshSessionService } from "../adapters/identity/browser-refresh-session-service.js";
import { CognitoAccountCredentials } from "../adapters/identity/cognito-account-credentials.js";
import { CognitoAccountAuthenticator } from "../adapters/identity/cognito-account-authenticator.js";
import { PostgresAccountSessions } from "../adapters/persistence/account-sessions.js";
import { PostgresBrowserRefreshSessions } from "../adapters/persistence/browser-refresh-sessions.js";
import { PostgresAccountCredentialAudit } from "../adapters/persistence/account-credential-audit.js";
import { PostgresAccountAuthenticatorJournal } from "../adapters/persistence/account-authenticator-journal.js";
import { sql, type SqlDatabase } from "../adapters/persistence/sql.js";
import type { SelfHostConfiguration } from "./configuration.js";
import { createLocalOwnerComposition } from "./local-owner-composition.js";
import { PostgresLocalOwnerSessionStore } from "./local-owner-session-store.js";

type IdentityApi = Pick<
  ApiDependencies,
  | "principalResolver"
  | "accountAccess"
  | "accountSessions"
  | "browserSessions"
  | "localOwnerSessions"
  | "runtimeConfig"
  | "accountCredentials"
  | "accountAuthenticator"
>;

function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "The configured core service is unavailable.",
  );
}

/** Production identity composition only. Local proof is resolved on the server,
 * decoded canonically, copied by the existing identity primitive and cleared.
 * No principal, password, token, tenant or membership is synthesized here. */
export async function createSelfHostCoreAdapters(options: {
  readonly configuration: SelfHostConfiguration;
  readonly database: SqlDatabase;
  readonly resolveCredential: SelfHostCredentialResolver;
  readonly signal: AbortSignal;
  readonly tokenVerifier?: CognitoTokenVerifier;
}): Promise<{ readonly api: IdentityApi; assertReady(): Promise<void> }> {
  const { configuration, database } = options;
  const identity = configuration.identity;
  const publicOrigin = configuration.server.publicOrigin;
  if (identity.mode === "local-owner") {
    const encoded = await options.resolveCredential(
      identity.operatorSecretReference,
      options.signal,
    );
    options.signal.throwIfAborted();
    if (!/^[A-Za-z0-9_-]{43}$/u.test(encoded)) unavailable();
    const secret = Buffer.from(encoded, "base64url");
    if (secret.length !== 32 || secret.toString("base64url") !== encoded) {
      secret.fill(0);
      unavailable();
    }
    let local: ReturnType<typeof createLocalOwnerComposition>;
    try {
      local = createLocalOwnerComposition({
        bindHost: configuration.server.host,
        publicOrigin,
        ownerPrincipalId: identity.ownerPrincipalId,
        operatorSecret: secret,
        database,
      });
    } finally {
      secret.fill(0);
    }
    const sessions = new PostgresLocalOwnerSessionStore(database);
    const assertReady = async () => {
      if (!(await sessions.isActiveOwner(identity.ownerPrincipalId)))
        unavailable();
    };
    await assertReady();
    return {
      api: { ...local, accountAccess: CLOSED_ACCOUNT_ACCESS_V1 },
      assertReady,
    };
  }
  if (configuration.issuer === null) unavailable();
  const issuer = configuration.issuer;
  const sessions = new PostgresAccountSessions(database);
  const directory =
    identity.directory === "verified-cognito-bootstrap"
      ? new BetaCognitoPrincipalDirectory({ database, issuer })
      : new PostgresPrincipalDirectory(database);
  const verifier =
    options.tokenVerifier === undefined
      ? {}
      : { verifier: options.tokenVerifier };
  const principalResolver = new CognitoJwtPrincipalResolver({
    userPoolId: identity.userPoolId,
    clientId: identity.clientId,
    requiredScope: "cloudmarkup-api/access",
    principalDirectory: directory,
    sessionAdmission: sessions,
    ...verifier,
  });
  const elevatedResolver = new CognitoJwtPrincipalResolver({
    userPoolId: identity.userPoolId,
    clientId: identity.clientId,
    requiredScope: ["cloudmarkup-api/access", "aws.cognito.signin.user.admin"],
    principalDirectory: new PostgresPrincipalDirectory(database),
    sessionAdmission: sessions,
    ...verifier,
  });
  return {
    api: {
      principalResolver,
      accountAccess: identity.accountAccess,
      runtimeConfig: identity.publicRuntime,
      accountSessions: { publicOrigin, application: sessions },
      browserSessions: {
        publicOrigin,
        service: new BrowserRefreshSessionService({
          clientId: identity.clientId,
          domain: identity.publicRuntime.authentication.domain,
          callbackUrl: identity.publicRuntime.authentication.callbackUrl,
          principalResolver,
          sessions: new PostgresBrowserRefreshSessions(database),
        }),
      },
      ...(identity.accountAccess.managedLogin
        ? {
            accountCredentials: {
              publicOrigin,
              application: new CognitoAccountCredentials({
                issuer,
                principalResolver: elevatedResolver,
                directory: new PostgresPrincipalDirectory(database),
                audit: new PostgresAccountCredentialAudit(database, issuer),
                contactProjection: new PostgresAccountCredentialAudit(
                  database,
                  issuer,
                ),
              }),
            },
            accountAuthenticator: {
              publicOrigin,
              application: new CognitoAccountAuthenticator({
                issuer,
                principalResolver: elevatedResolver,
                directory: new PostgresPrincipalDirectory(database),
                journal: new PostgresAccountAuthenticatorJournal(
                  database,
                  issuer,
                ),
                ...(identity.accountSecurity.recoveryContact === null
                  ? {}
                  : {
                      recoveryContact: identity.accountSecurity.recoveryContact,
                    }),
              }),
            },
          }
        : {}),
    },
    // Verify actual local directory/session grants without contacting Cognito or
    // accepting a token. Signature/issuer/audience checks remain request-owned.
    assertReady: async () => {
      const result = await database.query(
        sql(`SELECT COALESCE(bool_and(
          pg_catalog.has_column_privilege(current_user,required.table_name,required.column_name,'SELECT')
        ),false) AS self_host_identity_ready
        FROM (VALUES
          ('public.principals','principal_id'),
          ('public.principals','lifecycle_status'),
          ('public.principal_identity_references','principal_id'),
          ('public.principal_identity_references','identity_provider'),
          ('public.principal_identity_references','issuer'),
          ('public.principal_identity_references','subject_reference'),
          ('public.browser_refresh_sessions','principal_id'),
          ('public.browser_refresh_sessions','session_sha256'),
          ('public.browser_refresh_sessions','provider_session_sha256'),
          ('public.browser_refresh_sessions','authenticated_at'),
          ('public.browser_refresh_sessions','expires_at'),
          ('public.browser_refresh_sessions','lifecycle_status')
        ) AS required(table_name,column_name)`),
      );
      if (
        result.rowCount !== 1 ||
        result.rows[0]?.["self_host_identity_ready"] !== true
      )
        unavailable();
    },
  };
}
