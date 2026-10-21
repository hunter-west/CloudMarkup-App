import { createHash, generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubRestAppAdapter } from "./github-rest-adapter.js";
import type {
  GitHubAppConfiguration,
  GitHubRepositoryDescriptor,
  SecretConfigurationResolver,
} from "./ports.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey
  .export({ format: "pem", type: "pkcs8" })
  .toString();
const configuration: GitHubAppConfiguration = {
  apiBaseUrl: "https://api.github.test",
  apiVersion: "2022-11-28",
  appId: "12345",
  privateKeySecretReference: "secret://github/app-private-key",
  userAgent: "cloudmarkup-test",
  webhookSecretReference: "secret://github/webhook",
};

class PrivateKeyResolver implements SecretConfigurationResolver {
  buffers: Uint8Array[] = [];
  resolveSecret(reference: string): Promise<Uint8Array> {
    if (reference !== configuration.privateKeySecretReference) {
      return Promise.reject(new Error("unexpected secret reference"));
    }
    const value = new TextEncoder().encode(privateKeyPem);
    this.buffers.push(value);
    return Promise.resolve(value);
  }
}

function json(
  body: unknown,
  status = 200,
  headers?: Readonly<Record<string, string>>,
): Response {
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(headers ?? {})) {
    responseHeaders.set(name, value);
  }
  responseHeaders.set("content-type", "application/json");
  return new Response(JSON.stringify(body), {
    headers: responseHeaders,
    status,
  });
}

function gitBlobObjectSha(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${String(bytes.byteLength)}\0`)
    .update(bytes)
    .digest("hex");
}

function jsonAt(
  body: unknown,
  url: string,
  options: { readonly redirected?: boolean; readonly status?: number } = {},
): Response {
  const response = json(body, options.status ?? 200);
  Object.defineProperties(response, {
    redirected: {
      configurable: true,
      value: options.redirected ?? false,
    },
    url: { configurable: true, value: url },
  });
  return response;
}

function repositoryFixture(): GitHubRepositoryDescriptor {
  return {
    archived: false,
    defaultBranch: "main",
    disabled: false,
    installationId: 77,
    name: "customer-repository",
    nodeId: "repository-node-900",
    ownerId: 500,
    owner: "example-org",
    private: true,
    pushedAt: "2026-08-23T11:00:00.000Z",
    repositoryId: 900,
  };
}

describe("GitHub REST App adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rechecks authority after secret resolution and prevents the actual request when access is revoked", async () => {
    const secrets = new PrivateKeyResolver();
    let allowed = true;
    const authorizeBeforeRequest = vi.fn(() => {
      if (!allowed) throw new Error("Synthetic authorization denial.");
      return Promise.resolve();
    });
    const request = vi.fn(() => Promise.resolve(json({})));
    const adapter = new GitHubRestAppAdapter({
      configuration,
      fetch: request,
      authorizeBeforeRequest,
      secrets: {
        resolveSecret: async (reference) => {
          const key = await secrets.resolveSecret(reference);
          allowed = false;
          return key;
        },
      },
    });
    await expect(adapter.inspectInstallation(77)).rejects.toThrow(
      "Synthetic authorization denial.",
    );
    expect(authorizeBeforeRequest).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    expect(
      secrets.buffers.every((buffer) => buffer.every((byte) => byte === 0)),
    ).toBe(true);
  });

  it("reauthorizes every HTTP request inside an installation session, not just token creation", async () => {
    const trace: string[] = [];
    let allowed = true;
    const request = vi.fn(() => {
      trace.push("fetch");
      return Promise.resolve(
        json({
          token: "unit-test-iat-value-1234567890",
          expires_at: "2026-08-23T12:30:00.000Z",
        }),
      );
    });
    const adapter = new GitHubRestAppAdapter({
      configuration,
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      fetch: request,
      secrets: new PrivateKeyResolver(),
      authorizeBeforeRequest: () => {
        trace.push("authorize");
        if (!allowed) throw new Error("Synthetic authorization denial.");
        return Promise.resolve();
      },
    });
    await expect(
      adapter.withInstallationSession(
        {
          installationId: 77,
          repositoryIds: [900],
          permissions: {
            contents: "read",
            metadata: "read",
            pullRequests: "none",
            workflows: "none",
          },
        },
        async (session) => {
          allowed = false;
          return session.listRepositories();
        },
      ),
    ).rejects.toThrow("Synthetic authorization denial.");
    expect(trace).toEqual(["authorize", "fetch", "authorize"]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("accepts full and REST-only configurations without resolving a webhook secret", async () => {
    const secrets = new PrivateKeyResolver();
    const resolveSecret = vi.spyOn(secrets, "resolveSecret");
    const options = {
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      fetch: () =>
        Promise.resolve(
          json({
            account: { id: 500, login: "example-org", type: "Organization" },
            id: 77,
            permissions: { contents: "write", metadata: "read" },
            repository_selection: "selected",
            suspended_at: null,
          }),
        ),
      secrets,
    };
    const adapters = [
      new GitHubRestAppAdapter({
        ...options,
        configuration: {
          ...configuration,
          webhookSecretReference: configuration.webhookSecretReference,
        },
      }),
      new GitHubRestAppAdapter({
        ...options,
        configuration: {
          apiBaseUrl: configuration.apiBaseUrl,
          apiVersion: configuration.apiVersion,
          appId: configuration.appId,
          privateKeySecretReference: configuration.privateKeySecretReference,
          userAgent: configuration.userAgent,
        },
      }),
    ];
    for (const adapter of adapters) {
      await expect(adapter.inspectInstallation(77)).resolves.toMatchObject({
        installationId: 77,
        repositorySelection: "selected",
      });
    }
    expect(resolveSecret.mock.calls).toEqual([
      [configuration.privateKeySecretReference],
      [configuration.privateKeySecretReference],
    ]);
    expect(
      secrets.buffers.every((buffer) => buffer.every((byte) => byte === 0)),
    ).toBe(true);
  });

  it("signs App JWTs, requests a short-lived repository-scoped minimum-permission token, and returns no token", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const secrets = new PrivateKeyResolver();
    const requests: {
      body?: string;
      headers: Headers;
      method: string;
      redirect?: NonNullable<RequestInit["redirect"]>;
      signal?: AbortSignal | null;
      url: string;
    }[] = [];
    const responses = [
      json({
        account: { id: 500, login: "example-org", type: "Organization" },
        id: 77,
        permissions: {
          contents: "write",
          metadata: "read",
          pull_requests: "write",
          workflows: "write",
        },
        repository_selection: "selected",
        suspended_at: null,
      }),
      json(
        {
          expires_at: "2026-08-23T12:59:00.000Z",
          token: "unit-test-iat-value-1234567890",
        },
        201,
      ),
      json({
        repositories: [
          {
            archived: false,
            default_branch: "main",
            disabled: false,
            id: 900,
            name: "customer-repository",
            node_id: "repository-node-900",
            owner: { id: 500, login: "example-org" },
            private: true,
            pushed_at: "2026-08-23T11:00:00.000Z",
          },
        ],
      }),
    ];
    const adapter = new GitHubRestAppAdapter({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      configuration,
      fetch: (input, init) => {
        const redirect = init?.redirect;
        const signal = init?.signal;
        requests.push({
          ...(typeof init?.body === "string" ? { body: init.body } : {}),
          headers: new Headers(init?.headers),
          method: init?.method ?? "GET",
          ...(redirect === undefined ? {} : { redirect }),
          ...(signal === undefined ? {} : { signal }),
          url: String(input),
        });
        const response = responses.shift();
        if (response === undefined) throw new Error("unexpected request");
        return Promise.resolve(response);
      },
      secrets,
    });

    await expect(adapter.inspectInstallation(77)).resolves.toMatchObject({
      installationId: 77,
      repositorySelection: "selected",
    });
    const repositories = await adapter.withInstallationSession(
      {
        installationId: 77,
        permissions: {
          contents: "read",
          metadata: "read",
          pullRequests: "none",
          workflows: "none",
        },
        repositoryIds: [900],
      },
      (session) => session.listRepositories(),
    );
    expect(repositories).toEqual([
      expect.objectContaining({ repositoryId: 900, owner: "example-org" }),
    ]);
    expect(JSON.parse(requests[1]?.body ?? "{}")).toEqual({
      permissions: { contents: "read", metadata: "read" },
      repository_ids: [900],
    });
    expect(requests[0]?.headers.get("authorization")?.split(".")).toHaveLength(
      3,
    );
    expect(requests[2]?.headers.get("authorization")).toBe(
      "Bearer unit-test-iat-value-1234567890",
    );
    expect(JSON.stringify(repositories)).not.toContain("unit-test-iat");
    expect(
      secrets.buffers.every((buffer) => buffer.every((byte) => byte === 0)),
    ).toBe(true);
    expect(requests.every(({ redirect }) => redirect === "error")).toBe(true);
    expect(requests.every(({ signal }) => signal instanceof AbortSignal)).toBe(
      true,
    );
    expect(timeoutSpy).toHaveBeenCalledTimes(requests.length);
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
  });

  it.each(["http://api.github.test", "https://user@api.github.test"])(
    "rejects an unsafe API base URL: %s",
    (apiBaseUrl) => {
      expect(
        () =>
          new GitHubRestAppAdapter({
            configuration: { ...configuration, apiBaseUrl },
            fetch: () => Promise.reject(new Error("must not fetch")),
            secrets: new PrivateKeyResolver(),
          }),
      ).toThrow();
    },
  );

  it("accepts only the exact requested response URL", async () => {
    const expectedUrl = "https://api.github.test/app/installations/77";
    const adapter = new GitHubRestAppAdapter({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      configuration,
      fetch: () =>
        Promise.resolve(
          jsonAt(
            {
              account: {
                id: 500,
                login: "example-org",
                type: "Organization",
              },
              id: 77,
              permissions: { contents: "write", metadata: "read" },
              repository_selection: "selected",
              suspended_at: null,
            },
            expectedUrl,
          ),
        ),
      secrets: new PrivateKeyResolver(),
    });

    await expect(adapter.inspectInstallation(77)).resolves.toMatchObject({
      installationId: 77,
    });
  });

  it.each([
    [
      "redirected response",
      "https://api.github.test/app/installations/77",
      true,
    ],
    [
      "cross-origin response URL",
      "https://attacker.example/app/installations/77",
      false,
    ],
    [
      "rewritten response URL",
      "https://api.github.test/app/installations/78",
      false,
    ],
  ])("rejects a %s", async (_name, responseUrl, redirected) => {
    const adapter = new GitHubRestAppAdapter({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      configuration,
      fetch: () => Promise.resolve(jsonAt({}, responseUrl, { redirected })),
      secrets: new PrivateKeyResolver(),
    });

    await expect(adapter.inspectInstallation(77)).rejects.toMatchObject({
      code: "service-unavailable",
      transient: true,
    });
  });

  it("fails closed when the selected destination contains a Git submodule", async () => {
    const responses = [
      json(
        {
          expires_at: "2026-08-23T12:59:00.000Z",
          token: "unit-test-iat-value-1234567890",
        },
        201,
      ),
      json({ object: { sha: "a".repeat(40) } }),
      json({
        sha: "a".repeat(40),
        tree: { sha: "b".repeat(40) },
      }),
      json({
        sha: "b".repeat(40),
        tree: [
          {
            mode: "160000",
            path: "solutions/notes-api/vendor/module",
            sha: "c".repeat(40),
            type: "commit",
          },
        ],
        truncated: false,
      }),
    ];
    const requestedUrls: string[] = [];
    const adapter = new GitHubRestAppAdapter({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      configuration,
      fetch: (input) => {
        requestedUrls.push(String(input));
        const response = responses.shift();
        if (response === undefined) throw new Error("unexpected request");
        return Promise.resolve(response);
      },
      secrets: new PrivateKeyResolver(),
    });
    const repository: GitHubRepositoryDescriptor = {
      archived: false,
      defaultBranch: "main",
      disabled: false,
      installationId: 77,
      name: "customer-repository",
      nodeId: "repository-node-900",
      ownerId: 500,
      owner: "example-org",
      private: true,
      pushedAt: "2026-08-23T11:00:00.000Z",
      repositoryId: 900,
    };

    await expect(
      adapter.withInstallationSession(
        {
          installationId: 77,
          permissions: {
            contents: "read",
            metadata: "read",
            pullRequests: "none",
            workflows: "none",
          },
          repositoryIds: [900],
        },
        (session) =>
          session.readSnapshot({
            candidatePaths: ["solutions/notes-api/README.md"],
            baseBranch: "main",
            destinationFolder: "solutions/notes-api",
            repository,
            workflowPaths: [],
          }),
      ),
    ).rejects.toMatchObject({
      code: "preview-blocked",
    });
    expect(requestedUrls.some((url) => url.includes("/git/blobs/"))).toBe(
      false,
    );
    expect(responses).toHaveLength(0);
  });

  it.each([
    {
      candidatePaths: ["solutions/notes-api/README.md"],
      entries: [
        {
          mode: "100644",
          path: "solutions",
          sha: "c".repeat(40),
          type: "blob",
        },
      ],
      kind: "file at a destination ancestor",
      workflowPaths: [],
    },
    {
      candidatePaths: ["solutions/notes-api/README.md"],
      entries: [
        {
          mode: "040000",
          path: "solutions/notes-api/README.md",
          sha: "c".repeat(40),
          type: "tree",
        },
        {
          mode: "100644",
          path: "solutions/notes-api/README.md/customer.txt",
          sha: "d".repeat(40),
          type: "blob",
        },
      ],
      kind: "user subtree at a candidate file",
      workflowPaths: [],
    },
    {
      candidatePaths: ["solutions/notes-api/README.md"],
      entries: [
        {
          mode: "040000",
          path: ".github/workflows/cloudmarkup-plan.yml",
          sha: "c".repeat(40),
          type: "tree",
        },
        {
          mode: "100644",
          path: ".github/workflows/cloudmarkup-plan.yml/customer.txt",
          sha: "d".repeat(40),
          type: "blob",
        },
      ],
      kind: "user subtree at an exact reviewed workflow",
      workflowPaths: [".github/workflows/cloudmarkup-plan.yml"],
    },
  ])(
    "rejects a $kind from recursive metadata before fetching any blob",
    async ({ candidatePaths, entries, workflowPaths }) => {
      const responses = [
        json(
          {
            expires_at: "2026-08-23T12:59:00.000Z",
            token: "unit-test-iat-value-1234567890",
          },
          201,
        ),
        json({ object: { sha: "a".repeat(40) } }),
        json({
          sha: "a".repeat(40),
          tree: { sha: "b".repeat(40) },
        }),
        json({
          sha: "b".repeat(40),
          tree: entries,
          truncated: false,
        }),
      ];
      const requestedUrls: string[] = [];
      const adapter = new GitHubRestAppAdapter({
        clock: () => new Date("2026-08-23T12:00:00.000Z"),
        configuration,
        fetch: (input) => {
          requestedUrls.push(String(input));
          const response = responses.shift();
          if (response === undefined) throw new Error("unexpected request");
          return Promise.resolve(response);
        },
        secrets: new PrivateKeyResolver(),
      });

      await expect(
        adapter.withInstallationSession(
          {
            installationId: 77,
            permissions: {
              contents: "read",
              metadata: "read",
              pullRequests: "none",
              workflows: "none",
            },
            repositoryIds: [900],
          },
          (session) =>
            session.readSnapshot({
              candidatePaths,
              baseBranch: "main",
              destinationFolder: "solutions/notes-api",
              repository: repositoryFixture(),
              workflowPaths,
            }),
        ),
      ).rejects.toMatchObject({ code: "path-conflict" });
      expect(requestedUrls.some((url) => url.includes("/git/blobs/"))).toBe(
        false,
      );
      expect(responses).toHaveLength(0);
    },
  );

  it("reads a snapshot only when commit, tree, blob, and blob content identities are exact", async () => {
    const commitSha = "a".repeat(40);
    const treeSha = "b".repeat(40);
    const bytes = new TextEncoder().encode("reviewed source");
    const blobSha = gitBlobObjectSha(bytes);
    const responses = [
      json(
        {
          expires_at: "2026-08-23T12:59:00.000Z",
          token: "unit-test-iat-value-1234567890",
        },
        201,
      ),
      json({ object: { sha: commitSha } }),
      json({ sha: commitSha, tree: { sha: treeSha } }),
      json({
        sha: treeSha,
        tree: [
          {
            mode: "040000",
            path: "docs",
            sha: "c".repeat(40),
            type: "tree",
          },
          {
            mode: "100644",
            path: "docs/unrelated.txt",
            sha: "d".repeat(40),
            size: 1_000,
            type: "blob",
          },
          {
            mode: "100644",
            path: "solutions/notes-api/README.md",
            sha: blobSha,
            size: bytes.byteLength,
            type: "blob",
          },
        ],
        truncated: false,
      }),
      json({
        content: Buffer.from(bytes).toString("base64"),
        encoding: "base64",
        sha: blobSha,
        size: bytes.byteLength,
      }),
    ];
    const requestedUrls: string[] = [];
    const adapter = new GitHubRestAppAdapter({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      configuration,
      fetch: (input) => {
        requestedUrls.push(String(input));
        const response = responses.shift();
        if (response === undefined) throw new Error("unexpected request");
        return Promise.resolve(response);
      },
      secrets: new PrivateKeyResolver(),
    });

    const snapshot = await adapter.withInstallationSession(
      {
        installationId: 77,
        permissions: {
          contents: "read",
          metadata: "read",
          pullRequests: "none",
          workflows: "none",
        },
        repositoryIds: [900],
      },
      (session) =>
        session.readSnapshot({
          candidatePaths: ["solutions/notes-api/README.md"],
          baseBranch: "main",
          destinationFolder: "solutions/notes-api",
          repository: repositoryFixture(),
          workflowPaths: [],
        }),
    );

    expect(snapshot.baseCommitSha).toBe(commitSha);
    expect(snapshot.treeSha).toBe(treeSha);
    expect(snapshot.files).toEqual([
      expect.objectContaining({
        gitBlobSha: blobSha,
        path: "solutions/notes-api/README.md",
      }),
    ]);
    expect(snapshot.files[0]?.bytes).toEqual(bytes);
    expect(
      requestedUrls.filter((url) => url.includes("/git/blobs/")),
    ).toHaveLength(1);
    expect(responses).toHaveLength(0);
  });

  it.each(["commit", "tree", "blob", "blob-content"])(
    "rejects substituted %s identity while reading a snapshot",
    async (substitution) => {
      const commitSha = "a".repeat(40);
      const treeSha = "b".repeat(40);
      const trustedBytes = new TextEncoder().encode("safe");
      const returnedBytes =
        substitution === "blob-content"
          ? new TextEncoder().encode("evil")
          : trustedBytes;
      const blobSha = gitBlobObjectSha(trustedBytes);
      const substitutedSha = "f".repeat(40);
      const responses = [
        json(
          {
            expires_at: "2026-08-23T12:59:00.000Z",
            token: "unit-test-iat-value-1234567890",
          },
          201,
        ),
        json({ object: { sha: commitSha } }),
        json({
          sha: substitution === "commit" ? substitutedSha : commitSha,
          tree: { sha: treeSha },
        }),
        json({
          sha: substitution === "tree" ? substitutedSha : treeSha,
          tree: [
            {
              mode: "100644",
              path: "solutions/notes-api/README.md",
              sha: blobSha,
              size: trustedBytes.byteLength,
              type: "blob",
            },
          ],
          truncated: false,
        }),
        json({
          content: Buffer.from(returnedBytes).toString("base64"),
          encoding: "base64",
          sha: substitution === "blob" ? substitutedSha : blobSha,
          size: returnedBytes.byteLength,
        }),
      ];
      const adapter = new GitHubRestAppAdapter({
        clock: () => new Date("2026-08-23T12:00:00.000Z"),
        configuration,
        fetch: () => {
          const response = responses.shift();
          if (response === undefined) throw new Error("unexpected request");
          return Promise.resolve(response);
        },
        secrets: new PrivateKeyResolver(),
      });

      await expect(
        adapter.withInstallationSession(
          {
            installationId: 77,
            permissions: {
              contents: "read",
              metadata: "read",
              pullRequests: "none",
              workflows: "none",
            },
            repositoryIds: [900],
          },
          (session) =>
            session.readSnapshot({
              candidatePaths: ["solutions/notes-api/README.md"],
              baseBranch: "main",
              destinationFolder: "solutions/notes-api",
              repository: repositoryFixture(),
              workflowPaths: [],
            }),
        ),
      ).rejects.toMatchObject({ code: "service-unavailable" });
    },
  );

  it("maps rate limits to a safe retryable error without response bodies", async () => {
    const adapter = new GitHubRestAppAdapter({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      configuration,
      fetch: () =>
        Promise.resolve(
          json({ message: "sensitive provider diagnostic" }, 403, {
            "retry-after": "42",
            "x-ratelimit-remaining": "0",
          }),
        ),
      secrets: new PrivateKeyResolver(),
    });
    await expect(adapter.inspectInstallation(77)).rejects.toMatchObject({
      code: "rate-limited",
      message: "GitHub temporarily limited this request. Try again later.",
      retryAfterSeconds: 42,
      transient: true,
    });
  });

  it("reads the merge base for immutable commit SHAs", async () => {
    const baseCommitSha = "a".repeat(40);
    const headCommitSha = "b".repeat(40);
    const responses = [
      json(
        {
          expires_at: "2026-08-23T12:59:00.000Z",
          token: "unit-test-iat-value-1234567890",
        },
        201,
      ),
      json({ merge_base_commit: { sha: baseCommitSha } }),
    ];
    const urls: string[] = [];
    const adapter = new GitHubRestAppAdapter({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      configuration,
      fetch: (input) => {
        urls.push(String(input));
        const response = responses.shift();
        if (response === undefined) throw new Error("unexpected request");
        return Promise.resolve(response);
      },
      secrets: new PrivateKeyResolver(),
    });
    const repository: GitHubRepositoryDescriptor = {
      archived: false,
      defaultBranch: "main",
      disabled: false,
      installationId: 77,
      name: "customer-repository",
      nodeId: "repository-node-900",
      ownerId: 500,
      owner: "example-org",
      private: true,
      pushedAt: "2026-08-23T11:00:00.000Z",
      repositoryId: 900,
    };

    await expect(
      adapter.withInstallationSession(
        {
          installationId: 77,
          permissions: {
            contents: "write",
            metadata: "read",
            pullRequests: "write",
            workflows: "none",
          },
          repositoryIds: [900],
        },
        (session) =>
          session.findMergeBase({
            baseCommitSha,
            headCommitSha,
            repository,
          }),
      ),
    ).resolves.toBe(baseCommitSha);
    expect(
      urls[1]?.endsWith(`/compare/${baseCommitSha}...${headCommitSha}`),
    ).toBe(true);
    expect(responses).toHaveLength(0);
  });

  it.each(["parent", "blob", "recovery"])(
    "rejects substituted %s identity while creating a commit",
    async (substitution) => {
      const baseCommitSha = "a".repeat(40);
      const expectedTreeSha = "b".repeat(40);
      const remoteCommitSha = "c".repeat(40);
      const substitutedSha = "f".repeat(40);
      const mutationBytes = new TextEncoder().encode("exact reviewed bytes");
      const mutationBlobSha = gitBlobObjectSha(mutationBytes);
      const responses = [
        json(
          {
            expires_at: "2026-08-23T12:59:00.000Z",
            token: "unit-test-iat-value-1234567890",
          },
          201,
        ),
        json({
          sha: substitution === "parent" ? substitutedSha : baseCommitSha,
          tree: { sha: "d".repeat(40) },
        }),
        json(
          {
            sha: substitution === "blob" ? substitutedSha : mutationBlobSha,
          },
          201,
        ),
        json({ sha: expectedTreeSha }, 201),
        json({ object: { sha: remoteCommitSha } }),
        json({
          parents: [{ sha: baseCommitSha }],
          sha: substitution === "recovery" ? substitutedSha : remoteCommitSha,
          tree: { sha: expectedTreeSha },
        }),
      ];
      const adapter = new GitHubRestAppAdapter({
        clock: () => new Date("2026-08-23T12:00:00.000Z"),
        configuration,
        fetch: () => {
          const response = responses.shift();
          if (response === undefined) throw new Error("unexpected request");
          return Promise.resolve(response);
        },
        secrets: new PrivateKeyResolver(),
      });

      await expect(
        adapter.withInstallationSession(
          {
            installationId: 77,
            permissions: {
              contents: "write",
              metadata: "read",
              pullRequests: "write",
              workflows: "none",
            },
            repositoryIds: [900],
          },
          (session) =>
            session.createCommit({
              branch: "cloudmarkup/notes-api",
              expectedHeadSha: baseCommitSha,
              message: "Export Solution revision.1",
              mutations: [
                {
                  bytes: mutationBytes,
                  path: "solutions/notes-api/README.md",
                  type: "upsert",
                },
              ],
              repository: repositoryFixture(),
            }),
        ),
      ).rejects.toMatchObject({
        code:
          substitution === "recovery"
            ? "repository-changed"
            : "service-unavailable",
      });
    },
  );

  it("reconciles an ambiguous commit only when the remote parent and complete tree are exact", async () => {
    const baseCommitSha = "a".repeat(40);
    const expectedTreeSha = "b".repeat(40);
    const remoteCommitSha = "c".repeat(40);
    const mutationBytes = new TextEncoder().encode("exact reviewed bytes");
    const mutationBlobSha = gitBlobObjectSha(mutationBytes);
    const responses = [
      json(
        {
          expires_at: "2026-08-23T12:59:00.000Z",
          token: "unit-test-iat-value-1234567890",
        },
        201,
      ),
      json({ sha: baseCommitSha, tree: { sha: "d".repeat(40) } }),
      json({ sha: mutationBlobSha }, 201),
      json({ sha: expectedTreeSha }, 201),
      json({ object: { sha: remoteCommitSha } }),
      json({
        parents: [{ sha: baseCommitSha }],
        sha: remoteCommitSha,
        tree: { sha: expectedTreeSha },
      }),
    ];
    const requests: { method: string; url: string }[] = [];
    const adapter = new GitHubRestAppAdapter({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      configuration,
      fetch: (input, init) => {
        requests.push({
          method: init?.method ?? "GET",
          url: String(input),
        });
        const response = responses.shift();
        if (response === undefined) throw new Error("unexpected request");
        return Promise.resolve(response);
      },
      secrets: new PrivateKeyResolver(),
    });
    const repository: GitHubRepositoryDescriptor = {
      archived: false,
      defaultBranch: "main",
      disabled: false,
      installationId: 77,
      name: "customer-repository",
      nodeId: "repository-node-900",
      ownerId: 500,
      owner: "example-org",
      private: true,
      pushedAt: "2026-08-23T11:00:00.000Z",
      repositoryId: 900,
    };

    await expect(
      adapter.withInstallationSession(
        {
          installationId: 77,
          permissions: {
            contents: "write",
            metadata: "read",
            pullRequests: "write",
            workflows: "none",
          },
          repositoryIds: [900],
        },
        (session) =>
          session.createCommit({
            branch: "cloudmarkup/notes-api",
            expectedHeadSha: baseCommitSha,
            message: "Export Solution revision.1",
            mutations: [
              {
                bytes: mutationBytes,
                path: "solutions/notes-api/README.md",
                type: "upsert",
              },
            ],
            repository,
          }),
      ),
    ).resolves.toBe(remoteCommitSha);
    expect(
      requests.some(
        ({ method, url }) => method === "POST" && url.endsWith("/git/commits"),
      ),
    ).toBe(false);
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
    expect(responses).toHaveLength(0);
  });
});

describe("exact-commit file discovery", () => {
  const commitSha = "a".repeat(40),
    treeSha = "b".repeat(40),
    blobSha = "c".repeat(40);
  const file = {
    path: "infrastructure/main.tf",
    mode: "100644",
    type: "blob",
    sha: blobSha,
    size: 100,
  };
  function setup(
    tree: readonly unknown[] = [file],
    overrides: {
      treeSha?: string;
      commitSha?: string;
      truncated?: boolean;
    } = {},
  ) {
    const requests: { path: string; method: string; body: unknown }[] = [];
    const adapter = new GitHubRestAppAdapter({
      configuration,
      secrets: new PrivateKeyResolver(),
      clock: () => new Date("2026-08-23T12:00:00Z"),
      fetch: (url, init) => {
        const path = new URL(url).pathname;
        requests.push({
          path,
          method: init?.method ?? "GET",
          body: init?.body,
        });
        if (path.endsWith("/access_tokens"))
          return Promise.resolve(
            json({
              token: "synthetic-read-only-token",
              expires_at: "2026-08-23T12:30:00Z",
            }),
          );
        if (path.includes("/git/ref/"))
          return Promise.resolve(json({ object: { sha: "d".repeat(40) } }));
        if (path.includes("/git/commits/"))
          return Promise.resolve(
            json({
              sha: overrides.commitSha ?? commitSha,
              tree: { sha: treeSha },
            }),
          );
        if (path.includes("/git/trees/"))
          return Promise.resolve(
            json({
              sha: overrides.treeSha ?? treeSha,
              tree,
              truncated: overrides.truncated ?? false,
            }),
          );
        throw new Error("Unexpected provider request");
      },
    });
    const discover = (
      scope: {
        selectedPaths?: readonly string[];
        ignoredPaths?: readonly string[];
      } = {},
    ) =>
      adapter.withRepositoryReadSession(
        { installationId: 77, repositoryIds: [900] },
        (session) =>
          session.discoverPinnedFiles({
            branch: "main",
            commitSha,
            repository: repositoryFixture(),
            selectedPaths: scope.selectedPaths ?? ["."],
            ignoredPaths: scope.ignoredPaths ?? [],
          }),
      );
    return { discover, requests };
  }
  it("uses only scoped read token and three metadata reads, retaining selected commit when branch moves", async () => {
    const value = setup([
      { ...file, path: "src/index.ts" },
      { ...file, path: ".env" },
      { ...file, path: "infrastructure", mode: "040000", type: "tree" },
      file,
      { ...file, path: "assets/logo.png" },
      { ...file, path: "vendor/tool.ts" },
    ]);
    const result = await value.discover({ ignoredPaths: ["vendor"] });
    expect(result).toEqual({
      branch: "main",
      branchHeadSha: "d".repeat(40),
      commitSha,
      treeSha,
      repositoryId: 900,
      files: [
        { gitBlobSha: blobSha, path: "infrastructure/main.tf", sizeBytes: 100 },
        { gitBlobSha: blobSha, path: "src/index.ts", sizeBytes: 100 },
      ],
    });
    expect(value.requests).toHaveLength(4);
    expect(
      value.requests
        .slice(1)
        .every(
          (request) =>
            request.method === "GET" && !request.path.includes("/blobs/"),
        ),
    ).toBe(true);
    expect(JSON.parse(String(value.requests[0]?.body))).toEqual({
      repository_ids: [900],
      permissions: { contents: "read", metadata: "read" },
    });
  });
  it.each([
    { name: "missing size", entries: [{ ...file, size: undefined }] },
    {
      name: "oversized file",
      entries: [{ ...file, size: 8 * 1024 * 1024 + 1 }],
    },
    {
      name: "oversized total",
      entries: Array.from({ length: 17 }, (_, i) => ({
        ...file,
        path: "f" + String(i) + ".tf",
        size: 8 * 1024 * 1024,
      })),
    },
    {
      name: "too many files",
      entries: Array.from({ length: 4097 }, (_, i) => ({
        ...file,
        path: "f" + String(i) + ".tf",
      })),
    },
    {
      name: "too many tree entries",
      entries: Array.from({ length: 20001 }, (_, i) => ({
        ...file,
        path: "f" + String(i) + ".png",
      })),
    },
    { name: "duplicate", entries: [file, file] },
    {
      name: "case collision",
      entries: [file, { ...file, path: "Infrastructure/main.tf" }],
    },
    { name: "unsafe path", entries: [{ ...file, path: "../main.tf" }] },
    { name: "root file", entries: [{ ...file, path: "." }] },
    { name: "symbolic link", entries: [{ ...file, mode: "120000" }] },
    {
      name: "submodule",
      entries: [{ ...file, mode: "160000", type: "commit" }],
    },
    {
      name: "inconsistent directory",
      entries: [{ ...file, type: "tree", mode: "120000" }],
    },
    { name: "unknown mode", entries: [{ ...file, mode: "100600" }] },
    { name: "null object", entries: [{ ...file, sha: null }] },
  ])("rejects $name before any blob fetch", async ({ entries }) => {
    const value = setup(entries);
    await expect(value.discover()).rejects.toMatchObject({
      code: "import-blocked",
    });
    expect(value.requests).toHaveLength(4);
  });
  it.each([
    { truncated: true },
    { treeSha: "e".repeat(40) },
    { commitSha: "e".repeat(40) },
  ])("rejects incomplete or substituted commit/tree %j", async (overrides) => {
    const value = setup([file], overrides);
    await expect(value.discover()).rejects.toHaveProperty("code");
    expect(
      value.requests.some((request) => request.path.includes("/blobs/")),
    ).toBe(false);
  });
  it("respects an explicit subtree and admits a known zero-byte file", async () => {
    const value = setup([file, { ...file, path: "src/empty.ts", size: 0 }]);
    expect((await value.discover({ selectedPaths: ["src"] })).files).toEqual([
      { gitBlobSha: blobSha, path: "src/empty.ts", sizeBytes: 0 },
    ]);
  });
});
