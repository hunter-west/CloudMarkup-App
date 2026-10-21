import { fileURLToPath } from "node:url";
import { Stack, Tags, aws_logs as logs } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { BETA_CDK_BOOTSTRAP } from "../lib/beta-deployment-bootstrap.js";
import {
  defineEnvironmentConfig,
  type EnvironmentConfig,
} from "../lib/config/environment-config.js";
import { createBetaEnvironmentConfig } from "../lib/config/environments/beta.js";
import { SandboxBillingDelivery } from "../lib/constructs/sandbox-billing-delivery.js";
import { CloudMarkupStage } from "../lib/stages/cloudmarkup-stage.js";
import { createTemplateTestApp } from "./template-test-app.js";

const apiKeyArn =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/api-key-EX0004";
// Synthetic signing references are synthesis fixtures, never activation values.
const signingArn =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-secret-a1b2c3";
const previousArn =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-previous-d4e5f6";
function importedRoleArn(roleName: string) {
  return {
    "Fn::Join": [
      "",
      [
        "arn:",
        { Ref: "AWS::Partition" },
        `:iam::000000000000:role/${roleName}`,
      ],
    ],
  };
}
function resourceProperties(
  resource: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const value = resource["Properties"];
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Expected resource properties.");
  return value as Readonly<Record<string, unknown>>;
}
function beta(): EnvironmentConfig {
  return createBetaEnvironmentConfig({
    domain: {
      certificateArn:
        "arn:aws:acm:us-east-1:000000000000:certificate/11111111-2222-3333-4444-555555555555",
      createDnsRecords: false,
      domainName: "beta.example.invalid",
    },
    target: { account: "000000000000", region: "us-east-1" },
  });
}
function enabled(
  sessionsEnabled = false,
  githubConnections = false,
  cloudFormationExports = false,
): EnvironmentConfig {
  const base = beta();
  if (base.domain === undefined)
    throw new TypeError("Expected beta domain fixture.");
  return createBetaEnvironmentConfig({
    domain: base.domain,
    target: base.target,
    service: {
      profile: cloudFormationExports
        ? "stripe-sandbox-github-cloudformation-v1"
        : githubConnections
          ? "stripe-sandbox-github-connections-v1"
          : "stripe-sandbox-v1",
      sessionsEnabled,
      signingArn,
      previousArn: "",
    },
  });
}
const liveSigningArn =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/webhook-signing-secret-EX0005";
function live(sessionsEnabled = true): EnvironmentConfig {
  const base = beta();
  if (!base.domain) throw Error("fixture");
  return createBetaEnvironmentConfig({
    domain: base.domain,
    target: base.target,
    service: {
      profile: "stripe-live-github-cloudformation-v1",
      sessionsEnabled,
      signingArn: liveSigningArn,
      previousArn: "",
    },
  });
}
function templates(config: EnvironmentConfig) {
  const stage = new CloudMarkupStage(
    createTemplateTestApp(),
    "SandboxBillingFixture",
    {
      config: defineEnvironmentConfig(config),
      webAssetsPath: fileURLToPath(
        new URL("fixtures/web-dist/", import.meta.url),
      ),
    },
  );
  return {
    application: Template.fromStack(stage.application),
    observability: Template.fromStack(stage.observability),
    stateful: Template.fromStack(stage.stateful),
    edge: Template.fromStack(stage.edge),
  };
}

interface AdmissionFinding {
  readonly code: string;
  readonly path: string;
  readonly detail: string;
}
async function admissionModule() {
  const path = new URL(
    "../../../scripts/beta-sandbox-delivery-admission.mjs",
    import.meta.url,
  ).href;
  return (await import(path)) as {
    validateBetaSandboxDelivery: (
      stacks: readonly unknown[],
      profile: unknown,
      assets?: readonly unknown[],
    ) => readonly AdmissionFinding[];
  };
}

interface MutableResource {
  Type: string;
  Properties: Record<string, unknown>;
  Condition?: string;
  DependsOn?: string[];
}
interface AdmissionStack {
  stackName: string;
  template: {
    Resources: Record<string, MutableResource>;
    Outputs?: Record<string, unknown>;
  };
}
interface FixtureAsset {
  id: string;
  fingerprint: string;
  packaging: string;
  displayName: string;
  files: { path: string; text: string }[];
}
function fixtureAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new TypeError("Missing bounded fixture item.");
  return value;
}
function mutableObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Expected a fixture object.");
  return value as Record<string, unknown>;
}
function resource(
  stacks: readonly AdmissionStack[],
  type: string,
  key?: string,
  value?: string,
): MutableResource {
  const found = stacks
    .flatMap((stack) => Object.values(stack.template.Resources))
    .find(
      (item) =>
        item.Type === type &&
        (key === undefined || item.Properties[key] === value),
    );
  if (found === undefined)
    throw new TypeError(
      "Missing fixture resource: " + type + " " + (value ?? ""),
    );
  return found;
}
function lambda(
  stacks: readonly AdmissionStack[],
  suffix: string,
): MutableResource {
  return resource(
    stacks,
    "AWS::Lambda::Function",
    "FunctionName",
    "cloudmarkup-beta-" + suffix,
  );
}
function env(
  stacks: readonly AdmissionStack[],
  suffix: string,
): Record<string, unknown> {
  return mutableObject(
    mutableObject(lambda(stacks, suffix).Properties["Environment"])[
      "Variables"
    ],
  );
}
function fixtureAssets(stacks: readonly AdmissionStack[]): FixtureAsset[] {
  // Deliberately synthetic bundle strings test the validator, not deployed-code
  // provenance. Real content-addressed bundle admission remains a release gate.
  return ["billing-webhook", "billing-worker"].map((suffix, index) => {
    const id = (index === 0 ? "a" : "b").repeat(64);
    lambda(stacks, suffix).Properties["Code"] = {
      S3Bucket: "cloudmarkup-beta-cdk-assets-000000000000-us-east-1",
      S3Key: "assets/" + id + ".zip",
    };
    return {
      id,
      fingerprint: id,
      packaging: "zip",
      displayName:
        "SandboxBillingDelivery/" +
        (index === 0 ? "WebhookFunction" : "WorkerFunction") +
        "/Code",
      files: [
        {
          path: "index.js",
          text: [
            "createBillingWebhookHandler parseStripeBillingWebhookDelivery createHmac SendMessageCommand AWSCURRENT",
            "createProductionBillingWebhookWorker createDurableBillingWebhookProcessor createBillingWebhookQueueHandler StripeBillingProvider RdsDataApiDatabase queued-events-only batch-retry",
            'var BILLING_WEBHOOK_EVENT_TYPES = ["checkout.session.completed","checkout.session.async_payment_succeeded","checkout.session.async_payment_failed","checkout.session.expired","charge.refunded","charge.dispute.created","charge.dispute.closed","customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","invoice.paid","invoice.payment_failed","invoice.payment_action_required"];',
          ].join("\n"),
        },
      ],
    };
  });
}

describe("isolated sandbox delivery composition", { timeout: 30000 }, () => {
  it.each([false, true])(
    "fits the complete checkout/export API environment within Lambda's 4 KiB budget with live=%s",
    (useLive) => {
      const result = templates(useLive ? live() : enabled(true, true, true));
      const stacks = Object.entries(result).map(([name, template]) => ({
        stackName: "cloudmarkup-beta-" + name,
        template: template.toJSON() as AdmissionStack["template"],
      }));
      // Synthetic identifiers with the deployed beta resource shapes. Unknown
      // substitutions fail rather than silently undercounting the byte budget.
      const substitutions: Record<string, string> = {
        UsersWebClient8EE36D42: "a".repeat(26),
        Users0A0EEA89: "us-east-1_123456789",
        UsersHostedDomain328CC301: "cloudmarkup-beta-000000000000",
        "Users0A0EEA89.ProviderURL":
          "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_123456789",
        "BetaProposalsQueueE940A90C.Arn":
          "arn:aws:sqs:us-east-1:000000000000:cloudmarkup-beta-proposals.fifo",
        "SolutionExportQueue1F51E52E.Arn":
          "arn:aws:sqs:us-east-1:000000000000:cloudmarkup-beta-solution-exports.fifo",
        SolutionExportQueue1F51E52E:
          "https://sqs.us-east-1.amazonaws.com/000000000000/cloudmarkup-beta-solution-exports.fifo",
        "cloudmarkup-beta-stateful:ExportsOutputRefVersionedContent168574875993E640":
          "cloudmarkup-beta-000000000000-us-east-1-content",
        "cloudmarkup-beta-stateful:ExportsOutputFnGetAttPostgresqlDBClusterArnA8BE74B8":
          "arn:aws:rds:us-east-1:000000000000:cluster:cloudmarkup-beta-postgresql",
        "cloudmarkup-beta-stateful:ExportsOutputRefDatabaseAdminEC85AE424E64CF20":
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup-beta/database/admin-a1b2c3",
        "cloudmarkup-beta-stateful:ExportsOutputRefEdgeOriginVerificationA9C7DB30FFA838A4":
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup-beta/edge-origin-verification-a1b2c3",
      };
      function resolve(value: unknown): string {
        if (typeof value === "string") return value;
        const object = mutableObject(value);
        const join = object["Fn::Join"];
        if (
          Array.isArray(join) &&
          typeof join[0] === "string" &&
          Array.isArray(join[1])
        ) {
          const resolved = join[1].map(resolve).join(join[0]);
          // The generated origin marker has an independently enforced length of 64.
          return resolved.startsWith("{{resolve:secretsmanager:")
            ? "x".repeat(64)
            : resolved;
        }
        const getAtt = object["Fn::GetAtt"];
        const key = Array.isArray(getAtt)
          ? getAtt.join(".")
          : (object["Ref"] ?? object["Fn::ImportValue"]);
        if (typeof key !== "string" || substitutions[key] === undefined)
          throw new Error("Unknown environment substitution: " + String(key));
        return substitutions[key];
      }
      const variables = env(stacks, "api");
      expect(
        Object.keys(variables).filter((key) =>
          key.startsWith("CLOUDMARKUP_FEATURE_"),
        ),
      ).toEqual([]);
      const resolved = Object.fromEntries(
        Object.entries(variables).map(([key, value]) => [key, resolve(value)]),
      );
      // AWS measures the serialized environment map, including JSON overhead.
      const bytes = Buffer.byteLength(JSON.stringify(resolved));
      expect(bytes).toBeLessThanOrEqual(4096);
      const oldMetadata = Object.fromEntries(
        Object.entries(enabled(true, true, true).features).map(
          ([name, value]) => [
            "CLOUDMARKUP_FEATURE_" +
              name.replaceAll(/([A-Z])/gu, "_$1").toUpperCase(),
            String(value),
          ],
        ),
      );
      const oldBytes = Buffer.byteLength(
        JSON.stringify({ ...resolved, ...oldMetadata }),
      );
      expect(oldBytes).toBeGreaterThan(4096);
    },
    120000,
  );

  it.each([false, true])(
    "admits export and sandbox checkout with sessions=%s",
    async (sessionsEnabled) => {
      const result = templates(enabled(sessionsEnabled, true, true));
      const stacks = Object.entries(result).map(([name, template]) => ({
        stackName: "cloudmarkup-beta-" + name,
        template: template.toJSON() as AdmissionStack["template"],
      }));
      const profile = {
        contractVersion: 1,
        profile: "stripe-sandbox-github-cloudformation-v1",
        sessionsEnabled,
        signingArn,
        previousArn: "",
      };
      const { validateBetaSandboxDelivery } = await admissionModule();
      const assets = fixtureAssets(stacks);
      expect(validateBetaSandboxDelivery(stacks, profile, assets)).toEqual([]);
      for (const [property, value] of [
        ["Timeout", 900],
        ["ReservedConcurrentExecutions", 10],
        ["Role", "arn:aws:iam::000000000000:role/unreviewed-role"],
        ["Layers", ["unreviewed-layer"]],
      ] as const) {
        const changed = structuredClone(stacks);
        const proposal = changed
          .flatMap((stack) => Object.values(stack.template.Resources))
          .find(
            (resource) =>
              resource.Properties["FunctionName"] ===
              "cloudmarkup-beta-proposal-worker",
          );
        if (!proposal?.Properties) throw new Error("Expected proposal worker.");
        proposal.Properties[property] = value;
        expect(
          validateBetaSandboxDelivery(changed, profile, assets).map(
            ({ code }) => code,
          ),
        ).toContain("BETA_PROPOSAL_DELIVERY_INVALID");
      }
      const wrongQueue = structuredClone(stacks);
      env(wrongQueue, "api")["CLOUDMARKUP_BETA_PROPOSAL_QUEUE_URL"] =
        "https://sqs.us-east-1.amazonaws.com/000000000000/unreviewed";
      expect(
        validateBetaSandboxDelivery(wrongQueue, profile, assets).map(
          ({ code }) => code,
        ),
      ).toContain("BETA_PROPOSAL_DELIVERY_INVALID");

      expect(env(stacks, "api")["CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED"]).toBe(
        "true",
      );
      expect(env(stacks, "api")["CLOUDMARKUP_BILLING_SESSIONS_ENABLED"]).toBe(
        sessionsEnabled ? "true" : undefined,
      );
      for (const suffix of ["api", "billing-webhook", "billing-worker"])
        expect(
          env(stacks, suffix)["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"],
        ).toBe("cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4");
      if (sessionsEnabled) {
        const changed = structuredClone(stacks);
        delete env(changed, "api")["CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN"];
        expect(
          validateBetaSandboxDelivery(changed, profile, assets).map(
            ({ code }) => code,
          ),
        ).toContain("BETA_SANDBOX_SESSION_CONFIGURATION");
      }
    },
    120000,
  );
  it("propagates one exact legacy mapping to API, ingress and worker while new config remains unadmitted", async () => {
    const { validateBetaSandboxDelivery } = await admissionModule();
    const config = enabled();
    expect(config.integrations.stripe.planMappingVersion).toBe(
      "cloudmarkup-starter-pro-mapping-2026-08-28-v1",
    );
    const result = templates(config);
    const stacks = Object.entries(result).map(([name, template]) => ({
      stackName: "cloudmarkup-beta-" + name,
      template: template.toJSON() as AdmissionStack["template"],
    }));
    const assets = fixtureAssets(stacks);
    const profile = {
      contractVersion: 1,
      profile: "stripe-sandbox-v1",
      sessionsEnabled: false,
      signingArn,
      previousArn: "",
    };
    expect(validateBetaSandboxDelivery(stacks, profile, assets)).toEqual([]);
    for (const suffix of ["api", "billing-webhook", "billing-worker"]) {
      expect(
        env(stacks, suffix)["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"],
      ).toBe("cloudmarkup-starter-pro-mapping-2026-08-28-v1");
    }
    const nextVersion = "cloudmarkup-starter-pro-sharing-mapping-2026-09-07-v2";
    expect(
      defineEnvironmentConfig({
        ...config,
        integrations: {
          ...config.integrations,
          stripe: {
            ...config.integrations.stripe,
            planMappingVersion: nextVersion,
          },
        },
      }).integrations.stripe.planMappingVersion,
    ).toBe(nextVersion);
    for (const suffix of ["billing-webhook", "billing-worker"]) {
      const changed = structuredClone(stacks);
      env(changed, suffix)["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"] =
        nextVersion;
      expect(
        validateBetaSandboxDelivery(changed, profile, assets).map(
          ({ code }) => code,
        ),
      ).toContain("BETA_SANDBOX_RUNTIME_CONFIGURATION");
    }
    const missing = structuredClone(stacks);
    delete env(missing, "billing-worker")[
      "CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"
    ];
    expect(
      validateBetaSandboxDelivery(missing, profile, assets).map(
        ({ code }) => code,
      ),
    ).toContain("BETA_SANDBOX_RUNTIME_CONFIGURATION");
    for (const replacement of [undefined, "unknown-mapping-v1", nextVersion]) {
      const changed = structuredClone(stacks);
      if (replacement === undefined)
        delete env(changed, "api")["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"];
      else
        env(changed, "api")["CLOUDMARKUP_BILLING_PLAN_MAPPING_VERSION"] =
          replacement;
      expect(
        validateBetaSandboxDelivery(changed, profile, assets).map(
          ({ code }) => code,
        ),
      ).toContain("BETA_SANDBOX_API_MAPPING_CONFIGURATION");
    }
  });
  it(
    "admits the combined connection profile on actual stage templates without changing sandbox isolation",
    { timeout: 120_000 },
    async () => {
      const result = templates(enabled(false, true));
      const stacks = Object.entries(result).map(([name, template]) => ({
        stackName: "cloudmarkup-beta-" + name,
        template: template.toJSON() as AdmissionStack["template"],
      }));
      const assets = fixtureAssets(stacks);
      const profile = {
        contractVersion: 1,
        profile: "stripe-sandbox-github-connections-v1",
        sessionsEnabled: false,
        signingArn,
        previousArn: "",
      };
      const { validateBetaSandboxDelivery } = await admissionModule();
      expect(validateBetaSandboxDelivery(stacks, profile, assets)).toEqual([]);
      expect(
        validateBetaSandboxDelivery(
          stacks,
          { ...profile, profile: "stripe-sandbox-v1" },
          assets,
        ).map(({ code }) => code),
      ).toContain("BETA_SANDBOX_GITHUB_CONNECTION_CONFIGURATION");
      env(stacks, "api")["CLOUDMARKUP_GITHUB_CLIENT_SECRET_ARN"] = env(
        stacks,
        "api",
      )["CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_ARN"];
      expect(
        validateBetaSandboxDelivery(stacks, profile, assets).map(
          ({ code }) => code,
        ),
      ).toContain("BETA_SANDBOX_GITHUB_CONNECTION_CONFIGURATION");
    },
  );
  it("rejects a bounded mutation matrix against actual stage templates and synthetic validator bundles", async () => {
    const result = templates(enabled(true));
    const original = Object.entries(result).map(([name, template]) => ({
      stackName: "cloudmarkup-beta-" + name,
      template: template.toJSON() as AdmissionStack["template"],
    }));
    const originalAssets = fixtureAssets(original);
    const profile = {
      contractVersion: 1,
      profile: "stripe-sandbox-v1",
      sessionsEnabled: true,
      signingArn,
      previousArn: "",
    };
    const { validateBetaSandboxDelivery } = await admissionModule();
    expect(
      validateBetaSandboxDelivery(original, profile, originalAssets),
    ).toEqual([]);
    const queue = (stacks: readonly AdmissionStack[]) =>
      resource(
        stacks,
        "AWS::SQS::Queue",
        "QueueName",
        "cloudmarkup-beta-billing-webhook.fifo",
      );
    const mapping = (stacks: readonly AdmissionStack[]) =>
      resource(stacks, "AWS::Lambda::EventSourceMapping");
    const browserMethod = (stacks: readonly AdmissionStack[]) => {
      const resources = stacks.flatMap((stack) =>
        Object.entries(stack.template.Resources),
      );
      const restore = resources.find(
        ([, item]) =>
          item.Type === "AWS::ApiGateway::Resource" &&
          item.Properties["PathPart"] === "restore",
      );
      if (restore === undefined)
        throw new TypeError("Restore fixture missing.");
      const method = resources.find(
        ([, item]) =>
          item.Type === "AWS::ApiGateway::Method" &&
          mutableObject(item.Properties["ResourceId"])["Ref"] === restore[0],
      )?.[1];
      if (method === undefined)
        throw new TypeError("Restore POST fixture missing.");
      return method;
    };
    const mutations: readonly [
      string,
      string,
      (stacks: AdmissionStack[], assets: FixtureAsset[]) => void,
    ][] = [
      [
        "cleanup runtime disabled independently",
        "UNREVIEWED_RUNTIME",
        (stacks) => {
          env(stacks, "project-content-cleanup")[
            "CLOUDMARKUP_PROJECT_CLEANUP_ENABLED"
          ] = "false";
        },
      ],
      [
        "cleanup schedule disabled independently",
        "UNREVIEWED_RUNTIME",
        (stacks) => {
          resource(
            stacks,
            "AWS::Events::Rule",
            "Name",
            "cloudmarkup-beta-project-content-cleanup",
          ).Properties["State"] = "DISABLED";
        },
      ],
      [
        "cleanup role replaced",
        "UNREVIEWED_RUNTIME",
        (stacks) => {
          lambda(stacks, "project-content-cleanup").Properties["Role"] =
            importedRoleArn(BETA_CDK_BOOTSTRAP.apiRuntimeRoleName);
        },
      ],
      [
        "cleanup migration dependency removed",
        "UNREVIEWED_RUNTIME",
        (stacks) => {
          lambda(stacks, "project-content-cleanup").DependsOn = [];
        },
      ],
      [
        "cleanup external runtime layer",
        "UNREVIEWED_RUNTIME",
        (stacks) => {
          lambda(stacks, "project-content-cleanup").Properties["Layers"] = [
            "arn:aws:lambda:us-east-1:123456789012:layer:unreviewed:1",
          ];
        },
      ],
      [
        "cleanup network attachment",
        "UNREVIEWED_RUNTIME",
        (stacks) => {
          lambda(stacks, "project-content-cleanup").Properties["VpcConfig"] = {
            SubnetIds: ["subnet-1234abcd"],
            SecurityGroupIds: ["sg-1234abcd"],
          };
        },
      ],
      [
        "cleanup log destination",
        "UNREVIEWED_RUNTIME",
        (stacks) => {
          lambda(stacks, "project-content-cleanup").Properties[
            "LoggingConfig"
          ] = {
            LogGroup: "another",
          };
        },
      ],
      [
        "Lambda URL",
        "ALTERNATE_INGRESS",
        (stacks) => {
          fixtureAt(stacks, 0).template.Resources["FunctionUrl"] = {
            Type: "AWS::Lambda::Url",
            Properties: { AuthType: "NONE" },
          };
        },
      ],
      [
        "arbitrary invoke grant",
        "INVOCATION_PERMISSION",
        (stacks) => {
          fixtureAt(stacks, 0).template.Resources["PublicInvoke"] = {
            Type: "AWS::Lambda::Permission",
            Properties: {
              Action: "lambda:InvokeFunction",
              FunctionName: "cloudmarkup-beta-api",
              Principal: "*",
            },
          };
        },
      ],
      [
        "extra queue",
        "RESOURCE_SET",
        (stacks) => {
          fixtureAt(stacks, 0).template.Resources["ExtraQueue"] =
            structuredClone(queue(stacks));
        },
      ],
      [
        "extra runtime",
        "UNREVIEWED_RUNTIME",
        (stacks) => {
          fixtureAt(stacks, 0).template.Resources["ExtraRuntime"] = {
            Type: "AWS::Lambda::Function",
            Properties: { FunctionName: "unreviewed" },
          };
        },
      ],
      [
        "renamed queue",
        "RESOURCE_IDENTITY",
        (stacks) => {
          queue(stacks).Properties["QueueName"] = "another.fifo";
        },
      ],
      [
        "disabled encryption",
        "QUEUE_CONFIGURATION",
        (stacks) => {
          queue(stacks).Properties["SqsManagedSseEnabled"] = false;
        },
      ],
      [
        "visibility",
        "QUEUE_CONFIGURATION",
        (stacks) => {
          queue(stacks).Properties["VisibilityTimeout"] = 60;
        },
      ],
      [
        "retry widening",
        "QUEUE_CONFIGURATION",
        (stacks) => {
          mutableObject(queue(stacks).Properties["RedrivePolicy"])[
            "maxReceiveCount"
          ] = 100;
        },
      ],
      [
        "queue grants",
        "QUEUE_POLICY",
        (stacks) => {
          const document = mutableObject(
            resource(stacks, "AWS::SQS::QueuePolicy").Properties[
              "PolicyDocument"
            ],
          );
          document["Statement"] = [
            { Effect: "Allow", Action: "sqs:*", Principal: "*" },
          ];
        },
      ],
      [
        "ownership tags",
        "RESOURCE_TAGS",
        (stacks) => {
          queue(stacks).Properties["Tags"] = [];
        },
      ],
      [
        "mapping tags",
        "CONSUMER_CONFIGURATION",
        (stacks) => {
          mapping(stacks).Properties["Tags"] = [
            { Key: "Environment", Value: "beta" },
          ];
        },
      ],
      [
        "mapping target",
        "CONSUMER_CONFIGURATION",
        (stacks) => {
          mapping(stacks).Properties["FunctionName"] = "another";
        },
      ],
      [
        "mapping queue",
        "CONSUMER_CONFIGURATION",
        (stacks) => {
          mapping(stacks).Properties["EventSourceArn"] = "another";
        },
      ],
      [
        "mapping partial failure",
        "CONSUMER_CONFIGURATION",
        (stacks) => {
          mapping(stacks).Properties["FunctionResponseTypes"] = [];
        },
      ],
      [
        "mapping concurrency",
        "CONSUMER_CONFIGURATION",
        (stacks) => {
          mapping(stacks).Properties["ScalingConfig"] = {
            MaximumConcurrency: 3,
          };
        },
      ],
      [
        "conditional worker",
        "RESOURCE_IDENTITY",
        (stacks) => {
          lambda(stacks, "billing-worker").Condition = "Hidden";
        },
      ],
      [
        "mutable IAM authority",
        "IAM_OWNERSHIP",
        (stacks) => {
          fixtureAt(stacks, 0).template.Resources["Role"] = {
            Type: "AWS::IAM::Role",
            Properties: {},
          };
        },
      ],
      [
        "wrong worker role",
        "RUNTIME_CONFIGURATION",
        (stacks) => {
          lambda(stacks, "billing-worker").Properties["Role"] = importedRoleArn(
            BETA_CDK_BOOTSTRAP.billingWebhookRuntimeRoleName,
          );
        },
      ],
      [
        "worker concurrency",
        "RUNTIME_CONFIGURATION",
        (stacks) => {
          lambda(stacks, "billing-worker").Properties[
            "ReservedConcurrentExecutions"
          ] = 10;
        },
      ],
      [
        "worker timeout",
        "RUNTIME_CONFIGURATION",
        (stacks) => {
          lambda(stacks, "billing-worker").Properties["Timeout"] = 900;
        },
      ],
      [
        "live environment",
        "RUNTIME_CONFIGURATION",
        (stacks) => {
          env(stacks, "billing-worker")["CLOUDMARKUP_STRIPE_ENVIRONMENT"] =
            "live";
        },
      ],
      [
        "webhook API key",
        "RUNTIME_CONFIGURATION",
        (stacks) => {
          env(stacks, "billing-webhook")[
            "CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN"
          ] = apiKeyArn;
        },
      ],
      [
        "worker signing key",
        "RUNTIME_CONFIGURATION",
        (stacks) => {
          env(stacks, "billing-worker")[
            "CLOUDMARKUP_STRIPE_WEBHOOK_SECRET_REFERENCE"
          ] = signingArn;
        },
      ],
      [
        "different signing reference",
        "RUNTIME_CONFIGURATION",
        (stacks) => {
          env(stacks, "billing-webhook")[
            "CLOUDMARKUP_STRIPE_WEBHOOK_SECRET_REFERENCE"
          ] = signingArn.replace("a1b2c3", "d4e5f6");
        },
      ],
      [
        "API signing key",
        "API_SECRET_ISOLATION",
        (stacks) => {
          env(stacks, "api")["CLOUDMARKUP_STRIPE_WEBHOOK_SECRET_REFERENCE"] =
            signingArn;
        },
      ],
      [
        "API session flag",
        "SESSION_CONFIGURATION",
        (stacks) => {
          env(stacks, "api")["CLOUDMARKUP_BILLING_SESSIONS_ENABLED"] = "false";
        },
      ],
      [
        "another provider",
        "GITHUB_CONNECTION_CONFIGURATION",
        (stacks) => {
          env(stacks, "api")["CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED"] = "true";
        },
      ],
      [
        "foreign database",
        "DATABASE_BINDING",
        (stacks) => {
          env(stacks, "api")["CLOUDMARKUP_DATABASE_ARN"] = {
            "Fn::ImportValue": "another",
          };
          env(stacks, "billing-worker")["CLOUDMARKUP_DATABASE_ARN"] = {
            "Fn::ImportValue": "another",
          };
        },
      ],
      [
        "migration fence removed",
        "MIGRATION_DEPENDENCY",
        (stacks) => {
          lambda(stacks, "billing-worker").DependsOn = [];
        },
      ],
      [
        "runtime log reroute",
        "LOG_BINDING",
        (stacks) => {
          lambda(stacks, "billing-worker").Properties["LoggingConfig"] = {
            LogGroup: "another",
          };
        },
      ],
      [
        "session integration altered",
        "BROWSER_SESSION_INGRESS",
        (stacks) => {
          mutableObject(browserMethod(stacks).Properties["Integration"])[
            "Uri"
          ] = "another";
        },
      ],
      [
        "session timeout exceeds the reviewed export bound",
        "BROWSER_SESSION_INGRESS",
        (stacks) => {
          mutableObject(browserMethod(stacks).Properties["Integration"])[
            "TimeoutInMillis"
          ] = 30000;
        },
      ],
      [
        "session GET allowed",
        "BROWSER_SESSION_INGRESS",
        (stacks) => {
          browserMethod(stacks).Properties["HttpMethod"] = "GET";
        },
      ],
      [
        "session method conditional",
        "BROWSER_SESSION_INGRESS",
        (stacks) => {
          browserMethod(stacks).Condition = "Optional";
        },
      ],
      [
        "session proxy route added",
        "BROWSER_SESSION_INGRESS",
        (stacks) => {
          const restore = resource(
            stacks,
            "AWS::ApiGateway::Resource",
            "PathPart",
            "restore",
          );
          fixtureAt(stacks, 0).template.Resources["SessionProxy"] = {
            Type: "AWS::ApiGateway::Resource",
            Properties: {
              ...structuredClone(restore.Properties),
              PathPart: "{proxy+}",
            },
          };
        },
      ],
      [
        "session route renamed",
        "BROWSER_SESSION_INGRESS",
        (stacks) => {
          resource(
            stacks,
            "AWS::ApiGateway::Resource",
            "PathPart",
            "restore",
          ).Properties["PathPart"] = "renew";
        },
      ],
      [
        "POST target altered",
        "INGRESS_BINDING",
        (stacks) => {
          const resources = stacks.flatMap((stack) =>
            Object.entries(stack.template.Resources),
          );
          const stripe = resources.find(
            ([, item]) =>
              item.Type === "AWS::ApiGateway::Resource" &&
              item.Properties["PathPart"] === "stripe",
          );
          if (stripe === undefined)
            throw new TypeError("Stripe resource fixture missing.");
          const method = resources.find(
            ([, item]) =>
              item.Type === "AWS::ApiGateway::Method" &&
              item.Properties["HttpMethod"] === "POST" &&
              mutableObject(item.Properties["ResourceId"])["Ref"] === stripe[0],
          )?.[1];
          if (method === undefined)
            throw new TypeError("Stripe POST fixture missing.");
          mutableObject(method.Properties["Integration"])["Uri"] = "another";
        },
      ],
      [
        "worker public invoke",
        "WORKER_PUBLIC_PERMISSION",
        (stacks) => {
          const entry = Object.entries(
            fixtureAt(stacks, 0).template.Resources,
          ).find(([, item]) => item === lambda(stacks, "billing-worker"));
          fixtureAt(stacks, 0).template.Resources["PublicWorker"] = {
            Type: "AWS::Lambda::Permission",
            Properties: { FunctionName: { Ref: entry?.[0] } },
          };
        },
      ],
      [
        "alarm disabled",
        "ALARM_BINDING",
        (stacks) => {
          const alarm = stacks
            .flatMap((stack) => Object.values(stack.template.Resources))
            .find(
              (item) =>
                item.Type === "AWS::CloudWatch::Alarm" &&
                JSON.stringify(item.Properties["Dimensions"] ?? []).includes(
                  "cloudmarkup-beta-billing-worker",
                ),
            );
          if (alarm === undefined)
            throw new TypeError("Alarm fixture missing.");
          alarm.Properties["ActionsEnabled"] = false;
        },
      ],
      [
        "retry filter absent",
        "RETRY_SIGNAL",
        (stacks) => {
          const filter = resource(
            stacks,
            "AWS::Logs::MetricFilter",
            "FilterPattern",
            '{ $.component = "billing-worker" && $.outcome = "batch-retry" }',
          );
          filter.Properties["FilterPattern"] = "{}";
        },
      ],
      [
        "missing bundle",
        "ASSET_BINDING",
        (_stacks, assets) => {
          assets.pop();
        },
      ],
      [
        "wrong bundle digest",
        "ASSET_BINDING",
        (_stacks, assets) => {
          fixtureAt(assets, 0).fingerprint = "f".repeat(64);
        },
      ],
      [
        "wrong bundle owner",
        "ASSET_BINDING",
        (_stacks, assets) => {
          fixtureAt(assets, 0).displayName = "ApiFunction/Code";
        },
      ],
      [
        "missing real composition",
        "ASSET_BINDING",
        (_stacks, assets) => {
          fixtureAt(fixtureAt(assets, 1).files, 0).text = fixtureAt(
            fixtureAt(assets, 1).files,
            0,
          ).text.replace("StripeBillingProvider", "UnavailableProvider");
        },
      ],
      [
        "local composition",
        "ASSET_BINDING",
        (_stacks, assets) => {
          fixtureAt(fixtureAt(assets, 1).files, 0).text +=
            " InMemoryCloudMarkupApplication";
        },
      ],
      [
        "extra webhook event",
        "EVENT_SET",
        (_stacks, assets) => {
          fixtureAt(fixtureAt(assets, 0).files, 0).text = fixtureAt(
            fixtureAt(assets, 0).files,
            0,
          ).text.replace('"invoice.paid"', '"invoice.paid","customer.created"');
        },
      ],
      [
        "duplicate allowlist",
        "EVENT_SET",
        (_stacks, assets) => {
          fixtureAt(fixtureAt(assets, 0).files, 0).text +=
            "\nvar BILLING_WEBHOOK_EVENT_TYPES = [];";
        },
      ],
    ];
    for (const [name, code, mutate] of mutations) {
      const stacks = structuredClone(original);
      const assets = structuredClone(originalAssets);
      mutate(stacks, assets);
      expect(
        validateBetaSandboxDelivery(stacks, profile, assets).map(
          (finding) => finding.code,
        ),
        name,
      ).toContain("BETA_SANDBOX_" + code);
    }
    expect(
      validateBetaSandboxDelivery(
        original,
        { ...profile, sessionsEnabled: false },
        originalAssets,
      ).map((finding) => finding.code),
    ).toContain("BETA_SANDBOX_SESSION_CONFIGURATION");
    expect(
      validateBetaSandboxDelivery(
        original,
        { ...profile, profile: "core-v1" },
        originalAssets,
      ).map((finding) => finding.code),
    ).toContain("BETA_SANDBOX_CORE_ACTIVATION");
  });
  it("rejects a missing, duplicated or unreviewed payment event in either deployed runtime", async () => {
    const { validateBetaSandboxDelivery } = await admissionModule();
    const result = templates(enabled(true));
    const original = Object.entries(result).map(([name, template]) => ({
      stackName: "cloudmarkup-beta-" + name,
      template: template.toJSON() as AdmissionStack["template"],
    }));
    const originalAssets = fixtureAssets(original);
    const profile = {
      contractVersion: 1,
      profile: "stripe-sandbox-v1",
      sessionsEnabled: true,
      signingArn,
      previousArn: "",
    };
    expect(
      validateBetaSandboxDelivery(original, profile, originalAssets),
    ).toEqual([]);
    for (const assetIndex of [0, 1]) {
      for (const event of [
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
        "charge.refunded",
        "charge.dispute.created",
        "charge.dispute.closed",
      ]) {
        for (const replacement of [
          "",
          JSON.stringify(event) + "," + JSON.stringify(event) + ",",
          '"payment_intent.created",',
        ]) {
          const assets = structuredClone(originalAssets);
          const file = fixtureAt(fixtureAt(assets, assetIndex).files, 0);
          const needle = JSON.stringify(event) + ",";
          expect(file.text).toContain(needle);
          file.text = file.text.replace(needle, replacement);
          const findings = validateBetaSandboxDelivery(
            original,
            profile,
            assets,
          );
          expect(
            findings.filter(({ code }) => code === "BETA_SANDBOX_EVENT_SET"),
          ).toHaveLength(1);
          expect(
            findings.filter(({ code }) => code !== "BETA_SANDBOX_EVENT_SET"),
          ).toEqual([]);
        }
      }
    }
  });
  it.each([false, true])(
    "admits actual full-stage sandbox structure with sessions=%s (bundle proof is separate)",
    async (sessionsEnabled) => {
      const result = templates(enabled(sessionsEnabled));
      const stacks = Object.entries(result).map(([name, template]) => ({
        stackName: "cloudmarkup-beta-" + name,
        template: template.toJSON(),
      }));
      const admission = await admissionModule();
      const findings = admission.validateBetaSandboxDelivery(stacks, {
        contractVersion: 1,
        profile: "stripe-sandbox-v1",
        sessionsEnabled,
        signingArn,
        previousArn: "",
      });
      expect(
        findings.filter(
          ({ code }) =>
            !["BETA_SANDBOX_ASSET_BINDING", "BETA_SANDBOX_EVENT_SET"].includes(
              code,
            ),
        ),
      ).toEqual([]);
      expect(
        findings.filter(({ code }) => code === "BETA_SANDBOX_ASSET_BINDING"),
      ).toHaveLength(2);
    },
  );
  it("binds owner-managed roles and an untagged exact mapping without depending on migration construction", () => {
    const config = enabled();
    const stack = new Stack(
      createTemplateTestApp(),
      "StandaloneSandboxFixture",
      {
        env: config.target,
      },
    );
    new SandboxBillingDelivery(stack, "Sandbox", {
      config,
      databaseArn:
        "arn:aws:rds:us-east-1:000000000000:cluster:cloudmarkup-beta-postgresql",
      databaseSecretArn:
        "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup-beta/database/admin-a1b2c3",
      originVerification: "synthetic-origin-marker",
      webhookLogGroup: logs.LogGroup.fromLogGroupName(
        stack,
        "WebhookLogs",
        "/aws/lambda/cloudmarkup-beta-billing-webhook",
      ),
      workerLogGroup: logs.LogGroup.fromLogGroupName(
        stack,
        "WorkerLogs",
        "/aws/lambda/cloudmarkup-beta-billing-worker",
      ),
    });
    Tags.of(stack).add("CloudMarkupConfigSchema", String(config.schemaVersion));
    for (const [key, value] of Object.entries(config.tags))
      Tags.of(stack).add(key, value);
    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::IAM::Role", 0);
    template.resourceCountIs("AWS::IAM::Policy", 0);
    template.resourceCountIs("AWS::IAM::ManagedPolicy", 0);
    template.resourceCountIs("AWS::SQS::Queue", 2);
    template.resourceCountIs("AWS::Lambda::Function", 2);
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
    template.resourceCountIs("AWS::SQS::QueuePolicy", 2);
    for (const resource of Object.values(
      template.findResources("AWS::SQS::QueuePolicy"),
    )) {
      expect(resourceProperties(resource)["PolicyDocument"]).toMatchObject({
        Version: "2012-10-17",
        Statement: [
          {
            Action: "sqs:*",
            Effect: "Deny",
            Principal: { AWS: "*" },
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          },
        ],
      });
      const document = resourceProperties(resource)["PolicyDocument"] as {
        Statement: unknown[];
      };
      expect(document.Statement).toHaveLength(1);
    }
    for (const [name, roleName] of [
      [
        "cloudmarkup-beta-billing-webhook",
        BETA_CDK_BOOTSTRAP.billingWebhookRuntimeRoleName,
      ],
      [
        "cloudmarkup-beta-billing-worker",
        BETA_CDK_BOOTSTRAP.billingWorkerRuntimeRoleName,
      ],
    ] as const) {
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: name,
        Role: importedRoleArn(roleName),
        Tags: Match.arrayWith([{ Key: "Environment", Value: "beta" }]),
      });
    }
    const worker = Object.entries(
      template.findResources("AWS::Lambda::Function"),
    ).find(
      ([, value]) =>
        resourceProperties(value)["FunctionName"] ===
        "cloudmarkup-beta-billing-worker",
    );
    const queue = Object.entries(
      template.findResources("AWS::SQS::Queue"),
    ).find(
      ([, value]) =>
        resourceProperties(value)["QueueName"] ===
        "cloudmarkup-beta-billing-webhook.fifo",
    );
    expect(worker).toBeDefined();
    expect(queue).toBeDefined();
    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 1,
      EventSourceArn: { "Fn::GetAtt": [queue?.[0], "Arn"] },
      FunctionName: { Ref: worker?.[0] },
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      ScalingConfig: { MaximumConcurrency: 2 },
      Tags: Match.absent(),
    });
    for (const resource of Object.values(
      template.findResources("AWS::SQS::Queue"),
    ))
      expect(resourceProperties(resource)["Tags"]).toEqual(
        expect.arrayContaining([
          { Key: "Environment", Value: "beta" },
          { Key: "Project", Value: "CloudMarkup" },
        ]),
      );
  });
  it("keeps default beta free of queues, worker, signing references and checkout authority", () => {
    const result = templates(beta());
    result.application.resourceCountIs("AWS::SQS::Queue", 0);
    result.application.resourceCountIs("AWS::Lambda::EventSourceMapping", 0);
    const serialized = JSON.stringify(result.application.toJSON());
    for (const forbidden of [
      apiKeyArn,
      "cloudmarkup-beta-billing-worker",
      "CLOUDMARKUP_BILLING_SESSIONS_ENABLED",
      signingArn,
    ])
      expect(serialized).not.toContain(forbidden);
    result.observability.resourceCountIs("AWS::Logs::LogGroup", 10);
  });
  it("creates exactly one encrypted retained FIFO lane and bounded real consumer, without checkout", () => {
    const { application, observability } = templates(enabled());
    application.resourceCountIs("AWS::SQS::Queue", 2);
    application.hasOutput("SandboxBillingDelivery", {
      Value: "stripe-test-fifo-v1",
    });
    for (const queue of Object.values(
      application.findResources("AWS::SQS::Queue"),
    )) {
      expect(queue).toMatchObject({
        DeletionPolicy: "RetainExceptOnCreate",
        UpdateReplacePolicy: "Retain",
        Properties: {
          FifoQueue: true,
          SqsManagedSseEnabled: true,
          MessageRetentionPeriod: 1209600,
        },
      });
    }
    application.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "cloudmarkup-beta-billing-webhook.fifo",
      VisibilityTimeout: 360,
      ContentBasedDeduplication: false,
    });
    application.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 1,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      ScalingConfig: { MaximumConcurrency: 2 },
      Tags: Match.absent(),
    });
    application.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "cloudmarkup-beta-billing-worker",
      Role: importedRoleArn(BETA_CDK_BOOTSTRAP.billingWorkerRuntimeRoleName),
      Timeout: 60,
      ReservedConcurrentExecutions: 2,
      Environment: {
        Variables: Match.objectLike({
          CLOUDMARKUP_BILLING_ENABLED: "true",
          CLOUDMARKUP_STRIPE_ENVIRONMENT: "test",
          CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN: apiKeyArn,
          CLOUDMARKUP_DATABASE_NAME: "cloudmarkup",
          STRIPE_STARTER_PRICE_ID: "price_ExampleStarterTest",
        }),
      },
    });
    const api = Object.values(
      application.findResources("AWS::Lambda::Function"),
    ).find(
      (item) =>
        resourceProperties(item)["FunctionName"] === "cloudmarkup-beta-api",
    );
    expect(api).toBeDefined();
    expect(JSON.stringify(api)).not.toContain(
      "CLOUDMARKUP_BILLING_SESSIONS_ENABLED",
    );
    application.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "cloudmarkup-beta-billing-webhook",
      Role: importedRoleArn(BETA_CDK_BOOTSTRAP.billingWebhookRuntimeRoleName),
      Timeout: 10,
      Environment: {
        Variables: Match.objectLike({
          CLOUDMARKUP_STRIPE_WEBHOOK_SECRET_REFERENCE: signingArn,
        }),
      },
    });
    application.resourceCountIs("AWS::StepFunctions::StateMachine", 0);
    application.resourceCountIs("AWS::CodeBuild::Project", 0);
    observability.resourceCountIs("AWS::Logs::LogGroup", 11);
    observability.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Errors",
      Dimensions: [
        { Name: "FunctionName", Value: "cloudmarkup-beta-billing-worker" },
      ],
    });
    const worker = Object.values(
      application.findResources("AWS::Lambda::Function"),
    ).find(
      (item) =>
        resourceProperties(item)["FunctionName"] ===
        "cloudmarkup-beta-billing-worker",
    );
    expect(worker?.["DependsOn"]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^DatabaseMigration/u)]),
    );
    // Assert immutable imports directly; an empty IAM loop proves nothing.
    // Bootstrap tests separately inspect the real enabled/disabled policies.
    application.resourceCountIs("AWS::IAM::Role", 0);
    application.resourceCountIs("AWS::IAM::Policy", 0);
    application.resourceCountIs("AWS::IAM::ManagedPolicy", 0);
    const functions = application.findResources("AWS::Lambda::Function");
    const workerEntry = Object.entries(functions).find(
      ([, value]) =>
        resourceProperties(value)["FunctionName"] ===
        "cloudmarkup-beta-billing-worker",
    );
    const queueEntry = Object.entries(
      application.findResources("AWS::SQS::Queue"),
    ).find(
      ([, value]) =>
        resourceProperties(value)["QueueName"] ===
        "cloudmarkup-beta-billing-webhook.fifo",
    );
    expect(workerEntry).toBeDefined();
    expect(queueEntry).toBeDefined();
    application.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      EventSourceArn: { "Fn::GetAtt": [queueEntry?.[0], "Arn"] },
      FunctionName: { Ref: workerEntry?.[0] },
    });
    for (const resource of [
      ...Object.values(functions),
      ...Object.values(application.findResources("AWS::SQS::Queue")),
    ]) {
      expect(resourceProperties(resource)["Tags"]).toEqual(
        expect.arrayContaining([
          { Key: "Environment", Value: "beta" },
          { Key: "Project", Value: "CloudMarkup" },
        ]),
      );
    }
    const webhook = Object.values(functions).find(
      (item) =>
        resourceProperties(item)["FunctionName"] ===
        "cloudmarkup-beta-billing-webhook",
    );
    expect(JSON.stringify(webhook)).not.toContain(apiKeyArn);
    expect(JSON.stringify(webhook)).not.toContain("CLOUDMARKUP_DATABASE_");
    expect(JSON.stringify(worker)).not.toContain(signingArn);
  });
  it("adds only API-key session environment when separately selected, never an imported API role grant", () => {
    const { application } = templates(enabled(true));
    application.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "cloudmarkup-beta-api",
      Environment: {
        Variables: Match.objectLike({
          CLOUDMARKUP_BILLING_SESSIONS_ENABLED: "true",
          CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN: apiKeyArn,
          CLOUDMARKUP_STRIPE_PORTAL_CONFIGURATION_REFERENCE: "bpc_ExampleTest",
        }),
      },
    });
    const api = Object.values(
      application.findResources("AWS::Lambda::Function"),
    ).find(
      (item) =>
        resourceProperties(item)["FunctionName"] === "cloudmarkup-beta-api",
    );
    expect(JSON.stringify(api)).not.toContain(signingArn);
  });
  it("permits only a separately named exact previous signing reference for rotation", () => {
    const config = enabled();
    const { application } = templates({
      ...config,
      integrations: {
        ...config.integrations,
        stripe: {
          ...config.integrations.stripe,
          previousWebhookSigningSecretName:
            "cloudmarkup/beta/stripe/webhook-signing-previous",
          previousWebhookSigningSecretArn: previousArn,
        },
      },
    });
    application.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "cloudmarkup-beta-billing-webhook",
      Environment: {
        Variables: Match.objectLike({
          CLOUDMARKUP_STRIPE_PREVIOUS_WEBHOOK_SECRET_REFERENCE: previousArn,
        }),
      },
    });
  });
  it.each([
    { planMappingVersion: "another-mapping-v1" },
    { webhookEndpointVersion: "another-endpoint-v1" },
    { starterProductId: "prod_alternate" },
    { starterPriceId: "price_alternate" },
    { proProductId: "prod_alternate" },
    { proPriceId: "price_alternate" },
    { portalConfigurationId: "bpc_alternate" },
    { apiKeySecretArn: apiKeyArn.replace("EX0004", "abc123") },
    { successUrl: "https://other.example/organizations" },
    { cancelUrl: "https://beta.example.invalid/not-reviewed" },
    { portalReturnUrl: "https://beta.example.invalid/not-reviewed" },
    { deliveryEnabled: "true" },
    { sessionsEnabled: "false" },
    { deliveryEnabled: false, sessionsEnabled: true },
    { environment: "live" },
    { graceHours: 1 },
    { apiKeySecretArn: undefined },
    { webhookSigningSecretArn: undefined },
    { webhookSigningSecretArn: `${signingArn}*` },
    {
      webhookSigningSecretArn: signingArn.replace(
        "000000000000",
        "111122223333",
      ),
    },
    { webhookSigningSecretArn: signingArn.replace("us-east-1", "eu-west-1") },
    { webhookSigningSecretArn: apiKeyArn },
    { previousWebhookSigningSecretArn: previousArn },
    {
      previousWebhookSigningSecretName:
        "cloudmarkup/beta/stripe/webhook-signing-previous",
    },
  ])("rejects incomplete or widened delivery authority %j", (override) => {
    const config = enabled();
    expect(() =>
      defineEnvironmentConfig({
        ...config,
        integrations: {
          ...config.integrations,
          stripe: { ...config.integrations.stripe, ...override },
        },
      } as EnvironmentConfig),
    ).toThrow();
  });
  it("requires the billing feature and enough time for checkout operations", () => {
    const config = enabled(true);
    expect(() =>
      defineEnvironmentConfig({
        ...config,
        features: { ...config.features, billing: false },
      }),
    ).toThrow();
    expect(() =>
      defineEnvironmentConfig({
        ...config,
        limits: { ...config.limits, apiTimeoutSeconds: 15 },
      }),
    ).toThrow(/25 seconds/u);
  });
  it.each([false, true])(
    "admits only the exact live catalog and separate secret roles with sessions=%s",
    async (sessionsEnabled) => {
      const config = live(sessionsEnabled),
        result = templates(config);
      const stacks = Object.entries(result).map(([name, template]) => ({
        stackName: "cloudmarkup-beta-" + name,
        template: template.toJSON() as AdmissionStack["template"],
      }));
      const profile = {
        contractVersion: 1,
        profile: "stripe-live-github-cloudformation-v1",
        sessionsEnabled,
        signingArn: liveSigningArn,
        previousArn: "",
      };
      const { validateBetaSandboxDelivery } = await admissionModule();
      const assets = fixtureAssets(stacks);
      expect(validateBetaSandboxDelivery(stacks, profile, assets)).toEqual([]);
      const worker = env(stacks, "billing-worker"),
        webhook = env(stacks, "billing-webhook"),
        api = env(stacks, "api");
      expect(worker["CLOUDMARKUP_STRIPE_ENVIRONMENT"]).toBe("live");
      expect(webhook["CLOUDMARKUP_STRIPE_ENVIRONMENT"]).toBe("live");
      expect(worker["CLOUDMARKUP_STRIPE_API_KEY_SECRET_ARN"]).toBe(
        "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/api-key-EX0003",
      );
      expect(JSON.stringify(worker)).not.toContain(liveSigningArn);
      expect(JSON.stringify(webhook)).not.toContain("/live/api-key");
      expect(api["CLOUDMARKUP_CREDIT_TOP_UPS_ENABLED"]).toBe(
        sessionsEnabled ? "true" : undefined,
      );
      expect(JSON.stringify(api)).not.toContain(liveSigningArn);
      for (const patch of [
        { environment: "test" },
        { apiKeySecretArn: apiKeyArn },
        { webhookSigningSecretArn: signingArn },
        { proPriceId: "price_wrong" },
        { portalConfigurationId: "bpc_wrong" },
        { previousWebhookSigningSecretArn: previousArn },
      ])
        expect(() =>
          defineEnvironmentConfig({
            ...config,
            integrations: {
              ...config.integrations,
              stripe: { ...config.integrations.stripe, ...patch },
            },
          } as EnvironmentConfig),
        ).toThrow();
      const wrong = structuredClone(stacks);
      env(wrong, "billing-worker")["CLOUDMARKUP_STRIPE_ENVIRONMENT"] = "test";
      expect(
        validateBetaSandboxDelivery(wrong, profile, assets).length,
      ).toBeGreaterThan(0);
    },
    120000,
  );
});
