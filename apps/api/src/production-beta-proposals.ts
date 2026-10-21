import { createBetaInfrastructureModel } from "@cloudmarkup/model-gateway";
import { createBetaInfrastructureApplication } from "./application/beta-infrastructure.js";
import { createBetaInfrastructureJobs } from "./application/beta-infrastructure-jobs.js";
import { createBetaAiSyncCredits } from "./adapters/persistence/beta-ai-sync-credits.js";
import { SqsJobPublisherV1 } from "./adapters/sqs-job-publisher.js";
import type { CloudMarkupApplication } from "./application/ports.js";
import type { ObjectStore } from "./application/persistence.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { createBetaProposalBaselineReader } from "./adapters/persistence/beta-proposal-baseline-reader.js";
import { ActiveProjectRequestAuthority } from "./adapters/persistence/solution-export-authority.js";
import { betaProposalCommandPreparerV1 } from "./application/beta-proposal-command-preparer.js";
export function betaProposalQueueTarget(environment: NodeJS.ProcessEnv) {
  const queueArn = environment["CLOUDMARKUP_BETA_PROPOSAL_QUEUE_ARN"];
  const configuredUrl = environment["CLOUDMARKUP_BETA_PROPOSAL_QUEUE_URL"];
  if (queueArn === undefined && configuredUrl === undefined) return undefined;
  const region =
    /^arn:aws:sqs:([a-z0-9-]+):000000000000:cloudmarkup-beta-proposals\.fifo$/u.exec(
      queueArn ?? "",
    )?.[1];
  if (
    environment["CLOUDMARKUP_BETA_AI_ENABLED"] !== "true" ||
    environment["CLOUDMARKUP_ENVIRONMENT"] !== "beta" ||
    queueArn === undefined ||
    !region ||
    environment["AWS_REGION"] !== region
  )
    throw new Error("Background proposal configuration is unavailable.");
  // One validated ARN is sufficient; duplicating its URL exceeded Lambda
  // environment capacity in the complete beta profile.
  const queueUrl =
    "https://sqs." +
    region +
    ".amazonaws.com/000000000000/cloudmarkup-beta-proposals.fifo";
  if (configuredUrl !== undefined && configuredUrl !== queueUrl)
    throw new Error("Background proposal configuration is unavailable.");
  return { queueArn, queueUrl, region };
}
export function createProductionBetaProposals(options: {
  environment: NodeJS.ProcessEnv;
  application: CloudMarkupApplication;
  database: SqlDatabase;
  objectStore: ObjectStore;
}) {
  if (options.environment["CLOUDMARKUP_BETA_AI_ENABLED"] !== "true") return {};
  const betaInfrastructure = createBetaInfrastructureApplication({
    application: options.application,
    model: createBetaInfrastructureModel(),
    creditMeter: createBetaAiSyncCredits(options),
    applicability: {
      preparer: betaProposalCommandPreparerV1,
      forPrincipal: (principal, ownership) =>
        createBetaProposalBaselineReader({
          authority: new ActiveProjectRequestAuthority(
            options.database,
            principal,
            ownership,
            "projects.mutate",
          ),
          objectStore: options.objectStore,
        }),
    },
  });
  const target = betaProposalQueueTarget(options.environment);
  return {
    betaInfrastructure,
    ...(target
      ? {
          betaInfrastructureJobs: createBetaInfrastructureJobs({
            ...options,
            proposals: betaInfrastructure,
            publisher: (ownership) =>
              new SqsJobPublisherV1({
                target,
                ownership,
                family: "architecture-proposal",
              }),
          }),
        }
      : {}),
  };
}
