import {
  BETA_PROPOSAL_WORKER,
  BETA_PROPOSAL_QUEUE,
  BETA_PROPOSAL_DLQ,
  validateBetaProposalDelivery,
} from "./beta-proposal-admission.mjs";
import { isDeepStrictEqual } from "node:util";
import {
  BETA_CLOUDFORMATION_PROFILE,
  BETA_LIVE_PROFILE,
  BETA_EXPORT_QUEUE,
  BETA_EXPORT_DLQ,
  BETA_EXPORT_WORKER,
} from "./beta-solution-export-admission.mjs";

/** Closed, nonsecret beta profile admission; no credentials or provider calls. */
const currentSigningPattern =
  /^arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup\/beta\/stripe\/webhook-signing-secret-[A-Za-z0-9]{6}$/u;
const previousSigningPattern =
  /^arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup\/beta\/stripe\/webhook-signing-previous-[A-Za-z0-9]{6}$/u;

function input(environment, key, fallback = "") {
  const value = environment[key];
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || value.trim() !== value)
    throw new TypeError(
      "Beta service input must be an exact nonsecret string: " + key,
    );
  return value;
}

export function parseBetaServiceProfile(environment) {
  const profile = input(environment, "BETA_SERVICE_PROFILE", "core-v1");
  const sessions = input(
    environment,
    "BETA_STRIPE_SANDBOX_SESSIONS_ENABLED",
    "false",
  );
  const signingArn = input(
    environment,
    "BETA_STRIPE_WEBHOOK_SIGNING_SECRET_ARN",
  );
  const previousArn = input(
    environment,
    "BETA_STRIPE_PREVIOUS_WEBHOOK_SIGNING_SECRET_ARN",
  );
  if (
    ![
      "core-v1",
      "stripe-sandbox-v1",
      "stripe-sandbox-github-connections-v1",
      "stripe-sandbox-github-cloudformation-v1",
      BETA_LIVE_PROFILE,
    ].includes(profile) ||
    !["false", "true"].includes(sessions)
  )
    throw new TypeError(
      "Beta service profile or sandbox sessions selector is not reviewed.",
    );
  if (profile === "core-v1") {
    if (sessions !== "false" || signingArn !== "" || previousArn !== "")
      throw new TypeError(
        "Core beta cannot contain sandbox activation inputs.",
      );
  } else if (
    profile === BETA_LIVE_PROFILE
      ? signingArn !==
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/webhook-signing-secret-EX0005" ||
        previousArn !== ""
      : !currentSigningPattern.test(signingArn) ||
        (previousArn !== "" && !previousSigningPattern.test(previousArn))
  ) {
    throw new TypeError(
      "Sandbox beta requires exact reviewed current and optional previous signing references.",
    );
  }
  return Object.freeze({
    contractVersion: 1,
    profile,
    sessionsEnabled: sessions === "true",
    signingArn,
    previousArn,
  });
}

export function betaServiceCdkContext(environment) {
  const profile = parseBetaServiceProfile(environment);
  return [
    ["serviceProfile", profile.profile],
    ["stripeSandboxSessionsEnabled", String(profile.sessionsEnabled)],
    ["stripeWebhookSigningSecretArn", profile.signingArn],
    ["stripePreviousWebhookSigningSecretArn", profile.previousArn],
  ].filter(([, value]) => value !== "");
}

/** Written only after prepare has admitted the actual assembly. The existing
 * same-run bundle digest protects this nonsecret config receipt and its assets. */
export function serializeBetaServiceProfile(environment) {
  return JSON.stringify(parseBetaServiceProfile(environment)) + "\n";
}

export function assertBetaServiceProfileReceipt(text, environment) {
  if (
    typeof text !== "string" ||
    text.length > 2048 ||
    text !== serializeBetaServiceProfile(environment)
  )
    throw new TypeError(
      "The admitted beta service profile does not match the protected deployment inputs.",
    );
}

const sandboxApiKeyArn =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/api-key-EX0004";
const sandboxQueueName = "cloudmarkup-beta-billing-webhook.fifo";
const sandboxDlqName = "cloudmarkup-beta-billing-webhook-dlq.fifo";
const sandboxWebhookName = "cloudmarkup-beta-billing-webhook";
const sandboxWorkerName = "cloudmarkup-beta-billing-worker";
const sandboxAssetBucket = "cloudmarkup-beta-cdk-assets-000000000000-us-east-1";
const applicationStack = "cloudmarkup-beta-application";
const observabilityStack = "cloudmarkup-beta-observability";
const githubConnectionEnvironment = Object.freeze({
  CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: "true",
  CLOUDMARKUP_GITHUB_APP_ID: "123456",
  CLOUDMARKUP_GITHUB_APP_SLUG: "cloudmarkup-example-beta",
  CLOUDMARKUP_GITHUB_CLIENT_ID: "IvEXAMPLE000000000000",
  CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/github/app-private-key-EX0002",
  CLOUDMARKUP_GITHUB_CLIENT_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:Github-App-Client-Secret-EX0001",
  CLOUDMARKUP_GITHUB_CLIENT_SECRET_JSON_FIELD: "Client secret",
});
export const SANDBOX_BILLING_EVENT_TYPES = Object.freeze([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
]);
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value, keys) {
  return (
    object(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())
  );
}
function ref(id) {
  return { Ref: id };
}
function attribute(id, name = "Arn") {
  return { "Fn::GetAtt": [id, name] };
}
function variables(resource) {
  return resource?.Properties?.Environment?.Variables ?? {};
}
function roleArn(name) {
  return {
    "Fn::Join": [
      "",
      ["arn:", ref("AWS::Partition"), ":iam::000000000000:role/" + name],
    ],
  };
}
function retained(resource) {
  return (
    resource?.DeletionPolicy === "RetainExceptOnCreate" &&
    resource.UpdateReplacePolicy === "Retain"
  );
}

const cleanupName = "cloudmarkup-beta-project-content-cleanup";
const cleanupScheduleArn =
  "arn:aws:events:us-east-1:000000000000:rule/" + cleanupName;
function hasOwnedRuntimeLogGroup(stacks, item) {
  const observability = stacks.find(
    (stack) => stack.stackName === observabilityStack,
  );
  const logGroupName = "/aws/lambda/" + item.resource.Properties.FunctionName;
  const logs = Object.entries(observability?.template.Resources ?? {}).filter(
    ([, resource]) =>
      resource.Type === "AWS::Logs::LogGroup" &&
      resource.Properties?.LogGroupName === logGroupName &&
      resource.Condition === undefined,
  );
  const matches = Object.values(observability?.template.Outputs ?? {}).filter(
    (output) =>
      logs.length === 1 &&
      output.Condition === undefined &&
      typeof output.Export?.Name === "string" &&
      isDeepStrictEqual(output.Value, ref(logs[0][0])) &&
      isDeepStrictEqual(item.resource.Properties.LoggingConfig, {
        LogGroup: { "Fn::ImportValue": output.Export.Name },
      }),
  );
  return matches.length === 1;
}
function preparedProjectCleanup(resources, stacks) {
  const candidates = resources.filter(
    ({ resource }) =>
      resource.Type === "AWS::Lambda::Function" &&
      resource.Properties?.FunctionName === cleanupName,
  );
  if (candidates.length !== 1) return undefined;
  const item = candidates[0],
    props = item.resource.Properties,
    env = variables(item.resource);
  const api = resources.find(
    ({ resource }) =>
      resource.Type === "AWS::Lambda::Function" &&
      resource.Properties?.FunctionName === "cloudmarkup-beta-api",
  );
  const apiEnv = variables(api?.resource);
  const migrations = resources.filter(
    ({ resource }) =>
      resource.Type === "AWS::CloudFormation::CustomResource" &&
      resource.Properties?.ExpectedSchemaVersion === "0138",
  );
  const schedules = resources.filter(
    ({ resource }) =>
      resource.Type === "AWS::Events::Rule" &&
      resource.Properties?.Name === cleanupName,
  );
  const expectedEnvironment = {
    CLOUDMARKUP_ENVIRONMENT: "beta",
    CLOUDMARKUP_ACCOUNT_ID: "000000000000",
    CLOUDMARKUP_DATABASE_ARN: apiEnv.CLOUDMARKUP_DATABASE_ARN,
    CLOUDMARKUP_DATABASE_SECRET_ARN: apiEnv.CLOUDMARKUP_DATABASE_SECRET_ARN,
    CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
    CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
    CLOUDMARKUP_CONTENT_BUCKET:
      "cloudmarkup-beta-000000000000-us-east-1-content",
    CLOUDMARKUP_CLEANUP_SCHEDULE_ARN: cleanupScheduleArn,
    CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: "true",
    NODE_OPTIONS: "--enable-source-maps",
  };
  const expectedTags = [
    { Key: "CloudMarkupConfigSchema", Value: "1" },
    { Key: "Environment", Value: "beta" },
    { Key: "ManagedBy", Value: "CloudMarkup-CDK" },
    { Key: "Project", Value: "CloudMarkup" },
  ];
  if (
    item.stack !== applicationStack ||
    item.resource.Condition !== undefined ||
    !exactKeys(props, [
      "Architectures",
      "Code",
      "Environment",
      "FunctionName",
      "Handler",
      "LoggingConfig",
      "MemorySize",
      "ReservedConcurrentExecutions",
      "Role",
      "Runtime",
      "Tags",
      "Timeout",
    ]) ||
    !hasOwnedRuntimeLogGroup(stacks, item) ||
    props.Timeout !== 300 ||
    props.MemorySize !== 512 ||
    props.ReservedConcurrentExecutions !== 1 ||
    props.Runtime !== "nodejs24.x" ||
    props.Handler !== "index.handler" ||
    !isDeepStrictEqual(props.Tags, expectedTags) ||
    !isDeepStrictEqual(props.Architectures, ["arm64"]) ||
    !isDeepStrictEqual(
      props.Role,
      roleArn("CloudMarkup-Beta-Project-Cleanup-Runtime"),
    ) ||
    !isDeepStrictEqual(env, expectedEnvironment) ||
    migrations.length !== 1 ||
    ![item.resource.DependsOn].flat().includes(migrations[0].id) ||
    schedules.length !== 1 ||
    schedules[0].stack !== applicationStack ||
    schedules[0].resource.Condition !== undefined ||
    !isDeepStrictEqual(schedules[0].resource.Properties, {
      Name: cleanupName,
      State: "ENABLED",
      ScheduleExpression: "rate(1 minute)",
      Tags: expectedTags,
      Targets: [
        {
          Id: "ProjectContentCleanup",
          Arn: attribute(item.id),
          RetryPolicy: {
            MaximumEventAgeInSeconds: 300,
            MaximumRetryAttempts: 0,
          },
        },
      ],
    })
  )
    return undefined;
  return item;
}

/** Additional closed-surface proof used by the real beta assembly verifier.
 * Common graph/ingress/migration checks remain in validateBetaAssembly. */
export function validateBetaSandboxDelivery(stacks, profile, assets = []) {
  const findings = [];
  const fail = (suffix, path, detail) =>
    findings.push({
      code: "BETA_SANDBOX_" + suffix,
      path,
      detail,
    });
  const resources = stacks.flatMap((stack) =>
    Object.entries(stack.template.Resources ?? {}).map(([id, resource]) => ({
      id,
      resource,
      stack: stack.stackName,
    })),
  );
  const ofType = (type) =>
    resources.filter((item) => item.resource.Type === type);
  const functions = ofType("AWS::Lambda::Function");
  const live = profile.profile === BETA_LIVE_PROFILE;
  const cloudFormationExport =
    live || profile.profile === BETA_CLOUDFORMATION_PROFILE;
  const exportQueueIds = cloudFormationExport
    ? ofType("AWS::SQS::Queue")
        .filter((item) =>
          [
            BETA_EXPORT_QUEUE,
            BETA_EXPORT_DLQ,
            BETA_PROPOSAL_QUEUE,
            BETA_PROPOSAL_DLQ,
          ].includes(item.resource.Properties?.QueueName),
        )
        .map((item) => item.id)
    : [];
  const exportWorker = cloudFormationExport
    ? functions.find(
        (item) => item.resource.Properties?.FunctionName === BETA_EXPORT_WORKER,
      )
    : undefined;
  const proposalWorker = cloudFormationExport
    ? functions.find(
        (item) =>
          item.resource.Properties?.FunctionName === BETA_PROPOSAL_WORKER,
      )
    : undefined;
  findings.push(
    ...validateBetaProposalDelivery(resources, cloudFormationExport),
  );
  const queues = ofType("AWS::SQS::Queue").filter(
    (item) => !exportQueueIds.includes(item.id),
  );
  const policies = ofType("AWS::SQS::QueuePolicy").filter(
    (item) =>
      !exportQueueIds.some((id) =>
        isDeepStrictEqual(item.resource.Properties?.Queues, [ref(id)]),
      ),
  );
  const mappings = ofType("AWS::Lambda::EventSourceMapping").filter(
    (item) =>
      ![exportWorker, proposalWorker].some(
        (worker) =>
          worker &&
          isDeepStrictEqual(
            item.resource.Properties?.FunctionName,
            ref(worker.id),
          ),
      ),
  );
  const named = (type, key, name) =>
    ofType(type).filter((item) => item.resource.Properties?.[key] === name);
  const one = (items, label, stack = applicationStack) => {
    if (
      items.length !== 1 ||
      items[0]?.stack !== stack ||
      items[0]?.resource.Condition !== undefined
    ) {
      fail(
        "RESOURCE_IDENTITY",
        label,
        "Expected one unconditional resource in its exact owning stack.",
      );
      return undefined;
    }
    return items[0];
  };
  const betaApi = functions.find(
    (item) => item.resource.Properties?.FunctionName === "cloudmarkup-beta-api",
  );
  const apiVariables = variables(betaApi?.resource);
  const githubConnections = [
    "stripe-live-github-cloudformation-v1",
    "stripe-sandbox-github-connections-v1",
    "stripe-sandbox-github-cloudformation-v1",
  ].includes(profile.profile);
  const githubExpected = githubConnections
    ? githubConnectionEnvironment
    : { CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: "false" };
  if (
    !betaApi ||
    betaApi.stack !== applicationStack ||
    betaApi.resource.Condition !== undefined ||
    !Object.entries(githubExpected).every(
      ([key, value]) => apiVariables[key] === value,
    ) ||
    functions.some((item) =>
      Object.entries(variables(item.resource)).some(([key, value]) => {
        if (!key.startsWith("CLOUDMARKUP_GITHUB_")) return false;
        if (key === "CLOUDMARKUP_GITHUB_EXPORT_ENABLED")
          return value !== "false";
        if (item === betaApi) return !Object.hasOwn(githubExpected, key);
        return (
          key !== "CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED" || value !== "false"
        );
      }),
    )
  )
    fail(
      "GITHUB_CONNECTION_CONFIGURATION",
      "cloudmarkup-beta-api",
      "Only the selected connections profile admits the exact reviewed GitHub App and two secret references on the API; no export or other runtime authority is admitted.",
    );
  const cleanup = preparedProjectCleanup(resources, stacks);
  findings.push(...validateInvocationSurfaces(resources, profile, cleanup));
  findings.push(...validateBrowserSessionIngress(resources, profile));
  const sandboxFunctions = functions.filter((item) =>
    [sandboxWebhookName, sandboxWorkerName].includes(
      item.resource.Properties?.FunctionName,
    ),
  );
  const applicationNames = new Set([
    "cloudmarkup-beta-api",
    "cloudmarkup-beta-database-migrator",
    ...(cleanup ? [cleanupName] : []),
    ...(cloudFormationExport ? [BETA_EXPORT_WORKER, BETA_PROPOSAL_WORKER] : []),
    ...(profile.profile !== "core-v1"
      ? [sandboxWebhookName, sandboxWorkerName]
      : []),
  ]);
  if (
    functions.some(
      (item) =>
        item.stack === applicationStack &&
        !applicationNames.has(item.resource.Properties?.FunctionName),
    )
  )
    fail(
      "UNREVIEWED_RUNTIME",
      applicationStack,
      "No additional application runtime is admitted by this profile.",
    );
  const invalidBetaModel = functions.some(({ resource }) => {
    const enabled = variables(resource).CLOUDMARKUP_BETA_AI_ENABLED;
    return (
      enabled !== undefined &&
      enabled !== "false" &&
      !(
        enabled === "true" &&
        cloudFormationExport &&
        ["cloudmarkup-beta-api", BETA_PROPOSAL_WORKER].includes(
          resource.Properties?.FunctionName,
        )
      )
    );
  });
  if (invalidBetaModel)
    fail(
      "OTHER_PROVIDER",
      applicationStack,
      "Beta diagram model access is restricted to the API and exact proposal worker.",
    );
  const forbiddenExternalEnvironment = functions.some(({ resource }) =>
    Object.entries(variables(resource)).some(
      ([key, value]) =>
        ([
          "CLOUDMARKUP_AI_ENABLED",
          "CLOUDMARKUP_GITHUB_EXPORT_ENABLED",
          "CLOUDMARKUP_APPLICATION_BUILD_ENABLED",
          "CLOUDMARKUP_FEATURE_AI_AUTHORING",
          "CLOUDMARKUP_FEATURE_APPLICATION_GENERATION",
          "CLOUDMARKUP_FEATURE_GITHUB_EXPORT",
          "CLOUDMARKUP_FEATURE_PLAN_DEPLOYMENT_WORKFLOW_EXPORT",
          "CLOUDMARKUP_FEATURE_STATIC_VALIDATION",
        ].includes(key) &&
          value !== "false") ||
        /^(?:CLOUDMARKUP_BEDROCK_|AWS_BEARER_TOKEN_BEDROCK)/u.test(key),
    ),
  );
  if (forbiddenExternalEnvironment)
    fail(
      "OTHER_PROVIDER",
      applicationStack,
      "The selected profile does not admit AI, export or build runtime authority.",
    );
  for (const item of resources) {
    if (
      [
        "AWS::IAM::Role",
        "AWS::IAM::Policy",
        "AWS::IAM::ManagedPolicy",
      ].includes(item.resource.Type)
    )
      fail(
        "IAM_OWNERSHIP",
        item.id,
        "Beta runtime policies must remain owner-managed immutable imports.",
      );
  }
  if (profile.profile === "core-v1") {
    const runtimeActivation = functions.some(({ resource }) =>
      Object.entries(variables(resource)).some(
        ([key, value]) =>
          /^(?:CLOUDMARKUP_STRIPE_|STRIPE_)/u.test(key) ||
          ([
            "CLOUDMARKUP_BILLING_ENABLED",
            "CLOUDMARKUP_BILLING_SESSIONS_ENABLED",
          ].includes(key) &&
            value !== "false"),
      ),
    );
    if (
      queues.length ||
      policies.length ||
      mappings.length ||
      sandboxFunctions.length ||
      runtimeActivation
    )
      fail(
        "CORE_ACTIVATION",
        applicationStack,
        "Core beta must omit all sandbox resources and provider/session authority.",
      );
    return findings;
  }
  if (
    queues.length !== 2 ||
    policies.length !== 2 ||
    mappings.length !== 1 ||
    sandboxFunctions.length !== 2
  )
    fail(
      "RESOURCE_SET",
      applicationStack,
      "Stripe delivery requires exactly two queues/policies, one consumer and two named runtimes.",
    );
  const queue = one(
    named("AWS::SQS::Queue", "QueueName", sandboxQueueName),
    sandboxQueueName,
  );
  const dlq = one(
    named("AWS::SQS::Queue", "QueueName", sandboxDlqName),
    sandboxDlqName,
  );
  const webhook = one(
    named("AWS::Lambda::Function", "FunctionName", sandboxWebhookName),
    sandboxWebhookName,
  );
  const worker = one(
    named("AWS::Lambda::Function", "FunctionName", sandboxWorkerName),
    sandboxWorkerName,
  );
  const mapping = one(mappings, "sandbox worker mapping");
  if (!queue || !dlq || !webhook || !worker || !mapping) return findings;

  for (const item of [queue, dlq, webhook, worker]) {
    const tags = item.resource.Properties?.Tags;
    if (
      !Array.isArray(tags) ||
      ![
        { Key: "Environment", Value: "beta" },
        { Key: "Project", Value: "CloudMarkup" },
      ].every((tag) => tags.some((actual) => isDeepStrictEqual(actual, tag)))
    )
      fail(
        "RESOURCE_TAGS",
        item.id,
        "Named runtime and queue resources retain their exact ownership tags.",
      );
  }

  for (const item of [queue, dlq]) {
    const properties = item.resource.Properties ?? {};
    const expected = {
      FifoQueue: true,
      SqsManagedSseEnabled: true,
      MessageRetentionPeriod: 1209600,
      QueueName: item === queue ? sandboxQueueName : sandboxDlqName,
      ...(item === queue
        ? {
            VisibilityTimeout: 360,
            ContentBasedDeduplication: false,
            RedrivePolicy: {
              deadLetterTargetArn: attribute(dlq.id),
              maxReceiveCount: 5,
            },
          }
        : {}),
    };
    if (
      !retained(item.resource) ||
      !exactKeys(properties, [...Object.keys(expected), "Tags"]) ||
      !Object.entries(expected).every(([key, value]) =>
        isDeepStrictEqual(properties[key], value),
      )
    )
      fail(
        "QUEUE_CONFIGURATION",
        item.id,
        "Queue encryption, retention, FIFO, retry and visibility settings must match the reviewed lane.",
      );
    const owned = policies.filter((entry) =>
      isDeepStrictEqual(entry.resource.Properties?.Queues, [ref(item.id)]),
    );
    const policy = one(owned, item.id + " TLS policy");
    const expectedPolicy = {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sqs:*",
          Effect: "Deny",
          Principal: { AWS: "*" },
          Resource: attribute(item.id),
          Condition: { Bool: { "aws:SecureTransport": "false" } },
        },
      ],
    };
    if (
      !policy ||
      !isDeepStrictEqual(
        policy.resource.Properties?.PolicyDocument,
        expectedPolicy,
      )
    )
      fail(
        "QUEUE_POLICY",
        item.id,
        "Only the exact TLS Deny is permitted; bootstrap owns all runtime grants.",
      );
  }
  const expectedMapping = {
    BatchSize: 1,
    EventSourceArn: attribute(queue.id),
    FunctionName: ref(worker.id),
    FunctionResponseTypes: ["ReportBatchItemFailures"],
    ScalingConfig: { MaximumConcurrency: 2 },
  };
  if (!isDeepStrictEqual(mapping.resource.Properties, expectedMapping))
    fail(
      "CONSUMER_CONFIGURATION",
      mapping.id,
      "The exact untagged partial-batch consumer must target the fixed queue and worker.",
    );

  const webhookExpected = {
    CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION:
      apiVariables.CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION,
    CLOUDMARKUP_ENVIRONMENT: "beta",
    CLOUDMARKUP_BILLING_ENABLED: "true",
    CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION: cloudFormationExport
      ? "cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4"
      : "cloudmarkup-starter-pro-mapping-2026-08-28-v1",
    CLOUDMARKUP_BILLING_WEBHOOK_ENDPOINT_VERSION:
      "cloudmarkup-stripe-webhook-2026-08-28-v1",
    CLOUDMARKUP_BILLING_WEBHOOK_QUEUE_URL: ref(queue.id),
    CLOUDMARKUP_STRIPE_ENVIRONMENT: live ? "live" : "test",
    CLOUDMARKUP_STRIPE_WEBHOOK_SECRET_REFERENCE: profile.signingArn,
    ...(profile.previousArn === ""
      ? {}
      : {
          CLOUDMARKUP_STRIPE_PREVIOUS_WEBHOOK_SECRET_REFERENCE:
            profile.previousArn,
        }),
    NODE_OPTIONS: "--enable-source-maps",
  };
  const workerExpected = {
    CLOUDMARKUP_ENVIRONMENT: "beta",
    CLOUDMARKUP_BILLING_ENABLED: "true",
    CLOUDMARKUP_STRIPE_ENVIRONMENT: live ? "live" : "test",
    CLOUDMARKUP_BILLING_WEBHOOK_QUEUE_ARN: attribute(queue.id),
    CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION: cloudFormationExport
      ? "cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4"
      : "cloudmarkup-starter-pro-mapping-2026-08-28-v1",
    CLOUDMARKUP_DATABASE_ARN: apiVariables.CLOUDMARKUP_DATABASE_ARN,
    CLOUDMARKUP_DATABASE_SECRET_ARN:
      apiVariables.CLOUDMARKUP_DATABASE_SECRET_ARN,
    CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
    CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN: live
      ? "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/api-key-EX0003"
      : sandboxApiKeyArn,
    CLOUDMARKUP_BILLING_CANCEL_URL:
      "https://beta.example.invalid/organizations",
    CLOUDMARKUP_BILLING_PORTAL_RETURN_URL:
      "https://beta.example.invalid/organizations",
    CLOUDMARKUP_BILLING_SUCCESS_URL:
      "https://beta.example.invalid/organizations",
    STRIPE_PORTAL_CONFIGURATION_ID: live
      ? "bpc_ExampleLive"
      : "bpc_ExampleTest",
    STRIPE_STARTER_PRICE_ID: live
      ? "price_ExampleStarterLive"
      : "price_ExampleStarterTest",
    STRIPE_STARTER_PRODUCT_ID: live
      ? "prod_ExampleStarterLive"
      : "prod_ExampleStarterTest",
    STRIPE_PRO_PRICE_ID: live ? "price_ExampleProLive" : "price_ExampleProTest",
    STRIPE_PRO_PRODUCT_ID: live ? "prod_ExampleProLive" : "prod_ExampleProTest",
    NODE_OPTIONS: "--enable-source-maps",
  };
  for (const [item, name, memory, timeout, expected] of [
    [
      webhook,
      "CloudMarkup-Beta-Billing-Webhook-Runtime",
      256,
      10,
      webhookExpected,
    ],
    [
      worker,
      "CloudMarkup-Beta-Billing-Worker-Runtime",
      512,
      60,
      workerExpected,
    ],
  ]) {
    const p = item.resource.Properties ?? {};
    if (
      !isDeepStrictEqual(p.Role, roleArn(name)) ||
      p.Runtime !== "nodejs24.x" ||
      !isDeepStrictEqual(p.Architectures, ["arm64"]) ||
      p.Handler !== "index.handler" ||
      p.MemorySize !== memory ||
      p.Timeout !== timeout ||
      p.ReservedConcurrentExecutions !== 2 ||
      !isDeepStrictEqual(p.TracingConfig, { Mode: "Active" }) ||
      p.VpcConfig !== undefined ||
      p.Layers !== undefined ||
      p.DeadLetterConfig !== undefined ||
      !isDeepStrictEqual(variables(item.resource), expected)
    )
      fail(
        "RUNTIME_CONFIGURATION",
        item.id,
        "Runtime role, bounded execution, exact secret responsibilities and selected Stripe environment must match.",
      );
  }
  const stateful = stacks.find(
    (stack) => stack.stackName === "cloudmarkup-beta-stateful",
  );
  const boundExport = (value, resourceType, property, name, attributeName) => {
    const matches = Object.entries(stateful?.template.Resources ?? {}).filter(
      ([, item]) =>
        item.Type === resourceType &&
        item.Properties?.[property] === name &&
        item.Condition === undefined,
    );
    if (matches.length !== 1 || !exactKeys(value, ["Fn::ImportValue"]))
      return false;
    return Object.values(stateful?.template.Outputs ?? {}).some(
      (output) =>
        output.Condition === undefined &&
        output.Export?.Name === value["Fn::ImportValue"] &&
        isDeepStrictEqual(
          output.Value,
          attributeName === undefined
            ? ref(matches[0][0])
            : attribute(matches[0][0], attributeName),
        ),
    );
  };
  if (
    !boundExport(
      workerExpected.CLOUDMARKUP_DATABASE_ARN,
      "AWS::RDS::DBCluster",
      "DBClusterIdentifier",
      "cloudmarkup-beta-postgresql",
      "DBClusterArn",
    ) ||
    !boundExport(
      workerExpected.CLOUDMARKUP_DATABASE_SECRET_ARN,
      "AWS::SecretsManager::Secret",
      "Name",
      "cloudmarkup-beta/database/admin",
    )
  )
    fail(
      "DATABASE_BINDING",
      worker.id,
      "Worker database references must bind the exact retained stateful resources.",
    );
  const migrations = ofType("AWS::CloudFormation::CustomResource").filter(
    (item) =>
      item.stack === applicationStack &&
      object(item.resource.Properties) &&
      typeof item.resource.Properties.ExpectedSchemaVersion === "string" &&
      typeof item.resource.Properties.ManifestSha256 === "string",
  );
  if (
    migrations.length !== 1 ||
    !Array.isArray(worker.resource.DependsOn) ||
    !worker.resource.DependsOn.includes(migrations[0].id)
  )
    fail(
      "MIGRATION_DEPENDENCY",
      worker.id,
      "The worker must wait for the same exact admitted schema gate as the API.",
    );

  if (
    apiVariables.CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION !==
    webhookExpected.CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION
  )
    fail(
      "API_MAPPING_CONFIGURATION",
      "cloudmarkup-beta-api",
      "API, ingress and worker must select the same legacy mapping admitted by this profile.",
    );

  const sessionKeys = [
    "CLOUDMARKUP_BILLING_SESSIONS_ENABLED",
    "CLOUDMARKUP_STRIPE_ENVIRONMENT",
    "CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN",
    "CLOUDMARKUP_STRIPE_PORTAL_CONFIGURATION_REFERENCE",
  ];
  const sessionValues = [
    "true",
    live ? "live" : "test",
    live
      ? "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/api-key-EX0003"
      : sandboxApiKeyArn,
    live ? "bpc_ExampleLive" : "bpc_ExampleTest",
  ];
  if (
    sessionKeys.some((key, index) =>
      profile.sessionsEnabled
        ? apiVariables[key] !== sessionValues[index]
        : Object.hasOwn(apiVariables, key),
    )
  )
    fail(
      "SESSION_CONFIGURATION",
      "cloudmarkup-beta-api",
      "API billing-session inputs must match the separately selected sessions profile.",
    );
  if (
    live && profile.sessionsEnabled
      ? apiVariables.CLOUDMARKUP_CREDIT_TOP_UPS_ENABLED !== "true"
      : Object.hasOwn(apiVariables, "CLOUDMARKUP_CREDIT_TOP_UPS_ENABLED")
  )
    fail(
      "TOP_UP_CONFIGURATION",
      "cloudmarkup-beta-api",
      "Live top-ups require the reviewed live sessions profile.",
    );
  const allowedApiStripe = profile.sessionsEnabled
    ? new Set(sessionKeys)
    : new Set();
  if (
    Object.keys(apiVariables).some(
      (key) =>
        /^(?:CLOUDMARKUP_STRIPE_|STRIPE_)/u.test(key) &&
        !allowedApiStripe.has(key),
    )
  )
    fail(
      "API_SECRET_ISOLATION",
      "cloudmarkup-beta-api",
      "The API cannot read signing secrets or acquire another Stripe authority.",
    );

  const rest = one(
    named("AWS::ApiGateway::RestApi", "Name", "cloudmarkup-beta-api"),
    "beta REST API",
  );
  const webhooks = one(
    ofType("AWS::ApiGateway::Resource").filter(
      (item) =>
        item.resource.Properties?.PathPart === "webhooks" &&
        isDeepStrictEqual(item.resource.Properties?.RestApiId, ref(rest?.id)),
    ),
    "webhooks resource",
  );
  const stripe = one(
    ofType("AWS::ApiGateway::Resource").filter(
      (item) =>
        item.resource.Properties?.PathPart === "stripe" &&
        isDeepStrictEqual(
          item.resource.Properties?.ParentId,
          ref(webhooks?.id),
        ) &&
        isDeepStrictEqual(item.resource.Properties?.RestApiId, ref(rest?.id)),
    ),
    "stripe resource",
  );
  const methods = ofType("AWS::ApiGateway::Method").filter((item) =>
    isDeepStrictEqual(item.resource.Properties?.ResourceId, ref(stripe?.id)),
  );
  const method = one(methods, "Stripe POST method");
  const uri = {
    "Fn::Join": [
      "",
      [
        "arn:",
        ref("AWS::Partition"),
        ":apigateway:us-east-1:lambda:path/2015-03-31/functions/",
        attribute(webhook.id),
        "/invocations",
      ],
    ],
  };
  if (
    !rest ||
    !webhooks ||
    !stripe ||
    !method ||
    !isDeepStrictEqual(
      webhooks.resource.Properties.ParentId,
      attribute(rest.id, "RootResourceId"),
    ) ||
    method.resource.Properties.HttpMethod !== "POST" ||
    method.resource.Properties.AuthorizationType !== "NONE" ||
    !isDeepStrictEqual(method.resource.Properties.RestApiId, ref(rest.id)) ||
    !isDeepStrictEqual(method.resource.Properties.Integration, {
      IntegrationHttpMethod: "POST",
      Type: "AWS_PROXY",
      Uri: uri,
      TimeoutInMillis: 10000,
    })
  )
    fail(
      "INGRESS_BINDING",
      "POST /webhooks/stripe",
      "Only the exact same-origin REST POST integration may invoke signed ingress.",
    );
  for (const item of ofType("AWS::Lambda::Permission")) {
    if (
      isDeepStrictEqual(
        item.resource.Properties?.FunctionName,
        attribute(worker.id),
      ) ||
      isDeepStrictEqual(item.resource.Properties?.FunctionName, ref(worker.id))
    )
      fail(
        "WORKER_PUBLIC_PERMISSION",
        item.id,
        "The queue worker cannot have a resource-based invocation grant.",
      );
  }
  const webhookPermissions = ofType("AWS::Lambda::Permission").filter(
    (item) =>
      isDeepStrictEqual(
        item.resource.Properties?.FunctionName,
        attribute(webhook.id),
      ) ||
      isDeepStrictEqual(
        item.resource.Properties?.FunctionName,
        ref(webhook.id),
      ),
  );
  const webhookPermission = one(
    webhookPermissions,
    "Stripe invocation permission",
  );
  const stage = one(
    ofType("AWS::ApiGateway::Stage").filter(
      (item) =>
        item.resource.Properties?.StageName === "beta" &&
        isDeepStrictEqual(item.resource.Properties?.RestApiId, ref(rest?.id)),
    ),
    "beta REST stage",
  );
  const expectedSourceArn = {
    "Fn::Join": [
      "",
      [
        "arn:",
        ref("AWS::Partition"),
        ":execute-api:us-east-1:000000000000:",
        ref(rest?.id),
        "/",
        ref(stage?.id),
        "/POST/webhooks/stripe",
      ],
    ],
  };
  if (
    !stage ||
    !webhookPermission ||
    !isDeepStrictEqual(webhookPermission.resource.Properties, {
      Action: "lambda:InvokeFunction",
      FunctionName: attribute(webhook.id),
      Principal: "apigateway.amazonaws.com",
      SourceArn: expectedSourceArn,
    })
  )
    fail(
      "WEBHOOK_PERMISSION",
      webhook.id,
      "Ingress invocation must be limited to the exact REST API POST route.",
    );

  for (const item of [webhook, worker]) {
    if (!hasOwnedRuntimeLogGroup(stacks, item))
      fail(
        "LOG_BINDING",
        item.id,
        "Runtime logging must target its exact owned observability log group.",
      );
  }

  findings.push(...validateSandboxAlarms(resources));
  findings.push(...validateSandboxAssets([webhook, worker], assets));
  return findings;
}

function validateBrowserSessionIngress(resources, profile) {
  const owned = resources.filter((item) => item.stack === applicationStack);
  const findOne = (items) =>
    items.length === 1 && items[0].resource.Condition === undefined
      ? items[0]
      : undefined;
  const rest = findOne(
    owned.filter(
      (item) =>
        item.resource.Type === "AWS::ApiGateway::RestApi" &&
        item.resource.Properties?.Name === "cloudmarkup-beta-api",
    ),
  );
  const api = findOne(
    owned.filter(
      (item) =>
        item.resource.Type === "AWS::Lambda::Function" &&
        item.resource.Properties?.FunctionName === "cloudmarkup-beta-api",
    ),
  );
  const routeResources = owned.filter(
    (item) =>
      item.resource.Type === "AWS::ApiGateway::Resource" &&
      isDeepStrictEqual(item.resource.Properties?.RestApiId, ref(rest?.id)),
  );
  const child = (parent, part) =>
    findOne(
      routeResources.filter(
        (item) =>
          item.resource.Properties.PathPart === part &&
          isDeepStrictEqual(item.resource.Properties.ParentId, parent),
      ),
    );
  const auth = child(attribute(rest?.id, "RootResourceId"), "auth");
  const session = child(ref(auth?.id), "session");
  const version = child(ref(session?.id), "v1");
  const operations = ["cancel", "exchange", "logout", "restore"].map((name) =>
    child(ref(version?.id), name),
  );
  const expected = [auth, session, version, ...operations];
  const descendantIds = new Set(auth === undefined ? [] : [auth.id]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const item of routeResources) {
      if (
        !descendantIds.has(item.id) &&
        descendantIds.has(item.resource.Properties.ParentId?.Ref)
      ) {
        descendantIds.add(item.id);
        expanded = true;
      }
    }
  }
  const methods = owned.filter(
    (item) =>
      item.resource.Type === "AWS::ApiGateway::Method" &&
      descendantIds.has(item.resource.Properties?.ResourceId?.Ref),
  );
  const integration = {
    IntegrationHttpMethod: "POST",
    Type: "AWS_PROXY",
    TimeoutInMillis:
      profile.profile === "core-v1"
        ? 15000
        : [BETA_CLOUDFORMATION_PROFILE, BETA_LIVE_PROFILE].includes(
              profile.profile,
            )
          ? 29000
          : 25000,
    Uri: {
      "Fn::Join": [
        "",
        [
          "arn:",
          ref("AWS::Partition"),
          ":apigateway:us-east-1:lambda:path/2015-03-31/functions/",
          attribute(api?.id),
          "/invocations",
        ],
      ],
    },
  };
  const valid =
    rest &&
    api &&
    expected.every(Boolean) &&
    descendantIds.size === expected.length &&
    methods.length === 4 &&
    operations.every((operation) => {
      const method = findOne(
        methods.filter((item) =>
          isDeepStrictEqual(
            item.resource.Properties?.ResourceId,
            ref(operation?.id),
          ),
        ),
      );
      return (
        method &&
        isDeepStrictEqual(method.resource.Properties, {
          AuthorizationType: "NONE",
          HttpMethod: "POST",
          Integration: integration,
          ResourceId: ref(operation.id),
          RestApiId: ref(rest.id),
        })
      );
    });
  return valid
    ? []
    : [
        {
          code: "BETA_SANDBOX_BROWSER_SESSION_INGRESS",
          path: "/auth/session/v1",
          detail:
            "Browser sessions require exactly four unconditional same-origin POST routes to the API handler, without extra methods, proxy routes, or altered integrations.",
        },
      ];
}

function validateInvocationSurfaces(resources, profile, cleanup) {
  const findings = [];
  const named = (type, key, value) =>
    resources.find(
      (item) =>
        item.stack === applicationStack &&
        item.resource.Type === type &&
        item.resource.Properties?.[key] === value,
    );
  const api = named(
    "AWS::Lambda::Function",
    "FunctionName",
    "cloudmarkup-beta-api",
  );
  const migrator = named(
    "AWS::Lambda::Function",
    "FunctionName",
    "cloudmarkup-beta-database-migrator",
  );
  const webhook = named(
    "AWS::Lambda::Function",
    "FunctionName",
    sandboxWebhookName,
  );
  const rest = named(
    "AWS::ApiGateway::RestApi",
    "Name",
    "cloudmarkup-beta-api",
  );
  const stages = resources.filter(
    (item) =>
      item.stack === applicationStack &&
      item.resource.Type === "AWS::ApiGateway::Stage" &&
      item.resource.Properties?.StageName === "beta" &&
      isDeepStrictEqual(item.resource.Properties?.RestApiId, ref(rest?.id)),
  );
  const stage = stages.length === 1 ? stages[0] : undefined;
  const apiPaths = [
    "/*/v1",
    "/*/v1/*",
    "/GET/health",
    "/GET/ready",
    "/GET/openapi/v1.json",
    "/GET/runtime-config",
    "/POST/auth/session/v1/cancel",
    "/POST/auth/session/v1/exchange",
    "/POST/auth/session/v1/logout",
    "/POST/auth/session/v1/restore",
    "/GET/github/setup",
    "/GET/github/callback",
    "/POST/webhooks/github",
  ];
  const restPermission = (functionId, path) => ({
    Action: "lambda:InvokeFunction",
    FunctionName: attribute(functionId),
    Principal: "apigateway.amazonaws.com",
    SourceArn: {
      "Fn::Join": [
        "",
        [
          "arn:",
          ref("AWS::Partition"),
          ":execute-api:us-east-1:000000000000:",
          ref(rest?.id),
          "/",
          ref(stage?.id),
          path,
        ],
      ],
    },
  });
  const allowed = [
    ...(cleanup
      ? [
          {
            Action: "lambda:InvokeFunction",
            FunctionName: attribute(cleanup.id),
            Principal: "events.amazonaws.com",
            SourceAccount: "000000000000",
            SourceArn: cleanupScheduleArn,
          },
        ]
      : []),
    ...(api && rest && stage
      ? apiPaths.map((path) => restPermission(api.id, path))
      : []),
    ...(profile.profile !== "core-v1" && webhook && rest && stage
      ? [restPermission(webhook.id, "/POST/webhooks/stripe")]
      : []),
    ...(migrator
      ? [
          {
            Action: "lambda:InvokeFunction",
            FunctionName: attribute(migrator.id),
            Principal: "cloudformation.amazonaws.com",
            SourceAccount: "000000000000",
            SourceArn: {
              "Fn::Join": [
                "",
                [
                  "arn:",
                  ref("AWS::Partition"),
                  ":cloudformation:us-east-1:000000000000:stack/cloudmarkup-beta-application/*",
                ],
              ],
            },
          },
        ]
      : []),
  ];
  const seen = new Set();
  for (const item of resources) {
    if (item.resource.Type === "AWS::Lambda::Url") {
      findings.push({
        code: "BETA_SANDBOX_ALTERNATE_INGRESS",
        path: item.id,
        detail:
          "A Lambda Function URL is not part of any reviewed beta profile.",
      });
    }
    if (item.resource.Type !== "AWS::Lambda::Permission") continue;
    const index = allowed.findIndex((value) =>
      isDeepStrictEqual(value, item.resource.Properties),
    );
    if (
      item.stack !== applicationStack ||
      item.resource.Condition !== undefined ||
      index < 0 ||
      seen.has(index)
    )
      findings.push({
        code: "BETA_SANDBOX_INVOCATION_PERMISSION",
        path: item.id,
        detail:
          "Only exact, unique REST route or stack-bound migrator invocation permissions are admitted.",
      });
    seen.add(index);
  }
  return findings;
}

function validateSandboxAlarms(resources) {
  const findings = [];
  const expected = [
    [
      "AWS/Lambda",
      "Errors",
      [{ Name: "FunctionName", Value: sandboxWorkerName }],
      1,
      "Sum",
    ],
    [
      "AWS/Lambda",
      "Throttles",
      [{ Name: "FunctionName", Value: sandboxWorkerName }],
      1,
      "Sum",
    ],
    [
      "AWS/Lambda",
      "Errors",
      [{ Name: "FunctionName", Value: sandboxWebhookName }],
      1,
      "Sum",
    ],
    [
      "AWS/SQS",
      "ApproximateAgeOfOldestMessage",
      [{ Name: "QueueName", Value: sandboxQueueName }],
      300,
      "Maximum",
    ],
    [
      "AWS/SQS",
      "ApproximateNumberOfMessagesVisible",
      [{ Name: "QueueName", Value: sandboxQueueName }],
      10,
      "Maximum",
    ],
    [
      "AWS/SQS",
      "ApproximateNumberOfMessagesVisible",
      [{ Name: "QueueName", Value: sandboxDlqName }],
      1,
      "Maximum",
    ],
    ["CloudMarkup/BetaBilling", "DeliveryBatchRetries", undefined, 1, "Sum"],
  ];
  for (const [namespace, name, dimensions, threshold, statistic] of expected) {
    const matches = resources.filter(
      (item) =>
        item.resource.Type === "AWS::CloudWatch::Alarm" &&
        item.resource.Properties?.Namespace === namespace &&
        item.resource.Properties?.MetricName === name &&
        isDeepStrictEqual(item.resource.Properties?.Dimensions, dimensions),
    );
    const item = matches[0];
    const p = item?.resource.Properties ?? {};
    if (
      matches.length !== 1 ||
      item.stack !== observabilityStack ||
      item.resource.Condition !== undefined ||
      p.Threshold !== threshold ||
      p.Statistic !== statistic ||
      p.Period !== 300 ||
      p.EvaluationPeriods !== 1 ||
      p.ComparisonOperator !== "GreaterThanOrEqualToThreshold" ||
      p.TreatMissingData !== "notBreaching" ||
      p.ActionsEnabled === false ||
      !isDeepStrictEqual(p.AlarmActions, [
        { "Fn::ImportValue": "cloudmarkup-beta-bootstrap:AlarmTopicArn" },
      ])
    )
      findings.push({
        code: "BETA_SANDBOX_ALARM_BINDING",
        path: name,
        detail:
          "The exact enabled metric alarm must target the owned notification topic.",
      });
  }
  const logs = resources.filter(
    (item) =>
      item.stack === observabilityStack &&
      item.resource.Type === "AWS::Logs::LogGroup" &&
      item.resource.Properties?.LogGroupName ===
        "/aws/lambda/" + sandboxWorkerName,
  );
  const filters = resources.filter(
    (item) =>
      item.stack === observabilityStack &&
      item.resource.Type === "AWS::Logs::MetricFilter" &&
      isDeepStrictEqual(item.resource.Properties?.MetricTransformations, [
        {
          MetricName: "DeliveryBatchRetries",
          MetricNamespace: "CloudMarkup/BetaBilling",
          MetricValue: "1",
        },
      ]),
  );
  if (
    logs.length !== 1 ||
    filters.length !== 1 ||
    !isDeepStrictEqual(
      filters[0]?.resource.Properties?.LogGroupName,
      ref(logs[0]?.id),
    ) ||
    filters[0]?.resource.Properties?.FilterPattern !==
      '{ $.component = "billing-worker" && $.outcome = "batch-retry" }'
  )
    findings.push({
      code: "BETA_SANDBOX_RETRY_SIGNAL",
      path: sandboxWorkerName,
      detail:
        "Partial-batch retries require their exact content-free worker log signal.",
    });
  return findings;
}

function validateSandboxAssets(functions, assets) {
  const findings = [];
  for (const item of functions) {
    const worker = item.resource.Properties.FunctionName === sandboxWorkerName;
    const code = item.resource.Properties.Code;
    const id =
      typeof code?.S3Key === "string"
        ? /^assets\/([0-9a-f]{64})\.zip$/u.exec(code.S3Key)?.[1]
        : undefined;
    const matches = assets.filter((asset) => asset.id === id);
    const asset = matches[0];
    const text = (asset?.files ?? [])
      .filter((file) => file.path.endsWith(".js"))
      .map((file) => file.text ?? "")
      .join("\n");
    const markers = worker
      ? [
          "createProductionBillingWebhookWorker",
          "createDurableBillingWebhookProcessor",
          "createBillingWebhookQueueHandler",
          "StripeBillingProvider",
          "RdsDataApiDatabase",
          "queued-events-only",
          "batch-retry",
        ]
      : [
          "createBillingWebhookHandler",
          "parseStripeBillingWebhookDelivery",
          "createHmac",
          "SendMessageCommand",
          "AWSCURRENT",
        ];
    if (
      !exactKeys(code, ["S3Bucket", "S3Key"]) ||
      code.S3Bucket !== sandboxAssetBucket ||
      id === undefined ||
      matches.length !== 1 ||
      asset?.fingerprint !== id ||
      asset?.packaging !== "zip" ||
      asset?.displayName !==
        "SandboxBillingDelivery/" +
          (worker ? "WorkerFunction" : "WebhookFunction") +
          "/Code" ||
      !markers.every((marker) => text.includes(marker)) ||
      /(?:unavailableApplication|InMemoryCloudMarkupApplication|local-development|testing\/in-memory-adapters)/u.test(
        text,
      )
    )
      findings.push({
        code: "BETA_SANDBOX_ASSET_BINDING",
        path: item.id,
        detail:
          "The exact content-addressed deployed asset must contain its reviewed real runtime composition.",
      });
    const eventArrays = [
      ...text.matchAll(
        /(?:var|let|const) BILLING_WEBHOOK_EVENT_TYPES\s*=\s*(\[[\s\S]*?\]);/gu,
      ),
    ];
    let validEvents = false;
    try {
      validEvents =
        eventArrays.length === 1 &&
        isDeepStrictEqual(
          JSON.parse(eventArrays[0][1].replace(/,\s*\]/gu, "]")),
          SANDBOX_BILLING_EVENT_TYPES,
        );
    } catch {
      /* Invalid or unsupported compiled event constants fail closed. */
    }
    if (!validEvents)
      findings.push({
        code: "BETA_SANDBOX_EVENT_SET",
        path: item.id,
        detail:
          "The actual ingress and worker bundles must carry exactly the reviewed subscription and credit-purchase event allowlist.",
      });
  }
  return findings;
}
