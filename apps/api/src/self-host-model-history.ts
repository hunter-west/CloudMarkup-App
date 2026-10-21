import { z } from "zod";
import { isAbsolute } from "node:path";
import { loadSelfHostMigrationProfile } from "./self-host/migration-profile.js";
import { provisionRetainedProviderDispatch } from "./self-host/retained-provider-dispatch.js";

const inputSchema = z
  .object({
    contractVersion: z.literal(1),
    acknowledge: z.literal("new-independent-provider-dispatch-v1"),
    profileManifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    objectRoot: z.string().min(1).max(4096).refine(isAbsolute),
    settings: z
      .object({
        root: z.string().min(1).max(4096),
        identity: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
  })
  .strict();

/** Explicit offline new-directory operation. It resolves no credential, opens
 * no database/network connection, and cannot repair/recreate missing history
 * during ordinary startup or SQL restore. The operator owns external retention. */
export async function provisionSelfHostProviderDispatchHistory(raw: unknown) {
  if (process.platform !== "linux")
    throw Error(
      "Provider dispatch history provisioning requires the isolated Linux operator.",
    );
  const input = inputSchema.parse(structuredClone(raw));
  const profile = await loadSelfHostMigrationProfile();
  if (input.profileManifestSha256 !== profile.identity.manifestSha256)
    throw Error("Provider dispatch profile approval is stale.");
  await provisionRetainedProviderDispatch(input.settings, input.objectRoot);
  return Object.freeze({
    contractVersion: 1,
    state: "new-directory-provisioned",
    identity: input.settings.identity,
    profileManifestSha256: profile.identity.manifestSha256,
    nativeRecoveryQualified: false,
  });
}
export { assertSelfHostProviderDirectSchema } from "./self-host/models-runtime.js";
