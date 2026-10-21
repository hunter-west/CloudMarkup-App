import { describe, expect, it } from "vitest";
import {
  readProductionGitHubEnvironment,
  readProductionRepositoryImportEnvironment,
} from "./production-composition.js";
import { resolve } from "node:path";

const environment = {
  CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: "true",
  CLOUDMARKUP_GITHUB_APP_ID: "123456",
  CLOUDMARKUP_GITHUB_APP_SLUG: "cloudmarkup-example-beta",
  CLOUDMARKUP_GITHUB_CLIENT_ID: "IvEXAMPLE000000000000",
  CLOUDMARKUP_GITHUB_PRIVATE_KEY_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/github/app-private-key-EX0002",
  CLOUDMARKUP_GITHUB_CLIENT_SECRET_ARN:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:Github-App-Client-Secret-EX0001",
  CLOUDMARKUP_GITHUB_CLIENT_SECRET_JSON_FIELD: "Client secret",
};
describe("reviewed beta GitHub connections configuration", () => {
  it("requires configured connections and a complete pinned compiler before enabling imports", () => {
    const github = readProductionGitHubEnvironment(environment);
    const configured = {
      CLOUDMARKUP_REPOSITORY_IMPORTS_ENABLED: "true",
      CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_PATH: resolve("synthetic-parser"),
      CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_SHA256: "a".repeat(64),
    };
    expect(
      readProductionRepositoryImportEnvironment({}, undefined),
    ).toBeUndefined();
    expect(() =>
      readProductionRepositoryImportEnvironment(configured, undefined),
    ).toThrow();
    expect(
      readProductionRepositoryImportEnvironment(configured, github),
    ).toEqual({
      executablePath: configured.CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_PATH,
      executableSha256:
        configured.CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_SHA256,
    });
    for (const change of [
      { CLOUDMARKUP_REPOSITORY_IMPORTS_ENABLED: "yes" },
      { CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_PATH: undefined },
      { CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_PATH: "relative/parser" },
      { CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_SHA256: undefined },
      { CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_SHA256: "unverified" },
    ]) {
      expect(() =>
        readProductionRepositoryImportEnvironment(
          { ...configured, ...change },
          github,
        ),
      ).toThrow();
    }
  });
  it("keeps connections disabled without resolving provider references", () => {
    expect(readProductionGitHubEnvironment({})).toBeUndefined();
    expect(
      readProductionGitHubEnvironment({
        CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED: "false",
      }),
    ).toBeUndefined();
  });
  it("binds the exact public App and existing secret references", () => {
    expect(readProductionGitHubEnvironment(environment)).toMatchObject({
      appId: "123456",
      clientSecretJsonField: "Client secret",
      publicOrigin: "https://beta.example.invalid",
    });
  });
  it.each(Object.keys(environment))(
    "rejects missing or changed configuration %s",
    (name) => {
      expect(() =>
        readProductionGitHubEnvironment({
          ...environment,
          [name]: "unreviewed",
        }),
      ).toThrow();
      if (name !== "CLOUDMARKUP_GITHUB_CONNECTIONS_ENABLED") {
        expect(() =>
          readProductionGitHubEnvironment({
            ...environment,
            [name]: undefined,
          }),
        ).toThrow();
      }
    },
  );
});
