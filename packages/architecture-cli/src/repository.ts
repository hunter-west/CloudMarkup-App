import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import {
  architectureDocumentV3Schema,
  serializeCanonicalJson,
  solutionRevisionManifestV1Schema,
  type SolutionRevisionManifestV1,
} from "@cloudmarkup/schemas";
import {
  SOLUTION_EXPORT_MANIFEST_PATH,
  canonicalSemanticDigest,
  decodeUtf8,
  encodeUtf8,
  inspectExportPath,
  sha256Digest,
  solutionExportManifestV1Schema,
  type SolutionExportArtifactV1,
  type SolutionExportFileV1,
  type SolutionExportManifestV1,
} from "@cloudmarkup/solution-export";

import {
  ARCHITECTURE_CLI_ID,
  ARCHITECTURE_CLI_LIMITS,
  ARCHITECTURE_CLI_VERSION,
  architectureCliFileChangeV1Schema,
  architectureCliRepositoryLockV1Schema,
  architectureCliRepositoryProfileV1Schema,
  type ArchitectureCliFileChangeV1,
  type ArchitectureCliRepositoryLockV1,
  type ArchitectureCliRepositoryProfileV1,
  type ArchitectureCliSha256Digest,
} from "./contracts.js";

export const ARCHITECTURE_CLI_PROFILE_PATH = ".cloudmarkup-cli.json" as const;
export const ARCHITECTURE_CLI_OUTPUT_ROOTS = Object.freeze([
  "application",
  "cloudmarkup",
  "diagram",
  "evidence",
  "infrastructure",
] as const);
const ARCHITECTURE_CLI_WORKFLOW_ROOT = ".github/workflows/" as const;

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function normalizedPortableKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function relativePortable(root: string, absolute: string): string {
  const value = relative(root, absolute);
  if (
    value === "" ||
    value.startsWith(`..${sep}`) ||
    value === ".." ||
    isAbsolute(value)
  ) {
    throw new Error("Repository path escapes the selected root.");
  }
  return value.split(sep).join("/");
}

function absoluteRepositoryPath(root: string, path: string): string {
  if (path !== ARCHITECTURE_CLI_PROFILE_PATH && path !== "README.md") {
    const issue = inspectExportPath(path, 240);
    if (issue !== undefined) throw new Error(issue.message);
  }
  const absolute = resolve(root, ...path.split("/"));
  relativePortable(root, absolute);
  return absolute;
}

async function readRegularFile(
  root: string,
  path: string,
  maximumBytes = ARCHITECTURE_CLI_LIMITS.fileBytes,
): Promise<Uint8Array> {
  const absolute = absoluteRepositoryPath(root, path);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Repository path ${path} must be a regular file.`);
  }
  if (metadata.size > maximumBytes) {
    throw new Error(
      `Repository path ${path} exceeds the configured byte limit.`,
    );
  }
  return new Uint8Array(await readFile(absolute));
}

async function readOptionalRegularFile(
  root: string,
  path: string,
  maximumBytes = ARCHITECTURE_CLI_LIMITS.fileBytes,
): Promise<Uint8Array | undefined> {
  try {
    return await readRegularFile(root, path, maximumBytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function parseCanonicalJson<T>(
  path: string,
  bytes: Uint8Array,
  parse: (input: unknown) => T,
): T {
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeUtf8(bytes)) as unknown;
  } catch {
    throw new Error(`Repository path ${path} does not contain valid JSON.`);
  }
  const value = parse(decoded);
  if (decodeUtf8(bytes) !== serializeCanonicalJson(value)) {
    throw new Error(`Repository path ${path} must use canonical JSON bytes.`);
  }
  return value;
}

export function architectureCliPinDigest(): ArchitectureCliSha256Digest {
  return sha256Digest(
    serializeCanonicalJson({
      id: ARCHITECTURE_CLI_ID,
      version: ARCHITECTURE_CLI_VERSION,
    }),
  );
}

export interface ArchitectureCliCommittedFile {
  readonly bytes: Uint8Array;
  readonly checksum: ArchitectureCliSha256Digest;
  readonly mediaType: SolutionExportFileV1["mediaType"];
  readonly ownership: SolutionExportFileV1["ownership"];
  readonly path: string;
  readonly semanticChecksum: ArchitectureCliSha256Digest;
}

export interface LoadedArchitectureRepository {
  readonly files: ReadonlyMap<string, ArchitectureCliCommittedFile>;
  readonly lock: ArchitectureCliRepositoryLockV1;
  readonly manifest: SolutionExportManifestV1;
  readonly profile: ArchitectureCliRepositoryProfileV1;
  readonly root: string;
  readonly solutionRevision: SolutionRevisionManifestV1;
}

async function enumerateRootFiles(
  repositoryRoot: string,
  packageRoot: string,
  output: string[],
): Promise<void> {
  const absoluteRoot = resolve(repositoryRoot, ...packageRoot.split("/"));
  let entries;
  try {
    entries = await readdir(absoluteRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  entries.sort((left, right) => compareUtf16(left.name, right.name));
  for (const entry of entries) {
    const path = `${packageRoot}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`Repository path ${path} cannot be a symbolic link.`);
    }
    if (entry.isDirectory()) {
      await enumerateRootFiles(repositoryRoot, path, output);
    } else if (entry.isFile()) {
      output.push(path);
      if (output.length > ARCHITECTURE_CLI_LIMITS.files) {
        throw new Error("Repository file count exceeds the configured limit.");
      }
    } else {
      throw new Error(
        `Repository path ${path} must be a regular file or directory.`,
      );
    }
  }
}

function assertRepositoryBindings(input: {
  readonly lock: ArchitectureCliRepositoryLockV1;
  readonly manifest: SolutionExportManifestV1;
  readonly profile: ArchitectureCliRepositoryProfileV1;
  readonly solutionRevision: SolutionRevisionManifestV1;
}): void {
  const { lock, manifest, profile, solutionRevision } = input;
  const revisionDigest = sha256Digest(serializeCanonicalJson(solutionRevision));
  if (
    profile.cli.digest !== architectureCliPinDigest() ||
    lock.solutionRevision.id !== solutionRevision.solutionRevisionId ||
    manifest.solutionRevision.id !== solutionRevision.solutionRevisionId ||
    lock.solutionRevision.digest !== revisionDigest ||
    manifest.solutionRevision.digest !== revisionDigest
  ) {
    throw new Error(
      "Repository profile, lock, manifest, and Solution Revision bindings differ.",
    );
  }
  if (
    manifest.repositoryWorkflows !== undefined &&
    (manifest.repositoryWorkflows.solutionRevision.id !==
      manifest.solutionRevision.id ||
      manifest.repositoryWorkflows.solutionRevision.digest !==
        manifest.solutionRevision.digest)
  ) {
    throw new Error(
      "Repository workflow inventory and Solution Revision bindings differ.",
    );
  }
  if (
    lock.inputs.architecture !== solutionRevision.architecture.documentHash ||
    lock.inputs.applicationContracts !==
      solutionRevision.contracts.contentHash ||
    lock.inputs.externalResources !==
      solutionRevision.externalResources.contentHash ||
    lock.inputs.workload !== solutionRevision.workload.contentHash ||
    manifest.inputs.architectureDocument !==
      solutionRevision.architecture.documentHash ||
    manifest.inputs.applicationContracts !==
      solutionRevision.contracts.contentHash ||
    manifest.inputs.externalResources !==
      solutionRevision.externalResources.contentHash ||
    manifest.inputs.workload !== solutionRevision.workload.contentHash
  ) {
    throw new Error(
      "Repository source hashes do not match the immutable Solution Revision.",
    );
  }
  if (
    serializeCanonicalJson(lock.tools) !==
    serializeCanonicalJson(manifest.tools)
  ) {
    throw new Error(
      "Repository lock tool pins do not match the generated manifest.",
    );
  }
}

export async function loadArchitectureRepository(
  rootInput: string,
): Promise<LoadedArchitectureRepository> {
  const root = await realpath(resolve(rootInput));
  const profileBytes = await readRegularFile(
    root,
    ARCHITECTURE_CLI_PROFILE_PATH,
    1_024 * 1_024,
  );
  const profile = parseCanonicalJson(
    ARCHITECTURE_CLI_PROFILE_PATH,
    profileBytes,
    (input) => architectureCliRepositoryProfileV1Schema.parse(input),
  );
  const manifestBytes = await readRegularFile(
    root,
    profile.paths.manifest,
    8 * 1_024 * 1_024,
  );
  const manifest = parseCanonicalJson(
    profile.paths.manifest,
    manifestBytes,
    (input) => solutionExportManifestV1Schema.parse(input),
  );
  const lockBytes = await readRegularFile(
    root,
    profile.paths.lock,
    2 * 1_024 * 1_024,
  );
  const lock = parseCanonicalJson(profile.paths.lock, lockBytes, (input) =>
    architectureCliRepositoryLockV1Schema.parse(input),
  );
  const revisionBytes = await readRegularFile(
    root,
    profile.paths.solutionRevision,
    8 * 1_024 * 1_024,
  );
  const solutionRevision = parseCanonicalJson(
    profile.paths.solutionRevision,
    revisionBytes,
    (input) => solutionRevisionManifestV1Schema.parse(input),
  );
  assertRepositoryBindings({ lock, manifest, profile, solutionRevision });

  const files = new Map<string, ArchitectureCliCommittedFile>();
  const portableKeys = new Set<string>();
  let totalBytes = 0;
  const loadManifestEntry = async (
    entry: SolutionExportManifestV1["files"][number],
    optional: boolean,
  ): Promise<void> => {
    const key = normalizedPortableKey(entry.path);
    if (portableKeys.has(key)) {
      throw new Error(
        `Repository contains a duplicate portable path ${entry.path}.`,
      );
    }
    portableKeys.add(key);
    const bytes = optional
      ? await readOptionalRegularFile(root, entry.path)
      : await readRegularFile(root, entry.path);
    if (bytes === undefined) return;
    totalBytes += bytes.byteLength;
    if (totalBytes > ARCHITECTURE_CLI_LIMITS.totalBytes) {
      throw new Error("Repository bytes exceed the configured total limit.");
    }
    if (
      bytes.byteLength !== entry.sizeBytes ||
      sha256Digest(bytes) !== entry.checksum ||
      canonicalSemanticDigest(entry.mediaType, bytes) !== entry.semanticChecksum
    ) {
      throw new Error(
        `Repository path ${entry.path} does not match its manifest metadata.`,
      );
    }
    files.set(entry.path, {
      bytes,
      checksum: entry.checksum,
      mediaType: entry.mediaType,
      ownership: entry.ownership,
      path: entry.path,
      semanticChecksum: entry.semanticChecksum,
    });
  };
  for (const entry of [...manifest.files].sort((left, right) =>
    compareUtf16(left.path, right.path),
  )) {
    await loadManifestEntry(entry, false);
  }
  for (const entry of [...(manifest.repositoryWorkflows?.files ?? [])].sort(
    (left, right) => compareUtf16(left.path, right.path),
  )) {
    await loadManifestEntry(entry, true);
  }
  const manifestChecksum = sha256Digest(manifestBytes);
  files.set(SOLUTION_EXPORT_MANIFEST_PATH, {
    bytes: manifestBytes,
    checksum: manifestChecksum,
    mediaType: "application/json",
    ownership: "generated-replaceable",
    path: SOLUTION_EXPORT_MANIFEST_PATH,
    semanticChecksum: manifestChecksum,
  });

  const observed: string[] = [
    "README.md",
    ...[...files.keys()].filter(
      (path) =>
        path.startsWith(ARCHITECTURE_CLI_WORKFLOW_ROOT) &&
        path.length > ARCHITECTURE_CLI_WORKFLOW_ROOT.length,
    ),
  ];
  await readRegularFile(root, "README.md");
  for (const packageRoot of ARCHITECTURE_CLI_OUTPUT_ROOTS) {
    await enumerateRootFiles(root, packageRoot, observed);
  }
  const expected = new Set([...files.keys()]);
  for (const path of observed.sort(compareUtf16)) {
    if (!expected.has(path)) {
      throw new Error(`Repository contains unmanifested output path ${path}.`);
    }
  }
  if (observed.length !== expected.size) {
    const missing = [...expected]
      .filter((path) => !observed.includes(path))
      .sort(compareUtf16)[0];
    throw new Error(
      `Repository is missing manifest path ${missing ?? "unknown"}.`,
    );
  }
  return { files, lock, manifest, profile, root, solutionRevision };
}

export interface ArchitectureCliFileChangePlan {
  readonly deletes: readonly string[];
  readonly writes: readonly SolutionExportFileV1[];
}

function ownershipByPath(
  manifest: SolutionExportManifestV1,
): ReadonlyMap<string, SolutionExportManifestV1["ownership"][number]> {
  return new Map<string, SolutionExportManifestV1["ownership"][number]>(
    manifest.ownership.map((entry) => [entry.path, entry]),
  );
}

export function planArchitectureRepositoryUpdate(
  repository: LoadedArchitectureRepository,
  artifact: SolutionExportArtifactV1,
): ArchitectureCliFileChangePlan {
  const proposedManifest = solutionExportManifestV1Schema.parse(
    artifact.manifest,
  );
  const proposedFiles = new Map(
    artifact.files.map((file) => [file.path, file]),
  );
  if (proposedFiles.size !== artifact.files.length) {
    throw new Error("Generated artifact contains duplicate paths.");
  }
  const currentOwnership = ownershipByPath(repository.manifest);
  const proposedOwnership = ownershipByPath(proposedManifest);
  const writes: SolutionExportFileV1[] = [];
  const deletes: string[] = [];

  for (const file of [...artifact.files].sort((left, right) =>
    compareUtf16(left.path, right.path),
  )) {
    if (
      sha256Digest(file.bytes) !== file.checksum ||
      canonicalSemanticDigest(file.mediaType, file.bytes) !==
        file.semanticChecksum
    ) {
      throw new Error(
        `Generated path ${file.path} has invalid checksum metadata.`,
      );
    }
    const current = repository.files.get(file.path);
    if (current?.checksum === file.checksum) continue;
    const nextRule = proposedOwnership.get(file.path);
    if (file.path === SOLUTION_EXPORT_MANIFEST_PATH) {
      writes.push(file);
      continue;
    }
    if (
      file.ownership !== "generated-replaceable" ||
      nextRule?.ownership !== "generated-replaceable" ||
      nextRule.regeneration !== "verified-replacement"
    ) {
      throw new Error(
        `Generated command cannot replace non-generated path ${file.path}.`,
      );
    }
    if (current !== undefined) {
      const rule = currentOwnership.get(file.path);
      if (
        current.ownership !== "generated-replaceable" ||
        rule?.ownership !== "generated-replaceable" ||
        rule.regeneration !== "verified-replacement" ||
        nextRule.baselineChecksum !== current.checksum
      ) {
        throw new Error(
          `Generated path ${file.path} does not match its reviewed baseline.`,
        );
      }
    }
    writes.push(file);
  }

  for (const [path, current] of repository.files) {
    if (path === SOLUTION_EXPORT_MANIFEST_PATH || proposedFiles.has(path))
      continue;
    const rule = currentOwnership.get(path);
    if (
      current.ownership !== "generated-replaceable" ||
      rule?.ownership !== "generated-replaceable" ||
      rule.regeneration !== "verified-replacement"
    ) {
      throw new Error(
        `Obsolete path ${path} is not safe for generated deletion.`,
      );
    }
    deletes.push(path);
  }
  return {
    deletes: deletes.sort(compareUtf16),
    writes: writes.sort((left, right) =>
      left.path === SOLUTION_EXPORT_MANIFEST_PATH
        ? 1
        : right.path === SOLUTION_EXPORT_MANIFEST_PATH
          ? -1
          : compareUtf16(left.path, right.path),
    ),
  };
}

async function deterministicTemporaryRoot(digest: string): Promise<string> {
  const parent = resolve(tmpdir(), "cloudmarkup-repository-verification-v1");
  await mkdir(parent, { recursive: true });
  const prefix = resolve(
    parent,
    `${digest.slice("sha256:".length, "sha256:".length + 24)}-`,
  );
  relativePortable(parent, prefix);
  return mkdtemp(prefix);
}

async function writeArtifactTree(
  root: string,
  artifact: SolutionExportArtifactV1,
): Promise<void> {
  for (const file of [...artifact.files].sort((left, right) =>
    compareUtf16(left.path, right.path),
  )) {
    const target = absoluteRepositoryPath(root, file.path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, file.bytes, { flag: "wx", mode: 0o600 });
  }
}

export async function withIsolatedArtifactTree<T>(
  artifact: SolutionExportArtifactV1,
  run: (root: string) => Promise<T>,
): Promise<T> {
  const root = await deterministicTemporaryRoot(artifact.zipDigest);
  try {
    await writeArtifactTree(root, artifact);
    return await run(root);
  } finally {
    await rm(root, { force: false, recursive: true });
  }
}

export async function applyArchitectureRepositoryUpdate(
  repository: LoadedArchitectureRepository,
  artifact: SolutionExportArtifactV1,
): Promise<ArchitectureCliFileChangePlan> {
  const plan = planArchitectureRepositoryUpdate(repository, artifact);
  await withIsolatedArtifactTree(artifact, async (stagedRoot) => {
    for (const file of plan.writes) {
      const target = absoluteRepositoryPath(repository.root, file.path);
      const source = absoluteRepositoryPath(stagedRoot, file.path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await copyFile(source, target);
    }
    for (const path of plan.deletes) {
      await rm(absoluteRepositoryPath(repository.root, path), { force: false });
    }
  });
  return plan;
}

export function fileChangesForArtifact(
  repository: LoadedArchitectureRepository,
  artifact: SolutionExportArtifactV1,
): ArchitectureCliFileChangeV1[] {
  const after = new Map(artifact.files.map((file) => [file.path, file]));
  const paths = [
    ...new Set([...repository.files.keys(), ...after.keys()]),
  ].sort(compareUtf16);
  return paths.flatMap((path) => {
    const beforeFile = repository.files.get(path);
    const afterFile = after.get(path);
    if (beforeFile?.checksum === afterFile?.checksum) return [];
    return [
      architectureCliFileChangeV1Schema.parse({
        ...(afterFile === undefined
          ? {}
          : { afterChecksum: afterFile.checksum }),
        ...(beforeFile === undefined
          ? {}
          : { beforeChecksum: beforeFile.checksum }),
        change:
          beforeFile === undefined
            ? ("added" as const)
            : afterFile === undefined
              ? ("removed" as const)
              : ("modified" as const),
        path,
      }),
    ];
  });
}

function repositoryJsonFile(
  repository: LoadedArchitectureRepository,
  path: string,
): unknown {
  const file = repository.files.get(path);
  if (file?.mediaType !== "application/json") {
    throw new Error(
      `Repository source document ${path} is missing or has the wrong media type.`,
    );
  }
  return parseCanonicalJson(path, file.bytes, (input) => input);
}

export function repositorySourceInputs(
  repository: LoadedArchitectureRepository,
) {
  const architecture = repositoryJsonFile(
    repository,
    "cloudmarkup/architecture.json",
  );
  const applicationContracts = repositoryJsonFile(
    repository,
    "cloudmarkup/contracts/application-contracts.json",
  );
  const externalResources = repositoryJsonFile(
    repository,
    "cloudmarkup/external-resources.json",
  );
  const workloadBehavior = repositoryJsonFile(
    repository,
    "cloudmarkup/workloads.json",
  );
  if (
    typeof architecture !== "object" ||
    architecture === null ||
    Array.isArray(architecture)
  ) {
    throw new Error(
      "Repository architecture projection must be a JSON object.",
    );
  }
  const architectureDocument = architectureDocumentV3Schema.parse({
    ...architecture,
    applicationContracts,
    externalResources,
    workloadBehavior,
  });
  return Object.freeze({
    existingFiles: [...repository.files.values()].map((file) => ({
      checksum: file.checksum,
      mediaType: file.mediaType,
      ownership: file.ownership,
      path: file.path,
      semanticChecksum: file.semanticChecksum,
      sizeBytes: file.bytes.byteLength,
    })),
    documents: Object.freeze({
      architectureDocument,
      solutionRevision: repository.solutionRevision,
      workloadBehavior: architectureDocument.workloadBehavior,
    }),
    lock: repository.lock,
    manifest: repository.manifest,
    profile: repository.profile,
    solutionRevision: repository.solutionRevision,
  });
}

export function canonicalProfileBytes(
  profile: ArchitectureCliRepositoryProfileV1,
): Uint8Array {
  return encodeUtf8(serializeCanonicalJson(profile));
}
