import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// Only these public source commits and reviewed dependency patches may execute
// in the disposable builder. No descriptor can supply code, flags or a command.
const commonInputs = [
  {
    path: "Dockerfile",
    sizeBytes: 569,
    sha256: "00dbab0ee46d214ba09b765e81a1983696f99836de4f99e5d4aa598a00f1a3f8",
  },
  {
    path: "recipe.sh",
    sizeBytes: 3514,
    sha256: "9d5ce997ad07b5b5059ff3c2fb81a1b0f5e8d8d8d96b8b6060467f36abae1fae",
  },
];
const builds = {
  terraform: {
    source: {
      url: "https://codeload.github.com/hashicorp/terraform/tar.gz/82e042fb6372443813f6759056308d6adc642fa1",
      sizeBytes: 6002125,
      sha256:
        "4eb4a3e57f70c6aebd4cb52ce6bb6a8f046a769afdff53a4052799dd9e06f7ec",
    },
    binary: {
      sizeBytes: 120361086,
      sha256:
        "7c226d2a50158de8d8567e799f9dcadad9179ca4877202053ce2b1c55c8e0ee4",
    },
    license: {
      sizeBytes: 4950,
      sha256:
        "dc4cb9f6140970b69110d82e8f25545135965ae50f6761ddfd6cd7cf9452bfa9",
    },
    role: "terraform-cli",
  },
  tflint: {
    source: {
      url: "https://codeload.github.com/terraform-linters/tflint/tar.gz/15c65a33b322750f6131e286cd9597896299ba32",
      sizeBytes: 1399248,
      sha256:
        "cb4565109f6bc49b13d99526c4fd66aecb566549bfbd03256f0bb4c16665f4eb",
    },
    patch: {
      path: "patches/tflint.patch",
      sizeBytes: 13682,
      sha256:
        "33cee16539c4db9a8c0067bb50ae7a45cea76801d11ef4df3a878d31e30bc774",
    },
    binary: {
      sizeBytes: 54317182,
      sha256:
        "e4bf9780686a7715bcf277fada5659a1ca433bacf24289c23c75388979a34a66",
    },
    license: {
      sizeBytes: 16725,
      sha256:
        "1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5",
    },
    role: "terraform-linter",
  },
  trivy: {
    source: {
      url: "https://codeload.github.com/aquasecurity/trivy/tar.gz/e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994",
      sizeBytes: 56676456,
      sha256:
        "285594b257470eb444fd2836be95a835565ee600382320c977b3993d8efbb767",
    },
    patch: {
      path: "patches/trivy.patch",
      sizeBytes: 6834,
      sha256:
        "ef1f6ca694228f165949b8916f61f0131b1c688dd70f3cc047c29e39b0ef2edc",
    },
    binary: {
      sizeBytes: 168288382,
      sha256:
        "2f78848b474c6f0b27d0df1833ae8fc7d297640344c6d5c7a25f63cc9e22d3dc",
    },
    license: {
      sizeBytes: 11357,
      sha256:
        "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
    },
    role: "vulnerability-scanner",
  },
};

function authorityFor(tool) {
  if (typeof tool !== "string" || !Object.hasOwn(builds, tool)) {
    throw new Error(
      "CONTEXT_GO_TOOL_INVALID: tool is outside reviewed authority",
    );
  }
  return builds[tool];
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifyBytes(bytes, authority, label) {
  if (
    bytes.byteLength !== authority.sizeBytes ||
    digest(bytes) !== authority.sha256
  ) {
    throw new Error(
      `CONTEXT_GO_INPUT_DRIFT: ${label} differs from reviewed bytes`,
    );
  }
}

async function readBoundFile(root, path, authority) {
  const absolute = resolve(root, path);
  const resolved = await realpath(absolute);
  const relativePath = relative(await realpath(root), resolved);
  const metadata = await lstat(absolute);
  if (
    relativePath.startsWith(`..${sep}`) ||
    relativePath === ".." ||
    isAbsolute(relativePath) ||
    resolved !== absolute ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size !== authority.sizeBytes
  ) {
    throw new Error(
      `CONTEXT_GO_FILE_INVALID: ${path} must be one contained regular file`,
    );
  }
  const bytes = await readFile(absolute);
  verifyBytes(bytes, authority, path);
  return bytes;
}

export function reviewedGoSourceArtifact(tool) {
  const authority = authorityFor(tool);
  return {
    type: "https-go-source-v1",
    tool,
    ...structuredClone(authority.source),
    members: [
      {
        archivePath: tool,
        destination: `offline/bin/${tool}`,
        ...authority.binary,
        role: authority.role,
        executable: true,
        mode: "0755",
      },
      {
        archivePath: `${tool}-LICENSE.txt`,
        destination: `offline/licenses/${tool}-LICENSE.txt`,
        ...authority.license,
        role: `${tool}-license`,
        executable: false,
        mode: "0644",
      },
    ],
  };
}

export function assertReviewedGoSourceArtifact(artifact) {
  const expected = reviewedGoSourceArtifact(artifact?.tool);
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      );
    return value;
  };
  if (
    JSON.stringify(canonical(artifact)) !== JSON.stringify(canonical(expected))
  ) {
    throw new Error(
      "CONTEXT_GO_AUTHORITY_DRIFT: source, patch output or destination differs from reviewed authority",
    );
  }
}

export async function readReviewedGoBuildInputs(repositoryRoot, tool) {
  const authority = authorityFor(tool);
  const root = resolve(repositoryRoot, "infra/images/go-tools");
  const inputs = [];
  for (const input of commonInputs)
    inputs.push({
      path: input.path,
      bytes: await readBoundFile(root, input.path, input),
    });
  inputs.push({
    path: "tool.patch",
    bytes:
      authority.patch === undefined
        ? Buffer.alloc(0)
        : await readBoundFile(root, authority.patch.path, authority.patch),
  });
  return inputs;
}

export function reviewedGoBuildProcess(
  tool,
  contextRoot,
  outputRoot,
  isolatedHome,
  dockerExecutable = "docker",
) {
  authorityFor(tool);
  for (const path of [contextRoot, outputRoot, isolatedHome]) {
    if (
      !isAbsolute(path) ||
      path.includes(",") ||
      Array.from(path).some(
        (character) =>
          character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f,
      )
    )
      throw new Error(
        "CONTEXT_GO_PATH_INVALID: builder paths must be absolute without option delimiters",
      );
  }
  // Docker is an operator-owned local build prerequisite, never artifact data.
  if (dockerExecutable !== "docker" && !isAbsolute(dockerExecutable))
    throw new Error(
      "CONTEXT_GO_DOCKER_INVALID: Docker executable must be absolute",
    );
  const environment = {
    PATH: process.env.PATH ?? "",
    ...(process.platform === "win32"
      ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
      : {}),
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    DOCKER_CONFIG: resolve(isolatedHome, ".docker"),
    DOCKER_BUILDKIT: "1",
    DOCKER_CLI_HINTS: "false",
    BUILDX_NO_DEFAULT_ATTESTATIONS: "1",
  };
  return {
    command: dockerExecutable,
    arguments: [
      "build",
      "--progress=plain",
      "--platform",
      "linux/amd64",
      "--build-arg",
      `TOOL=${tool}`,
      "--target",
      "output",
      "--output",
      `type=local,dest=${outputRoot}`,
      contextRoot,
    ],
    options: {
      cwd: contextRoot,
      environment,
      timeoutMs: 30 * 60 * 1000,
      maximumOutputBytes: 1024 * 1024,
    },
  };
}

export async function buildReviewedGoSource({
  artifact,
  sourceBytes,
  repositoryRoot,
  stagingRoot,
  dockerExecutable,
  runProcess,
}) {
  assertReviewedGoSourceArtifact(artifact);
  const authority = authorityFor(artifact.tool);
  verifyBytes(sourceBytes, authority.source, "public source archive");
  const inputs = await readReviewedGoBuildInputs(repositoryRoot, artifact.tool);
  const buildRoot = await mkdtemp(resolve(stagingRoot, `go-${artifact.tool}-`));
  const contextRoot = resolve(buildRoot, "context");
  const outputRoot = resolve(buildRoot, "output");
  const isolatedHome = resolve(buildRoot, "home");
  await mkdir(contextRoot);
  await mkdir(resolve(isolatedHome, ".docker"), { recursive: true });
  if (
    process.platform === "win32" &&
    dockerExecutable !== undefined &&
    isAbsolute(dockerExecutable)
  ) {
    // Docker Desktop installs buildx next to its bin directory. Supply only
    // that operator-owned plugin path; never copy the user Docker config.
    const plugins = resolve(dirname(dockerExecutable), "../cli-plugins");
    const plugin = await lstat(resolve(plugins, "docker-buildx.exe"));
    if (!plugin.isFile() || plugin.isSymbolicLink())
      throw new Error(
        "CONTEXT_GO_DOCKER_INVALID: missing local Buildx executable",
      );
    await writeFile(
      resolve(isolatedHome, ".docker/config.json"),
      JSON.stringify({ cliPluginsExtraDirs: [plugins] }),
      { flag: "wx", mode: 0o600 },
    );
  }
  for (const input of [
    ...inputs,
    { path: "source.tar.gz", bytes: sourceBytes },
  ])
    await writeFile(resolve(contextRoot, input.path), input.bytes, {
      flag: "wx",
      mode: 0o600,
    });
  const process_ = reviewedGoBuildProcess(
    artifact.tool,
    contextRoot,
    outputRoot,
    isolatedHome,
    dockerExecutable,
  );
  try {
    await runProcess(process_.command, process_.arguments, process_.options);
  } catch (error) {
    throw new Error(
      `CONTEXT_GO_BUILD_FAILED: ${artifact.tool}: ${error instanceof Error ? error.message : "fixed build failed"}`,
    );
  }
  const expectedPaths = [
    artifact.tool,
    `${artifact.tool}-LICENSE.txt`,
    `${artifact.tool}-build-info.txt`,
    `${artifact.tool}-imports.txt`,
  ].sort();
  if (
    JSON.stringify((await readdir(outputRoot)).sort()) !==
    JSON.stringify(expectedPaths)
  )
    throw new Error(
      "CONTEXT_GO_OUTPUT_INVALID: builder output coverage differs from reviewed files",
    );
  const extracted = [];
  for (const output of artifact.members)
    extracted.push({
      output,
      bytes: await readBoundFile(outputRoot, output.archivePath, output),
    });
  // Inventory text is supplemental. Only exact binary/license bytes are admitted
  // to the runtime context; model or customer content never enters this builder.
  for (const path of expectedPaths.filter(
    (name) => name.endsWith("-imports.txt") || name.endsWith("-build-info.txt"),
  )) {
    const metadata = await lstat(resolve(outputRoot, path));
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      metadata.size > 512 * 1024
    )
      throw new Error(
        "CONTEXT_GO_OUTPUT_INVALID: invalid supplemental inventory",
      );
  }
  return extracted;
}

async function verifiedCacheRoot(cacheRoot, create = false) {
  const root = resolve(cacheRoot);
  if (create) {
    const parent = dirname(root);
    if ((await realpath(parent)) !== parent)
      throw new Error("CONTEXT_GO_CACHE_INVALID: cache parent must be real");
    await mkdir(root, { recursive: true });
  }
  const metadata = await lstat(root).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (metadata === undefined) return undefined;
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (await realpath(root)) !== root
  )
    throw new Error("CONTEXT_GO_CACHE_INVALID: cache must be a real directory");
  return root;
}

function cacheEntryName(artifact) {
  assertReviewedGoSourceArtifact(artifact);
  return `${artifact.tool}-${artifact.members[0].sha256}`;
}

// The cache is untrusted storage. The reviewed binary and license hashes, not
// a cache key or a prior job's success, admit every byte before it can execute.
export async function readReviewedGoCache(cacheRoot, artifact) {
  const name = cacheEntryName(artifact);
  if (cacheRoot === undefined) return undefined;
  const root = await verifiedCacheRoot(cacheRoot);
  if (root === undefined) return undefined;
  const entry = resolve(root, name);
  const metadata = await lstat(entry).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (metadata === undefined) return undefined;
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (await realpath(entry)) !== entry ||
    JSON.stringify((await readdir(entry)).sort()) !==
      JSON.stringify(
        artifact.members.map((member) => member.archivePath).sort(),
      )
  )
    throw new Error(
      "CONTEXT_GO_CACHE_INVALID: unexpected cached output inventory",
    );
  return Promise.all(
    artifact.members.map(async (output) => ({
      output,
      bytes: await readBoundFile(entry, output.archivePath, output),
    })),
  );
}

export async function writeReviewedGoCache(cacheRoot, artifact, extracted) {
  const name = cacheEntryName(artifact);
  if (cacheRoot === undefined) return;
  if (extracted.length !== artifact.members.length)
    throw new Error("CONTEXT_GO_CACHE_INVALID: incomplete build output");
  for (const [index, output] of artifact.members.entries()) {
    if (extracted[index].output.archivePath !== output.archivePath)
      throw new Error("CONTEXT_GO_CACHE_INVALID: changed build output");
    verifyBytes(extracted[index].bytes, output, output.archivePath);
  }
  const root = await verifiedCacheRoot(cacheRoot, true);
  const temporary = await mkdtemp(resolve(root, ".verified-"));
  try {
    for (const [index, output] of artifact.members.entries())
      await writeFile(
        resolve(temporary, output.archivePath),
        extracted[index].bytes,
        { flag: "wx", mode: 0o600 },
      );
    await rename(temporary, resolve(root, name));
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}
