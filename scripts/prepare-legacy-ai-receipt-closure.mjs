import {
  createLegacyClockAdapterV2,
  LEGACY_CLOCK_V2_CONTRACT,
} from "./legacy-ai-receipt-clock.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { builtinModules, createRequire } from "node:module";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LEGACY_AI_SOURCE_COMMIT =
  "a979e325b6584642d5d5a9b58631bd3599d85591";
export const LEGACY_AI_CAPTURE_REQUIRE_BANNER =
  'import { createRequire as legacyCreateRequire, isBuiltin as legacyIsBuiltin } from "node:module"; const legacyBuiltinRequire = legacyCreateRequire(import.meta.url); const require = (specifier) => { if (!legacyIsBuiltin(specifier)) throw new Error("Historical capture runtime dependency escaped its closed bundle."); return legacyBuiltinRequire(specifier); };';
export const LEGACY_AI_BUNDLE_FILE = "packages/model-gateway/dist/capture.mjs";
export const LEGACY_AI_FIXTURE_ASSETS = Object.freeze([
  Object.freeze({
    path: "packages/test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
    sizeBytes: 7969,
    sha256: "3ae0396db1c57dfbe50515ebb76286201f1f8726e67b0f9ea830b707ce45fc32",
  }),
  Object.freeze({
    path: "packages/test-fixtures/fixtures/intent-document/v1/valid/representative.json",
    sizeBytes: 10535,
    sha256: "862462629fa3f6ec04068a10b87081308bc487a755ae6e1c8b9dd905d50dc3e7",
  }),
]);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(
  root,
  "scripts/fixtures/legacy-ai-receipt-closure-v1.json",
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const allowedExternal = new Set([
  "vitest",
  ...builtinModules,
  ...builtinModules.map((name) => "node:" + name),
]);

export function requireLegacyOwnedPath(parent, candidate) {
  const suffix = relative(parent, candidate);
  if (
    !suffix ||
    isAbsolute(suffix) ||
    suffix === ".." ||
    suffix.startsWith(".." + sep)
  )
    throw new Error(
      "Legacy closure path must stay in its exact owned directory.",
    );
  return candidate;
}
export function validateLegacyCaptureMetafile(metafile, sourceRoot, entry) {
  const inputs = Object.keys(metafile.inputs ?? {});
  if (
    inputs.length === 0 ||
    !inputs.some((name) => resolve(sourceRoot, name) === entry)
  )
    throw new Error("The exact historical capture entry is missing.");
  for (const name of inputs)
    requireLegacyOwnedPath(sourceRoot, resolve(sourceRoot, name));
  const outputs = Object.values(metafile.outputs ?? {});
  if (outputs.length !== 1)
    throw new Error("Historical capture must have one closed output.");
  for (const output of outputs) {
    for (const item of output.imports ?? []) {
      // The locked pg package contains an unavailable optional native branch.
      // This exact static call is recorded, but the runtime banner always
      // rejects it. It never gains package lookup or execution authority.
      if (item.path === "pg-native") {
        if (item.external !== true || item.kind !== "require-call")
          throw new Error(
            "A historical capture import escaped its closed bundle.",
          );
      } else if (item.external && !allowedExternal.has(item.path)) {
        throw new Error(
          "A historical capture import escaped its closed bundle.",
        );
      }
    }
  }
  return inputs.sort();
}
export function validateLegacyCaptureContract(contract) {
  const keys = [
    "contractVersion",
    "sourceCommit",
    "sourceDirectory",
    "outputDirectory",
    "sourceLockSha256",
    "captureEntry",
    "captureEntrySha256",
    "bundleSha256",
    "bundleFile",
    "maximumBundleBytes",
    "maximumManifestBytes",
    "manifestSha256",
  ];
  if (
    !contract ||
    Object.keys(contract).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(contract, key))
  )
    throw new Error("The exact historical capture contract is unavailable.");
  if (
    contract?.contractVersion !== 1 ||
    contract.sourceCommit !== LEGACY_AI_SOURCE_COMMIT ||
    contract.sourceDirectory !== ".cache/legacy-ai-a979e325" ||
    contract.outputDirectory !== ".cache/legacy-ai-receipt-closure-v1" ||
    contract.bundleFile !== LEGACY_AI_BUNDLE_FILE ||
    contract.sourceLockSha256 !==
      "90175d72e7a150502c8438453d163e6e8837678fbf12a4d75d3aff5c15b24ca1" ||
    contract.captureEntry !==
      "apps/api/src/adapters/persistence/fixtures/legacy-ai-receipt-capture.mjs" ||
    !/^[a-f0-9]{64}$/u.test(contract.captureEntrySha256 ?? "") ||
    (contract.bundleSha256 !== null &&
      !/^[a-f0-9]{64}$/u.test(contract.bundleSha256 ?? "")) ||
    (contract.manifestSha256 !== null &&
      !/^[a-f0-9]{64}$/u.test(contract.manifestSha256 ?? "")) ||
    contract.maximumBundleBytes !== 33554432 ||
    contract.maximumManifestBytes !== 1048576
  )
    throw new Error("The exact historical capture contract is unavailable.");
  return contract;
}
function run(command, args, cwd, env, capture = false) {
  const commandArgs =
    command === "git" ? ["-c", "core.longpaths=true", ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error("Historical closure preparation command failed.", {
      cause: result.error,
    });
  return result.stdout?.trim() ?? "";
}
function requireCleanHistoricalSource(sourceRoot, environment) {
  run(
    "git",
    ["diff", "--exit-code", "HEAD", "--"],
    sourceRoot,
    environment,
    true,
  );
  if (
    run(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      sourceRoot,
      environment,
      true,
    )
  )
    throw new Error("Historical source contains unreviewed files.");
}
async function ensureOwnedOutputDirectory(rootPath, target) {
  requireLegacyOwnedPath(rootPath, target);
  let current = rootPath;
  for (const segment of relative(rootPath, target).split(sep)) {
    current = resolve(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const stat = await lstat(current);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await realpath(current)) !== current
    )
      throw new Error("Historical output directory redirected.");
  }
}
async function writeOwnedFile(file, bytes) {
  try {
    const stat = await lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (await realpath(file)) !== file
    )
      throw new Error(
        "Historical output must not redirect outside its owned directory.",
      );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await writeFile(file, bytes);
}
function buildEnvironment(environment) {
  const keys = [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "PNPM_HOME",
    "COREPACK_HOME",
    "XDG_CACHE_HOME",
    "LOCALAPPDATA",
    "APPDATA",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
  ];
  return {
    ...Object.fromEntries(
      keys
        .filter((key) => environment[key] !== undefined)
        .map((key) => [key, environment[key]]),
    ),
    CI: "true",
    HUSKY: "0",
    NODE_ENV: "development",
    AWS_EC2_METADATA_DISABLED: "true",
  };
}
async function regularBytes(file, maximum) {
  const stat = await lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size === 0 ||
    stat.size > maximum
  )
    throw new Error("Historical closure file is not a bounded regular file.");
  return readFile(file);
}

export function parseLegacyPreparationArguments(args) {
  if (
    args.length > 1 ||
    (args.length === 1 &&
      !["--capture-candidate", "--fetch-dependencies"].includes(args[0]))
  )
    throw new Error("Unknown historical preparation arguments.");
  return {
    captureCandidate: args[0] === "--capture-candidate",
    fetchDependencies: args[0] === "--fetch-dependencies",
  };
}

/** Offline by default. CI may explicitly fetch the verified lock's packages
 * before the offline build. No source fetch, arbitrary ref, cloud credential,
 * provider call or per-test build. CI supplies the exact historical checkout. */
export async function prepareLegacyAiReceiptClosure({
  captureCandidate = false,
  fetchDependencies = false,
} = {}) {
  if (fetchDependencies && captureCandidate)
    throw new Error(
      "Dependency fetching requires the admitted historical pins.",
    );
  const contract = validateLegacyCaptureContract(
    JSON.parse(await readFile(contractPath, "utf8")),
  );
  const sourceRoot = resolve(root, contract.sourceDirectory);
  const outputRoot = resolve(root, contract.outputDirectory);
  requireLegacyOwnedPath(resolve(root, ".cache"), sourceRoot);
  requireLegacyOwnedPath(resolve(root, ".cache"), outputRoot);
  const actualSource = await realpath(sourceRoot);
  if (actualSource !== sourceRoot)
    throw new Error(
      "Historical source must not redirect to another workspace.",
    );
  const environment = buildEnvironment(process.env);
  if (
    run("git", ["rev-parse", "HEAD"], sourceRoot, environment, true) !==
    LEGACY_AI_SOURCE_COMMIT
  )
    throw new Error("Historical source is not the exact reviewed commit.");
  requireCleanHistoricalSource(sourceRoot, environment);
  const credentials = spawnSync(
    "git",
    ["config", "--local", "--get-regexp", "http.*extraheader"],
    {
      cwd: sourceRoot,
      env: environment,
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer: 65536,
    },
  );
  if (
    credentials.error ||
    (credentials.status !== 0 && credentials.status !== 1) ||
    credentials.stdout?.trim()
  )
    throw new Error("Historical checkout must not retain HTTP credentials.");
  const lock = await regularBytes(
    resolve(sourceRoot, "pnpm-lock.yaml"),
    2 * 1024 * 1024,
  );
  if (sha256(lock) !== contract.sourceLockSha256)
    throw new Error("Historical lockfile changed.");
  const recipe = await regularBytes(
    resolve(root, contract.captureEntry),
    65536,
  );
  if (sha256(recipe) !== contract.captureEntrySha256)
    throw new Error("Historical capture recipe changed.");
  const pnpmCli = process.env.npm_execpath;
  if (
    !pnpmCli ||
    run(process.execPath, [pnpmCli, "--version"], root, environment, true) !==
      "11.16.0"
  )
    throw new Error(
      "Run legacy preparation through the pinned pnpm11.16.0 command.",
    );
  if (fetchDependencies) {
    // Current security pins can differ from the immutable historical lock.
    // Populate its store explicitly instead of depending on a warm runner cache.
    run(
      process.execPath,
      [pnpmCli, "fetch", "--ignore-scripts"],
      sourceRoot,
      environment,
    );
    requireCleanHistoricalSource(sourceRoot, environment);
    if (
      sha256(
        await regularBytes(
          resolve(sourceRoot, "pnpm-lock.yaml"),
          2 * 1024 * 1024,
        ),
      ) !== contract.sourceLockSha256
    )
      throw new Error("Historical lockfile changed.");
  }
  run(
    process.execPath,
    [pnpmCli, "install", "--offline", "--frozen-lockfile"],
    sourceRoot,
    environment,
  );
  // Remove only verified build-output directories inside the exact owned source.
  const manifests = run(
    "git",
    ["ls-files", "apps/*/package.json", "packages/*/package.json"],
    sourceRoot,
    environment,
    true,
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  for (const manifest of manifests) {
    const output = requireLegacyOwnedPath(
      sourceRoot,
      resolve(sourceRoot, dirname(manifest), "dist"),
    );
    try {
      const stat = await lstat(output);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (await realpath(output)) !== output
      )
        throw new Error(
          "Historical build output redirected outside its package.",
        );
      await rm(output, { recursive: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  run(
    process.execPath,
    [
      pnpmCli,
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@cloudmarkup/api...",
      "--force",
    ],
    sourceRoot,
    environment,
  );
  requireCleanHistoricalSource(sourceRoot, environment);
  const requireOld = createRequire(
    resolve(sourceRoot, "infra/platform/package.json"),
  );
  const esbuildPath = await realpath(requireOld.resolve("esbuild"));
  requireLegacyOwnedPath(sourceRoot, esbuildPath);
  const { build, version } = await import(pathToFileURL(esbuildPath).href);
  const entryRoot = resolve(sourceRoot, "apps/api/.cache/legacy-ai-capture");
  await mkdir(entryRoot, { recursive: true });
  if ((await realpath(entryRoot)) !== entryRoot)
    throw new Error("Historical capture entry directory redirected.");
  const entry = resolve(entryRoot, "capture.mjs");
  await writeOwnedFile(entry, recipe);
  const result = await build({
    absWorkingDir: sourceRoot,
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    packages: "bundle",
    external: ["vitest"],
    write: false,
    metafile: true,
    outfile: "legacy-capture.mjs",
    sourcemap: false,
    legalComments: "none",
    plugins: [
      {
        name: "owned-historical-modules",
        setup(builder) {
          builder.onLoad({ filter: /.*/, namespace: "file" }, async (args) => {
            const actual = await realpath(args.path);
            requireLegacyOwnedPath(sourceRoot, actual);
            await regularBytes(actual, contract.maximumBundleBytes);
            return undefined;
          });
        },
      },
    ],
    banner: {
      js: LEGACY_AI_CAPTURE_REQUIRE_BANNER,
    },
  });
  const inputs = validateLegacyCaptureMetafile(
    result.metafile,
    sourceRoot,
    entry,
  );
  const sourceFiles = [];
  for (const name of inputs) {
    const file = resolve(sourceRoot, name),
      actual = await realpath(file);
    requireLegacyOwnedPath(sourceRoot, actual);
    const bytes = await regularBytes(actual, contract.maximumBundleBytes);
    sourceFiles.push({
      path: name.replaceAll("\\", "/"),
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  const assets = [];
  for (const descriptor of LEGACY_AI_FIXTURE_ASSETS) {
    const source = resolve(sourceRoot, descriptor.path);
    if ((await realpath(source)) !== source)
      throw new Error("Historical fixture source redirected.");
    const assetBytes = await regularBytes(source, descriptor.sizeBytes);
    if (
      assetBytes.length !== descriptor.sizeBytes ||
      sha256(assetBytes) !== descriptor.sha256
    )
      throw new Error("Exact historical fixture bytes changed.");
    if (sourceFiles.some((file) => file.path === descriptor.path))
      throw new Error("Historical fixture input is duplicated.");
    sourceFiles.push({ ...descriptor });
    assets.push({ descriptor, bytes: assetBytes });
  }
  if (result.outputFiles.length !== 1)
    throw new Error("Historical capture must be one closed bundle.");
  const bytes = result.outputFiles[0].contents;
  if (bytes.length === 0 || bytes.length > contract.maximumBundleBytes)
    throw new Error("Historical bundle exceeds its bound.");
  const digest = sha256(bytes);
  const metadata = {
    contractVersion: 1,
    sourceCommit: LEGACY_AI_SOURCE_COMMIT,
    sourceLockSha256: contract.sourceLockSha256,
    captureEntrySha256: contract.captureEntrySha256,
    esbuildVersion: version,
    bundle: {
      file: contract.bundleFile,
      sizeBytes: bytes.length,
      sha256: digest,
    },
    inputs: sourceFiles,
    assets: assets.map((asset) => asset.descriptor),
  };
  const metadataBytes = Buffer.from(JSON.stringify(metadata, null, 2) + "\n");
  if (metadataBytes.length > contract.maximumManifestBytes)
    throw new Error("Historical capture inventory exceeds its bound.");
  await mkdir(outputRoot, { recursive: true });
  if ((await realpath(outputRoot)) !== outputRoot)
    throw new Error("Historical capture output redirected.");
  const bundlePath = resolve(outputRoot, contract.bundleFile);
  await ensureOwnedOutputDirectory(outputRoot, dirname(bundlePath));
  await writeOwnedFile(bundlePath, bytes);
  for (const asset of assets) {
    const target = resolve(outputRoot, asset.descriptor.path);
    await ensureOwnedOutputDirectory(outputRoot, dirname(target));
    await writeOwnedFile(target, asset.bytes);
  }
  await writeOwnedFile(resolve(outputRoot, "manifest.json"), metadataBytes);
  if (
    !captureCandidate &&
    (digest !== contract.bundleSha256 ||
      sha256(metadataBytes) !== contract.manifestSha256)
  )
    throw new Error(
      "Historical bundle is not the reviewed reproduced byte pin.",
    );
  const admitted =
    digest === contract.bundleSha256 &&
    sha256(metadataBytes) === contract.manifestSha256;
  if (admitted) {
    if (sha256(metadataBytes) !== LEGACY_CLOCK_V2_CONTRACT.baseManifestSha256)
      throw new Error(
        "Historical clock adapter requires its exact V1 manifest.",
      );
    const adapted = createLegacyClockAdapterV2(Buffer.from(bytes));
    await writeOwnedFile(
      resolve(outputRoot, LEGACY_CLOCK_V2_CONTRACT.bundleFile),
      adapted,
    );
  }
  return {
    sourceCommit: LEGACY_AI_SOURCE_COMMIT,
    sha256: digest,
    manifestSha256: sha256(metadataBytes),
    sizeBytes: bytes.length,
    inputs: sourceFiles.length,
    assets: assets.length,
    admitted,
    syntheticClockAdapter: admitted
      ? {
          contractVersion: 2,
          bundleFile: LEGACY_CLOCK_V2_CONTRACT.bundleFile,
          sha256: LEGACY_CLOCK_V2_CONTRACT.bundleSha256,
        }
      : null,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await prepareLegacyAiReceiptClosure(
    parseLegacyPreparationArguments(process.argv.slice(2)),
  );
  process.stdout.write(JSON.stringify(result) + "\n");
}
