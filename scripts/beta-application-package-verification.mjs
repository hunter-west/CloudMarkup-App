/** Opt-in genuine Linux candidate verification. Uses synthetic generation inputs,
 * actual acquired bytes, actual isolated tools and the public package runner.
 * Does not call AI, publish an image, deploy, or issue release admission. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";

const sha256 = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const safeName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
// Fixed partitions cover all candidate families within bounded CI jobs.
// They select synthetic acceptance cases only, never runtime authority.
export const candidatePackageGroups = Object.freeze({
  "http-and-storage": Object.freeze([
    "notes",
    "notes-crud",
    "sqs-consumer-dlq",
    "s3-image-metadata",
  ]),
  events: Object.freeze([
    "sns-fanout-consumer",
    "eventbridge-scheduled",
    "eventbridge-target",
    "step-functions-task",
  ]),
});
export function candidatePackagePatterns(group = "all") {
  if (group === "all") return Object.values(candidatePackageGroups).flat();
  if (!Object.hasOwn(candidatePackageGroups, group))
    throw new Error("Unknown fixed candidate package group.");
  return [...candidatePackageGroups[group]];
}
function requireValue(value, message) {
  if (!value) throw new Error(message);
}
function command(executable, args, timeout = 120000) {
  return execFileSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout,
    windowsHide: true,
  }).trim();
}
export async function verifiedTarballs(lock) {
  const entries = Object.entries(lock.packages);
  requireValue(
    entries.length > 0 && entries.length <= 512,
    "Closed dependency inventory required.",
  );
  let index = 0;
  const result = [];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (index < entries.length) {
        const [key, metadata] = entries[index++];
        const split = key.lastIndexOf("@");
        const name = key.slice(0, split),
          version = key.slice(split + 1);
        requireValue(
          safeName.test(name) && /^[0-9A-Za-z.+-]+$/u.test(version),
          "Noncanonical locked package identity.",
        );
        const url = `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(60000),
        });
        requireValue(
          response.ok && response.body !== null,
          "Public locked tarball acquisition failed.",
        );
        const chunks = [];
        let sizeBytes = 0;
        for await (const chunk of response.body) {
          sizeBytes += chunk.byteLength;
          requireValue(
            sizeBytes <= 40000000,
            "Locked tarball exceeds acquisition limit.",
          );
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        const integrity =
          "sha512-" + createHash("sha512").update(bytes).digest("base64");
        requireValue(
          integrity === metadata.resolution.integrity,
          "Acquired tarball differs from locked SRI.",
        );
        result.push({
          name,
          version,
          integrity,
          tarballDigest: sha256(bytes),
          sizeBytes,
          url,
        });
      }
    }),
  );
  return result.sort((a, b) => {
    const left = a.name + "\u0000" + a.version,
      right = b.name + "\u0000" + b.version;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
export function generationLock(source, manifest) {
  const lock = parse(source),
    original = lock.importers["."],
    selected = {};
  for (const kind of ["dependencies", "devDependencies"]) {
    selected[kind] = {};
    for (const [name, version] of Object.entries(manifest[kind] ?? {})) {
      const pinned =
        original.dependencies?.[name] ?? original.devDependencies?.[name];
      requireValue(
        pinned?.specifier === version,
        "Generated dependency is not in the exact acquired toolchain lock.",
      );
      selected[kind][name] = pinned;
    }
  }
  lock.importers = { ".": selected };
  return { lock, content: stringify(lock) };
}
export function runtimeClosure(contract, lock) {
  const runtime = new Set();
  function visit(name, version) {
    const key = name + "@" + version;
    if (runtime.has(key)) return;
    runtime.add(key);
    const snapshot = lock.snapshots[key];
    requireValue(
      snapshot !== undefined &&
        Object.keys(snapshot.optionalDependencies ?? {}).length === 0,
      "Unreviewed optional or absent runtime snapshot.",
    );
    for (const [child, pinned] of Object.entries(snapshot.dependencies ?? {}))
      visit(child, pinned);
  }
  for (const dependency of contract.dependencies.filter(
    (entry) => entry.kind === "runtime",
  ))
    visit(dependency.name, dependency.version);
  return runtime;
}
export async function runBetaApplicationPackageVerification({
  repositoryRoot,
  runtimeRoot,
  outputRoot,
  dockerExecutable,
  group = "all",
}) {
  const requiredPatterns = candidatePackagePatterns(group);
  requireValue(
    process.platform === "linux" && process.getuid?.() > 0,
    "Actual package verification requires an unprivileged Linux host.",
  );
  const repo = resolve(repositoryRoot),
    context = resolve(runtimeRoot, "application-build"),
    output = resolve(outputRoot);
  requireValue(
    output.startsWith(repo + "/.cache/") && output !== context,
    "Fresh repository cache output required.",
  );
  await mkdir(output, { recursive: true });
  requireValue(
    (await readdir(output)).length === 0,
    "Output directory must be empty.",
  );
  const image = "cloudmarkup-application-build";
  command(
    dockerExecutable,
    [
      "build",
      "--network=none",
      "--platform=linux/amd64",
      "--tag",
      image + ":package-candidate",
      context,
    ],
    1200000,
  );
  const inspected = JSON.parse(
    command(dockerExecutable, [
      "image",
      "inspect",
      image + ":package-candidate",
    ]),
  )[0];
  const references = inspected.RepoDigests.filter((entry) =>
    entry.startsWith(image + "@sha256:"),
  );
  requireValue(
    references.length === 1,
    "Exact locally built image digest required; enable the containerd image store on the ephemeral Linux runner.",
  );
  const reference = references[0],
    digest = reference.slice(image.length + 1);
  const toolPaths = {
    node: "/usr/local/bin/node",
    pnpm: "/opt/cloudmarkup/toolchain/pnpm-runtime/dist/pnpm.mjs",
    typescript: "/opt/cloudmarkup/toolchain/node_modules/typescript/lib/tsc.js",
    vitest: "/opt/cloudmarkup/toolchain/node_modules/vitest/vitest.mjs",
    trivy: "/opt/cloudmarkup/toolchain/bin/trivy",
  };
  const inspectCode = `const fs=require('fs'),crypto=require('crypto');console.log(JSON.stringify(Object.fromEntries(Object.entries(${JSON.stringify(toolPaths)}).map(([name,path])=>[name,'sha256:'+crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')]))));`;
  const pins = JSON.parse(
    command(dockerExecutable, [
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
      "--entrypoint",
      "node",
      reference,
      "-e",
      inspectCode,
    ]),
  );
  const moduleBase = pathToFileURL(resolve(repo, "apps/api/package.json")).href;
  const load = (name) => import(import.meta.resolve(name, moduleBase));
  const api = await load("@cloudmarkup/application-build-runner");
  const generator = await load("@cloudmarkup/application-generator");
  const fixtures = await load("@cloudmarkup/application-generator/testing");
  const inputs = JSON.parse(
    await readFile(resolve(context, "image-inputs-v1.json"), "utf8"),
  );
  const sourceLockBytes = await readFile(
    resolve(context, "offline/toolchain/pnpm-lock.yaml"),
  );
  requireValue(
    inputs.bindings.toolchainLockfile.path ===
      "offline/toolchain/pnpm-lock.yaml" &&
      sourceLockBytes.length === inputs.bindings.toolchainLockfile.sizeBytes &&
      sha256(sourceLockBytes) ===
        "sha256:" + inputs.bindings.toolchainLockfile.sha256,
    "Materialized toolchain lock differs from reviewed image inputs.",
  );
  const repositoryLock = await readFile(resolve(repo, "pnpm-lock.yaml"));
  requireValue(
    repositoryLock.length === inputs.bindings.repositoryLockfile.sizeBytes &&
      sha256(repositoryLock) ===
        "sha256:" + inputs.bindings.repositoryLockfile.sha256,
    "Repository lock differs from reviewed image inputs.",
  );
  const sourceLock = sourceLockBytes.toString("utf8");
  const tarballs = await verifiedTarballs(parse(sourceLock));
  await writeFile(
    resolve(output, "actual-tarball-digests.json"),
    JSON.stringify({
      observedAt: new Date().toISOString(),
      packages: tarballs,
    }),
  );
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
  const tool = (id, version, digest) => ({ id, version, digest });
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
  const profileBody = {
    id: "cloudmarkup.application-build.generated-nodejs24",
    sourcePolicy: "generated-only",
    version: "1.0.0",
  };
  const profile = {
    ...profileBody,
    digest: sha256(api.canonicalJson(profileBody)),
  };
  const observations = [];
  for (const pattern of requiredPatterns) {
    const generationRequest =
      pattern === "notes"
        ? fixtures.createNotesGenerationRequest()
        : pattern === "notes-crud"
          ? fixtures.createNotesGenerationRequest({
              operations: ["create", "read", "update", "delete"],
            })
          : fixtures.createEventGenerationRequest({ pattern });
    const generation = generator.generateApplication(generationRequest);
    const envelope = generation.artifact.buildContracts[0];
    requireValue(
      envelope !== undefined,
      "Actual generated build contract required.",
    );
    const manifest = generation.artifact.sourceFiles.find(
      (file) => file.path === "application/package.json",
    );
    requireValue(
      manifest !== undefined,
      "Actual generated package manifest required.",
    );
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
    const policy = api.applicationBuildPolicyV1Schema.parse({
      contractVersion: 1,
      builder: tool(
        "cloudmarkup.application-builder",
        "1.0.0",
        sha256(api.canonicalJson(closure)),
      ),
      container: {
        image,
        digest,
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
    const start = performance.now();
    const result = await api
      .createApplicationBuildRunner({
        executor: api.createLocalApplicationBuildContainerExecutor({
          containerRuntimeExecutable: dockerExecutable,
          policy,
        }),
        policy,
      })
      .run(request);
    // This full report is from execution, includes only synthetic generation
    // content, and remains distinct from hosted AI evaluation or release approval.
    await writeFile(resolve(output, pattern + ".json"), JSON.stringify(result));
    const artifactMetadata = [];
    for (const artifact of result.artifacts) {
      const bytes = Buffer.from(artifact.bytesBase64, "base64");
      requireValue(
        sha256(bytes) === artifact.checksum,
        "Actual artifact checksum mismatch.",
      );
      artifactMetadata.push({
        path: artifact.path,
        checksum: artifact.checksum,
        sizeBytes: bytes.length,
        mediaType: artifact.mediaType,
      });
    }
    const observation = {
      pattern,
      state: result.state,
      seconds: (performance.now() - start) / 1000,
      requestDigest: api.applicationBuildRequestDigest(request),
      reportDigest: result.reportDigest,
      artifacts: artifactMetadata,
      tests: result.tests,
      diagnostics: result.diagnostics,
    };
    observations.push(observation);
    console.log(JSON.stringify(observation));
    await writeFile(
      resolve(output, "candidate-package-summary.json"),
      JSON.stringify(
        {
          recordKind: "actual-linux-candidate-package-verification",
          sourceAuthority:
            "deterministic-generator-with-actual-container-tools",
          releaseAdmission: "not-issued",
          hostedAiEvidence: false,
          verificationGroup: group,
          requiredPatterns,
          image: reference,
          toolPaths,
          pins,
          builderClosure: closure,
          observations,
        },
        null,
        2,
      ),
    );
  }
  requireValue(
    observations.length === requiredPatterns.length &&
      observations.every(
        (entry) =>
          entry.state === "passed" &&
          entry.artifacts.some(
            (artifact) => artifact.mediaType === "application/zip",
          ),
      ),
    "Actual Linux package verification failed; preserve all reports and do not publish a passing claim.",
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [runtimeRoot, outputRoot, group = "all"] = process.argv.slice(2);
  if (!runtimeRoot || !outputRoot || process.argv.length > 5)
    throw new Error(
      "Usage: node --experimental-import-meta-resolve scripts/beta-application-package-verification.mjs <tar-derived-runtime-root> <empty-output-dir> [all|http-and-storage|events]",
    );
  await runBetaApplicationPackageVerification({
    repositoryRoot: process.cwd(),
    runtimeRoot,
    outputRoot,
    group,
    dockerExecutable: command("which", ["docker"]),
  });
}
