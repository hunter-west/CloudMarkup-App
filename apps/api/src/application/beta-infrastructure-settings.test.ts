import { describe, expect, it } from "vitest";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { configurationKeySchema } from "@cloudmarkup/schemas";
import {
  projectBetaInfrastructureConfiguration,
  validBetaInfrastructureSettings,
} from "./beta-infrastructure-settings.js";

describe("v5 writable catalog projection", () => {
  it.each(["aws.cognito.user-pool", "aws.cognito.user-pool-client"])(
    "matches manual catalog admission for %s security metadata",
    (serviceType) => {
      const service = awsCatalogV1.requireService(serviceType);
      const defaults = awsCatalogV1.validateConfiguration(service.id, {});
      if (!defaults.success) throw new Error("Missing defaults");
      const settings = Object.fromEntries(
        Object.entries(defaults.values).map(([key, value]) => [
          key,
          "value" in value ? value.value : undefined,
        ]),
      );
      expect(
        projectBetaInfrastructureConfiguration(service.configuration)
          .unsupportedConfigurationKeys,
      ).toEqual([]);
      expect(
        validBetaInfrastructureSettings(
          service.configuration,
          settings as Record<string, string | number | boolean>,
        ),
      ).toBe(true);
      expect(
        validBetaInfrastructureSettings(service.configuration, {
          generateClientSecret: true,
        }),
      ).toBe(false);
      expect(
        validBetaInfrastructureSettings(service.configuration, {
          passwordMinimumLength: "private-text",
        }),
      ).toBe(false);
    },
  );
  it("excludes catalog references from both capabilities and literal admission", () => {
    const configuration = awsCatalogV1.requireService(
      "aws.iam.policy-statement",
    ).configuration;
    const projection = projectBetaInfrastructureConfiguration(configuration);
    expect(projection.unsupportedConfigurationKeys).toContain("resourceNode");
    expect(projection.configuration.properties).not.toHaveProperty(
      "resourceNode",
    );
    expect(projection.configuration.required).not.toContain("resourceNode");
    expect(
      validBetaInfrastructureSettings(configuration, {
        resourceNode: "node_untrusted",
      }),
    ).toBe(false);
  });
  it("excludes numeric arrays and credential-like keys even when a literal UI hint exists", () => {
    const original = awsCatalogV1.requireService(
      "aws.eventbridge.rule",
    ).configuration;
    const hint = original.uiHints.find(
      (field) => field.property === "filterKeys",
    );
    if (!hint) throw new Error("Expected filter metadata");
    const samples = configurationKeySchema.parse("samples");
    const secretKey = configurationKeySchema.parse("credentialValues");
    const configuration = {
      ...original,
      jsonSchema: {
        ...original.jsonSchema,
        properties: {
          ...original.jsonSchema.properties,
          [samples]: {
            type: "array" as const,
            items: { type: "number" as const },
          },
          [secretKey]: {
            type: "array" as const,
            items: { type: "string" as const },
          },
        },
      },
      uiHints: [
        ...original.uiHints,
        { ...hint, property: samples },
        { ...hint, property: secretKey },
      ],
    };
    const projection = projectBetaInfrastructureConfiguration(configuration);
    expect(projection.unsupportedConfigurationKeys).toEqual(
      expect.arrayContaining(["samples", "credentialValues"]),
    );
    expect(projection.configuration.properties).not.toHaveProperty("samples");
    expect(projection.configuration.properties).not.toHaveProperty(
      "credentialValues",
    );
    expect(
      validBetaInfrastructureSettings(configuration, { samples: ["1"] }),
    ).toBe(false);
    expect(
      validBetaInfrastructureSettings(configuration, {
        credentialValues: ["synthetic"],
      }),
    ).toBe(false);
  });
  it("intersects transport bounds and validates partial settings without inserting defaults", () => {
    const configuration = awsCatalogV1.requireService(
      "aws.eventbridge.rule",
    ).configuration;
    const input = { filterKeys: [] };
    expect(validBetaInfrastructureSettings(configuration, input)).toBe(true);
    expect(input).toEqual({ filterKeys: [] });
    expect(
      projectBetaInfrastructureConfiguration(configuration).configuration
        .properties,
    ).toMatchObject({
      filterKeys: { maxItems: 8, items: { type: "string", maxLength: 256 } },
      sourceKinds: { minItems: 1, maxItems: 2, uniqueItems: true },
      detailTypes: { minItems: 1, maxItems: 3, uniqueItems: true },
    });
  });
});
