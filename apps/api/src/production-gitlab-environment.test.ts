import { betaCapabilitiesForRole } from "./application/production-identity-application.js";
import { permissionsForRole } from "./application/authorization.js";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  readProductionGitLabEnvironment,
  readProductionGitLabExportGate,
  composeProductionGitLabConnections,
} from "./production-gitlab-environment.js";
import { SecretsManagerConfigurationResolver } from "./adapters/secret-configuration.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
const profile = {
  schemaVersion: 1,
  applicationId: "a".repeat(64),
  clientSecretArn:
    "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/gitlab/synthetic-AbCdEf",
  activeKeyArn:
    "arn:aws:kms:us-east-1:000000000000:key/11111111-2222-3333-4444-555555555555",
  previousKeyArns: [],
  publicOrigin: "https://beta.example.invalid",
};
const enabled = { CLOUDMARKUP_GITLAB_CONNECTIONS_ENABLED: "true" };
afterEach(() => vi.restoreAllMocks());
describe("reviewed beta GitLab configuration", () => {
  it.each([undefined, "false"])(
    "stays off for flag %s without inspecting or resolving provider configuration",
    (flag) => {
      const resolve = vi.spyOn(
        SecretsManagerConfigurationResolver.prototype,
        "resolveSecret",
      );
      const config = readProductionGitLabEnvironment(
        { CLOUDMARKUP_GITLAB_CONNECTIONS_ENABLED: flag },
        "invalid-and-unused",
      );
      expect(config).toBeUndefined();
      expect(
        composeProductionGitLabConnections({} as SqlDatabase, config),
      ).toBeUndefined();
      expect(resolve).not.toHaveBeenCalled();
    },
  );
  it.each(
    ["", "TRUE", "yes", "1", " true "].filter(
      (_, index) => index !== 2 && index !== 3,
    ),
  )("rejects ambiguous flag %s", (flag) => {
    expect(() =>
      readProductionGitLabEnvironment(
        { CLOUDMARKUP_GITLAB_CONNECTIONS_ENABLED: flag },
        profile,
      ),
    ).toThrow();
  });
  it("refuses activation until actual beta identities are reviewed", () => {
    expect(() => readProductionGitLabEnvironment(enabled)).toThrow(
      "reviewed beta",
    );
  });
  it("snapshots the exact source-reviewed profile without reading credentials at startup", () => {
    const resolve = vi.spyOn(
      SecretsManagerConfigurationResolver.prototype,
      "resolveSecret",
    );
    const candidate = { ...profile, previousKeyArns: [] as string[] };
    const value = readProductionGitLabEnvironment(enabled, candidate);
    candidate.applicationId = "b".repeat(64);
    candidate.previousKeyArns.push(profile.activeKeyArn);
    expect(value).toEqual(profile);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value?.previousKeyArns)).toBe(true);
    expect(
      composeProductionGitLabConnections({} as SqlDatabase, value)
        ?.publicOrigin,
    ).toBe(profile.publicOrigin);
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each([
    { applicationId: "unreviewed" },
    { publicOrigin: "https://other.example" },
    {
      clientSecretArn: profile.clientSecretArn.replace(
        "000000000000",
        "111111111111",
      ),
    },
    { clientSecretArn: profile.clientSecretArn.replace("/gitlab/", "/other/") },
    { clientSecretArn: "pasted-secret" },
    { activeKeyArn: profile.activeKeyArn.replace("us-east-1", "us-west-2") },
    { activeKeyArn: "alias/gitlab" },
    { previousKeyArns: [profile.activeKeyArn] },
    { clientSecret: "plaintext-must-not-be-a-profile-field" },
  ])("rejects unreviewed profile shape %#", (change) => {
    expect(() =>
      readProductionGitLabEnvironment(enabled, { ...profile, ...change }),
    ).toThrow("reviewed beta");
  });
  it.each([{ AWS_REGION: "us-west-2" }, { AWS_ACCOUNT_ID: "111111111111" }])(
    "rejects runtime scope mismatch %#",
    (change) => {
      expect(() =>
        readProductionGitLabEnvironment({ ...enabled, ...change }, profile),
      ).toThrow("mismatch");
    },
  );
  it.each(
    (["owner", "administrator", "editor", "viewer"] as const).filter(
      (_, index) => index !== 1 && index !== 2 && index !== 3,
    ),
  )(
    "advertises only supported connection permissions to %s without enabling exports",
    (role) => {
      const baseline = betaCapabilitiesForRole(role);
      expect(
        betaCapabilitiesForRole(role, { gitlabConnections: false }),
      ).toEqual(baseline);
      const enabled = betaCapabilitiesForRole(role, {
        gitlabConnections: true,
      });
      expect(enabled).toEqual([
        ...baseline,
        ...["integrations.read", "integrations.manage"].filter((permission) =>
          permissionsForRole(role).some((value) => value === permission),
        ),
      ]);
      expect(enabled).not.toContain("exports.run");
    },
  );
});

describe("separate GitLab export admission", () => {
  it.each([undefined, "false"])(
    "stays disabled for %s without a connection profile",
    (flag) => {
      expect(
        readProductionGitLabExportGate(
          { CLOUDMARKUP_GITLAB_EXPORTS_ENABLED: flag },
          undefined,
        ),
      ).toBe(false);
    },
  );
  it.each(["true", "1", "TRUE", ""])(
    "rejects unreviewed or ambiguous activation %s",
    (flag) => {
      expect(() =>
        readProductionGitLabExportGate(
          { CLOUDMARKUP_GITLAB_EXPORTS_ENABLED: flag },
          flag === "true"
            ? undefined
            : readProductionGitLabEnvironment(enabled, profile),
        ),
      ).toThrow();
    },
  );
  it("requires a reviewed connection and a separate explicit export flag", () => {
    const config = readProductionGitLabEnvironment(enabled, profile);
    expect(readProductionGitLabExportGate({}, config)).toBe(false);
    expect(
      readProductionGitLabExportGate(
        { CLOUDMARKUP_GITLAB_EXPORTS_ENABLED: "true" },
        config,
      ),
    ).toBe(true);
  });
  it.each(
    (["owner", "administrator", "editor", "viewer"] as const).filter(
      (_, index) => index !== 1,
    ),
  )("preserves canonical %s export permission", (role) => {
    expect(
      betaCapabilitiesForRole(role, { gitlabConnections: true }),
    ).not.toContain("exports.run");
    expect(
      betaCapabilitiesForRole(role, {
        gitlabConnections: true,
        gitlabExports: true,
      }).includes("exports.run"),
    ).toBe(permissionsForRole(role).includes("exports.run"));
  });
});
