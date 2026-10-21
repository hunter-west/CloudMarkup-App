import { lstat, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

import type { TerraformValidationLimitsV1 } from "./contracts.js";

export const TERRAFORM_VALIDATION_RUNTIME_UID = 65_532;
export const TERRAFORM_VALIDATION_RUNTIME_GID = 65_532;

export function ensureValidationPathWithin(root: string, path: string): void {
  const local = relative(root, path);
  if (local === "" || local.startsWith("..") || resolve(root, local) !== path) {
    throw new TypeError("Validation workspace path escapes its exact root.");
  }
}

export async function inspectValidationInputWorkspace(
  root: string,
  limits: TerraformValidationLimitsV1,
): Promise<void> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  if (entries.length > (limits.maxFiles + 1) * 4) {
    throw new RangeError("Validation workspace file-count limit exceeded.");
  }
  let files = 0;
  let bytes = 0;
  for (const entry of entries) {
    const path = resolve(entry.parentPath, entry.name);
    ensureValidationPathWithin(root, path);
    const stats = await lstat(path);
    if (
      stats.isSymbolicLink() ||
      (!stats.isDirectory() && !stats.isFile()) ||
      (stats.isFile() && stats.nlink !== 1) ||
      (process.platform !== "win32" && (stats.mode & 0o6002) !== 0)
    ) {
      throw new TypeError(
        "Validation workspace contains an unsafe input entry.",
      );
    }
    if (stats.isFile()) {
      files += 1;
      bytes += stats.size;
      if (stats.size > limits.maxFileBytes) {
        throw new RangeError("Validation workspace file-size limit exceeded.");
      }
    }
  }
  if (
    files > limits.maxFiles + 1 ||
    bytes > limits.maxTotalFileBytes + limits.maxFileBytes
  ) {
    throw new RangeError("Validation workspace input limits exceeded.");
  }
}

export function validationVolumeName(root: string): string {
  const suffix = root
    .split(/[\\/]/u)
    .at(-1)
    ?.replace(/[^a-z0-9_.-]/giu, "-")
    .toLowerCase();
  if (suffix === undefined || suffix.length === 0) {
    throw new TypeError("Validation workspace cannot derive a volume name.");
  }
  return `cloudmarkup-terraform-validation-${suffix}`.slice(0, 127);
}
