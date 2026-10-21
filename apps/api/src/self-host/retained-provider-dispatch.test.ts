import {
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  rm,
  mkdir,
  rename,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import {
  RetainedProviderDirectDispatchFence,
  provisionRetainedProviderDispatch,
  requireRetainedProviderDispatchSettings,
} from "./retained-provider-dispatch.js";
import { requireProviderDirectBindingV1 } from "./provider-direct-invocation-policy.js";

// Windows cannot open directories for fsync. Only that OS capability is
// simulated here; these unit cases prove record/restore refusal, never Linux
// fsync, mount persistence, cross-process death or independent retention.
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      if (
        process.platform === "win32" &&
        (await fs.lstat(args[0]).catch(() => null))?.isDirectory()
      )
        return {
          sync: () => Promise.resolve(),
          close: () => Promise.resolve(),
        } as Awaited<ReturnType<typeof fs.open>>;
      return fs.open(...args);
    },
  };
});
const roots = new Set<string>();
afterEach(async () => {
  for (const root of roots) {
    if (
      dirname(root) !== resolve(tmpdir()) ||
      !basename(root).startsWith("cm-provider-dispatch-")
    )
      throw Error("Unsafe fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
  roots.clear();
});
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "cm-provider-dispatch-"));
  roots.add(base);
  const settings = { root: join(base, "retained"), identity: "a".repeat(64) };
  const objects = join(base, "objects");
  const binding = requireProviderDirectBindingV1({
    attemptNumber: 1,
    feature: "architecture.propose",
    idempotencyKeyDigest: digestCanonicalValue("key"),
    invocationId: "invocation.synthetic",
    usageRecordId: "usage.synthetic",
    scope: {
      organizationId: "org.synthetic",
      projectId: "project.synthetic",
      userId: "principal.synthetic",
      jobId: "job.synthetic",
    },
    contractVersion: 1,
    fundingSource: "provider-direct",
    providerId: "openai.responses",
    modelId: "openai.gpt-5-4-2026-03-05",
    modelVersion: "gpt-5.4-2026-03-05",
    role: "architecture",
    operationVersion: 1,
    promptTemplateId: "cloudmarkup.synthetic",
    promptVersion: "1.0.0",
    promptDigest: digestCanonicalValue("prompt"),
    inputDigest: digestCanonicalValue("input"),
    wireDigest: digestCanonicalValue("wire"),
    schemaDigest: digestCanonicalValue("schema"),
    configurationDigest: digestCanonicalValue("config"),
    maximumOutputTokens: 100,
    maximumInputBytes: 1000,
    maximumRequestBytes: 2000,
    maximumResponseBytes: 1000,
    deadlineMilliseconds: 1000,
  });
  return {
    base,
    settings,
    objects,
    binding,
    create: () =>
      new RetainedProviderDirectDispatchFence(
        requireRetainedProviderDispatchSettings(settings, objects),
      ),
  };
}
it("requires explicit new independent history and never repeats a retained dispatch after SQL rollback or process restart", async () => {
  const f = await fixture();
  const missing = f.create();
  await expect(missing.assertReady()).rejects.toThrow();
  await missing.close();
  await provisionRetainedProviderDispatch(f.settings, f.objects);
  const first = f.create(),
    competing = f.create();
  const decisions = await Promise.allSettled([
    first.admit(f.binding),
    competing.admit(f.binding),
  ]);
  expect(
    decisions.filter((decision) => decision.status === "fulfilled"),
  ).toHaveLength(1);
  await first.close();
  await competing.close();
  const restarted = f.create();
  await restarted.assertReady();
  await expect(restarted.admit(f.binding)).rejects.toThrow();
  await expect(
    restarted.admit(
      requireProviderDirectBindingV1({
        ...f.binding,
        invocationId: "invocation.retry",
        inputDigest: digestCanonicalValue("changed input"),
      }),
    ),
  ).rejects.toThrow();
  await expect(
    provisionRetainedProviderDispatch(f.settings, f.objects),
  ).rejects.toThrow();
  const records = await readdir(f.settings.root);
  const record = records.find((name) => name.endsWith(".dispatch-v1.json"));
  expect(record).toBeDefined();
  const text = await readFile(
    join(f.settings.root, record ?? "missing"),
    "utf8",
  );
  expect(text).not.toContain("org.synthetic");
  expect(text).not.toContain("project.synthetic");
  expect(text).not.toContain("prompt");
  expect(text).toContain("bindingDigest");
  await restarted.close();
});
it("refuses missing issued records, unknown partial staging and a replaced directory instead of accepting an older SQL snapshot", async () => {
  const f = await fixture();
  await provisionRetainedProviderDispatch(f.settings, f.objects);
  const original = f.create();
  await original.admit(f.binding);
  await original.close();
  const record = (await readdir(f.settings.root)).find((name) =>
    name.endsWith(".dispatch-v1.json"),
  );
  if (!record) throw Error("Missing retained fixture record");
  await rename(join(f.settings.root, record), join(f.base, "held-record"));
  const missing = f.create();
  await expect(missing.assertReady()).rejects.toThrow();
  await missing.close();
  await rename(join(f.base, "held-record"), join(f.settings.root, record));
  await writeFile(
    join(
      f.settings.root,
      record + ".pending-12345678-1234-1234-1234-123456789abc",
    ),
    "{}",
    { mode: 0o600 },
  );
  const partial = f.create();
  await expect(partial.assertReady()).rejects.toThrow();
  await partial.close();
  await rename(f.settings.root, join(f.base, "original"));
  await mkdir(f.settings.root, { mode: 0o700 });
  for (const name of await readdir(join(f.base, "original")))
    await copyFile(join(f.base, "original", name), join(f.settings.root, name));
  const replaced = f.create();
  await expect(replaced.assertReady()).rejects.toThrow();
  await replaced.close();
});
it("refuses shared project storage, retained operation markers and contradictory catalogue bytes", async () => {
  const f = await fixture();
  for (const root of [f.objects, join(f.objects, "history"), f.base])
    expect(() =>
      requireRetainedProviderDispatchSettings(
        { ...f.settings, root },
        f.objects,
      ),
    ).toThrow();
  await provisionRetainedProviderDispatch(f.settings, f.objects);
  const lock = join(f.settings.root, ".journal-operation-v1.lock");
  await writeFile(lock, "", { mode: 0o600 });
  const locked = f.create();
  await expect(locked.assertReady()).rejects.toThrow();
  await locked.close();
  await rm(lock);
  await writeFile(
    join(f.settings.root, ".journal-catalog-v1.json"),
    '{"identity":"wrong"}',
    { mode: 0o600 },
  );
  const altered = f.create();
  await expect(altered.assertReady()).rejects.toThrow();
  await altered.close();
});
