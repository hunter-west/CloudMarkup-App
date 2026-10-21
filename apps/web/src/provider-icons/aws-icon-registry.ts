import {
  createIconRegistry,
  NeutralProviderIcon,
  type IconRegistration,
  type IconRegistry,
} from "@cloudmarkup/ui";
import awsProviderIconManifest from "@cloudmarkup/provider-aws/assets/provider-icons.manifest.json";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { createElement, type ReactNode } from "react";

import { awsProviderIconAssetsByIconId } from "./aws-assets.generated.js";

interface CatalogWithIconReferences {
  readonly artifact: {
    readonly catalog: {
      readonly id: string;
      readonly version: string;
    };
    readonly digest: string;
    readonly provider: {
      readonly id: string;
    };
  };
  listServices(): readonly {
    readonly iconId: string | null;
  }[];
}

interface ApprovedProviderIconManifestEntry {
  readonly automatedSecurityResult: string;
  readonly awsServiceFamily: string;
  readonly destinationAssetId: string;
  readonly file: string;
  readonly iconId: string;
  readonly mappingType: string;
  readonly mediaType: string;
  readonly normalizedBytes: number;
  readonly normalizedSha256: string;
  readonly serviceName: string;
  readonly sourceBytes: number;
  readonly sourceMember: string;
  readonly sourceSha256: string;
  readonly state: "approved";
  readonly transformationSteps: readonly string[];
  readonly viewBox: string;
}

interface ProviderIconManifestEntryLike {
  readonly automatedSecurityResult?: string;
  readonly awsServiceFamily?: string;
  readonly destinationAssetId?: string;
  readonly file: string | null;
  readonly iconId: string;
  readonly mappingType?: string;
  readonly mediaType?: string;
  readonly normalizedBytes?: number;
  readonly normalizedSha256?: string;
  readonly placeholderReason?: string;
  readonly serviceName: string;
  readonly sourceBytes?: number;
  readonly sourceMember?: string;
  readonly sourceSha256?: string;
  readonly state: string;
  readonly transformationSteps?: readonly string[];
  readonly viewBox?: string;
}

interface ProviderIconManifestLike {
  readonly approval: {
    readonly approvedSurfaces: readonly string[];
  };
  readonly assetSet: {
    readonly digest: string;
    readonly id: string;
    readonly providerId: string;
    readonly version: string;
  };
  readonly catalogs: readonly {
    readonly digest: string;
    readonly id: string;
    readonly version: string;
  }[];
  readonly entries: readonly ProviderIconManifestEntryLike[];
}

function placeholderReasonForValue(
  value: string,
): "integrity-failure" | "pending-approval" | "rejected" | "withdrawn" {
  switch (value) {
    case "pending-approval":
      return "pending-approval";
    case "rejected":
      return "rejected";
    case "withdrawn":
      return "withdrawn";
    default:
      return "integrity-failure";
  }
}

function isApprovedProviderIconManifestEntry(
  entry: ProviderIconManifestEntryLike,
): entry is ApprovedProviderIconManifestEntry {
  return (
    entry.state === "approved" &&
    entry.file !== null &&
    typeof entry.automatedSecurityResult === "string" &&
    typeof entry.awsServiceFamily === "string" &&
    typeof entry.destinationAssetId === "string" &&
    typeof entry.mappingType === "string" &&
    typeof entry.mediaType === "string" &&
    typeof entry.normalizedBytes === "number" &&
    typeof entry.normalizedSha256 === "string" &&
    typeof entry.sourceBytes === "number" &&
    typeof entry.sourceMember === "string" &&
    typeof entry.sourceSha256 === "string" &&
    Array.isArray(entry.transformationSteps) &&
    entry.transformationSteps.every((step) => typeof step === "string") &&
    typeof entry.viewBox === "string"
  );
}

function canonicalAssetEvidence(entry: ApprovedProviderIconManifestEntry) {
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

function invalidAliasAssetIds(
  entries: readonly ProviderIconManifestEntryLike[],
  assetUrlsByIconId: Readonly<Partial<Record<string, string>>>,
): ReadonlySet<string> {
  const assetsByDestinationId = new Map<
    string,
    Readonly<{ assetUrl: string | undefined; evidence: string }>
  >();
  const destinationIdByFile = new Map<string, string>();
  const destinationIdByDigest = new Map<string, string>();
  const invalidAssetIds = new Set<string>();

  for (const entry of entries) {
    if (entry.state !== "approved") {
      continue;
    }
    if (!isApprovedProviderIconManifestEntry(entry)) {
      throw new TypeError(
        `Approved provider icon ${entry.iconId} has incomplete manifest evidence.`,
      );
    }
    if (entry.automatedSecurityResult !== "passed") {
      throw new TypeError(
        `Approved provider icon ${entry.iconId} lacks passing automated security evidence.`,
      );
    }
    const evidence = canonicalAssetEvidence(entry);
    const existing = assetsByDestinationId.get(entry.destinationAssetId);
    if (existing !== undefined && existing.evidence !== evidence) {
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

    const assetUrl = assetUrlsByIconId[entry.iconId];
    if (existing !== undefined && existing.assetUrl !== assetUrl) {
      invalidAssetIds.add(entry.destinationAssetId);
    } else if (existing === undefined) {
      assetsByDestinationId.set(entry.destinationAssetId, {
        assetUrl,
        evidence,
      });
    }
    destinationIdByFile.set(entry.file, entry.destinationAssetId);
    destinationIdByDigest.set(entry.normalizedSha256, entry.destinationAssetId);
  }

  return invalidAssetIds;
}

/**
 * Composes exact catalog IDs with the separately checked asset manifest and
 * generated static local imports. No filename or provider is inferred from an
 * icon ID.
 */
export function createAwsIconRegistry(
  catalog: CatalogWithIconReferences = awsCatalogV1,
  manifest: ProviderIconManifestLike = awsProviderIconManifest,
  assetUrlsByIconId: Readonly<
    Partial<Record<string, string>>
  > = awsProviderIconAssetsByIconId,
): IconRegistry<ReactNode> {
  if (manifest.assetSet.providerId !== catalog.artifact.provider.id) {
    throw new TypeError(
      "Provider icon manifest does not match the selected provider catalog.",
    );
  }
  const catalogRegistration = manifest.catalogs.find(
    (candidate) =>
      candidate.id === catalog.artifact.catalog.id &&
      candidate.version === catalog.artifact.catalog.version &&
      candidate.digest === catalog.artifact.digest,
  );
  if (catalogRegistration === undefined) {
    throw new TypeError(
      "Provider icon manifest does not pin the exact selected provider catalog.",
    );
  }

  const entriesById = new Map<
    string,
    ProviderIconManifestLike["entries"][number]
  >();
  for (const entry of manifest.entries) {
    if (entriesById.has(entry.iconId)) {
      throw new TypeError(
        "Provider icon manifest entries must use unique exact IDs.",
      );
    }
    entriesById.set(entry.iconId, entry);
  }

  const invalidAliasAssets = invalidAliasAssetIds(
    manifest.entries,
    assetUrlsByIconId,
  );
  const registrations: IconRegistration<ReactNode>[] = [];
  const seenCatalogIconIds = new Set<string>();
  for (const service of catalog.listServices()) {
    const iconId = service.iconId;
    if (iconId === null) {
      continue;
    }
    if (seenCatalogIconIds.has(iconId)) {
      throw new TypeError(
        "Provider catalog services must use unique exact IDs.",
      );
    }
    seenCatalogIconIds.add(iconId);
    const entry = entriesById.get(iconId);
    if (entry === undefined) {
      continue;
    }
    if (
      entry.state === "placeholder" &&
      entry.placeholderReason === "missing"
    ) {
      continue;
    }

    const assetUrl = assetUrlsByIconId[iconId];
    const approvedEntry = isApprovedProviderIconManifestEntry(entry)
      ? entry
      : undefined;
    if (
      manifest.approval.approvedSurfaces.includes("product-ui") &&
      approvedEntry?.automatedSecurityResult === "passed" &&
      !invalidAliasAssets.has(approvedEntry.destinationAssetId) &&
      assetUrl !== undefined
    ) {
      registrations.push({
        asset: createElement("img", {
          alt: "",
          "aria-hidden": true,
          className: "cm-provider-icon__asset",
          src: assetUrl,
        }),
        iconId,
        kind: "approved",
        sourceDigest: approvedEntry.normalizedSha256,
      });
      continue;
    }

    registrations.push({
      iconId,
      kind: "placeholder",
      reason:
        entry.state === "placeholder" &&
        typeof entry.placeholderReason === "string"
          ? placeholderReasonForValue(entry.placeholderReason)
          : "integrity-failure",
    });
  }

  return createIconRegistry<ReactNode>({
    assetSet: manifest.assetSet,
    placeholderAsset: createElement(NeutralProviderIcon, {
      className: "cm-service-icon__placeholder",
    }),
    registrations,
  });
}

export const awsIconRegistry = createAwsIconRegistry();
