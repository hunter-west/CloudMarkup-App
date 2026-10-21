import type { inspectApplicationHostRepairSuccessorRequestV2 } from "./host-repair-successor-admission.js";
import { applicationHostRepairSuccessorManifestV2Schema } from "./host-repair-successor-contracts.js";
import type { inspectApplicationHostRepairCandidateRequestV1 } from "./host-repair-candidate-admission.js";
import {
  applicationHostRepairCandidateArtifactV1Schema,
  applicationHostRepairCandidateManifestV1Schema,
} from "./host-repair-candidate-contracts.js";
import type { ApplicationBuildProducedFile } from "./contracts.js";
import { applicationHostRepairSeedArtifactV1Schema } from "./host-repair-seed-contracts.js";
import type { inspectApplicationHostRepairSeedRequestV1 } from "./host-repair-seed-admission.js";
import { applicationHostRepairSeedManifestV1Schema } from "./host-repair-seed-manifest.js";
import {
  canonicalJson,
  compareUtf16,
  outputPathIssue,
  sha256Digest,
} from "./security.js";
import {
  createDeterministicLambdaZip,
  type ApplicationZipEntry,
} from "./zip.js";

export type AdmittedHostRepairSeed = ReturnType<
  typeof inspectApplicationHostRepairSeedRequestV1
>;
export type AdmittedHostRepairCandidate = ReturnType<
  typeof inspectApplicationHostRepairCandidateRequestV1
>;
export type AdmittedHostRepairSource =
  | AdmittedHostRepairSeed
  | AdmittedHostRepairCandidate
  | ReturnType<typeof inspectApplicationHostRepairSuccessorRequestV2>;
function requireOutput(value: boolean): asserts value {
  if (!value)
    throw new Error("The exact bounded host output inventory is unavailable.");
}
function packageLocation(path: string) {
  const parts = path.split("/");
  const nodeModules = parts.lastIndexOf("node_modules");
  const first = parts[nodeModules + 1];
  if (nodeModules < 0 || first === undefined) return undefined;
  const scoped = first.startsWith("@");
  const second = scoped ? parts[nodeModules + 2] : undefined;
  if (scoped && second === undefined) return undefined;
  const end = nodeModules + (scoped ? 3 : 2);
  const suffix = parts.slice(end).join("/");
  if (suffix.length === 0) return undefined;
  return {
    name: scoped ? `${first}/${second ?? ""}` : first,
    root: parts.slice(0, end).join("/"),
    suffix,
  };
}

/** Select actual produced bytes without borrowing normal artifact ownership. */
export function packageHostRepairSeedOutput(
  admitted: AdmittedHostRepairSource,
  produced: readonly ApplicationBuildProducedFile[],
) {
  const { request } = admitted;
  const envelope = admitted.originalBuildContract.contract;
  requireOutput(produced.length <= request.limits.maxFiles);
  const files = new Map<string, Uint8Array>();
  const portable = new Set<string>();
  let total = 0;
  for (const file of produced) {
    total += file.bytes.byteLength;
    const key = file.path.normalize("NFC").toLowerCase();
    requireOutput(
      file.kind === "regular-file" &&
        outputPathIssue(file.path) === undefined &&
        !portable.has(key) &&
        file.bytes.byteLength <= request.limits.maxFileBytes &&
        total <= request.limits.maxTotalFileBytes,
    );
    portable.add(key);
    files.set(file.path, Uint8Array.from(file.bytes));
  }
  const sourceRoot = envelope.entrypoint.slice(
    0,
    envelope.entrypoint.lastIndexOf("/") + 1,
  );
  const compiledRoot = envelope.compiledEntrypoint.slice(
    0,
    envelope.compiledEntrypoint.lastIndexOf("/") + 1,
  );
  const expectedCompiled = new Map<string, string>();
  const testOutputs = new Set<string>();
  for (const source of request.source.files) {
    if (
      source.path.startsWith("application/tests/") &&
      source.path.endsWith(".ts")
    ) {
      testOutputs.add(
        source.path
          .replace("application/", "application/dist/")
          .replace(/\.ts$/u, ".js"),
      );
    }
    if (!source.path.startsWith(sourceRoot) || !source.path.endsWith(".ts"))
      continue;
    requireOutput(
      source.ownership === "generated" ||
        (source.path === request.source.extensionPath &&
          source.ownership === "user-owned"),
    );
    const path = source.path.slice(sourceRoot.length).replace(/\.ts$/u, ".js");
    expectedCompiled.set(compiledRoot + path, path);
  }
  const entries: ApplicationZipEntry[] = [];
  for (const [output, path] of expectedCompiled) {
    const bytes = files.get(output);
    requireOutput(bytes !== undefined);
    entries.push({ path, bytes });
  }
  requireOutput(
    entries.some((entry) => entry.path === "index.js") &&
      entries.some((entry) => entry.path === "extensions/custom.js"),
  );
  const locked = new Map(
    request.dependencyLock.packages
      .filter(
        (entry) =>
          entry.kind === "runtime" || entry.kind === "transitive-runtime",
      )
      .map((entry) => [`${entry.name}\u0000${entry.version}`, entry]),
  );
  const roots = new Map<string, string>();
  for (const [path] of files) {
    if (expectedCompiled.has(path) || testOutputs.has(path)) continue;
    requireOutput(path.startsWith("application/node_modules/"));
    const location = packageLocation(path);
    requireOutput(
      location !== undefined &&
        !location.name.startsWith(".") &&
        !/\.(?:map|ts)$/iu.test(location.suffix) &&
        location.suffix
          .split("/")
          .every(
            (part) =>
              !part.startsWith(".") &&
              !["test", "tests", "__tests__"].includes(part.toLowerCase()),
          ),
    );
    roots.set(location.root, location.name);
  }
  const seen = new Set<string>();
  const identitiesByRoot = new Map<
    string,
    { readonly name: string; readonly version: string }
  >();
  for (const [root, expectedName] of roots) {
    const bytes = files.get(`${root}/package.json`);
    requireOutput(bytes !== undefined);
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    requireOutput(
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
    );
    const identity = parsed as {
      readonly name?: unknown;
      readonly version?: unknown;
    };
    requireOutput(
      identity.name === expectedName && typeof identity.version === "string",
    );
    const key = `${expectedName}\u0000${identity.version}`;
    requireOutput(locked.has(key));
    seen.add(key);
    identitiesByRoot.set(root, {
      name: expectedName,
      version: identity.version,
    });
  }
  requireOutput(
    seen.size === locked.size &&
      [...locked.keys()].every((key) => seen.has(key)),
  );
  for (const [path, bytes] of files)
    if (path.startsWith("application/node_modules/"))
      entries.push({ path: path.slice("application/".length), bytes });
  const direct = envelope.dependencies.filter(
    (entry) => entry.kind === "runtime",
  );
  for (const dependency of direct) {
    const identity = identitiesByRoot.get(
      `application/node_modules/${dependency.name}`,
    );
    requireOutput(
      identity?.name === dependency.name &&
        identity.version === dependency.version,
    );
  }
  entries.push({
    path: "package.json",
    bytes: Buffer.from(
      canonicalJson({
        dependencies: Object.fromEntries(
          direct
            .map((entry) => [entry.name, entry.version] as const)
            .sort(([a], [b]) => compareUtf16(a, b)),
        ),
        engines: { node: ">=24.0.0 <25" },
        private: true,
        type: "module",
      }),
      "utf8",
    ),
  });
  entries.sort((a, b) => compareUtf16(a.path, b.path));
  requireOutput(
    new Set(entries.map((entry) => entry.path.normalize("NFC").toLowerCase()))
      .size === entries.length,
  );
  const archive = createDeterministicLambdaZip(entries);
  requireOutput(archive.byteLength <= request.limits.maxArtifactBytes);
  return {
    archive,
    entries,
    runtimePackages: [...locked.values()].sort((a, b) =>
      compareUtf16(
        `${a.name}\u0000${a.version}`,
        `${b.name}\u0000${b.version}`,
      ),
    ),
  };
}

function createHostRepairArtifacts(
  admitted: AdmittedHostRepairSource,
  packed: ReturnType<typeof packageHostRepairSeedOutput>,
) {
  const candidate = admitted.request.source.variant === "model-repair";
  const successor = admitted.request.contractVersion === 2;
  const contract = admitted.originalBuildContract.contract;
  const body = {
    kind: candidate
      ? "cloudmarkup.host-repair-candidate-artifact-manifest"
      : "cloudmarkup.host-repair-seed-artifact-manifest",
    contractVersion: successor ? 2 : 1,
    origin: successor
      ? "model-successor-of-host-repair"
      : candidate
        ? "model-repair-of-fixed-host-seed"
        : "fixed-host-synthetic",
    authority: "host-validation-only",
    bindings: admitted.bindings,
    runtime: contract.runtime,
    archive: {
      checksum: sha256Digest(packed.archive),
      sizeBytes: packed.archive.byteLength,
      entrypoint: "index.js",
    },
    files: packed.entries.map((entry) => ({
      path: entry.path,
      checksum: sha256Digest(entry.bytes),
      sizeBytes: entry.bytes.byteLength,
    })),
  };
  const manifestSchema = successor
    ? applicationHostRepairSuccessorManifestV2Schema
    : candidate
      ? applicationHostRepairCandidateManifestV1Schema
      : applicationHostRepairSeedManifestV1Schema;
  const manifest = manifestSchema.parse({
    ...body,
    manifestDigest: sha256Digest(canonicalJson(body)),
  });
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: candidate
          ? "cloudmarkup-host-repair-candidate"
          : "cloudmarkup-host-repair-seed",
        version: "1",
        properties: [
          { name: "cloudmarkup:inventory-scope", value: "inspected-runtime" },
          {
            name: "cloudmarkup:source-tree",
            value: admitted.bindings.sourceTreeDigest,
          },
          {
            name: "cloudmarkup:dependency-lock",
            value: admitted.bindings.dependencyLockDigest,
          },
        ],
      },
    },
    components: packed.runtimePackages.map((entry) => ({
      type: "library",
      name: entry.name,
      version: entry.version,
      purl: `pkg:npm/${encodeURIComponent(entry.name)}@${entry.version}`,
      hashes: [{ alg: "SHA-256", content: entry.tarballDigest.slice(7) }],
      properties: [
        { name: "cloudmarkup:registry-integrity", value: entry.integrity },
      ],
    })),
  };
  const path = contract.expectedArtifact.path;
  const outputs = [
    { path, bytes: packed.archive, mediaType: "application/zip" },
    {
      path: path.replace(/\/function\.zip$/u, "/artifact-manifest.json"),
      bytes: Buffer.from(canonicalJson(manifest), "utf8"),
      mediaType: "application/json",
    },
    {
      path: path
        .replace("application/artifacts/", "application/evidence/")
        .replace(/\/function\.zip$/u, "/sbom.cdx.json"),
      bytes: Buffer.from(canonicalJson(sbom), "utf8"),
      mediaType: "application/vnd.cyclonedx+json",
    },
  ];
  requireOutput(
    outputs.reduce((total, file) => total + file.bytes.byteLength, 0) <=
      admitted.request.limits.maxArtifactBytes,
  );
  return outputs.map((file) => ({
    path: file.path,
    mediaType: file.mediaType,
    bytesBase64: Buffer.from(file.bytes).toString("base64"),
    checksum: sha256Digest(file.bytes),
    sizeBytes: file.bytes.byteLength,
    ownership: candidate
      ? "host-repair-candidate-validation-artifact"
      : "host-synthetic-validation-artifact",
    bindings: admitted.bindings,
  }));
}

export function createAdmittedHostRepairArtifacts(
  admitted: AdmittedHostRepairSource,
  packed: ReturnType<typeof packageHostRepairSeedOutput>,
) {
  const outputs = createHostRepairArtifacts(admitted, packed);
  return admitted.request.source.variant === "model-repair"
    ? outputs.map((file) =>
        applicationHostRepairCandidateArtifactV1Schema.parse(file),
      )
    : outputs.map((file) =>
        applicationHostRepairSeedArtifactV1Schema.parse(file),
      );
}
