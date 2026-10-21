import { canonicalJson, sha256Digest } from "./constants.js";

const version = "1.0.0" as const;
const templateDescriptor = Object.freeze({
  contractVersion: 1,
  id: "template.aws.lambda.http-no-content.typescript",
  version,
  capability: "application.http.authenticated-no-content",
  method: "GET",
  successStatus: 204,
  requestBody: "none",
  responseBody: "none",
  authentication: "managed-api-gateway-jwt-and-exact-auth-contract",
  persistentData: "none",
  network: "none",
  runtime: "nodejs24.x",
  language: "typescript",
  tests: [
    "authenticated-no-content",
    "missing-authorizer-denied",
    "unknown-route-denied",
  ],
});
const template = Object.freeze({
  id: templateDescriptor.id,
  version,
  digest: sha256Digest(canonicalJson(templateDescriptor)),
});
const pattern = Object.freeze({
  id: "pattern.aws.lambda.authenticated-http-no-content",
  version,
  digest: sha256Digest(
    canonicalJson({
      contractVersion: 1,
      template,
      behavior: templateDescriptor.capability,
    }),
  ),
});
const generator = Object.freeze({
  id: "generator.aws.lambda.http-no-content.typescript",
  version,
  digest: sha256Digest(
    canonicalJson({
      contractVersion: 1,
      version,
      templates: [template],
      patterns: [pattern],
    }),
  ),
});

/** Additive, explicit behavior; it grants no model admission or native-build receipt. */
export const HTTP_NO_CONTENT_RELEASE_V1 = Object.freeze({
  generator,
  template,
  pattern,
});
export const HTTP_NO_CONTENT_CAPABILITY = templateDescriptor.capability;
