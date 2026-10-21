#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { App } from "aws-cdk-lib";

import type {
  EnvironmentName,
  EnvironmentTarget,
} from "../lib/config/environment-config.js";
import {
  createBetaEnvironmentConfig,
  type BetaServiceInputs,
} from "../lib/config/environments/beta.js";
import { createDevEnvironmentConfig } from "../lib/config/environments/dev.js";
import { createProdEnvironmentConfig } from "../lib/config/environments/prod.js";
import { createStagingEnvironmentConfig } from "../lib/config/environments/staging.js";
import { CloudMarkupStage } from "../lib/stages/cloudmarkup-stage.js";

function requiredContext(app: App, name: string): string {
  const value: unknown = app.node.tryGetContext(name);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`CDK context ${name} is required.`);
  }
  return value.trim();
}

function environmentTarget(app: App): EnvironmentTarget {
  return {
    account: requiredContext(app, "account"),
    region: requiredContext(app, "region"),
  };
}

function requiredBooleanContext(app: App, name: string): boolean {
  const value = requiredContext(app, name);
  if (value !== "false" && value !== "true") {
    throw new TypeError(`CDK context ${name} must be true or false.`);
  }
  return value === "true";
}

function betaDomainName(app: App): string {
  const value = requiredContext(app, "baseUrl");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("CDK context baseUrl must be an exact HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("CDK context baseUrl must be an exact HTTPS origin.");
  }
  return url.hostname;
}

function betaServiceInputs(app: App): BetaServiceInputs {
  const value = (name: string, fallback = ""): string => {
    const input: unknown = app.node.tryGetContext(name);
    if (input === undefined || input === "") return fallback;
    if (typeof input !== "string" || input.trim() !== input)
      throw new TypeError("CDK beta service context must be an exact string.");
    return input;
  };
  const profile = value("serviceProfile", "core-v1");
  const sessions = value("stripeSandboxSessionsEnabled", "false");
  if (
    (profile !== "core-v1" &&
      profile !== "stripe-sandbox-v1" &&
      profile !== "stripe-sandbox-github-connections-v1" &&
      profile !== "stripe-sandbox-github-cloudformation-v1" &&
      profile !== "stripe-live-github-cloudformation-v1") ||
    (sessions !== "true" && sessions !== "false")
  )
    throw new TypeError("CDK beta service selector is not reviewed.");
  return {
    profile,
    sessionsEnabled: sessions === "true",
    signingArn: value("stripeWebhookSigningSecretArn"),
    previousArn: value("stripePreviousWebhookSigningSecretArn"),
  };
}

const app = new App({ analyticsReporting: false });
const environment = requiredContext(app, "environment") as EnvironmentName;
const config = (() => {
  switch (environment) {
    case "beta": {
      const createDnsRecords = requiredBooleanContext(app, "createDnsRecords");
      return createBetaEnvironmentConfig({
        service: betaServiceInputs(app),
        domain: {
          certificateArn: requiredContext(app, "certificateArn"),
          createDnsRecords,
          domainName: betaDomainName(app),
          ...(createDnsRecords
            ? {
                hostedZoneId: requiredContext(app, "hostedZoneId"),
                hostedZoneName: requiredContext(app, "hostedZoneName"),
              }
            : {}),
        },
        target: environmentTarget(app),
      });
    }
    case "dev":
      return createDevEnvironmentConfig();
    case "staging":
      return createStagingEnvironmentConfig(environmentTarget(app));
    case "prod":
      return createProdEnvironmentConfig(environmentTarget(app));
    default:
      throw new TypeError(
        "CDK context environment must be beta, dev, staging, or prod.",
      );
  }
})();

new CloudMarkupStage(app, `CloudMarkup-${config.environment}`, {
  config,
  ...(config.environment === "beta"
    ? {
        webAssetsPath: fileURLToPath(
          new URL("../../../apps/web/dist/", import.meta.url),
        ),
      }
    : {}),
});
