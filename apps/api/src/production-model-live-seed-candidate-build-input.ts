import { applicationBuildSourceTreeDigest } from "@cloudmarkup/application-build-runner";
import {
  applicationHostRepairCandidateBuildRequestV1Schema,
  applicationHostRepairCandidateLineageV1Schema,
  type ApplicationHostRepairCandidatePolicyV1,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import type { materializeHostSeedRepairPatchV2 } from "@cloudmarkup/ai-extension-generation";
import type { createProductionSeedBuildInput } from "./production-model-live-seed-build-input.js";

/** Pure reconstruction only; current private host composition owns provenance. */
export function createProductionSeedCandidateBuildInput(input: {
  readonly seed: ReturnType<typeof createProductionSeedBuildInput>;
  readonly policy: ApplicationHostRepairCandidatePolicyV1;
  readonly candidate: ReturnType<typeof materializeHostSeedRepairPatchV2>;
  readonly assessedAt: string;
}) {
  const { request: seedRequest, config: seedConfig } = input.seed;
  const { candidate, policy, assessedAt } = input;
  const lineage = applicationHostRepairCandidateLineageV1Schema.parse({
    baseDigest: candidate.baseDigest,
    inputDigest: candidate.inputDigest,
    invocationId: candidate.invocationId,
    patchDigest: candidate.patchDigest,
    responseDigest: candidate.responseDigest,
  });
  const files = seedRequest.source.files.map((file) =>
    file.path === candidate.path
      ? { ...file, content: candidate.content, checksum: candidate.digest }
      : file,
  );
  const build = applicationHostRepairCandidateBuildRequestV1Schema.parse({
    ...seedRequest,
    kind: "cloudmarkup.host-repair-candidate-build.request",
    assessedAt,
    profile: policy.profile,
    source: {
      ...seedRequest.source,
      origin: "model-repair-of-fixed-host-seed",
      variant: "model-repair",
      lineage,
      files,
      extensionContentDigest: candidate.digest,
      sourceTreeDigest: applicationBuildSourceTreeDigest(files),
    },
  });
  return { build, config: { seed: seedConfig, seedRequest, policy, lineage } };
}
