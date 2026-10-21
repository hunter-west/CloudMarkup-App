import type {
  ArchitectureDocument,
  ArchitectureDocumentHashes,
} from "@cloudmarkup/domain";
import type { Sha256Digest } from "@cloudmarkup/schemas";

export const EDITOR_RECOVERY_STORE_CONTRACT_VERSION = 1 as const;

export interface EditorRecoveryBindingV1 {
  readonly architectureId: string;
  readonly catalog: {
    readonly digest: Sha256Digest;
    readonly id: string;
    readonly version: string;
  };
  readonly documentId: string;
  readonly documentKind: "cloudmarkup.architecture-document";
  readonly documentSchemaVersion: 3;
  readonly provider: {
    readonly id: string;
    readonly region: string;
  };
  readonly revisionId: string;
  readonly scopeFingerprint: Sha256Digest;
  readonly seedSnapshotDigest: Sha256Digest;
  readonly sourceDraftId?: string;
}

export interface EditorRecoveryHead {
  readonly generation: number;
  readonly snapshotDigest: Sha256Digest;
}

export interface EditorRecoveryCheckpointMetadata extends EditorRecoveryHead {
  readonly savedAt: string;
  readonly writerId: string;
}

export interface EditorRecoveryIntegrityV1 extends ArchitectureDocumentHashes {
  readonly canonicalBytes: number;
  readonly snapshotDigest: Sha256Digest;
}

export interface EditorRecoveryEnvelopeV1 {
  readonly binding: EditorRecoveryBindingV1;
  readonly canonicalDocument: string;
  readonly checkpoint: EditorRecoveryCheckpointMetadata;
  readonly integrity: EditorRecoveryIntegrityV1;
  readonly kind: "cloudmarkup.editor-recovery";
  readonly schemaVersion: 1;
}

export type EditorRecoveryDiagnosticClassification =
  | "binding-mismatch"
  | "credential-literal"
  | "document-incompatible"
  | "envelope-malformed"
  | "envelope-unsupported-future"
  | "integrity-mismatch"
  | "payload-too-large";

export interface EditorRecoveryDiagnosticEntry {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export interface EditorRecoveryDiagnosticV1 {
  readonly canonicalBytes?: number;
  readonly classification: EditorRecoveryDiagnosticClassification;
  readonly diagnostics: readonly EditorRecoveryDiagnosticEntry[];
  readonly documentSchemaVersion?: number;
  readonly envelopeSchemaVersion?: number;
  readonly generation?: number;
  readonly kind: "cloudmarkup.editor-recovery-diagnostic";
  readonly savedAt?: string;
  readonly schemaVersion: 1;
  readonly scopeFingerprint?: Sha256Digest;
}

export interface EditorRecoveryReady {
  readonly diagnostic: null;
  readonly document: ArchitectureDocument;
  readonly envelope: EditorRecoveryEnvelopeV1;
  readonly head: EditorRecoveryHead;
  readonly migrationClassification: "current";
  readonly status: "ready";
}

export interface EditorRecoveryEmpty {
  readonly status: "empty";
}

export interface EditorRecoveryRejected {
  /**
   * The current persisted head when rejection happened during a store load.
   * Callers must use this head for any recovery checkpoint or discard CAS.
   */
  readonly actualHead?: EditorRecoveryHead;
  readonly classification: EditorRecoveryDiagnosticClassification;
  readonly diagnostic: EditorRecoveryDiagnosticV1;
  /**
   * A strictly validated older checkpoint, when retention contains one. The
   * rejected newest checkpoint remains the CAS head until explicitly replaced
   * or discarded.
   */
  readonly previousValidCheckpoint?: EditorRecoveryReady;
  readonly status: "rejected";
}

export interface EditorRecoveryUnavailable {
  readonly code:
    | "blocked"
    | "closed"
    | "database-error"
    | "not-supported"
    | "quota-exceeded"
    | "version-error";
  readonly message: string;
  readonly status: "unavailable";
}

export type EditorRecoveryLoadResult =
  | EditorRecoveryEmpty
  | EditorRecoveryReady
  | EditorRecoveryRejected
  | EditorRecoveryUnavailable;

export interface EditorRecoveryCheckpointRequest {
  readonly binding: EditorRecoveryBindingV1;
  readonly document: ArchitectureDocument;
  readonly expectedHead: EditorRecoveryHead | null;
  readonly savedAt: string;
  readonly writerId: string;
}

export type EditorRecoveryCheckpointResult =
  | {
      readonly envelope: EditorRecoveryEnvelopeV1;
      readonly head: EditorRecoveryHead;
      readonly status: "stored";
    }
  | {
      readonly head: EditorRecoveryHead;
      readonly status: "unchanged";
    }
  | {
      readonly actualHead: EditorRecoveryHead | null;
      readonly expectedHead: EditorRecoveryHead | null;
      readonly status: "conflict";
    }
  | {
      readonly diagnostic: EditorRecoveryDiagnosticV1;
      readonly status: "rejected";
    }
  | {
      readonly maximumScopes: number;
      readonly status: "capacity-exceeded";
    }
  | EditorRecoveryUnavailable;

export interface EditorRecoveryDiscardRequest {
  readonly binding: EditorRecoveryBindingV1;
  readonly expectedHead: EditorRecoveryHead;
  readonly writerId: string;
}

export type EditorRecoveryDiscardResult =
  | {
      readonly status: "discarded";
    }
  | {
      readonly status: "empty";
    }
  | {
      readonly actualHead: EditorRecoveryHead | null;
      readonly expectedHead: EditorRecoveryHead;
      readonly status: "conflict";
    }
  | EditorRecoveryUnavailable;

/**
 * Explicit user-authorized remediation for a record already rejected by load.
 * Implementations must re-read atomically and match the exact scope,
 * classification, and expected head before deleting or replacing anything.
 * This path is never used by normal autosave.
 */
export type EditorRecoveryRejectedRemediationRequest =
  | {
      readonly action: "discard";
      readonly binding: EditorRecoveryBindingV1;
      readonly expectedClassification: EditorRecoveryDiagnosticClassification;
      readonly expectedHead: EditorRecoveryHead | null;
      readonly writerId: string;
    }
  | {
      readonly action: "replace";
      readonly binding: EditorRecoveryBindingV1;
      readonly document: ArchitectureDocument;
      readonly expectedClassification: EditorRecoveryDiagnosticClassification;
      readonly expectedHead: EditorRecoveryHead | null;
      readonly savedAt: string;
      readonly writerId: string;
    };

export type EditorRecoveryRejectedRemediationResult =
  | {
      readonly status: "discarded";
    }
  | {
      readonly envelope: EditorRecoveryEnvelopeV1;
      readonly head: EditorRecoveryHead;
      readonly status: "stored";
    }
  | {
      readonly actualClassification:
        EditorRecoveryDiagnosticClassification | "empty" | "ready";
      readonly actualHead: EditorRecoveryHead | null;
      readonly expectedClassification: EditorRecoveryDiagnosticClassification;
      readonly expectedHead: EditorRecoveryHead | null;
      readonly status: "conflict";
    }
  | {
      readonly diagnostic: EditorRecoveryDiagnosticV1;
      readonly status: "rejected";
    }
  | EditorRecoveryUnavailable;

export type EditorRecoveryHeadNotice =
  | {
      readonly head: EditorRecoveryHead;
      readonly kind: "checkpoint";
      readonly scopeFingerprint: Sha256Digest;
      readonly writerId: string;
    }
  | {
      readonly kind: "discard";
      readonly scopeFingerprint: Sha256Digest;
      readonly writerId: string;
    };

export interface EditorRecoveryStoreV1 {
  readonly contractVersion: typeof EDITOR_RECOVERY_STORE_CONTRACT_VERSION;
  checkpoint(
    request: EditorRecoveryCheckpointRequest,
  ): Promise<EditorRecoveryCheckpointResult>;
  discard(
    request: EditorRecoveryDiscardRequest,
  ): Promise<EditorRecoveryDiscardResult>;
  load(binding: EditorRecoveryBindingV1): Promise<EditorRecoveryLoadResult>;
  remediateRejected(
    request: EditorRecoveryRejectedRemediationRequest,
  ): Promise<EditorRecoveryRejectedRemediationResult>;
  subscribe(
    binding: EditorRecoveryBindingV1,
    listener: (notice: EditorRecoveryHeadNotice) => void,
  ): () => void;
}
