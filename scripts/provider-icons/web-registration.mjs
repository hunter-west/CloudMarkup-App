import { compareText } from "./canonical-json.mjs";
import { physicalEvidence } from "./manifest-contract.mjs";

const GENERATED_HEADER = `/*
 * Generated from the checked provider-icon manifest by controlled local tooling.
 * Do not edit by hand. Provider assets remain governed by the checked manifest.
 */
`;

/**
 * Collects approved canonical assets while proving that aliases agree on all
 * source and normalized-byte evidence. Equal normalized bytes must always use
 * one destination identity and one physical filename.
 */
export function collectCanonicalProviderIconAssets(manifest) {
  const assetsByDestinationId = new Map();
  const destinationIdByFile = new Map();
  const destinationIdByDigest = new Map();

  const approvedEntries = manifest.entries
    .filter((entry) => entry.state === "approved")
    .sort((left, right) => compareText(left.iconId, right.iconId));
  for (const entry of approvedEntries) {
    const evidence = physicalEvidence(entry);
    const existingAsset = assetsByDestinationId.get(entry.destinationAssetId);
    if (existingAsset !== undefined && existingAsset.evidence !== evidence) {
      throw new TypeError(
        `Provider icon aliases disagree about canonical asset ${entry.destinationAssetId}.`,
      );
    }

    const fileDestinationId = destinationIdByFile.get(entry.file);
    if (
      fileDestinationId !== undefined &&
      fileDestinationId !== entry.destinationAssetId
    ) {
      throw new TypeError(
        `Provider icon file ${entry.file} is assigned to multiple destination asset IDs.`,
      );
    }

    const digestDestinationId = destinationIdByDigest.get(
      entry.normalizedSha256,
    );
    if (
      digestDestinationId !== undefined &&
      digestDestinationId !== entry.destinationAssetId
    ) {
      throw new TypeError(
        `Normalized provider icon ${entry.normalizedSha256} is duplicated across destination assets.`,
      );
    }

    if (existingAsset === undefined) {
      assetsByDestinationId.set(entry.destinationAssetId, {
        aliases: [entry],
        destinationAssetId: entry.destinationAssetId,
        evidence,
        file: entry.file,
        normalizedBytes: entry.normalizedBytes,
        normalizedSha256: entry.normalizedSha256,
      });
    } else {
      existingAsset.aliases.push(entry);
    }
    destinationIdByFile.set(entry.file, entry.destinationAssetId);
    destinationIdByDigest.set(entry.normalizedSha256, entry.destinationAssetId);
  }

  return [...assetsByDestinationId.values()]
    .sort((left, right) => compareText(left.file, right.file))
    .map((asset) =>
      Object.freeze({
        aliases: Object.freeze([...asset.aliases]),
        destinationAssetId: asset.destinationAssetId,
        file: asset.file,
        normalizedBytes: asset.normalizedBytes,
        normalizedSha256: asset.normalizedSha256,
      }),
    );
}

export function generateWebAssetModule(manifest) {
  const canonicalAssets = collectCanonicalProviderIconAssets(manifest);
  const productUiApproved =
    manifest.approval.approvedSurfaces.includes("product-ui");
  const admittedEntries = productUiApproved
    ? canonicalAssets
        .flatMap((asset) => asset.aliases)
        .sort((left, right) => compareText(left.iconId, right.iconId))
    : [];
  const files = productUiApproved
    ? canonicalAssets.map((asset) => asset.file)
    : [];
  const identifierByFile = new Map(
    files.map((file, index) => [file, `providerIconAsset${index}`]),
  );
  const imports = files
    .map(
      (file) =>
        `import ${identifierByFile.get(file)} from "@cloudmarkup/provider-aws/assets/icons/${file}?no-inline";`,
    )
    .join("\n");
  const mappings = admittedEntries
    .map((entry) => {
      const key = JSON.stringify(entry.iconId);
      const value = `${identifierByFile.get(entry.file)},`;
      const singleLine = `    ${key}: ${value}`;
      return singleLine.length > 80
        ? `    ${key}:\n      ${value}`
        : singleLine;
    })
    .join("\n");

  return `${GENERATED_HEADER}${imports === "" ? "" : `\n${imports}\n`}
export const awsProviderIconAssetsByIconId: Readonly<Record<string, string>> =
  Object.freeze({${mappings === "" ? "" : `\n${mappings}\n`}  });
`;
}
