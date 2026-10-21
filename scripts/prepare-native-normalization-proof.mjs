// Build public repository tools only. The fixed seed factory runs later, inside
// the independently inspected native parent. No model, AWS or deployment call.
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { parseManifest, sha } from "./native-normalization-proof.mjs";

const deny = () => {
  throw new Error("Native normalization public preparation failed.");
};
const requireValue = (value) => {
  if (!value) deny();
};
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
function command(file, args, cwd, env = process.env) {
  return execFileSync(file, args, {
    cwd,
    env,
    shell: false,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 1048576,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export function assertSourceIdentity(expected, actual, status) {
  requireValue(
    /^[a-f0-9]{40}$/u.test(expected) && expected === actual && status === "",
  );
}
function sourceIdentity(repositoryRoot, expected) {
  assertSourceIdentity(
    expected,
    command("git", ["rev-parse", "HEAD"], repositoryRoot),
    command(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      repositoryRoot,
    ),
  );
}
export function assertLinuxExecutable(bytes) {
  requireValue(
    bytes.length >= 64 &&
      bytes.length <= 134217728 &&
      bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) &&
      bytes[4] === 2 &&
      bytes[5] === 1 &&
      bytes[6] === 1 &&
      bytes.readUInt16LE(16) === 2 &&
      bytes.readUInt16LE(18) === 62,
  );
}
export function pinnedNormalizationImage(inputs) {
  const digest = inputs?.bindings?.nodeBaseImage?.imageDigest;
  requireValue(
    inputs?.platform === "linux/amd64" &&
      inputs?.toolchain?.node === "24.18.0" &&
      /^sha256:[a-f0-9]{64}$/u.test(digest),
  );
  return "node@" + digest;
}
export function assertToolVersions(nodeVersion, goVersion, nodePin, goModule) {
  const match = /^toolchain go(\d+\.\d+\.\d+)$/mu.exec(goModule);
  requireValue(
    match &&
      nodeVersion === nodePin.trim() &&
      goVersion === "go version go" + match[1] + " linux/amd64",
  );
}
export function ownedOutput(repositoryRoot, output) {
  const local = relative(resolve(repositoryRoot, ".cache"), output);
  requireValue(
    isAbsolute(output) &&
      local !== "" &&
      local !== ".." &&
      !local.startsWith(".." + sep) &&
      !isAbsolute(local) &&
      !/[\r\n,]/u.test(output),
  );
  return resolve(output);
}
async function describe(path, executable = false) {
  const stat = await lstat(path);
  requireValue(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size > 0 &&
      stat.size <= (executable ? 134217728 : 33554432) &&
      (await realpath(path)) === path,
  );
  const bytes = await readFile(path);
  requireValue(bytes.length === stat.size);
  if (executable) assertLinuxExecutable(bytes);
  return { path, bytes: bytes.length, sha256: sha(bytes) };
}
export async function bundleNormalizationParent(repositoryRoot) {
  const bundled = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["apps/api/src/native-normalization-proof-parent-entry.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    write: false,
    metafile: true,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  requireValue(bundled.outputFiles.length === 1);
  const inputs = [];
  for (const name of Object.keys(bundled.metafile.inputs).sort()) {
    const path = resolve(repositoryRoot, name);
    const local = relative(repositoryRoot, path);
    requireValue(
      local !== ".." && !local.startsWith(".." + sep) && !isAbsolute(local),
    );
    const file = await describe(path);
    inputs.push({
      file: local.split(sep).join("/"),
      bytes: file.bytes,
      sha256: file.sha256,
    });
  }
  requireValue(bundled.outputFiles[0].contents.length <= 33554432);
  return { bytes: bundled.outputFiles[0].contents, inputs };
}
export async function prepareNormalizationProof({
  repositoryRoot = root,
  output,
  sourceCommit,
  imageId,
}) {
  requireValue(
    process.platform === "linux" &&
      process.arch === "x64" &&
      process.execArgv.length === 0 &&
      !process.env.NODE_OPTIONS &&
      /^sha256:[a-f0-9]{64}$/u.test(imageId),
  );
  sourceIdentity(repositoryRoot, sourceCommit);
  const destination = ownedOutput(repositoryRoot, output);
  requireValue(
    (await realpath(resolve(destination, ".."))) === resolve(destination, ".."),
  );
  const goModule = await readFile(
    resolve(repositoryRoot, "services/iac-compiler/go.mod"),
    "utf8",
  );
  assertToolVersions(
    process.versions.node,
    command("go", ["version"], repositoryRoot),
    await readFile(resolve(repositoryRoot, ".node-version"), "utf8"),
    goModule,
  );
  const image = pinnedNormalizationImage(
    JSON.parse(
      await readFile(
        resolve(
          repositoryRoot,
          "infra/images/application-build/image-inputs-v1.json",
        ),
        "utf8",
      ),
    ),
  );
  const bundled = await bundleNormalizationParent(repositoryRoot);
  await mkdir(destination, { recursive: false });
  const parentPath = resolve(destination, "parent.mjs");
  const compilerPath = resolve(destination, "compiler");
  const launcherPath = resolve(destination, "launcher");
  await writeFile(parentPath, bundled.bytes, { flag: "wx", mode: 0o444 });
  const env = {
    ...process.env,
    GOTOOLCHAIN: "local",
    CGO_ENABLED: "0",
    GOOS: "linux",
    GOARCH: "amd64",
    GOFLAGS: "-mod=readonly",
  };
  command(
    "go",
    [
      "-C",
      "services/iac-compiler",
      "build",
      "-trimpath",
      "-buildvcs=false",
      "-o",
      compilerPath,
      "./cmd/cloudmarkup-iac",
    ],
    repositoryRoot,
    env,
  );
  command(
    "go",
    [
      "build",
      "-trimpath",
      "-buildvcs=false",
      "-o",
      launcherPath,
      "./scripts/memory-normalization-launcher",
    ],
    repositoryRoot,
    { ...env, GO111MODULE: "off", GOFLAGS: "" },
  );
  const artifacts = {
    parent: await describe(parentPath),
    launcher: await describe(launcherPath, true),
    compiler: await describe(compilerPath, true),
  };
  sourceIdentity(repositoryRoot, sourceCommit);
  const closure = {
    kind: "cloudmarkup.anonymous-normalization-public-build.v1",
    sourceCommit,
    sourceTree: command("git", ["rev-parse", "HEAD^{tree}"], repositoryRoot),
    node: process.versions.node,
    go: command("go", ["version"], repositoryRoot),
    image,
    imageId,
    inputs: bundled.inputs,
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([key, value]) => [
        key,
        { bytes: value.bytes, sha256: value.sha256 },
      ]),
    ),
  };
  const closureBytes = Buffer.from(JSON.stringify(closure, null, 2) + "\n");
  const manifest = parseManifest({
    kind: "cloudmarkup.anonymous-normalization-native-closure.v1",
    sourceCommit,
    closureSha256: sha(closureBytes),
    image,
    imageId,
    ...artifacts,
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(resolve(destination, "public-build.json"), closureBytes, {
    flag: "wx",
    mode: 0o444,
  });
  await writeFile(resolve(destination, "manifest.json"), manifestBytes, {
    flag: "wx",
    mode: 0o444,
  });
  await writeFile(
    resolve(destination, "manifest.sha256"),
    sha(manifestBytes) + "\n",
    { flag: "wx", mode: 0o444 },
  );
  return {
    sourceCommit,
    closureSha256: manifest.closureSha256,
    manifestSha256: sha(manifestBytes),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    requireValue(process.argv.length === 5);
    const result = await prepareNormalizationProof({
      sourceCommit: process.argv[2],
      imageId: process.argv[3],
      output: process.argv[4],
    });
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch {
    process.stderr.write("Native normalization public preparation failed.\n");
    process.exitCode = 1;
  }
}
