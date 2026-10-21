// Synthetic locks and tool pins for orchestration tests only; no tool executed.
import {
  canonicalJson,
  sha256Digest,
} from "@cloudmarkup/application-build-runner";
import {
  applicationHostRepairSeedPolicyV1Schema,
  applicationHostRepairSeedBuildRequestV1Schema,
  createApplicationHostRepairSeedProfileV1,
  type ApplicationHostRepairSeedAdmissionConfig,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import { createProductionRepairSeedSourceV1 } from "./production-model-live-repair-seed-source.js";

export function hostExecutionFixture(invalid = false) {
  const source = createProductionRepairSeedSourceV1();
  const envelope = source.deterministicScaffold.artifact.buildContracts[0];
  const packageFile = source.positiveControl.files.find(
    (file) => file.path === "application/package.json",
  );
  if (envelope === undefined || packageFile === undefined)
    throw Error("Expected genuine fixed scaffold.");
  const pin = (id: string, version: string) => ({
    id,
    version,
    digest: sha256Digest(`synthetic-pin:${id}@${version}`),
  });
  const policy = applicationHostRepairSeedPolicyV1Schema.parse({
    contractVersion: 1,
    builder: pin("cloudmarkup.application-builder", "1.0.0"),
    profile: createApplicationHostRepairSeedProfileV1(),
    container: {
      digest: sha256Digest("synthetic-image"),
      image: "cloudmarkup/application-build",
      platform: "linux/amd64",
      pnpmStorePath: "/opt/cloudmarkup/pnpm-store",
    },
    dependencyCacheDigest: sha256Digest("synthetic-cache"),
    dependencyAllowlist: envelope.contract.dependencies.map(
      ({ kind, name, version }) => ({ kind, name, version }),
    ),
    dependencyDenylist: ["event-stream"],
    defaultLimits: {
      cpuSeconds: 120,
      memoryMiB: 1024,
      maxFiles: 32,
      maxFileBytes: 1024 * 1024,
      maxTotalFileBytes: 1024 * 1024,
      maxOutputBytes: 256 * 1024,
      maxProcesses: 32,
      maxArtifactBytes: 1024 * 1024,
      wallTimeMilliseconds: 120_000,
    },
    scanner: pin("aquasecurity.trivy", "0.74.0"),
    secretScanner: pin("aquasecurity.trivy-secret", "0.74.0"),
    toolchain: envelope.contract.toolchain.map(({ id, version }) =>
      pin(id, version),
    ),
  });
  const packageManager = policy.toolchain.find(
    (tool) => tool.id === "package-manager.pnpm",
  );
  if (packageManager === undefined)
    throw Error("Expected actual pnpm coordinate.");
  const lockfileContent =
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: false\n";
  const variant = invalid ? source.invalidSeed : source.positiveControl;
  const request = applicationHostRepairSeedBuildRequestV1Schema.parse({
    kind: "cloudmarkup.host-repair-seed-build.request",
    contractVersion: 1,
    assessedAt: "2026-09-12T12:00:00.000Z",
    environment: { environmentType: "development" },
    profile: policy.profile,
    limits: policy.defaultLimits,
    dependencyLock: {
      contractVersion: 1,
      lifecycleScripts: "deny",
      lockfilePath: "application/pnpm-lock.yaml",
      lockfileContent,
      lockfileChecksum: sha256Digest(lockfileContent),
      packageManifestChecksum: packageFile.checksum,
      packageManager,
      cache: {
        kind: "prepackaged-content-addressed",
        network: "deny",
        digest: policy.dependencyCacheDigest,
      },
      packages: envelope.contract.dependencies
        .map(({ name, version, kind }) => ({
          name,
          version,
          kind,
          integrity: `sha512-${"A".repeat(86)}==`,
          tarballDigest: sha256Digest(`synthetic-tarball:${name}@${version}`),
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    },
    solutionRevision: source.generationRequest.solutionRevision,
    solutionRevisionDigest: sha256Digest(
      canonicalJson(source.generationRequest.solutionRevision),
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
  const config: ApplicationHostRepairSeedAdmissionConfig = {
    definition: source,
    policy,
    dependencyLock: request.dependencyLock,
    environment: request.environment,
    helperDigest: sha256Digest("synthetic-helper"),
  };
  return { source, envelope, request, config };
}
