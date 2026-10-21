import { z } from "zod";

import {
  applicationBuildLimitsV1Schema,
  applicationBuildSourceFileV1Schema,
  applicationDependencyLockV1Schema,
  type ApplicationBuildLimitsV1,
} from "./contracts.js";
import { sha256Digest } from "./security.js";
import type { WorkspaceAuthority } from "./workspace-authority.js";

export const MEMORY_WORKSPACE_PROTOCOL =
  "cloudmarkup.application-memory-workspace.v1";
export const MEMORY_WORKSPACE_HELPER =
  "/opt/cloudmarkup/service/memory-workspace-v1.mjs";
export const MEMORY_WORKSPACE_ROOT = "/workspace";
export const MEMORY_CACHE_ROOT = "/tmp/cloudmarkup-trivy-cache";
export const MEMORY_TEMPORARY_ROOT = "/tmp";
// The frozen September 10 Trivy DB is 1,382,703,104 bytes before metadata.
// Keep a hard RAM-only ceiling, independent of candidate-controlled limits.
export const MEMORY_CACHE_MAX_BYTES = 1536 * 1024 * 1024;
export const MEMORY_PROTOCOL_MAX_BYTES = 256 * 1024 * 1024;

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
export const kernelBootIdSchema = z
  .string()
  .regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
function hasNoAsciiControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

const path = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      value.startsWith("application/") &&
      !value.includes("\\") &&
      hasNoAsciiControlCharacters(value) &&
      value
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."),
  );
const mode = z.number().int().min(0).max(0o7777);
const fileAuthority = z
  .object({
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    mode,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();
export const memoryAuthoritySchema = z
  .object({
    directories: z
      .array(z.tuple([z.union([z.literal("application"), path]), mode]))
      .max(60_000),
    files: z.array(z.tuple([path, fileAuthority])).max(20_000),
  })
  .strict()
  .superRefine((value, context) => {
    const identities = new Set<string>();
    for (const entries of [value.directories, value.files]) {
      let previous: string | undefined;
      for (const [entry] of entries) {
        const identity = entry.normalize("NFC").toLowerCase();
        if (
          identities.has(identity) ||
          (previous !== undefined && previous >= entry)
        )
          context.addIssue({
            code: "custom",
            message: "Memory workspace entries must be unique and sorted.",
          });
        identities.add(identity);
        previous = entry;
      }
    }
  });
export type MemoryAuthority = z.output<typeof memoryAuthoritySchema>;

export function encodeMemoryAuthority(
  authority: WorkspaceAuthority,
): MemoryAuthority {
  const compare = (
    left: readonly [string, unknown],
    right: readonly [string, unknown],
  ) => (left[0] < right[0] ? -1 : left[0] === right[0] ? 0 : 1);
  return memoryAuthoritySchema.parse({
    directories: [...authority.directories].sort(compare),
    files: [...authority.files].sort(compare),
  });
}

export function decodeMemoryAuthority(
  authority: MemoryAuthority,
): WorkspaceAuthority {
  return {
    directories: new Map(authority.directories),
    files: new Map(authority.files),
  };
}

const header = {
  kind: z.literal(MEMORY_WORKSPACE_PROTOCOL),
  kernelBootId: kernelBootIdSchema,
  limits: applicationBuildLimitsV1Schema,
  cacheBytes: z
    .number()
    .int()
    .min(4096)
    .max(MEMORY_CACHE_MAX_BYTES)
    .refine((value) => value % 4096 === 0),
};
export const memoryWorkspaceRequestSchema = z.discriminatedUnion("operation", [
  z.object({ ...header, operation: z.literal("probe") }).strict(),
  z
    .object({
      ...header,
      operation: z.literal("seed"),
      files: z.array(applicationBuildSourceFileV1Schema).min(1).max(20_000),
      lock: applicationDependencyLockV1Schema,
    })
    .strict(),
  z.object({ ...header, operation: z.literal("inspect") }).strict(),
  z
    .object({
      ...header,
      operation: z.literal("prune"),
      expected: memoryAuthoritySchema,
    })
    .strict(),
  z
    .object({
      ...header,
      operation: z.literal("collect"),
      expected: memoryAuthoritySchema,
      lock: applicationDependencyLockV1Schema,
    })
    .strict(),
]);
export type MemoryWorkspaceRequest = z.output<
  typeof memoryWorkspaceRequestSchema
>;
export const memoryWorkspaceResponseSchema = z
  .object({
    kind: z.literal(MEMORY_WORKSPACE_PROTOCOL),
    operation: z.enum(["probe", "seed", "inspect", "prune", "collect"]),
    helperDigest: digest,
    kernelBootId: kernelBootIdSchema,
    authority: memoryAuthoritySchema.optional(),
    files: z
      .array(
        z
          .object({
            path,
            bytesBase64: z.string().max(90 * 1024 * 1024),
            checksum: digest,
          })
          .strict(),
      )
      .max(20_000)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.operation !== "probe") !== (value.authority !== undefined) ||
      (value.operation === "collect") !== (value.files !== undefined)
    )
      context.addIssue({
        code: "custom",
        message: "Memory workspace response does not match its operation.",
      });
  });
export type MemoryWorkspaceResponse = z.output<
  typeof memoryWorkspaceResponseSchema
>;

export function workspaceMemoryBytes(limits: ApplicationBuildLimitsV1): number {
  // Account for tmpfs page allocation and directory entries, while the separate
  // inspector still enforces exact logical file count and byte limits.
  return (
    Math.ceil((limits.maxTotalFileBytes + limits.maxFiles * 4096) / 4096) * 4096
  );
}

export function temporaryMemoryBytes(limits: ApplicationBuildLimitsV1): number {
  // The kernel allocates whole pages even for smaller configured byte bounds.
  return (
    Math.ceil(Math.min(limits.maxTotalFileBytes, 128 * 1024 * 1024) / 4096) *
    4096
  );
}

export function memoryResponseLimit(
  limits: ApplicationBuildLimitsV1,
  collect: boolean,
): number {
  return Math.min(
    MEMORY_PROTOCOL_MAX_BYTES,
    4096 +
      limits.maxFiles * 1024 +
      (collect ? 4 * Math.ceil(limits.maxArtifactBytes / 3) : 0),
  );
}

export function assertNoSwap(text: string): void {
  const rows = text.trim().split(/\r?\n/u);
  if (
    rows.length !== 1 ||
    !/^Filename\s+Type\s+Size\s+Used\s+Priority$/u.test(rows[0] ?? "")
  )
    throw new TypeError(
      "Memory-only execution requires a Linux host with no active swap.",
    );
}

export function assertNoCoreDumps(limits: string, pattern: string): void {
  // RLIMIT_CORE is ignored by piped collectors. Admit only these reviewed
  // ordinary file patterns; pipe/socket/future receiver modes fail closed.
  if (!new Set(["core", "core\n", "core.%p", "core.%p\n"]).has(pattern))
    throw new TypeError(
      "Memory-only execution requires a reviewed non-pipe core dump policy.",
    );
  const entries = limits
    .split("\n")
    .filter((line) => line.startsWith("Max core file size"));
  if (
    entries.length !== 1 ||
    !/^Max core file size\s+0\s+(?:[0-9]+|unlimited)\s+bytes\s*$/u.test(
      entries[0] ?? "",
    )
  )
    throw new TypeError(
      "Memory-only execution requires core dumps disabled for the current process.",
    );
}

export function assertTmpfsMount(
  mountInfo: string,
  target: string,
  maximumBytes: number,
  requireNoExec = false,
): void {
  const matches = mountInfo
    .split("\n")
    .filter((line) => line.split(" ")[4] === target);
  if (matches.length !== 1)
    throw new TypeError("Memory workspace requires one exact tmpfs mount.");
  const parts = (matches[0] ?? "").split(" - ");
  const before = parts[0]?.split(" ") ?? [];
  const after = parts[1]?.split(" ") ?? [];
  const mountOptions = new Set((before[5] ?? "").split(","));
  const superOptions = new Set((after[2] ?? "").split(","));
  const size = [...superOptions].find((option) => option.startsWith("size="));
  const match = /^size=([1-9][0-9]*)(k)?$/u.exec(size ?? "");
  const sizeBytes =
    match === null ? NaN : Number(match[1]) * (match[2] === "k" ? 1024 : 1);
  if (
    after[0] !== "tmpfs" ||
    !mountOptions.has("nosuid") ||
    !mountOptions.has("nodev") ||
    (requireNoExec && !mountOptions.has("noexec")) ||
    !superOptions.has("noswap") ||
    sizeBytes !== maximumBytes
  )
    throw new TypeError(
      "Memory workspace mount is not the exact bounded, non-swapping tmpfs.",
    );
}

export function validateMemorySeed(
  request: Extract<MemoryWorkspaceRequest, { operation: "seed" }>,
): void {
  const parsed = memoryWorkspaceRequestSchema.parse(request);
  if (parsed.operation !== "seed")
    throw new TypeError("Memory seed operation is required.");
  if (
    sha256Digest(parsed.lock.lockfileContent) !== parsed.lock.lockfileChecksum
  )
    throw new TypeError("Memory seed lock checksum does not match.");
  const paths = new Set<string>();
  let total = Buffer.byteLength(parsed.lock.lockfileContent);
  if (parsed.files.length + 1 > parsed.limits.maxFiles)
    throw new RangeError("Memory seed file count exceeded.");
  for (const file of parsed.files) {
    const identity = file.path.normalize("NFC").toLowerCase();
    const size = Buffer.byteLength(file.content);
    total += size;
    if (
      paths.has(identity) ||
      identity === parsed.lock.lockfilePath ||
      /^(?:application\/node_modules|application\/dist)(?:\/|$)/u.test(
        identity,
      ) ||
      size > parsed.limits.maxFileBytes ||
      sha256Digest(file.content) !== file.checksum
    )
      throw new TypeError("Memory seed source authority is invalid.");
    paths.add(identity);
  }
  if (
    total > parsed.limits.maxTotalFileBytes ||
    Buffer.byteLength(parsed.lock.lockfileContent) > parsed.limits.maxFileBytes
  )
    throw new RangeError("Memory seed byte limits exceeded.");
  const manifest = parsed.files.find(
    (file) => file.path === "application/package.json",
  );
  if (manifest?.checksum !== parsed.lock.packageManifestChecksum)
    throw new TypeError(
      "Memory seed package manifest does not match its lock.",
    );
}
