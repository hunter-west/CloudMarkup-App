export type IconPlaceholderReason =
  | "pending-approval"
  | "missing"
  | "rejected"
  | "withdrawn"
  | "integrity-failure";

export interface IconAssetSetIdentity {
  readonly id: string;
  readonly providerId: string;
  readonly version: string;
  readonly digest: string;
}

export type IconResolution<TAsset, TIconId extends string = string> =
  | {
      readonly kind: "approved";
      readonly iconId: TIconId;
      readonly asset: TAsset;
      readonly assetSet: IconAssetSetIdentity;
      readonly sourceDigest: string;
    }
  | {
      readonly kind: "placeholder";
      readonly iconId: TIconId;
      readonly asset: TAsset;
      readonly assetSet: IconAssetSetIdentity;
      readonly reason: IconPlaceholderReason;
    };

export type IconRegistration<TAsset, TIconId extends string = string> =
  | {
      readonly kind: "approved";
      readonly iconId: TIconId;
      readonly asset: TAsset;
      readonly sourceDigest: string;
    }
  | {
      readonly kind: "placeholder";
      readonly iconId: TIconId;
      readonly reason: Exclude<IconPlaceholderReason, "missing">;
    };

export interface IconRegistry<TAsset, TIconId extends string = string> {
  readonly assetSet: IconAssetSetIdentity;
  resolve(iconId: TIconId): IconResolution<TAsset, TIconId>;
}

export interface CreateIconRegistryOptions<
  TAsset,
  TIconId extends string = string,
> {
  readonly assetSet: IconAssetSetIdentity;
  readonly placeholderAsset: TAsset;
  readonly registrations: readonly IconRegistration<TAsset, TIconId>[];
}

const SHA_256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function assertNonEmptyText(value: string, field: string): void {
  if (value.trim() === "") {
    throw new TypeError(`${field} must be non-empty.`);
  }
}

function assertDigest(value: string, field: string): void {
  if (!SHA_256_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest.`);
  }
}

function normalizeAssetSet(
  identity: IconAssetSetIdentity,
): IconAssetSetIdentity {
  assertNonEmptyText(identity.id, "Asset-set ID");
  assertNonEmptyText(identity.providerId, "Provider ID");
  assertNonEmptyText(identity.version, "Asset-set version");
  assertDigest(identity.digest, "Asset-set digest");

  return Object.freeze({
    id: identity.id,
    providerId: identity.providerId,
    version: identity.version,
    digest: identity.digest,
  });
}

/**
 * Builds a read-only, exact-ID registry. The registry never interprets an icon
 * ID as a provider, filename, service, or visual category.
 */
export function createIconRegistry<TAsset, TIconId extends string = string>(
  options: CreateIconRegistryOptions<TAsset, TIconId>,
): IconRegistry<TAsset, TIconId> {
  const assetSet = normalizeAssetSet(options.assetSet);
  const registrations = new Map<TIconId, IconRegistration<TAsset, TIconId>>();

  for (const registration of options.registrations) {
    assertNonEmptyText(registration.iconId, "Icon ID");
    if (registrations.has(registration.iconId)) {
      throw new TypeError("Icon registrations must use unique exact IDs.");
    }
    if (registration.kind === "approved") {
      assertDigest(registration.sourceDigest, "Icon source digest");
    }
    registrations.set(registration.iconId, Object.freeze({ ...registration }));
  }

  return Object.freeze({
    assetSet,
    resolve(iconId: TIconId): IconResolution<TAsset, TIconId> {
      assertNonEmptyText(iconId, "Icon ID");
      const registration = registrations.get(iconId);

      if (registration === undefined) {
        const resolution: IconResolution<TAsset, TIconId> = {
          kind: "placeholder",
          iconId,
          asset: options.placeholderAsset,
          assetSet,
          reason: "missing",
        };
        return Object.freeze(resolution);
      }

      if (registration.kind === "placeholder") {
        const resolution: IconResolution<TAsset, TIconId> = {
          kind: "placeholder",
          iconId,
          asset: options.placeholderAsset,
          assetSet,
          reason: registration.reason,
        };
        return Object.freeze(resolution);
      }

      const resolution: IconResolution<TAsset, TIconId> = {
        kind: "approved",
        iconId,
        asset: registration.asset,
        assetSet,
        sourceDigest: registration.sourceDigest,
      };
      return Object.freeze(resolution);
    },
  });
}
