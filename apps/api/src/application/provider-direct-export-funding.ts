import {
  digestCanonicalValue,
  solutionStableIdSchema,
} from "@cloudmarkup/schemas";

/** Persisted mode discriminator, never authorization or an entitlement by itself. */
export const PROVIDER_DIRECT_EXPORT_FUNDING_PREFIX_V1 =
  "provider-direct.export.v1.";
export function providerDirectExportFundingReferenceV1(
  authorityReference: string,
): string {
  return solutionStableIdSchema.parse(
    PROVIDER_DIRECT_EXPORT_FUNDING_PREFIX_V1 +
      digestCanonicalValue(
        solutionStableIdSchema.parse(authorityReference),
      ).slice(7),
  );
}
export function isProviderDirectExportFundingReferenceV1(
  reference: string,
): boolean {
  return /^provider-direct\.export\.v1\.[0-9a-f]{64}$/u.test(reference);
}
