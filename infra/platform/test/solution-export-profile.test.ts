import { Template, Match } from "aws-cdk-lib/assertions";
import { ObservabilityStack } from "../lib/stacks/observability-stack.js";
import { createPlatformResourceNames } from "../lib/platform-names.js";
import { createTemplateTestApp } from "./template-test-app.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createBetaEnvironmentConfig,
  type BetaServiceInputs,
} from "../lib/config/environments/beta.js";
import {
  defineEnvironmentConfig,
  type EnvironmentConfig,
} from "../lib/config/environment-config.js";

const signingArn =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-secret-a1b2c3";
function profile(
  name: BetaServiceInputs["profile"] = "stripe-sandbox-github-cloudformation-v1",
  sessionsEnabled = false,
) {
  return createBetaEnvironmentConfig({
    domain: {
      certificateArn:
        "arn:aws:acm:us-east-1:000000000000:certificate/11111111-2222-3333-4444-555555555555",
      createDnsRecords: false,
      domainName: "beta.example.invalid",
    },
    target: { account: "000000000000", region: "us-east-1" },
    service: {
      profile: name,
      sessionsEnabled,
      signingArn: name === "core-v1" ? "" : signingArn,
      previousArn: "",
    },
  });
}
const denied: readonly (readonly [
  string,
  (c: EnvironmentConfig) => EnvironmentConfig,
])[] = [
  [
    "another account",
    (c) => ({ ...c, target: { ...c.target, account: "111122223333" } }),
  ],
  [
    "another region",
    (c) => ({ ...c, target: { ...c.target, region: "us-west-2" } }),
  ],
  [
    "missing signed delivery",
    (c) => ({
      ...c,
      integrations: {
        ...c.integrations,
        stripe: { ...c.integrations.stripe, deliveryEnabled: false },
      },
    }),
  ],
  [
    "missing GitHub connection admission",
    (c) => ({
      ...c,
      integrations: {
        ...c.integrations,
        github: { ...c.integrations.github, connectionsEnabled: false },
      },
    }),
  ],
  [
    "historical mapping",
    (c) => ({
      ...c,
      integrations: {
        ...c.integrations,
        stripe: {
          ...c.integrations.stripe,
          planMappingVersion:
            "cloudmarkup-starter-pro-sharing-mapping-2026-09-07-v2",
        },
      },
    }),
  ],
  ...(
    [
      "aiAuthoring",
      "applicationGeneration",
      "staticValidation",
      "planDeploymentWorkflowExport",
      "githubExport",
    ] as const
  ).map(
    (key) =>
      [
        key,
        (c: EnvironmentConfig) => ({
          ...c,
          features: { ...c.features, [key]: true },
        }),
      ] as const,
  ),
];

describe("restricted beta export service profile", () => {
  it("adds only the reviewed explicit export selector and current commercial mapping", () => {
    const config = profile();
    expect(config.integrations.solutionExport).toEqual({ enabled: true });
    expect(config.limits.apiTimeoutSeconds).toBe(29);
    expect(config.integrations.stripe.planMappingVersion).toBe(
      "cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4",
    );
    expect(config.integrations.stripe.sessionsEnabled).toBe(false);
    expect(config.integrations.stripe.deliveryEnabled).toBe(true);
    expect(config.integrations.github.connectionsEnabled).toBe(true);
    expect(config.features.aiAuthoring).toBe(false);
    expect(config.features.applicationGeneration).toBe(false);
    expect(config.features.staticValidation).toBe(false);
  });
  it.each([
    "core-v1",
    "stripe-sandbox-v1",
    "stripe-sandbox-github-connections-v1",
  ] as const)("keeps %s export configuration absent", (name) => {
    const config = profile(name);
    expect(Object.hasOwn(config.integrations, "solutionExport")).toBe(false);
    expect(config.integrations.stripe.planMappingVersion).not.toBe(
      "cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4",
    );
  });
  it("admits separately enabled sandbox checkout alongside restricted exports", () => {
    const config = profile("stripe-sandbox-github-cloudformation-v1", true);
    expect(config.integrations.solutionExport?.enabled).toBe(true);
    expect(config.integrations.stripe.sessionsEnabled).toBe(true);
    expect(config.integrations.stripe.environment).toBe("test");
    expect(config.integrations.stripe.deliveryEnabled).toBe(true);
    expect(config.features.aiAuthoring).toBe(false);
  });
  it.each(denied)("rejects export composition with %s", (_label, change) => {
    expect(() => defineEnvironmentConfig(change(profile()))).toThrow();
  });
});

describe("restricted export operational signals", () => {
  const templates = new Map<boolean, Template>();
  // Cold CDK synthesis is fixture preparation, not an operational latency
  // assertion. Keep every real template and the default assertion timeout.
  beforeAll(() => {
    for (const enabled of [true, false]) {
      const config = profile(
        enabled
          ? "stripe-sandbox-github-cloudformation-v1"
          : "stripe-sandbox-github-connections-v1",
      );
      const stack = new ObservabilityStack(
        createTemplateTestApp(),
        "ExportObservability",
        {
          config,
          names: createPlatformResourceNames("beta", config.target),
          env: config.target,
        },
      );
      templates.set(enabled, Template.fromStack(stack));
    }
  }, 30000);
  it.each([true, false])(
    "includes export worker logs and exact delivery alarms only when enabled=%s",
    (enabled) => {
      const template = templates.get(enabled);
      if (template === undefined)
        throw new Error("Missing synthesized export fixture.");
      const alarms = template.findResources("AWS::CloudWatch::Alarm", {
        Properties: {
          AlarmName: Match.stringLikeRegexp(
            "^cloudmarkup-beta-solution-export-",
          ),
        },
      });
      expect(Object.keys(alarms)).toHaveLength(enabled ? 3 : 0);
      const logs = template.findResources("AWS::Logs::LogGroup", {
        Properties: {
          LogGroupName: "/aws/lambda/cloudmarkup-beta-solution-export-worker",
        },
      });
      expect(Object.keys(logs)).toHaveLength(enabled ? 1 : 0);
      const output = template.findOutputs("LogGroupNames");
      expect(
        JSON.stringify(output).includes(
          "/aws/lambda/cloudmarkup-beta-solution-export-worker",
        ),
      ).toBe(enabled);
      if (enabled) {
        template.hasResourceProperties("AWS::CloudWatch::Alarm", {
          AlarmName: "cloudmarkup-beta-solution-export-dead-letters",
          Namespace: "AWS/SQS",
          MetricName: "ApproximateNumberOfMessagesVisible",
          Threshold: 1,
          Dimensions: [
            {
              Name: "QueueName",
              Value: "cloudmarkup-beta-solution-exports-dlq.fifo",
            },
          ],
          AlarmActions: [
            { "Fn::ImportValue": "cloudmarkup-beta-bootstrap:AlarmTopicArn" },
          ],
        });
        template.hasResourceProperties("AWS::CloudWatch::Alarm", {
          AlarmName: "cloudmarkup-beta-solution-export-queue-age",
          Threshold: 1800,
        });
      }
    },
  );
});
