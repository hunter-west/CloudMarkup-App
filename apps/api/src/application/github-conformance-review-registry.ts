import {
  canonicalDigest,
  gitHubConformanceActionBindingV1Schema,
  gitHubConformanceActionReceiptV1Schema,
  gitHubConformanceKnownActionV1Schema,
  type GitHubConformanceActionBindingV1,
  type GitHubConformanceActionService,
  type GitHubConformanceKnownActionV1,
} from "@cloudmarkup/github-repository-export";
import {
  solutionStableIdSchema,
  type ConformanceDifferenceV1,
  type ConformanceReportV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import type { ContinuousConformanceReviewActionRegistry } from "./continuous-conformance.js";
import { ApplicationError } from "./errors.js";

const catalogRecordSchema = z
  .object({
    binding: gitHubConformanceActionBindingV1Schema,
    differenceId: solutionStableIdSchema,
    knownAction: gitHubConformanceKnownActionV1Schema,
  })
  .strict();

export interface GitHubConformanceReviewCatalogRecordV1 {
  readonly binding: GitHubConformanceActionBindingV1;
  readonly differenceId: string;
  readonly knownAction: GitHubConformanceKnownActionV1;
}

export interface GitHubConformanceReviewCatalog {
  list(input: {
    readonly environmentId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly report: ConformanceReportV1;
    readonly solutionRevisionId: string;
  }): Promise<unknown>;
}

export interface ContinuousConformanceReviewIdempotencyPort {
  claim(input: {
    readonly actionKey: string;
    readonly bindingDigest: string;
    readonly idempotencyKey: string;
    readonly operationId: "continuous-conformance.review-action";
    readonly organizationId: string;
    readonly principalId: string;
    readonly projectId: string;
  }): Promise<void>;
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function apiKind(
  actionKind: GitHubConformanceKnownActionV1["action"]["kind"],
): "github-issue" | "reconciliation-pr" {
  return actionKind === "upsert-known-issue"
    ? "github-issue"
    : "reconciliation-pr";
}

function hasExactEvidenceLineage(
  actual: readonly string[],
  difference: ConformanceDifferenceV1,
): boolean {
  const expected = [...difference.evidenceIds].sort(compareUtf16);
  return (
    expected.length > 0 &&
    new Set(expected).size === expected.length &&
    actual.length === expected.length &&
    actual.every((evidenceId, index) => evidenceId === expected[index])
  );
}

function assertRecordBinding(
  record: GitHubConformanceReviewCatalogRecordV1,
  input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly report: ConformanceReportV1;
    readonly solutionRevisionId: string;
  },
  difference: ConformanceDifferenceV1,
): void {
  if (
    record.binding.organizationId !== input.organizationId ||
    record.binding.projectId !== input.projectId ||
    record.binding.reportDigest !== input.report.reportDigest ||
    record.binding.solutionRevision.id !== input.solutionRevisionId ||
    record.binding.solutionRevision.id !==
      input.report.evaluatedSolutionRevision.id ||
    record.binding.solutionRevision.digest !==
      input.report.evaluatedSolutionRevision.digest ||
    record.knownAction.bindingDigest !== canonicalDigest(record.binding) ||
    record.knownAction.action.actionId.length === 0 ||
    record.knownAction.sourceRecordDigest !== difference.differenceDigest ||
    !hasExactEvidenceLineage(record.binding.evidenceRecordIds, difference)
  ) {
    throw new ApplicationError(
      "service_unavailable",
      "Continuous conformance review actions are not currently verifiable.",
    );
  }
}

/**
 * Binds the browser's action key to a server-owned reviewed GitHub action. The
 * browser never supplies repository, issue, pull-request, binding, or content
 * fields; the hardened GitHub service independently resolves the same action.
 */
export class GitHubContinuousConformanceReviewActionRegistry implements ContinuousConformanceReviewActionRegistry {
  readonly #catalog: GitHubConformanceReviewCatalog;
  readonly #idempotency: ContinuousConformanceReviewIdempotencyPort;
  readonly #service: Pick<GitHubConformanceActionService, "execute">;

  constructor(options: {
    readonly catalog: GitHubConformanceReviewCatalog;
    readonly idempotency: ContinuousConformanceReviewIdempotencyPort;
    readonly service: Pick<GitHubConformanceActionService, "execute">;
  }) {
    this.#catalog = options.catalog;
    this.#idempotency = options.idempotency;
    this.#service = options.service;
  }

  async #records(input: {
    readonly environmentId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly report: ConformanceReportV1;
    readonly solutionRevisionId: string;
  }): Promise<readonly GitHubConformanceReviewCatalogRecordV1[]> {
    const parsed = z
      .array(catalogRecordSchema)
      .max(10_000)
      .safeParse(await this.#catalog.list(input));
    if (!parsed.success) {
      throw new ApplicationError(
        "service_unavailable",
        "Continuous conformance review actions are not currently verifiable.",
      );
    }
    const differences = new Map(
      input.report.differences.map((difference) => [
        difference.differenceId,
        difference,
      ]),
    );
    const actionKeys = new Set<string>();
    for (const record of parsed.data) {
      const difference = differences.get(record.differenceId);
      if (
        difference?.remediation.disposition !== "review-required" ||
        actionKeys.has(record.knownAction.action.actionId)
      ) {
        throw new ApplicationError(
          "service_unavailable",
          "Continuous conformance review actions are not currently verifiable.",
        );
      }
      actionKeys.add(record.knownAction.action.actionId);
      assertRecordBinding(record, input, difference);
    }
    return [...parsed.data].sort((left, right) =>
      compareUtf16(
        left.knownAction.action.actionId,
        right.knownAction.action.actionId,
      ),
    );
  }

  async list(input: {
    readonly environmentId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly report: ConformanceReportV1;
    readonly solutionRevisionId: string;
  }): Promise<unknown> {
    const records = await this.#records(input);
    const byDifference = new Map<
      string,
      { actionKey: string; kind: "github-issue" | "reconciliation-pr" }[]
    >();
    for (const record of records) {
      const actions = byDifference.get(record.differenceId) ?? [];
      actions.push({
        actionKey: record.knownAction.action.actionId,
        kind: apiKind(record.knownAction.action.kind),
      });
      byDifference.set(record.differenceId, actions);
    }
    return [...byDifference.entries()]
      .map(([differenceId, actions]) => ({ actions, differenceId }))
      .sort((left, right) =>
        compareUtf16(left.differenceId, right.differenceId),
      );
  }

  async execute(input: {
    readonly actionKey: string;
    readonly difference: ConformanceDifferenceV1;
    readonly environmentId: string;
    readonly idempotencyKey: string;
    readonly kind: "github-issue" | "reconciliation-pr";
    readonly organizationId: string;
    readonly principalId: string;
    readonly projectId: string;
    readonly report: ConformanceReportV1;
    readonly solutionRevisionId: string;
  }) {
    const records = await this.#records(input);
    const selected = records.find(
      (record) =>
        record.differenceId === input.difference.differenceId &&
        record.knownAction.action.actionId === input.actionKey &&
        apiKind(record.knownAction.action.kind) === input.kind,
    );
    if (selected === undefined) {
      throw new ApplicationError(
        "not_found",
        "The requested reviewed action is unavailable.",
      );
    }
    await this.#idempotency.claim({
      actionKey: input.actionKey,
      bindingDigest: selected.knownAction.bindingDigest,
      idempotencyKey: input.idempotencyKey,
      operationId: "continuous-conformance.review-action",
      organizationId: input.organizationId,
      principalId: input.principalId,
      projectId: input.projectId,
    });
    const receipt = gitHubConformanceActionReceiptV1Schema.parse(
      await this.#service.execute(
        {
          action: selected.knownAction.action,
          binding: selected.binding,
          contractVersion: 1,
          principalId: input.principalId,
        },
        selected.binding,
      ),
    );
    if (
      receipt.actionId !== input.actionKey ||
      receipt.actionKind !== selected.knownAction.action.kind ||
      receipt.bindingDigest !== selected.knownAction.bindingDigest ||
      receipt.sourceRecordDigest !== selected.knownAction.sourceRecordDigest
    ) {
      throw new ApplicationError(
        "service_unavailable",
        "Continuous conformance review actions are not currently verifiable.",
      );
    }
    return {
      actionId: receipt.actionId,
      createdAt: receipt.createdAt,
      mergeAuthority: receipt.mergeAuthority,
      providerRecordDigest: receipt.providerRecordDigest,
      remediation: receipt.remediation,
      sourceRecordDigest: receipt.sourceRecordDigest,
      state: receipt.providerState,
    };
  }
}
