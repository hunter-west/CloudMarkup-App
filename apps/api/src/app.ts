import {
  registerStaffAccountRoutes,
  type StaffAccountsConfiguration,
} from "./modules/staff-accounts.js";
import {
  registerGitLabExportRoutes,
  type GitLabExportsConfiguration,
} from "./modules/gitlab-exports.js";
import {
  registerGitLabConnectionRoutes,
  type GitLabConnectionsConfiguration,
} from "./modules/gitlab-connections.js";
import {
  registerAccountAuthenticatorRoutes,
  type AccountAuthenticatorConfiguration,
} from "./modules/account-authenticator.js";
import {
  registerAccountCredentialsRoutes,
  type AccountCredentialsConfiguration,
} from "./modules/account-credentials.js";
import {
  accountAccessV1Schema,
  CLOSED_ACCOUNT_ACCESS_V1,
} from "@cloudmarkup/api-contract";
import {
  registerAccountSessionsRoutes,
  type AccountSessionsConfiguration,
} from "./modules/account-sessions.js";
import {
  registerOrganizationMembersRoutes,
  type OrganizationMembersConfiguration,
} from "./modules/organization-members.js";
import {
  registerRecipientOrganizationInvitationRoutes,
  type RecipientOrganizationInvitationConfiguration,
} from "./modules/recipient-organization-invitations.js";
import {
  registerAccountProfileRoutes,
  type AccountProfileConfiguration,
} from "./modules/account-profile.js";
import {
  registerAccountPhotoRoutes,
  type AccountPhotoConfiguration,
} from "./modules/account-photo.js";
import {
  registerAccountWorkspaceRoutes,
  type AccountWorkspacesConfiguration,
} from "./modules/account-workspaces.js";
import { registerBetaInfrastructureRoutes } from "./modules/beta-infrastructure.js";
import type { BetaInfrastructureJobs } from "./application/beta-infrastructure-jobs.js";
import type { BetaInfrastructureApplication } from "./application/beta-infrastructure.js";
import {
  registerBrowserSessionRoutes,
  type BrowserSessionRoutes,
} from "./modules/browser-sessions.js";
import {
  registerLocalOwnerSessionRoutes,
  type LocalOwnerSessionRoutes,
} from "./modules/local-owner-sessions.js";
import {
  runtimeAiCapabilitiesV1Schema,
  UNAVAILABLE_RUNTIME_AI_CAPABILITIES_V1,
  type RuntimeAiCapabilitiesV1,
  runtimeExportCapabilitiesV1Schema,
  type RuntimeExportCapabilitiesV1,
} from "@cloudmarkup/api-contract";
import type { AiIntentAcceptancePortV1 } from "./application/ai-intent-acceptance.js";
import { registerAiIntentAcceptanceRoutes } from "./modules/ai-intent-acceptance.js";
import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { z } from "zod";

import type { BillingApplicationService } from "./application/billing.js";
import type { AiIntentPreviewAcknowledgementPortV1 } from "./application/ai-intent-preview-acknowledgements.js";
import { registerAiIntentPreviewAcknowledgementRoutes } from "./modules/ai-intent-preview-acknowledgements.js";
import {
  registerOrganizationInvitationRoutes,
  type OrganizationInvitationPort,
} from "./modules/organization-invitations.js";
import type { ContinuousConformanceApplication } from "./application/continuous-conformance.js";
import type { GitHubRepositoryExportApplication } from "./application/github-exports.js";
import type { GitHubRepositoryImportApplication } from "./application/github-imports.js";
import type { GitHubWebhookService } from "@cloudmarkup/github-repository-export/webhook";
import { ApplicationError } from "./application/errors.js";
import type { SolutionExportApplication } from "./application/solution-exports.js";
import type { SolutionExportReadApplication } from "./application/solution-export-reads.js";
import type { ProjectEditingLeasePort } from "./application/project-editing-leases.js";
import { registerProjectEditingLeaseRoutes } from "./modules/project-editing-leases.js";
import type {
  CloudMarkupApplication,
  PrincipalResolver,
  ReadinessProbe,
} from "./application/ports.js";
import { registerBillingWebhookRoute } from "./modules/billing-webhook.js";
import {
  registerBillingWorkspaceRoutes,
  type BillingWorkspaceConfiguration,
} from "./modules/billing-workspace.js";
import { registerGitHubWebhookRoute } from "./modules/github-webhook.js";
import {
  registerGitHubInstallationCallbackRoutes,
  type GitHubInstallationCallbackConfiguration,
} from "./modules/github-installation-callback.js";
import { registerModules } from "./modules/index.js";
import {
  type ApiEnvironment,
  createCorrelationMiddleware,
  createPrincipalMiddleware,
  errorResponse,
  requestLimitsMiddleware,
  securityHeadersMiddleware,
} from "./transport/http.js";

export interface ApiDependencies {
  readonly staffAccounts?: StaffAccountsConfiguration;
  readonly gitlabExports?: GitLabExportsConfiguration;
  readonly gitlabConnections?: GitLabConnectionsConfiguration;
  readonly accountAuthenticator?: AccountAuthenticatorConfiguration;
  readonly accountCredentials?: AccountCredentialsConfiguration;
  readonly accountAccess?: import("@cloudmarkup/api-contract").AccountAccessV1;
  readonly accountSessions?: AccountSessionsConfiguration;
  readonly recipientOrganizationInvitations?: RecipientOrganizationInvitationConfiguration;
  readonly organizationMembers?: OrganizationMembersConfiguration;
  readonly accountProfile?: AccountProfileConfiguration;
  readonly accountPhoto?: AccountPhotoConfiguration;
  readonly accountWorkspaces?: AccountWorkspacesConfiguration;
  readonly betaInfrastructure?: Pick<BetaInfrastructureApplication, "propose">;
  readonly betaInfrastructureJobs?: BetaInfrastructureJobs;
  readonly browserSessions?: BrowserSessionRoutes;
  readonly localOwnerSessions?: LocalOwnerSessionRoutes;
  readonly aiIntentAcceptance?: AiIntentAcceptancePortV1;
  readonly organizationInvitations?: OrganizationInvitationPort;
  readonly aiIntentPreviewAcknowledgements?: AiIntentPreviewAcknowledgementPortV1;
  readonly application: CloudMarkupApplication;
  readonly authenticationClock?: () => Date;
  readonly billing?: BillingApplicationService;
  readonly billingWorkspace?: BillingWorkspaceConfiguration;
  readonly continuousConformance?: ContinuousConformanceApplication;
  readonly githubExports?: GitHubRepositoryExportApplication;
  readonly githubImports?: GitHubRepositoryImportApplication;
  readonly githubInstallationCallback?: GitHubInstallationCallbackConfiguration;
  readonly githubWebhooks?: GitHubWebhookService;
  readonly correlationIdFactory?: () => string;
  readonly principalResolver: PrincipalResolver;
  readonly readiness?: ReadinessProbe;
  readonly runtimeConfig?: PublicRuntimeConfig;
  readonly runtimeExportCapabilities?: RuntimeExportCapabilitiesV1;
  readonly runtimeAiCapabilities?: RuntimeAiCapabilitiesV1;
  readonly solutionExports?: SolutionExportApplication;
  readonly solutionExportReads?: SolutionExportReadApplication;
  readonly solutionExportCredits?: Parameters<typeof registerModules>[9];
  readonly projectEditingLeases?: ProjectEditingLeasePort;
}

export const publicRuntimeConfigSchema = z
  .object({
    authentication: z
      .object({
        callbackUrl: z.url(),
        clientId: z.string().min(1).max(128),
        domain: z.url(),
        logoutUrl: z.url(),
        provider: z.literal("cognito"),
        scopes: z.tuple([
          z.literal("openid"),
          z.literal("profile"),
          z.literal("cloudmarkup-api/access"),
        ]),
      })
      .strict(),
    schemaVersion: z.literal(1),
  })
  .strict();

export type PublicRuntimeConfig = z.output<typeof publicRuntimeConfigSchema>;

export function parsePublicRuntimeConfig(value: unknown): PublicRuntimeConfig {
  const config = publicRuntimeConfigSchema.parse(value);
  const callback = new URL(config.authentication.callbackUrl);
  const logout = new URL(config.authentication.logoutUrl);
  const domain = new URL(config.authentication.domain);
  if (
    callback.protocol !== "https:" ||
    logout.protocol !== "https:" ||
    domain.protocol !== "https:" ||
    callback.username.length > 0 ||
    callback.password.length > 0 ||
    callback.port.length > 0 ||
    logout.username.length > 0 ||
    logout.password.length > 0 ||
    logout.port.length > 0 ||
    domain.port.length > 0 ||
    callback.origin !== logout.origin ||
    callback.pathname !== "/auth/callback" ||
    callback.search.length > 0 ||
    callback.hash.length > 0 ||
    logout.pathname !== "/" ||
    logout.search.length > 0 ||
    logout.hash.length > 0 ||
    domain.username.length > 0 ||
    domain.password.length > 0 ||
    domain.pathname !== "/" ||
    domain.search.length > 0 ||
    domain.hash.length > 0
  ) {
    throw new TypeError("The public runtime configuration is invalid.");
  }
  return config;
}

const unavailableSolutionExportApplication = new Proxy(
  {},
  {
    get: () => () =>
      Promise.reject(
        new ApplicationError(
          "service_unavailable",
          "The Solution Export API adapter is not configured.",
        ),
      ),
  },
) as SolutionExportApplication;

const unavailableGitHubExportApplication = new Proxy(
  {},
  {
    get: () => () =>
      Promise.reject(
        new ApplicationError(
          "service_unavailable",
          "The GitHub export API adapter is not configured.",
        ),
      ),
  },
) as GitHubRepositoryExportApplication;
const unavailableGitHubImportApplication = new Proxy(
  {},
  {
    get: () => () =>
      Promise.reject(
        new ApplicationError(
          "service_unavailable",
          "The GitHub repository import API adapter is not configured.",
        ),
      ),
  },
) as GitHubRepositoryImportApplication;
const unavailableContinuousConformanceApplication = new Proxy(
  {},
  {
    get: () => () =>
      Promise.reject(
        new ApplicationError(
          "service_unavailable",
          "The continuous conformance API adapter is not configured.",
        ),
      ),
  },
) as ContinuousConformanceApplication;
const defaultReadiness: ReadinessProbe = {
  check: () => Promise.resolve([{ name: "http", ready: true }]),
};

export function createApp(dependencies: ApiDependencies): Hono<ApiEnvironment> {
  const localOwner = dependencies.localOwnerSessions;
  if (
    (localOwner !== undefined &&
      (dependencies.browserSessions !== undefined ||
        dependencies.accountSessions?.mode !== "local-owner" ||
        dependencies.accountSessions.publicOrigin !== localOwner.publicOrigin ||
        dependencies.principalResolver !== localOwner.service)) ||
    (localOwner === undefined &&
      dependencies.accountSessions?.mode === "local-owner")
  )
    throw new TypeError("Local owner identity composition is inconsistent.");
  const app = new Hono<ApiEnvironment>();
  const runtimeConfig =
    dependencies.runtimeConfig === undefined
      ? undefined
      : parsePublicRuntimeConfig(dependencies.runtimeConfig);

  const accountAccess = accountAccessV1Schema.parse(
    dependencies.accountAccess ?? CLOSED_ACCOUNT_ACCESS_V1,
  );
  const runtimeExportCapabilities = runtimeExportCapabilitiesV1Schema.parse(
    dependencies.runtimeExportCapabilities ?? {
      schemaVersion: 1,
      exports: { targets: [], workload: null, maximumBytes: 4_194_304 },
    },
  );

  const runtimeAiCapabilities = runtimeAiCapabilitiesV1Schema.parse(
    dependencies.runtimeAiCapabilities ??
      UNAVAILABLE_RUNTIME_AI_CAPABILITIES_V1,
  );

  app.use(
    "*",
    createCorrelationMiddleware(
      dependencies.correlationIdFactory ?? (() => randomUUID()),
    ),
  );
  app.use("*", requestLimitsMiddleware());
  app.use("*", securityHeadersMiddleware());
  app.use(
    "/v1/*",
    createPrincipalMiddleware(
      dependencies.principalResolver,
      dependencies.authenticationClock,
    ),
  );

  if (runtimeConfig !== undefined || localOwner !== undefined) {
    app.get("/runtime-config", (context) => {
      context.header("Cache-Control", "no-store");
      const views = context.req.queries("view");
      if (views === undefined)
        return runtimeConfig === undefined
          ? context.notFound()
          : context.json(runtimeConfig, 200);
      if (views.length === 1 && views[0] === "account")
        return context.json(accountAccess, 200);
      if (views.length === 1 && views[0] === "ai") {
        return context.json(runtimeAiCapabilities, 200);
      }
      if (views.length === 1 && views[0] === "exports") {
        return context.json(runtimeExportCapabilities, 200);
      }
      throw new ApplicationError(
        "invalid_request",
        "The requested runtime configuration view is unavailable.",
      );
    });
  }

  registerBetaInfrastructureRoutes(
    app,
    dependencies.betaInfrastructure,
    dependencies.betaInfrastructureJobs,
  );
  registerBrowserSessionRoutes(app, dependencies.browserSessions);
  registerLocalOwnerSessionRoutes(app, dependencies.localOwnerSessions);
  registerBillingWebhookRoute(app, dependencies.billing);
  registerOrganizationInvitationRoutes(
    app,
    dependencies.organizationInvitations,
  );
  registerBillingWorkspaceRoutes(app, dependencies.billingWorkspace);
  registerAccountWorkspaceRoutes(app, dependencies.accountWorkspaces);
  registerOrganizationMembersRoutes(app, dependencies.organizationMembers);
  registerAccountProfileRoutes(app, dependencies.accountProfile);
  registerAccountPhotoRoutes(app, dependencies.accountPhoto);
  registerStaffAccountRoutes(app, dependencies.staffAccounts);
  registerAccountSessionsRoutes(app, dependencies.accountSessions);
  registerGitLabConnectionRoutes(app, dependencies.gitlabConnections);
  registerGitLabExportRoutes(app, dependencies.gitlabExports);
  registerAccountCredentialsRoutes(app, dependencies.accountCredentials);
  registerAccountAuthenticatorRoutes(app, dependencies.accountAuthenticator);
  registerRecipientOrganizationInvitationRoutes(
    app,
    dependencies.recipientOrganizationInvitations,
  );
  registerProjectEditingLeaseRoutes(app, dependencies.projectEditingLeases);
  registerAiIntentAcceptanceRoutes(app, dependencies.aiIntentAcceptance);
  registerAiIntentPreviewAcknowledgementRoutes(
    app,
    dependencies.aiIntentPreviewAcknowledgements,
  );
  registerGitHubWebhookRoute(app, dependencies.githubWebhooks);
  registerGitHubInstallationCallbackRoutes(
    app,
    dependencies.githubInstallationCallback,
  );
  registerModules(
    app,
    dependencies.application,
    dependencies.solutionExports ?? unavailableSolutionExportApplication,
    dependencies.githubExports ?? unavailableGitHubExportApplication,
    dependencies.githubImports ?? unavailableGitHubImportApplication,
    dependencies.readiness ?? defaultReadiness,
    dependencies.continuousConformance ??
      unavailableContinuousConformanceApplication,
    dependencies.githubInstallationCallback,
    dependencies.solutionExportReads,
    dependencies.solutionExportCredits,
  );

  app.onError((error, context) => errorResponse(context, error));
  app.notFound((context) =>
    errorResponse(
      context,
      new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      ),
    ),
  );

  return app;
}

function createUnavailableApp(): Hono<ApiEnvironment> {
  const unavailableApplication = new Proxy(
    {},
    {
      get: () => () =>
        Promise.reject(
          new ApplicationError(
            "service_unavailable",
            "The product API adapter is not configured.",
          ),
        ),
    },
  ) as CloudMarkupApplication;
  const anonymousPrincipalResolver: PrincipalResolver = {
    resolve: () => Promise.resolve(null),
  };
  const unavailableReadiness: ReadinessProbe = {
    check: () =>
      Promise.resolve([{ name: "application-composition", ready: false }]),
  };
  return createApp({
    application: unavailableApplication,
    principalResolver: anonymousPrincipalResolver,
    readiness: unavailableReadiness,
  });
}

// Production Lambda bundles import createApp but not this explicitly pure local
// shell. Keeping the fallback behind one removable initializer prevents a
// deployable artifact from containing or selecting the unavailable composition.
export const app = /* @__PURE__ */ createUnavailableApp();
