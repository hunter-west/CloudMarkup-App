import { describe, expect, it } from "vitest";
import {
  completeGitlabLinkV1Schema,
  createGitlabLinkIntentV1Schema,
  disconnectGitlabConnectionV1Schema,
  gitlabConnectionV1Schema,
  gitlabLinkIntentV1Schema,
  gitlabConnectionListQueryV1Schema,
} from "./gitlab-connections.js";
const connection = {
  contractVersion: 1,
  id: "gitlab_" + "1".repeat(32),
  organizationId: "org_example",
  principalId: "principal_example",
  providerUsername: "example-provider-user",
  status: "active",
  providerRevocation: "not-requested",
};
const parameters = {
  client_id: "a".repeat(64),
  redirect_uri: "https://app.example.test/account/gitlab/callback",
  response_type: "code",
  state: "s".repeat(43),
  scope: "api",
  code_challenge: "c".repeat(43),
  code_challenge_method: "S256",
};
const intent = {
  contractVersion: 1,
  intentId: "gitlablink_" + "2".repeat(32),
  authorizationUrl:
    "https://gitlab.com/oauth/authorize?" +
    new URLSearchParams(parameters).toString(),
  expiresAt: "2026-10-01T12:10:00.000Z",
};
const completion = {
  contractVersion: 1,
  intentId: intent.intentId,
  state: parameters.state,
  code: "synthetic-authorization-code",
};
describe("GitLab actor-owned connection contracts", () => {
  it("accepts the fixed-host confidential S256 intent and bounded completion", () => {
    expect(gitlabLinkIntentV1Schema.parse(intent)).toEqual(intent);
    expect(completeGitlabLinkV1Schema.parse(completion)).toEqual(completion);
    expect(gitlabConnectionV1Schema.parse(connection)).toEqual(connection);
  });
  it.each(["accessToken", "sealedGrant", "keyArn"])(
    "rejects leaked server field %s",
    (field) => {
      expect(
        gitlabConnectionV1Schema.safeParse({
          ...connection,
          [field]: "sensitive",
        }).success,
      ).toBe(false);
      expect(
        gitlabLinkIntentV1Schema.safeParse({ ...intent, [field]: "sensitive" })
          .success,
      ).toBe(false);
    },
  );
  it.each(["organizationId", "principalId", "redirectUri", "clientSecret"])(
    "rejects caller-supplied authority/configuration %s",
    (field) => {
      expect(
        createGitlabLinkIntentV1Schema.safeParse({
          contractVersion: 1,
          [field]: "foreign",
        }).success,
      ).toBe(false);
      expect(
        disconnectGitlabConnectionV1Schema.safeParse({
          contractVersion: 1,
          [field]: "foreign",
        }).success,
      ).toBe(false);
      expect(
        completeGitlabLinkV1Schema.safeParse({
          ...completion,
          [field]: "foreign",
        }).success,
      ).toBe(false);
    },
  );
  it.each([
    "https://other.example/oauth/authorize",
    "http://gitlab.com/oauth/authorize",
    "https://user:password@gitlab.com/oauth/authorize",
    "https://gitlab.com/other",
    "javascript:alert(1)",
  ])("rejects unsafe authorization location %s", (base) => {
    expect(
      gitlabLinkIntentV1Schema.safeParse({
        ...intent,
        authorizationUrl:
          base + "?" + new URLSearchParams(parameters).toString(),
      }).success,
    ).toBe(false);
  });
  it.each([
    { scope: "read_user" },
    { response_type: "token" },
    { code_challenge_method: "plain" },
    { code_challenge: "short" },
    { state: "short" },
    { redirect_uri: "http://app.example.test/callback" },
    { redirect_uri: "https://user:password@app.example.test/callback" },
    { redirect_uri: "https://app.example.test/callback?redirect=evil" },
  ])("rejects unsafe OAuth parameters %j", (change) => {
    expect(
      gitlabLinkIntentV1Schema.safeParse({
        ...intent,
        authorizationUrl:
          "https://gitlab.com/oauth/authorize?" +
          new URLSearchParams({ ...parameters, ...change }).toString(),
      }).success,
    ).toBe(false);
  });
  it("rejects duplicate and extra authorization parameters", () => {
    for (const suffix of [
      "&scope=api",
      "&redirect_uri=https://other.example",
      "&prompt=none",
    ])
      expect(
        gitlabLinkIntentV1Schema.safeParse({
          ...intent,
          authorizationUrl: intent.authorizationUrl + suffix,
        }).success,
      ).toBe(false);
  });
  it.each(["active", "refreshing", "reconnect-required", "disconnected"])(
    "cannot report confirmed revocation while %s",
    (status) => {
      expect(
        gitlabConnectionV1Schema.safeParse({
          ...connection,
          status,
          providerRevocation: "confirmed",
        }).success,
      ).toBe(false);
    },
  );
  it("preserves manual provider recovery and confirmed revocation as distinct states", () => {
    expect(
      gitlabConnectionV1Schema.safeParse({
        ...connection,
        status: "disconnected",
        providerRevocation: "requires-user-action",
      }).success,
    ).toBe(true);
    expect(
      gitlabConnectionV1Schema.safeParse({
        ...connection,
        status: "revoked",
        providerRevocation: "confirmed",
      }).success,
    ).toBe(true);
    expect(
      gitlabConnectionV1Schema.safeParse({
        ...connection,
        status: "revoked",
        providerRevocation: "pending",
      }).success,
    ).toBe(false);
  });
  it("bounds pagination and rejects foreign cursors", () => {
    expect(gitlabConnectionListQueryV1Schema.parse({})).toEqual({ limit: 50 });
    expect(
      gitlabConnectionListQueryV1Schema.parse({
        limit: "100",
        cursor: connection.id,
      }),
    ).toEqual({ limit: 100, cursor: connection.id });
    for (const input of [
      { limit: 0 },
      { limit: 101 },
      { cursor: "integration_foreign" },
      { limit: "NaN" },
    ])
      expect(gitlabConnectionListQueryV1Schema.safeParse(input).success).toBe(
        false,
      );
  });
});
