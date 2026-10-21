import { getActiveIssueRecordHash } from "@cloudmarkup/domain";
import { activeIssueV1Schema, type ActiveIssueV1 } from "@cloudmarkup/schemas";

import type {
  ContinuousConformanceInputScopeV1,
  ContinuousConformanceIssueUpdateSinkV1,
} from "../application/continuous-conformance-composition.js";

function scopeKey(scope: ContinuousConformanceInputScopeV1): string {
  return [
    scope.organizationId,
    scope.projectId,
    scope.solutionRevisionId,
    scope.environmentId,
  ].join("\u0000");
}

/**
 * Explicit local-only idempotent history. Production composition must inject a
 * tenant-scoped durable adapter; this store intentionally has no cloud access.
 */
export class InMemoryLocalConformanceIssueHistory implements ContinuousConformanceIssueUpdateSinkV1 {
  readonly #records = new Map<string, Map<string, ActiveIssueV1[]>>();

  latest(scope: ContinuousConformanceInputScopeV1): readonly ActiveIssueV1[] {
    const records = this.#records.get(scopeKey(scope));
    if (records === undefined) return [];
    return [...records.values()]
      .map((history) => history.at(-1))
      .filter((record): record is ActiveIssueV1 => record !== undefined)
      .sort((left, right) =>
        left.id === right.id ? 0 : left.id < right.id ? -1 : 1,
      );
  }

  appendIfAbsent(input: {
    readonly reportDigest: string;
    readonly reportId: string;
    readonly scope: ContinuousConformanceInputScopeV1;
    readonly updates: readonly ActiveIssueV1[];
  }): Promise<void> {
    void input.reportDigest;
    void input.reportId;
    const key = scopeKey(input.scope);
    const current =
      this.#records.get(key) ?? new Map<string, ActiveIssueV1[]>();
    const staged = new Map<string, ActiveIssueV1[]>(
      [...current.entries()].map(([id, records]) => [id, [...records]]),
    );
    const seenDigests = new Set<string>();
    for (const rawUpdate of input.updates) {
      const update = activeIssueV1Schema.parse(rawUpdate);
      if (
        update.solutionRevisionId !== input.scope.solutionRevisionId ||
        getActiveIssueRecordHash(update) !== update.currentRecordDigest ||
        seenDigests.has(update.currentRecordDigest)
      ) {
        throw new Error("The local conformance issue append is invalid.");
      }
      seenDigests.add(update.currentRecordDigest);
      const history = staged.get(update.id) ?? [];
      if (
        history.some(
          ({ currentRecordDigest }) =>
            currentRecordDigest === update.currentRecordDigest,
        )
      ) {
        continue;
      }
      const previous = history.at(-1);
      if (
        (previous === undefined &&
          (update.recordVersion !== 1 ||
            update.previousRecordDigest !== undefined)) ||
        (previous !== undefined &&
          (update.recordVersion !== previous.recordVersion + 1 ||
            update.previousRecordDigest !== previous.currentRecordDigest))
      ) {
        throw new Error(
          "The local conformance issue history is not append-only.",
        );
      }
      history.push(update);
      staged.set(update.id, history);
    }
    this.#records.set(key, staged);
    return Promise.resolve();
  }
}
