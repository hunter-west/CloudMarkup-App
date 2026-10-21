import { canonicalJson, compareText, sha256 } from "./canonical-json.mjs";
import { isSemanticVersion } from "./semantic-version.mjs";
import {
  BASE_PROVIDER_ICON_TRANSFORMATION_STEPS,
  PROVIDER_ICON_TRANSFORMATION_STEPS,
} from "./transformation-steps.mjs";

export const PROVIDER_ICON_MANIFEST_CONTRACT_VERSION = 2;
export const PROVIDER_ICON_MANIFEST_KIND =
  "cloudmarkup.provider-icon-asset-set";
export const IMPORT_TOOL_ID = "cloudmarkup-provider-icon-import";
export const IMPORT_TOOL_VERSION = "2.0.0";
export const PROVIDER_ICON_ACCESSIBILITY_CONTRACT =
  "supplementary-icon-with-visible-name-v1";
export const PROVIDER_ICON_TRADEMARK_ACKNOWLEDGMENT =
  "Product-owner approval for AWS service/resource identification only; not Cloud Markup branding, AWS endorsement, or outside-counsel advice.";
export const PROVIDER_ICON_APPROVED_SURFACES = Object.freeze([
  "diagram-export",
  "documentation",
  "product-ui",
]);

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ICON_ID_PATTERN = /^[a-z][a-z0-9.-]*$/u;
const FILE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/u;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const PLACEHOLDER_EVIDENCE_PATTERN =
  /^(?:not[- ]supplied|pending(?:[- ](?:approval|review))?|placeholder(?:[- ]evidence)?|tbd|none)[.!]?$/iu;
const APPROVED_ENTRY_KEYS = [
  "automatedSecurityResult",
  "awsServiceFamily",
  "destinationAssetId",
  "file",
  "iconId",
  "mappingType",
  "mediaType",
  "normalizedBytes",
  "normalizedSha256",
  "serviceName",
  "sourceBytes",
  "sourceMember",
  "sourceSha256",
  "state",
  "transformationSteps",
  "viewBox",
];
const PLACEHOLDER_ENTRY_KEYS = [
  "file",
  "iconId",
  "placeholderReason",
  "serviceName",
  "state",
];

function assert(condition, message) {
  if (!condition) {
    throw new TypeError(`Invalid provider icon manifest: ${message}`);
  }
}

function hasExactTransformationSteps(actual, expected) {
  return (
    Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected)
  );
}

function assertObject(value, path) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${path} must be an object.`,
  );
}

function assertExactKeys(value, expected, path) {
  assertObject(value, path);
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(sortedExpected),
    `${path} must contain exactly: ${sortedExpected.join(", ")}.`,
  );
}

function hasControlCharacters(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function assertText(value, path) {
  assert(
    typeof value === "string" &&
      value.trim() !== "" &&
      !hasControlCharacters(value),
    `${path} must be non-empty text without control characters.`,
  );
}

function assertReviewedText(value, path) {
  assertText(value, path);
  assert(
    !PLACEHOLDER_EVIDENCE_PATTERN.test(value.trim()),
    `${path} cannot contain placeholder evidence.`,
  );
}

function assertDigest(value, path) {
  assert(
    typeof value === "string" && DIGEST_PATTERN.test(value),
    `${path} must be a lowercase SHA-256 digest.`,
  );
}

function assertValidDate(value, path) {
  assert(
    typeof value === "string" && DATE_PATTERN.test(value),
    `${path} must use YYYY-MM-DD.`,
  );
  const parsed = new Date(`${value}T00:00:00.000Z`);
  assert(
    !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value,
    `${path} must be a valid calendar date.`,
  );
}

function assertSafeRelativeSourceMember(value, path) {
  assertText(value, path);
  assert(
    !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(value) &&
      !/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(value) &&
      !value
        .replaceAll("\\", "/")
        .split("/")
        .some(
          (segment) => segment === "" || segment === "." || segment === "..",
        ),
    `${path} must be a safe relative path.`,
  );
}

function validateMappedEntry(entry, index, expectedState) {
  const path = `entries[${index}]`;
  assertExactKeys(entry, APPROVED_ENTRY_KEYS, path);
  assert(
    entry.state === expectedState,
    `${path}.state must be ${expectedState}.`,
  );
  assert(
    entry.automatedSecurityResult === "passed",
    `${path}.automatedSecurityResult must be passed.`,
  );
  assert(
    ["exact-resource", "service-family"].includes(entry.mappingType),
    `${path}.mappingType is invalid.`,
  );
  for (const key of [
    "awsServiceFamily",
    "destinationAssetId",
    "file",
    "iconId",
    "serviceName",
    "sourceMember",
    "viewBox",
  ]) {
    assertText(entry[key], `${path}.${key}`);
  }
  assert(ICON_ID_PATTERN.test(entry.iconId), `${path}.iconId is invalid.`);
  assert(
    ICON_ID_PATTERN.test(entry.destinationAssetId),
    `${path}.destinationAssetId is invalid.`,
  );
  assert(
    FILE_PATTERN.test(entry.file),
    `${path}.file must be a deterministic SVG filename.`,
  );
  assertSafeRelativeSourceMember(entry.sourceMember, `${path}.sourceMember`);
  assertDigest(entry.sourceSha256, `${path}.sourceSha256`);
  assertDigest(entry.normalizedSha256, `${path}.normalizedSha256`);
  assert(
    Number.isSafeInteger(entry.sourceBytes) && entry.sourceBytes > 0,
    `${path}.sourceBytes is invalid.`,
  );
  assert(
    Number.isSafeInteger(entry.normalizedBytes) && entry.normalizedBytes > 0,
    `${path}.normalizedBytes is invalid.`,
  );
  assert(entry.mediaType === "image/svg+xml", `${path}.mediaType is invalid.`);
  assert(
    hasExactTransformationSteps(
      entry.transformationSteps,
      BASE_PROVIDER_ICON_TRANSFORMATION_STEPS,
    ) ||
      hasExactTransformationSteps(
        entry.transformationSteps,
        PROVIDER_ICON_TRANSFORMATION_STEPS,
      ),
    `${path}.transformationSteps is invalid.`,
  );
}

function validatePlaceholderEntry(entry, index) {
  const path = `entries[${index}]`;
  assertExactKeys(entry, PLACEHOLDER_ENTRY_KEYS, path);
  assert(entry.state === "placeholder", `${path}.state must be placeholder.`);
  assert(entry.file === null, `${path}.file must be null.`);
  assert(
    typeof entry.iconId === "string" && ICON_ID_PATTERN.test(entry.iconId),
    `${path}.iconId is invalid.`,
  );
  assertText(entry.serviceName, `${path}.serviceName`);
  assertReviewedText(entry.placeholderReason, `${path}.placeholderReason`);
}

function validateEntry(entry, index, mappedState) {
  assertObject(entry, `entries[${index}]`);
  if (entry.state === mappedState) {
    validateMappedEntry(entry, index, mappedState);
    return;
  }
  if (entry.state === "placeholder") {
    validatePlaceholderEntry(entry, index);
    return;
  }
  assert(false, `entries[${index}].state is invalid.`);
}

export function physicalEvidence(entry) {
  return JSON.stringify({
    automatedSecurityResult: entry.automatedSecurityResult,
    file: entry.file,
    mediaType: entry.mediaType,
    normalizedBytes: entry.normalizedBytes,
    normalizedSha256: entry.normalizedSha256,
    sourceBytes: entry.sourceBytes,
    sourceMember: entry.sourceMember,
    sourceSha256: entry.sourceSha256,
    transformationSteps: entry.transformationSteps,
    viewBox: entry.viewBox,
  });
}

function validateCanonicalAssets(entries, mappedState) {
  const evidenceByDestinationAssetId = new Map();
  const destinationByFile = new Map();
  const destinationByNormalizedSha256 = new Map();
  const evidenceBySourceMember = new Map();
  for (const entry of entries) {
    if (entry.state !== mappedState) {
      continue;
    }
    const evidence = physicalEvidence(entry);
    const priorEvidence = evidenceByDestinationAssetId.get(
      entry.destinationAssetId,
    );
    assert(
      priorEvidence === undefined || priorEvidence === evidence,
      `entries disagree about destination asset ${entry.destinationAssetId}.`,
    );
    evidenceByDestinationAssetId.set(entry.destinationAssetId, evidence);

    const priorFileDestination = destinationByFile.get(entry.file);
    assert(
      priorFileDestination === undefined ||
        priorFileDestination === entry.destinationAssetId,
      `file ${entry.file} identifies multiple destination assets.`,
    );
    destinationByFile.set(entry.file, entry.destinationAssetId);

    const priorDigestDestination = destinationByNormalizedSha256.get(
      entry.normalizedSha256,
    );
    assert(
      priorDigestDestination === undefined ||
        priorDigestDestination === entry.destinationAssetId,
      `normalized bytes ${entry.normalizedSha256} identify multiple destination assets.`,
    );
    destinationByNormalizedSha256.set(
      entry.normalizedSha256,
      entry.destinationAssetId,
    );

    const sourceEvidence = JSON.stringify({
      sourceBytes: entry.sourceBytes,
      sourceSha256: entry.sourceSha256,
    });
    const priorSourceEvidence = evidenceBySourceMember.get(entry.sourceMember);
    assert(
      priorSourceEvidence === undefined ||
        priorSourceEvidence === sourceEvidence,
      "entries disagree about selected source member " +
        entry.sourceMember +
        ".",
    );
    evidenceBySourceMember.set(entry.sourceMember, sourceEvidence);
  }
}

export function assetSetDigestProjection(manifest) {
  return {
    ...manifest,
    assetSet: {
      id: manifest.assetSet.id,
      providerId: manifest.assetSet.providerId,
      version: manifest.assetSet.version,
    },
  };
}

export function calculateAssetSetDigest(manifest) {
  return sha256(canonicalJson(assetSetDigestProjection(manifest)));
}

export function calculateSelectedSourceSha256(entries) {
  const sourceDigests = new Map();
  for (const entry of entries) {
    if (entry.state === "placeholder") {
      continue;
    }
    const priorDigest = sourceDigests.get(entry.sourceMember);
    assert(
      priorDigest === undefined || priorDigest === entry.sourceSha256,
      `entries disagree about selected source member ${entry.sourceMember}.`,
    );
    sourceDigests.set(entry.sourceMember, entry.sourceSha256);
  }

  return sha256(
    canonicalJson(
      [...sourceDigests.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([sourceFile, sourceSha256]) => ({
          sourceFile,
          sourceSha256,
        })),
    ),
  );
}

function validateProviderIconManifestForState(manifest, mappedState) {
  assertExactKeys(
    manifest,
    [
      "approval",
      "assetSet",
      "catalogs",
      "contractVersion",
      "entries",
      "kind",
      "source",
      "transformation",
    ],
    "manifest",
  );
  assert(
    manifest.contractVersion === PROVIDER_ICON_MANIFEST_CONTRACT_VERSION,
    "contractVersion is unsupported.",
  );
  assert(manifest.kind === PROVIDER_ICON_MANIFEST_KIND, "kind is invalid.");

  assertExactKeys(
    manifest.assetSet,
    ["digest", "id", "providerId", "version"],
    "assetSet",
  );
  for (const key of ["id", "providerId", "version"]) {
    assertText(manifest.assetSet[key], `assetSet.${key}`);
  }
  assert(ICON_ID_PATTERN.test(manifest.assetSet.id), "assetSet.id is invalid.");
  assert(
    ICON_ID_PATTERN.test(manifest.assetSet.providerId),
    "assetSet.providerId is invalid.",
  );
  assert(
    isSemanticVersion(manifest.assetSet.version),
    "assetSet.version must be semantic.",
  );
  assertDigest(manifest.assetSet.digest, "assetSet.digest");

  assert(
    Array.isArray(manifest.catalogs) && manifest.catalogs.length > 0,
    "catalogs is required.",
  );
  for (const [index, catalog] of manifest.catalogs.entries()) {
    assertExactKeys(catalog, ["digest", "id", "version"], `catalogs[${index}]`);
    assertText(catalog.id, `catalogs[${index}].id`);
    assertText(catalog.version, `catalogs[${index}].version`);
    assertDigest(catalog.digest, `catalogs[${index}].digest`);
    assert(
      ICON_ID_PATTERN.test(catalog.id),
      `catalogs[${index}].id is invalid.`,
    );
    assert(
      isSemanticVersion(catalog.version),
      `catalogs[${index}].version must be semantic.`,
    );
  }
  const catalogIdentities = manifest.catalogs.map(
    (catalog) => `${catalog.id}@${catalog.version}`,
  );
  assert(
    new Set(catalogIdentities).size === catalogIdentities.length,
    "catalogs contain duplicate identities.",
  );
  assert(
    JSON.stringify(catalogIdentities) ===
      JSON.stringify([...catalogIdentities].sort()),
    "catalogs must be sorted by exact identity.",
  );

  assertExactKeys(
    manifest.source,
    ["importedAt", "origin", "packageLabel", "packageSha256", "packageVersion"],
    "source",
  );
  for (const key of [
    "importedAt",
    "origin",
    "packageLabel",
    "packageVersion",
  ]) {
    assertReviewedText(manifest.source[key], `source.${key}`);
  }
  assertDigest(manifest.source.packageSha256, "source.packageSha256");
  assert(
    manifest.source.origin.startsWith("https://"),
    "source.origin must be an official HTTPS location.",
  );
  assert(
    UTC_TIMESTAMP_PATTERN.test(manifest.source.importedAt) &&
      !Number.isNaN(new Date(manifest.source.importedAt).getTime()),
    "source.importedAt must be an explicit valid UTC timestamp.",
  );
  assert(
    !/[\\/]/u.test(manifest.source.packageLabel),
    "source.packageLabel must not contain a local path.",
  );

  assertExactKeys(
    manifest.approval,
    [
      "accessibilityContract",
      "approvalDate",
      "approvedSurfaces",
      "recordId",
      "reviewerName",
      "reviewerRelationship",
      "reviewerRole",
      "trademarkUseAcknowledgment",
    ],
    "approval",
  );
  for (const key of [
    "recordId",
    "reviewerName",
    "reviewerRelationship",
    "reviewerRole",
  ]) {
    assertReviewedText(manifest.approval[key], `approval.${key}`);
  }
  assert(
    manifest.approval.reviewerRole === "Cloud Markup product owner",
    "approval.reviewerRole must be Cloud Markup product owner.",
  );
  assertValidDate(manifest.approval.approvalDate, "approval.approvalDate");
  assert(
    JSON.stringify(manifest.approval.approvedSurfaces) ===
      JSON.stringify(PROVIDER_ICON_APPROVED_SURFACES),
    `approval.approvedSurfaces must be exactly: ${PROVIDER_ICON_APPROVED_SURFACES.join(", ")}.`,
  );
  assert(
    manifest.approval.trademarkUseAcknowledgment ===
      PROVIDER_ICON_TRADEMARK_ACKNOWLEDGMENT,
    "approval.trademarkUseAcknowledgment is invalid.",
  );
  assert(
    manifest.approval.accessibilityContract ===
      PROVIDER_ICON_ACCESSIBILITY_CONTRACT,
    "approval.accessibilityContract is invalid.",
  );

  assertExactKeys(
    manifest.transformation,
    ["steps", "tool", "version"],
    "transformation",
  );
  assert(
    manifest.transformation.tool === IMPORT_TOOL_ID,
    "transformation.tool is invalid.",
  );
  assert(
    manifest.transformation.version === IMPORT_TOOL_VERSION,
    "transformation.version is invalid.",
  );
  assert(
    hasExactTransformationSteps(
      manifest.transformation.steps,
      PROVIDER_ICON_TRANSFORMATION_STEPS,
    ),
    "transformation.steps is invalid.",
  );

  assert(Array.isArray(manifest.entries), "entries must be an array.");
  manifest.entries.forEach((entry, index) =>
    validateEntry(entry, index, mappedState),
  );
  const iconIds = manifest.entries.map((entry) => entry.iconId);
  assert(
    new Set(iconIds).size === iconIds.length,
    "entries contain duplicate icon IDs.",
  );
  assert(
    JSON.stringify(iconIds) === JSON.stringify([...iconIds].sort()),
    "entries must be sorted by exact icon ID.",
  );
  validateCanonicalAssets(manifest.entries, mappedState);

  const expectedDigest = calculateAssetSetDigest(manifest);
  assert(
    manifest.assetSet.digest === expectedDigest,
    "assetSet.digest does not match canonical manifest content.",
  );

  return Object.freeze(manifest);
}

export function validateProviderIconManifest(manifest) {
  return validateProviderIconManifestForState(manifest, "approved");
}

export function validateProviderIconStagingManifest(manifest) {
  return validateProviderIconManifestForState(manifest, "candidate");
}

export function createPlaceholderEntry(
  iconId,
  serviceName,
  placeholderReason = "missing",
) {
  return {
    file: null,
    iconId,
    placeholderReason,
    serviceName,
    state: "placeholder",
  };
}
