import { createGitLabExportsApplication } from "./application/gitlab-export-application.js";
import {
  createProductionGitLabExportWorkflow,
  type ProductionGitLabExportOptions,
} from "./production-gitlab-exports.js";
import { z } from "zod";
import { createProductionGitLabProjects } from "./production-gitlab-projects.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { SecretsManagerConfigurationResolver } from "./adapters/secret-configuration.js";
import { gitLabSecretText } from "./adapters/gitlab-http.js";
import {
  createGitLabConnectionApplication,
  createProductionGitLabConnections,
} from "./production-gitlab-connections.js";

const region = "us-east-1",
  account = "000000000000";
const keyPattern =
  /^arn:aws:kms:us-east-1:000000000000:key\/(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|mrk-[a-f0-9]{32})$/u;
const profileSchema = z
  .object({
    schemaVersion: z.literal(1),
    applicationId: z.string().regex(/^[a-f0-9]{64}$/u),
    clientSecretArn: z
      .string()
      .regex(
        /^arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup\/beta\/gitlab\/[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/u,
      ),
    activeKeyArn: z.string().regex(keyPattern),
    previousKeyArns: z.array(z.string().regex(keyPattern)).max(3).readonly(),
    publicOrigin: z.literal("https://beta.example.invalid"),
  })
  .strict()
  .refine(
    (value) =>
      new Set([value.activeKeyArn, ...value.previousKeyArns]).size ===
      value.previousKeyArns.length + 1,
  );
export type GitLabDeploymentProfile = z.output<typeof profileSchema>;
/** Activation requires a reviewed source change with real OAuth/secret/KMS identities. No guessed ARN or secret value. */
const reviewedBetaProfile: GitLabDeploymentProfile | null = null;

export function readProductionGitLabEnvironment(
  environment: NodeJS.ProcessEnv,
  reviewedProfile: unknown = reviewedBetaProfile,
): Readonly<GitLabDeploymentProfile> | undefined {
  const flag = environment["CLOUDMARKUP_GITLAB_CONNECTIONS_ENABLED"];
  if (flag === undefined || flag === "false") return undefined;
  if (flag !== "true")
    throw new Error("GitLab connections require an explicit Boolean flag.");
  const parsed = profileSchema.safeParse(reviewedProfile);
  if (!parsed.success)
    throw new Error(
      "GitLab requires a reviewed beta OAuth and key profile before activation.",
    );
  if (
    environment["AWS_REGION"] !== undefined &&
    environment["AWS_REGION"] !== region
  )
    throw new Error("GitLab beta Region mismatch.");
  if (
    environment["AWS_ACCOUNT_ID"] !== undefined &&
    environment["AWS_ACCOUNT_ID"] !== account
  )
    throw new Error("GitLab beta account mismatch.");
  return Object.freeze({
    ...parsed.data,
    previousKeyArns: Object.freeze([...parsed.data.previousKeyArns]),
  });
}

export function readProductionGitLabExportGate(
  environment: NodeJS.ProcessEnv,
  connections: Readonly<GitLabDeploymentProfile> | undefined,
): boolean {
  const flag = environment["CLOUDMARKUP_GITLAB_EXPORTS_ENABLED"];
  if (flag === undefined || flag === "false") return false;
  if (flag !== "true" || connections === undefined)
    throw new Error(
      "GitLab export requires an explicit Boolean flag and reviewed connection configuration.",
    );
  return true;
}

/** Builds the same app-owned capability exposed to identity and HTTP; no secret read until a managed operation. */
export function composeProductionGitLabConnections(
  database: SqlDatabase,
  profile: Readonly<GitLabDeploymentProfile> | undefined,
  exports?: Omit<
    ProductionGitLabExportOptions,
    "database" | "applicationId" | "connections"
  >,
) {
  if (profile === undefined) return undefined;
  const config = profileSchema.parse(profile);
  const secrets = new SecretsManagerConfigurationResolver({
    allowedReferences: [config.clientSecretArn],
  });
  const runtime = createProductionGitLabConnections({
    database,
    applicationId: config.applicationId,
    redirectUri: config.publicOrigin + "/account/gitlab/callback",
    enabled: true,
    readClientSecret: async () => {
      const value = await secrets.resolveSecret(config.clientSecretArn);
      try {
        gitLabSecretText(value);
        return value;
      } catch (error) {
        value.fill(0);
        throw error;
      }
    },
    vault: {
      activeKeyArn: config.activeKeyArn,
      previousKeyArns: config.previousKeyArns,
    },
  });
  return {
    ...(exports === undefined
      ? {}
      : {
          exports: {
            publicOrigin: config.publicOrigin,
            application: createGitLabExportsApplication(
              createProductionGitLabExportWorkflow({
                ...exports,
                database,
                applicationId: config.applicationId,
                connections: runtime,
              }),
            ),
          },
        }),
    publicOrigin: config.publicOrigin,
    application: createGitLabConnectionApplication(runtime),
    projects: createProductionGitLabProjects({
      database,
      applicationId: config.applicationId,
      connections: runtime,
    }),
  };
}
