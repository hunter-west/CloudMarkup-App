import { createHash } from "node:crypto";

export const MAXIMA = Object.freeze({
  archiveBytes: 160 * 1024 * 1024,
  fileBytes: 4 * 1024 * 1024,
  files: 20_000,
  outputBytes: 2 * 1024 * 1024,
  pathBytes: 512,
  totalFileBytes: 128 * 1024 * 1024,
  wallTimeMilliseconds: 900_000,
});

export const EXACT_RUNTIME = Object.freeze({
  eslint: "9.39.5",
  node: "24.18.0",
  pnpm: "11.16.0",
  trivy: "0.74.0",
  typescript: "6.0.3",
  vitest: "4.1.10",
});

export const PROFILE_IDS = Object.freeze([
  "cloudmarkup.application-build.ai-assisted-custom-nodejs24",
  "cloudmarkup.application-build.generated-nodejs24",
  "cloudmarkup.application-build.user-source-static-nodejs24",
]);

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SAFE_SEGMENT = /^[A-Za-z0-9@._-]+$/u;
const ALLOWED_MEDIA_TYPES = new Set([
  "application/json",
  "text/markdown",
  "text/plain",
  "text/typescript",
  "text/yaml",
]);
const ALLOWED_OWNERSHIP = new Set([
  "ai-authored",
  "generated",
  "user-owned",
  "user-provided",
  "user-owned-extension",
]);
const FORBIDDEN_SEGMENTS = new Set([
  ".aws",
  ".cache",
  ".env",
  ".git",
  ".pnpm-store",
  ".terraform",
  "coverage",
  "node_modules",
]);
const FORBIDDEN_PACKAGE_MANAGER_FILES = new Set([
  ".npmrc",
  ".pnpmfile.cjs",
  ".yarnrc",
  ".yarnrc.yml",
  "pnpm-workspace.yaml",
]);
const ALLOWED_EXTENSIONS = new Set([
  ".json",
  ".md",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const EXACT_PACKAGES = Object.freeze({
  dependencies: Object.freeze({ "@aws-sdk/client-dynamodb": "3.1101.0" }),
  devDependencies: Object.freeze({
    "@types/node": "24.13.3",
    typescript: "6.0.3",
    vitest: "4.1.10",
  }),
});

function fail(message) {
  throw new TypeError(message);
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} contains missing or unsupported fields.`);
  }
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} is outside its supported integer range.`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be a lowercase sha256 digest.`);
  }
  return value;
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left === right ? 0 : 1))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), undefined, 2)}\n`;
}

export function safeApplicationPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAXIMA.pathBytes ||
    value !== value.normalize("NFC") ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0")
  ) {
    fail("Source path is not a normalized repository-relative path.");
  }
  const segments = value.split("/");
  if (
    segments.length < 2 ||
    segments[0] !== "application" ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !SAFE_SEGMENT.test(segment),
    )
  ) {
    fail("Source path must remain beneath the application root.");
  }
  const lowered = segments.map((segment) => segment.toLowerCase());
  if (
    lowered.some((segment) => FORBIDDEN_SEGMENTS.has(segment)) ||
    lowered.some((segment) => FORBIDDEN_PACKAGE_MANAGER_FILES.has(segment)) ||
    /\.(?:tfstate|tfplan|map)$/iu.test(value)
  ) {
    fail(
      "Source path uses a forbidden environment, hook, cache, or state path.",
    );
  }
  const fileName = segments.at(-1);
  const extension = fileName?.includes(".")
    ? `.${fileName.split(".").at(-1)?.toLowerCase()}`
    : "";
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    fail("Source path uses an unsupported file type.");
  }
  return value;
}

export function secretKind(content) {
  const patterns = [
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
    ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
    ["github-token", /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/u],
    ["payment-secret", /\b(?:sk_(?:live|test)_|whsec_)[A-Za-z0-9_]{8,}\b/u],
  ];
  return patterns.find(([, pattern]) => pattern.test(content))?.[0];
}

function stripAnsiControlSequences(value) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value.codePointAt(index) === 27 && value[index + 1] === "[") {
      let cursor = index + 2;
      while (/[0-9;]/u.test(value[cursor] ?? "")) cursor += 1;
      if (/[A-Za-z]/u.test(value[cursor] ?? "")) {
        index = cursor;
        continue;
      }
    }
    output += value[index] ?? "";
  }
  return output;
}

export function sanitizeToolText(value, maximum = 2_000) {
  const withoutControls = Array.from(stripAnsiControlSequences(String(value)))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (codePoint < 32 &&
        character !== String.fromCodePoint(10) &&
        character !== String.fromCodePoint(9)) ||
        codePoint === 127
        ? " "
        : character;
    })
    .join("");
  let output = withoutControls
    .replaceAll(/(?:AKIA|ASIA)[A-Z0-9]{16}/gu, "[redacted-secret]")
    .replaceAll(
      /(?:ghp_|github_pat_|sk_(?:live|test)_|whsec_)[A-Za-z0-9_]{8,}/gu,
      "[redacted-secret]",
    )
    .replaceAll(
      /(?:[A-Za-z]:\\|\/)(?:[^\s"']+[\\/])+[^\s"']*/gu,
      "[redacted-path]",
    )
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (output.length === 0) output = "Tool returned no safe diagnostic text.";
  return output.slice(0, maximum);
}

function validateRuntime(value) {
  const runtime = object(value, "runtime");
  exactKeys(runtime, Object.keys(EXACT_RUNTIME), "runtime");
  for (const [name, version] of Object.entries(EXACT_RUNTIME)) {
    if (runtime[name] !== version) fail(`runtime.${name} is unsupported.`);
  }
  return { ...EXACT_RUNTIME };
}

function validateLimits(value) {
  const limits = object(value, "limits");
  exactKeys(
    limits,
    [
      "cpuSeconds",
      "maxFileBytes",
      "maxFiles",
      "maxOutputBytes",
      "maxProcesses",
      "maxTotalFileBytes",
      "memoryMiB",
      "wallTimeMilliseconds",
    ],
    "limits",
  );
  return {
    cpuSeconds: integer(limits.cpuSeconds, 1, 600, "limits.cpuSeconds"),
    maxFileBytes: integer(
      limits.maxFileBytes,
      1,
      MAXIMA.fileBytes,
      "limits.maxFileBytes",
    ),
    maxFiles: integer(limits.maxFiles, 1, MAXIMA.files, "limits.maxFiles"),
    maxOutputBytes: integer(
      limits.maxOutputBytes,
      1,
      MAXIMA.outputBytes,
      "limits.maxOutputBytes",
    ),
    maxProcesses: integer(limits.maxProcesses, 1, 128, "limits.maxProcesses"),
    maxTotalFileBytes: integer(
      limits.maxTotalFileBytes,
      1,
      MAXIMA.totalFileBytes,
      "limits.maxTotalFileBytes",
    ),
    memoryMiB: integer(limits.memoryMiB, 128, 8_192, "limits.memoryMiB"),
    wallTimeMilliseconds: integer(
      limits.wallTimeMilliseconds,
      1_000,
      MAXIMA.wallTimeMilliseconds,
      "limits.wallTimeMilliseconds",
    ),
  };
}

function validateSourceFiles(value, profileId, limits) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > limits.maxFiles
  ) {
    fail("sourceFiles must be a non-empty bounded array.");
  }
  const identities = new Set();
  let total = 0;
  let previous = "";
  const files = value.map((entry, index) => {
    const file = object(entry, `sourceFiles[${index}]`);
    exactKeys(
      file,
      ["mediaType", "ownership", "path", "sha256", "sizeBytes"],
      `sourceFiles[${index}]`,
    );
    const path = safeApplicationPath(file.path);
    const portableIdentity = path.toLowerCase();
    if (identities.has(portableIdentity))
      fail("Source paths collide portably.");
    if (previous !== "" && previous >= path)
      fail("sourceFiles must be strictly sorted.");
    previous = path;
    identities.add(portableIdentity);
    if (!ALLOWED_MEDIA_TYPES.has(file.mediaType))
      fail("Source media type is unsupported.");
    if (!ALLOWED_OWNERSHIP.has(file.ownership))
      fail("Source ownership is unsupported.");
    if (
      profileId.endsWith("generated-nodejs24") &&
      new Set(["ai-authored", "user-provided"]).has(file.ownership)
    ) {
      fail("Generated profile rejects AI-authored and user-provided bytes.");
    }
    if (
      profileId.endsWith("ai-assisted-custom-nodejs24") &&
      file.ownership === "user-provided"
    ) {
      fail("AI-assisted profile rejects unclassified user-provided bytes.");
    }
    if (
      profileId.endsWith("user-source-static-nodejs24") &&
      file.ownership !== "user-provided"
    ) {
      fail("Static user-source profile accepts only user-provided ownership.");
    }
    const sizeBytes = integer(
      file.sizeBytes,
      0,
      limits.maxFileBytes,
      `sourceFiles[${index}].sizeBytes`,
    );
    total += sizeBytes;
    return {
      mediaType: file.mediaType,
      ownership: file.ownership,
      path,
      sha256: digest(file.sha256, `sourceFiles[${index}].sha256`),
      sizeBytes,
    };
  });
  if (total > limits.maxTotalFileBytes)
    fail("Source manifest exceeds total byte limit.");
  return files;
}

export function validateRequest(value) {
  const request = object(value, "request");
  exactKeys(
    request,
    [
      "contractVersion",
      "dependencyLock",
      "kind",
      "limits",
      "profileId",
      "requestDigest",
      "runtime",
      "solutionRevisionDigest",
      "solutionRevisionId",
      "sourceArchive",
      "sourceFiles",
      "workloadId",
    ],
    "request",
  );
  if (request.contractVersion !== 1)
    fail("request.contractVersion is unsupported.");
  if (request.kind !== "cloudmarkup.application-build-executor-request") {
    fail("request.kind is unsupported.");
  }
  if (!PROFILE_IDS.includes(request.profileId))
    fail("request.profileId is unsupported.");
  if (
    typeof request.solutionRevisionId !== "string" ||
    !SAFE_ID.test(request.solutionRevisionId)
  ) {
    fail("request.solutionRevisionId is invalid.");
  }
  if (
    typeof request.workloadId !== "string" ||
    !SAFE_ID.test(request.workloadId)
  ) {
    fail("request.workloadId is invalid.");
  }
  const limits = validateLimits(request.limits);
  const sourceArchive = object(request.sourceArchive, "sourceArchive");
  exactKeys(sourceArchive, ["path", "sha256", "sizeBytes"], "sourceArchive");
  if (sourceArchive.path !== "application.tar")
    fail("sourceArchive.path is unsupported.");
  const dependencyLock = object(request.dependencyLock, "dependencyLock");
  exactKeys(
    dependencyLock,
    [
      "cacheDigest",
      "lifecycleScripts",
      "lockfilePath",
      "lockfileSha256",
      "network",
      "packageManifestPath",
      "packageManifestSha256",
    ],
    "dependencyLock",
  );
  if (
    dependencyLock.lockfilePath !== "application/pnpm-lock.yaml" ||
    dependencyLock.packageManifestPath !== "application/package.json" ||
    dependencyLock.lifecycleScripts !== "deny" ||
    dependencyLock.network !== "deny"
  ) {
    fail("dependencyLock does not match the offline immutable contract.");
  }
  return {
    contractVersion: 1,
    dependencyLock: {
      cacheDigest: digest(
        dependencyLock.cacheDigest,
        "dependencyLock.cacheDigest",
      ),
      lifecycleScripts: "deny",
      lockfilePath: dependencyLock.lockfilePath,
      lockfileSha256: digest(
        dependencyLock.lockfileSha256,
        "dependencyLock.lockfileSha256",
      ),
      network: "deny",
      packageManifestPath: dependencyLock.packageManifestPath,
      packageManifestSha256: digest(
        dependencyLock.packageManifestSha256,
        "dependencyLock.packageManifestSha256",
      ),
    },
    kind: request.kind,
    limits,
    profileId: request.profileId,
    requestDigest: digest(request.requestDigest, "request.requestDigest"),
    runtime: validateRuntime(request.runtime),
    solutionRevisionDigest: digest(
      request.solutionRevisionDigest,
      "request.solutionRevisionDigest",
    ),
    solutionRevisionId: request.solutionRevisionId,
    sourceArchive: {
      path: "application.tar",
      sha256: digest(sourceArchive.sha256, "sourceArchive.sha256"),
      sizeBytes: integer(
        sourceArchive.sizeBytes,
        1,
        MAXIMA.archiveBytes,
        "sourceArchive.sizeBytes",
      ),
    },
    sourceFiles: validateSourceFiles(
      request.sourceFiles,
      request.profileId,
      limits,
    ),
    workloadId: request.workloadId,
  };
}

function exactRecord(actual, expected, label) {
  const parsed = object(actual, label);
  exactKeys(parsed, Object.keys(expected), label);
  for (const [name, version] of Object.entries(expected)) {
    if (parsed[name] !== version) fail(`${label}.${name} is unsupported.`);
  }
}

export function validateApplicationPackage(filesByPath, request) {
  const manifestBytes = filesByPath.get(
    request.dependencyLock.packageManifestPath,
  );
  const lockBytes = filesByPath.get(request.dependencyLock.lockfilePath);
  if (manifestBytes === undefined || lockBytes === undefined) {
    fail("The exact package manifest and pnpm lockfile are required.");
  }
  if (sha256(manifestBytes) !== request.dependencyLock.packageManifestSha256) {
    fail("Package manifest checksum does not match dependencyLock.");
  }
  if (sha256(lockBytes) !== request.dependencyLock.lockfileSha256) {
    fail("pnpm lockfile checksum does not match dependencyLock.");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("Application package manifest is malformed JSON.");
  }
  const packageObject = object(manifest, "application package manifest");
  if (packageObject.type !== "module" || "scripts" in packageObject) {
    fail("Application package manifest must be ESM and contain no scripts.");
  }
  exactRecord(
    packageObject.dependencies,
    EXACT_PACKAGES.dependencies,
    "dependencies",
  );
  exactRecord(
    packageObject.devDependencies,
    EXACT_PACKAGES.devDependencies,
    "devDependencies",
  );
  const lockText = lockBytes.toString("utf8");
  if (!/^lockfileVersion: ['"]9\.0['"]$/mu.test(lockText)) {
    fail("Application lockfile must use pnpm lockfile version 9.0.");
  }
  if (
    /\b(?:patchedDependencies|onlyBuiltDependencies|allowBuilds):/u.test(
      lockText,
    )
  ) {
    fail("Application lockfile cannot authorize patches or lifecycle builds.");
  }
}
