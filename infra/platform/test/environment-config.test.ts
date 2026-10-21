import { describe, expect, test } from "vitest";

import {
  defineEnvironmentConfig,
  type DomainConfiguration,
  type EnvironmentConfig,
  type EnvironmentTarget,
  validateEnvironmentConfig,
} from "../lib/config/environment-config.js";
import { createBetaEnvironmentConfig } from "../lib/config/environments/beta.js";
import {
  CLOUDMARKUP_DEV_TARGET,
  createDevEnvironmentConfig,
} from "../lib/config/environments/dev.js";
import { createProdEnvironmentConfig } from "../lib/config/environments/prod.js";
import { createStagingEnvironmentConfig } from "../lib/config/environments/staging.js";

const stagingTarget: EnvironmentTarget = {
  account: "111122223333",
  region: "us-west-2",
};
const prodTarget: EnvironmentTarget = {
  account: "444455556666",
  region: "eu-west-1",
};
const betaTarget: EnvironmentTarget = {
  account: "000000000000",
  region: "us-east-1",
};

function betaConfig(): EnvironmentConfig {
  return createBetaEnvironmentConfig({
    domain: {
      certificateArn:
        "arn:aws:acm:us-east-1:000000000000:certificate/11111111-2222-3333-4444-555555555555",
      createDnsRecords: false,
      domainName: "beta.example.invalid",
    },
    target: betaTarget,
  });
}

function withFeatures(
  config: EnvironmentConfig,
  features: Partial<EnvironmentConfig["features"]>,
): EnvironmentConfig {
  return { ...config, features: { ...config.features, ...features } };
}

function withDomain(
  config: EnvironmentConfig,
  domain: DomainConfiguration,
): EnvironmentConfig {
  return { ...config, domain };
}

function domainFixture(account: string): DomainConfiguration {
  return {
    certificateArn: `arn:aws:acm:us-east-1:${account}:certificate/11111111-2222-3333-4444-555555555555`,
    createDnsRecords: true,
    domainName: "app.example.com",
    hostedZoneId: "Z1234567890ABC",
    hostedZoneName: "example.com",
    wafWebAclArn: `arn:aws:wafv2:us-east-1:${account}:global/webacl/cloudmarkup/11111111-2222-3333-4444-555555555555`,
    wafWebAclMetricName: "CloudMarkupExternalRateControls",
  };
}

function expectInvalid(config: EnvironmentConfig, message?: RegExp): void {
  expect(() => defineEnvironmentConfig(config)).toThrow(
    message ?? /Invalid CloudMarkup environment configuration/u,
  );
}

describe("environment configuration", () => {
  test("defines a frozen, valid development overlay with the reviewed target", () => {
    const config = createDevEnvironmentConfig();

    expect(config.schemaVersion).toBe(1);
    expect(config.environment).toBe("dev");
    expect(config.target).toEqual({
      account: "000000000000",
      region: "us-east-1",
    });
    expect(config.target).toEqual(CLOUDMARKUP_DEV_TARGET);
    expect(config.budget.anomalyThresholdUsd).toBe(10);
    expect(config.limits).toMatchObject({
      apiConcurrency: 10,
      wafApiRequestsPerFiveMinutes: 2_000,
      wafWebhookRequestsPerFiveMinutes: 500,
    });
    expect(Object.values(config.features).every((enabled) => !enabled)).toBe(
      true,
    );
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
    expect(Object.isFrozen(config.integrations.stripe)).toBe(true);
    expect(config.integrations.github.webhookSecretName).toBe(
      "cloudmarkup/dev/github/webhook-secret",
    );
    expect(() => {
      validateEnvironmentConfig(config);
    }).not.toThrow();
  });

  test("requires explicit, independently validated staging and production targets", () => {
    const betaDomain = betaConfig().domain;
    if (betaDomain === undefined)
      throw new Error("beta domain fixture missing");
    expect(() =>
      createBetaEnvironmentConfig({
        domain: betaDomain,
        target: undefined as unknown as EnvironmentTarget,
      }),
    ).toThrow(/target\.account/u);
    expect(() =>
      createStagingEnvironmentConfig(undefined as unknown as EnvironmentTarget),
    ).toThrow(/target\.account/u);
    expect(() =>
      createProdEnvironmentConfig(undefined as unknown as EnvironmentTarget),
    ).toThrow(/target\.account/u);

    const staging = createStagingEnvironmentConfig(stagingTarget);
    const prod = createProdEnvironmentConfig(prodTarget);
    expect(staging.target).toEqual(stagingTarget);
    expect(prod.target).toEqual(prodTarget);
    expect(staging.target).not.toBe(stagingTarget);
    expect(prod.target).not.toBe(prodTarget);
  });

  test("defines a durable, public beta profile without enabling unfinished integrations", () => {
    const config = betaConfig();

    expect(config.environment).toBe("beta");
    expect(config.target).toEqual(betaTarget);
    expect(config.domain).toMatchObject({
      createDnsRecords: false,
      domainName: "beta.example.invalid",
    });
    expect(config.lifecycle).toEqual({
      deletionProtection: true,
      removalPolicy: "retain",
    });
    expect(config.database).toMatchObject({
      backupRetentionDays: 14,
      maxCapacityAcu: 4,
      minCapacityAcu: 0.5,
    });
    expect(config.database).not.toHaveProperty("autoPauseMinutes");
    expect(config.features).toMatchObject({
      aiAuthoring: false,
      applicationGeneration: false,
      betaAccess: true,
      billing: false,
      githubExport: false,
      planDeploymentWorkflowExport: false,
      staticValidation: false,
      waf: true,
    });
    expect(config.integrations.stripe).toMatchObject({
      cancelUrl: "https://beta.example.invalid/organizations",
      environment: "test",
      portalConfigurationId: "bpc_ExampleTest",
      portalReturnUrl: "https://beta.example.invalid/organizations",
      proPriceId: "price_ExampleProTest",
      proProductId: "prod_ExampleProTest",
      starterPriceId: "price_ExampleStarterTest",
      starterProductId: "prod_ExampleStarterTest",
      successUrl: "https://beta.example.invalid/organizations",
    });
  });

  test("rejects application-account Route 53 ownership for beta", () => {
    expect(() =>
      createBetaEnvironmentConfig({
        domain: {
          certificateArn:
            "arn:aws:acm:us-east-1:000000000000:certificate/11111111-2222-3333-4444-555555555555",
          createDnsRecords: true,
          domainName: "beta.example.invalid",
          hostedZoneId: "Z1234567890ABC",
          hostedZoneName: "cloudmarkup.com",
        },
        target: betaTarget,
      }),
    ).toThrow(/cannot own or mutate Route 53 records/u);

    expect(() =>
      createBetaEnvironmentConfig({
        domain: {
          certificateArn:
            "arn:aws:acm:us-east-1:000000000000:certificate/11111111-2222-3333-4444-555555555555",
          createDnsRecords: false,
          domainName: "beta.example.invalid",
          hostedZoneId: "Z1234567890ABC",
        },
        target: betaTarget,
      }),
    ).toThrow(/cannot own or mutate Route 53 records/u);
  });

  test("requires an explicit beta-only opt-in for preparation of auto-pause", () => {
    const base = betaConfig();
    expect(base.database).not.toHaveProperty("betaAutoPauseEnabled");
    const database = {
      ...base.database,
      betaAutoPauseEnabled: true,
      minCapacityAcu: 0,
      autoPauseMinutes: 15,
    };
    expect(defineEnvironmentConfig({ ...base, database }).database).toEqual(
      database,
    );
    expectInvalid(
      { ...base, database: { ...database, betaAutoPauseEnabled: false } },
      /cannot pause/u,
    );
    expectInvalid(
      { ...base, database: { ...database, betaAutoPauseEnabled: undefined } },
      /cannot pause/u,
    );
    expectInvalid({ ...base, database: { ...database, minCapacityAcu: 0.5 } });
    expectInvalid(
      {
        ...base,
        database: {
          ...base.database,
          betaAutoPauseEnabled: true,
          minCapacityAcu: 0,
        },
      },
      /explicit zero minimum and pause interval/u,
    );
  });

  test.each(["true", 1, null])(
    "rejects malformed beta auto-pause opt-in (%j)",
    (value) => {
      const base = betaConfig();
      expectInvalid(
        {
          ...base,
          database: {
            ...base.database,
            betaAutoPauseEnabled: value as unknown as boolean,
          },
        },
        /beta-only Boolean/u,
      );
    },
  );

  test("cannot apply the beta auto-pause exception to production or staging", () => {
    for (const base of [
      createProdEnvironmentConfig(prodTarget),
      createStagingEnvironmentConfig(stagingTarget),
    ]) {
      expectInvalid(
        {
          ...base,
          database: {
            ...base.database,
            betaAutoPauseEnabled: true,
            minCapacityAcu: 0,
            autoPauseMinutes: 15,
          },
        },
        /beta-only Boolean/u,
      );
    }
  });

  test("fails closed when beta loses state, domain, or first-beta controls", () => {
    const config = betaConfig();
    expectInvalid(
      {
        ...config,
        lifecycle: { deletionProtection: false, removalPolicy: "retain" },
      },
      /beta and production require deletion protection/u,
    );
    expectInvalid(
      { ...config, database: { ...config.database, backupRetentionDays: 6 } },
      /at least seven days/u,
    );
    expectInvalid(
      {
        ...config,
        database: {
          ...config.database,
          autoPauseMinutes: 15,
          minCapacityAcu: 0,
        },
      },
      /cannot pause/u,
    );
    expectInvalid({ ...config, domain: undefined }, /explicit HTTPS domain/u);
    expectInvalid(
      withFeatures(config, { waf: false }),
      /requires beta access/u,
    );
    expectInvalid(
      withFeatures(config, { applicationGeneration: true }),
      /hosted application generation/u,
    );
    expectInvalid(
      withFeatures(config, { staticValidation: true }),
      /static validation remain disabled/u,
    );
  });

  test.each([
    ["account", { account: "12345678901", region: "us-east-1" }],
    ["region", { account: "123456789012", region: "us-east" }],
  ] as const)("rejects an invalid AWS %s", (_label, target) => {
    expect(() => createStagingEnvironmentConfig(target)).toThrow(
      /Invalid CloudMarkup environment configuration/u,
    );
  });

  test("rejects malformed and cross-zone domain configuration", () => {
    const config = createDevEnvironmentConfig();
    expectInvalid(
      withDomain(config, {
        ...domainFixture(config.target.account),
        domainName: "App.example.com",
      }),
      /domain\.domainName/u,
    );
    expectInvalid(
      withDomain(config, {
        ...domainFixture(config.target.account),
        domainName: "notexample.com",
        hostedZoneName: "example.com",
      }),
      /configured hosted zone/u,
    );
    expectInvalid(
      withDomain(config, {
        ...domainFixture(config.target.account),
        hostedZoneId: "example-zone",
      }),
      /hostedZoneId/u,
    );
  });

  test("rejects invalid certificate, WAF, and Bedrock ARNs", () => {
    const config = createDevEnvironmentConfig();
    expectInvalid(
      withDomain(config, {
        ...domainFixture(config.target.account),
        certificateArn: "not-an-arn",
      }),
      /certificateArn/u,
    );
    expectInvalid(
      withDomain(config, domainFixture("111122223333")),
      /target account and partition/u,
    );
    expectInvalid(
      withDomain(config, {
        ...domainFixture(config.target.account),
        wafWebAclArn: "arn:aws:s3:::not-a-waf-resource",
      }),
      /wafWebAclArn/u,
    );
    expectInvalid(
      withDomain(config, {
        ...domainFixture(config.target.account),
        wafWebAclArn:
          "arn:aws:wafv2:us-east-1:111122223333:global/webacl/cloudmarkup/11111111-2222-3333-4444-555555555555",
      }),
      /target account and partition/u,
    );
    expectInvalid(
      withDomain(config, {
        ...domainFixture(config.target.account),
        wafWebAclMetricName: undefined,
      }),
      /must be supplied together/u,
    );
    expectInvalid(
      withDomain(config, {
        ...domainFixture(config.target.account),
        wafWebAclArn: undefined,
      }),
      /must be supplied together/u,
    );
    expectInvalid(
      withDomain(config, {
        ...domainFixture(config.target.account),
        wafWebAclMetricName: "Default_Action",
      }),
      /wafWebAclMetricName/u,
    );
    for (const wafWebAclMetricName of [
      "invalid.metric",
      "invalid:metric",
      "invalid/metric",
      "invalid#metric",
    ]) {
      expectInvalid(
        withDomain(config, {
          ...domainFixture(config.target.account),
          wafWebAclMetricName,
        }),
        /wafWebAclMetricName/u,
      );
    }
    expectInvalid(
      withDomain(config, {
        ...domainFixture(config.target.account),
        wafWebAclMetricName: 123 as unknown as string,
      }),
      /wafWebAclMetricName/u,
    );
    expectInvalid({
      ...config,
      integrations: {
        ...config.integrations,
        bedrock: {
          inferenceProfileArns: [],
          modelArns: ["arn:aws:s3:::not-a-bedrock-resource"],
        },
      },
    });
    expectInvalid({
      ...config,
      integrations: {
        ...config.integrations,
        bedrock: {
          inferenceProfileArns: [],
          modelArns: [
            "arn:aws:bedrock:us-east-1:000000000000:guardrail/not-a-model",
          ],
        },
      },
    });
    expectInvalid({
      ...config,
      integrations: {
        ...config.integrations,
        bedrock: {
          inferenceProfileArns: [],
          modelArns: ["arn:aws:bedrock:::foundation-model/example.model-v1:0"],
        },
      },
    });
    expectInvalid({
      ...config,
      integrations: {
        ...config.integrations,
        bedrock: {
          inferenceProfileArns: [
            "arn:aws:bedrock:us-east-1:111122223333:inference-profile/us.example.model-v1:0",
          ],
          modelArns: [],
        },
      },
    });
  });

  test("rejects unsupported retention and invalid database capacity", () => {
    const config = createDevEnvironmentConfig();
    expectInvalid({
      ...config,
      retention: { ...config.retention, logsDays: 2 },
    });
    expectInvalid({
      ...config,
      retention: { ...config.retention, artifactDays: 0 },
    });
    expectInvalid({
      ...config,
      retention: {
        ...config.retention,
        evidence: "expire" as EnvironmentConfig["retention"]["evidence"],
      },
    });
    expectInvalid({
      ...config,
      database: { ...config.database, minCapacityAcu: 0.25 },
    });
    expectInvalid({
      ...config,
      database: {
        ...config.database,
        maxCapacityAcu: config.database.minCapacityAcu,
      },
    });
    expectInvalid({
      ...config,
      limits: { ...config.limits, workerConcurrency: 1 },
    });
    expectInvalid(
      { ...config, limits: { ...config.limits, apiConcurrency: 0 } },
      /apiConcurrency/u,
    );
    expectInvalid(
      {
        ...config,
        limits: { ...config.limits, wafApiRequestsPerFiveMinutes: 9 },
      },
      /wafApiRequestsPerFiveMinutes/u,
    );
    expectInvalid(
      {
        ...config,
        limits: {
          ...config.limits,
          wafWebhookRequestsPerFiveMinutes:
            config.limits.wafApiRequestsPerFiveMinutes + 1,
        },
      },
      /cannot exceed/u,
    );
    expectInvalid(
      {
        ...config,
        budget: {
          ...config.budget,
          anomalyThresholdUsd: config.budget.monthlyLimitUsd + 1,
        },
      },
      /anomalyThresholdUsd/u,
    );
  });

  test("requires exact runtime types for security and integration controls", () => {
    const config = createDevEnvironmentConfig();
    expectInvalid(
      {
        ...config,
        features: {
          ...config.features,
          billing: "false" as unknown as boolean,
        },
      },
      /values must be booleans/u,
    );
    expectInvalid(
      {
        ...config,
        features: {
          ...config.features,
          unexpectedCapability: true,
        } as EnvironmentConfig["features"],
      },
      /exact supported keys/u,
    );
    expectInvalid(
      {
        ...config,
        lifecycle: {
          ...config.lifecycle,
          deletionProtection: "false" as unknown as boolean,
        },
      },
      /deletionProtection must be a boolean/u,
    );
    expectInvalid(
      withDomain(config, {
        ...domainFixture(config.target.account),
        createDnsRecords: "false" as unknown as boolean,
      }),
      /createDnsRecords must be a boolean/u,
    );
    expectInvalid(
      {
        ...config,
        integrations: {
          ...config.integrations,
          stripe: {
            ...config.integrations.stripe,
            apiKeySecretName: 123 as unknown as string,
          },
        },
      },
      /logical secret name/u,
    );
    expectInvalid(
      {
        ...config,
        integrations: {
          ...config.integrations,
          github: {
            ...config.integrations.github,
            appId: 123 as unknown as string,
          },
        },
      },
      /GitHub App/u,
    );
    expectInvalid(
      {
        ...config,
        integrations: {
          ...config.integrations,
          github: {
            ...config.integrations.github,
            webhookSecretName: 123 as unknown as string,
          },
        },
      },
      /logical secret name/u,
    );
    expectInvalid(
      {
        ...config,
        integrations: {
          ...config.integrations,
          stripe: {
            ...config.integrations.stripe,
            starterPriceId: 123 as unknown as string,
          },
        },
      },
      /Stripe identifiers/u,
    );
    expectInvalid(
      {
        ...config,
        tags: { ...config.tags, Numeric: 123 as unknown as string },
      },
      /tags must be nonempty/u,
    );
  });

  test("keeps deterministic application generation independent from AI authoring", () => {
    const config = createDevEnvironmentConfig();
    expectInvalid(withFeatures(config, { aiAuthoring: true }), /Bedrock/u);
    expect(() =>
      defineEnvironmentConfig(
        withFeatures(config, { applicationGeneration: true }),
      ),
    ).not.toThrow();

    const configured = withFeatures(
      {
        ...config,
        integrations: {
          ...config.integrations,
          bedrock: {
            inferenceProfileArns: [],
            modelArns: [
              "arn:aws:bedrock:us-east-1::foundation-model/example.model-v1:0",
            ],
          },
        },
      },
      { aiAuthoring: true },
    );
    expect(() => defineEnvironmentConfig(configured)).not.toThrow();
  });

  test("requires reviewed billing identifiers before billing is enabled", () => {
    const config = createDevEnvironmentConfig();
    expectInvalid(withFeatures(config, { billing: true }), /billing requires/u);

    const configured = withFeatures(
      {
        ...config,
        integrations: {
          ...config.integrations,
          stripe: {
            ...config.integrations.stripe,
            portalConfigurationId: "bpc_reviewed",
            proPriceId: "price_pro",
            proProductId: "prod_pro",
            starterPriceId: "price_starter",
            starterProductId: "prod_starter",
          },
        },
      },
      { billing: true },
    );
    expect(() => defineEnvironmentConfig(configured)).not.toThrow();
  });

  test("separates test/live Stripe configuration and validates beta mapping, policy, URLs, grace, and rotation", () => {
    const config = createDevEnvironmentConfig();
    expect(config.integrations.stripe).toMatchObject({
      cancellationPolicy: "period-end-default",
      currency: "USD",
      environment: "test",
      graceHours: 0,
      proCreditUnits: 1000,
      starterCreditUnits: 200,
      trialPolicy: "no-trial",
    });
    expect(config.integrations.stripe).not.toHaveProperty(
      "publishableKeyIdentifier",
    );

    expectInvalid(
      {
        ...config,
        integrations: {
          ...config.integrations,
          stripe: { ...config.integrations.stripe, environment: "live" },
        },
      },
      /live.*reviewed/u,
    );
    expectInvalid(
      {
        ...config,
        integrations: {
          ...config.integrations,
          stripe: { ...config.integrations.stripe, graceHours: 721 },
        },
      },
      /graceHours/u,
    );
    expectInvalid(
      {
        ...config,
        integrations: {
          ...config.integrations,
          stripe: {
            ...config.integrations.stripe,
            successUrl: "http://attacker.example/success",
          },
        },
      },
      /must use HTTPS/u,
    );
    expectInvalid(
      {
        ...config,
        integrations: {
          ...config.integrations,
          stripe: {
            ...config.integrations.stripe,
            previousWebhookSigningSecretName:
              config.integrations.stripe.webhookSigningSecretName,
          },
        },
      },
      /must differ/u,
    );

    expect(() =>
      defineEnvironmentConfig({
        ...config,
        integrations: {
          ...config.integrations,
          stripe: {
            ...config.integrations.stripe,
            graceHours: 48,
            previousWebhookSigningSecretName:
              "cloudmarkup/dev/stripe/webhook-signing-secret-previous",
          },
        },
      }),
    ).not.toThrow();
  });
  test("requires a GitHub App and keeps WAF-enabled observability in us-east-1", () => {
    const config = createDevEnvironmentConfig();
    expectInvalid(withFeatures(config, { githubExport: true }), /GitHub App/u);
    expect(() =>
      defineEnvironmentConfig(withFeatures(config, { waf: true })),
    ).not.toThrow();

    const github = withFeatures(
      {
        ...config,
        integrations: {
          ...config.integrations,
          github: { ...config.integrations.github, appId: "123456" },
        },
      },
      { githubExport: true },
    );
    expect(() => defineEnvironmentConfig(github)).not.toThrow();

    const staging = createStagingEnvironmentConfig(stagingTarget);
    expectInvalid(withFeatures(staging, { waf: true }), /us-east-1 target/u);
    const waf = withFeatures(
      withDomain(staging, domainFixture(staging.target.account)),
      { waf: true },
    );
    expectInvalid(waf, /cross-Region CloudFront WAF observability/u);
  });

  test("fails closed for unsafe production lifecycle and database settings", () => {
    const prod = createProdEnvironmentConfig(prodTarget);
    expect(() => defineEnvironmentConfig(prod)).not.toThrow();
    expectInvalid({
      ...prod,
      lifecycle: { ...prod.lifecycle, removalPolicy: "destroy" },
    });
    expectInvalid({
      ...prod,
      lifecycle: { ...prod.lifecycle, deletionProtection: false },
    });
    expectInvalid({
      ...prod,
      database: {
        ...prod.database,
        autoPauseMinutes: 15,
        minCapacityAcu: 0,
      },
    });
  });

  test("keeps environment overlays and logical secret references isolated", () => {
    const staging = createStagingEnvironmentConfig(stagingTarget);
    const prod = createProdEnvironmentConfig(prodTarget);

    expect(staging.integrations.stripe.apiKeySecretName).toMatch(
      /^cloudmarkup\/staging\//u,
    );
    expect(prod.integrations.stripe.apiKeySecretName).toMatch(
      /^cloudmarkup\/prod\//u,
    );
    expect(staging.integrations).not.toBe(prod.integrations);
    expect(staging.features).not.toBe(prod.features);
    expectInvalid(
      {
        ...prod,
        integrations: {
          ...prod.integrations,
          stripe: {
            ...prod.integrations.stripe,
            apiKeySecretName: staging.integrations.stripe.apiKeySecretName,
          },
        },
      },
      /exact environment/u,
    );
    expectInvalid(
      {
        ...staging,
        tags: { ...staging.tags, Environment: "dev" },
      },
      /tags\.Environment/u,
    );
  });

  test("rejects literal secret fields and recognizable secret values", () => {
    const config = createDevEnvironmentConfig();
    const syntheticPrivateKeyMarker = [
      "-----BEGIN",
      "PRIVATE",
      "KEY-----",
      "synthetic-validation-fixture",
    ].join(" ");
    const literalField: EnvironmentConfig & { readonly stripeApiKey: string } =
      {
        ...config,
        stripeApiKey: "literal-value",
      };
    expectInvalid(literalField, /literal-secret field/u);
    expectInvalid(
      {
        ...config,
        tags: { ...config.tags, LeakedValue: "sk_live_1234567890" },
      },
      /literal secret value/u,
    );
    expectInvalid(
      {
        ...config,
        tags: {
          ...config.tags,
          LeakedValue: syntheticPrivateKeyMarker,
        },
      },
      /literal secret value/u,
    );
  });
});
