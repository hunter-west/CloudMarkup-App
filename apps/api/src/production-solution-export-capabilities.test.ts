import { afterEach, describe, expect, it, vi } from "vitest";
import { RdsDataApiDatabase } from "./adapters/persistence/rds-data-driver.js";
import { createProductionApp } from "./production-composition.js";
import {
  PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH,
  PRODUCTION_SOLUTION_EXPORT_ICON_BUNDLE_PATH,
  PRODUCTION_SOLUTION_EXPORT_PROFILE,
} from "./production-solution-export-environment.js";

const authentication = {
  callbackUrl: "https://beta.example.invalid/auth/callback",
  clientId: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
  domain: "https://synthetic.auth.us-east-1.amazoncognito.com",
  logoutUrl: "https://beta.example.invalid/",
  provider: "cognito",
  scopes: ["openid", "profile", "cloudmarkup-api/access"],
};
function environment(enabled?: boolean): NodeJS.ProcessEnv {
  return {
    AWS_REGION: "us-east-1",
    CLOUDMARKUP_ENVIRONMENT: "beta",
    CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: "0138",
    CLOUDMARKUP_RUNTIME_COMPOSITION: "production-v1",
    CLOUDMARKUP_CONTENT_BUCKET: "synthetic-content-bucket",
    CLOUDMARKUP_DATABASE_ARN:
      "arn:aws:rds:us-east-1:111111111111:cluster:synthetic",
    CLOUDMARKUP_DATABASE_NAME: "synthetic",
    CLOUDMARKUP_DATABASE_SECRET_ARN:
      "arn:aws:secretsmanager:us-east-1:111111111111:secret:synthetic-AbCdEf",
    CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX: "documents/v1/organizations/",
    CLOUDMARKUP_OBJECT_EVIDENCE_PREFIX: "evidence/v1/organizations/",
    COGNITO_ISSUER:
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic",
    COGNITO_REQUIRED_SCOPE: "cloudmarkup-api/access",
    COGNITO_APP_CLIENT_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
    COGNITO_USER_POOL_ID: "us-east-1_Synthetic",
    CLOUDMARKUP_PUBLIC_RUNTIME_CONFIG: JSON.stringify({
      schemaVersion: 1,
      authentication,
    }),
    ...(enabled === undefined
      ? {}
      : {
          CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED: String(enabled),
          CLOUDMARKUP_SOLUTION_EXPORT_PROFILE:
            PRODUCTION_SOLUTION_EXPORT_PROFILE,
          CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_ARN:
            "arn:aws:sqs:us-east-1:111111111111:cloudmarkup-beta-solution-exports.fifo",
          CLOUDMARKUP_SOLUTION_EXPORT_QUEUE_URL:
            "https://sqs.us-east-1.amazonaws.com/111111111111/cloudmarkup-beta-solution-exports.fifo",
          CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_PATH:
            PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH,
          CLOUDMARKUP_SOLUTION_EXPORT_COMPILER_SHA256: "a".repeat(64),
          CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_PATH:
            PRODUCTION_SOLUTION_EXPORT_ICON_BUNDLE_PATH,
          CLOUDMARKUP_SOLUTION_EXPORT_ICON_BUNDLE_SHA256: "b".repeat(64),
          CLOUDMARKUP_SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST:
            "sha256:" + "c".repeat(64),
        }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});
describe("production export display capability composition", () => {
  it.each([undefined, false, true])(
    "reports strict configuration state %s independently of GitHub imports, user identity or assets",
    async (enabled) => {
      const database = vi
        .spyOn(RdsDataApiDatabase.prototype, "query")
        .mockRejectedValue(
          new Error("Public configuration cannot query tenant data."),
        );
      const app = createProductionApp(environment(enabled));
      const response = await app.request("/runtime-config?view=exports");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        schemaVersion: 1,
        exports:
          enabled === true
            ? {
                targets: ["cloudformation"],
                workload: "infrastructure-only",
                maximumBytes: 4_194_304,
              }
            : { targets: [], workload: null, maximumBytes: 4_194_304 },
      });
      await expect(
        (await app.request("/runtime-config")).json(),
      ).resolves.toEqual({ schemaVersion: 1, authentication });
      await expect(
        (await app.request("/runtime-config?view=ai")).json(),
      ).resolves.toEqual({
        schemaVersion: 1,
        proposalVersions: [],
        applicationSources: enabled === true ? ["ai-source-draft-v3"] : [],
      });
      expect(database).not.toHaveBeenCalled();
    },
  );
  it("rejects a bare activation flag instead of advertising an unconfigured service", () => {
    expect(() =>
      createProductionApp({
        ...environment(),
        CLOUDMARKUP_SOLUTION_EXPORTS_ENABLED: "true",
      }),
    ).toThrow();
  });
});

it("advertises v6 only when the production saved-baseline host and background proposal service are composed", async () => {
  const database = vi
    .spyOn(RdsDataApiDatabase.prototype, "query")
    .mockRejectedValue(new Error("Public support must not query tenants"));
  const app = createProductionApp({
    ...environment(),
    CLOUDMARKUP_BETA_AI_ENABLED: "true",
    CLOUDMARKUP_BETA_PROPOSAL_QUEUE_ARN:
      "arn:aws:sqs:us-east-1:000000000000:cloudmarkup-beta-proposals.fifo",
  });
  await expect(
    (await app.request("/runtime-config?view=ai")).json(),
  ).resolves.toEqual({
    schemaVersion: 1,
    proposalVersions: [6],
    applicationSources: [],
  });
  expect(database).not.toHaveBeenCalled();
});
