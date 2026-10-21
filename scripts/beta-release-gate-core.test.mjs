import "./beta-solution-export-admission.test.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./beta-sandbox-delivery-admission.test.mjs";

import {
  BETA_RELEASE_EXPECTED,
  BETA_WEB_BRAND_ASSETS,
  validateBetaApiBuild,
  validateBetaAssembly,
  validateBetaRepositoryImport,
  validateBetaReleaseEnvironment,
  validateBetaWebBuild,
} from "./beta-release-gate-core.mjs";

const validEnvironment = Object.freeze({
  AWS_ACCOUNT_ID: BETA_RELEASE_EXPECTED.accountId,
  AWS_REGION: BETA_RELEASE_EXPECTED.region,
  AWS_ROLE_ARN: BETA_RELEASE_EXPECTED.roleArn,
  BETA_BASE_URL: BETA_RELEASE_EXPECTED.baseUrl,
  BETA_CERTIFICATE_ARN:
    "arn:aws:acm:us-east-1:000000000000:certificate/12345678-1234-1234-1234-123456789abc",
  BETA_CREATE_DNS_RECORDS: "false",
  CLOUDMARKUP_ENVIRONMENT: "beta",
  DEPLOYMENT_BUNDLE_SHA256: "c".repeat(64),
  GITHUB_SHA: "d".repeat(40),
  SOURCE_REVISION: "d".repeat(40),
});

function codes(findings) {
  return findings.map(({ code }) => code);
}

test("keeps exact release, receipt and bundled SQL pins aligned with the registered manifest", async () => {
  const [
    manifest,
    gate,
    production,
    stack,
    handoff,
    migrator,
    cleanup,
    cleanupSchema,
  ] = await Promise.all(
    [
      "../apps/api/migrations/manifest.json",
      "./beta-release-gate-core.mjs",
      "../apps/api/src/production-composition.ts",
      "../infra/platform/lib/stacks/application-stack.ts",
      "../infra/platform/lib/deployment-output-handoff.ts",
      "../infra/platform/runtime/database-migrator.ts",
      "../apps/api/src/production-project-content-cleanup.ts",
      "../apps/api/src/production-cleanup-schema.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  const parsed = JSON.parse(manifest);
  assert.equal(
    gate.match(
      /const BETA_PROJECT_CLEANUP_SCHEMA_CHECKSUM =\s*"([0-9a-f]{64})"/u,
    )?.[1],
    parsed.migrations.at(-1).checksumSha256,
  );
  const version = parsed.migrations.at(-1).version;
  assert.match(version, /^[0-9]{4}$/u);
  assert.equal(cleanupSchema.match(/version: "([0-9]{4})"/u)?.[1], version);
  assert.deepEqual(
    [
      ...cleanupSchema.matchAll(
        /\bconst schemaChecksum\s*=\s*"([0-9a-f]{64})"/gu,
      ),
    ].map((match) => match[1]),
    [parsed.migrations.at(-1).checksumSha256],
  );
  assert.match(
    cleanupSchema,
    /Object\.freeze\(\{\s*version: "[0-9]{4}",\s*checksumSha256: schemaChecksum,\s*\}\)/u,
  );
  assert.match(cleanup, /PROJECT_CLEANUP_SCHEMA\.version/u);
  assert.match(cleanup, /assertCleanupSchema\(database\)/u);
  assert.deepEqual(
    [
      ...gate.matchAll(
        /(?:variables\.CLOUDMARKUP_EXPECTED_SCHEMA_VERSION|resource\.Properties\?\.ExpectedSchemaVersion) === "([0-9]{4})"/gu,
      ),
    ].map((match) => match[1]),
    [version, version],
  );
  assert.equal(
    production.match(
      /exact\(environment, "CLOUDMARKUP_EXPECTED_SCHEMA_VERSION", "([0-9]{4})"\)/u,
    )?.[1],
    version,
  );
  assert.equal(
    stack.match(/DATABASE_MIGRATION_EXPECTED_VERSION = "([0-9]{4})"/u)?.[1],
    version,
  );
  assert.equal(
    stack.match(
      /DATABASE_MIGRATION_MANIFEST_SHA256\s*=\s*"([0-9a-f]{64})"/u,
    )?.[1],
    createHash("sha256")
      .update(`${JSON.stringify(parsed, null, 2)}\n`)
      .digest("hex"),
  );
  assert.equal(
    handoff.match(
      /outputs\.DatabaseMigrationExpectedVersion !== "([0-9]{4})"/u,
    )?.[1],
    version,
  );
  assert.equal(
    handoff.match(/outputs\.DatabaseMigrationCount !== "([0-9]+)"/u)?.[1],
    String(parsed.migrations.length),
  );
  assert.deepEqual(
    [
      ...migrator.matchAll(
        /import migration([0-9]{4}) from "\.\.\/\.\.\/\.\.\/apps\/api\/migrations\/([0-9]{4}_[a-z0-9_]+\.sql)"/gu,
      ),
    ].map((match) => ({ version: match[1], file: match[2] })),
    parsed.migrations.map(({ version, file }) => ({ version, file })),
  );
  assert.deepEqual(
    [
      ...migrator.matchAll(
        /"([0-9]{4}_[a-z0-9_]+\.sql)": migration([0-9]{4})/gu,
      ),
    ].map((match) => ({ version: match[2], file: match[1] })),
    parsed.migrations.map(({ version, file }) => ({ version, file })),
  );
});

function validWebBuildFiles() {
  return [
    {
      path: "index.html",
      text: [
        '<link rel="icon" href="/favicon.ico" sizes="any" type="image/x-icon">',
        '<link rel="icon" href="/app-icon-192.png" sizes="192x192" type="image/png">',
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" type="image/png">',
        '<link rel="manifest" href="/site.webmanifest">',
        '<main id="root"></main>',
      ].join(""),
    },
    {
      path: "site.webmanifest",
      text: JSON.stringify({
        id: "/",
        name: "Cloud Markup",
        short_name: "Cloud Markup",
        description:
          "Design, validate, and review professional cloud architecture.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          {
            src: "/app-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/app-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      }),
    },
    ...BETA_WEB_BRAND_ASSETS.map((asset) => ({ ...asset })),
    {
      path: "assets/application.js",
      text: "cloudmarkup.auth-composition/cognito-pkce-v1; productionComposition();",
    },
  ];
}

const reviewedApiPrefixFunctionCode = `
function handler(event) {
  var request = event.request;
  if (request.uri === '/api') {
    request.uri = '/';
  } else if (request.uri.indexOf('/api/') === 0) {
    request.uri = request.uri.substring(4);
  }
  return request;
}`;

function regionalOriginStacks() {
  const marker = {
    "Fn::Join": [
      "",
      [
        "{{resolve:secretsmanager:",
        { "Fn::ImportValue": "cloudmarkup-beta-stateful:EdgeOriginSecret" },
        ":SecretString:::}}",
      ],
    ],
  };
  return [
    {
      path: "application.template.json",
      stackName: "cloudmarkup-beta-application",
      template: {
        Resources: {
          ApiFunction: {
            Type: "AWS::Lambda::Function",
            Properties: {
              Environment: {
                Variables: {
                  CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION: marker,
                },
              },
              FunctionName: "cloudmarkup-beta-api",
            },
          },
          RestApi: {
            Type: "AWS::ApiGateway::RestApi",
            Properties: {
              DisableExecuteApiEndpoint: false,
              EndpointConfiguration: { Types: ["REGIONAL"] },
              Name: "cloudmarkup-beta-api",
            },
          },
          RuntimeConfigResource: {
            Type: "AWS::ApiGateway::Resource",
            Properties: {
              ParentId: { "Fn::GetAtt": ["RestApi", "RootResourceId"] },
              PathPart: "runtime-config",
              RestApiId: { Ref: "RestApi" },
            },
          },
          RuntimeConfigGet: {
            Type: "AWS::ApiGateway::Method",
            Properties: {
              AuthorizationType: "NONE",
              HttpMethod: "GET",
              Integration: {
                IntegrationHttpMethod: "POST",
                Type: "AWS_PROXY",
                Uri: {
                  "Fn::Join": [
                    "",
                    [
                      "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/",
                      { "Fn::GetAtt": ["ApiFunction", "Arn"] },
                      "/invocations",
                    ],
                  ],
                },
              },
              ResourceId: { Ref: "RuntimeConfigResource" },
              RestApiId: { Ref: "RestApi" },
            },
          },
          RestStage: {
            Type: "AWS::ApiGateway::Stage",
            Properties: {
              AccessLogSetting: {
                DestinationArn:
                  "arn:aws:logs:us-east-1:000000000000:log-group:/aws/apigateway/cloudmarkup-beta-api",
                Format: '{"status":$context.status}',
              },
              MethodSettings: [{ HttpMethod: "*", ResourcePath: "/*" }],
              RestApiId: { Ref: "RestApi" },
              StageName: "beta",
            },
          },
          RegionalOriginAccess: {
            Type: "AWS::WAFv2::WebACL",
            Properties: {
              DefaultAction: { Allow: {} },
              Name: "cloudmarkup-beta-regional-origin-access",
              Rules: [
                {
                  Action: { Block: {} },
                  Name: "RequireCloudFrontOriginMarker",
                  Priority: 0,
                  Statement: {
                    NotStatement: {
                      Statement: {
                        ByteMatchStatement: {
                          FieldToMatch: {
                            SingleHeader: {
                              Name: "x-cloudmarkup-edge-origin",
                            },
                          },
                          PositionalConstraint: "EXACTLY",
                          SearchString: marker,
                          TextTransformations: [{ Priority: 0, Type: "NONE" }],
                        },
                      },
                    },
                  },
                  VisibilityConfig: {
                    CloudWatchMetricsEnabled: true,
                    MetricName: "RequireCloudFrontOriginMarker",
                    SampledRequestsEnabled: false,
                  },
                },
              ],
              Scope: "REGIONAL",
              VisibilityConfig: {
                CloudWatchMetricsEnabled: true,
                MetricName: "cloudmarkup-beta-regional-origin-access",
                SampledRequestsEnabled: false,
              },
            },
          },
          RegionalOriginAssociation: {
            Type: "AWS::WAFv2::WebACLAssociation",
            Properties: {
              ResourceArn: {
                "Fn::Join": [
                  "",
                  [
                    "arn:",
                    { Ref: "AWS::Partition" },
                    ":apigateway:us-east-1::/restapis/",
                    { Ref: "RestApi" },
                    "/stages/",
                    { Ref: "RestStage" },
                  ],
                ],
              },
              WebACLArn: { "Fn::GetAtt": ["RegionalOriginAccess", "Arn"] },
            },
          },
        },
      },
    },
    {
      path: "edge.template.json",
      stackName: "cloudmarkup-beta-edge",
      template: {
        Resources: {
          StripApiPrefix: {
            Type: "AWS::CloudFront::Function",
            Properties: {
              AutoPublish: true,
              FunctionCode: reviewedApiPrefixFunctionCode,
              FunctionConfig: {
                Comment:
                  "Remove the browser-only /api prefix before HTTP API routing",
                Runtime: "cloudfront-js-2.0",
              },
              Name: "cloudmarkup-beta-strip-api-prefix",
            },
          },
          EdgeRateControls: {
            Type: "AWS::WAFv2::WebACL",
            Properties: {
              DefaultAction: { Allow: {} },
              Name: "cloudmarkup-beta-edge-rate-controls",
              Rules: [
                {
                  Action: { Block: { CustomResponse: { ResponseCode: 429 } } },
                  Name: "WebhookRateControl",
                  Priority: 0,
                  Statement: {
                    RateBasedStatement: {
                      AggregateKeyType: "IP",
                      EvaluationWindowSec: 300,
                      Limit: 1_000,
                      ScopeDownStatement: {
                        ByteMatchStatement: {
                          FieldToMatch: { UriPath: {} },
                          PositionalConstraint: "STARTS_WITH",
                          SearchString: "/api/webhooks/",
                          TextTransformations: [{ Priority: 0, Type: "NONE" }],
                        },
                      },
                    },
                  },
                  VisibilityConfig: {
                    CloudWatchMetricsEnabled: true,
                    MetricName: "WebhookRateControl",
                    SampledRequestsEnabled: false,
                  },
                },
                {
                  Action: { Block: { CustomResponse: { ResponseCode: 429 } } },
                  Name: "ApiRateControl",
                  Priority: 1,
                  Statement: {
                    RateBasedStatement: {
                      AggregateKeyType: "IP",
                      EvaluationWindowSec: 300,
                      Limit: 5_000,
                      ScopeDownStatement: {
                        ByteMatchStatement: {
                          FieldToMatch: { UriPath: {} },
                          PositionalConstraint: "STARTS_WITH",
                          SearchString: "/api/",
                          TextTransformations: [{ Priority: 0, Type: "NONE" }],
                        },
                      },
                    },
                  },
                  VisibilityConfig: {
                    CloudWatchMetricsEnabled: true,
                    MetricName: "ApiRateControl",
                    SampledRequestsEnabled: false,
                  },
                },
              ],
              Scope: "CLOUDFRONT",
              VisibilityConfig: {
                CloudWatchMetricsEnabled: true,
                MetricName: "cloudmarkup-beta-edge-rate-controls",
                SampledRequestsEnabled: false,
              },
            },
          },
          Distribution: {
            Type: "AWS::CloudFront::Distribution",
            Properties: {
              DistributionConfig: {
                Aliases: ["beta.example.invalid"],
                DefaultCacheBehavior: {
                  ResponseHeadersPolicyId: {
                    "Fn::ImportValue":
                      "cloudmarkup-beta-bootstrap:SecurityHeadersPolicyId",
                  },
                  TargetOriginId: "web-origin",
                },
                CacheBehaviors: [
                  {
                    FunctionAssociations: [
                      {
                        EventType: "viewer-request",
                        FunctionARN: {
                          "Fn::GetAtt": ["StripApiPrefix", "FunctionARN"],
                        },
                      },
                    ],
                    CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
                    Compress: false,
                    PathPattern: "/api/*",
                    ResponseHeadersPolicyId: {
                      "Fn::ImportValue":
                        "cloudmarkup-beta-bootstrap:ApiSecurityHeadersPolicyId",
                    },
                    TargetOriginId: "api-origin",
                  },
                  ...["/assets/*-????????.js", "/assets/*-????????.css"].map(
                    (PathPattern) => ({
                      PathPattern,
                      AllowedMethods: ["GET", "HEAD"],
                      CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
                      Compress: true,
                      ResponseHeadersPolicyId: {
                        "Fn::ImportValue":
                          "cloudmarkup-beta-bootstrap:PublicAssetHeadersPolicyId",
                      },
                      TargetOriginId: "web-origin",
                      ViewerProtocolPolicy: "redirect-to-https",
                    }),
                  ),
                ],
                Origins: [
                  {
                    DomainName: "bucket.s3.us-east-1.amazonaws.com",
                    Id: "web-origin",
                    OriginAccessControlId: {
                      "Fn::ImportValue":
                        "cloudmarkup-beta-bootstrap:WebOriginAccessControlId",
                    },
                    S3OriginConfig: { OriginAccessIdentity: "" },
                  },
                  {
                    CustomOriginConfig: {
                      OriginProtocolPolicy: "https-only",
                    },
                    DomainName: "rest.execute-api.us-east-1.amazonaws.com",
                    Id: "api-origin",
                    OriginCustomHeaders: [
                      {
                        HeaderName: "x-cloudmarkup-edge-origin",
                        HeaderValue: marker,
                      },
                    ],
                    OriginPath: {
                      "Fn::ImportValue":
                        "cloudmarkup-beta-application:RestApiDeploymentStage",
                    },
                  },
                ],
                WebACLId: { "Fn::GetAtt": ["EdgeRateControls", "Arn"] },
              },
            },
          },
        },
      },
    },
    {
      path: "observability.template.json",
      stackName: "cloudmarkup-beta-observability",
      template: {
        Resources: { AlarmTopic: { Type: "AWS::SNS::Topic" } },
      },
    },
    {
      path: "stateful.template.json",
      stackName: "cloudmarkup-beta-stateful",
      template: {
        Outputs: {
          EdgeOriginSecretExport: {
            Export: {
              Name: "cloudmarkup-beta-stateful:EdgeOriginSecret",
            },
            Value: { Ref: "EdgeOriginSecret" },
          },
        },
        Resources: {
          EdgeOriginSecret: {
            DeletionPolicy: "RetainExceptOnCreate",
            Properties: {
              GenerateSecretString: {
                ExcludePunctuation: true,
                IncludeSpace: false,
                PasswordLength: 64,
              },
              Name: "cloudmarkup-beta/edge/origin-verification",
            },
            Type: "AWS::SecretsManager::Secret",
            UpdateReplacePolicy: "Retain",
          },
        },
      },
    },
  ];
}

test("accepts complete reviewed non-secret release inputs", () => {
  assert.deepEqual(validateBetaReleaseEnvironment(validEnvironment), []);
});

test("requires same-run activation inputs only for deploy-time admission", () => {
  const activationKeys = new Set([
    "AWS_ROLE_ARN",
    "DEPLOYMENT_BUNDLE_SHA256",
    "GITHUB_SHA",
    "SOURCE_REVISION",
  ]);
  const stableEnvironment = Object.fromEntries(
    Object.entries(validEnvironment).filter(
      ([key]) => !activationKeys.has(key),
    ),
  );
  assert.deepEqual(
    validateBetaReleaseEnvironment(stableEnvironment, {
      requireActivation: false,
    }),
    [],
  );
  const deployCodes = codes(validateBetaReleaseEnvironment(stableEnvironment));
  assert.ok(deployCodes.includes("BETA_INPUT_MISSING"));
  assert.ok(deployCodes.includes("BETA_ROLE_MISMATCH"));
  assert.ok(deployCodes.includes("BETA_DEPLOYMENT_BUNDLE_DIGEST_INVALID"));
  assert.ok(deployCodes.includes("BETA_SOURCE_REVISION_MISMATCH"));
});

test("fails closed when a non-beta environment is selected", () => {
  const findings = validateBetaReleaseEnvironment({
    ...validEnvironment,
    CLOUDMARKUP_ENVIRONMENT: "dev",
  });
  assert.ok(codes(findings).includes("BETA_ENVIRONMENT_NOT_APPROVED"));
});

test("rejects a deployment bundle from a different source revision", () => {
  const findings = validateBetaReleaseEnvironment({
    ...validEnvironment,
    SOURCE_REVISION: "0".repeat(40),
  });
  assert.ok(codes(findings).includes("BETA_SOURCE_REVISION_MISMATCH"));
});

test("rejects a missing or malformed same-run deployment bundle digest", () => {
  for (const deploymentBundleSha256 of ["", "sha256:" + "c".repeat(64)]) {
    const findings = validateBetaReleaseEnvironment({
      ...validEnvironment,
      DEPLOYMENT_BUNDLE_SHA256: deploymentBundleSha256,
    });
    assert.ok(
      codes(findings).includes("BETA_DEPLOYMENT_BUNDLE_DIGEST_INVALID"),
    );
  }
});

test("rejects application-account DNS creation", () => {
  const findings = validateBetaReleaseEnvironment({
    ...validEnvironment,
    BETA_CREATE_DNS_RECORDS: "true",
    BETA_HOSTED_ZONE_ID: "Z1234567890ABC",
    BETA_HOSTED_ZONE_NAME: "cloudmarkup.com",
  });
  assert.ok(codes(findings).includes("BETA_DNS_MODE_INVALID"));
});

test("accepts a production build with the reviewed local brand assets", () => {
  assert.deepEqual(validateBetaWebBuild(validWebBuildFiles()), []);
});

test("rejects local hostnames without mistaking catalog copy for a URL", () => {
  const withText = (text) =>
    validWebBuildFiles().map((file) =>
      file.path === "assets/application.js"
        ? { ...file, text: `${file.text}; ${JSON.stringify(text)}` }
        : file,
    );

  assert.deepEqual(
    validateBetaWebBuild(withText("localhost-only placeholder")),
    [],
  );
  for (const localHost of [
    "localhost",
    "localhost:4173",
    "http://localhost:4173",
    "https://localhost",
    "127.0.0.1",
    "http://127.0.0.1:4173",
  ]) {
    assert.ok(
      codes(validateBetaWebBuild(withText(localHost))).includes(
        "BETA_WEB_LOCAL_URL",
      ),
      localHost,
    );
  }
});

test("rejects missing, changed, or unlinked production brand assets", () => {
  const withoutFavicon = validWebBuildFiles().filter(
    ({ path }) => path !== "favicon.ico",
  );
  assert.ok(
    codes(validateBetaWebBuild(withoutFavicon)).includes(
      "BETA_WEB_BRAND_ASSET_MISSING",
    ),
  );

  const changedLogo = validWebBuildFiles().map((file) =>
    file.path === "cloudmarkup-logo.png"
      ? { ...file, sha256: "0".repeat(64) }
      : file,
  );
  assert.ok(
    codes(validateBetaWebBuild(changedLogo)).includes(
      "BETA_WEB_BRAND_ASSET_INVALID",
    ),
  );

  const unlinkedFavicon = validWebBuildFiles().map((file) =>
    file.path === "index.html"
      ? { ...file, text: file.text.replace("/favicon.ico", "/missing.ico") }
      : file,
  );
  assert.ok(
    codes(validateBetaWebBuild(unlinkedFavicon)).includes(
      "BETA_WEB_BRAND_METADATA_INVALID",
    ),
  );

  const remoteManifestIcon = validWebBuildFiles().map((file) =>
    file.path === "site.webmanifest"
      ? {
          ...file,
          text: file.text.replace(
            "/app-icon-192.png",
            "https://example.invalid/app-icon-192.png",
          ),
        }
      : file,
  );
  assert.ok(
    codes(validateBetaWebBuild(remoteManifestIcon)).includes(
      "BETA_WEB_MANIFEST_INVALID",
    ),
  );
});

test("rejects missing build output, local composition, and public secret variables", () => {
  const findings = validateBetaWebBuild([
    {
      path: "assets/application.js",
      text: "VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN; Local preview - authentication not connected; http://127.0.0.1:4173; VITE_AUTH_SECRET",
    },
  ]);
  assert.ok(codes(findings).includes("BETA_WEB_INDEX_MISSING"));
  assert.ok(codes(findings).includes("BETA_WEB_LOCAL_URL"));
  assert.ok(codes(findings).includes("BETA_WEB_LOCAL_COMPOSITION"));
  assert.ok(codes(findings).includes("BETA_WEB_PUBLIC_SECRET_VARIABLE"));
  assert.ok(codes(findings).includes("BETA_WEB_AUTH_COMPOSITION_MISSING"));
});

test("requires the production API entry and Cognito/RDS/S3 composition", () => {
  assert.deepEqual(
    validateBetaApiBuild([
      {
        path: "lambda.js",
        text: 'import { productionApp } from "./production-composition.js";',
      },
      {
        path: "production-composition.js",
        text: 'export const id = "cloudmarkup.api-composition/cognito-rds-s3-v1";',
      },
    ]),
    [],
  );
  const findings = validateBetaApiBuild([
    { path: "lambda.js", text: 'import { app } from "./app.js";' },
    {
      path: "production-composition.js",
      text: "unavailableApplication; anonymousPrincipalResolver;",
    },
  ]);
  assert.ok(codes(findings).includes("BETA_API_PRODUCTION_ENTRY_MISSING"));
  assert.ok(
    codes(findings).includes("BETA_API_PRODUCTION_COMPOSITION_MISSING"),
  );
  assert.ok(codes(findings).includes("BETA_API_UNAVAILABLE_COMPOSITION"));
});

test("rejects an absent synthesized platform, outputs, migration, and production composition", () => {
  const findings = validateBetaAssembly([], validEnvironment);
  assert.ok(codes(findings).includes("BETA_STACK_SET_INVALID"));
  assert.ok(codes(findings).includes("BETA_OUTPUT_MISSING"));
  assert.ok(codes(findings).includes("BETA_DATABASE_CLUSTER_INVALID"));
  assert.ok(codes(findings).includes("BETA_CLOUDFRONT_INVALID"));
  assert.ok(codes(findings).includes("BETA_WEB_ASSET_DEPLOYMENT_MISSING"));
  assert.ok(codes(findings).includes("BETA_PRODUCTION_COMPOSITION_MISSING"));
  assert.ok(codes(findings).includes("BETA_MIGRATION_GATE_MISSING"));
  assert.ok(
    codes(findings).includes("BETA_DEPLOYABLE_RESOURCE_BINDING_INVALID"),
  );
});

test("requires synchronized activation and the reviewed schema for project cleanup", () => {
  const stacks = regionalOriginStacks();
  const resources = stacks[0].template.Resources;
  const name = "cloudmarkup-beta-project-content-cleanup";
  resources.Cleanup = {
    Type: "AWS::Lambda::Function",
    Properties: {
      FunctionName: name,
      Environment: {
        Variables: {
          CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: "false",
          CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
        },
      },
    },
  };
  resources.CleanupSchedule = {
    Type: "AWS::Events::Rule",
    Properties: { Name: name, State: "DISABLED" },
  };
  const rejected = (candidate) =>
    codes(validateBetaAssembly(candidate, validEnvironment)).includes(
      "BETA_PROJECT_CLEANUP_ACTIVATION_UNREVIEWED",
    );
  assert.equal(rejected(stacks), false);
  const enabledHost = structuredClone(stacks);
  enabledHost[0].template.Resources.Cleanup.Properties.Environment.Variables.CLOUDMARKUP_PROJECT_CLEANUP_ENABLED =
    "true";
  assert.equal(rejected(enabledHost), true);
  const enabledSchedule = structuredClone(stacks);
  enabledSchedule[0].template.Resources.CleanupSchedule.Properties.State =
    "ENABLED";
  assert.equal(rejected(enabledSchedule), true);
  const authorized = structuredClone(enabledHost);
  authorized[0].template.Resources.CleanupSchedule.Properties.State = "ENABLED";
  assert.equal(rejected(authorized), false);
  const staleHost = structuredClone(stacks);
  staleHost[0].template.Resources.Cleanup.Properties.Environment.Variables.CLOUDMARKUP_EXPECTED_SCHEMA_VERSION =
    "0033";
  assert.equal(rejected(staleHost), true);
});

test("requires the Regional REST/WAF boundary and the same exact CloudFront marker", () => {
  const valid = regionalOriginStacks();
  const validCodes = codes(validateBetaAssembly(valid, validEnvironment));
  assert.equal(
    validCodes.includes("BETA_REGIONAL_ORIGIN_PROTECTION_MISSING"),
    false,
  );
  assert.equal(validCodes.includes("BETA_INGRESS_PROTECTION_MISSING"), false);
  assert.equal(
    validCodes.includes("BETA_LAMBDA_ORIGIN_MARKER_BINDING_INVALID"),
    false,
  );
  assert.equal(validCodes.includes("BETA_RUNTIME_CONFIG_ROUTE_INVALID"), false);

  const cachedRuntimeConfig = structuredClone(valid);
  cachedRuntimeConfig[0].template.Resources.RestStage.Properties.CacheClusterEnabled = true;
  assert.ok(
    codes(validateBetaAssembly(cachedRuntimeConfig, validEnvironment)).includes(
      "BETA_RUNTIME_CONFIG_ROUTE_INVALID",
    ),
  );

  const withV2 = structuredClone(valid);
  withV2[0].template.Resources.LegacyHttpApi = {
    Type: "AWS::ApiGatewayV2::Api",
  };
  assert.ok(
    codes(validateBetaAssembly(withV2, validEnvironment)).includes(
      "BETA_REGIONAL_ORIGIN_PROTECTION_MISSING",
    ),
  );

  const withoutAssociation = structuredClone(valid);
  delete withoutAssociation[0].template.Resources.RegionalOriginAssociation;
  assert.ok(
    codes(validateBetaAssembly(withoutAssociation, validEnvironment)).includes(
      "BETA_REGIONAL_ORIGIN_PROTECTION_MISSING",
    ),
  );

  const withoutMarkerValue = structuredClone(valid);
  delete withoutMarkerValue[0].template.Resources.RegionalOriginAccess
    .Properties.Rules[0].Statement.NotStatement.Statement.ByteMatchStatement
    .SearchString;
  assert.ok(
    codes(validateBetaAssembly(withoutMarkerValue, validEnvironment)).includes(
      "BETA_REGIONAL_ORIGIN_PROTECTION_MISSING",
    ),
  );

  const manuallyNamedMarker = structuredClone(valid);
  const manualMarker = {
    "Fn::Join": [
      "",
      [
        "{{resolve:secretsmanager:",
        "cloudmarkup/beta/manual-origin-marker",
        ":SecretString:::}}",
      ],
    ],
  };
  manuallyNamedMarker[0].template.Resources.RegionalOriginAccess.Properties.Rules[0].Statement.NotStatement.Statement.ByteMatchStatement.SearchString =
    manualMarker;
  manuallyNamedMarker[1].template.Resources.Distribution.Properties.DistributionConfig.Origins[1].OriginCustomHeaders[0].HeaderValue =
    manualMarker;
  const manualMarkerCodes = codes(
    validateBetaAssembly(manuallyNamedMarker, validEnvironment),
  );
  assert.ok(
    manualMarkerCodes.includes("BETA_REGIONAL_ORIGIN_PROTECTION_MISSING"),
  );
  assert.ok(manualMarkerCodes.includes("BETA_INGRESS_PROTECTION_MISSING"));

  const weakenedGeneratedSecret = structuredClone(valid);
  weakenedGeneratedSecret[3].template.Resources.EdgeOriginSecret.Properties.GenerateSecretString.PasswordLength = 32;
  assert.ok(
    codes(
      validateBetaAssembly(weakenedGeneratedSecret, validEnvironment),
    ).includes("BETA_REGIONAL_ORIGIN_PROTECTION_MISSING"),
  );

  const disabledWebAclTelemetry = structuredClone(valid);
  disabledWebAclTelemetry[0].template.Resources.RegionalOriginAccess.Properties.VisibilityConfig.CloudWatchMetricsEnabled = false;
  assert.ok(
    codes(
      validateBetaAssembly(disabledWebAclTelemetry, validEnvironment),
    ).includes("BETA_REGIONAL_ORIGIN_PROTECTION_MISSING"),
  );

  const enabledRuleSampling = structuredClone(valid);
  enabledRuleSampling[0].template.Resources.RegionalOriginAccess.Properties.Rules[0].VisibilityConfig.SampledRequestsEnabled = true;
  assert.ok(
    codes(validateBetaAssembly(enabledRuleSampling, validEnvironment)).includes(
      "BETA_REGIONAL_ORIGIN_PROTECTION_MISSING",
    ),
  );

  const withoutAssociationResource = structuredClone(valid);
  delete withoutAssociationResource[0].template.Resources
    .RegionalOriginAssociation.Properties.ResourceArn;
  assert.ok(
    codes(
      validateBetaAssembly(withoutAssociationResource, validEnvironment),
    ).includes("BETA_REGIONAL_ORIGIN_PROTECTION_MISSING"),
  );

  const spoofedAssociationResource = structuredClone(valid);
  spoofedAssociationResource[0].template.Resources.RegionalOriginAssociation.Properties.ResourceArn =
    "arn:aws:apigateway:us-east-1::/restapis/RestApi/stages/RestStage";
  assert.ok(
    codes(
      validateBetaAssembly(spoofedAssociationResource, validEnvironment),
    ).includes("BETA_REGIONAL_ORIGIN_PROTECTION_MISSING"),
  );

  const spoofedAssociationWebAcl = structuredClone(valid);
  spoofedAssociationWebAcl[0].template.Resources.RegionalOriginAssociation.Properties.WebACLArn =
    "arn:aws:wafv2:us-east-1:000000000000:regional/webacl/RegionalOriginAccess/11111111-2222-3333-4444-555555555555";
  assert.ok(
    codes(
      validateBetaAssembly(spoofedAssociationWebAcl, validEnvironment),
    ).includes("BETA_REGIONAL_ORIGIN_PROTECTION_MISSING"),
  );

  const mismatchedCloudFrontMarker = structuredClone(valid);
  mismatchedCloudFrontMarker[1].template.Resources.Distribution.Properties.DistributionConfig.Origins[1].OriginCustomHeaders[0].HeaderValue =
    "different-marker";
  assert.ok(
    codes(
      validateBetaAssembly(mismatchedCloudFrontMarker, validEnvironment),
    ).includes("BETA_INGRESS_PROTECTION_MISSING"),
  );

  const externalCloudFrontAcl = structuredClone(valid);
  externalCloudFrontAcl[1].template.Resources.Distribution.Properties.DistributionConfig.WebACLId =
    "arn:aws:wafv2:us-east-1:000000000000:global/webacl/EdgeRateControls/11111111-2222-3333-4444-555555555555";
  assert.ok(
    codes(
      validateBetaAssembly(externalCloudFrontAcl, validEnvironment),
    ).includes("BETA_INGRESS_PROTECTION_MISSING"),
  );

  const weakenedRateControl = structuredClone(valid);
  weakenedRateControl[1].template.Resources.EdgeRateControls.Properties.Rules[0].Statement.RateBasedStatement.Limit = 999;
  assert.ok(
    codes(validateBetaAssembly(weakenedRateControl, validEnvironment)).includes(
      "BETA_CLOUDFRONT_WAF_INVALID",
    ),
  );

  const spoofedOriginAccessControl = structuredClone(valid);
  spoofedOriginAccessControl[1].template.Resources.Distribution.Properties.DistributionConfig.Origins[0].OriginAccessControlId =
    "external-WebOriginAccessControl";
  assert.ok(
    codes(
      validateBetaAssembly(spoofedOriginAccessControl, validEnvironment),
    ).includes("BETA_INGRESS_PROTECTION_MISSING"),
  );

  const spoofedWebHeaders = structuredClone(valid);
  spoofedWebHeaders[1].template.Resources.Distribution.Properties.DistributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId =
    "external-response-policy";
  assert.ok(
    codes(validateBetaAssembly(spoofedWebHeaders, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const spoofedApiHeaders = structuredClone(valid);
  spoofedApiHeaders[1].template.Resources.Distribution.Properties.DistributionConfig.CacheBehaviors[0].ResponseHeadersPolicyId =
    "external-api-response-policy";
  assert.ok(
    codes(validateBetaAssembly(spoofedApiHeaders, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );
});

test("refuses public bundle caching on private API traffic or an unreviewed asset origin", () => {
  for (const mutate of [
    (behaviors) => {
      behaviors[0].CachePolicyId = "658327ea-f89d-4fab-a63d-7e88639e58f6";
    },
    (behaviors) => {
      behaviors[1].PathPattern = "/api/*";
    },
    (behaviors) => {
      behaviors[1].PathPattern = "/assets/*";
    },
    (behaviors) => {
      behaviors[1].TargetOriginId = "api-origin";
    },
    (behaviors) => {
      behaviors[1].ResponseHeadersPolicyId = "external-asset-policy";
    },
    (behaviors) => {
      behaviors[1].FunctionAssociations = behaviors[0].FunctionAssociations;
    },
  ]) {
    const changed = regionalOriginStacks();
    mutate(
      changed[1].template.Resources.Distribution.Properties.DistributionConfig
        .CacheBehaviors,
    );
    assert.ok(
      codes(validateBetaAssembly(changed, validEnvironment)).includes(
        "BETA_INGRESS_PROTECTION_MISSING",
      ),
    );
  }
});

test("binds the exact API Lambda marker to the generated stateful secret", () => {
  const valid = regionalOriginStacks();
  assert.equal(
    codes(validateBetaAssembly(valid, validEnvironment)).includes(
      "BETA_LAMBDA_ORIGIN_MARKER_BINDING_INVALID",
    ),
    false,
  );

  for (const resourceName of ["ApiFunction"]) {
    const withoutMarker = structuredClone(valid);
    delete withoutMarker[0].template.Resources[resourceName].Properties
      .Environment.Variables.CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION;
    assert.ok(
      codes(validateBetaAssembly(withoutMarker, validEnvironment)).includes(
        "BETA_LAMBDA_ORIGIN_MARKER_BINDING_INVALID",
      ),
      `${resourceName} must reject a missing marker`,
    );

    const wrongMarker = structuredClone(valid);
    wrongMarker[0].template.Resources[
      resourceName
    ].Properties.Environment.Variables.CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION = {
      "Fn::Join": [
        "",
        [
          "{{resolve:secretsmanager:",
          { "Fn::ImportValue": "cloudmarkup-beta-stateful:WrongSecret" },
          ":SecretString:::}}",
        ],
      ],
    };
    assert.ok(
      codes(validateBetaAssembly(wrongMarker, validEnvironment)).includes(
        "BETA_LAMBDA_ORIGIN_MARKER_BINDING_INVALID",
      ),
      `${resourceName} must reject a different dynamic import`,
    );
  }

  const spoofedString = structuredClone(valid);
  spoofedString[0].template.Resources.ApiFunction.Properties.Environment.Variables.CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION = `prefix:${JSON.stringify(
    valid[0].template.Resources.ApiFunction.Properties.Environment.Variables
      .CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION,
  )}`;
  assert.ok(
    codes(validateBetaAssembly(spoofedString, validEnvironment)).includes(
      "BETA_LAMBDA_ORIGIN_MARKER_BINDING_INVALID",
    ),
  );

  const renamedOwner = structuredClone(valid);
  renamedOwner[0].template.Resources.ApiFunction.Properties.FunctionName =
    "cloudmarkup-beta-unrelated";
  assert.ok(
    codes(validateBetaAssembly(renamedOwner, validEnvironment)).includes(
      "BETA_LAMBDA_ORIGIN_MARKER_BINDING_INVALID",
    ),
  );

  const duplicateOwner = structuredClone(valid);
  duplicateOwner[0].template.Resources.DuplicateApiFunction = structuredClone(
    duplicateOwner[0].template.Resources.ApiFunction,
  );
  assert.ok(
    codes(validateBetaAssembly(duplicateOwner, validEnvironment)).includes(
      "BETA_LAMBDA_ORIGIN_MARKER_BINDING_INVALID",
    ),
  );

  const conditionalSecret = structuredClone(valid);
  conditionalSecret[3].template.Conditions = { Never: false };
  conditionalSecret[3].template.Resources.EdgeOriginSecret.Condition = "Never";
  conditionalSecret[3].template.Outputs.EdgeOriginSecretExport.Condition =
    "Never";
  const conditionalSecretCodes = codes(
    validateBetaAssembly(conditionalSecret, validEnvironment),
  );
  assert.ok(
    conditionalSecretCodes.includes(
      "BETA_LAMBDA_ORIGIN_MARKER_BINDING_INVALID",
    ),
  );
  assert.ok(
    conditionalSecretCodes.includes("BETA_REGIONAL_ORIGIN_PROTECTION_MISSING"),
  );
  assert.ok(conditionalSecretCodes.includes("BETA_INGRESS_PROTECTION_MISSING"));

  const conditionalLambda = structuredClone(valid);
  conditionalLambda[0].template.Resources.ApiFunction.Condition = "Never";
  assert.ok(
    codes(validateBetaAssembly(conditionalLambda, validEnvironment)).includes(
      "BETA_LAMBDA_ORIGIN_MARKER_BINDING_INVALID",
    ),
  );
});

test("requires the exact /api viewer-request prefix-removal function binding", () => {
  const valid = regionalOriginStacks();
  assert.equal(
    codes(validateBetaAssembly(valid, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
    false,
  );

  const association = (stacks) =>
    stacks[1].template.Resources.Distribution.Properties.DistributionConfig
      .CacheBehaviors[0].FunctionAssociations;

  const missing = structuredClone(valid);
  delete missing[1].template.Resources.Distribution.Properties
    .DistributionConfig.CacheBehaviors[0].FunctionAssociations;
  assert.ok(
    codes(validateBetaAssembly(missing, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const spoofed = structuredClone(valid);
  association(spoofed)[0].FunctionARN =
    "arn:aws:cloudfront::000000000000:function/StripApiPrefix";
  assert.ok(
    codes(validateBetaAssembly(spoofed, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const wrongEvent = structuredClone(valid);
  association(wrongEvent)[0].EventType = "origin-request";
  assert.ok(
    codes(validateBetaAssembly(wrongEvent, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const wrongFunction = structuredClone(valid);
  association(wrongFunction)[0].FunctionARN = {
    "Fn::GetAtt": ["RouteSpaRequest", "FunctionARN"],
  };
  assert.ok(
    codes(validateBetaAssembly(wrongFunction, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const extra = structuredClone(valid);
  association(extra).push(structuredClone(association(extra)[0]));
  assert.ok(
    codes(validateBetaAssembly(extra, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const lambdaAtEdge = structuredClone(valid);
  lambdaAtEdge[1].template.Resources.Distribution.Properties.DistributionConfig.CacheBehaviors[0].LambdaFunctionAssociations =
    [
      {
        EventType: "viewer-request",
        LambdaFunctionARN:
          "arn:aws:lambda:us-east-1:000000000000:function:unreviewed:1",
      },
    ];
  assert.ok(
    codes(validateBetaAssembly(lambdaAtEdge, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const spoofedCode = structuredClone(valid);
  spoofedCode[1].template.Resources.StripApiPrefix.Properties.FunctionCode = `malicious();${reviewedApiPrefixFunctionCode}`;
  assert.ok(
    codes(validateBetaAssembly(spoofedCode, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const unpublished = structuredClone(valid);
  unpublished[1].template.Resources.StripApiPrefix.Properties.AutoPublish = false;
  assert.ok(
    codes(validateBetaAssembly(unpublished, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const wrongRuntime = structuredClone(valid);
  wrongRuntime[1].template.Resources.StripApiPrefix.Properties.FunctionConfig.Runtime =
    "cloudfront-js-1.0";
  assert.ok(
    codes(validateBetaAssembly(wrongRuntime, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const conditionalFunction = structuredClone(valid);
  conditionalFunction[1].template.Resources.StripApiPrefix.Condition = "Never";
  assert.ok(
    codes(validateBetaAssembly(conditionalFunction, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const missingFunction = structuredClone(valid);
  delete missingFunction[1].template.Resources.StripApiPrefix;
  assert.ok(
    codes(validateBetaAssembly(missingFunction, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );

  const crossStackShadow = structuredClone(valid);
  for (const resourceName of ["Distribution", "EdgeRateControls"]) {
    crossStackShadow[0].template.Resources[resourceName] =
      crossStackShadow[1].template.Resources[resourceName];
    assert.equal(
      Reflect.deleteProperty(
        crossStackShadow[1].template.Resources,
        resourceName,
      ),
      true,
    );
  }
  crossStackShadow[0].template.Resources.StripApiPrefix = {
    Type: "AWS::CloudFront::Function",
    Properties: {
      AutoPublish: true,
      FunctionCode: "function handler(event) { return event.request; }",
      FunctionConfig: {
        Comment: "Unreviewed cross-stack shadow",
        Runtime: "cloudfront-js-2.0",
      },
      Name: "cloudmarkup-beta-unreviewed-prefix-function",
    },
  };
  assert.ok(
    codes(validateBetaAssembly(crossStackShadow, validEnvironment)).includes(
      "BETA_INGRESS_PROTECTION_MISSING",
    ),
  );
});

test("binds production checks to the exact synthesized API and web assets", () => {
  const apiId = "c".repeat(64);
  const webId = "d".repeat(64);
  const assetBucket = "cloudmarkup-beta-cdk-assets-000000000000-us-east-1";
  const stacks = [
    {
      path: "application.template.json",
      stackName: "cloudmarkup-beta-application",
      template: {
        Resources: {
          Api: {
            Type: "AWS::Lambda::Function",
            Properties: {
              Code: {
                S3Bucket: assetBucket,
                S3Key: `assets/${apiId}.zip`,
              },
              FunctionName: "cloudmarkup-beta-api",
            },
          },
        },
      },
    },
    {
      path: "edge.template.json",
      stackName: "cloudmarkup-beta-edge",
      template: {
        Resources: {
          Deploy: {
            Type: "AWS::CloudFormation::CustomResource",
            Properties: {
              DistributionPaths: ["/*"],
              SourceBucketNames: [assetBucket],
              SourceObjectKeys: [`assets/${webId}.zip`],
            },
          },
        },
      },
    },
  ];
  const validAssets = [
    {
      displayName: "ApiFunction/Code",
      files: [
        {
          path: "index.js",
          text: '"cloudmarkup.api-composition/cognito-rds-s3-v1";',
        },
      ],
      fingerprint: apiId,
      id: apiId,
      packaging: "zip",
      path: `asset.${apiId}`,
    },
    {
      displayName: "DeployWebAssets/Asset1",
      files: validWebBuildFiles(),
      fingerprint: webId,
      id: webId,
      packaging: "zip",
      path: `asset.${webId}`,
    },
  ];
  const validCodes = codes(
    validateBetaAssembly(stacks, validEnvironment, validAssets),
  );
  assert.equal(
    validCodes.includes("BETA_DEPLOYABLE_ASSET_BINDING_INVALID"),
    false,
  );
  assert.equal(
    validCodes.includes("BETA_API_DEPLOYABLE_COMPOSITION_MISSING"),
    false,
  );
  assert.equal(validCodes.includes("BETA_WEB_AUTH_COMPOSITION_MISSING"), false);

  const wrongAssetBucket = structuredClone(stacks);
  wrongAssetBucket[0].template.Resources.Api.Properties.Code.S3Bucket =
    "unreviewed-bucket";
  wrongAssetBucket[1].template.Resources.Deploy.Properties.SourceBucketNames = [
    "unreviewed-bucket",
  ];
  assert.ok(
    codes(
      validateBetaAssembly(wrongAssetBucket, validEnvironment, validAssets),
    ).includes("BETA_DEPLOYABLE_RESOURCE_BINDING_INVALID"),
  );

  const wrongAssetPrefix = structuredClone(stacks);
  wrongAssetPrefix[0].template.Resources.Api.Properties.Code.S3Key = `${apiId}.zip`;
  wrongAssetPrefix[1].template.Resources.Deploy.Properties.SourceObjectKeys = [
    `${webId}.zip`,
  ];
  assert.ok(
    codes(
      validateBetaAssembly(wrongAssetPrefix, validEnvironment, validAssets),
    ).includes("BETA_DEPLOYABLE_RESOURCE_BINDING_INVALID"),
  );

  const invalidCodes = codes(
    validateBetaAssembly(stacks, validEnvironment, [
      {
        ...validAssets[0],
        files: [
          {
            path: "index.js",
            text: "unavailableApplication; anonymousPrincipalResolver;",
          },
        ],
        fingerprint: "e".repeat(64),
      },
      {
        ...validAssets[1],
        files: [
          { path: "index.html", text: '<main id="root"></main>' },
          { path: "assets/application.js", text: "Sign in unavailable" },
        ],
      },
    ]),
  );
  assert.ok(invalidCodes.includes("BETA_DEPLOYABLE_ASSET_BINDING_INVALID"));
  assert.ok(invalidCodes.includes("BETA_API_DEPLOYABLE_COMPOSITION_MISSING"));
  assert.ok(
    invalidCodes.includes("BETA_API_DEPLOYABLE_UNAVAILABLE_COMPOSITION"),
  );
  assert.ok(invalidCodes.includes("BETA_WEB_LOCAL_COMPOSITION"));
  assert.ok(invalidCodes.includes("BETA_WEB_AUTH_COMPOSITION_MISSING"));
});

test("rejects a target asset mentioned only by the wrong synthesized resource", () => {
  const apiId = "a".repeat(64);
  const wrongId = "b".repeat(64);
  const assetBucket = "cloudmarkup-beta-cdk-assets-000000000000-us-east-1";
  const findings = validateBetaAssembly(
    [
      {
        path: "application.template.json",
        stackName: "cloudmarkup-beta-application",
        template: {
          Resources: {
            Api: {
              Type: "AWS::Lambda::Function",
              Properties: {
                Code: {
                  S3Bucket: assetBucket,
                  S3Key: `assets/${wrongId}.zip`,
                },
                FunctionName: "cloudmarkup-beta-api",
              },
            },
            Unrelated: {
              Type: "AWS::Lambda::LayerVersion",
              Properties: {
                Content: {
                  S3Bucket: assetBucket,
                  S3Key: `assets/${apiId}.zip`,
                },
              },
            },
          },
        },
      },
    ],
    validEnvironment,
    [
      {
        displayName: "ApiFunction/Code",
        files: [
          {
            path: "index.js",
            text: '"cloudmarkup.api-composition/cognito-rds-s3-v1";',
          },
        ],
        fingerprint: apiId,
        id: apiId,
        packaging: "zip",
        path: `asset.${apiId}`,
      },
    ],
  );
  assert.ok(codes(findings).includes("BETA_API_DEPLOYABLE_ASSET_MISSING"));
});

test("rejects public or disposable beta data resources", () => {
  const findings = validateBetaAssembly(
    [
      {
        path: "unsafe.template.json",
        stackName: "cloudmarkup-beta-stateful",
        template: {
          Resources: {
            PublicBucket: {
              Type: "AWS::S3::Bucket",
              Properties: {},
              DeletionPolicy: "Delete",
              UpdateReplacePolicy: "Delete",
            },
            PublicDatabase: {
              Type: "AWS::RDS::DBInstance",
              Properties: { PubliclyAccessible: true },
            },
          },
        },
      },
    ],
    validEnvironment,
  );
  assert.ok(codes(findings).includes("BETA_BUCKET_PUBLIC_BLOCK_MISSING"));
  assert.ok(codes(findings).includes("BETA_BUCKET_ENCRYPTION_MISSING"));
  assert.ok(codes(findings).includes("BETA_BUCKET_VERSIONING_MISSING"));
  assert.ok(codes(findings).includes("BETA_BUCKET_LIFECYCLE_UNSAFE"));
  assert.ok(codes(findings).includes("BETA_DATABASE_PUBLIC"));
});

test("binds repository import activation to the exact parser asset, runtime and profile", () => {
  const assetId = "e".repeat(64),
    digest = "f".repeat(64);
  const fixture = () => ({
    profile: { profile: "stripe-sandbox-github-connections-v1" },
    stacks: [
      {
        stackName: "cloudmarkup-beta-application",
        template: {
          Resources: {
            Api: {
              Type: "AWS::Lambda::Function",
              Properties: {
                FunctionName: "cloudmarkup-beta-api",
                Layers: [{ Ref: "Parser" }],
                Environment: {
                  Variables: {
                    CLOUDMARKUP_REPOSITORY_IMPORTS_ENABLED: "true",
                    CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_PATH:
                      "/opt/cloudmarkup-iac-import",
                    CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_SHA256: digest,
                  },
                },
              },
            },
            Parser: {
              Type: "AWS::Lambda::LayerVersion",
              Properties: {
                LayerName: "cloudmarkup-beta-repository-import-parser",
                CompatibleArchitectures: ["arm64"],
                CompatibleRuntimes: ["nodejs24.x"],
                Content: {
                  S3Bucket:
                    "cloudmarkup-beta-cdk-assets-000000000000-us-east-1",
                  S3Key: `assets/${assetId}.zip`,
                },
              },
            },
          },
        },
      },
    ],
    assets: [
      {
        id: assetId,
        fingerprint: assetId,
        displayName: "RepositoryImportParser/Code",
        packaging: "zip",
        files: [
          {
            path: "cloudmarkup-iac-import",
            byteLength: 128,
            sha256: digest,
            headerHex: "7f454c460201" + "0".repeat(24) + "b700",
          },
        ],
      },
    ],
  });
  const check = (f) =>
    validateBetaRepositoryImport(f.stacks, f.profile, f.assets);
  assert.deepEqual(check(fixture()), []);
  assert.deepEqual(
    validateBetaRepositoryImport([], { profile: "core-v1" }, []),
    [],
  );
  for (const mutate of [
    (f) => {
      f.profile.profile = "core-v1";
    },
    (f) => {
      f.stacks[0].template.Resources.Api.Properties.Environment.Variables.CLOUDMARKUP_REPOSITORY_IMPORTS_ENABLED =
        "false";
    },
    (f) => {
      f.stacks[0].template.Resources.Api.Properties.Environment.Variables.CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_PATH =
        "/tmp/unreviewed";
    },
    (f) => {
      f.stacks[0].template.Resources.Api.Properties.Environment.Variables.CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_SHA256 =
        "0".repeat(64);
    },
    (f) => {
      f.stacks[0].template.Resources.Api.Properties.Environment.Variables.CLOUDMARKUP_REPOSITORY_IMPORT_EXTRA =
        "true";
    },
    (f) => {
      f.stacks[0].template.Resources.Api.Properties.Layers = [];
    },
    (f) => {
      f.stacks[0].template.Resources.Parser.Condition = "Maybe";
    },
    (f) => {
      f.stacks[0].template.Resources.Parser.Properties.CompatibleArchitectures =
        ["x86_64"];
    },
    (f) => {
      f.stacks[0].template.Resources.Parser.Properties.Content.S3Key =
        "assets/missing.zip";
    },
    (f) => {
      f.assets = [];
    },
    (f) => {
      f.assets[0].fingerprint = "0".repeat(64);
    },
    (f) => {
      f.assets[0].displayName = "Other/Code";
    },
    (f) => {
      f.assets[0].files[0].sha256 = "0".repeat(64);
    },
    (f) => {
      f.assets[0].files[0].headerHex = "4d5a";
    },
    (f) => {
      f.assets[0].files[0].byteLength = 10 * 1024 * 1024 + 1;
    },
    (f) => {
      f.assets[0].files.push({ path: "extra.sh" });
    },
    (f) => {
      f.stacks[0].template.Resources.Other = {
        Type: "AWS::Lambda::Function",
        Properties: { FunctionName: "other", Layers: [{ Ref: "Parser" }] },
      };
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(check(f)[0]?.code, "BETA_REPOSITORY_IMPORT_BINDING_INVALID");
  }
});

test("rejects a stale compiled cleanup asset even when source and Lambda schema pins are current", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../apps/api/migrations/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const id = "a".repeat(64);
  const stacks = regionalOriginStacks();
  stacks[0].template.Resources.Cleanup = {
    Type: "AWS::Lambda::Function",
    Properties: {
      FunctionName: "cloudmarkup-beta-project-content-cleanup",
      Code: {
        S3Bucket: "cloudmarkup-beta-cdk-assets-000000000000-us-east-1",
        S3Key: "assets/" + id + ".zip",
      },
      Environment: {
        Variables: {
          CLOUDMARKUP_PROJECT_CLEANUP_ENABLED: "true",
          CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
        },
      },
    },
  };
  const guard =
    "j.idempotency_scope IS DISTINCT FROM 'cloudmarkup.beta-infrastructure-proposals.create'";
  const asset = {
    id,
    fingerprint: id,
    packaging: "zip",
    displayName: "ProjectContentCleanup/WorkerFunction/Code",
    files: [
      {
        path: "index.js",
        text:
          'var schemaChecksum = "' +
          manifest.migrations.at(-1).checksumSha256 +
          '";\n' +
          guard,
      },
    ],
  };
  const rejected = (assets) =>
    codes(validateBetaAssembly(stacks, validEnvironment, assets)).includes(
      "BETA_PROJECT_CLEANUP_RUNTIME_STALE",
    );
  assert.equal(rejected([asset]), false);
  assert.equal(rejected([]), true);
  const stale = structuredClone(asset);
  stale.files[0].text = stale.files[0].text.replace(
    manifest.migrations.at(-1).checksumSha256,
    "0".repeat(64),
  );
  assert.equal(rejected([stale]), true);
  const broad = structuredClone(asset);
  broad.files[0].text = broad.files[0].text.replace(guard, "");
  assert.equal(rejected([broad]), true);
});

test("rejects redundant generic API feature metadata while preserving runtime admission", () => {
  const stacks = regionalOriginStacks();
  const api = Object.values(stacks[0].template.Resources).find(
    (resource) => resource.Properties?.FunctionName === "cloudmarkup-beta-api",
  );
  assert.ok(api);
  const env = api.Properties.Environment.Variables;
  const redundant = () =>
    codes(validateBetaAssembly(stacks, validEnvironment)).includes(
      "BETA_REDUNDANT_FEATURE_ENVIRONMENT",
    );
  assert.equal(redundant(), false);
  for (const value of ["false", "true"]) {
    env.CLOUDMARKUP_FEATURE_AI_AUTHORING = value;
    assert.equal(redundant(), true);
  }
  delete env.CLOUDMARKUP_FEATURE_AI_AUTHORING;
  env.CLOUDMARKUP_AI_ENABLED = "true";
  assert.ok(
    codes(validateBetaAssembly(stacks, validEnvironment)).includes(
      "BETA_SANDBOX_OTHER_PROVIDER",
    ),
  );
});
