import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as api from "./app.js";
import { loadMigrations } from "./adapters/persistence/migrations.js";
import { RdsDataApiDatabase } from "./adapters/persistence/rds-data-driver.js";
import type {
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./adapters/persistence/sql.js";
import type { PrincipalContext } from "./application/ports.js";
import { createProductionApp } from "./production-composition.js";
import * as exportsComposition from "./production-github-exports.js";

const principal: PrincipalContext = {
  authenticatedAt: "2026-09-07T12:00:00.000Z",
  authenticationSource: "test",
  correlationId: "correlation-synthetic",
  expiresAt: "2026-09-07T12:30:00.000Z",
  principalId: "principal_synthetic",
  sessionId: "session-synthetic",
};
const reviewedGitHub = {
  CLOUDMARKUP_GITHUB_APP_ID: "123456",
  CLOUDMARKUP_GITHUB_APP_SLUG: "cloudmarkup-example-beta",
  CLOUDMARKUP_GITHUB_CLIENT_ID: "IvEXAMPLE000000000000",
  CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/github/app-private-key-EX0002",
  CLOUDMARKUP_GITHUB_CLIENT_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:Github-App-Client-Secret-EX0001",
  CLOUDMARKUP_GITHUB_CLIENT_SECRET_JSON_FIELD: "Client secret",
};

/** Composition-only proof using synthetic SQL replies. No authenticated HTTP,
 * cloud database, credential resolution, GitHub request or provider data. */
describe("production GitHub connection capability composition", () => {
  let schemaVersion: string;
  beforeAll(async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../migrations", import.meta.url)),
    );
    const latest = migrations.at(-1);
    if (latest === undefined)
      throw new Error("Missing current schema fixture.");
    schemaVersion = latest.version;
  });
  afterEach(() => vi.restoreAllMocks());

  function environment(flag: string | undefined): NodeJS.ProcessEnv {
    return {
      CLOUDMARKUP_ENVIRONMENT: "beta",
      CLOUDMARKUP_EXPECTED_SCHEMA_VERSION: schemaVersion,
      CLOUDMARKUP_RUNTIME_COMPOSITION: "production-v1",
      CLOUDMARKUP_CONTENT_BUCKET: "synthetic-content-bucket",
      CLOUDMARKUP_DATABASE_ARN:
        "arn:aws:rds:us-east-1:111111111111:cluster:synthetic",
      CLOUDMARKUP_DATABASE_NAME: "synthetic",
      CLOUDMARKUP_DATABASE_SECRET_ARN:
        "arn:aws:secretsmanager:us-east-1:111111111111:secret:synthetic-AbCdEf",
      CLOUDMARKUP_OBJECT_DOCUMENT_PREFIX: "beta/documents/",
      CLOUDMARKUP_OBJECT_EVIDENCE_PREFIX: "beta/evidence/",
      COGNITO_ISSUER:
        "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic",
      COGNITO_REQUIRED_SCOPE: "cloudmarkup-api/access",
      COGNITO_APP_CLIENT_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
      COGNITO_USER_POOL_ID: "us-east-1_Synthetic",
      CLOUDMARKUP_PUBLIC_RUNTIME_CONFIG: JSON.stringify({
        authentication: {
          callbackUrl: "https://beta.example.invalid/auth/callback",
          clientId: "aaaaaaaaaaaaaaaaaaaaaaaaaa",
          domain: "https://synthetic.auth.us-east-1.amazoncognito.com",
          logoutUrl: "https://beta.example.invalid",
          provider: "cognito",
          scopes: ["openid", "profile", "cloudmarkup-api/access"],
        },
        schemaVersion: 1,
      }),
      ...reviewedGitHub,
      CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: flag,
    };
  }
  function query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    const rows = statement.text.includes("FROM principals")
      ? [
          {
            principal_id: principal.principalId,
            display_name: "Synthetic owner",
            email: null,
          },
        ]
      : [
          {
            membership_id: "membership_synthetic",
            organization_id: "org_synthetic",
            role_key: "owner",
          },
        ];
    return Promise.resolve({
      rowCount: rows.length,
      rows: rows as unknown as readonly TRow[],
    });
  }

  it.each([undefined, "false", "true"])(
    "keeps the advertised permissions and actual service aligned for flag %s",
    async (flag) => {
      const assembled = vi.spyOn(api, "createApp");
      const exportFactory = vi.spyOn(
        exportsComposition,
        "createProductionGitHubExports",
      );
      const database = vi
        .spyOn(RdsDataApiDatabase.prototype, "query")
        .mockImplementation(query);
      const input = environment(flag);
      createProductionApp(input);
      const dependencies = assembled.mock.calls[0]?.[0];
      if (dependencies === undefined)
        throw new Error("Missing composed application.");
      const enabled = flag === "true";
      expect(dependencies.githubExports !== undefined).toBe(enabled);
      expect(dependencies.githubInstallationCallback !== undefined).toBe(
        enabled,
      );
      // Existing instances do not change when an external options object changes.
      input["CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED"] = enabled
        ? "false"
        : "true";
      const current =
        await dependencies.application.getCurrentPrincipal(principal);
      const capabilities = current.organizationContexts[0]?.capabilities ?? [];
      expect(capabilities.includes("integrations.read")).toBe(enabled);
      expect(capabilities.includes("integrations.manage")).toBe(enabled);
      expect(capabilities.includes("exports.run")).toBe(enabled);
      expect(exportFactory).toHaveBeenCalledTimes(enabled ? 1 : 0);
      if (enabled) {
        const result = exportFactory.mock.results[0];
        if (result?.type !== "return")
          throw new Error("Export factory did not return.");
        expect(dependencies.githubExports).toMatchObject(result.value);
      }
      expect(capabilities).not.toContain("commercial.expensive.use");
      expect(capabilities).not.toContain("generation.run");
      expect(database).toHaveBeenCalledTimes(2);
      expect(
        database.mock.calls.every(([statement]) =>
          statement.values.includes(principal.principalId),
        ),
      ).toBe(true);
    },
  );

  it.each([
    { CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: "1" },
    { CLOUDMARKUP_GITHUB_CLIENT_ID: "unreviewed-client" },
    { CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_ARN: undefined },
  ])(
    "does not construct an advertised service from invalid server config %j",
    (change) => {
      const assembled = vi.spyOn(api, "createApp");
      expect(() =>
        createProductionApp({ ...environment("true"), ...change }),
      ).toThrow();
      expect(assembled).not.toHaveBeenCalled();
    },
  );
});
