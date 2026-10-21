import { relative, resolve, isAbsolute, parse } from "node:path";
import { z } from "zod";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import type { ServerByokInvocationBindingV1 } from "@cloudmarkup/model-gateway/server-byok";
import { DurableRecordDirectory } from "./retained-record-directory.js";

const settingsSchema = z
  .object({
    root: z.string().min(1).max(4096),
    identity: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export function requireRetainedProviderDispatchSettings(
  raw: unknown,
  objectRoot: string,
) {
  const value = settingsSchema.parse(structuredClone(raw));
  if (
    !isAbsolute(value.root) ||
    resolve(value.root) === parse(resolve(value.root)).root ||
    value.root.includes("\0") ||
    value.root.split(/[\\/]/u).includes("..")
  )
    throw Error("Retained dispatch configuration is unavailable.");
  const root = resolve(value.root);
  for (const [a, b] of [
    [root, objectRoot],
    [objectRoot, root],
  ] as const) {
    const between = relative(resolve(a), resolve(b));
    if (between === "" || (!between.startsWith("..") && !isAbsolute(between)))
      throw Error(
        "Retained dispatch storage must be independent of project content.",
      );
  }
  return Object.freeze({ root, identity: value.identity });
}

/** Independently retained no-replace dispatch history. Contains hashes only,
 * never prompts, responses, provider keys or copied tenant documents. A SQL
 * restore cannot reopen a retained job/role decision; ambiguous history holds. */
export class RetainedProviderDirectDispatchFence {
  readonly #directory: DurableRecordDirectory;
  constructor(
    settings: ReturnType<typeof requireRetainedProviderDispatchSettings>,
  ) {
    this.#directory = new DurableRecordDirectory(
      settings.root,
      settings.identity,
    );
  }
  assertReady(): Promise<void> {
    return this.#directory.assertReady();
  }
  async admit(binding: ServerByokInvocationBindingV1): Promise<void> {
    const key =
      digestCanonicalValue({
        organizationId: binding.scope.organizationId,
        projectId: binding.scope.projectId,
        jobId: binding.scope.jobId,
        feature: binding.feature,
        role: binding.role,
      }).slice(7) + ".dispatch-v1.json";
    if (
      !(await this.#directory.createOnce(key, {
        contractVersion: 1,
        bindingDigest: digestCanonicalValue(binding),
      }))
    )
      throw Error("A retained provider dispatch cannot be repeated.");
  }
  close(): Promise<void> {
    return this.#directory.close();
  }
}

/** Explicit offline operator action on a new directory. Never called by normal
 * server startup, a model call, recovery retry, or restore of an old SQL dump. */
export async function provisionRetainedProviderDispatch(
  raw: unknown,
  objectRoot: string,
): Promise<void> {
  const settings = requireRetainedProviderDispatchSettings(raw, objectRoot);
  const directory = new DurableRecordDirectory(
    settings.root,
    settings.identity,
  );
  try {
    await directory.provision();
    await directory.assertReady();
  } finally {
    await directory.close();
  }
}
