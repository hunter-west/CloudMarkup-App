import { getConformanceReportDigestV1 } from "@cloudmarkup/domain";
import { conformanceReportV1Schema } from "@cloudmarkup/schemas";

import type {
  ContinuousConformanceInputScopeV1,
  ContinuousConformanceReportSnapshotStoreV1,
  ContinuousConformanceReportSnapshotV1,
} from "../application/continuous-conformance-composition.js";

function scopeKey(scope: ContinuousConformanceInputScopeV1): string {
  return [
    scope.organizationId,
    scope.projectId,
    scope.solutionRevisionId,
    scope.environmentId,
  ].join("\u0000");
}

/** Local-only exact report snapshots. Production must inject a durable store. */
export class InMemoryLocalConformanceReportSnapshots implements ContinuousConformanceReportSnapshotStoreV1 {
  readonly #latest = new Map<string, ContinuousConformanceReportSnapshotV1>();

  getExact(
    input: Parameters<
      ContinuousConformanceReportSnapshotStoreV1["getExact"]
    >[0],
  ): Promise<unknown> {
    const snapshot = this.#latest.get(scopeKey(input.scope));
    if (
      snapshot?.report.reportDigest !== input.binding.reportDigest ||
      snapshot.report.reportId !== input.binding.reportId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(snapshot));
  }

  getLatest(scope: ContinuousConformanceInputScopeV1): Promise<unknown> {
    const snapshot = this.#latest.get(scopeKey(scope));
    return Promise.resolve(
      snapshot === undefined ? null : structuredClone(snapshot),
    );
  }

  saveLatest(
    input: Parameters<
      ContinuousConformanceReportSnapshotStoreV1["saveLatest"]
    >[0],
  ): Promise<void> {
    const report = conformanceReportV1Schema.parse(input.snapshot.report);
    if (getConformanceReportDigestV1(report) !== report.reportDigest) {
      throw new Error("The local conformance report snapshot is invalid.");
    }
    this.#latest.set(
      scopeKey(input.scope),
      structuredClone({ ...input.snapshot, report }),
    );
    return Promise.resolve();
  }
}
