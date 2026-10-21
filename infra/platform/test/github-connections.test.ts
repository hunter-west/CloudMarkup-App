import { fileURLToPath } from "node:url";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import {
  defineEnvironmentConfig,
  type EnvironmentConfig,
} from "../lib/config/environment-config.js";
import { createBetaEnvironmentConfig } from "../lib/config/environments/beta.js";
import type { BetaServiceInputs } from "../lib/config/environments/beta.js";
import { createDevEnvironmentConfig } from "../lib/config/environments/dev.js";
import { CloudMarkupStage } from "../lib/stages/cloudmarkup-stage.js";
import { createTemplateTestApp } from "./template-test-app.js";

const privateKeyArn =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/github/app-private-key-EX0002";
const clientSecretArn =
  "arn:aws:secretsmanager:us-east-1:000000000000:secret:Github-App-Client-Secret-EX0001";
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
function enabled(base = beta()): EnvironmentConfig {
  return {
    ...base,
    limits: { ...base.limits, apiTimeoutSeconds: 25 },
    integrations: {
      ...base.integrations,
      github: { ...base.integrations.github, connectionsEnabled: true },
    },
  };
}
function selected(
  profile: BetaServiceInputs["profile"],
  sessionsEnabled = false,
): EnvironmentConfig {
  const base = beta();
  if (base.domain === undefined) throw new TypeError("Missing beta domain.");
  return createBetaEnvironmentConfig({
    domain: base.domain,
    target: base.target,
    service: {
      profile,
      sessionsEnabled,
      signingArn:
        profile === "core-v1"
          ? ""
          : "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-secret-a1b2c3",
      previousArn: "",
    },
  });
}
function template(config: EnvironmentConfig): Template {
  return Template.fromStack(
    new CloudMarkupStage(createTemplateTestApp(), "GithubConnectionsFixture", {
      config: defineEnvironmentConfig(config),
      webAssetsPath: fileURLToPath(
        new URL("fixtures/web-dist/", import.meta.url),
      ),
    }).application,
  );
}

describe("separate GitHub connections activation", { timeout: 30000 }, () => {
  it("selects only the explicit combined profile while retaining independent sandbox sessions", () => {
    for (const profile of ["core-v1", "stripe-sandbox-v1"] as const) {
      expect(selected(profile).integrations.github.connectionsEnabled).toBe(
        false,
      );
    }
    for (const sessions of [false, true]) {
      const config = selected("stripe-sandbox-github-connections-v1", sessions);
      expect(config.integrations.github.connectionsEnabled).toBe(true);
      expect(config.integrations.stripe.deliveryEnabled).toBe(true);
      expect(config.integrations.stripe.sessionsEnabled).toBe(sessions);
      expect(config.limits.apiTimeoutSeconds).toBe(25);
      expect(config.features.githubExport).toBe(false);
      expect(config.features.aiAuthoring).toBe(false);
      expect(config.features.applicationGeneration).toBe(false);
    }
  });
  it("keeps reviewed beta references out of all runtime env and IAM while disabled", () => {
    const config = beta();
    expect(config.integrations.github.connectionsEnabled).toBe(false);
    expect(config.features.githubExport).toBe(false);
    const result = template(config);
    result.resourceCountIs("AWS::Lambda::LayerVersion", 0);
    expect(JSON.stringify(result.toJSON())).not.toContain(
      "CLOUDMARKUP_REPOSITORY_IMPORTS_ENABLED",
    );
    result.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "cloudmarkup-beta-api",
      Environment: {
        Variables: Match.objectLike({
          CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: "false",
        }),
      },
    });
    for (const value of [
      privateKeyArn,
      clientSecretArn,
      "IvEXAMPLE000000000000",
      "CLOUDMARKUP_GITHUB_WEBHOOK_SECRET_NAME",
    ]) {
      expect(JSON.stringify(result.toJSON())).not.toContain(value);
    }
    for (const name of ["setup", "callback"])
      result.hasResourceProperties("AWS::ApiGateway::Resource", {
        PathPart: name,
      });
  });
  it("wires only API connection credentials without claiming imported beta IAM grants", () => {
    const result = template(selected("stripe-sandbox-github-connections-v1"));
    result.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "cloudmarkup-beta-api",
      Environment: {
        Variables: Match.objectLike({
          CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: "true",
          CLOUDMARKUP_REPOSITORY_IMPORTS_ENABLED: "true",
          CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_PATH:
            "/opt/cloudmarkup-iac-import",
          CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_SHA256:
            Match.stringLikeRegexp("^[a-f0-9]{64}$"),
          CLOUDMARKUP_GITHUB_APP_ID: "123456",
          CLOUDMARKUP_GITHUB_APP_SLUG: "cloudmarkup-example-beta",
          CLOUDMARKUP_GITHUB_CLIENT_ID: "IvEXAMPLE000000000000",
          CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_ARN: privateKeyArn,
          CLOUDMARKUP_GITHUB_CLIENT_SECRET_ARN: clientSecretArn,
          CLOUDMARKUP_GITHUB_CLIENT_SECRET_JSON_FIELD: "Client secret",
        }),
      },
    });
    const policies = JSON.stringify(result.findResources("AWS::IAM::Policy"));
    expect(policies).not.toContain(privateKeyArn);
    expect(policies).not.toContain(clientSecretArn);
    expect(JSON.stringify(result.toJSON())).not.toContain(
      "CLOUDMARKUP_GITHUB_WEBHOOK_SECRET_NAME",
    );
    expect(JSON.stringify(result.toJSON())).not.toContain(
      "cloudmarkup-beta-job-worker",
    );
  });
  it("grants owned API roles only the two exact current-version reads without enabling exports", () => {
    const dev = createDevEnvironmentConfig();
    const config = enabled({
      ...dev,
      domain: beta().domain,
      integrations: {
        ...dev.integrations,
        github: {
          ...beta().integrations.github,
          privateKeySecretName: dev.integrations.github.privateKeySecretName,
          webhookSecretName: dev.integrations.github.webhookSecretName,
        },
      },
    });
    const result = template(config);
    result.hasResourceProperties("AWS::IAM::Policy", {
      Roles: [
        Match.objectLike({ Ref: Match.stringLikeRegexp("ApiExecutionRole") }),
      ],
      PolicyDocument: {
        Statement: Match.arrayWith([
          {
            Action: "secretsmanager:GetSecretValue",
            Effect: "Allow",
            Resource: [privateKeyArn, clientSecretArn],
            Condition: {
              StringEquals: { "secretsmanager:VersionStage": "AWSCURRENT" },
            },
          },
        ]),
      },
    });
    for (const [id, resource] of Object.entries(
      result.findResources("AWS::IAM::Policy"),
    )) {
      if (id.includes("ApiExecutionRole")) continue;
      expect(JSON.stringify(resource)).not.toContain(privateKeyArn);
      expect(JSON.stringify(resource)).not.toContain(clientSecretArn);
    }
    expect(config.features.githubExport).toBe(false);
  });
  it.each([
    { connectionsEnabled: "true" },
    { appId: undefined },
    { appId: "0" },
    { appId: "99999999999999999999" },
    { appSlug: undefined },
    { appSlug: 42 },
    { appSlug: "https://evil.invalid/app" },
    { clientId: undefined },
    { clientId: "not-an-app-client" },
    { clientSecretArn: undefined },
    { privateKeySecretArn: undefined },
    { clientSecretArn: privateKeyArn },
    {
      clientSecretArn: clientSecretArn.replace("000000000000", "111122223333"),
    },
    { clientSecretArn: clientSecretArn.replace("us-east-1", "eu-west-1") },
    { clientSecretArn: `${clientSecretArn}*` },
    { clientSecretJsonField: "field\nother" },
    { clientSecretJsonField: 42 },
  ])("rejects malformed or incomplete connection authority %j", (override) => {
    const config = enabled();
    expect(() =>
      defineEnvironmentConfig({
        ...config,
        integrations: {
          ...config.integrations,
          github: { ...config.integrations.github, ...override },
        },
      } as EnvironmentConfig),
    ).toThrow();
  });
  it("requires a public domain and sufficient bounded callback timeout", () => {
    expect(() =>
      defineEnvironmentConfig({
        ...enabled(),
        domain: undefined,
      }),
    ).toThrow(/public HTTPS domain/u);
    const config = enabled();
    expect(() =>
      defineEnvironmentConfig({
        ...config,
        limits: { ...config.limits, apiTimeoutSeconds: 15 },
      }),
    ).toThrow(/25 seconds/u);
  });
});
