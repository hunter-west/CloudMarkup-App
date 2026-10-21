import {
  inspectApplicationHostRepairCandidateRequestV1,
  inspectApplicationHostRepairCandidateResultV1,
  type ApplicationHostRepairCandidateAdmissionConfig,
  ApplicationHostRepairCandidateAdmissionError,
} from "./host-repair-candidate-admission.js";
import type {
  ApplicationHostRepairCandidateBuildRequestV1,
  ApplicationHostRepairCandidateBuildResultV1,
} from "./host-repair-candidate-contracts.js";
import {
  applicationHostRepairSuccessorBuildRequestV2Schema,
  applicationHostRepairSuccessorBuildResultV2Schema,
  applicationHostRepairSuccessorLineageV2Schema,
  type ApplicationHostRepairSuccessorLineageV2,
} from "./host-repair-successor-contracts.js";
import {
  inspectBoundHostRepairSource,
  inspectBoundHostRepairResult,
} from "./host-repair-candidate-validation.js";
import { canonicalJson, sha256Digest } from "./security.js";

export interface ApplicationHostRepairSuccessorAdmissionConfig {
  readonly predecessor: ApplicationHostRepairCandidateAdmissionConfig;
  readonly predecessorRequest: ApplicationHostRepairCandidateBuildRequestV1;
  readonly predecessorResult: ApplicationHostRepairCandidateBuildResultV1;
  readonly lineage: ApplicationHostRepairSuccessorLineageV2;
}
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function exact(value: boolean): asserts value {
  if (!value) throw new ApplicationHostRepairCandidateAdmissionError();
}
function safe<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new ApplicationHostRepairCandidateAdmissionError();
  }
}

/** Reconstructs the exact first candidate and its repairable observation. Pure
 * metadata admission cannot replace the enclosing journal's actual RAM provenance. */
export function inspectApplicationHostRepairSuccessorRequestV2(
  raw: unknown,
  config: ApplicationHostRepairSuccessorAdmissionConfig,
) {
  return safe(() => {
    exact(Buffer.byteLength(JSON.stringify(raw), "utf8") <= 2 * 1024 * 1024);
    const request =
      applicationHostRepairSuccessorBuildRequestV2Schema.parse(raw);
    const predecessor = inspectApplicationHostRepairCandidateRequestV1(
      config.predecessorRequest,
      config.predecessor,
    );
    const observed = inspectApplicationHostRepairCandidateResultV1(
      config.predecessorResult,
      config.predecessorRequest,
      config.predecessor,
    );
    exact(
      observed.state === "failed" &&
        observed.cleanup === "verified" &&
        observed.steps.length === 3 &&
        observed.steps[0]?.state === "passed" &&
        observed.steps[1]?.state === "passed" &&
        observed.steps[2]?.state === "failed" &&
        observed.diagnostics.length === 1 &&
        observed.diagnostics[0]?.code ===
          "application.host-repair-seed.observed-repair-ts2322" &&
        observed.findings.length === 0 &&
        observed.tests.length === 0 &&
        observed.reproducibility.state === "not-established",
    );
    const lineage = applicationHostRepairSuccessorLineageV2Schema.parse(
      config.lineage,
    );
    exact(
      lineage.baseDigest ===
        predecessor.request.source.extensionContentDigest &&
        lineage.predecessorRequestDigest ===
          predecessor.bindings.requestDigest &&
        lineage.predecessorReportDigest === observed.reportDigest &&
        lineage.predecessorLineageDigest ===
          predecessor.bindings.repairLineageDigest &&
        lineage.invocationId !==
          predecessor.request.source.lineage.invocationId &&
        same(request.source.lineage, lineage),
    );
    exact(
      same(
        {
          ...predecessor.request,
          contractVersion: 2,
          assessedAt: request.assessedAt,
          source: request.source,
        },
        request,
      ) &&
        Date.parse(request.assessedAt) >=
          Date.parse(predecessor.request.assessedAt),
    );
    inspectBoundHostRepairSource(
      request.source,
      predecessor.request.source,
      request.limits,
      {
        origin: "model-successor-of-host-repair",
        lineage,
      },
    );
    const bindings = {
      ...predecessor.bindings,
      requestDigest: sha256Digest(canonicalJson(request)),
      sourceTreeDigest: request.source.sourceTreeDigest,
      extensionContentDigest: request.source.extensionContentDigest,
      repairLineageDigest: sha256Digest(canonicalJson(lineage)),
    };
    const effectiveInventory = {
      ...predecessor.effectiveInventory,
      contractVersion: 2 as const,
      sourceTreeDigest: request.source.sourceTreeDigest,
      repairLineageDigest: bindings.repairLineageDigest,
      files: request.source.files.map(
        ({ checksum, mediaType, ownership, path }) => ({
          checksum,
          mediaType,
          ownership,
          path,
        }),
      ),
    };
    return {
      request,
      policy: predecessor.policy,
      bindings,
      originalBuildContract: predecessor.originalBuildContract,
      effectiveInventory,
      effectiveInventoryDigest: sha256Digest(canonicalJson(effectiveInventory)),
    };
  });
}
export function inspectApplicationHostRepairSuccessorResultV2(
  raw: unknown,
  request: unknown,
  config: ApplicationHostRepairSuccessorAdmissionConfig,
) {
  return safe(() => {
    const admitted = inspectApplicationHostRepairSuccessorRequestV2(
      request,
      config,
    );
    const result = applicationHostRepairSuccessorBuildResultV2Schema.parse(raw);
    inspectBoundHostRepairResult(result, admitted);
    return result;
  });
}
