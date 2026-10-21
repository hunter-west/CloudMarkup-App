import { generateApplication } from "@cloudmarkup/application-generator";
import {
  digestCanonicalValue,
  normalizeSolutionRevisionManifestV1,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import {
  applicationBuildSourceFileV1Schema,
  applicationBuildSourceTreeDigest,
  applicationDependencyLockV1Schema,
} from "./contracts.js";
import {
  applicationHostRepairSeedBuildRequestV1Schema,
  applicationHostRepairSeedBuildResultV1Schema,
  applicationHostRepairSeedDefinitionV1Schema,
  applicationHostRepairSeedPolicyV1Schema,
  applicationHostRepairSeedRequestDigest,
  HOST_REPAIR_SEED_EXTENSION_PATH,
  HOST_REPAIR_SEED_RECIPE_ID,
  HOST_REPAIR_SEED_SUFFIXES_BY_VERSION,
  type ApplicationHostRepairSeedBuildRequestV1,
  type ApplicationHostRepairSeedDefinitionV1,
  type ApplicationHostRepairSeedPolicyV1,
} from "./host-repair-seed-contracts.js";
import { canonicalJson, compareUtf16, sha256Digest } from "./security.js";

/** All configuration comes from trusted host composition, never from a request. */
export interface ApplicationHostRepairSeedAdmissionConfig {
  readonly definition: ApplicationHostRepairSeedDefinitionV1;
  readonly policy: ApplicationHostRepairSeedPolicyV1;
  readonly dependencyLock: ApplicationHostRepairSeedBuildRequestV1["dependencyLock"];
  readonly environment: ApplicationHostRepairSeedBuildRequestV1["environment"];
  readonly helperDigest: ApplicationHostRepairSeedBuildRequestV1["solutionRevisionDigest"];
}
export class ApplicationHostRepairSeedAdmissionError extends Error {
  readonly code = "application.host-repair-seed.not-admitted";
  constructor() {
    super("The exact configured host repair seed is not admitted.");
    this.name = "ApplicationHostRepairSeedAdmissionError";
  }
}
function requireExact(value: boolean): asserts value {
  if (!value) throw new ApplicationHostRepairSeedAdmissionError();
}
const same = (left: unknown, right: unknown) =>
  canonicalJson(left) === canonicalJson(right);
function boundedSource(value: unknown) {
  requireExact(
    Buffer.byteLength(JSON.stringify(value), "utf8") <= 2 * 1024 * 1024,
  );
}
function safe<T>(work: () => T): T {
  try {
    return work();
  } catch {
    throw new ApplicationHostRepairSeedAdmissionError();
  }
}
function sorted<T extends { readonly name: string; readonly version: string }>(
  entries: readonly T[],
) {
  return [...entries].sort((a, b) =>
    compareUtf16(`${a.name}\u0000${a.version}`, `${b.name}\u0000${b.version}`),
  );
}

/** Pure byte admission only: no workspace, provider, journal, receipt or execution. */
export function inspectApplicationHostRepairSeedRequestV1(
  raw: unknown,
  config: ApplicationHostRepairSeedAdmissionConfig,
) {
  return safe(() => {
    boundedSource(raw);
    boundedSource(config.definition);
    const request = applicationHostRepairSeedBuildRequestV1Schema.parse(raw);
    const definition = applicationHostRepairSeedDefinitionV1Schema.parse(
      config.definition,
    );
    const policy = applicationHostRepairSeedPolicyV1Schema.parse(config.policy);
    const lock = applicationDependencyLockV1Schema.parse(config.dependencyLock);
    const helperDigest = sha256DigestSchema.parse(config.helperDigest);
    requireExact(
      same(request.environment, config.environment) &&
        same(request.profile, policy.profile) &&
        same(request.dependencyLock, lock),
    );
    for (const key of Object.keys(
      request.limits,
    ) as (keyof typeof request.limits)[])
      requireExact(request.limits[key] <= policy.defaultLimits[key]);
    const generationRequest = definition.generationRequest;
    requireExact(
      generationRequest.existingFiles.length === 0 &&
        generationRequest.workloadBehavior.workloads.length === 1,
    );
    const workload = generationRequest.workloadBehavior.workloads[0];
    requireExact(
      workload?.implementation.mode === "generated-starter" &&
        workload.provenance.source === "manual" &&
        workload.extensions.length === 0 &&
        workload.compatibility.modelGateways.length === 0,
    );
    requireExact(
      generationRequest.solutionRevision.aiExtensionIds.length === 0 &&
        generationRequest.solutionRevision.evidenceIdsAtFreeze.length === 0 &&
        generationRequest.solutionRevision.issueIdsAtFreeze.length === 0,
    );
    requireExact(
      same(request.solutionRevision, generationRequest.solutionRevision),
    );
    requireExact(
      request.solutionRevisionDigest ===
        sha256Digest(canonicalJson(request.solutionRevision)),
    );

    // Recompute the real generator result; a rehashed scaffold is insufficient.
    const generated = generateApplication(generationRequest);
    requireExact(
      same(generated, definition.deterministicScaffold) &&
        same(generated, request.source.deterministicScaffold),
    );
    requireExact(
      generated.artifact.diagnostics.every(
        (item) => item.severity !== "error",
      ) && generated.artifact.buildContracts.length === 1,
    );
    const envelope = generated.artifact.buildContracts[0];
    requireExact(envelope?.contract.implementationMode === "generated-starter");
    const semanticHash = request.solutionRevision.architecture.contentHash;
    const normalizedRevision = normalizeSolutionRevisionManifestV1({
      ...request.solutionRevision,
      architecture: {
        ...request.solutionRevision.architecture,
        documentHash: semanticHash,
        visualHash: semanticHash,
      },
    });
    requireExact(
      generated.artifact.sourceManifest.inputDigests.solutionRevision ===
        sha256Digest(canonicalJson(normalizedRevision)),
    );
    const baseline = generated.artifact.sourceFiles
      .map((file) => {
        requireExact("content" in file && typeof file.content === "string");
        const parsed = applicationBuildSourceFileV1Schema.parse({
          path: file.path,
          ownership: file.ownership,
          content: file.content,
          checksum: file.checksum,
          mediaType: file.mediaType,
        });
        requireExact(sha256Digest(parsed.content) === parsed.checksum);
        return parsed;
      })
      .sort((a, b) => compareUtf16(a.path, b.path));
    const original = baseline.find(
      (file) => file.path === HOST_REPAIR_SEED_EXTENSION_PATH,
    );
    requireExact(
      original?.ownership === "user-owned" &&
        baseline.filter((file) => file.ownership !== "generated").length === 1,
    );
    const baselineDigest = applicationBuildSourceTreeDigest(baseline);
    requireExact(
      definition.baselineSourceDigest === baselineDigest &&
        request.source.baselineSourceDigest === baselineDigest,
    );
    requireExact(
      same(request.solutionRevision.sourceOwnership, [
        {
          path: HOST_REPAIR_SEED_EXTENSION_PATH,
          contentHash: original.checksum,
          ownership: "user-owned",
          ownerId: "repair_seed.owner",
          conflictBehavior: "preserve-user-content",
        },
      ]),
    );
    const suffixes =
      HOST_REPAIR_SEED_SUFFIXES_BY_VERSION[definition.recipe.version];
    const expectedRecipeDigest = digestCanonicalValue({
      id: HOST_REPAIR_SEED_RECIPE_ID,
      version: definition.recipe.version,
      origin: "fixed-host-synthetic",
      generationRequestDigest: digestCanonicalValue(generationRequest),
      extensionPath: HOST_REPAIR_SEED_EXTENSION_PATH,
      positiveControlSuffixDigest: sha256Digest(suffixes["positive-control"]),
      invalidSeedSuffixDigest: sha256Digest(suffixes["invalid-seed"]),
      predictedDiagnostic: {
        source: "typescript",
        code: "TS2322",
        path: HOST_REPAIR_SEED_EXTENSION_PATH,
      },
      observedValidation: "none",
    });
    requireExact(
      definition.recipe.digest === expectedRecipeDigest &&
        same(request.source.recipe, definition.recipe),
    );
    for (const [name, variant] of [
      ["positive-control", definition.positiveControl],
      ["invalid-seed", definition.invalidSeed],
    ] as const) {
      requireExact(variant.variant === name);
      const expected = baseline.map((file) => {
        const content =
          file.path === HOST_REPAIR_SEED_EXTENSION_PATH
            ? file.content + suffixes[name]
            : file.content;
        return { ...file, content, checksum: sha256Digest(content) };
      });
      requireExact(same(expected, variant.files));
      requireExact(
        variant.sourceTreeDigest === applicationBuildSourceTreeDigest(expected),
      );
      requireExact(
        variant.extensionContentDigest ===
          sha256Digest(original.content + suffixes[name]),
      );
    }
    const variant =
      request.source.variant === "positive-control"
        ? definition.positiveControl
        : definition.invalidSeed;
    requireExact(
      same(request.source.files, variant.files) &&
        request.source.sourceTreeDigest === variant.sourceTreeDigest &&
        request.source.extensionContentDigest ===
          variant.extensionContentDigest,
    );
    requireExact(
      new Set(
        request.source.files.map((file) =>
          file.path.normalize("NFC").toLowerCase(),
        ),
      ).size === request.source.files.length,
    );
    requireExact(request.source.files.length <= request.limits.maxFiles);
    let total = 0;
    for (const file of request.source.files) {
      const bytes = Buffer.byteLength(file.content, "utf8");
      total += bytes;
      requireExact(
        bytes <= request.limits.maxFileBytes &&
          sha256Digest(file.content) === file.checksum,
      );
    }
    requireExact(total <= request.limits.maxTotalFileBytes);
    requireExact(
      envelope.contract.sourceInputs.every((input) =>
        baseline.some(
          (file) =>
            file.path === input.path && file.checksum === input.checksum,
        ),
      ),
    );
    requireExact(
      same([...envelope.contract.requiredChecks].sort(), [
        "compile",
        "contract-tests",
        "reproducibility",
        "security",
        "unit-tests",
      ]),
    );
    requireExact(
      envelope.contract.packageManifestPath === "application/package.json" &&
        envelope.contract.lockfilePath === "application/lockfile.contract.json",
    );
    const packageFile = baseline.find(
      (file) => file.path === "application/package.json",
    );
    requireExact(
      packageFile?.checksum === lock.packageManifestChecksum &&
        sha256Digest(lock.lockfileContent) === lock.lockfileChecksum,
    );
    requireExact(
      /^lockfileVersion:\s*['"]?9(?:\.0)?['"]?\s*$/mu.test(
        lock.lockfileContent,
      ),
    );
    requireExact(lock.cache.digest === policy.dependencyCacheDigest);
    requireExact(
      same(
        lock.packageManager,
        policy.toolchain.find((tool) => tool.id === "package-manager.pnpm"),
      ),
    );
    requireExact(
      same(
        envelope.contract.toolchain
          .map(({ id, version }) => ({ id, version }))
          .sort((a, b) => compareUtf16(a.id, b.id)),
        policy.toolchain
          .map(({ id, version }) => ({ id, version }))
          .sort((a, b) => compareUtf16(a.id, b.id)),
      ),
    );
    const expectedDependencies = sorted(
      envelope.contract.dependencies.map(({ kind, name, version }) => ({
        kind,
        name,
        version,
      })),
    );
    requireExact(
      same(expectedDependencies, sorted(policy.dependencyAllowlist)),
    );
    requireExact(
      expectedDependencies.every((dependency) =>
        lock.packages.some(
          (entry) =>
            entry.name === dependency.name &&
            entry.version === dependency.version &&
            entry.kind === dependency.kind,
        ),
      ),
    );
    requireExact(
      !lock.packages.some((entry) =>
        policy.dependencyDenylist.includes(entry.name),
      ),
    );
    const bindings = {
      requestDigest: applicationHostRepairSeedRequestDigest(request),
      recipeDigest: expectedRecipeDigest,
      solutionRevisionDigest: request.solutionRevisionDigest,
      generationArtifactDigest: generated.artifactDigest,
      originalBuildContractDigest: envelope.contractDigest,
      baselineSourceDigest: baselineDigest,
      sourceTreeDigest: variant.sourceTreeDigest,
      extensionContentDigest: variant.extensionContentDigest,
      dependencyLockDigest: sha256Digest(canonicalJson(lock)),
      policyDigest: sha256Digest(canonicalJson(policy)),
      imageDigest: policy.container.digest,
      helperDigest,
    };
    const effectiveInventory = {
      kind: "cloudmarkup.host-repair-seed.effective-inventory" as const,
      contractVersion: 1 as const,
      authority: "host-source-admission-only" as const,
      originalBuildContractDigest: envelope.contractDigest,
      sourceTreeDigest: variant.sourceTreeDigest,
      files: variant.files.map(({ checksum, mediaType, ownership, path }) => ({
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
      originalBuildContract: envelope,
      effectiveInventory,
      effectiveInventoryDigest: sha256Digest(canonicalJson(effectiveInventory)),
    };
  });
}

/** Rejoins an observation to admitted bytes/configuration. This cannot authenticate
 * that a tool ran or issue durable evidence, even when all fields are consistent. */
export function inspectApplicationHostRepairSeedResultV1(
  raw: unknown,
  request: unknown,
  config: ApplicationHostRepairSeedAdmissionConfig,
) {
  return safe(() => {
    const admitted = inspectApplicationHostRepairSeedRequestV1(request, config);
    const result = applicationHostRepairSeedBuildResultV1Schema.parse(raw);
    requireExact(same(result.bindings, admitted.bindings));
    const path = admitted.originalBuildContract.contract.expectedArtifact.path;
    const expected = [
      { path, mediaType: "application/zip" },
      {
        path: path.replace(/\/function\.zip$/u, "/artifact-manifest.json"),
        mediaType: "application/json",
      },
      {
        path: path
          .replace("application/artifacts/", "application/evidence/")
          .replace(/\/function\.zip$/u, "/sbom.cdx.json"),
        mediaType: "application/vnd.cyclonedx+json",
      },
    ];
    if (result.state === "passed")
      requireExact(
        same(
          result.artifacts.map((file) => ({
            path: file.path,
            mediaType: file.mediaType,
          })),
          expected,
        ),
      );
    requireExact(
      result.artifacts.every(
        (file) => file.sizeBytes <= admitted.request.limits.maxArtifactBytes,
      ),
    );
    requireExact(
      result.steps.every(
        (step) => step.outputBytes <= admitted.request.limits.maxOutputBytes,
      ),
    );
    requireExact(
      result.diagnostics.every(
        (item) =>
          item.references.solutionRevisionId ===
          admitted.request.solutionRevision.solutionRevisionId,
      ),
    );
    return result;
  });
}
