import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import {
  defineEnvironmentConfig,
  type EnvironmentConfig,
} from "../lib/config/environment-config.js";
import { createBetaEnvironmentConfig } from "../lib/config/environments/beta.js";
import { createPlatformResourceNames } from "../lib/platform-names.js";
import { StatefulStack } from "../lib/stacks/stateful-stack.js";
import { createTemplateTestApp } from "./template-test-app.js";

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("The database fixture must contain an object.");
  return value as Record<string, unknown>;
}

function config() {
  return createBetaEnvironmentConfig({
    target: { account: "000000000000", region: "us-east-1" },
    domain: {
      certificateArn:
        "arn:aws:acm:us-east-1:000000000000:certificate/11111111-2222-3333-4444-555555555555",
      createDnsRecords: false,
      domainName: "beta.example.invalid",
    },
  });
}

function template(input: EnvironmentConfig) {
  const validated = defineEnvironmentConfig(input);
  return Template.fromStack(
    new StatefulStack(createTemplateTestApp(), "StatefulFixture", {
      config: validated,
      names: createPlatformResourceNames(
        validated.environment,
        validated.target,
      ),
      env: validated.target,
    }),
  );
}

describe("disabled beta Aurora auto-pause preparation", () => {
  it("preserves the complete current template when the gate is absent or false", () => {
    const base = config();
    const original = template(base);
    const disabled = template({
      ...base,
      database: { ...base.database, betaAutoPauseEnabled: false },
    });
    expect(disabled.toJSON()).toEqual(original.toJSON());
    original.hasResourceProperties("AWS::RDS::DBCluster", {
      BackupRetentionPeriod: 14,
      DeletionProtection: true,
      EnableHttpEndpoint: true,
      Engine: "aurora-postgresql",
      EngineVersion: "16.8",
      StorageEncrypted: true,
      ServerlessV2ScalingConfiguration: { MaxCapacity: 4, MinCapacity: 0.5 },
    });
    const clusters = record(original.findResources("AWS::RDS::DBCluster"));
    const properties = record(record(Object.values(clusters)[0])["Properties"]);
    expect(properties["ServerlessV2ScalingConfiguration"]).not.toHaveProperty(
      "SecondsUntilAutoPause",
    );
  }, 30_000);

  it("maps the explicitly gated interval on the existing beta cluster without changing any other resource", () => {
    const base = config();
    const original = template(base);
    const expected = record(original.toJSON());
    const clusterId = Object.keys(
      record(original.findResources("AWS::RDS::DBCluster")),
    )[0];
    if (clusterId === undefined)
      throw new Error("Missing beta database fixture.");
    const resources = record(expected["Resources"]);
    const properties = record(record(resources[clusterId])["Properties"]);
    properties["ServerlessV2ScalingConfiguration"] = {
      MaxCapacity: 4,
      MinCapacity: 0,
      SecondsUntilAutoPause: 900,
    };
    const candidate = template({
      ...base,
      database: {
        ...base.database,
        betaAutoPauseEnabled: true,
        minCapacityAcu: 0,
        autoPauseMinutes: 15,
      },
    });
    expect(candidate.toJSON()).toEqual(expected);
  }, 30_000);
});
