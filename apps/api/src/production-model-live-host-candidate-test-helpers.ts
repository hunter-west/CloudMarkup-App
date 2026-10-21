import {
  applicationBuildSourceTreeDigest,
  sha256Digest,
} from "@cloudmarkup/application-build-runner";
import {
  applicationHostRepairCandidateBuildRequestV1Schema,
  applicationHostRepairCandidatePolicyV1Schema,
  applicationHostRepairCandidateLineageV1Schema,
  createApplicationHostRepairCandidateProfileV1,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import { hostExecutionFixture } from "./production-model-live-repair-seed-execution-fixture.js";
export function hostCandidateExecutionFixture(repairable = false) {
  const base = hostExecutionFixture(true);
  const policy = applicationHostRepairCandidatePolicyV1Schema.parse({
    ...base.config.policy,
    profile: createApplicationHostRepairCandidateProfileV1(),
  });
  const lineage = applicationHostRepairCandidateLineageV1Schema.parse({
    baseDigest: base.request.source.extensionContentDigest,
    inputDigest: sha256Digest("synthetic actual-input placeholder"),
    invocationId: "invocation_candidate_runner_fixture",
    patchDigest: sha256Digest("synthetic exact patch placeholder"),
    responseDigest: sha256Digest("synthetic response placeholder"),
  });
  const files = base.request.source.files.map((file) => {
    if (file.path !== base.source.extensionPath) return file;
    const content = repairable
      ? file.content + "\n// first candidate retained comment\n"
      : file.content.replace(
          'repairSeedTypeWitness: number = "invalid"',
          'repairSeedTypeWitness: number = Number("1")',
        );
    if (content === file.content)
      throw Error("Missing genuine invalid source.");
    return { ...file, content, checksum: sha256Digest(content) };
  });
  const file = files.find((file) => file.path === base.source.extensionPath);
  if (file === undefined) throw Error("Missing extension.");
  const request = applicationHostRepairCandidateBuildRequestV1Schema.parse({
    ...base.request,
    kind: "cloudmarkup.host-repair-candidate-build.request",
    profile: policy.profile,
    source: {
      ...base.request.source,
      origin: "model-repair-of-fixed-host-seed",
      variant: "model-repair",
      lineage,
      files,
      extensionContentDigest: file.checksum,
      sourceTreeDigest: applicationBuildSourceTreeDigest(files),
    },
  });
  const config = {
    seed: base.config,
    seedRequest: base.request,
    policy,
    lineage,
  };
  return { base, request, config, envelope: base.envelope };
}
