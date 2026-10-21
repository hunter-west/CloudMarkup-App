import { fileURLToPath } from "node:url";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, it, expect } from "vitest";
import { defineEnvironmentConfig } from "../lib/config/environment-config.js";
import { createBetaEnvironmentConfig } from "../lib/config/environments/beta.js";
import { CloudMarkupStage } from "../lib/stages/cloudmarkup-stage.js";
import { createTemplateTestApp } from "./template-test-app.js";
function base() {
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
describe("provider-enforced account registration", { timeout: 30000 }, () => {
  it.each([false, true])(
    "derives provider signup and public capabilities from one flag: %s",
    (registrationEnabled) => {
      const accountAccess = {
        schemaVersion: 1 as const,
        managedLogin: true,
        registrationEnabled,
      };
      const accountSecurity = {
        schemaVersion: 1 as const,
        recoveryContact: { kind: "email" as const, value: "help@example.com" },
      };
      const config = defineEnvironmentConfig({
        ...base(),
        accountAccess,
        accountSecurity,
      });
      const stage = new CloudMarkupStage(
        createTemplateTestApp(),
        "AccountAccess",
        {
          config,
          webAssetsPath: fileURLToPath(
            new URL("fixtures/web-dist/", import.meta.url),
          ),
        },
      );
      const template = Template.fromStack(stage.application);
      template.hasResourceProperties("AWS::Cognito::UserPool", {
        AdminCreateUserConfig: {
          AllowAdminCreateUserOnly: !registrationEnabled,
        },
        UserPoolTier: "ESSENTIALS",
        UserAttributeUpdateSettings: {
          AttributesRequireVerificationBeforeUpdate: ["email"],
        },
        AccountRecoverySetting: {
          RecoveryMechanisms: [{ Name: "verified_email", Priority: 1 }],
        },
        MfaConfiguration: "OPTIONAL",
      });
      template.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
        ManagedLoginVersion: 2,
      });
      template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        GenerateSecret: false,
        AllowedOAuthFlows: ["code"],
        AllowedOAuthScopes: Match.arrayWith([
          "openid",
          "profile",
          {
            "Fn::Join": [
              "",
              [
                {
                  Ref: Object.keys(
                    template.findResources(
                      "AWS::Cognito::UserPoolResourceServer",
                    ),
                  )[0],
                },
                "/access",
              ],
            ],
          },
          "aws.cognito.signin.user.admin",
        ]),
        EnableTokenRevocation: true,
      });
      template.hasResourceProperties("AWS::Lambda::Function", {
        Environment: {
          Variables: {
            CLOUDMARKUP_ACCOUNT_ACCESS: JSON.stringify(accountAccess),
            CLOUDMARKUP_ACCOUNT_SECURITY: JSON.stringify(accountSecurity),
          },
        },
      });
      template.hasResourceProperties("AWS::Cognito::ManagedLoginBranding", {
        UseCognitoProvidedValues: false,
        Settings: {
          categories: { global: { colorSchemeMode: "LIGHT" } },
          components: {
            form: { logo: { enabled: true } },
            primaryButton: {
              lightMode: { defaults: { backgroundColor: "315efbff" } },
            },
          },
        },
        Assets: [
          {
            Category: "FORM_LOGO",
            ColorMode: "LIGHT",
            Extension: "PNG",
            Bytes: Match.stringLikeRegexp("^[A-Za-z0-9+/]+=*$"),
          },
        ],
      });
      expect(JSON.stringify(template.toJSON()).length).toBeLessThan(1_000_000);
      expect(config.integrations.stripe.sessionsEnabled).toBe(false);
    },
  );
  it("opens beta signup while rejecting ambiguous configuration", () => {
    expect(base().accountSecurity).toBeUndefined();
    for (const accountSecurity of [
      { schemaVersion: 2, recoveryContact: null },
      {
        schemaVersion: 1,
        recoveryContact: { kind: "url", value: "http://example.com" },
      },
      { schemaVersion: 1, recoveryContact: null, enabled: true },
    ]) {
      expect(() =>
        defineEnvironmentConfig({ ...base(), accountSecurity } as ReturnType<
          typeof base
        >),
      ).toThrow();
    }
    expect(base().accountAccess).toEqual({
      schemaVersion: 1,
      managedLogin: true,
      registrationEnabled: true,
    });
    for (const accountAccess of [
      { schemaVersion: 1, managedLogin: false, registrationEnabled: true },
      { schemaVersion: 1, managedLogin: true, registrationEnabled: "false" },
      {
        schemaVersion: 1,
        managedLogin: true,
        registrationEnabled: false,
        secret: "x",
      },
    ]) {
      expect(() =>
        defineEnvironmentConfig({ ...base(), accountAccess } as ReturnType<
          typeof base
        >),
      ).toThrow();
    }
  });
});
