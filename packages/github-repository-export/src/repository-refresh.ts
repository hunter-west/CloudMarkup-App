import type { GitHubExportStore } from "./ports.js";
import type {
  GitHubRepositoryImportService,
  StoredGitHubRepositoryImport,
} from "./repository-import.js";
import { assertGitHubRepositoryImportScope } from "./repository-import-security.js";
import type { GitHubRepositoryWebhookRefreshPort } from "./webhook.js";
import { gitHubBranchNameSchema } from "./contracts.js";
import { canonicalDigest } from "./security.js";
import { GitHubExportError } from "./errors.js";

export interface GitHubRepositoryRefreshSubscription {
  readonly branch: string;
  readonly createdAt: string;
  readonly createdByPrincipalId: string;
  readonly enabled: boolean;
  readonly event: "push";
  readonly idempotencyDigest: string;
  readonly ignoredPaths: readonly string[];
  readonly integrationId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly repositoryId: number;
  readonly selectedPaths: readonly string[];
  readonly subscriptionId: string;
}

export interface GitHubRepositoryRefreshReceipt {
  readonly commitSha: string;
  readonly deliveryId: string;
  readonly importId?: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly recordedAt: string;
  readonly state: "processed" | "ignored" | "failed";
  readonly subscriptionId: string;
}

export interface GitHubRepositoryRefreshStore {
  findActive(input: {
    readonly branch: string;
    readonly integrationId: string;
    readonly organizationId: string;
    readonly repositoryId: number;
  }): Promise<readonly GitHubRepositoryRefreshSubscription[]>;
  reserve(subscription: GitHubRepositoryRefreshSubscription): Promise<{
    readonly created: boolean;
    readonly record: GitHubRepositoryRefreshSubscription;
  }>;
  saveReceipt(receipt: GitHubRepositoryRefreshReceipt): Promise<void>;
}

export interface GitHubRepositoryRefreshService extends GitHubRepositoryWebhookRefreshPort {
  configure(input: {
    readonly branch: string;
    readonly enabled: boolean;
    readonly idempotencyKey: string;
    readonly ignoredPaths: readonly string[];
    readonly integrationId: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly projectId: string;
    readonly repositoryId: number;
    readonly selectedPaths: readonly string[];
  }): Promise<GitHubRepositoryRefreshSubscription>;
}

export function createGitHubRepositoryRefreshService(options: {
  readonly clock?: () => Date;
  readonly directory: Pick<
    GitHubExportStore,
    "getInstallation" | "getRepository"
  >;
  readonly id?: () => string;
  readonly imports: GitHubRepositoryImportService;
  readonly store: GitHubRepositoryRefreshStore;
}): GitHubRepositoryRefreshService {
  const clock = options.clock ?? (() => new Date());
  const id = options.id ?? (() => crypto.randomUUID());

  return Object.freeze({
    async configure(
      input: Parameters<GitHubRepositoryRefreshService["configure"]>[0],
    ) {
      assertGitHubRepositoryImportScope(input);
      gitHubBranchNameSchema.parse(input.branch);
      const installation = await options.directory.getInstallation({
        integrationId: input.integrationId,
        organizationId: input.organizationId,
      });
      const repository = await options.directory.getRepository({
        integrationId: input.integrationId,
        organizationId: input.organizationId,
        repositoryId: input.repositoryId,
      });
      if (
        installation?.status !== "connected" ||
        repository === null ||
        repository.archived ||
        repository.disabled
      ) {
        throw new GitHubExportError("repository-not-found");
      }
      const createdAt = clock().toISOString();
      const record: GitHubRepositoryRefreshSubscription = {
        branch: input.branch,
        createdAt,
        createdByPrincipalId: input.principalId,
        enabled: input.enabled,
        event: "push",
        idempotencyDigest: canonicalDigest({
          branch: input.branch,
          enabled: input.enabled,
          ignoredPaths: [...input.ignoredPaths].sort(),
          integrationId: input.integrationId,
          key: input.idempotencyKey,
          organizationId: input.organizationId,
          projectId: input.projectId,
          repositoryId: input.repositoryId,
          selectedPaths: [...input.selectedPaths].sort(),
        }),
        ignoredPaths: [...input.ignoredPaths],
        integrationId: input.integrationId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        selectedPaths: [...input.selectedPaths],
        subscriptionId: `githubrefresh_${id()}`,
      };
      return (await options.store.reserve(record)).record;
    },

    async handlePush(
      input: Parameters<GitHubRepositoryRefreshService["handlePush"]>[0],
    ) {
      const subscriptions = await options.store.findActive(input);
      if (subscriptions.length === 0) return "ignored";
      for (const subscription of subscriptions) {
        let imported: StoredGitHubRepositoryImport | undefined;
        try {
          const history = await options.imports.listImports({
            organizationId: subscription.organizationId,
            projectId: subscription.projectId,
            repositoryId: subscription.repositoryId,
          });
          const previous = [...history]
            .filter((record) => record.state === "succeeded")
            .sort((left, right) =>
              right.createdAt.localeCompare(left.createdAt),
            )[0];
          imported = await options.imports.importRepository({
            branch: subscription.branch,
            commitSha: input.commitSha,
            correlationId: input.deliveryId,
            idempotencyKey: `github-webhook:${input.deliveryId}:${subscription.subscriptionId}`,
            ignoredPaths: subscription.ignoredPaths,
            integrationId: subscription.integrationId,
            organizationId: subscription.organizationId,
            ...(previous === undefined
              ? {}
              : { previousImportId: previous.importId }),
            principalId: subscription.createdByPrincipalId,
            projectId: subscription.projectId,
            repositoryId: subscription.repositoryId,
            requestedMode: "professional",
            selectedPaths: subscription.selectedPaths,
            trigger: "webhook",
          });
          await options.store.saveReceipt({
            commitSha: input.commitSha,
            deliveryId: input.deliveryId,
            importId: imported.importId,
            organizationId: subscription.organizationId,
            projectId: subscription.projectId,
            recordedAt: clock().toISOString(),
            state: "processed",
            subscriptionId: subscription.subscriptionId,
          });
        } catch (error) {
          await options.store.saveReceipt({
            commitSha: input.commitSha,
            deliveryId: input.deliveryId,
            organizationId: subscription.organizationId,
            projectId: subscription.projectId,
            recordedAt: clock().toISOString(),
            state: "failed",
            subscriptionId: subscription.subscriptionId,
          });
          throw error;
        }
      }
      return "queued";
    },
  });
}

export class InMemoryGitHubRepositoryRefreshStore implements GitHubRepositoryRefreshStore {
  readonly receipts: GitHubRepositoryRefreshReceipt[] = [];
  readonly #byIdempotency = new Map<
    string,
    GitHubRepositoryRefreshSubscription
  >();
  readonly #subscriptions = new Map<
    string,
    GitHubRepositoryRefreshSubscription
  >();

  findActive(input: {
    readonly branch: string;
    readonly integrationId: string;
    readonly organizationId: string;
    readonly repositoryId: number;
  }): Promise<readonly GitHubRepositoryRefreshSubscription[]> {
    const latestByProject = new Map<
      string,
      GitHubRepositoryRefreshSubscription
    >();
    for (const record of this.#subscriptions.values()) {
      if (
        record.branch === input.branch &&
        record.integrationId === input.integrationId &&
        record.organizationId === input.organizationId &&
        record.repositoryId === input.repositoryId
      ) {
        latestByProject.set(record.projectId, record);
      }
    }
    return Promise.resolve(
      [...latestByProject.values()]
        .filter((record) => record.enabled)
        .map((record) => structuredClone(record)),
    );
  }

  reserve(subscription: GitHubRepositoryRefreshSubscription) {
    const existing = this.#byIdempotency.get(subscription.idempotencyDigest);
    if (existing !== undefined) {
      return Promise.resolve({
        created: false,
        record: structuredClone(existing),
      });
    }
    this.#byIdempotency.set(
      subscription.idempotencyDigest,
      structuredClone(subscription),
    );
    this.#subscriptions.set(
      subscription.subscriptionId,
      structuredClone(subscription),
    );
    return Promise.resolve({
      created: true,
      record: structuredClone(subscription),
    });
  }

  saveReceipt(receipt: GitHubRepositoryRefreshReceipt): Promise<void> {
    if (
      this.receipts.some(
        (candidate) =>
          candidate.deliveryId === receipt.deliveryId &&
          candidate.subscriptionId === receipt.subscriptionId,
      )
    ) {
      return Promise.resolve();
    }
    this.receipts.push(structuredClone(receipt));
    return Promise.resolve();
  }
}
