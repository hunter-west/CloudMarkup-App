import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

import { cleanBetaAssembly } from "./clean-beta-assembly.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-beta-clean-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "cloudmarkup", private: true }),
  );
  return root;
}

test("removes only the exact beta assembly directory", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));
  const assembly = join(root, "artifacts", "platform", "cdk.out");
  const sibling = join(root, "artifacts", "platform", "keep.txt");
  await mkdir(assembly, { recursive: true });
  await writeFile(join(assembly, "manifest.json"), "generated");
  await writeFile(sibling, "preserved");

  const result = await cleanBetaAssembly(root);

  assert.equal(result.removed, true);
  await assert.rejects(readFile(join(assembly, "manifest.json")), {
    code: "ENOENT",
  });
  assert.equal(await readFile(sibling, "utf8"), "preserved");
});

test("is idempotent when the beta assembly is absent", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { force: true, recursive: true }));

  const result = await cleanBetaAssembly(root);

  assert.equal(result.removed, false);
});

test("refuses a linked assembly ancestor", async (context) => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "cloudmarkup-beta-outside-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  context.after(() => rm(outside, { force: true, recursive: true }));
  const sentinel = join(outside, "platform", "cdk.out", "sentinel.txt");
  await mkdir(join(outside, "platform", "cdk.out"), { recursive: true });
  await writeFile(sentinel, "preserved");
  await symlink(
    outside,
    join(root, "artifacts"),
    process.platform === "win32" ? "junction" : "dir",
  );

  await assert.rejects(cleanBetaAssembly(root), /must be a real directory/);
  assert.equal(await readFile(sentinel, "utf8"), "preserved");
});

test("refuses an unrelated directory even when the target path exists", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-beta-unrelated-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const sentinel = join(
    root,
    "artifacts",
    "platform",
    "cdk.out",
    "sentinel.txt",
  );
  await mkdir(join(root, "artifacts", "platform", "cdk.out"), {
    recursive: true,
  });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "other" }),
  );
  await writeFile(sentinel, "preserved");

  await assert.rejects(
    cleanBetaAssembly(root),
    /private cloudmarkup repository/,
  );
  assert.equal(await readFile(sentinel, "utf8"), "preserved");
});
