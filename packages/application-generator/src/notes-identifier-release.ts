import {
  APPLICATION_GENERATOR_ID,
  NOTES_PATTERN_ID,
  SUPPORTED_OPERATION_KINDS,
  SUPPORTED_RELATIONSHIPS,
  TEMPLATE_DESCRIPTOR,
  canonicalJson,
  sha256Digest,
} from "./constants.js";

// Explicit successor: historical descriptors and rendering remain unchanged.
const version = "1.1.0" as const;
const templateDescriptor = Object.freeze({
  ...TEMPLATE_DESCRIPTOR,
  version,
  pattern: Object.freeze({ id: NOTES_PATTERN_ID, version }),
  entityTypeIdentity: "sha256-canonical-contract-id-and-version-v1",
});
const template = Object.freeze({
  id: templateDescriptor.id,
  version,
  digest: sha256Digest(canonicalJson(templateDescriptor)),
});
const pattern = Object.freeze({
  id: NOTES_PATTERN_ID,
  version,
  digest: sha256Digest(
    canonicalJson({
      contractVersion: 1,
      id: NOTES_PATTERN_ID,
      version,
      templateDigest: template.digest,
      supportedDataOperations: SUPPORTED_OPERATION_KINDS,
      supportedRelationships: Object.values(SUPPORTED_RELATIONSHIPS),
    }),
  ),
});
const generator = Object.freeze({
  id: APPLICATION_GENERATOR_ID,
  version,
  digest: sha256Digest(
    canonicalJson({
      contractVersion: 1,
      id: APPLICATION_GENERATOR_ID,
      version,
      templates: [template],
    }),
  ),
});
export const NOTES_IDENTIFIER_RELEASE_V1_1 = Object.freeze({
  generator,
  template,
  pattern,
});
