import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { TerraformValidationLimitsV1 } from "./contracts.js";
import {
  inspectValidationInputWorkspace,
  TERRAFORM_VALIDATION_RUNTIME_GID,
  TERRAFORM_VALIDATION_RUNTIME_UID,
  validationVolumeName,
} from "./local-container-workspace.js";

const limits: TerraformValidationLimitsV1 = {
  cpuSeconds: 30,
  maxFileBytes: 1_024,
  maxFiles: 8,
  maxOutputBytes: 4_096,
  maxProcesses: 8,
  maxTotalFileBytes: 4_096,
  memoryMiB: 512,
  wallTimeMilliseconds: 30_000,
};

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-volume-input-"));
  await mkdir(join(root, "infrastructure"), { mode: 0o700 });
  await writeFile(join(root, "infrastructure", "main.tf"), "terraform {}\n", {
    mode: 0o600,
  });
  await writeFile(
    join(root, "infrastructure", ".terraform.lock.hcl"),
    "provider fixture\n",
    { mode: 0o600 },
  );
  return root;
}

describe("local validation workspace staging", () => {
  it("keeps exact UID/GID 65532 and derives one bounded private volume name", () => {
    expect(TERRAFORM_VALIDATION_RUNTIME_UID).toBe(65_532);
    expect(TERRAFORM_VALIDATION_RUNTIME_GID).toBe(65_532);
    expect(
      validationVolumeName(
        join(tmpdir(), "cloudmarkup-terraform-validation-ABC_123"),
      ),
    ).toMatch(/^cloudmarkup-terraform-validation-[a-z0-9_.-]+$/u);
  });

  it("accepts restrictive regular input without making it world-writable", async () => {
    const root = await workspace();
    try {
      await expect(
        inspectValidationInputWorkspace(root, limits),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects hard links, symlinks, set-id bits, and oversized input", async () => {
    const roots: string[] = [];
    try {
      const hardLinked = await workspace();
      roots.push(hardLinked);
      await link(
        join(hardLinked, "infrastructure", "main.tf"),
        join(hardLinked, "infrastructure", "duplicate.tf"),
      );
      await expect(
        inspectValidationInputWorkspace(hardLinked, limits),
      ).rejects.toThrow("unsafe input entry");

      const linked = await workspace();
      roots.push(linked);
      try {
        await symlink(
          join(linked, "infrastructure", "main.tf"),
          join(linked, "infrastructure", "escape.tf"),
          "file",
        );
        await expect(
          inspectValidationInputWorkspace(linked, limits),
        ).rejects.toThrow("unsafe input entry");
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "EPERM"
        )) {
          throw error;
        }
      }

      if (process.platform !== "win32") {
        const setId = await workspace();
        roots.push(setId);
        await chmod(join(setId, "infrastructure", "main.tf"), 0o4600);
        await expect(
          inspectValidationInputWorkspace(setId, limits),
        ).rejects.toThrow("unsafe input entry");
      }

      const oversized = await workspace();
      roots.push(oversized);
      await writeFile(
        join(oversized, "infrastructure", "large.tf"),
        Buffer.alloc(limits.maxFileBytes + 1),
        { mode: 0o600 },
      );
      await expect(
        inspectValidationInputWorkspace(oversized, limits),
      ).rejects.toThrow("file-size limit");
    } finally {
      await Promise.all(
        roots.map((root) => rm(root, { force: true, recursive: true })),
      );
    }
  });
});
