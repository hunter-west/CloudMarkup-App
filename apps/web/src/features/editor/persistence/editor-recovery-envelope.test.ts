import {
  getArchitectureDocumentHashes,
  hashCanonicalValue,
  migrateArchitectureDocumentV1ToV2,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  parseArchitectureDocumentV1,
  parseArchitectureDocumentV3,
  serializeArchitectureDocumentV1,
  serializeArchitectureDocumentV2,
  serializeArchitectureDocumentV3,
  serializeCanonicalJson,
  type ConfigurationValue,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  foundationArchitectureInput,
  loadFoundationArchitectureDocument,
} from "../model/foundation-editor-fixture.js";
import {
  createEditorRecoveryBindingV1,
  createEditorRecoveryEnvelopeV1,
  EDITOR_RECOVERY_MAX_CANONICAL_BYTES,
  EDITOR_RECOVERY_MAX_DIAGNOSTIC_BYTES,
  inspectEditorRecoveryEnvelopeV1,
  prepareEditorRecoverySnapshotV1,
  serializeEditorRecoveryDiagnosticV1,
} from "./editor-recovery-envelope.js";
import type {
  EditorRecoveryDiagnosticV1,
  EditorRecoveryEnvelopeV1,
} from "./editor-recovery-store.js";

const SAVED_AT = "2026-07-30T12:00:00Z";
const WRITER_ID = "writer_recovery_envelope_test";

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function createReadyFixture() {
  const document = loadFoundationArchitectureDocument();
  const binding = createEditorRecoveryBindingV1({
    scopeKey: "project:recovery-envelope-test",
    seedDocument: document,
  });
  const prepared = prepareEditorRecoverySnapshotV1(binding, document);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) {
    throw new Error(
      prepared.diagnostic.diagnostics[0]?.message ??
        "The recovery fixture could not be prepared.",
    );
  }
  const envelope = createEditorRecoveryEnvelopeV1(prepared.snapshot, {
    generation: 1,
    savedAt: SAVED_AT,
    writerId: WRITER_ID,
  });
  return { binding, document, envelope, prepared };
}

function createLegacyArchitectureV1Envelope(
  binding: ReturnType<typeof createEditorRecoveryBindingV1>,
): unknown {
  const document = parseArchitectureDocumentV1(
    structuredClone(foundationArchitectureInput),
  );
  const canonicalDocument = serializeArchitectureDocumentV1(document);
  const snapshotDigest = hashCanonicalValue(
    JSON.parse(canonicalDocument) as unknown,
  );
  const currentHashes = getArchitectureDocumentHashes(
    loadFoundationArchitectureDocument(),
  );
  return {
    binding: {
      architectureId: document.architectureId,
      catalog: document.catalog,
      documentId: document.documentId,
      documentKind: document.kind,
      documentSchemaVersion: 1,
      provider: document.provider,
      revisionId: document.revision.revisionId,
      scopeFingerprint: binding.scopeFingerprint,
      seedSnapshotDigest: snapshotDigest,
      sourceDraftId: document.revision.sourceDraftId,
    },
    canonicalDocument,
    checkpoint: {
      generation: 1,
      savedAt: SAVED_AT,
      snapshotDigest,
      writerId: WRITER_ID,
    },
    integrity: {
      canonicalBytes: byteLength(canonicalDocument),
      contentHash: currentHashes.contentHash,
      snapshotDigest,
      visualHash: currentHashes.visualHash,
    },
    kind: "cloudmarkup.editor-recovery",
    schemaVersion: 1,
  };
}

function createLegacyArchitectureV2Envelope(
  binding: ReturnType<typeof createEditorRecoveryBindingV1>,
): unknown {
  const document = migrateArchitectureDocumentV1ToV2(
    parseArchitectureDocumentV1(structuredClone(foundationArchitectureInput)),
  );
  const canonicalDocument = serializeArchitectureDocumentV2(document);
  const snapshotDigest = hashCanonicalValue(
    JSON.parse(canonicalDocument) as unknown,
  );
  const currentHashes = getArchitectureDocumentHashes(
    loadFoundationArchitectureDocument(),
  );
  return {
    binding: {
      architectureId: document.architectureId,
      catalog: document.catalog,
      documentId: document.documentId,
      documentKind: document.kind,
      documentSchemaVersion: 2,
      provider: document.provider,
      revisionId: document.revision.revisionId,
      scopeFingerprint: binding.scopeFingerprint,
      seedSnapshotDigest: snapshotDigest,
      sourceDraftId: document.revision.sourceDraftId,
    },
    canonicalDocument,
    checkpoint: {
      generation: 1,
      savedAt: SAVED_AT,
      snapshotDigest,
      writerId: WRITER_ID,
    },
    integrity: {
      canonicalBytes: byteLength(canonicalDocument),
      contentHash: currentHashes.contentHash,
      snapshotDigest,
      visualHash: currentHashes.visualHash,
    },
    kind: "cloudmarkup.editor-recovery",
    schemaVersion: 1,
  };
}

function replaceCanonicalDocument(
  envelope: EditorRecoveryEnvelopeV1,
  canonicalDocument: string,
): EditorRecoveryEnvelopeV1 {
  return {
    ...envelope,
    canonicalDocument,
    integrity: {
      ...envelope.integrity,
      canonicalBytes: byteLength(canonicalDocument),
    },
  };
}

function withNodeConfigurationValue(
  document: ArchitectureDocument,
  property: string,
  value: ConfigurationValue,
): ArchitectureDocument {
  const node = document.nodes[0];
  if (node === undefined) {
    throw new Error("The recovery fixture must contain a node.");
  }

  return parseArchitectureDocumentV3({
    ...document,
    nodes: [
      {
        ...node,
        semantic: {
          ...node.semantic,
          configuration: {
            ...node.semantic.configuration,
            values: {
              ...node.semantic.configuration.values,
              [property]: value,
            },
          },
        },
      },
      ...document.nodes.slice(1),
    ],
  });
}

describe("editor recovery envelope", () => {
  it("round-trips a current document through a deterministic recovery envelope", () => {
    const { binding, document, envelope, prepared } = createReadyFixture();

    expect(prepared.snapshot.canonicalDocument).toBe(
      serializeArchitectureDocumentV3(document),
    );
    expect(binding.seedSnapshotDigest).toBe(
      prepared.snapshot.integrity.snapshotDigest,
    );

    const inspected = inspectEditorRecoveryEnvelopeV1(envelope, binding);
    expect(inspected.status).toBe("ready");
    if (inspected.status !== "ready") {
      throw new Error(inspected.diagnostic.diagnostics[0]?.message);
    }
    expect(serializeArchitectureDocumentV3(inspected.document)).toBe(
      prepared.snapshot.canonicalDocument,
    );
    expect(getArchitectureDocumentHashes(inspected.document)).toEqual(
      getArchitectureDocumentHashes(document),
    );
    expect(inspected.envelope).toEqual(envelope);
    expect(inspected.head).toEqual({
      generation: 1,
      snapshotDigest: prepared.snapshot.integrity.snapshotDigest,
    });
    expect(inspected.migrationClassification).toBe("current");
  });

  it("integrity-checks but does not auto-migrate or overwrite a legacy Architecture v1 recovery snapshot", () => {
    const { binding } = createReadyFixture();
    const legacyEnvelope = createLegacyArchitectureV1Envelope(binding);
    const before = structuredClone(legacyEnvelope);

    const inspected = inspectEditorRecoveryEnvelopeV1(legacyEnvelope, binding);

    expect(inspected).toMatchObject({
      classification: "document-incompatible",
      diagnostic: {
        documentSchemaVersion: 1,
        diagnostics: [
          {
            code: "older-document-version",
            path: "$.binding.documentSchemaVersion",
          },
        ],
      },
      status: "rejected",
    });
    expect(legacyEnvelope).toEqual(before);

    const tampered = structuredClone(legacyEnvelope) as Readonly<
      Record<string, unknown>
    >;
    const tamperedCanonical = String(tampered["canonicalDocument"]).replace(
      "Application network",
      "Applicatiox network",
    );
    expect(tamperedCanonical).not.toBe(tampered["canonicalDocument"]);
    expect(
      inspectEditorRecoveryEnvelopeV1(
        { ...tampered, canonicalDocument: tamperedCanonical },
        binding,
      ),
    ).toMatchObject({
      classification: "integrity-mismatch",
      diagnostic: {
        diagnostics: [{ code: "recovery-digest-mismatch" }],
      },
      status: "rejected",
    });
  });

  it("integrity-checks but does not auto-migrate or overwrite a legacy Architecture v2 recovery snapshot", () => {
    const { binding } = createReadyFixture();
    const legacyEnvelope = createLegacyArchitectureV2Envelope(binding);
    const before = structuredClone(legacyEnvelope);

    expect(
      inspectEditorRecoveryEnvelopeV1(legacyEnvelope, binding),
    ).toMatchObject({
      classification: "document-incompatible",
      diagnostic: {
        documentSchemaVersion: 2,
        diagnostics: [
          {
            code: "older-document-version",
            path: "$.binding.documentSchemaVersion",
          },
        ],
      },
      status: "rejected",
    });
    expect(legacyEnvelope).toEqual(before);
  });

  it("rejects unsupported future envelope and document versions", () => {
    const { binding, envelope } = createReadyFixture();

    const futureEnvelope = inspectEditorRecoveryEnvelopeV1(
      { ...envelope, schemaVersion: 2 },
      binding,
    );
    expect(futureEnvelope).toMatchObject({
      classification: "envelope-unsupported-future",
      diagnostic: {
        envelopeSchemaVersion: 2,
        diagnostics: [
          {
            code: "unsupported-envelope-version",
            path: "$.schemaVersion",
          },
        ],
      },
      status: "rejected",
    });

    const rawDocument = JSON.parse(envelope.canonicalDocument) as Readonly<
      Record<string, unknown>
    >;
    const futureCanonicalDocument = serializeCanonicalJson({
      ...rawDocument,
      schemaVersion: 4,
    });
    const futureDocument = inspectEditorRecoveryEnvelopeV1(
      replaceCanonicalDocument(envelope, futureCanonicalDocument),
      binding,
    );
    expect(futureDocument.status).toBe("rejected");
    if (futureDocument.status !== "rejected") {
      throw new Error("The unsupported future document was accepted.");
    }
    expect(futureDocument.classification).toBe("document-incompatible");
    expect(futureDocument.diagnostic.documentSchemaVersion).toBe(4);
    expect(
      futureDocument.diagnostic.diagnostics.some(
        (diagnostic) => diagnostic.code === "unsupported_future_version",
      ),
    ).toBe(true);
  });

  it("rejects malformed envelopes, invalid canonical JSON, and digest tampering", () => {
    const { binding, envelope } = createReadyFixture();

    expect(
      inspectEditorRecoveryEnvelopeV1(
        { kind: "cloudmarkup.editor-recovery", schemaVersion: 1 },
        binding,
      ),
    ).toMatchObject({
      classification: "envelope-malformed",
      diagnostic: { diagnostics: [{ code: "malformed-envelope" }] },
      status: "rejected",
    });

    expect(
      inspectEditorRecoveryEnvelopeV1(
        replaceCanonicalDocument(envelope, "{"),
        binding,
      ),
    ).toMatchObject({
      classification: "document-incompatible",
      diagnostic: {
        diagnostics: [{ code: "canonical-document-invalid-json" }],
      },
      status: "rejected",
    });

    const wrongDigest = `sha256:${"0".repeat(64)}`;
    expect(
      inspectEditorRecoveryEnvelopeV1(
        {
          ...envelope,
          integrity: { ...envelope.integrity, contentHash: wrongDigest },
        },
        binding,
      ),
    ).toMatchObject({
      classification: "integrity-mismatch",
      diagnostic: { diagnostics: [{ code: "recovery-digest-mismatch" }] },
      status: "rejected",
    });
  });

  it("requires an exact scope and document binding", () => {
    const { document, envelope } = createReadyFixture();
    const otherBinding = createEditorRecoveryBindingV1({
      scopeKey: "project:another-recovery-scope",
      seedDocument: document,
    });

    expect(
      inspectEditorRecoveryEnvelopeV1(envelope, otherBinding),
    ).toMatchObject({
      classification: "binding-mismatch",
      diagnostic: {
        diagnostics: [{ code: "recovery-binding-mismatch", path: "$.binding" }],
      },
      status: "rejected",
    });
  });

  it("refuses credential-shaped literal values before save and during recovery", () => {
    const { binding, document, envelope } = createReadyFixture();
    const credentialDocument = withNodeConfigurationValue(
      document,
      "sessionToken",
      { kind: "string", value: "literal-value-that-must-not-be-stored" },
    );

    const prepared = prepareEditorRecoverySnapshotV1(
      binding,
      credentialDocument,
    );
    expect(prepared).toMatchObject({
      diagnostic: {
        classification: "credential-literal",
        diagnostics: [
          {
            code: "credential-literal-refused",
            path: "$.nodes[0].semantic.configuration.values",
          },
        ],
      },
      ok: false,
    });

    const recovered = inspectEditorRecoveryEnvelopeV1(
      replaceCanonicalDocument(
        envelope,
        serializeArchitectureDocumentV3(credentialDocument),
      ),
      binding,
    );
    expect(recovered).toMatchObject({
      classification: "credential-literal",
      diagnostic: {
        diagnostics: [{ code: "credential-literal-refused" }],
      },
      status: "rejected",
    });

    for (const property of [
      "accessToken",
      "accessTokenValue",
      "authorizationHeader",
      "clientSecret",
      "clientSecretValue",
      "dbPassword",
      "sessionCookie",
    ]) {
      expect(
        prepareEditorRecoverySnapshotV1(
          binding,
          withNodeConfigurationValue(document, property, {
            kind: "string",
            value: "literal-value-that-must-not-be-stored",
          }),
        ),
      ).toMatchObject({
        diagnostic: { classification: "credential-literal" },
        ok: false,
      });
    }

    expect(
      prepareEditorRecoverySnapshotV1(
        binding,
        withNodeConfigurationValue(document, "authorizationHeaders", {
          kind: "string-list",
          value: ["Bearer literal-value-that-must-not-be-stored"],
        }),
      ),
    ).toMatchObject({
      diagnostic: { classification: "credential-literal" },
      ok: false,
    });
  });

  it("enforces the canonical document byte limit", () => {
    const { binding, document } = createReadyFixture();
    const oversizedDocument = withNodeConfigurationValue(
      document,
      "recoveryNotes",
      {
        kind: "string",
        value: "x".repeat(EDITOR_RECOVERY_MAX_CANONICAL_BYTES),
      },
    );

    const prepared = prepareEditorRecoverySnapshotV1(
      binding,
      oversizedDocument,
    );
    expect(prepared).toMatchObject({
      diagnostic: {
        classification: "payload-too-large",
        diagnostics: [{ code: "canonical-document-too-large" }],
      },
      ok: false,
    });
    if (!prepared.ok) {
      expect(prepared.diagnostic.canonicalBytes).toBeGreaterThan(
        EDITOR_RECOVERY_MAX_CANONICAL_BYTES,
      );
    }
  });

  it("redacts even small adapter-provided diagnostic messages and unsafe paths", () => {
    const secret = "small-secret-that-must-not-appear";
    const diagnostic: EditorRecoveryDiagnosticV1 = {
      kind: "cloudmarkup.editor-recovery-diagnostic",
      schemaVersion: 1,
      classification: "document-incompatible",
      diagnostics: [
        {
          code: `secret-${secret}`,
          message: `Adapter detail: ${secret}`,
          path: `$.document[${secret}]`,
        },
      ],
    };

    const serialized = serializeEditorRecoveryDiagnosticV1(diagnostic);
    expect(serialized).not.toContain(secret);
    expect(JSON.parse(serialized)).toMatchObject({
      classification: "document-incompatible",
      diagnostics: [
        {
          code: "diagnostic-redacted",
          path: "$",
        },
      ],
      kind: "cloudmarkup.editor-recovery-diagnostic",
      schemaVersion: 1,
    });
  });
  it("serializes oversized diagnostics as a bounded redacted diagnostic", () => {
    const secret = "credential-literal-that-must-not-appear";
    const diagnostic: EditorRecoveryDiagnosticV1 = {
      kind: "cloudmarkup.editor-recovery-diagnostic",
      schemaVersion: 1,
      classification: "document-incompatible",
      diagnostics: Array.from({ length: 32 }, (_, index) => ({
        code: `failure-${String(index)}`,
        message: `${secret}-${"x".repeat(4096)}`,
        path: `$.document.field-${String(index)}`,
      })),
    };

    const serialized = serializeEditorRecoveryDiagnosticV1(diagnostic);
    expect(byteLength(serialized)).toBeLessThanOrEqual(
      EDITOR_RECOVERY_MAX_DIAGNOSTIC_BYTES,
    );
    expect(serialized).not.toContain(secret);
    expect(JSON.parse(serialized)).toMatchObject({
      classification: "document-incompatible",
      diagnostics: [
        {
          code: "diagnostic-truncated",
          path: "$",
        },
      ],
      kind: "cloudmarkup.editor-recovery-diagnostic",
      schemaVersion: 1,
    });
  });
});
