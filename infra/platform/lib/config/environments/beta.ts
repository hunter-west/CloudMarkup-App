import {
  baseEnvironmentConfig,
  defineEnvironmentConfig,
  type DomainConfiguration,
  type EnvironmentConfig,
  type EnvironmentTarget,
} from "../environment-config.js";

export interface BetaServiceInputs {
  readonly profile:
    | "core-v1"
    | "stripe-sandbox-v1"
    | "stripe-sandbox-github-connections-v1"
    | "stripe-sandbox-github-cloudformation-v1"
    | "stripe-live-github-cloudformation-v1";
  readonly sessionsEnabled: boolean;
  readonly signingArn: string;
  readonly previousArn: string;
}

export interface BetaEnvironmentInputs {
  readonly domain: DomainConfiguration;
  readonly service?: BetaServiceInputs;
  readonly target: EnvironmentTarget;
}

/**
 * A network-accessible, nonproduction profile with durable customer state.
 * Optional paid/provider integrations remain disabled until their separately
 * reviewed identifiers and runtime composition are supplied.
 */
export function createBetaEnvironmentConfig(
  inputs: BetaEnvironmentInputs,
): EnvironmentConfig {
  if (
    inputs.domain.createDnsRecords ||
    inputs.domain.hostedZoneId !== undefined ||
    inputs.domain.hostedZoneName !== undefined
  ) {
    throw new Error(
      "The controlled-beta application account cannot own or mutate Route 53 records; use the reviewed cross-account DNS role with createDnsRecords=false.",
    );
  }
  const base = baseEnvironmentConfig("beta", inputs.target);
  const service = inputs.service ?? {
    profile: "core-v1",
    sessionsEnabled: false,
    signingArn: "",
    previousArn: "",
  };
  if (
    ![
      "core-v1",
      "stripe-sandbox-v1",
      "stripe-sandbox-github-connections-v1",
      "stripe-sandbox-github-cloudformation-v1",
      "stripe-live-github-cloudformation-v1",
    ].includes(service.profile) ||
    typeof service.sessionsEnabled !== "boolean" ||
    typeof service.signingArn !== "string" ||
    typeof service.previousArn !== "string" ||
    (service.profile === "core-v1" &&
      (service.sessionsEnabled ||
        service.signingArn !== "" ||
        service.previousArn !== ""))
  ) {
    throw new TypeError(
      "The beta service selector is not a reviewed configuration.",
    );
  }
  const live = service.profile === "stripe-live-github-cloudformation-v1";
  const sandbox = service.profile !== "core-v1";
  const cloudFormationExport =
    service.profile === "stripe-sandbox-github-cloudformation-v1" || live;
  const githubConnections =
    cloudFormationExport ||
    service.profile === "stripe-sandbox-github-connections-v1";
  const applicationUrl = `https://${inputs.domain.domainName}`;
  return defineEnvironmentConfig({
    ...base,
    accountAccess: {
      schemaVersion: 1,
      managedLogin: true,
      registrationEnabled: true,
    },
    domain: { ...inputs.domain },
    limits: {
      ...base.limits,
      ...(cloudFormationExport
        ? { apiTimeoutSeconds: 29 }
        : sandbox
          ? { apiTimeoutSeconds: 25 }
          : {}),
    },
    features: {
      ...base.features,
      betaAccess: true,
      billing: sandbox,
      waf: true,
    },
    integrations: {
      ...base.integrations,
      ...(cloudFormationExport ? { solutionExport: { enabled: true } } : {}),
      github: {
        ...base.integrations.github,
        appId: "123456",
        appSlug: "cloudmarkup-example-beta",
        clientId: "IvEXAMPLE000000000000",
        clientSecretArn:
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:Github-App-Client-Secret-EX0001",
        clientSecretJsonField: "Client secret",
        // Activation additionally requires exact setup/OAuth registration and
        // the separately owned bootstrap EnableGitHubConnections policy flag.
        connectionsEnabled: githubConnections,
        privateKeySecretArn:
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/github/app-private-key-EX0002",
      },
      stripe: {
        ...base.integrations.stripe,
        deliveryEnabled: sandbox,
        ...(live
          ? {
              environment: "live" as const,
              apiKeySecretName: "cloudmarkup/beta/stripe/live/api-key",
              webhookSigningSecretName:
                "cloudmarkup/beta/stripe/live/webhook-signing-secret",
            }
          : {}),
        ...(cloudFormationExport
          ? {
              planMappingVersion:
                "cloudmarkup-starter-pro-credit-mapping-2026-09-30-v4",
            }
          : {}),
        sessionsEnabled: service.sessionsEnabled,
        ...(sandbox
          ? {
              graceHours: 0,
              webhookSigningSecretArn: service.signingArn,
              ...(service.previousArn === ""
                ? {}
                : {
                    previousWebhookSigningSecretName:
                      "cloudmarkup/beta/stripe/webhook-signing-previous",
                    previousWebhookSigningSecretArn: service.previousArn,
                  }),
            }
          : {}),
        apiKeySecretArn: live
          ? "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/live/api-key-EX0003"
          : "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/api-key-EX0004",
        // Verified sandbox objects; core remains disabled. The production
        // session host derives the exact organization return route itself.
        cancelUrl: `${applicationUrl}/organizations`,
        portalConfigurationId: live ? "bpc_ExampleLive" : "bpc_ExampleTest",
        portalReturnUrl: `${applicationUrl}/organizations`,
        proPriceId: live ? "price_ExampleProLive" : "price_ExampleProTest",
        proProductId: live ? "prod_ExampleProLive" : "prod_ExampleProTest",
        starterPriceId: live
          ? "price_ExampleStarterLive"
          : "price_ExampleStarterTest",
        starterProductId: live
          ? "prod_ExampleStarterLive"
          : "prod_ExampleStarterTest",
        successUrl: `${applicationUrl}/organizations`,
      },
    },
  });
}
