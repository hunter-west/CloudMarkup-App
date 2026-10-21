import {
  applicationHostRepairSeedBuildRequestV1Schema,
  type ApplicationHostRepairSeedAdmissionConfig,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import { digestCanonicalValue, utcTimestampSchema } from "@cloudmarkup/schemas";
import { createProductionRepairSeedSourceV1 } from "./production-model-live-repair-seed-source.js";
/** Actual fixed bytes only. Callers must establish native and tenant admission separately. */
export function createProductionSeedBuildInput(
  admission: Omit<ApplicationHostRepairSeedAdmissionConfig, "definition">,
  rawAssessedAt: unknown,
) {
  const assessedAt = utcTimestampSchema.parse(rawAssessedAt);
  const source = createProductionRepairSeedSourceV1();
  const variant = source.invalidSeed;
  const request = applicationHostRepairSeedBuildRequestV1Schema.parse({
    kind: "cloudmarkup.host-repair-seed-build.request",
    contractVersion: 1,
    assessedAt,
    environment: admission.environment,
    profile: admission.policy.profile,
    limits: admission.policy.defaultLimits,
    dependencyLock: admission.dependencyLock,
    solutionRevision: source.generationRequest.solutionRevision,
    solutionRevisionDigest: digestCanonicalValue(
      source.generationRequest.solutionRevision,
    ),
    source: {
      origin: source.origin,
      recipe: source.recipe,
      variant: variant.variant,
      deterministicScaffold: source.deterministicScaffold,
      baselineSourceDigest: source.baselineSourceDigest,
      extensionPath: source.extensionPath,
      extensionContentDigest: variant.extensionContentDigest,
      files: variant.files,
      sourceTreeDigest: variant.sourceTreeDigest,
    },
  });
  const config = { ...admission, definition: source };
  return { request, config };
}
