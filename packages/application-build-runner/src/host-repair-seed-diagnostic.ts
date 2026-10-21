import type {
  ApplicationBuildCommandResult,
  ApplicationBuildSourceFileV1,
} from "./contracts.js";
import { HOST_REPAIR_SEED_EXTENSION_PATH } from "./host-repair-seed-contracts.js";
import { sha256Digest } from "./security.js";

/** A strict observation of this one intentional defect, never a repair grade. */
export function inspectHostRepairSeedTypeFailure(
  result: ApplicationBuildCommandResult,
  source: ApplicationBuildSourceFileV1,
) {
  if (
    result.termination !== "completed" ||
    result.exitCode === null ||
    result.exitCode <= 0 ||
    !Number.isInteger(result.exitCode) ||
    source.path !== HOST_REPAIR_SEED_EXTENSION_PATH ||
    source.ownership !== "user-owned" ||
    sha256Digest(source.content) !== source.checksum ||
    result.outputBytes > 8192 ||
    result.outputBytes !==
      Buffer.byteLength(result.stdout, "utf8") +
        Buffer.byteLength(result.stderr, "utf8")
  )
    return undefined;
  const output =
    result.stdout === ""
      ? result.stderr
      : result.stderr === ""
        ? result.stdout
        : undefined;
  if (output === undefined || /[^\t\n\r\x20-\x7e]/u.test(output))
    return undefined;
  const lines = source.content.split("\n");
  const declaration = 'export const repairSeedTypeWitness: number = "invalid";';
  const matches = lines.flatMap((line, index) =>
    line === declaration ? [index + 1] : [],
  );
  if (matches.length !== 1) return undefined;
  const expected = `${HOST_REPAIR_SEED_EXTENSION_PATH}(${String(matches[0])},14): error TS2322: Type 'string' is not assignable to type 'number'.`;
  const normalized = output.replaceAll("\r\n", "\n");
  if (normalized !== expected && normalized !== expected + "\n")
    return undefined;
  return {
    code: "TS2322" as const,
    path: HOST_REPAIR_SEED_EXTENSION_PATH,
    line: matches[0],
    column: 14 as const,
    sourceDigest: source.checksum,
  };
}
