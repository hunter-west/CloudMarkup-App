import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  GITHUB_REPOSITORY_EXPORT_LIMITS,
  gitHubAppRepositoryPermissionsSchema,
  gitHubBranchNameSchema,
  gitHubShaSchema,
  gitHubRepositoryRecordSchema,
} from "./contracts.js";
import { GitHubExportError } from "./errors.js";
import type {
  GitHubAppConfiguration,
  GitHubExportAuditSink,
  GitHubExportStore,
  GitHubWebhookDeliveryRecord,
  SecretConfigurationResolver,
} from "./ports.js";
import { sha256Digest } from "./security.js";

export const GITHUB_WEBHOOK_EVENT_ALLOWLIST = [
  "installation",
  "installation_repositories",
  "ping",
  "push",
  "repository",
] as const;

const actionAllowlist = {
  installation: [
    "created",
    "deleted",
    "new_permissions_accepted",
    "suspend",
    "unsuspend",
  ],
  installation_repositories: ["added", "removed"],
  ping: ["ping"],
  push: ["push"],
  repository: ["archived", "deleted", "renamed", "transferred", "unarchived"],
} as const;

const deliveryIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9-]+$/);
const eventNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
const signatureSchema = z.string().regex(/^sha256=[0-9a-f]{64}$/);

const repositoryPayloadSchema = z
  .object({
    archived: z.boolean(),
    default_branch: z.string().min(1).max(255),
    disabled: z.boolean(),
    full_name: z.string().min(3).max(255),
    id: z.number().int().positive(),
    name: z.string().min(1).max(100),
    node_id: z.string().min(1).max(255),
    owner: z.object({ login: z.string().min(1).max(100) }).loose(),
    private: z.boolean(),
    pushed_at: z.string().nullable().optional(),
  })
  .loose();

const installationPayloadSchema = z
  .object({
    account: z
      .object({
        id: z.number().int().positive(),
        login: z.string().min(1).max(100),
        type: z.enum(["Organization", "User"]),
      })
      .loose(),
    id: z.number().int().positive(),
    permissions: z.record(z.string(), z.string()).optional(),
    repository_selection: z.enum(["all", "selected"]),
    suspended_at: z.string().nullable().optional(),
  })
  .loose();

const basePayloadSchema = z
  .object({
    action: z.string().min(1).max(64).optional(),
    after: gitHubShaSchema.optional(),
    deleted: z.boolean().optional(),
    forced: z.boolean().optional(),
    ref: z.string().min(1).max(512).optional(),
    installation: installationPayloadSchema.optional(),
    repository: repositoryPayloadSchema.optional(),
    repositories_added: z.array(repositoryPayloadSchema).max(10_000).optional(),
    repositories_removed: z
      .array(repositoryPayloadSchema)
      .max(10_000)
      .optional(),
  })
  .loose();

function parsePermissions(value: Record<string, string> | undefined) {
  const level = (name: string) => {
    const candidate = value?.[name] ?? "none";
    return candidate === "read" || candidate === "write" ? candidate : "none";
  };
  return gitHubAppRepositoryPermissionsSchema.parse({
    contents: level("contents"),
    metadata: level("metadata") === "none" ? "read" : level("metadata"),
    pullRequests: level("pull_requests"),
    workflows: level("workflows"),
  });
}

function verifySignature(
  body: Uint8Array,
  secret: Uint8Array,
  signatureHeader: string,
): void {
  const supplied = signatureSchema.safeParse(signatureHeader);
  if (!supplied.success) throw new GitHubExportError("webhook-invalid");
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    "utf8",
  );
  const actual = Buffer.from(supplied.data, "utf8");
  if (
    actual.byteLength !== expected.byteLength ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new GitHubExportError("webhook-invalid");
  }
}

function isAllowedEvent(
  event: string,
): event is (typeof GITHUB_WEBHOOK_EVENT_ALLOWLIST)[number] {
  return GITHUB_WEBHOOK_EVENT_ALLOWLIST.includes(
    event as (typeof GITHUB_WEBHOOK_EVENT_ALLOWLIST)[number],
  );
}

function isAllowedAction(
  event: (typeof GITHUB_WEBHOOK_EVENT_ALLOWLIST)[number],
  action: string,
): boolean {
  return (actionAllowlist[event] as readonly string[]).includes(action);
}

export interface GitHubRepositoryWebhookRefreshPort {
  handlePush(input: {
    readonly branch: string;
    readonly commitSha: string;
    readonly deliveryId: string;
    readonly forced: boolean;
    readonly installationId: number;
    readonly integrationId: string;
    readonly organizationId: string;
    readonly repositoryId: number;
  }): Promise<"ignored" | "queued">;
}

export interface GitHubWebhookResult {
  readonly deliveryId: string;
  readonly status: "duplicate" | "ignored" | "processed";
}

export class GitHubWebhookService {
  readonly #audit: GitHubExportAuditSink;
  readonly #clock: () => Date;
  readonly #configuration: GitHubAppConfiguration;
  readonly #secrets: SecretConfigurationResolver;
  readonly #store: GitHubExportStore;
  readonly #refresh: GitHubRepositoryWebhookRefreshPort | undefined;

  constructor(options: {
    readonly audit: GitHubExportAuditSink;
    readonly clock?: () => Date;
    readonly configuration: GitHubAppConfiguration;
    readonly secrets: SecretConfigurationResolver;
    readonly store: GitHubExportStore;
    readonly refresh?: GitHubRepositoryWebhookRefreshPort;
  }) {
    this.#audit = options.audit;
    this.#clock = options.clock ?? (() => new Date());
    this.#configuration = options.configuration;
    this.#secrets = options.secrets;
    this.#store = options.store;
    this.#refresh = options.refresh;
  }

  async handle(input: {
    readonly body: Uint8Array;
    readonly deliveryId: string;
    readonly event: string;
    readonly signature: string;
  }): Promise<GitHubWebhookResult> {
    if (input.body.byteLength > GITHUB_REPOSITORY_EXPORT_LIMITS.webhookBytes) {
      throw new GitHubExportError("webhook-invalid");
    }
    const parsedDeliveryId = deliveryIdSchema.safeParse(input.deliveryId);
    if (!parsedDeliveryId.success) {
      throw new GitHubExportError("webhook-invalid");
    }
    const secret = await this.#secrets.resolveSecret(
      this.#configuration.webhookSecretReference,
    );
    try {
      verifySignature(input.body, secret, input.signature);
    } finally {
      secret.fill(0);
    }
    const parsedEvent = eventNameSchema.safeParse(input.event);
    if (!parsedEvent.success) throw new GitHubExportError("webhook-invalid");
    const deliveryId = parsedDeliveryId.data;
    const event = parsedEvent.data;
    const receivedAt = this.#clock().toISOString();
    const payloadDigest = sha256Digest(input.body);
    const delivery: GitHubWebhookDeliveryRecord = {
      deliveryId,
      event,
      payloadDigest,
      receivedAt,
      state: "received",
    };
    const reserved = await this.#store.reserveWebhookDelivery(delivery);
    if (!reserved.created) {
      if (
        reserved.record.payloadDigest !== payloadDigest ||
        reserved.record.event !== event
      ) {
        throw new GitHubExportError("webhook-invalid");
      }
      return { deliveryId, status: "duplicate" };
    }
    if (!isAllowedEvent(event)) {
      const ignored: GitHubWebhookDeliveryRecord = {
        ...delivery,
        processedAt: receivedAt,
        state: "ignored",
      };
      await this.#store.updateWebhookDelivery(ignored);
      await this.#audit.record({
        action: "github.webhook.ignored",
        correlationId: deliveryId,
        occurredAt: receivedAt,
        outcome: "succeeded",
        summary: "A verified but non-allowlisted GitHub event was ignored.",
        targetId: deliveryId,
        targetKind: "webhook",
      });
      return { deliveryId, status: "ignored" };
    }
    let payload: z.output<typeof basePayloadSchema>;
    try {
      payload = basePayloadSchema.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(input.body),
        ),
      );
    } catch {
      await this.#store.updateWebhookDelivery({ ...delivery, state: "failed" });
      throw new GitHubExportError("webhook-invalid");
    }
    const action =
      event === "ping"
        ? "ping"
        : event === "push"
          ? "push"
          : (payload.action ?? "");
    if (!isAllowedAction(event, action)) {
      await this.#store.updateWebhookDelivery({
        ...delivery,
        processedAt: receivedAt,
        state: "ignored",
      });
      return { deliveryId, status: "ignored" };
    }
    try {
      await this.#apply(event, action, payload, receivedAt, deliveryId);
    } catch (error) {
      await this.#store.updateWebhookDelivery({ ...delivery, state: "failed" });
      throw error;
    }
    await this.#store.updateWebhookDelivery({
      ...delivery,
      processedAt: receivedAt,
      state: "processed",
    });
    return { deliveryId, status: "processed" };
  }

  async #apply(
    event: (typeof GITHUB_WEBHOOK_EVENT_ALLOWLIST)[number],
    action: string,
    payload: z.output<typeof basePayloadSchema>,
    now: string,
    deliveryId: string,
  ): Promise<void> {
    if (event === "ping") return;
    const installation = payload.installation;
    if (installation === undefined)
      throw new GitHubExportError("webhook-invalid");
    const linked = await this.#store.getInstallationByInstallationId(
      installation.id,
    );
    if (linked === null) return;
    if (event === "push") {
      const repository = payload.repository;
      const ref = payload.ref;
      const commitSha = payload.after;
      if (
        repository === undefined ||
        ref === undefined ||
        commitSha === undefined
      ) {
        throw new GitHubExportError("webhook-invalid");
      }
      if (payload.deleted === true || !ref.startsWith("refs/heads/")) return;
      const branch = gitHubBranchNameSchema.safeParse(
        ref.slice("refs/heads/".length),
      );
      if (!branch.success || this.#refresh === undefined) return;
      await this.#refresh.handlePush({
        branch: branch.data,
        commitSha,
        deliveryId,
        forced: payload.forced === true,
        installationId: installation.id,
        integrationId: linked.integrationId,
        organizationId: linked.organizationId,
        repositoryId: repository.id,
      });
      return;
    }
    if (event === "installation") {
      if (action === "deleted") {
        await this.#store.updateInstallationStatus({
          installationId: installation.id,
          status: "deleted",
          updatedAt: now,
        });
        return;
      }
      if (action === "suspend") {
        await this.#store.updateInstallationStatus({
          installationId: installation.id,
          status: "suspended",
          updatedAt: now,
        });
        return;
      }
      await this.#store.saveInstallation({
        ...linked,
        accountId: installation.account.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        permissions: parsePermissions(installation.permissions),
        repositorySelection: installation.repository_selection,
        status: installation.suspended_at ? "suspended" : "connected",
        updatedAt: now,
      });
      return;
    }
    if (event === "installation_repositories") {
      for (const repository of payload.repositories_removed ?? []) {
        await this.#store.updateRepositoryLifecycle({
          installationId: installation.id,
          repositoryId: repository.id,
          state: "deleted",
          updatedAt: now,
        });
      }
      const added = (payload.repositories_added ?? []).map((repository) =>
        gitHubRepositoryRecordSchema.parse({
          archived: repository.archived,
          defaultBranch: repository.default_branch,
          disabled: repository.disabled,
          installationId: installation.id,
          integrationId: linked.integrationId,
          name: repository.name,
          nodeId: repository.node_id,
          organizationId: linked.organizationId,
          owner: repository.owner.login,
          private: repository.private,
          pushedAt: repository.pushed_at ?? null,
          repositoryId: repository.id,
          updatedAt: now,
        }),
      );
      if (added.length > 0) {
        await this.#store.saveRepositories({
          installationId: installation.id,
          integrationId: linked.integrationId,
          organizationId: linked.organizationId,
          repositories: added,
        });
      }
      return;
    }
    const repository = payload.repository;
    if (repository === undefined)
      throw new GitHubExportError("webhook-invalid");
    if (action === "deleted" || action === "transferred") {
      await this.#store.updateRepositoryLifecycle({
        installationId: installation.id,
        repositoryId: repository.id,
        state: action,
        updatedAt: now,
      });
      return;
    }
    await this.#store.saveRepositories({
      installationId: installation.id,
      integrationId: linked.integrationId,
      organizationId: linked.organizationId,
      repositories: [
        gitHubRepositoryRecordSchema.parse({
          archived: repository.archived,
          defaultBranch: repository.default_branch,
          disabled: repository.disabled,
          installationId: installation.id,
          integrationId: linked.integrationId,
          name: repository.name,
          nodeId: repository.node_id,
          organizationId: linked.organizationId,
          owner: repository.owner.login,
          private: repository.private,
          pushedAt: repository.pushed_at ?? null,
          repositoryId: repository.id,
          updatedAt: now,
        }),
      ],
    });
  }
}
