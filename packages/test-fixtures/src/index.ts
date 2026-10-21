export const architectureDocumentV1FixturePaths = {
  valid: ["fixtures/architecture-document/v1/valid/representative.json"],
  invalid: [
    "fixtures/architecture-document/v1/invalid/broken-references.json",
    "fixtures/architecture-document/v1/invalid/duplicate-node-id.json",
    "fixtures/architecture-document/v1/invalid/self-parent.json",
    "fixtures/architecture-document/v1/invalid/unsupported-schema-version.json",
  ],
} as const;

export const architectureDocumentV2FixturePaths = {
  valid: ["fixtures/architecture-document/v2/valid/representative.json"],
} as const;

export const intentDocumentV1FixturePaths = {
  valid: ["fixtures/intent-document/v1/valid/representative.json"],
  ambiguous: [
    "fixtures/intent-document/v1/ambiguous/unknown-requirements.json",
  ],
  conflicting: [
    "fixtures/intent-document/v1/conflicting/detectable-contradictions.json",
  ],
  invalid: [
    "fixtures/intent-document/v1/invalid/provider-service-capability.json",
  ],
} as const;

export const documentVersioningSnapshotPaths = {
  // Preserve the original v1 key for existing consumers.
  architecture:
    "fixtures/document-versioning/snapshots/architecture-document-v1.canonical.json",
  architectureV1:
    "fixtures/document-versioning/snapshots/architecture-document-v1.canonical.json",
  architectureV2:
    "fixtures/document-versioning/snapshots/architecture-document-v2.canonical.json",
  intent:
    "fixtures/document-versioning/snapshots/intent-document-v1.canonical.json",
} as const;
