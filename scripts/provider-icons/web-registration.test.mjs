import assert from "node:assert/strict";
import test from "node:test";

import {
  collectCanonicalProviderIconAssets,
  generateWebAssetModule,
} from "./web-registration.mjs";

const digest =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const sourceDigest =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function cognitoEntry(iconId, serviceName) {
  return {
    automatedSecurityResult: "passed",
    awsServiceFamily: "Amazon Cognito",
    destinationAssetId: "aws-architecture-cognito",
    file: "cognito.svg",
    iconId,
    mappingType: "service-family",
    mediaType: "image/svg+xml",
    normalizedBytes: 97,
    normalizedSha256: digest,
    serviceName,
    sourceBytes: 103,
    sourceMember:
      "Architecture-Service-Icons/Arch_Security-Identity-Compliance/48/Arch_Amazon-Cognito_48.svg",
    sourceSha256: sourceDigest,
    state: "approved",
    transformationSteps: ["validate-svg-v1"],
    viewBox: "0 0 48 48",
  };
}

function manifest(entries) {
  return {
    approval: { approvedSurfaces: ["product-ui"] },
    entries,
  };
}

test("generates one canonical import for multiple exact icon ID aliases", () => {
  const userPool = cognitoEntry(
    "aws.cloudmarkup.icons.cognito",
    "Cognito user pool",
  );
  const appClient = cognitoEntry(
    "aws.cloudmarkup.icons.cognito-app-client",
    "Cognito app client",
  );

  const assets = collectCanonicalProviderIconAssets(
    manifest([userPool, appClient]),
  );
  assert.equal(assets.length, 1);
  assert.equal(assets[0].aliases.length, 2);

  const generated = generateWebAssetModule(manifest([userPool, appClient]));
  assert.equal(
    generated.match(
      /from "@cloudmarkup\/provider-aws\/assets\/icons\/cognito\.svg\?no-inline";/gu,
    )?.length,
    1,
  );
  assert.doesNotMatch(
    generated,
    /from "@cloudmarkup\/provider-aws\/assets\/icons\/cognito\.svg";/u,
  );
  assert.match(
    generated,
    /"aws\.cloudmarkup\.icons\.cognito": providerIconAsset0,/u,
  );
  assert.match(
    generated,
    /"aws\.cloudmarkup\.icons\.cognito-app-client": providerIconAsset0,/u,
  );
});

test("rejects aliases with divergent canonical evidence", () => {
  const userPool = cognitoEntry(
    "aws.cloudmarkup.icons.cognito",
    "Cognito user pool",
  );
  const appClient = {
    ...cognitoEntry(
      "aws.cloudmarkup.icons.cognito-app-client",
      "Cognito app client",
    ),
    sourceSha256:
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  };

  assert.throws(
    () => collectCanonicalProviderIconAssets(manifest([userPool, appClient])),
    /aliases disagree about canonical asset/u,
  );
});

test("rejects equal normalized bytes under multiple physical identities", () => {
  const userPool = cognitoEntry(
    "aws.cloudmarkup.icons.cognito",
    "Cognito user pool",
  );
  const duplicate = {
    ...cognitoEntry(
      "aws.cloudmarkup.icons.cognito-app-client",
      "Cognito app client",
    ),
    destinationAssetId: "aws-architecture-cognito-copy",
    file: "cognito-copy.svg",
  };

  assert.throws(
    () => collectCanonicalProviderIconAssets(manifest([userPool, duplicate])),
    /duplicated across destination assets/u,
  );
});
