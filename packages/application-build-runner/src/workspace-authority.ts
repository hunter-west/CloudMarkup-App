import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type {
  ApplicationBuildLimitsV1,
  ApplicationDependencyLockV1,
  ApplicationBuildProducedFile,
} from "./contracts.js";

// Exact large files from the reviewed offline packages. Source and
// arbitrary dependency files retain the request limit; total workspace limits
// and subsequent byte-for-byte step guards still include these files.
const oversizedDependencyFiles: Readonly<
  Record<string, { readonly sizeBytes: number; readonly sha256: string }>
> = Object.freeze({
  "application/node_modules/@rolldown/binding-linux-x64-musl/rolldown-binding.linux-x64-musl.node":
    {
      sizeBytes: 19178416,
      sha256:
        "86bcac6023952131364d45bce9d4e3312b733044e8567f81d90ffe7587898797",
    },
  "application/node_modules/lightningcss-linux-x64-musl/lightningcss.linux-x64-musl.node":
    {
      sizeBytes: 10032056,
      sha256:
        "a5cf77ba1e47a5539987d569d973bc9389f8c2bb1522d36a3adf22c82afaa86d",
    },
  "application/node_modules/typescript/lib/typescript.js": {
    sizeBytes: 9144216,
    sha256: "569177652966bd528c319171c7dd22860dbf72bde116cbc4f644f1d02bb12e39",
  },
  "application/node_modules/typescript/lib/_tsc.js": {
    sizeBytes: 6239091,
    sha256: "1c59e77a54b186ec43fa7f3e0d3c4bb15ca5eb5ba43e96b1d3a267139eddd3e3",
  },
});

export function ensureWithin(root: string, candidate: string): void {
  const local = relative(root, candidate);
  if (
    local === "" ||
    local.startsWith("..") ||
    resolve(root, local) !== candidate
  ) {
    throw new TypeError(
      "Application build workspace path escapes its exact root.",
    );
  }
}

export interface WorkspaceEntryAuthority {
  readonly digest: string;
  readonly mode: number;
  readonly sizeBytes: number;
}

export interface WorkspaceAuthority {
  readonly directories: ReadonlyMap<string, number>;
  readonly files: ReadonlyMap<string, WorkspaceEntryAuthority>;
}

function generatedPath(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

function assertPortableIdentity(identities: Set<string>, path: string): void {
  const identity = path.normalize("NFC").toLowerCase();
  if (identities.has(identity)) {
    throw new TypeError(
      "Application build workspace contains a portable path collision.",
    );
  }
  identities.add(identity);
}

export async function inspectWorkspace(
  root: string,
  limits: ApplicationBuildLimitsV1,
): Promise<WorkspaceAuthority> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  if (entries.length > limits.maxFiles * 3)
    throw new RangeError("Application build workspace entry limit exceeded.");
  let files = 0;
  let bytes = 0;
  const directories = new Map<string, number>();
  const authority = new Map<string, WorkspaceEntryAuthority>();
  const identities = new Set<string>();
  for (const entry of entries) {
    const path = resolve(entry.parentPath, entry.name);
    ensureWithin(root, path);
    const stats = await lstat(path);
    const relativePath = portableRelative(root, path);
    assertPortableIdentity(identities, relativePath);
    if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
      throw new TypeError(
        "Application build workspace contains a non-regular entry.",
      );
    }
    if (
      process.platform !== "win32" &&
      (stats.mode & (stats.isFile() ? 0o6002 : 0o0002)) !== 0
    ) {
      throw new TypeError(
        "Application build workspace contains an unsafe file mode.",
      );
    }
    if (stats.isFile()) {
      if (stats.nlink !== 1) {
        throw new TypeError(
          "Application build workspace contains a multiply linked file.",
        );
      }
      files += 1;
      bytes += stats.size;
      const oversized = stats.size > limits.maxFileBytes;
      const pin = oversizedDependencyFiles[relativePath];
      if (oversized && pin?.sizeBytes !== stats.size)
        throw new RangeError(
          "Application build workspace file limit exceeded.",
        );
      const content = await readFile(path);
      const digest = createHash("sha256").update(content).digest("hex");
      if (oversized && digest !== pin?.sha256)
        throw new TypeError(
          "Reviewed oversized dependency bytes do not match.",
        );
      authority.set(relativePath, {
        digest,
        mode: stats.mode & 0o7777,
        sizeBytes: stats.size,
      });
    } else {
      directories.set(relativePath, stats.mode & 0o7777);
    }
  }
  if (files > limits.maxFiles || bytes > limits.maxTotalFileBytes) {
    throw new RangeError("Application build workspace size limits exceeded.");
  }
  return { directories, files: authority };
}

function assertAuthorityEntry(
  actual: WorkspaceEntryAuthority | undefined,
  expected: WorkspaceEntryAuthority,
): void {
  if (
    actual?.digest !== expected.digest ||
    actual.mode !== expected.mode ||
    actual.sizeBytes !== expected.sizeBytes
  ) {
    throw new TypeError(
      "Application build workspace changed an authority-bound file.",
    );
  }
}

export function assertWorkspaceAuthority(
  actual: WorkspaceAuthority,
  source: WorkspaceAuthority,
  generatedRoots: readonly string[],
): void {
  for (const [path, mode] of source.directories) {
    if (actual.directories.get(path) !== mode) {
      throw new TypeError(
        "Application build workspace changed an authority-bound directory.",
      );
    }
  }
  for (const [path, expected] of source.files) {
    assertAuthorityEntry(actual.files.get(path), expected);
  }
  for (const path of actual.directories.keys()) {
    if (!source.directories.has(path) && !generatedPath(path, generatedRoots)) {
      throw new TypeError(
        "Application build workspace added an unauthorized directory.",
      );
    }
  }
  for (const path of actual.files.keys()) {
    if (!source.files.has(path) && !generatedPath(path, generatedRoots)) {
      throw new TypeError(
        "Application build workspace added an unauthorized file.",
      );
    }
  }
}

export function subtreeAuthority(
  source: WorkspaceAuthority,
  root: string,
): WorkspaceAuthority {
  return {
    directories: new Map(
      [...source.directories].filter(([path]) => generatedPath(path, [root])),
    ),
    files: new Map(
      [...source.files].filter(([path]) => generatedPath(path, [root])),
    ),
  };
}

export function assertExactAuthority(
  actual: WorkspaceAuthority,
  expected: WorkspaceAuthority,
  root: string,
): void {
  const actualSubtree = subtreeAuthority(actual, root);
  if (
    actualSubtree.directories.size !== expected.directories.size ||
    actualSubtree.files.size !== expected.files.size
  ) {
    throw new TypeError(
      "Application build generated tree changed outside its approved step.",
    );
  }
  for (const [path, mode] of expected.directories) {
    if (actualSubtree.directories.get(path) !== mode) {
      throw new TypeError(
        "Application build generated directory changed outside its approved step.",
      );
    }
  }
  for (const [path, entry] of expected.files) {
    assertAuthorityEntry(actualSubtree.files.get(path), entry);
  }
}

type LockedPackage = ApplicationDependencyLockV1["packages"][number];

interface RuntimeCollectionContext {
  readonly authority: ReadonlyMap<string, LockedPackage>;
  readonly output: ApplicationBuildProducedFile[];
  readonly seenRuntime: Set<string>;
}

const excludedRuntimeSegments = new Set([
  ".cache",
  "__tests__",
  "test",
  "tests",
]);

function portableRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function packageIdentity(name: string, version: string): string {
  return `${name}\0${version}`;
}

function excludedRuntimePath(path: string): boolean {
  const segments = path.toLowerCase().split("/");
  return (
    /\.(?:map|ts)$/iu.test(path) ||
    segments.some(
      (segment) =>
        segment.startsWith(".") || excludedRuntimeSegments.has(segment),
    )
  );
}

async function collectRuntimePackageContents(
  root: string,
  directory: string,
  context: RuntimeCollectionContext,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name === right.name ? 0 : 1,
  );
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    ensureWithin(root, path);
    const portablePath = portableRelative(root, path);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
      throw new TypeError(
        "Application runtime dependency output must be regular.",
      );
    }
    if (stats.isDirectory()) {
      if (entry.name === "node_modules") {
        await collectRuntimeNodeModules(root, path, context);
      } else if (!excludedRuntimePath(portablePath)) {
        await collectRuntimePackageContents(root, path, context);
      }
      continue;
    }
    if (!excludedRuntimePath(portablePath)) {
      context.output.push({
        bytes: await readFile(path),
        kind: "regular-file",
        path: portablePath,
      });
    }
  }
}

async function collectRuntimePackage(
  root: string,
  directory: string,
  locator: string,
  context: RuntimeCollectionContext,
): Promise<void> {
  const manifestPath = resolve(directory, "package.json");
  ensureWithin(root, manifestPath);
  let manifest: unknown;
  try {
    const stats = await lstat(manifestPath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new TypeError();
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch {
    throw new TypeError(
      "Application dependency package metadata is missing or malformed.",
    );
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest) ||
    !("name" in manifest) ||
    !("version" in manifest) ||
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string" ||
    manifest.name !== locator
  ) {
    throw new TypeError("Application dependency package identity is invalid.");
  }
  const identity = packageIdentity(manifest.name, manifest.version);
  const locked = context.authority.get(identity);
  if (locked === undefined) {
    throw new TypeError(
      "Application dependency is outside the exact lock authority.",
    );
  }
  if (
    locked.kind === "development" ||
    locked.kind === "transitive-development"
  ) {
    throw new TypeError(
      "Application production dependencies retain a development package.",
    );
  }
  context.seenRuntime.add(identity);
  await collectRuntimePackageContents(root, directory, context);
}

async function collectRuntimeNodeModules(
  root: string,
  directory: string,
  context: RuntimeCollectionContext,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name === right.name ? 0 : 1,
  );
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    ensureWithin(root, path);
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
      throw new TypeError(
        "Application dependency output must contain only regular entries.",
      );
    }
    if (
      directory === resolve(root, "application/node_modules") &&
      entry.name === ".pnpm" &&
      stats.isDirectory()
    ) {
      const metadata = await readdir(path, { withFileTypes: true });
      if (metadata.length !== 1 || metadata[0]?.name !== "lock.yaml")
        throw new TypeError(
          "Application production dependencies retain a virtual store.",
        );
      const lock = await lstat(resolve(path, "lock.yaml"));
      if (
        !lock.isFile() ||
        lock.isSymbolicLink() ||
        lock.nlink !== 1 ||
        lock.size === 0
      )
        throw new TypeError(
          "Application package-manager lock metadata is invalid.",
        );
      continue;
    }
    if (
      directory === resolve(root, "application/node_modules") &&
      (entry.name === ".package-map.json" ||
        entry.name === ".pnpm-workspace-state-v1.json") &&
      stats.isFile()
    )
      continue;
    if (entry.name === ".bin" || entry.name === ".pnpm") {
      throw new TypeError(
        "Application production dependencies retain a pnpm link or virtual-store directory.",
      );
    }
    if (entry.name === ".modules.yaml" && stats.isFile()) continue;
    if (entry.name.startsWith(".")) {
      throw new TypeError(
        "Application production dependencies contain unknown hidden metadata.",
      );
    }
    if (!stats.isDirectory()) {
      throw new TypeError(
        "Application dependency output contains an unexpected loose file.",
      );
    }
    if (entry.name.startsWith("@")) {
      const scopedEntries = await readdir(path, { withFileTypes: true });
      scopedEntries.sort((left, right) =>
        left.name < right.name ? -1 : left.name === right.name ? 0 : 1,
      );
      for (const scopedEntry of scopedEntries) {
        const scopedPath = resolve(path, scopedEntry.name);
        ensureWithin(root, scopedPath);
        const scopedStats = await lstat(scopedPath);
        if (!scopedStats.isDirectory() || scopedStats.isSymbolicLink()) {
          throw new TypeError(
            "Application dependency scope contains a non-directory entry.",
          );
        }
        await collectRuntimePackage(
          root,
          scopedPath,
          `${entry.name}/${scopedEntry.name}`,
          context,
        );
      }
    } else {
      await collectRuntimePackage(root, path, entry.name, context);
    }
  }
}

export async function collectRuntimeDependencyFiles(
  root: string,
  lock: ApplicationDependencyLockV1,
): Promise<readonly ApplicationBuildProducedFile[]> {
  const authority = new Map(
    lock.packages.map((entry) => [
      packageIdentity(entry.name, entry.version),
      entry,
    ]),
  );
  const expectedRuntime = new Set(
    lock.packages
      .filter(
        (entry) =>
          entry.kind === "runtime" || entry.kind === "transitive-runtime",
      )
      .map((entry) => packageIdentity(entry.name, entry.version)),
  );
  const nodeModulesRoot = resolve(root, "application/node_modules");
  ensureWithin(root, nodeModulesRoot);
  const output: ApplicationBuildProducedFile[] = [];
  const seenRuntime = new Set<string>();
  await collectRuntimeNodeModules(root, nodeModulesRoot, {
    authority,
    output,
    seenRuntime,
  });
  if (
    seenRuntime.size !== expectedRuntime.size ||
    [...expectedRuntime].some((identity) => !seenRuntime.has(identity))
  ) {
    throw new TypeError(
      "Application runtime dependency closure is incomplete.",
    );
  }
  return output;
}
