import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CatalogServiceIcon } from "./CatalogServiceIcon.js";
import { createAwsIconRegistry } from "./aws-icon-registry.js";

describe("AWS icon registry composition", () => {
  it("resolves declared unmapped IDs as missing placeholders", () => {
    const iconId = "aws.cloudmarkup.icons.lambda";
    const registry = createAwsIconRegistry(
      aliasCatalog([iconId]),
      aliasManifest([placeholderRegistryEntry(iconId, "Lambda function")]),
    );

    expect(registry.resolve(iconId)).toMatchObject({
      kind: "placeholder",
      iconId,
      reason: "missing",
    });
    expect(
      registry.resolve("aws.cloudmarkup.icons.not-in-catalog"),
    ).toMatchObject({
      kind: "placeholder",
      reason: "missing",
    });

    const unknownReasonRegistry = createAwsIconRegistry(
      aliasCatalog([iconId]),
      aliasManifest([
        {
          ...placeholderRegistryEntry(iconId, "Lambda function"),
          placeholderReason: "technical source review required",
        },
      ]),
    );
    expect(unknownReasonRegistry.resolve(iconId)).toMatchObject({
      kind: "placeholder",
      reason: "integrity-failure",
    });
  });

  it("ignores iconless internal configuration concepts", () => {
    const iconId = "opaque.deployable";
    const registry = createAwsIconRegistry(
      aliasCatalog([null, iconId, null]),
      aliasManifest([placeholderRegistryEntry(iconId, "Deployable service")]),
    );

    expect(registry.resolve(iconId)).toMatchObject({
      iconId,
      kind: "placeholder",
      reason: "missing",
    });
  });

  it("requires explicit product UI approval before registering an asset", () => {
    const iconId = "opaque.approved";
    const catalog = aliasCatalog([iconId]);
    const entry = cognitoAliasEntry(iconId, "Approved service");
    const assetUrls = { [iconId]: "/assets/cognito.svg" };

    expect(
      createAwsIconRegistry(
        catalog,
        aliasManifest([entry], ["diagram-export"]),
        assetUrls,
      ).resolve(iconId),
    ).toMatchObject({
      kind: "placeholder",
      reason: "integrity-failure",
    });

    expect(
      createAwsIconRegistry(catalog, aliasManifest([entry]), assetUrls).resolve(
        iconId,
      ),
    ).toMatchObject({
      kind: "approved",
      sourceDigest: aliasNormalizedDigest,
    });
  });

  it("rejects a manifest that does not pin the exact catalog identity", () => {
    expect(() =>
      createAwsIconRegistry(
        aliasCatalog(["opaque.pending"], "2.0.0"),
        aliasManifest([
          placeholderRegistryEntry("opaque.pending", "Pending service"),
        ]),
      ),
    ).toThrow(/exact selected provider catalog/u);
  });

  it("renders through the injected registry with catalog-owned naming", () => {
    const iconId = "aws.cloudmarkup.icons.lambda";
    const registry = createAwsIconRegistry(
      aliasCatalog([iconId]),
      aliasManifest([placeholderRegistryEntry(iconId, "Lambda function")]),
    );
    render(
      <p>
        <CatalogServiceIcon
          iconId={iconId}
          registry={registry}
          serviceName="Lambda function"
        />
        Lambda function
      </p>,
    );

    expect(screen.getByText("Lambda function")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

const aliasCatalogDigest =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const aliasNormalizedDigest =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function cognitoAliasEntry(iconId: string, serviceName: string) {
  return {
    automatedSecurityResult: "passed",
    awsServiceFamily: "Amazon Cognito",
    destinationAssetId: "aws.architecture.cognito",
    file: "cognito.svg",
    iconId,
    mappingType: "service-family",
    mediaType: "image/svg+xml",
    normalizedBytes: 97,
    normalizedSha256: aliasNormalizedDigest,
    serviceName,
    sourceBytes: 103,
    sourceMember:
      "Architecture-Service-Icons/Arch_Security-Identity-Compliance/48/Arch_Amazon-Cognito_48.svg",
    sourceSha256:
      "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    state: "approved" as const,
    transformationSteps: ["validate-svg-v1"],
    viewBox: "0 0 48 48",
  };
}

function placeholderRegistryEntry(iconId: string, serviceName: string) {
  return {
    file: null,
    iconId,
    placeholderReason: "missing",
    serviceName,
    state: "placeholder" as const,
  };
}

function aliasCatalog(iconIds: readonly (string | null)[], version = "1.0.0") {
  return {
    artifact: {
      catalog: { id: "example.catalog", version },
      digest: aliasCatalogDigest,
      provider: { id: "example.provider" },
    },
    listServices: () => iconIds.map((iconId) => ({ iconId })),
  };
}

function aliasManifest(
  entries: readonly (
    | ReturnType<typeof cognitoAliasEntry>
    | ReturnType<typeof placeholderRegistryEntry>
  )[],
  approvedSurfaces: readonly string[] = [
    "diagram-export",
    "documentation",
    "product-ui",
  ],
) {
  return {
    approval: {
      approvedSurfaces,
    },
    assetSet: {
      digest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      id: "example.icons",
      providerId: "example.provider",
      version: "1.0.0",
    },
    catalogs: [
      {
        digest: aliasCatalogDigest,
        id: "example.catalog",
        version: "1.0.0",
      },
    ],
    entries,
  };
}

describe("AWS icon registry canonical aliases", () => {
  it("fails every alias closed when generated URLs drift", () => {
    const userPoolId = "aws.cloudmarkup.icons.cognito";
    const appClientId = "aws.cloudmarkup.icons.cognito-app-client";
    const registry = createAwsIconRegistry(
      aliasCatalog([userPoolId, appClientId]),
      aliasManifest([
        cognitoAliasEntry(userPoolId, "Cognito user pool"),
        cognitoAliasEntry(appClientId, "Cognito app client"),
      ]),
      {
        [appClientId]: "/assets/not-cognito.svg",
        [userPoolId]: "/assets/cognito.svg",
      },
    );

    expect(registry.resolve(userPoolId)).toMatchObject({
      kind: "placeholder",
      reason: "integrity-failure",
    });
    expect(registry.resolve(appClientId)).toMatchObject({
      kind: "placeholder",
      reason: "integrity-failure",
    });
  });
});
