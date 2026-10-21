import { PostgresStaffAccounts } from "./adapters/persistence/staff-accounts.js";

import {
  optionalCleanupWakeObserver,
  optionalCleanupWakeAdmission,
} from "./production-project-cleanup-wake.js";
import { CurrentPlanRepositoryExportEntitlementPolicy } from "./application/repository-export-entitlements.js";
import { CognitoAccountAuthenticator } from "./adapters/identity/cognito-account-authenticator.js";
import { PostgresAccountAuthenticatorJournal } from "./adapters/persistence/account-authenticator-journal.js";
import {
  readProductionAccountSecurity,
  type AccountSecurityConfigurationV1,
} from "./account-security-config.js";
import { CognitoAccountCredentials } from "./adapters/identity/cognito-account-credentials.js";
import { PostgresPrincipalDirectory } from "./adapters/identity/postgres-principal-directory.js";
import { PostgresAccountCredentialAudit } from "./adapters/persistence/account-credential-audit.js";
import { readProductionAccountAccess } from "./production-account-access.js";
import { PostgresAccountSessions } from "./adapters/persistence/account-sessions.js";
import { PostgresOrganizationMembers } from "./adapters/persistence/organization-members.js";
import { PostgresOrganizationInvitationRepository } from "./adapters/persistence/organization-invitations.js";
import { PostgresAccountProfile } from "./adapters/persistence/account-profile.js";
import { PostgresAccountPhoto } from "./adapters/persistence/account-photo.js";
import { PostgresAccountWorkspaces } from "./adapters/persistence/account-workspaces.js";
import { createBetaAiExportCredits } from "./adapters/persistence/beta-ai-export-credits.js";
import { createProductionBetaProposals } from "./production-beta-proposals.js";
import { BrowserRefreshSessionService } from "./adapters/identity/browser-refresh-session-service.js";
import { PostgresBrowserRefreshSessions } from "./adapters/persistence/browser-refresh-sessions.js";
import { GetBucketVersioningCommand, S3Client } from "@aws-sdk/client-s3";
import { GitHubRestAppAdapter } from "@cloudmarkup/github-repository-export";

import {
  createApp,
  parsePublicRuntimeConfig,
  type PublicRuntimeConfig,
} from "./app.js";
import { BetaCognitoPrincipalDirectory } from "./adapters/identity/beta-cognito-principal-directory.js";
import { CognitoJwtPrincipalResolver } from "./adapters/identity/cognito-jwt-principal-resolver.js";
import { PostgresCloudMarkupRepository } from "./adapters/persistence/repositories.js";
import { PostgresAiIntentAcceptance } from "./adapters/persistence/ai-intent-acceptance.js";
import { PostgresProjectEditingLeases } from "./adapters/persistence/project-editing-leases.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { createProductionDatabase } from "./production-database.js";
import { createProductionCleanupIncarnation } from "./production-cleanup-incarnation.js";
import { S3ObjectStore } from "./adapters/persistence/s3-object-store.js";
import { createProjectWriteFencedObjectStore } from "./adapters/persistence/project-content-write-fence.js";
import { PostgresSolutionRecordRepository } from "./adapters/persistence/solution-record-repository.js";
import { DeterministicValidationBridge } from "./adapters/persistence/deterministic-validation-bridge.js";
import { createHostedValidationOverrides } from "./adapters/persistence/hosted-validation.js";
import { sql } from "./adapters/persistence/sql.js";
import type { SolutionExportApplication } from "./application/solution-exports.js";
import { createProductionInitialDocument } from "./production-initial-document.js";
import { ApplicationError } from "./application/errors.js";
import { GitHubInstallationLinkAdapter } from "./adapters/github-installation-link.js";
import { SecretsManagerConfigurationResolver } from "./adapters/secret-configuration.js";
import {
  composeProductionGitLabConnections,
  readProductionGitLabEnvironment,
  readProductionGitLabExportGate,
  type GitLabDeploymentProfile,
} from "./production-gitlab-environment.js";
import { createProductionGitHubConnections } from "./production-github-connections.js";
import { createProductionGitHubExports } from "./production-github-exports.js";
import { createProductionGitHubImports } from "./production-github-imports.js";
import { createPinnedTerraformHclInspector } from "./adapters/pinned-terraform-inspector.js";
import { CurrentPlanGitHubExportEntitlementPolicy } from "./application/github-exports.js";
import { createProductionBillingWorkspace } from "./production-billing-workspace.js";
import { createProductionCommercialReads } from "./production-commercial-reads.js";
import { createProductionSolutionRevisionToolSelector } from "./production-solution-revision-tools.js";
import { readProductionSolutionExportEnvironment } from "./production-solution-export-environment.js";
import { createProductionSolutionExportReads } from "./production-solution-export-reads.js";
import { createProductionAiIntentPreviewAcknowledgements } from "./production-ai-intent-preview-acknowledgements.js";
import { createProductionOrganizationInvitations } from "./production-organization-invitations.js";
import { readProductionBillingSessions } from "./production-billing-environment.js";
import {
  ProductionIdentityApplication,
  productionIdentityOverrides,
} from "./application/production-identity-application.js";
import {
  createRepositoryBackedApplication,
  type RepositoryBackedApplicationOptions,
} from "./application/repository-backed-application.js";
import { createRepositoryBackedEnvironmentApplicationOverrides } from "./application/repository-backed-environment-application.js";
import type {
  CloudMarkupApplication,
  ReadinessProbe,
} from "./application/ports.js";

export const PRODUCTION_COMPOSITION_MARKER =
  "cloudmarkup.api-composition/cognito-rds-s3-v1";

function readinessCheckName(marker: string): string {
  const prefix = "cloudmarkup.api-composition/";
  const name = marker.startsWith(prefix) ? marker.slice(prefix.length) : "";
  if (!/^[a-z][a-z0-9-]*$/u.test(name) || name.length > 64) {
    throw new Error("The production composition marker is invalid.");
  }
  return name;
}

export const PRODUCTION_READINESS_CHECK_NAME = readinessCheckName(
  PRODUCTION_COMPOSITION_MARKER,
);

type ProductionRepositoryBackedApplicationOptions = Omit<
  RepositoryBackedApplicationOptions,
  | "organizationForProject"
  | "organizationForRequestedScope"
  | "createInitialDocument"
>;

export function createProductionRepositoryBackedApplication(
  identity: ProductionIdentityApplication,
  options: ProductionRepositoryBackedApplicationOptions,
): CloudMarkupApplication {
  return createRepositoryBackedApplication({
    ...options,
    createInitialDocument: createProductionInitialDocument,
    additionalOverrides: {
      ...createRepositoryBackedEnvironmentApplicationOverrides({
        ...(options.clock === undefined ? {} : { clock: options.clock }),
        identifierNamespace: options.identifierNamespace,
        organizationForProject: (principal, projectId) =>
          identity.organizationForProject(principal, projectId),
        repository: options.repository,
      }),
      ...options.additionalOverrides,
    },
    organizationForProject: (principal, projectId) =>
      identity.organizationForProject(principal, projectId),
    organizationForRequestedScope: (principal, organizationId) =>
      identity.organizationForRequestedScope(principal, organizationId),
  });
}

interface ProductionEnvironment {
  readonly contentBucket: string;
  readonly databaseArn: string;
  readonly databaseName: string;
  readonly databaseSecretArn: string;
  readonly documentPrefix: string;
  readonly evidencePrefix: string;
  readonly issuer: string;
  readonly requiredScope: string;
  readonly accountSecurity: AccountSecurityConfigurationV1;
  readonly accountAccess: import("@cloudmarkup/api-contract").AccountAccessV1;
  readonly runtimeConfig: PublicRuntimeConfig;
  readonly userPoolClientId: string;
  readonly userPoolId: string;
  readonly githubConnections?: ProductionGitHubEnvironment;
  readonly gitlabConnections?: Readonly<GitLabDeploymentProfile>;
  readonly gitlabExports?: boolean;
  readonly repositoryImportCompiler?: {
    readonly executablePath: string;
    readonly executableSha256: string;
  };
}

interface ProductionGitHubEnvironment {
  readonly appId: "123456";
  readonly appSlug: "cloudmarkup-example-beta";
  readonly clientId: "IvEXAMPLE000000000000";
  readonly privateKeySecretArn: string;
  readonly clientSecretArn: string;
  readonly clientSecretJsonField: "Client secret";
  readonly publicOrigin: "https://beta.example.invalid";
}

/** Exact beta identities are reviewed configuration, never browser selectors. */
export function readProductionGitHubEnvironment(
  environment: NodeJS.ProcessEnv,
): ProductionGitHubEnvironment | undefined {
  const flag = environment["CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED"];
  if (flag === undefined || flag === "false") return undefined;
  if (flag !== "true")
    throw new Error("GitHub connections require an explicit Boolean flag.");
  const reviewed = {
    CLOUDMARKUP_GITHUB_APP_ID: "123456",
    CLOUDMARKUP_GITHUB_APP_SLUG: "cloudmarkup-example-beta",
    CLOUDMARKUP_GITHUB_CLIENT_ID: "IvEXAMPLE000000000000",
    CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_ARN:
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/github/app-private-key-EX0002",
    CLOUDMARKUP_GITHUB_CLIENT_SECRET_ARN:
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:Github-App-Client-Secret-EX0001",
    CLOUDMARKUP_GITHUB_CLIENT_SECRET_JSON_FIELD: "Client secret",
  } as const;
  for (const [name, value] of Object.entries(reviewed))
    exact(environment, name, value);
  return {
    appId: reviewed.CLOUDMARKUP_GITHUB_APP_ID,
    appSlug: reviewed.CLOUDMARKUP_GITHUB_APP_SLUG,
    clientId: reviewed.CLOUDMARKUP_GITHUB_CLIENT_ID,
    privateKeySecretArn: reviewed.CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_ARN,
    clientSecretArn: reviewed.CLOUDMARKUP_GITHUB_CLIENT_SECRET_ARN,
    clientSecretJsonField: reviewed.CLOUDMARKUP_GITHUB_CLIENT_SECRET_JSON_FIELD,
    publicOrigin: "https://beta.example.invalid",
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (
    value === undefined ||
    value.trim().length === 0 ||
    value !== value.trim()
  ) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function exact(
  environment: NodeJS.ProcessEnv,
  name: string,
  expected: string,
): void {
  if (required(environment, name) !== expected) {
    throw new Error(`${name} must be ${expected}.`);
  }
}

export function readProductionRepositoryImportEnvironment(
  environment: NodeJS.ProcessEnv,
  githubConnections: ProductionGitHubEnvironment | undefined,
): ProductionEnvironment["repositoryImportCompiler"] {
  const importEnabled = environment["CLOUDMARKUP_REPOSITORY_IMPORTS_ENABLED"];
  if (
    importEnabled !== undefined &&
    importEnabled !== "false" &&
    importEnabled !== "true"
  )
    throw new Error("Repository imports require an explicit Boolean flag.");
  const repositoryImportCompiler =
    importEnabled === "true"
      ? {
          executablePath: required(
            environment,
            "CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_PATH",
          ),
          executableSha256: required(
            environment,
            "CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_SHA256",
          ),
        }
      : undefined;
  if (repositoryImportCompiler !== undefined) {
    if (githubConnections === undefined)
      throw new Error(
        "Repository imports require configured GitHub connections.",
      );
    createPinnedTerraformHclInspector(repositoryImportCompiler);
  }
  return repositoryImportCompiler;
}

export function readProductionEnvironment(
  environment: NodeJS.ProcessEnv,
): ProductionEnvironment {
  exact(environment, "CLOUDMARKUP_ENVIRONMENT", "beta");
  exact(environment, "CLOUDMARKUP_EXPECTED_SCHEMA_VERSION", "0138");
  exact(environment, "CLOUDMARKUP_RUNTIME_COMPOSITION", "production-v1");
  if (environment["CLOUDMARKUP_DEPLOYMENT_SHELL"] === "true") {
    throw new Error("The beta deployment shell cannot run the production API.");
  }

  let decodedRuntimeConfig: unknown;
  try {
    decodedRuntimeConfig = JSON.parse(
      required(environment, "CLOUDMARKUP_PUBLIC_RUNTIME_CONFIG"),
    );
  } catch {
    throw new Error("CLOUDMARKUP_PUBLIC_RUNTIME_CONFIG is invalid.");
  }

  const githubConnections = readProductionGitHubEnvironment(environment);
  const gitlabConnections = readProductionGitLabEnvironment(environment);
  const gitlabExports = readProductionGitLabExportGate(
    environment,
    gitlabConnections,
  );
  const runtimeConfig = parsePublicRuntimeConfig(decodedRuntimeConfig);
  if (
    gitlabConnections &&
    new URL(runtimeConfig.authentication.callbackUrl).origin !==
      gitlabConnections.publicOrigin
  )
    throw new Error(
      "GitLab callback origin does not match the reviewed application origin.",
    );
  const repositoryImportCompiler = readProductionRepositoryImportEnvironment(
    environment,
    githubConnections,
  );
  return {
    ...(githubConnections === undefined ? {} : { githubConnections }),
    ...(gitlabConnections === undefined ? {} : { gitlabConnections }),
    ...(gitlabExports ? { gitlabExports } : {}),
    ...(repositoryImportCompiler === undefined
      ? {}
      : { repositoryImportCompiler }),
    contentBucket: required(environment, "CLOUDMARKUP_CONTENT_BUCKET"),
    databaseArn: required(environment, "CLOUDMARKUP_DATABASE_ARN"),
    databaseName: required(environment, "CLOUDMARKUP_DATABASE_NAME"),
    databaseSecretArn: required(environment, "CLOUDMARKUP_DATABASE_SECRET_ARN"),
    documentPrefix: required(environment, "CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX"),
    evidencePrefix: required(environment, "CLOUDMARKUP_OBJECT_EVIDENCE_PREFIX"),
    issuer: required(environment, "COGNITO_ISSUER"),
    requiredScope: required(environment, "COGNITO_REQUIRED_SCOPE"),
    accountAccess: readProductionAccountAccess(environment),
    accountSecurity: readProductionAccountSecurity(environment),
    runtimeConfig,
    userPoolClientId: required(environment, "COGNITO_APP_CLIENT_ID"),
    userPoolId: required(environment, "COGNITO_USER_POOL_ID"),
  };
}

function disabledBetaFeatures(): CloudMarkupApplication {
  return new Proxy(
    {},
    {
      get: () => () =>
        Promise.reject(
          new ApplicationError(
            "service_unavailable",
            "This feature is not enabled for the initial beta.",
          ),
        ),
    },
  ) as CloudMarkupApplication;
}

export class ProductionReadiness implements ReadinessProbe {
  readonly #bucket: string;
  readonly #database: SqlDatabase;
  readonly #s3: S3Client;

  constructor(options: {
    readonly bucket: string;
    readonly database: SqlDatabase;
    readonly s3: S3Client;
  }) {
    this.#bucket = options.bucket;
    this.#database = options.database;
    this.#s3 = options.s3;
  }

  async check(): Promise<
    readonly { readonly name: string; readonly ready: boolean }[]
  > {
    const [postgresql, objectStorage] = await Promise.all([
      this.#database
        .query(sql("SELECT 1 AS ready"))
        .then(() => true)
        .catch(() => false),
      this.#s3
        .send(new GetBucketVersioningCommand({ Bucket: this.#bucket }))
        .then((result) => result.Status === "Enabled")
        .catch(() => false),
    ]);
    return [
      { name: PRODUCTION_READINESS_CHECK_NAME, ready: true },
      { name: "postgresql", ready: postgresql },
      { name: "object-storage", ready: objectStorage },
    ];
  }
}

export function createProductionApp(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const config = readProductionEnvironment(environment);
  const billingSessions = readProductionBillingSessions(environment);
  const solutionExports = readProductionSolutionExportEnvironment(environment);
  const database = createProductionDatabase(
    {
      database: config.databaseName,
      resourceArn: config.databaseArn,
      secretArn: config.databaseSecretArn,
    },
    environment,
    "api",
    createProductionCleanupIncarnation(environment),
  );
  const cleanupWakeAdmission = optionalCleanupWakeAdmission(
    environment,
    database,
  );
  const history = cleanupWakeAdmission?.history;
  const s3 = new S3Client(
    history === undefined
      ? {}
      : {
          maxAttempts: 1,
          requestHandler: { connectionTimeout: 5000, requestTimeout: 20000 },
        },
  );
  const objectStore = createProjectWriteFencedObjectStore({
    database,
    storageNamespace: "documents",
    ...(history === undefined ? {} : { history }),
    delegate: new S3ObjectStore({
      bucket: config.contentBucket,
      client: s3,
      keyPrefix: config.documentPrefix,
      requireDefinitiveStage: history !== undefined,
    }),
  });
  const onProjectDeletionCommitted =
    cleanupWakeAdmission === undefined
      ? optionalCleanupWakeObserver(environment)
      : undefined;
  const repository = new PostgresCloudMarkupRepository(database, {
    draftEditingLeases: "required",
    ...(cleanupWakeAdmission === undefined ? {} : { cleanupWakeAdmission }),
    ...(onProjectDeletionCommitted === undefined
      ? {}
      : { onProjectDeletionCommitted }),
  });
  const acceptedIntents = new PostgresAiIntentAcceptance({
    database,
    repository,
    objectStore,
  });
  const validationObjectStore = createProjectWriteFencedObjectStore({
    database,
    storageNamespace: "evidence",
    ...(history === undefined ? {} : { history }),
    delegate: new S3ObjectStore({
      bucket: config.contentBucket,
      client: s3,
      keyPrefix: config.evidencePrefix,
      requireDefinitiveStage: history !== undefined,
    }),
  });
  const organizationInvitations =
    createProductionOrganizationInvitations(database);
  const identity = new ProductionIdentityApplication(database, {
    organizationInvitations: true,
    // The same validated config constructs the real connection service below.
    githubConnections: config.githubConnections !== undefined,
    gitlabConnections: config.gitlabConnections !== undefined,
    gitlabExports: config.gitlabExports === true,
    githubExports: config.githubConnections !== undefined,
  });
  const application = createProductionRepositoryBackedApplication(identity, {
    draftEditingLeases: "required",
    additionalOverrides: {
      ...productionIdentityOverrides(identity),
      ...createProductionCommercialReads({ database }),
      ...createHostedValidationOverrides({
        database,
        documentStore: objectStore,
        reportStore: validationObjectStore,
        repository,
        organizationForProject: (principal, projectId) =>
          identity.organizationForProject(principal, projectId),
      }),
    },
    fallback: disabledBetaFeatures(),
    identifierNamespace: "beta",
    objectStore,
    repository,
    solutionRevisions: {
      ...(solutionExports?.enabled === true
        ? {
            selectToolsForFreeze:
              createProductionSolutionRevisionToolSelector(solutionExports),
          }
        : {}),
      acceptedIntents,
      solutionRecords: new PostgresSolutionRecordRepository(database),
      validation: new DeterministicValidationBridge({
        database,
        identifierNamespace: "beta",
        objectStore: validationObjectStore,
        repository,
      }),
    },
  });
  const accountSessions = new PostgresAccountSessions(database);
  const principalResolver = new CognitoJwtPrincipalResolver({
    sessionAdmission: accountSessions,
    clientId: config.userPoolClientId,
    principalDirectory: new BetaCognitoPrincipalDirectory({
      database,
      issuer: config.issuer,
    }),
    requiredScope: config.requiredScope,
    userPoolId: config.userPoolId,
  });
  const gitlabConnections = composeProductionGitLabConnections(
    database,
    config.gitlabConnections,
    config.gitlabExports === true
      ? {
          objectStore,
          entitlements: new CurrentPlanRepositoryExportEntitlementPolicy(
            application,
            "GitLab",
          ),
          organizationForProject: (principal, projectId) =>
            identity.organizationForProject(principal, projectId),
        }
      : undefined,
  );
  const githubConfig = config.githubConnections;
  const github =
    githubConfig === undefined
      ? undefined
      : (() => {
          const secrets = new SecretsManagerConfigurationResolver({
            allowedReferences: [
              githubConfig.privateKeySecretArn,
              githubConfig.clientSecretArn,
            ],
          });
          const callback = new GitHubInstallationLinkAdapter({
            appId: Number(githubConfig.appId),
            appSlug: githubConfig.appSlug,
            callbackUrl: githubConfig.publicOrigin + "/api/github/callback",
            clientId: githubConfig.clientId,
            clientSecretReference: githubConfig.clientSecretArn,
            clientSecretJsonField: githubConfig.clientSecretJsonField,
            secrets,
          });
          const configuration = {
            apiBaseUrl: "https://api.github.com",
            apiVersion: "2026-03-10",
            appId: githubConfig.appId,
            privateKeySecretReference: githubConfig.privateKeySecretArn,
            userAgent: "cloudmarkup-beta/1",
          };
          return {
            ...(config.repositoryImportCompiler === undefined
              ? {}
              : {
                  githubImports: createProductionGitHubImports({
                    database,
                    application,
                    organizationForProject: (principal, projectId) =>
                      identity.organizationForProject(principal, projectId),
                    hclInspector: createPinnedTerraformHclInspector(
                      config.repositoryImportCompiler,
                    ),
                    createGitHub: (authorizeBeforeRequest) =>
                      new GitHubRestAppAdapter({
                        secrets,
                        configuration,
                        authorizeBeforeRequest,
                      }),
                  }),
                }),
            githubExports: {
              ...createProductionGitHubConnections({
                database,
                callback,
                installationSetupUrl:
                  "https://github.com/apps/" +
                  githubConfig.appSlug +
                  "/installations/new",
                github: new GitHubRestAppAdapter({
                  secrets,
                  configuration,
                }),
              }),
              ...createProductionGitHubExports({
                database,
                objectStore,
                organizationForProject: async (principal, projectId) => {
                  const organizationId = await identity.organizationForProject(
                    principal,
                    projectId,
                  );
                  if (organizationId === null)
                    throw new ApplicationError(
                      "not_found",
                      "Project not found.",
                    );
                  return organizationId;
                },
                entitlements: new CurrentPlanGitHubExportEntitlementPolicy(
                  application,
                ),
                createGitHub: (authorizeBeforeRequest) =>
                  new GitHubRestAppAdapter({
                    secrets,
                    configuration,
                    authorizeBeforeRequest,
                  }),
              }),
            },
            githubInstallationCallback: {
              adapter: callback,
              publicOrigin: githubConfig.publicOrigin,
            },
          };
        })();
  const solutionExportReads = createProductionSolutionExportReads({
    database,
    objectStore,
    identity,
  });
  const solutionExportCredits = createBetaAiExportCredits({
    database,
    application,
    reads: solutionExportReads,
  });
  let hostedExports: Promise<SolutionExportApplication> | undefined;
  const hosted = (): Promise<SolutionExportApplication> => {
    if (solutionExports === undefined)
      return Promise.reject(
        new ApplicationError(
          "service_unavailable",
          "Hosted CloudFormation exports are unavailable.",
        ),
      );
    hostedExports ??= import("./production-solution-exports.js").then(
      ({ createProductionSolutionExports }) =>
        createProductionSolutionExports({
          config: solutionExports,
          database,
          objectStore,
          identity,
          revisions: application,
        }),
    );
    return hostedExports;
  };
  const betaProposals = createProductionBetaProposals({
    environment,
    application,
    database,
    objectStore,
  });
  return createApp({
    ...betaProposals,
    runtimeAiCapabilities: {
      schemaVersion: 1,
      proposalVersions:
        "betaInfrastructureJobs" in betaProposals &&
        betaProposals.betaInfrastructureJobs
          ? [6]
          : [],
      applicationSources:
        solutionExports?.enabled === true ? ["ai-source-draft-v3"] : [],
    },
    browserSessions: {
      publicOrigin: new URL(config.runtimeConfig.authentication.callbackUrl)
        .origin,
      service: new BrowserRefreshSessionService({
        clientId: config.userPoolClientId,
        domain: config.runtimeConfig.authentication.domain,
        callbackUrl: config.runtimeConfig.authentication.callbackUrl,
        principalResolver,
        sessions: new PostgresBrowserRefreshSessions(database),
      }),
    },
    ...github,
    ...(gitlabConnections === undefined ? {} : { gitlabConnections }),
    ...(gitlabConnections?.exports === undefined
      ? {}
      : { gitlabExports: gitlabConnections.exports }),
    organizationInvitations,
    recipientOrganizationInvitations: {
      application: new PostgresOrganizationInvitationRepository(database),
      publicOrigin: new URL(config.runtimeConfig.authentication.callbackUrl)
        .origin,
    },
    organizationMembers: {
      application: new PostgresOrganizationMembers(database),
      publicOrigin: new URL(config.runtimeConfig.authentication.callbackUrl)
        .origin,
    },
    ...(config.accountAccess.managedLogin
      ? {
          accountAuthenticator: {
            publicOrigin: new URL(
              config.runtimeConfig.authentication.callbackUrl,
            ).origin,
            application: new CognitoAccountAuthenticator({
              issuer: config.issuer,
              directory: new PostgresPrincipalDirectory(database),
              journal: new PostgresAccountAuthenticatorJournal(
                database,
                config.issuer,
              ),
              ...(config.accountSecurity.recoveryContact === null
                ? {}
                : { recoveryContact: config.accountSecurity.recoveryContact }),
              principalResolver: new CognitoJwtPrincipalResolver({
                sessionAdmission: accountSessions,
                clientId: config.userPoolClientId,
                principalDirectory: new PostgresPrincipalDirectory(database),
                requiredScope: [
                  config.requiredScope,
                  "aws.cognito.signin.user.admin",
                ],
                userPoolId: config.userPoolId,
              }),
            }),
          },
          accountCredentials: {
            publicOrigin: new URL(
              config.runtimeConfig.authentication.callbackUrl,
            ).origin,
            application: new CognitoAccountCredentials({
              issuer: config.issuer,
              directory: new PostgresPrincipalDirectory(database),
              audit: new PostgresAccountCredentialAudit(
                database,
                config.issuer,
              ),
              contactProjection: new PostgresAccountCredentialAudit(
                database,
                config.issuer,
              ),
              principalResolver: new CognitoJwtPrincipalResolver({
                sessionAdmission: accountSessions,
                clientId: config.userPoolClientId,
                principalDirectory: new PostgresPrincipalDirectory(database),
                requiredScope: [
                  config.requiredScope,
                  "aws.cognito.signin.user.admin",
                ],
                userPoolId: config.userPoolId,
              }),
            }),
          },
        }
      : {}),
    accountSessions: {
      application: accountSessions,
      publicOrigin: new URL(config.runtimeConfig.authentication.callbackUrl)
        .origin,
    },
    staffAccounts: {
      application: new PostgresStaffAccounts(database),
      publicOrigin: new URL(config.runtimeConfig.authentication.callbackUrl)
        .origin,
    },
    accountProfile: {
      application: new PostgresAccountProfile(database),
      publicOrigin: new URL(config.runtimeConfig.authentication.callbackUrl)
        .origin,
    },
    accountPhoto: {
      application: new PostgresAccountPhoto(database),
      publicOrigin: new URL(config.runtimeConfig.authentication.callbackUrl)
        .origin,
    },
    accountWorkspaces: {
      application: new PostgresAccountWorkspaces(database),
      publicOrigin: new URL(config.runtimeConfig.authentication.callbackUrl)
        .origin,
    },
    aiIntentAcceptance: acceptedIntents,
    aiIntentPreviewAcknowledgements:
      createProductionAiIntentPreviewAcknowledgements(database),
    application,
    ...(solutionExports === undefined
      ? {}
      : {
          solutionExports: {
            ...solutionExportReads,
            createJob: async (
              ...input: Parameters<SolutionExportApplication["createJob"]>
            ) => (await hosted()).createJob(...input),
            cancelJob: async (
              ...input: Parameters<SolutionExportApplication["cancelJob"]>
            ) => (await hosted()).cancelJob(...input),
          },
        }),
    solutionExportReads,
    solutionExportCredits,
    projectEditingLeases: new PostgresProjectEditingLeases(database),
    billingWorkspace: {
      application: createProductionBillingWorkspace({
        database,
        ...(billingSessions === undefined ? {} : { sessions: billingSessions }),
      }),
      publicOrigin: new URL(config.runtimeConfig.authentication.callbackUrl)
        .origin,
    },
    principalResolver,
    readiness: new ProductionReadiness({
      bucket: config.contentBucket,
      database,
      s3,
    }),
    accountAccess: config.accountAccess,
    runtimeConfig: config.runtimeConfig,
    runtimeExportCapabilities: {
      schemaVersion: 1,
      exports:
        solutionExports?.enabled === true
          ? {
              targets: ["cloudformation"],
              workload: "infrastructure-only",
              maximumBytes: 4_194_304,
            }
          : { targets: [], workload: null, maximumBytes: 4_194_304 },
    },
  });
}
