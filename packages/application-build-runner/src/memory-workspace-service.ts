// Bundled only into the separately pinned memory-workspace image. This module
// owns container filesystem access; the host adapter never materializes content.
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertNoCoreDumps,
  assertNoSwap,
  assertTmpfsMount,
  decodeMemoryAuthority,
  encodeMemoryAuthority,
  kernelBootIdSchema,
  MEMORY_CACHE_ROOT,
  MEMORY_PROTOCOL_MAX_BYTES,
  MEMORY_WORKSPACE_HELPER,
  MEMORY_WORKSPACE_PROTOCOL,
  MEMORY_WORKSPACE_ROOT,
  MEMORY_TEMPORARY_ROOT,
  temporaryMemoryBytes,
  memoryResponseLimit,
  memoryWorkspaceRequestSchema,
  memoryWorkspaceResponseSchema,
  validateMemorySeed,
  workspaceMemoryBytes,
  type MemoryWorkspaceRequest,
  type MemoryWorkspaceResponse,
} from "./memory-workspace-protocol.js";
import { canonicalJson, sha256Digest } from "./security.js";
import {
  encodeMemoryWorkspaceHelperFailure,
  type MemoryWorkspaceHelperStage,
} from "./memory-workspace-diagnostics.js";
import {
  collectRuntimeDependencyFiles,
  ensureWithin,
  inspectWorkspace,
} from "./workspace-authority.js";

let diagnosticStage: MemoryWorkspaceHelperStage = "input";

async function boundedStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    if (!Buffer.isBuffer(chunk))
      throw new TypeError("Memory input must be binary.");
    size += chunk.byteLength;
    if (size > MEMORY_PROTOCOL_MAX_BYTES)
      throw new RangeError("Memory input exceeds its bound.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function admit(request: MemoryWorkspaceRequest): Promise<string> {
  diagnosticStage = "identity";
  if (
    process.platform !== "linux" ||
    process.getuid?.() !== 65532 ||
    process.getgid?.() !== 65532
  )
    throw new TypeError(
      "Memory helper requires the exact unprivileged Linux identity.",
    );
  diagnosticStage = "kernel";
  const bootId = kernelBootIdSchema.parse(
    (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
  );
  if (bootId !== request.kernelBootId)
    throw new TypeError(
      "Memory helper and requester must share the admitted Linux kernel.",
    );
  diagnosticStage = "swap";
  assertNoSwap(await readFile("/proc/swaps", "utf8"));
  diagnosticStage = "core";
  assertNoCoreDumps(
    await readFile("/proc/self/limits", "utf8"),
    await readFile("/proc/sys/kernel/core_pattern", "utf8"),
  );
  diagnosticStage = "workspace-mount";
  const mounts = await readFile("/proc/self/mountinfo", "utf8");
  assertTmpfsMount(
    mounts,
    MEMORY_WORKSPACE_ROOT,
    workspaceMemoryBytes(request.limits),
  );
  diagnosticStage = "cache-mount";
  assertTmpfsMount(mounts, MEMORY_CACHE_ROOT, request.cacheBytes);
  diagnosticStage = "temporary-mount";
  assertTmpfsMount(
    mounts,
    MEMORY_TEMPORARY_ROOT,
    temporaryMemoryBytes(request.limits),
    true,
  );
  diagnosticStage = "root-ownership";
  for (const root of [
    MEMORY_WORKSPACE_ROOT,
    MEMORY_CACHE_ROOT,
    MEMORY_TEMPORARY_ROOT,
  ]) {
    const stat = await lstat(root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== 65532 ||
      stat.gid !== 65532 ||
      (stat.mode & 0o7777) !== 0o700
    )
      throw new TypeError("Memory workspace root ownership is invalid.");
  }
  diagnosticStage = "helper-path";
  if (fileURLToPath(import.meta.url) !== MEMORY_WORKSPACE_HELPER)
    throw new TypeError(
      "Memory helper must run from its exact image-owned path.",
    );
  diagnosticStage = "helper-file";
  const installed = await lstat(MEMORY_WORKSPACE_HELPER);
  if (
    !installed.isFile() ||
    installed.isSymbolicLink() ||
    installed.nlink !== 1 ||
    (installed.mode & 0o222) !== 0
  )
    throw new TypeError(
      "Memory helper must be an immutable regular image file.",
    );
  return sha256Digest(await readFile(MEMORY_WORKSPACE_HELPER));
}

async function execute(
  request: MemoryWorkspaceRequest,
): Promise<MemoryWorkspaceResponse> {
  const helperDigest = await admit(request);
  diagnosticStage = "operation";
  const common = {
    helperDigest,
    kernelBootId: request.kernelBootId,
    kind: MEMORY_WORKSPACE_PROTOCOL,
    operation: request.operation,
  } as const;
  if (request.operation === "probe")
    return memoryWorkspaceResponseSchema.parse(common);
  if (request.operation === "seed") {
    if ((await readdir(MEMORY_WORKSPACE_ROOT)).length !== 0)
      throw new TypeError("Memory seed requires an empty workspace.");
    validateMemorySeed(request);
    for (const file of [
      ...request.files,
      {
        content: request.lock.lockfileContent,
        path: request.lock.lockfilePath,
      },
    ]) {
      const target = resolve(MEMORY_WORKSPACE_ROOT, file.path);
      ensureWithin(MEMORY_WORKSPACE_ROOT, target);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, file.content, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    }
  }
  let authority = await inspectWorkspace(MEMORY_WORKSPACE_ROOT, request.limits);
  if (request.operation === "prune" || request.operation === "collect") {
    const expected = encodeMemoryAuthority(
      decodeMemoryAuthority(request.expected),
    );
    if (
      canonicalJson(encodeMemoryAuthority(authority)) !==
      canonicalJson(expected)
    )
      throw new TypeError(
        "Memory workspace changed after its exact authority check.",
      );
  }
  if (request.operation === "prune") {
    await rm(resolve(MEMORY_WORKSPACE_ROOT, "application/node_modules"), {
      recursive: true,
      force: false,
    });
    authority = await inspectWorkspace(MEMORY_WORKSPACE_ROOT, request.limits);
  }
  if (request.operation !== "collect")
    return memoryWorkspaceResponseSchema.parse({
      ...common,
      authority: encodeMemoryAuthority(authority),
    });

  const files = await collectRuntimeDependencyFiles(
    MEMORY_WORKSPACE_ROOT,
    request.lock,
  );
  const output = [...files];
  for (const [path] of authority.files) {
    if (!path.startsWith("application/dist/")) continue;
    const target = resolve(MEMORY_WORKSPACE_ROOT, path);
    ensureWithin(MEMORY_WORKSPACE_ROOT, target);
    output.push({ bytes: await readFile(target), kind: "regular-file", path });
  }
  output.sort((left, right) =>
    left.path < right.path ? -1 : left.path === right.path ? 0 : 1,
  );
  let total = 0;
  for (const file of output) {
    total += file.bytes.byteLength;
    const expected = authority.files.get(file.path);
    if (
      expected?.sizeBytes !== file.bytes.byteLength ||
      expected.digest !== createHash("sha256").update(file.bytes).digest("hex")
    )
      throw new TypeError("Memory output changed during collection.");
  }
  if (total > request.limits.maxArtifactBytes)
    throw new RangeError("Memory output exceeds its artifact byte bound.");
  return memoryWorkspaceResponseSchema.parse({
    ...common,
    authority: encodeMemoryAuthority(authority),
    files: output.map((file) => ({
      path: file.path,
      bytesBase64: Buffer.from(file.bytes).toString("base64"),
      checksum: sha256Digest(file.bytes),
    })),
  });
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  if (operation === "hold") {
    const milliseconds = Number(process.argv[3]);
    if (
      process.argv.length !== 4 ||
      !Number.isSafeInteger(milliseconds) ||
      milliseconds < 1000 ||
      milliseconds > 10_800_000
    )
      throw new TypeError(
        "Memory workspace holder requires a bounded lifetime.",
      );
    // No source is sent to the holder. Its sole purpose is to keep the exact
    // tmpfs mounts alive between the isolated fixed tool containers.
    await new Promise<void>((done) => {
      const timer = setTimeout(done, milliseconds);
      const stop = () => {
        clearTimeout(timer);
        done();
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    });
    return;
  }
  if (process.argv.length !== 3)
    throw new TypeError("Memory helper accepts one fixed operation.");
  const input = await boundedStdin();
  const request = memoryWorkspaceRequestSchema.parse(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(input),
    ) as unknown,
  );
  if (request.operation !== operation)
    throw new TypeError("Memory helper operation does not match stdin.");
  const response = Buffer.from(canonicalJson(await execute(request)), "utf8");
  diagnosticStage = "output";
  if (
    response.byteLength >
    memoryResponseLimit(request.limits, request.operation === "collect")
  )
    throw new RangeError("Memory helper output exceeds its bound.");
  await new Promise<void>((done, reject) => {
    process.stdout.write(response, (error) => {
      if (error) reject(error);
      else done();
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Never print candidate paths, source, tool output, exception stacks or
    // malformed protocol payloads into the caller's diagnostic stream.
    process.stderr.write(encodeMemoryWorkspaceHelperFailure(diagnosticStage));
    process.exitCode = 70;
  });
}
