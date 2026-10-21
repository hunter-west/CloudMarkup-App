import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  InMemoryGitHubExportStore,
  RecordingGitHubExportAuditSink,
} from "./fakes.js";
import type {
  GitHubAppConfiguration,
  SecretConfigurationResolver,
} from "./ports.js";
import { GitHubWebhookService } from "./webhook.js";
import type { GitHubRepositoryWebhookRefreshPort } from "./webhook.js";

const AT = new Date("2026-08-23T12:00:00.000Z");
const secretText = "webhook-unit-test-value";
const configuration: GitHubAppConfiguration = {
  apiBaseUrl: "https://api.github.test",
  apiVersion: "2022-11-28",
  appId: "12345",
  privateKeySecretReference: "secret://github/app-private-key",
  userAgent: "cloudmarkup-test",
  webhookSecretReference: "secret://github/webhook",
};

class RecordingSecrets implements SecretConfigurationResolver {
  last?: Uint8Array;
  resolveSecret(reference: string): Promise<Uint8Array> {
    if (reference !== configuration.webhookSecretReference) {
      return Promise.reject(new Error("unexpected secret reference"));
    }
    this.last = new TextEncoder().encode(secretText);
    return Promise.resolve(this.last);
  }
}

class FailOnceWebhookStore extends InMemoryGitHubExportStore {
  #failNextStatusUpdate = true;

  override updateInstallationStatus(
    input: Parameters<InMemoryGitHubExportStore["updateInstallationStatus"]>[0],
  ): Promise<void> {
    if (this.#failNextStatusUpdate) {
      this.#failNextStatusUpdate = false;
      return Promise.reject(
        new Error("transient lifecycle projection failure"),
      );
    }
    return super.updateInstallationStatus(input);
  }
}
function signed(body: Uint8Array): string {
  return `sha256=${createHmac("sha256", secretText).update(body).digest("hex")}`;
}

function payload(action = "deleted") {
  return new TextEncoder().encode(
    JSON.stringify({
      action,
      installation: {
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
      },
    }),
  );
}

async function setup(
  store: InMemoryGitHubExportStore = new InMemoryGitHubExportStore(),
  refresh?: GitHubRepositoryWebhookRefreshPort,
) {
  await store.saveInstallation({
    accountId: 500,
    accountLogin: "example-org",
    accountType: "Organization",
    createdAt: AT.toISOString(),
    installationId: 77,
    integrationId: "integration.1",
    organizationId: "organization.1",
    permissions: {
      contents: "write",
      metadata: "read",
      pullRequests: "write",
      workflows: "write",
    },
    repositorySelection: "selected",
    status: "connected",
    updatedAt: AT.toISOString(),
  });
  const secrets = new RecordingSecrets();
  const service = new GitHubWebhookService({
    audit: new RecordingGitHubExportAuditSink(),
    clock: () => new Date(AT),
    configuration,
    secrets,
    store,
    ...(refresh === undefined ? {} : { refresh }),
  });
  return { secrets, service, store };
}

describe("GitHub App webhook boundary", () => {
  it("verifies raw bytes, zeroes the secret buffer, applies an allowlisted event, and deduplicates replay", async () => {
    const value = await setup();
    const body = payload();
    const input = {
      body,
      deliveryId: "delivery-1",
      event: "installation",
      signature: signed(body),
    };
    await expect(value.service.handle(input)).resolves.toEqual({
      deliveryId: "delivery-1",
      status: "processed",
    });
    const resolvedSecret = value.secrets.last;
    if (resolvedSecret === undefined) {
      throw new TypeError("Webhook secret was not resolved.");
    }
    expect(resolvedSecret).toEqual(new Uint8Array(resolvedSecret.byteLength));
    await expect(value.service.handle(input)).resolves.toEqual({
      deliveryId: "delivery-1",
      status: "duplicate",
    });
    expect(
      await value.store.getInstallation({
        integrationId: "integration.1",
        organizationId: "organization.1",
      }),
    ).toMatchObject({ status: "deleted" });
    expect(value.store.webhooks).toHaveLength(1);
  });

  it("rejects tampering before persistence and rejects delivery-ID payload substitution", async () => {
    const value = await setup();
    const body = payload();
    await expect(
      value.service.handle({
        body,
        deliveryId: "delivery-2",
        event: "installation",
        signature: `sha256=${"0".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "webhook-invalid" });
    expect(value.store.webhooks.size).toBe(0);

    await value.service.handle({
      body,
      deliveryId: "delivery-3",
      event: "installation",
      signature: signed(body),
    });
    const changed = payload("suspend");
    await expect(
      value.service.handle({
        body: changed,
        deliveryId: "delivery-3",
        event: "installation",
        signature: signed(changed),
      }),
    ).rejects.toMatchObject({ code: "webhook-invalid" });
  });

  it.each(["deleted", "transferred"] as const)(
    "marks repository lifecycle %s from a verified allowlisted webhook",
    async (action) => {
      const value = await setup();
      await value.store.saveRepositories({
        installationId: 77,
        integrationId: "integration.1",
        organizationId: "organization.1",
        repositories: [
          {
            archived: false,
            defaultBranch: "main",
            disabled: false,
            installationId: 77,
            integrationId: "integration.1",
            name: "customer-repository",
            nodeId: "repository-node-900",
            organizationId: "organization.1",
            owner: "example-org",
            private: true,
            pushedAt: AT.toISOString(),
            repositoryId: 900,
            updatedAt: AT.toISOString(),
          },
        ],
      });
      const body = new TextEncoder().encode(
        JSON.stringify({
          action,
          installation: {
            account: { id: 500, login: "example-org", type: "Organization" },
            id: 77,
            permissions: { contents: "write", metadata: "read" },
            repository_selection: "selected",
            suspended_at: null,
          },
          repository: {
            archived: false,
            default_branch: "main",
            disabled: false,
            full_name: "example-org/customer-repository",
            id: 900,
            name: "customer-repository",
            node_id: "repository-node-900",
            owner: { login: "example-org" },
            private: true,
            pushed_at: AT.toISOString(),
          },
        }),
      );

      await expect(
        value.service.handle({
          body,
          deliveryId: `delivery-${action}`,
          event: "repository",
          signature: signed(body),
        }),
      ).resolves.toMatchObject({ status: "processed" });
      expect(
        await value.store.getRepository({
          integrationId: "integration.1",
          organizationId: "organization.1",
          repositoryId: 900,
        }),
      ).toMatchObject({ disabled: true });
    },
  );

  it("routes only a verified branch push to the exact-commit refresh boundary", async () => {
    const refresh = {
      handlePush: vi.fn(() => Promise.resolve("queued" as const)),
    } satisfies GitHubRepositoryWebhookRefreshPort;
    const value = await setup(new InMemoryGitHubExportStore(), refresh);
    const commitSha = "a".repeat(40);
    const body = new TextEncoder().encode(
      JSON.stringify({
        after: commitSha,
        deleted: false,
        forced: false,
        installation: {
          account: { id: 500, login: "example-org", type: "Organization" },
          id: 77,
          permissions: { contents: "read", metadata: "read" },
          repository_selection: "selected",
          suspended_at: null,
        },
        ref: "refs/heads/main",
        repository: {
          archived: false,
          default_branch: "main",
          disabled: false,
          full_name: "example-org/customer-repository",
          id: 900,
          name: "customer-repository",
          node_id: "repository-node-900",
          owner: { login: "example-org" },
          private: true,
          pushed_at: AT.toISOString(),
        },
      }),
    );

    await expect(
      value.service.handle({
        body,
        deliveryId: "delivery-push-1",
        event: "push",
        signature: signed(body),
      }),
    ).resolves.toEqual({ deliveryId: "delivery-push-1", status: "processed" });
    expect(refresh.handlePush).toHaveBeenCalledWith({
      branch: "main",
      commitSha,
      deliveryId: "delivery-push-1",
      forced: false,
      installationId: 77,
      integrationId: "integration.1",
      organizationId: "organization.1",
      repositoryId: 900,
    });

    await expect(
      value.service.handle({
        body,
        deliveryId: "delivery-push-1",
        event: "push",
        signature: signed(body),
      }),
    ).resolves.toEqual({ deliveryId: "delivery-push-1", status: "duplicate" });
    expect(refresh.handlePush).toHaveBeenCalledTimes(1);
  });

  it("records verified non-allowlisted events as ignored without domain mutation", async () => {
    const value = await setup();
    const body = new TextEncoder().encode(JSON.stringify({ action: "opened" }));
    await expect(
      value.service.handle({
        body,
        deliveryId: "delivery-4",
        event: "issues",
        signature: signed(body),
      }),
    ).resolves.toEqual({ deliveryId: "delivery-4", status: "ignored" });
    expect(value.store.webhooks.get("delivery-4")?.state).toBe("ignored");
  });
  it("reclaims an identical failed delivery and applies it exactly on retry", async () => {
    const store = new FailOnceWebhookStore();
    const value = await setup(store);
    const body = payload("suspend");
    const input = {
      body,
      deliveryId: "delivery-retry",
      event: "installation",
      signature: signed(body),
    };

    await expect(value.service.handle(input)).rejects.toThrow(
      "transient lifecycle projection failure",
    );
    expect(store.webhooks.get("delivery-retry")?.state).toBe("failed");

    await expect(value.service.handle(input)).resolves.toEqual({
      deliveryId: "delivery-retry",
      status: "processed",
    });
    expect(store.webhooks.get("delivery-retry")?.state).toBe("processed");
    expect(
      await store.getInstallation({
        integrationId: "integration.1",
        organizationId: "organization.1",
      }),
    ).toMatchObject({ status: "suspended" });
  });
});
