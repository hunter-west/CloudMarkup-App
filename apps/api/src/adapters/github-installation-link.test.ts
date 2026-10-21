import { createHash } from "node:crypto";

import {
  GitHubRepositoryExportService,
  type GitHubFetch,
} from "@cloudmarkup/github-repository-export";
import {
  FakeGitHubAppAdapter,
  InMemoryGitHubExportStore,
  RecordingGitHubExportAuditSink,
  RecordingGitHubExportProgressSink,
} from "@cloudmarkup/github-repository-export/testing";
import { describe, expect, it, vi } from "vitest";

import {
  GitHubInstallationLinkAdapter,
  type GitHubInstallationLinkOptions,
} from "./github-installation-link.js";

const initialTime = new Date("2026-09-05T12:00:00.000Z");
const state = "s".repeat(43);
const binding = {
  intentId: "githublink_synthetic",
  organizationId: "org_synthetic",
  principalId: "principal_synthetic",
  sessionId: "session_synthetic",
};
const installation = {
  account: { id: 31, type: "User" },
  app_id: 99,
  id: 71,
  permissions: { contents: "write", metadata: "read", pull_requests: "write" },
  repository_selection: "selected",
  suspended_at: null,
};

function fixture(
  options: {
    readonly configuration?: Partial<GitHubInstallationLinkOptions>;
    readonly installation?: Record<string, unknown>;
    readonly memberships?: unknown[];
    readonly user?: unknown;
  } = {},
) {
  let now = new Date(initialTime);
  const buffers: Uint8Array[] = [];
  const clientSecret = "synthetic-client-secret-for-local-tests";
  const accessToken = "ghu_" + "synthetic".repeat(5);
  const fetch = vi.fn<GitHubFetch>((url) => {
    const target = String(url);
    if (target === "https://github.com/login/oauth/access_token") {
      return Promise.resolve(
        Response.json({
          access_token: accessToken,
          scope: "",
          token_type: "bearer",
        }),
      );
    }
    if (target === "https://api.github.com/user") {
      return Promise.resolve(
        Response.json(options.user ?? { id: 31, type: "User" }),
      );
    }
    if (target.startsWith("https://api.github.com/user/installations?")) {
      return Promise.resolve(
        Response.json({
          installations: [options.installation ?? installation],
          total_count: 1,
        }),
      );
    }
    if (target.startsWith("https://api.github.com/user/memberships/orgs?")) {
      return Promise.resolve(Response.json(options.memberships ?? []));
    }
    throw new Error("Unexpected synthetic request");
  });
  const configuration: GitHubInstallationLinkOptions = {
    appId: 99,
    appSlug: "cloudmarkup-test",
    callbackUrl: "https://beta.example.test/api/github/callback",
    clientId: "Iv1syntheticexample",
    clientSecretReference: "synthetic/github/client-secret",
    clock: () => now,
    fetch,
    secrets: {
      resolveSecret: () => {
        const buffer = Buffer.from(clientSecret);
        buffers.push(buffer);
        return Promise.resolve(buffer);
      },
    },
    ...options.configuration,
  };
  const adapter = new GitHubInstallationLinkAdapter(configuration);
  const startInput = {
    ...binding,
    expiresAt: "2026-09-05T12:10:00.000Z",
    returnPath: "/organizations/org_synthetic/settings",
    state,
  };
  return {
    accessToken,
    adapter,
    advance: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
    buffers,
    clientSecret,
    configuration,
    fetch,
    startInput,
  };
}

async function authorize(value: ReturnType<typeof fixture>) {
  const start = await value.adapter.createBrowserSession(value.startInput);
  const setup = await value.adapter.continueInstallationSetup({
    cookie: start.cookie,
    installationId: 71,
    setupAction: "install",
    state,
  });
  const oauthState =
    new URL(setup.authorizationUrl).searchParams.get("state") ?? "";
  const completion = await value.adapter.completeAuthorization({
    code: "synthetic-authorization-code",
    cookie: setup.cookie,
    state: oauthState,
  });
  return { completion, oauthState, setup, start };
}

describe("GitHub installation-link browser proof adapter", () => {
  it("binds personal-account ownership, S256, exact callback and opaque short-lived receipts", async () => {
    const value = fixture();
    const { completion, setup, start } = await authorize(value);
    expect(start.installationUrl).toBe(
      `https://github.com/apps/cloudmarkup-test/installations/new?state=${state}`,
    );
    const authorizationUrl = new URL(setup.authorizationUrl);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(authorizationUrl.searchParams.get("state")).not.toBe(state);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      value.configuration.callbackUrl,
    );
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    const tokenRequest = value.fetch.mock.calls[0]?.[1];
    if (typeof tokenRequest?.body !== "string")
      throw new Error("Expected form body");
    const tokenBody = new URLSearchParams(tokenRequest.body);
    expect(tokenBody.get("client_secret")).toBe(value.clientSecret);
    expect(tokenBody.get("redirect_uri")).toBe(value.configuration.callbackUrl);
    expect(
      createHash("sha256")
        .update(tokenBody.get("code_verifier") ?? "")
        .digest("base64url"),
    ).toBe(authorizationUrl.searchParams.get("code_challenge"));
    expect(tokenRequest.method).toBe("POST");
    expect(
      await value.adapter.verifyCallbackReceipt(
        completion.callbackReceipt,
        binding,
      ),
    ).toEqual({
      installationId: 71,
      setupAction: "install",
      state,
      verifiedAccount: {
        accountId: 31,
        accountType: "User",
        repositorySelection: "selected",
      },
    });
    expect(
      await value.adapter.verifyCallbackReceipt(
        completion.callbackReceipt,
        binding,
      ),
    ).toEqual({
      installationId: 71,
      setupAction: "install",
      state,
      verifiedAccount: {
        accountId: 31,
        accountType: "User",
        repositorySelection: "selected",
      },
    });
    expect(completion).toMatchObject(value.startInput);
    for (const opaque of [
      start.cookie,
      setup.cookie,
      completion.callbackReceipt,
    ]) {
      expect(opaque).not.toContain(binding.organizationId);
      expect(opaque).not.toContain(state);
      expect(opaque).not.toContain(value.clientSecret);
      expect(opaque).not.toContain(value.accessToken);
      expect(opaque.length).toBeLessThan(4_096);
    }
    expect(value.buffers.length).toBeGreaterThan(0);
    expect(
      value.buffers.every((buffer) => buffer.every((byte) => byte === 0)),
    ).toBe(true);
    expect(
      value.fetch.mock.calls.every(
        ([, request]) =>
          request?.redirect === "error" && request.cache === "no-store",
      ),
    ).toBe(true);
    expect(value.fetch.mock.calls).toHaveLength(3);
  });

  it("verifies an active owner of the exact installed organization without new App permissions", async () => {
    const value = fixture({
      installation: {
        ...installation,
        account: { id: 51, type: "Organization" },
      },
      memberships: [
        {
          organization: { id: 51 },
          role: "admin",
          state: "active",
          user: { id: 31 },
        },
      ],
    });
    const { completion } = await authorize(value);
    expect(
      await value.adapter.verifyCallbackReceipt(
        completion.callbackReceipt,
        binding,
      ),
    ).toMatchObject({ installationId: 71 });
    expect(String(value.fetch.mock.calls[3]?.[0])).toBe(
      "https://api.github.com/user/memberships/orgs?state=active&per_page=100&page=1",
    );
  });

  it.each([
    {
      role: "member",
      state: "active",
      organization: { id: 51 },
      user: { id: 31 },
    },
    {
      role: "admin",
      state: "pending",
      organization: { id: 51 },
      user: { id: 31 },
    },
    {
      role: "admin",
      state: "active",
      organization: { id: 52 },
      user: { id: 31 },
    },
    {
      role: "admin",
      state: "active",
      organization: { id: 51 },
      user: { id: 32 },
    },
    { role: "admin", state: "active", organization: { id: 51 } },
  ])(
    "denies collaborator, pending, cross-organization and inconsistent-user proof %#",
    async (membership) => {
      const value = fixture({
        installation: {
          ...installation,
          account: { id: 51, type: "Organization" },
        },
        memberships: [membership],
      });
      await expect(authorize(value)).rejects.toMatchObject({
        code: "installation-link-invalid",
      });
    },
  );

  it.each([
    { ...installation, account: { id: 32, type: "User" } },
    { ...installation, repository_selection: "all" },
    { ...installation, app_id: 100 },
    { ...installation, id: 72 },
    { ...installation, suspended_at: initialTime.toISOString() },
    {
      ...installation,
      permissions: {
        contents: "read",
        metadata: "read",
        pull_requests: "write",
      },
    },
  ])(
    "denies forged or overbroad installation authority %#",
    async (candidate) => {
      const value = fixture({ installation: candidate });
      await expect(authorize(value)).rejects.toMatchObject({
        code: "installation-link-invalid",
      });
    },
  );

  it.each(["intentId", "organizationId", "principalId", "sessionId"] as const)(
    "binds the receipt to the exact %s",
    async (field) => {
      const value = fixture();
      const { completion } = await authorize(value);
      await expect(
        value.adapter.verifyCallbackReceipt(completion.callbackReceipt, {
          ...binding,
          [field]: "other_synthetic",
        }),
      ).rejects.toMatchObject({ code: "installation-link-invalid" });
    },
  );

  it("fails closed when the trusted verifier context or authenticated session is absent", async () => {
    const value = fixture();
    const { completion } = await authorize(value);
    await expect(
      value.adapter.verifyCallbackReceipt(completion.callbackReceipt),
    ).rejects.toMatchObject({ code: "installation-link-invalid" });
    await expect(
      value.adapter.verifyCallbackReceipt(completion.callbackReceipt, {
        intentId: binding.intentId,
        organizationId: binding.organizationId,
        principalId: binding.principalId,
      }),
    ).rejects.toMatchObject({ code: "installation-link-invalid" });
  });

  it("rejects altered cookies, browser/receipt confusion, secret rotation and cross-App replay", async () => {
    const value = fixture();
    const { completion, start } = await authorize(value);
    await expect(
      value.adapter.verifyCallbackReceipt(start.cookie, binding),
    ).rejects.toMatchObject({ code: "installation-link-invalid" });
    const pieces = completion.callbackReceipt.split(".");
    pieces[2] =
      ((pieces[2] ?? "").startsWith("A") ? "B" : "A") +
      (pieces[2] ?? "").slice(1);
    await expect(
      value.adapter.verifyCallbackReceipt(pieces.join("."), binding),
    ).rejects.toMatchObject({ code: "installation-link-invalid" });
    const otherApp = new GitHubInstallationLinkAdapter({
      ...value.configuration,
      appId: 100,
    });
    await expect(
      otherApp.verifyCallbackReceipt(completion.callbackReceipt, binding),
    ).rejects.toMatchObject({ code: "installation-link-invalid" });
    const rotated = new GitHubInstallationLinkAdapter({
      ...value.configuration,
      secrets: {
        resolveSecret: () =>
          Promise.resolve(Buffer.from("replacement-client-secret-synthetic")),
      },
    });
    await expect(
      rotated.verifyCallbackReceipt(completion.callbackReceipt, binding),
    ).rejects.toMatchObject({ code: "installation-link-invalid" });
  });

  it("rejects setup state, unsupported action and OAuth CSRF mismatches before provider requests", async () => {
    const value = fixture();
    const start = await value.adapter.createBrowserSession(value.startInput);
    for (const changes of [
      { state: "wrong" },
      { setupAction: "update" },
      { installationId: 0 },
    ]) {
      await expect(
        value.adapter.continueInstallationSetup({
          cookie: start.cookie,
          installationId: 71,
          setupAction: "install",
          state,
          ...changes,
        }),
      ).rejects.toMatchObject({ code: "installation-link-invalid" });
    }
    await expect(
      value.adapter.completeAuthorization({
        code: "synthetic",
        cookie: start.cookie,
        state,
      }),
    ).rejects.toMatchObject({ code: "installation-link-invalid" });
    const setup = await value.adapter.continueInstallationSetup({
      cookie: start.cookie,
      installationId: 71,
      setupAction: "install",
      state,
    });
    await expect(
      value.adapter.completeAuthorization({
        code: "synthetic",
        cookie: setup.cookie,
        state,
      }),
    ).rejects.toMatchObject({ code: "installation-link-invalid" });
    expect(value.fetch).not.toHaveBeenCalled();
  });

  it("expires all proof at the original intent boundary without extending it during OAuth", async () => {
    const value = fixture();
    const { completion, start } = await authorize(value);
    value.advance(600_000);
    await expect(
      value.adapter.verifyCallbackReceipt(completion.callbackReceipt, binding),
    ).rejects.toMatchObject({ code: "installation-link-invalid" });
    await expect(
      value.adapter.continueInstallationSetup({
        cookie: start.cookie,
        installationId: 71,
        setupAction: "install",
        state,
      }),
    ).rejects.toMatchObject({ code: "installation-link-invalid" });
    await expect(
      value.adapter.createBrowserSession({
        ...value.startInput,
        expiresAt: "2026-09-05T12:30:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "installation-link-invalid" });
  });

  it.each([
    "https://evil.example.test/",
    "//evil.example.test/",
    "/organizations/other/settings",
    "/organizations/org_synthetic/../other",
    "/organizations/org_synthetic/%2e%2e/other",
    "/organizations/org_synthetic/settings?redirect=evil",
    "/organizations/org_synthetic/settings#secret",
    "/organizations/org_synthetic/\\evil",
    "/organizations/org_synthetic//evil",
  ])(
    "rejects unbound or ambiguous callback return path %s",
    async (returnPath) => {
      const value = fixture();
      await expect(
        value.adapter.createBrowserSession({ ...value.startInput, returnPath }),
      ).rejects.toMatchObject({ code: "installation-link-invalid" });
    },
  );

  it("loads only the configured JSON field and erases the fresh resolver buffer", async () => {
    const raw = Buffer.from(
      JSON.stringify({ "Client secret": "synthetic-json-client-secret" }),
    );
    const value = fixture({
      configuration: {
        clientSecretJsonField: "Client secret",
        secrets: { resolveSecret: () => Promise.resolve(raw) },
      },
    });
    await value.adapter.createBrowserSession(value.startInput);
    expect(raw.every((byte) => byte === 0)).toBe(true);
    const malformed = fixture({
      configuration: {
        clientSecretJsonField: "Client secret",
        secrets: {
          resolveSecret: () =>
            Promise.resolve(
              Buffer.from('{"wrong":"synthetic-json-client-secret"}'),
            ),
        },
      },
    });
    await expect(
      malformed.adapter.createBrowserSession(malformed.startInput),
    ).rejects.toMatchObject({ code: "secret-unavailable" });
  });

  it("bounds response bodies and hides provider bodies, malformed tokens and failures", async () => {
    for (const response of [
      new Response("provider-sensitive-body", { status: 403 }),
      Response.json({
        error: "bad_verification_code",
        details: "provider-sensitive-body",
      }),
      new Response("x".repeat(524_289), { status: 200 }),
      new Response("provider-sensitive-body", { status: 502 }),
    ]) {
      const value = fixture();
      value.fetch.mockResolvedValueOnce(response);
      await expect(authorize(value)).rejects.not.toThrow(
        "provider-sensitive-body",
      );
      expect(
        value.buffers.every((buffer) => buffer.every((byte) => byte === 0)),
      ).toBe(true);
    }
  });

  it("uses bounded numeric pages and fails closed instead of following provider links", async () => {
    const value = fixture();
    value.fetch.mockImplementation((url) => {
      if (String(url).includes("access_token"))
        return Promise.resolve(
          Response.json({
            access_token: value.accessToken,
            scope: "",
            token_type: "bearer",
          }),
        );
      if (String(url) === "https://api.github.com/user")
        return Promise.resolve(Response.json({ id: 31, type: "User" }));
      return Promise.resolve(
        Response.json(
          {
            installations: Array.from({ length: 100 }, (_, index) => ({
              id: index + 1_000,
            })),
            total_count: 999_999,
          },
          { headers: { Link: '<https://evil.example.test/>; rel="next"' } },
        ),
      );
    });
    await expect(authorize(value)).rejects.toMatchObject({
      code: "installation-link-invalid",
    });
    expect(value.fetch).toHaveBeenCalledTimes(7);
    expect(
      value.fetch.mock.calls.every(([url]) => !String(url).includes("evil")),
    ).toBe(true);
  });

  it("composes real contextual proof with one-time intent claiming and idempotent finalization", async () => {
    const value = fixture();
    const github = new FakeGitHubAppAdapter();
    github.addInstallation({
      accountId: 31,
      accountLogin: "synthetic-user",
      accountType: "User",
      installationId: 71,
      permissions: {
        contents: "write",
        metadata: "read",
        pullRequests: "write",
        workflows: "none",
      },
      repositorySelection: "selected",
      suspended: false,
    });
    const inspect = vi.spyOn(github, "inspectInstallation");
    const store = new InMemoryGitHubExportStore();
    const service = new GitHubRepositoryExportService({
      artifactRepository: { getApprovedPackage: () => Promise.resolve(null) },
      audit: new RecordingGitHubExportAuditSink(),
      clock: () => initialTime,
      github,
      idFactory: () => "integration_synthetic",
      installationLinkCallbackVerifier: value.adapter,
      installationSetupUrl:
        "https://github.com/apps/cloudmarkup-test/installations/new",
      linkIntentIdFactory: () => binding.intentId,
      linkStateFactory: () => state,
      progress: new RecordingGitHubExportProgressSink(),
      store,
    });
    await service.createInstallationLinkIntent({
      correlationId: "correlation_synthetic",
      organizationId: binding.organizationId,
      principalId: binding.principalId,
    });
    const { completion } = await authorize(value);
    const request = {
      ...binding,
      callbackReceipt: completion.callbackReceipt,
      correlationId: "correlation_synthetic",
    };
    for (const field of [
      "intentId",
      "organizationId",
      "principalId",
      "sessionId",
    ] as const) {
      await expect(
        service.completeInstallationLink({
          ...request,
          [field]: "other_synthetic",
        }),
      ).rejects.toMatchObject({ code: "installation-link-invalid" });
    }
    expect(inspect).not.toHaveBeenCalled();
    const first = await service.completeInstallationLink(request);
    const second = await service.completeInstallationLink(request);
    expect(second).toEqual(first);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(store.installationLinkIntents.get(binding.intentId)?.state).toBe(
      "completed",
    );
    expect(store.installations.size).toBe(1);
  });
});
