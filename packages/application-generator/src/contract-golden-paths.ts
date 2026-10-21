const CONTRACT_PATH_PREFIX = "application/contracts/";
const CONTRACT_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const CONTRACT_FILENAME_PATTERN = /^[a-z0-9][a-z0-9_-]*\.json$/u;
const SEMANTIC_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const FULL_DIGEST_FILENAME_PATTERN = /[a-f0-9]{64}/u;

export const CONTRACT_GOLDEN_MAX_FILENAME_LENGTH = 96;
export const CONTRACT_GOLDEN_DIGEST_PREFIX_LENGTH = 12;

const JSON_EXTENSION = ".json";
const MAX_PLAIN_STEM_LENGTH =
  CONTRACT_GOLDEN_MAX_FILENAME_LENGTH - JSON_EXTENSION.length;
const MAX_SUFFIXED_STEM_LENGTH =
  MAX_PLAIN_STEM_LENGTH - CONTRACT_GOLDEN_DIGEST_PREFIX_LENGTH - 1;

export interface ContractGoldenIdentity {
  readonly canonicalPath: string;
  readonly checksum: string;
  readonly contractId: string;
  readonly contractVersion: string;
}

interface PlannedContractGolden extends ContractGoldenIdentity {
  readonly logicalStem: string;
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function logicalStem(contractId: string, contractVersion: string): string {
  if (!CONTRACT_ID_PATTERN.test(contractId)) {
    throw new TypeError(
      "Prompt 30 contract IDs must be namespaced identifiers.",
    );
  }
  if (!SEMANTIC_VERSION_PATTERN.test(contractVersion)) {
    throw new TypeError(
      "Prompt 30 contract versions must be semantic versions.",
    );
  }
  const segments = contractId.split(".");
  const meaningfulSegments =
    segments[0] === "contracts" && segments.length > 1
      ? segments.slice(1)
      : segments;
  const versionSegment = contractVersion
    .replace(/[^0-9A-Za-z]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  const stem = `${meaningfulSegments.join("-")}-v${versionSegment}`
    .normalize("NFC")
    .toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(stem)) {
    throw new TypeError(
      "Prompt 30 contract identity has no portable logical name.",
    );
  }
  return stem;
}

function validateIdentity(
  value: ContractGoldenIdentity,
): PlannedContractGolden {
  const canonicalFilename = value.canonicalPath.slice(
    CONTRACT_PATH_PREFIX.length,
  );
  if (
    !value.canonicalPath.startsWith(CONTRACT_PATH_PREFIX) ||
    value.canonicalPath.length === CONTRACT_PATH_PREFIX.length ||
    value.canonicalPath.includes("\\") ||
    value.canonicalPath.includes("../") ||
    value.canonicalPath.slice(CONTRACT_PATH_PREFIX.length).includes("/") ||
    value.canonicalPath !== value.canonicalPath.normalize("NFC") ||
    !CONTRACT_FILENAME_PATTERN.test(canonicalFilename) ||
    !value.canonicalPath.endsWith(JSON_EXTENSION)
  ) {
    throw new TypeError(
      "Prompt 30 contract paths must be flat portable application/contracts JSON paths.",
    );
  }
  if (!SHA256_PATTERN.test(value.checksum)) {
    throw new TypeError(
      "Prompt 30 contract checksums must be complete SHA-256 values.",
    );
  }
  return {
    ...value,
    logicalStem: logicalStem(value.contractId, value.contractVersion),
  };
}

export function projectContractGoldenPaths(
  values: readonly ContractGoldenIdentity[],
): ReadonlyMap<string, string> {
  const plans = values.map(validateIdentity);
  const canonicalPaths = new Map<string, string>();
  for (const plan of plans) {
    const portablePath = plan.canonicalPath.normalize("NFC").toLowerCase();
    const existing = canonicalPaths.get(portablePath);
    if (existing !== undefined) {
      throw new Error(
        `Duplicate Prompt 30 contract source path: ${existing} and ${plan.canonicalPath}.`,
      );
    }
    canonicalPaths.set(portablePath, plan.canonicalPath);
  }

  const countByLogicalStem = new Map<string, number>();
  for (const plan of plans) {
    countByLogicalStem.set(
      plan.logicalStem,
      (countByLogicalStem.get(plan.logicalStem) ?? 0) + 1,
    );
  }

  const candidateOwner = new Map<string, string>();
  const projected = new Map<string, string>();
  for (const plan of [...plans].sort((left, right) =>
    compareUtf16(left.canonicalPath, right.canonicalPath),
  )) {
    const needsSuffix =
      plan.logicalStem.length > MAX_PLAIN_STEM_LENGTH ||
      (countByLogicalStem.get(plan.logicalStem) ?? 0) > 1;
    const stem = needsSuffix
      ? `${plan.logicalStem.slice(0, MAX_SUFFIXED_STEM_LENGTH).replace(/-+$/u, "")}-${plan.checksum.slice(7, 7 + CONTRACT_GOLDEN_DIGEST_PREFIX_LENGTH)}`
      : plan.logicalStem;
    const candidate = `${stem}${JSON_EXTENSION}`;
    if (
      candidate.length > CONTRACT_GOLDEN_MAX_FILENAME_LENGTH ||
      FULL_DIGEST_FILENAME_PATTERN.test(candidate) ||
      candidate.includes("/") ||
      candidate.includes("\\")
    ) {
      throw new Error(
        `Unsafe Prompt 30 contract golden filename: ${candidate}.`,
      );
    }
    const portableCandidate = candidate.normalize("NFC").toLowerCase();
    const existing = candidateOwner.get(portableCandidate);
    if (existing !== undefined) {
      throw new Error(
        `Prompt 30 contract short-digest collision for ${candidate}: ${existing} and ${plan.canonicalPath}.`,
      );
    }
    candidateOwner.set(portableCandidate, plan.canonicalPath);
    projected.set(plan.canonicalPath, candidate);
  }
  return projected;
}
