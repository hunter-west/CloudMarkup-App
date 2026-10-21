import type { Sha256Digest } from "@cloudmarkup/schemas";

import {
  gitHubConformanceActionReceiptV1Schema,
  gitHubConformanceKnownActionV1Schema,
  type GitHubConformanceActionAuthorizationPort,
  type GitHubConformanceActionBindingV1,
  type GitHubConformanceActionRequestV1,
  type GitHubConformanceActionPort,
  type GitHubConformanceActionReceiptStore,
  type GitHubConformanceActionReceiptV1,
  type GitHubConformanceAuthorizationDecisionV1,
  type GitHubConformanceKnownActionPort,
  type GitHubConformanceKnownActionV1,
} from "./conformance-actions.js";
import { canonicalDigest } from "./security.js";

interface AuthorizationFixture {
  readonly binding: GitHubConformanceActionBindingV1;
  readonly principalId: string;
}

export class FakeGitHubConformanceActionAuthorization implements GitHubConformanceActionAuthorizationPort {
  readonly decisions: {
    readonly actionKind: "request-reconciliation-pr" | "upsert-known-issue";
    readonly bindingDigest: Sha256Digest;
    readonly principalId: string;
  }[] = [];
  readonly #allowed: ReadonlySet<string>;

  constructor(allowed: readonly AuthorizationFixture[]) {
    this.#allowed = new Set(
      allowed.map(({ binding, principalId }) =>
        canonicalDigest({ binding, principalId }),
      ),
    );
  }

  authorize(input: {
    readonly actionKind: "request-reconciliation-pr" | "upsert-known-issue";
    readonly binding: GitHubConformanceActionBindingV1;
    readonly principalId: string;
  }): Promise<GitHubConformanceAuthorizationDecisionV1> {
    const bindingDigest = canonicalDigest(input.binding);
    const allowed = this.#allowed.has(
      canonicalDigest({
        binding: input.binding,
        principalId: input.principalId,
      }),
    );
    this.decisions.push({
      actionKind: input.actionKind,
      bindingDigest,
      principalId: input.principalId,
    });
    return Promise.resolve({
      allowed,
      authorizationDigest: canonicalDigest({
        actionKind: input.actionKind,
        allowed,
        bindingDigest,
        principalId: input.principalId,
      }),
      bindingDigest,
    });
  }
}

export interface GitHubConformanceKnownActionFixture {
  readonly action: GitHubConformanceActionRequestV1["action"];
  readonly binding: GitHubConformanceActionBindingV1;
  readonly sourceRecordDigest: Sha256Digest;
}

export class InMemoryGitHubConformanceKnownActionStore implements GitHubConformanceKnownActionPort {
  readonly #actions = new Map<string, GitHubConformanceKnownActionV1>();

  constructor(fixtures: readonly GitHubConformanceKnownActionFixture[] = []) {
    for (const fixture of fixtures) this.register(fixture);
  }

  register(fixture: GitHubConformanceKnownActionFixture): void {
    const bindingDigest = canonicalDigest(fixture.binding);
    const known = gitHubConformanceKnownActionV1Schema.parse({
      action: fixture.action,
      bindingDigest,
      sourceRecordDigest: fixture.sourceRecordDigest,
    });
    this.#actions.set(
      canonicalDigest({
        actionId: fixture.action.actionId,
        actionKind: fixture.action.kind,
        bindingDigest,
      }),
      known,
    );
  }

  resolve(input: {
    readonly actionId: string;
    readonly actionKind: GitHubConformanceActionRequestV1["action"]["kind"];
    readonly binding: GitHubConformanceActionBindingV1;
  }): Promise<GitHubConformanceKnownActionV1 | null> {
    return Promise.resolve(
      this.#actions.get(
        canonicalDigest({
          actionId: input.actionId,
          actionKind: input.actionKind,
          bindingDigest: canonicalDigest(input.binding),
        }),
      ) ?? null,
    );
  }
}

export class InMemoryGitHubConformanceActionReceiptStore implements GitHubConformanceActionReceiptStore {
  readonly #receipts = new Map<
    Sha256Digest,
    GitHubConformanceActionReceiptV1
  >();

  get size(): number {
    return this.#receipts.size;
  }

  findByIdempotencyDigest(
    idempotencyDigest: Sha256Digest,
  ): Promise<GitHubConformanceActionReceiptV1 | null> {
    return Promise.resolve(this.#receipts.get(idempotencyDigest) ?? null);
  }

  saveIfAbsent(
    rawReceipt: GitHubConformanceActionReceiptV1,
  ): Promise<GitHubConformanceActionReceiptV1> {
    const receipt = gitHubConformanceActionReceiptV1Schema.parse(rawReceipt);
    const existing = this.#receipts.get(receipt.idempotencyDigest);
    if (existing !== undefined) return Promise.resolve(existing);
    this.#receipts.set(receipt.idempotencyDigest, receipt);
    return Promise.resolve(receipt);
  }
}

type IssueInput = Parameters<
  GitHubConformanceActionPort["upsertKnownIssue"]
>[0];
type PullRequestInput = Parameters<
  GitHubConformanceActionPort["requestReconciliationPullRequest"]
>[0];

export class FakeGitHubConformanceActionPort implements GitHubConformanceActionPort {
  readonly issueCalls: IssueInput[] = [];
  readonly pullRequestCalls: PullRequestInput[] = [];
  readonly #results = new Map<
    Sha256Digest,
    Awaited<ReturnType<GitHubConformanceActionPort["upsertKnownIssue"]>>
  >();
  readonly #issueRecords = new Set<string>();

  requestReconciliationPullRequest(input: PullRequestInput) {
    const existing = this.#results.get(input.idempotencyDigest);
    if (existing !== undefined) return Promise.resolve(existing);
    const result = {
      providerRecordDigest: canonicalDigest({
        actionId: input.action.actionId,
        kind: input.action.kind,
        repositoryId: input.binding.repositoryId,
        reportDigest: input.binding.reportDigest,
      }),
      state: "request-recorded" as const,
    };
    this.#results.set(input.idempotencyDigest, result);
    this.pullRequestCalls.push(structuredClone(input));
    return Promise.resolve(result);
  }

  upsertKnownIssue(input: IssueInput) {
    const existing = this.#results.get(input.idempotencyDigest);
    if (existing !== undefined) return Promise.resolve(existing);
    const issueIdentity = canonicalDigest({
      issueKey: input.action.issueKey,
      organizationId: input.binding.organizationId,
      projectId: input.binding.projectId,
      repositoryId: input.binding.repositoryId,
    });
    const state = this.#issueRecords.has(issueIdentity) ? "updated" : "created";
    this.#issueRecords.add(issueIdentity);
    const result = {
      providerRecordDigest: issueIdentity,
      state,
    } as const;
    this.#results.set(input.idempotencyDigest, result);
    this.issueCalls.push(structuredClone(input));
    return Promise.resolve(result);
  }
}
