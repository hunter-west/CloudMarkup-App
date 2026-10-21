import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./canonical-json.mjs";
import {
  calculateAssetSetDigest,
  createPlaceholderEntry,
  IMPORT_TOOL_ID,
  IMPORT_TOOL_VERSION,
  PROVIDER_ICON_ACCESSIBILITY_CONTRACT,
  PROVIDER_ICON_APPROVED_SURFACES,
  PROVIDER_ICON_MANIFEST_CONTRACT_VERSION,
  PROVIDER_ICON_MANIFEST_KIND,
  PROVIDER_ICON_TRADEMARK_ACKNOWLEDGMENT,
} from "./manifest-contract.mjs";
import { PROVIDER_ICON_TRANSFORMATION_STEPS } from "./transformation-steps.mjs";
import { generateWebAssetModule } from "./web-registration.mjs";

export const testCatalog = Object.freeze({
  catalogDigest:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  catalogId: "example.catalog",
  catalogVersion: "1.0.0",
  providerId: "example.provider",
  services: Object.freeze([
    Object.freeze({
      iconId: "example.icons.compute",
      serviceName: "Example compute",
    }),
    Object.freeze({
      iconId: "example.icons.database",
      serviceName: "Example database",
    }),
  ]),
});

export const safeSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>\n';

export const testApproval = Object.freeze({
  accessibilityContract: PROVIDER_ICON_ACCESSIBILITY_CONTRACT,
  approvalDate: "2026-08-01",
  approvedSurfaces: PROVIDER_ICON_APPROVED_SURFACES,
  recordId: "CM-TEST-PROVIDER-ICONS-2026-08-01",
  reviewerName: "Test Product Owner",
  reviewerRelationship: "Provider partner",
  reviewerRole: "Cloud Markup product owner",
  trademarkUseAcknowledgment: PROVIDER_ICON_TRADEMARK_ACKNOWLEDGMENT,
});

export const testImportMetadata = Object.freeze({
  approval: testApproval,
  assetSetVersion: "1.0.0",
  importedAt: "2026-08-01T12:00:00.000Z",
  packageLabel: "official-test-package.zip",
  packageSha256:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  packageVersion: "1.0.0",
  selectedSourceSha256: sha256(
    canonicalJson([
      {
        sourceFile: "compute.svg",
        sourceSha256: sha256(safeSvg),
      },
    ]),
  ),
  sourceOrigin: "https://example.invalid/official-source",
});

export function createTestMapping({
  awsServiceFamily = "Example Compute",
  destinationAssetId = "example.provider.assets.compute",
  iconId = "example.icons.compute",
  mappingType = "exact-resource",
  outputFile = "compute.svg",
  sourceFile = "compute.svg",
} = {}) {
  return {
    awsServiceFamily,
    destinationAssetId,
    iconId,
    mappingType,
    outputFile,
    sourceFile,
  };
}

export function createPlaceholderManifest(
  services = testCatalog.services,
  catalog = testCatalog,
) {
  const manifestWithoutDigest = {
    approval: { ...testApproval },
    assetSet: {
      digest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      id: "example.provider.icons",
      providerId: catalog.providerId,
      version: "0.0.0-placeholder.1",
    },
    catalogs: [
      {
        digest: catalog.catalogDigest,
        id: catalog.catalogId,
        version: catalog.catalogVersion,
      },
    ],
    contractVersion: PROVIDER_ICON_MANIFEST_CONTRACT_VERSION,
    entries: [...services]
      .sort((left, right) => left.iconId.localeCompare(right.iconId))
      .map((service) =>
        createPlaceholderEntry(service.iconId, service.serviceName),
      ),
    kind: PROVIDER_ICON_MANIFEST_KIND,
    source: {
      importedAt: testImportMetadata.importedAt,
      origin: testImportMetadata.sourceOrigin,
      packageLabel: testImportMetadata.packageLabel,
      packageSha256: testImportMetadata.packageSha256,
      packageVersion: testImportMetadata.packageVersion,
    },
    transformation: {
      steps: [...PROVIDER_ICON_TRANSFORMATION_STEPS],
      tool: IMPORT_TOOL_ID,
      version: IMPORT_TOOL_VERSION,
    },
  };

  return {
    ...manifestWithoutDigest,
    assetSet: {
      ...manifestWithoutDigest.assetSet,
      digest: calculateAssetSetDigest(manifestWithoutDigest),
    },
  };
}

export function createApprovedEntry({
  awsServiceFamily = "Example Compute",
  destinationAssetId = "example.provider.assets.compute",
  file = "compute.svg",
  iconId = "example.icons.compute",
  mappingType = "exact-resource",
  normalizedBytes = Buffer.byteLength(safeSvg),
  normalizedSha256 = sha256(safeSvg),
  serviceName = "Example compute",
  sourceBytes = Buffer.byteLength(safeSvg),
  sourceMember = "compute.svg",
  sourceSha256 = sha256(safeSvg),
  transformationSteps = PROVIDER_ICON_TRANSFORMATION_STEPS.slice(1),
  viewBox = "0 0 24 24",
} = {}) {
  return {
    automatedSecurityResult: "passed",
    awsServiceFamily,
    destinationAssetId,
    file,
    iconId,
    mappingType,
    mediaType: "image/svg+xml",
    normalizedBytes,
    normalizedSha256,
    serviceName,
    sourceBytes,
    sourceMember,
    sourceSha256,
    state: "approved",
    transformationSteps: [...transformationSteps],
    viewBox,
  };
}

export function createCandidateEntry(options = {}) {
  return {
    ...createApprovedEntry(options),
    state: "candidate",
  };
}

export function withCalculatedAssetSetDigest(manifest) {
  const withoutDigest = {
    ...manifest,
    assetSet: {
      ...manifest.assetSet,
      digest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  };
  return {
    ...withoutDigest,
    assetSet: {
      ...withoutDigest.assetSet,
      digest: calculateAssetSetDigest(withoutDigest),
    },
  };
}

export async function prepareAssetRoot(
  repositoryRoot,
  manifest = createPlaceholderManifest(),
) {
  const assetRoot = path.join(
    repositoryRoot,
    "packages",
    "provider-aws",
    "assets",
  );
  const registrationFile = path.join(
    repositoryRoot,
    "apps",
    "web",
    "src",
    "provider-icons",
    "aws-assets.generated.ts",
  );
  await mkdir(assetRoot, { recursive: true });
  await mkdir(path.dirname(registrationFile), { recursive: true });
  await writeFile(
    path.join(assetRoot, "README.md"),
    "# Test assets\n\nProvider icon controls are documented.\n",
  );
  await writeFile(
    path.join(assetRoot, "SOURCE_REVIEW.md"),
    `# Test source approval\n\nApproval record: ${manifest.approval.recordId}.\n`,
  );
  await writeFile(registrationFile, generateWebAssetModule(manifest));
  return { assetRoot, registrationFile };
}
