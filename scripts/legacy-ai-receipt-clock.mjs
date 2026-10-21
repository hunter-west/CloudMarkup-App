import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const LEGACY_CLOCK_V2_CONTRACT = Object.freeze(
  JSON.parse(
    readFileSync(
      new URL("./fixtures/legacy-ai-receipt-clock-v2.json", import.meta.url),
      "utf8",
    ),
  ),
);
const contract = LEGACY_CLOCK_V2_CONTRACT;
if (
  Object.keys(contract).sort().join(",") !==
    "adapter,baseBundleSha256,baseManifestSha256,bundleFile,bundleSha256,contractVersion,sizeBytes,sourceCommit" ||
  contract.contractVersion !== 2 ||
  contract.sourceCommit !== "a979e325b6584642d5d5a9b58631bd3599d85591" ||
  contract.baseBundleSha256 !==
    "d16066d5e30fc2ef2100cf794fc524ae75ce042e47140dde6ad970f341168531" ||
  contract.baseManifestSha256 !==
    "3ef9b89235d930be3c10c66b08a118210cea8e11aeebf1bf2804296aa342b088" ||
  contract.adapter !== "synthetic-configuration-caller-clock-only" ||
  contract.bundleFile !== "packages/model-gateway/dist/capture-clock-v2.mjs" ||
  !/^[a-f0-9]{64}$/u.test(contract.bundleSha256) ||
  contract.sizeBytes !== 5599794
)
  throw new Error("Unreviewed historical synthetic-clock contract.");

const fixtureHeader =
  "// apps/api/dist/adapters/persistence/model-live-runtime-host-evidence-test-helpers.js\n";
export const LEGACY_CLOCK_V1_WINDOW =
  '        effectiveFrom: "2026-09-01T00:00:00.000Z",\n' +
  '        effectiveUntil: "2026-10-01T00:00:00.000Z",';
export const LEGACY_CLOCK_V2_WINDOW =
  "        effectiveFrom: new Date(Date.parse(original.now) - 86400000).toISOString(),\n" +
  "        effectiveUntil: new Date(Date.parse(original.now) + 86400000).toISOString(),";

export function rebaseLegacySyntheticClockWindow(text) {
  const moduleStart = text.indexOf(fixtureHeader);
  const moduleEnd = text.indexOf("\n// ", moduleStart + fixtureHeader.length);
  const windowStart = text.indexOf(LEGACY_CLOCK_V1_WINDOW);
  if (
    moduleStart < 0 ||
    moduleStart !== text.lastIndexOf(fixtureHeader) ||
    moduleEnd < 0 ||
    windowStart < moduleStart + fixtureHeader.length ||
    windowStart + LEGACY_CLOCK_V1_WINDOW.length > moduleEnd ||
    windowStart !== text.lastIndexOf(LEGACY_CLOCK_V1_WINDOW)
  )
    throw new Error("Historical synthetic-clock window is not exact.");
  return text.replace(LEGACY_CLOCK_V1_WINDOW, LEGACY_CLOCK_V2_WINDOW);
}

/** Derive a separately pinned test artifact. V1 bytes and every production
 * module stay intact; only the synthetic helper's two date expressions differ. */
export function createLegacyClockAdapterV2(bytes) {
  if (!Buffer.isBuffer(bytes) || sha256(bytes) !== contract.baseBundleSha256)
    throw new Error(
      "Historical synthetic-clock adapter requires exact V1 bytes.",
    );
  const adapted = Buffer.from(
    rebaseLegacySyntheticClockWindow(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ),
  );
  if (
    adapted.length !== contract.sizeBytes ||
    sha256(adapted) !== contract.bundleSha256
  )
    throw new Error("Historical synthetic-clock adapter differs from its pin.");
  return adapted;
}
