/** Opt-in native Linux proof over the fixed public notes fixture. Candidate and
 * package bytes stay in RAM; only closed observation metadata is retained. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import {
  generationLock,
  runtimeClosure,
  verifiedTarballs,
} from "./beta-application-package-verification.mjs";
import {
  createMemoryProofCheckpoint,
  encodeMemoryProofFailure,
  memoryProofCommandFailure,
} from "./memory-proof-diagnostics.mjs";
import { prepareMemoryApplicationImage } from "./prepare-memory-application-image.mjs";
import { extractMemoryImageLayout } from "./memory-image-layout.mjs";

const sha256 = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const maximumInputBytes = 256 * 1024 * 1024;
const tool = (id, version, digest) => ({ id, version, digest });
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
function requireValue(value) {
  if (!value)
    throw new TypeError("Exact native memory proof inputs are required.");
}
export function exactMemoryImageReference(inspected, name) {
  requireValue(
    Array.isArray(inspected) &&
      inspected.length === 1 &&
      /^[a-z0-9][a-z0-9._-]{1,100}$/u.test(name),
  );
  const references = inspected[0]?.RepoDigests;
  requireValue(Array.isArray(references));
  const selected = references.filter(
    (entry) =>
      typeof entry === "string" &&
      entry.startsWith(name + "@") &&
      digestPattern.test(entry.slice(name.length + 1)),
  );
  requireValue(selected.length === 1);
  return selected[0];
}
function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function memoryProofArtifactPaths(zipPath) {
  requireValue(
    typeof zipPath === "string" &&
      /^application\/artifacts\/[A-Za-z0-9._/-]+\/function\.zip$/u.test(
        zipPath,
      ) &&
      !zipPath
        .split("/")
        .some((part) => part === "." || part === ".." || part === ""),
  );
  return [
    zipPath,
    zipPath.replace(/\/function\.zip$/u, "/artifact-manifest.json"),
    zipPath
      .replace("application/artifacts/", "application/evidence/")
      .replace(/\/function\.zip$/u, "/sbom.cdx.json"),
  ];
}
export function requireMemoryProofObservation(value, expected) {
  requireValue(
    exactKeys(value, [
      "kind",
      "requestDigest",
      "solutionRevisionDigest",
      "candidateBundleDigest",
      "sourceTreeDigest",
      "image",
      "helperDigest",
      "reports",
      "artifacts",
      "exactCleanupVerified",
      "reproducibleArtifactBytes",
    ]),
  );
  requireValue(
    value.kind === "cloudmarkup.application-memory-runner-observation.v1" &&
      value.requestDigest === expected.requestDigest &&
      value.solutionRevisionDigest === expected.solutionRevisionDigest &&
      value.image === expected.image &&
      value.helperDigest === expected.helperDigest &&
      value.candidateBundleDigest === null &&
      value.sourceTreeDigest === null &&
      value.exactCleanupVerified === true &&
      value.reproducibleArtifactBytes === true &&
      Array.isArray(value.reports) &&
      value.reports.length === 2 &&
      value.reports.every(
        (digest) => typeof digest === "string" && digestPattern.test(digest),
      ) &&
      Array.isArray(value.artifacts) &&
      Array.isArray(expected.artifactPaths) &&
      expected.artifactPaths.length === 3 &&
      new Set(expected.artifactPaths).size === 3 &&
      value.artifacts.length === expected.artifactPaths.length,
  );
  const paths = new Set();
  for (const artifact of value.artifacts) {
    requireValue(
      exactKeys(artifact, ["path", "checksum", "sizeBytes"]) &&
        typeof artifact.path === "string" &&
        artifact.path.length <= 256 &&
        /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(artifact.path) &&
        expected.artifactPaths.includes(artifact.path) &&
        !artifact.path
          .split("/")
          .some((part) => part === ".." || part === "" || part === ".") &&
        !paths.has(artifact.path) &&
        digestPattern.test(artifact.checksum) &&
        Number.isSafeInteger(artifact.sizeBytes) &&
        artifact.sizeBytes > 0 &&
        artifact.sizeBytes <= 67108864,
    );
    paths.add(artifact.path);
  }
  return structuredClone(value);
}
function cachePath(root, path) {
  requireValue(isAbsolute(path));
  const local = relative(resolve(root, ".cache"), path);
  requireValue(
    local !== "" &&
      local !== ".." &&
      !local.startsWith(".." + sep) &&
      !isAbsolute(local),
  );
  return resolve(path);
}
export function runMemoryProofCommand(
  executable,
  args,
  {
    input,
    timeout = 120000,
    maximum = 8 * 1024 * 1024,
    proof = false,
    imageBuild = false,
  } = {},
) {
  try {
    return execFileSync(executable, args, {
      ...(input === undefined ? {} : { input }),
      encoding: "utf8",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      maxBuffer: maximum,
      windowsHide: true,
      cwd: repositoryRoot,
      env: {
        PATH: process.env.PATH,
        ...(proof ? { CLOUDMARKUP_MEMORY_RUNNER_VERIFY: "1" } : {}),
      },
    }).trim();
  } catch (error) {
    // Only a closed child diagnostic can cross this boundary.
    throw memoryProofCommandFailure(error, proof, imageBuild);
  }
}
export async function prepareBetaMemoryApplicationTools({
  runtimeRoot,
  outputRoot,
  dockerExecutable,
}) {
  const checkpoint = createMemoryProofCheckpoint();
  try {
    const repo = repositoryRoot;
    const moduleBase = pathToFileURL(
      resolve(repo, "apps/api/package.json"),
    ).href;
    const load = (name) => import(import.meta.resolve(name, moduleBase));
    const api = await load("@cloudmarkup/application-build-runner");
    requireValue(
      process.platform === "linux" &&
        process.getuid?.() > 0 &&
        isAbsolute(dockerExecutable),
    );
    checkpoint.enter("host-admission");
    await api.assertMemoryApplicationBuildHost();
    checkpoint.enter("source-admission");
    const sourceCommit = runMemoryProofCommand("git", ["rev-parse", "HEAD"]);
    requireValue(
      /^[a-f0-9]{40}$/u.test(sourceCommit) &&
        runMemoryProofCommand("git", [
          "status",
          "--porcelain",
          "--untracked-files=normal",
        ]) === "",
    );
    const context = resolve(cachePath(repo, runtimeRoot), "application-build");
    const output = cachePath(repo, outputRoot);
    requireValue(output !== context);
    await mkdir(output, { recursive: false });
    const baseName = "cloudmarkup-application-memory-base";
    checkpoint.enter("base-image-build");
    runMemoryProofCommand(
      dockerExecutable,
      [
        "build",
        "--network=none",
        "--pull=false",
        "--platform=linux/amd64",
        "--tag",
        baseName + ":candidate",
        context,
      ],
      { timeout: 1200000, imageBuild: true },
    );
    checkpoint.enter("base-image-identity");
    const baseInspection = JSON.parse(
      runMemoryProofCommand(dockerExecutable, [
        "image",
        "inspect",
        baseName + ":candidate",
      ]),
    );
    const baseImage = exactMemoryImageReference(baseInspection, baseName);
    checkpoint.enter("helper-preparation");
    const baseArchive = resolve(output, "trusted-base-image.tar");
    runMemoryProofCommand(
      dockerExecutable,
      ["image", "save", "--output", baseArchive, baseImage],
      { timeout: 120000 },
    );
    const baseContext = await extractMemoryImageLayout(
      baseArchive,
      resolve(output, "trusted-base-layout"),
      baseImage,
    );
    await unlink(baseArchive);
    const prepared = await prepareMemoryApplicationImage({
      repositoryRoot: repo,
      output: resolve(output, "trusted-helper-context"),
      baseImage,
      localContext: true,
    });
    const image = "cloudmarkup-application-memory-proof";
    checkpoint.enter("helper-image-build");
    runMemoryProofCommand(
      dockerExecutable,
      [
        "build",
        "--network=none",
        "--pull=false",
        "--platform=linux/amd64",
        "--tag",
        image + ":candidate",
        "--build-context",
        "cloudmarkup-memory-base=" + baseContext,
        resolve(output, "trusted-helper-context"),
      ],
      { timeout: 120000, imageBuild: true },
    );
    checkpoint.enter("helper-image-identity");
    const reference = exactMemoryImageReference(
      JSON.parse(
        runMemoryProofCommand(dockerExecutable, [
          "image",
          "inspect",
          image + ":candidate",
        ]),
      ),
      image,
    );
    checkpoint.enter("tool-pins");
    const toolPaths = {
      node: "/usr/local/bin/node",
      pnpm: "/opt/cloudmarkup/toolchain/pnpm-runtime/dist/pnpm.mjs",
      typescript:
        "/opt/cloudmarkup/toolchain/node_modules/typescript/lib/tsc.js",
      vitest: "/opt/cloudmarkup/toolchain/node_modules/vitest/vitest.mjs",
      trivy: "/opt/cloudmarkup/toolchain/bin/trivy",
      helper: "/opt/cloudmarkup/service/memory-workspace-v1.mjs",
    };
    const inspection = `const fs=require('fs'),crypto=require('crypto');console.log(JSON.stringify(Object.fromEntries(Object.entries(${JSON.stringify(toolPaths)}).map(([name,path])=>[name,'sha256:'+crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')]))));`;
    const pins = JSON.parse(
      runMemoryProofCommand(dockerExecutable, [
        "run",
        "--rm",
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--user",
        "65532:65532",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--log-driver",
        "none",
        "--memory",
        "256m",
        "--memory-swap",
        "256m",
        "--pids-limit",
        "32",
        "--cpus",
        "1",
        "--ulimit",
        "core=0:0",
        "--entrypoint",
        "/usr/local/bin/node",
        reference,
        "-e",
        inspection,
      ]),
    );
    requireValue(
      exactKeys(pins, Object.keys(toolPaths)) &&
        Object.values(pins).every(
          (pin) => typeof pin === "string" && digestPattern.test(pin),
        ) &&
        pins.helper === prepared.helperDigest,
    );
    checkpoint.enter("locked-inputs");
    const inputs = JSON.parse(
      await readFile(resolve(context, "image-inputs-v1.json"), "utf8"),
    );
    const sourceLockBytes = await readFile(
      resolve(context, "offline/toolchain/pnpm-lock.yaml"),
    );
    requireValue(
      inputs.bindings.toolchainLockfile.path ===
        "offline/toolchain/pnpm-lock.yaml" &&
        sourceLockBytes.length ===
          inputs.bindings.toolchainLockfile.sizeBytes &&
        sha256(sourceLockBytes) ===
          "sha256:" + inputs.bindings.toolchainLockfile.sha256,
    );
    const repositoryLock = await readFile(resolve(repo, "pnpm-lock.yaml"));
    requireValue(
      repositoryLock.length === inputs.bindings.repositoryLockfile.sizeBytes &&
        sha256(repositoryLock) ===
          "sha256:" + inputs.bindings.repositoryLockfile.sha256,
    );
    const sourceLock = sourceLockBytes.toString("utf8");
    checkpoint.enter("dependency-acquisition");
    const tarballs = await verifiedTarballs(parse(sourceLock));
    checkpoint.enter("builder-bindings");
    const dist = resolve(repo, "packages/application-build-runner/dist");
    const closure = await Promise.all(
      (await readdir(dist, { recursive: true }))
        .filter((path) => path.endsWith(".js"))
        .sort()
        .map(async (path) => ({
          path,
          digest: sha256(await readFile(resolve(dist, path))),
        })),
    );
    const cacheDigest = sha256(
      await readFile(resolve(context, "offline/pnpm-store/manifest-v1.json")),
    );
    const toolchain = [
      tool("runtime.nodejs", inputs.toolchain.node, pins.node),
      tool("package-manager.pnpm", inputs.toolchain.pnpm, pins.pnpm),
      tool("compiler.typescript", inputs.toolchain.typescript, pins.typescript),
      tool("test-runner.vitest", inputs.toolchain.vitest, pins.vitest),
      tool(
        "packager.cloudmarkup-lambda-zip",
        "1.0.0",
        sha256(await readFile(resolve(dist, "zip.js"))),
      ),
    ];
    return {
      repo,
      api,
      sourceCommit,
      output,
      baseImage,
      image,
      reference,
      pins,
      sourceLock,
      tarballs,
      closure,
      cacheDigest,
      toolchain,
      inputs,
    };
  } catch (error) {
    throw checkpoint.failure(error);
  }
}

export async function runBetaMemoryApplicationVerification(input) {
  const prepared = await prepareBetaMemoryApplicationTools(input);
  return verifyPreparedBetaMemoryApplication(input, prepared);
}

/** Trusted in-process composition; prepared tools never come from a CLI payload. */
export async function verifyPreparedBetaMemoryApplication(input, prepared) {
  const {
    repo,
    api,
    sourceCommit,
    output,
    baseImage,
    image,
    reference,
    pins,
    sourceLock,
    tarballs,
    closure,
    cacheDigest,
    toolchain,
    inputs,
  } = prepared;
  const { dockerExecutable } = input;
  const checkpoint = createMemoryProofCheckpoint();
  const moduleBase = pathToFileURL(resolve(repo, "apps/api/package.json")).href;
  const load = (name) => import(import.meta.resolve(name, moduleBase));
  try {
    const profileBody = {
      id: "cloudmarkup.application-build.generated-nodejs24",
      sourcePolicy: "generated-only",
      version: "1.0.0",
    };
    const profile = {
      ...profileBody,
      digest: sha256(api.canonicalJson(profileBody)),
    };
    const generator = await load("@cloudmarkup/application-generator");
    const fixtures = await load("@cloudmarkup/application-generator/testing");
    // Every environment/image/lock check above completes before source exists.
    await api.assertMemoryApplicationBuildHost();
    checkpoint.enter("candidate-generation");
    const generationRequest = fixtures.createNotesGenerationRequest();
    const generation = generator.generateApplication(generationRequest);
    const envelope = generation.artifact.buildContracts[0];
    const manifest = generation.artifact.sourceFiles.find(
      (file) => file.path === "application/package.json",
    );
    requireValue(envelope !== undefined && manifest !== undefined);
    const { lock, content } = generationLock(
      sourceLock,
      JSON.parse(manifest.content),
    );
    const runtime = runtimeClosure(envelope.contract, lock);
    const dependencies = envelope.contract.dependencies.map(
      ({ name, version, kind }) => ({ name, version, kind }),
    );
    const direct = new Map(
      dependencies.map((entry) => [
        entry.name + "@" + entry.version,
        entry.kind,
      ]),
    );
    const packages = tarballs.map(
      ({ name, version, integrity, tarballDigest }) => ({
        name,
        version,
        integrity,
        tarballDigest,
        kind:
          direct.get(name + "@" + version) ??
          (runtime.has(name + "@" + version)
            ? "transitive-runtime"
            : "transitive-development"),
      }),
    );
    checkpoint.enter("request-admission");
    const policy = api.applicationBuildPolicyV1Schema.parse({
      contractVersion: 1,
      builder: tool(
        "cloudmarkup.application-builder",
        "1.0.0",
        sha256(api.canonicalJson(closure)),
      ),
      container: {
        image,
        digest: reference.slice(image.length + 1),
        platform: "linux/amd64",
        pnpmStorePath: "/opt/cloudmarkup/pnpm-store",
      },
      dependencyCacheDigest: cacheDigest,
      defaultLimits: {
        cpuSeconds: 120,
        maxArtifactBytes: 67108864,
        maxFileBytes: 4194304,
        maxFiles: 20000,
        maxOutputBytes: 2097152,
        maxProcesses: 64,
        maxTotalFileBytes: 134217728,
        memoryMiB: 4096,
        wallTimeMilliseconds: 120000,
      },
      dependencyAllowlist: dependencies,
      dependencyDenylist: ["event-stream", "ua-parser-js"],
      profile,
      scanner: tool("aquasecurity.trivy", inputs.toolchain.trivy, pins.trivy),
      secretScanner: tool(
        "aquasecurity.trivy-secret",
        inputs.toolchain.trivy,
        pins.trivy,
      ),
      toolchain,
    });
    const request = api.applicationBuildRequestV1Schema.parse({
      assessedAt: new Date().toISOString(),
      contractVersion: 1,
      dependencyLock: {
        cache: {
          digest: cacheDigest,
          kind: "prepackaged-content-addressed",
          network: "deny",
        },
        contractVersion: 1,
        lifecycleScripts: "deny",
        lockfileChecksum: sha256(content),
        lockfileContent: content,
        lockfilePath: "application/pnpm-lock.yaml",
        packageManager: toolchain[1],
        packageManifestChecksum: manifest.checksum,
        packages,
      },
      environment: {
        environmentId: "environment.development",
        environmentType: "development",
      },
      limits: policy.defaultLimits,
      profile,
      solutionRevision: generationRequest.solutionRevision,
      solutionRevisionDigest: sha256(
        api.canonicalJson(generationRequest.solutionRevision),
      ),
      source: {
        applicationGeneration: generation,
        buildContractDigest: envelope.contractDigest,
        kind: "generated",
      },
    });
    const payload = Buffer.from(
      JSON.stringify({
        policy,
        request,
        helperDigest: pins.helper,
        // Frozen verified DB: 1,382,703,104 bytes; 512 MiB cannot hold it.
        // This bounded tmpfs stays within the existing 4 GiB container limit.
        cacheBytes: 1536 * 1024 * 1024,
      }),
    );
    requireValue(payload.length <= maximumInputBytes);
    checkpoint.enter("child-execution");
    const childObservation = JSON.parse(
      runMemoryProofCommand(
        process.execPath,
        [
          resolve(repo, "scripts/verify-memory-application-runner.mjs"),
          dockerExecutable,
        ],
        { input: payload, timeout: 1500000, maximum: 1024 * 1024, proof: true },
      ),
    );
    checkpoint.enter("observation-admission");
    const observation = requireMemoryProofObservation(childObservation, {
      requestDigest: api.applicationBuildRequestDigest(request),
      solutionRevisionDigest: request.solutionRevisionDigest,
      image: reference,
      helperDigest: pins.helper,
      artifactPaths: memoryProofArtifactPaths(
        envelope.contract.expectedArtifact.path,
      ),
    });
    const result = {
      contractVersion: 1,
      recordKind: "actual-linux-memory-application-proof",
      sourceAuthority: "fixed-public-generated-notes",
      sourceCommit,
      hostedAiEvidence: false,
      releaseAdmission: "not-issued",
      baseImage,
      image: reference,
      helperDigest: pins.helper,
      toolPins: pins,
      builderClosure: closure,
      dependencyCacheDigest: cacheDigest,
      observation,
    };
    checkpoint.enter("source-readback");
    requireValue(
      runMemoryProofCommand("git", ["rev-parse", "HEAD"]) === sourceCommit &&
        runMemoryProofCommand("git", [
          "status",
          "--porcelain",
          "--untracked-files=normal",
        ]) === "",
    );
    checkpoint.enter("retention");
    await writeFile(
      resolve(output, "memory-application-observation.json"),
      JSON.stringify(result, null, 2) + "\n",
      { flag: "wx" },
    );
    return result;
  } catch (error) {
    throw checkpoint.failure(error);
  }
}
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [runtimeRoot, outputRoot, dockerExecutable] = process.argv.slice(2);
  Promise.resolve()
    .then(() => {
      requireValue(
        process.argv.length === 5 &&
          runtimeRoot &&
          outputRoot &&
          dockerExecutable,
      );
      return runBetaMemoryApplicationVerification({
        runtimeRoot: resolve(runtimeRoot),
        outputRoot: resolve(outputRoot),
        dockerExecutable,
      });
    })
    .then((result) => {
      process.stdout.write(
        JSON.stringify({
          recordKind: result.recordKind,
          sourceCommit: result.sourceCommit,
          image: result.image,
          helperDigest: result.helperDigest,
          observation: result.observation,
        }) + "\n",
      );
    })
    .catch((error) => {
      process.stderr.write(encodeMemoryProofFailure(error));
      process.stderr.write(
        "Native Linux memory-only application proof failed; no completion evidence was issued.\n",
      );
      process.exitCode = 1;
    });
}
