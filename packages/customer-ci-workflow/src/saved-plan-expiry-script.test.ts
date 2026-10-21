import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "./security.js";
import { savedPlanExpiryAdmissionScriptV1 } from "./workflow-scripts.js";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map(async (root) => {
      await rm(root, { force: true, recursive: true });
    }),
  );
  temporaryRoots.clear();
});

function scriptBody(): string {
  const lines = savedPlanExpiryAdmissionScriptV1().split("\n");
  if (
    lines[0] !== "node --input-type=module <<'CLOUDMARKUP_EXPIRY'" ||
    lines.at(-1) !== "CLOUDMARKUP_EXPIRY"
  ) {
    throw new Error("Malformed saved-plan expiry script fixture.");
  }
  return lines.slice(1, -1).join("\n");
}

async function fixture(expiresAt: string): Promise<{
  readonly directory: string;
  readonly manifestChecksum: string;
  readonly planChecksum: string;
  readonly planPath: string;
  readonly root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-expiry-admission-"));
  temporaryRoots.add(root);
  const directory = join(root, "saved-plan");
  const decryptedDirectory = join(root, "decrypted");
  await mkdir(directory);
  await mkdir(decryptedDirectory);
  const planPath = join(decryptedDirectory, "cloudmarkup.tfplan");
  const planBytes = Buffer.from("exact-reviewed-terraform-plan", "utf8");
  const planChecksum = sha256(planBytes);
  const bytes = Buffer.from(
    JSON.stringify({ expiresAt, planChecksum }),
    "utf8",
  );
  await writeFile(join(directory, "cloudmarkup-plan.manifest.json"), bytes, {
    flag: "wx",
  });
  await writeFile(planPath, planBytes, { flag: "wx" });
  return {
    directory,
    manifestChecksum: sha256(bytes),
    planChecksum,
    planPath,
    root,
  };
}

function execute(input: {
  readonly directory: string;
  readonly manifestChecksum: string;
  readonly planChecksum: string;
  readonly planPath: string;
  readonly root: string;
}) {
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", scriptBody()],
    {
      cwd: input.root,
      encoding: "utf8",
      env: {
        ...process.env,
        CLOUDMARKUP_DECRYPTED_PLAN: input.planPath,
        EXPECTED_MANIFEST_CHECKSUM: input.manifestChecksum,
        EXPECTED_PLAN_CHECKSUM: input.planChecksum,
        RUNNER_TEMP: input.root,
        SAVED_PLAN_DIRECTORY: input.directory,
      },
      timeout: 10_000,
      windowsHide: true,
    },
  );
}

describe("saved-plan final pre-apply expiry admission", () => {
  it("admits an exact manifest that remains current", async () => {
    const input = await fixture(new Date(Date.now() + 60_000).toISOString());

    const result = execute(input);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("rejects a plan that expires after earlier inspection but before apply", async () => {
    const input = await fixture(new Date(Date.now() + 100).toISOString());
    await setTimeout(175);

    const result = execute(input);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("expired or changed before apply");
  });

  it("rejects a changed manifest even when its replacement expiry is current", async () => {
    const input = await fixture(new Date(Date.now() + 60_000).toISOString());

    const result = execute({
      ...input,
      manifestChecksum: sha256("different reviewed manifest"),
    });

    expect(result.status).not.toBe(0);
  });

  it("rejects decrypted plan bytes changed after the earlier integrity check", async () => {
    const input = await fixture(new Date(Date.now() + 60_000).toISOString());
    await writeFile(input.planPath, "tampered-after-integrity-validation");

    const result = execute(input);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("expired or changed before apply");
  });

  it("rejects a changed expected plan checksum at the final apply boundary", async () => {
    const input = await fixture(new Date(Date.now() + 60_000).toISOString());

    const result = execute({
      ...input,
      planChecksum: sha256("different-approved-plan"),
    });

    expect(result.status).not.toBe(0);
  });
});
