import {
  inspectBoundHostRepairSource,
  inspectBoundHostRepairResult,
} from "./host-repair-candidate-validation.js";
import {
  inspectApplicationHostRepairSeedRequestV1,
  type ApplicationHostRepairSeedAdmissionConfig,
} from "./host-repair-seed-admission.js";
import type { ApplicationHostRepairSeedBuildRequestV1 } from "./host-repair-seed-contracts.js";
import {
  applicationHostRepairCandidateBuildRequestV1Schema,
  applicationHostRepairCandidateBuildResultV1Schema,
  applicationHostRepairCandidateLineageV1Schema,
  applicationHostRepairCandidatePolicyV1Schema,
  type ApplicationHostRepairCandidateLineageV1,
  type ApplicationHostRepairCandidatePolicyV1,
} from "./host-repair-candidate-contracts.js";
import { canonicalJson, sha256Digest } from "./security.js";

/** Closed host composition must bind lineage to its actual response and usage.
 * This pure admission config grants no authentication or execution authority. */
export interface ApplicationHostRepairCandidateAdmissionConfig {
  readonly seed: ApplicationHostRepairSeedAdmissionConfig;
  readonly seedRequest: ApplicationHostRepairSeedBuildRequestV1;
  readonly policy: ApplicationHostRepairCandidatePolicyV1;
  readonly lineage: ApplicationHostRepairCandidateLineageV1;
}
export class ApplicationHostRepairCandidateAdmissionError extends Error {
  readonly code = "application.host-repair-candidate.not-admitted";
  constructor() {
    super("The exact bounded host repair candidate is not admitted.");
    this.name = "ApplicationHostRepairCandidateAdmissionError";
  }
}
function requireExact(value: boolean): asserts value {
  if (!value) throw new ApplicationHostRepairCandidateAdmissionError();
}
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function safe<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new ApplicationHostRepairCandidateAdmissionError();
  }
}

/** Reconstruct the genuine invalid seed before checking its one changed file.
 * Candidate bytes never enter the historical fixed-source parser. */
export function inspectApplicationHostRepairCandidateRequestV1(
  raw: unknown,
  config: ApplicationHostRepairCandidateAdmissionConfig,
) {
  return safe(() => {
    requireExact(
      Buffer.byteLength(JSON.stringify(raw), "utf8") <= 2 * 1024 * 1024,
    );
    const request =
      applicationHostRepairCandidateBuildRequestV1Schema.parse(raw);
    const base = inspectApplicationHostRepairSeedRequestV1(
      config.seedRequest,
      config.seed,
    );
    const policy = applicationHostRepairCandidatePolicyV1Schema.parse(
      config.policy,
    );
    const lineage = applicationHostRepairCandidateLineageV1Schema.parse(
      config.lineage,
    );
    requireExact(
      base.request.source.variant === "invalid-seed" &&
        base.request.source.recipe.version === "1.1.0",
    );
    requireExact(same({ ...base.policy, profile: policy.profile }, policy));
    const baseSource = base.request.source;
    const source = request.source;
    requireExact(
      same(request.profile, policy.profile) &&
        same(
          {
            ...base.request,
            kind: request.kind,
            profile: request.profile,
            assessedAt: request.assessedAt,
            source,
          },
          request,
        ) &&
        Date.parse(request.assessedAt) >= Date.parse(base.request.assessedAt) &&
        same(source.lineage, lineage) &&
        lineage.baseDigest === baseSource.extensionContentDigest,
    );
    inspectBoundHostRepairSource(source, baseSource, request.limits, {
      origin: "model-repair-of-fixed-host-seed",
      variant: "model-repair",
      lineage,
    });
    const bindings = {
      ...base.bindings,
      requestDigest: sha256Digest(canonicalJson(request)),
      sourceTreeDigest: source.sourceTreeDigest,
      extensionContentDigest: source.extensionContentDigest,
      policyDigest: sha256Digest(canonicalJson(policy)),
      baseSeedRequestDigest: base.bindings.requestDigest,
      repairLineageDigest: sha256Digest(canonicalJson(lineage)),
    };
    const effectiveInventory = {
      kind: "cloudmarkup.host-repair-candidate.effective-inventory" as const,
      contractVersion: 1 as const,
      authority: "host-source-admission-only" as const,
      originalBuildContractDigest: base.originalBuildContract.contractDigest,
      sourceTreeDigest: source.sourceTreeDigest,
      repairLineageDigest: bindings.repairLineageDigest,
      files: source.files.map(({ checksum, mediaType, ownership, path }) => ({
        checksum,
        mediaType,
        ownership,
        path,
      })),
    };
    return {
      request,
      policy,
      bindings,
      originalBuildContract: base.originalBuildContract,
      effectiveInventory,
      effectiveInventoryDigest: sha256Digest(canonicalJson(effectiveInventory)),
    };
  });
}

/** Rejoins structural observations only; it cannot prove execution or issue a receipt. */
export function inspectApplicationHostRepairCandidateResultV1(
  raw: unknown,
  request: unknown,
  config: ApplicationHostRepairCandidateAdmissionConfig,
) {
  return safe(() => {
    const admitted = inspectApplicationHostRepairCandidateRequestV1(
      request,
      config,
    );
    const result = applicationHostRepairCandidateBuildResultV1Schema.parse(raw);
    inspectBoundHostRepairResult(result, admitted);
    return result;
  });
}
