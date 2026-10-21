import {
  gitlabConnectionV1Schema,
  gitlabLinkIntentV1Schema,
  type GitlabConnectionV1,
} from "@cloudmarkup/api-contract";
import type { GitLabConnectionsApplication } from "./application/gitlab-connections.js";
import { GitLabBrowserState } from "./adapters/gitlab-browser-state.js";
import {
  GitLabGrantVault,
  type GitLabGrantVaultConfiguration,
} from "./adapters/gitlab-grant-vault.js";
import { GitLabOAuthAdapter } from "./adapters/gitlab-oauth.js";
import { GitLabProviderError } from "./adapters/gitlab-http.js";
import { GitLabConnectionAuthority } from "./adapters/persistence/gitlab-connection-authority.js";
import { PostgresGitLabLinkIntents } from "./adapters/persistence/gitlab-link-intents.js";
import {
  PostgresGitLabGrants,
  type StoredGitLabGrant,
} from "./adapters/persistence/gitlab-grants.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { ApplicationError } from "./application/errors.js";
import type { PrincipalContext } from "./application/ports.js";

function translate(error: unknown): never {
  if (error instanceof ApplicationError) throw error;
  if (error instanceof GitLabProviderError) {
    throw new ApplicationError(
      error.problem === "access-denied"
        ? "access_denied"
        : error.problem === "invalid-input"
          ? "invalid_request"
          : error.problem === "rate-limited"
            ? "rate_limited"
            : "service_unavailable",
      "The GitLab connection could not be confirmed. Reload its status before continuing.",
    );
  }
  throw new ApplicationError(
    "service_unavailable",
    "GitLab connections are temporarily unavailable.",
  );
}
function changed(): never {
  throw new ApplicationError(
    "conflict",
    "Start a new GitLab connection attempt.",
  );
}

/** Server composition only. Public routes must project credential-free versioned contracts. */
export function createProductionGitLabConnections(options: {
  readonly database: SqlDatabase;
  readonly applicationId: string;
  readonly redirectUri: string;
  readonly readClientSecret: () => Promise<Uint8Array>;
  readonly vault: GitLabGrantVaultConfiguration;
  readonly enabled?: boolean;
  readonly clock?: () => Date;
  readonly fetch?: typeof globalThis.fetch;
}) {
  options = Object.freeze({ ...options });
  const clock = options.clock ?? (() => new Date());
  const oauth = new GitLabOAuthAdapter({
    clientId: options.applicationId,
    redirectUri: options.redirectUri,
    readClientSecret: options.readClientSecret,
    now: clock,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const browser = new GitLabBrowserState({
    applicationId: options.applicationId,
    redirectUri: options.redirectUri,
    readClientSecret: options.readClientSecret,
    clock,
  });
  const vault = new GitLabGrantVault(options.vault);
  const enabled = options.enabled === true;
  function request(principal: PrincipalContext, organizationId: string) {
    if (!enabled)
      throw new ApplicationError(
        "service_unavailable",
        "GitLab connections are not enabled.",
      );
    const authority = new GitLabConnectionAuthority(
      options.database,
      principal,
      organizationId,
      clock,
    );
    return {
      authority,
      intents: new PostgresGitLabLinkIntents(authority, options.applicationId),
      grants: new PostgresGitLabGrants(authority, options.applicationId),
    };
  }
  async function run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      return translate(error);
    }
  }
  return {
    start: (principal: PrincipalContext, organizationId: string) =>
      run(async () => {
        const { authority, intents } = request(principal, organizationId);
        const authorization = oauth.createAuthorization();
        const intent = await intents.start(authorization.state);
        // Neither database/API clock skew nor a delayed seal may extend the browser lifetime.
        const expiresAt = new Date(
          Math.min(Date.parse(intent.expiresAt), clock().getTime() + 600000),
        ).toISOString();
        const cookie = await browser.seal(
          {
            organizationId: authority.organizationId,
            principalId: authority.principal.principalId,
            sessionId: authority.principal.sessionId,
            intentId: intent.intentId,
            connectionId: intent.connectionId,
            expiresAt,
            state: authorization.state,
            verifier: authorization.verifier,
          },
          {
            assertCurrentAdmission: () =>
              authority.assertCurrent("integrations.manage"),
          },
        );
        return {
          intentId: intent.intentId,
          authorizationUrl: authorization.url,
          expiresAt,
          cookie,
        };
      }),
    complete: (
      principal: PrincipalContext,
      organizationId: string,
      input: {
        readonly cookie: string;
        readonly intentId: string;
        readonly state: string;
        readonly code: string;
      },
    ) =>
      run(async () => {
        const snapshot = { ...input };
        const { authority, intents, grants } = request(
          principal,
          organizationId,
        );
        const state = await browser.open(
          snapshot.cookie,
          {
            organizationId: authority.organizationId,
            principalId: authority.principal.principalId,
            sessionId: authority.principal.sessionId,
            intentId: snapshot.intentId,
            state: snapshot.state,
          },
          {
            assertCurrentAdmission: () =>
              authority.assertCurrent("integrations.manage"),
          },
        );
        const previous = await intents.inspect(state.intentId);
        if (previous.connectionId !== state.connectionId) changed();
        // Read-only recovery after a lost database commit acknowledgement. Never exchange the code again.
        if (previous.status === "completed")
          return grants.get(state.connectionId);
        if (previous.status !== "pending") changed();
        await intents.consume(state.intentId, state.state);
        const admission = {
          assertCurrentAdmission: async () => {
            const intent = await intents.inspect(state.intentId);
            if (
              intent.status !== "consumed" ||
              intent.connectionId !== state.connectionId ||
              Date.parse(intent.expiresAt) <= clock().getTime()
            )
              changed();
          },
        };
        const grant = await oauth.exchange(
          { code: snapshot.code, verifier: state.verifier },
          admission,
        );
        try {
          const binding = {
            schemaVersion: 1 as const,
            applicationId: options.applicationId,
            organizationId: authority.organizationId,
            principalId: authority.principal.principalId,
            connectionId: state.connectionId,
            providerUserId: grant.providerUserId,
            grantVersion: 1,
          };
          const envelope = await grant.consume((tokens) =>
            vault.seal(binding, tokens, admission),
          );
          try {
            return await grants.completeLink(
              state.intentId,
              state.connectionId,
              {
                providerUserId: grant.providerUserId,
                username: grant.username,
                expiresAt: grant.expiresAt,
              },
              envelope,
            );
          } catch (error) {
            try {
              const intent = await intents.inspect(state.intentId);
              if (intent.status === "completed")
                return await grants.get(state.connectionId);
            } catch {
              /* Preserve the original redacted failure. */
            }
            throw error;
          }
        } finally {
          grant.dispose();
        }
      }),
    list: (
      principal: PrincipalContext,
      organizationId: string,
      limit = 50,
      cursor = "",
    ) =>
      run(() => request(principal, organizationId).grants.list(limit, cursor)),
    get: (
      principal: PrincipalContext,
      organizationId: string,
      connectionId: string,
    ) => run(() => request(principal, organizationId).grants.get(connectionId)),
    /** Internal credential scope for fixed-host repository adapters; never expose to HTTP/AI callers. */
    withAccess: <T>(
      principal: PrincipalContext,
      organizationId: string,
      connectionId: string,
      work: (input: {
        readonly accessToken: Uint8Array;
        readonly grantVersion: number;
        readonly assertCurrentAdmission: () => Promise<void>;
      }) => Promise<T>,
    ) =>
      run(async () => {
        const { grants } = request(principal, organizationId);
        let current = await grants.get(connectionId);
        if (current.status !== "active" || !current.sealedGrant) changed();
        if (Date.parse(current.expiresAt) <= clock().getTime() + 60000) {
          const claim = await grants.claimRefresh(
            connectionId,
            current.binding.grantVersion,
          );
          const attempt = claim.refreshAttemptId;
          if (!attempt || !claim.sealedGrant) changed();
          const admission = {
            assertCurrentAdmission: () =>
              grants.assertRefreshCurrent(
                connectionId,
                claim.binding.grantVersion,
                attempt,
              ),
          };
          try {
            const old = await vault.open(
              claim.binding,
              claim.sealedGrant,
              admission,
            );
            const refreshed = await old.consume((tokens) =>
              oauth.refresh(
                {
                  refreshToken: tokens.refreshToken,
                  providerUserId: claim.binding.providerUserId,
                },
                admission,
              ),
            );
            try {
              const envelope = await refreshed.consume((tokens) =>
                vault.seal(
                  {
                    ...claim.binding,
                    grantVersion: claim.binding.grantVersion + 1,
                  },
                  tokens,
                  admission,
                ),
              );
              current = await grants.completeRefresh(
                connectionId,
                claim.binding.grantVersion,
                attempt,
                {
                  providerUserId: refreshed.providerUserId,
                  username: refreshed.username,
                  expiresAt: refreshed.expiresAt,
                },
                envelope,
              );
            } finally {
              refreshed.dispose();
            }
          } catch (error) {
            // A committed replacement can be recovered; every other outcome retains a no-retry refresh fence.
            let recovered: StoredGitLabGrant | undefined;
            try {
              const value = await grants.get(connectionId);
              if (
                value.status === "active" &&
                value.binding.grantVersion === claim.binding.grantVersion + 1 &&
                value.refreshAttemptId === attempt
              )
                recovered = value;
            } catch {
              /* No readback, no retry. */
            }
            if (recovered) current = recovered;
            else {
              try {
                await grants.markRefreshUnknown(
                  connectionId,
                  claim.binding.grantVersion,
                  attempt,
                );
              } catch {
                /* Existing claim still denies old-token use. */
              }
              throw error;
            }
          }
        }
        if (!current.sealedGrant) changed();
        const grantVersion = current.binding.grantVersion;
        const admission = {
          assertCurrentAdmission: () =>
            grants.assertUsable(connectionId, grantVersion),
        };
        const material = await vault.open(
          current.binding,
          current.sealedGrant,
          admission,
        );
        const result = await material.consume((tokens) =>
          work({ accessToken: tokens.accessToken, grantVersion, ...admission }),
        );
        await admission.assertCurrentAdmission();
        return result;
      }),
    disconnect: (
      principal: PrincipalContext,
      organizationId: string,
      connectionId: string,
    ) =>
      run(async () => {
        const { authority, grants } = request(principal, organizationId);
        const disconnected = await grants.disconnect(connectionId);
        if (
          disconnected.status === "revoked" ||
          disconnected.providerRevocationUncertain
        )
          return disconnected;
        if (!disconnected.sealedGrant) changed();
        const admission = {
          assertCurrentAdmission: async () => {
            await authority.assertCurrent("integrations.manage");
            const value = await grants.get(connectionId);
            if (
              value.status !== "disconnected" ||
              value.binding.grantVersion !==
                disconnected.binding.grantVersion ||
              value.providerRevocationUncertain
            )
              changed();
          },
        };
        const material = await vault.open(
          disconnected.binding,
          disconnected.sealedGrant,
          admission,
        );
        await material.consume(async (tokens) => {
          await oauth.revoke(tokens.refreshToken, admission);
          await oauth.revoke(tokens.accessToken, admission);
        });
        try {
          return await grants.confirmRevoked(
            connectionId,
            disconnected.binding.grantVersion,
          );
        } catch (error) {
          try {
            const value = await grants.get(connectionId);
            if (value.status === "revoked") return value;
          } catch {
            /* Retain disconnected recovery. */
          }
          throw error;
        }
      }),
  };
}

/** Explicit HTTP projection; encrypted envelopes, token lifetimes and refresh claim IDs remain server-only. */
export function createGitLabConnectionApplication(
  runtime: ReturnType<typeof createProductionGitLabConnections>,
): GitLabConnectionsApplication {
  function project(value: StoredGitLabGrant): GitlabConnectionV1 {
    const status =
      value.status === "refreshing" && value.refreshExpired
        ? "reconnect-required"
        : value.status;
    const providerRevocation =
      status === "revoked"
        ? "confirmed"
        : value.providerRevocationUncertain || status === "reconnect-required"
          ? "requires-user-action"
          : status === "disconnected"
            ? "pending"
            : "not-requested";
    return gitlabConnectionV1Schema.parse({
      contractVersion: 1,
      id: value.binding.connectionId,
      organizationId: value.binding.organizationId,
      principalId: value.binding.principalId,
      providerUsername: value.username,
      status,
      providerRevocation,
    });
  }
  return {
    start: async (principal, organizationId) => {
      const result = await runtime.start(principal, organizationId);
      return {
        intent: gitlabLinkIntentV1Schema.parse({
          contractVersion: 1,
          intentId: result.intentId,
          authorizationUrl: result.authorizationUrl,
          expiresAt: result.expiresAt,
        }),
        cookie: result.cookie,
      };
    },
    complete: async (principal, organizationId, input, cookie) =>
      project(
        await runtime.complete(principal, organizationId, {
          cookie,
          intentId: input.intentId,
          state: input.state,
          code: input.code,
        }),
      ),
    list: async (principal, organizationId, limit, cursor) => {
      const result = await runtime.list(
        principal,
        organizationId,
        limit,
        cursor,
      );
      return {
        items: result.items.map(project),
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
    },
    get: async (principal, organizationId, connectionId) =>
      project(await runtime.get(principal, organizationId, connectionId)),
    disconnect: async (principal, organizationId, connectionId) =>
      project(
        await runtime.disconnect(principal, organizationId, connectionId),
      ),
  };
}
