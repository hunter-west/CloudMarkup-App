import {
  ApiClientError,
  applyDraftCommandV1Schema,
  draftArchitectureDocumentV1Schema,
  type ApplyDraftCommandV1,
  type ApplyDraftCommandResultV1,
  type DraftArchitectureDocumentV1,
  type ProjectEditingLeaseProofV1,
} from "@cloudmarkup/api-contract";
import {
  applyGraphCommand,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  serializeCanonicalJson,
  type GraphCommandV1,
} from "@cloudmarkup/schemas";

export interface CommandDraftHead {
  readonly draft: DraftArchitectureDocumentV1;
  readonly etag: string;
}
export interface DraftCommandRequest {
  readonly body: ApplyDraftCommandV1;
  readonly path: { readonly projectId: string };
  readonly headers: {
    readonly "if-match": string;
    readonly "idempotency-key": string;
  };
}
export interface DraftCommandTransport {
  /** Only drafts.apply-command. No full-document fallback or implicit adoption. */
  readonly send: (request: DraftCommandRequest) => Promise<{
    readonly value: ApplyDraftCommandResultV1;
    readonly etag: string;
  }>;
  readonly editingLease: () => ProjectEditingLeaseProofV1 | null;
  readonly isCurrent: () => boolean;
  readonly checkpoint?: (recovery: DraftCommandRecovery) => Promise<void>;
}
export class DraftCommandRecoveryError extends Error {
  readonly reason:
    "review-required" | "editing-interrupted" | "receipt-mismatch";
  constructor(reason: DraftCommandRecoveryError["reason"], message: string) {
    super(message);
    this.name = "DraftCommandRecoveryError";
    this.reason = reason;
  }
}
interface PendingCommand {
  readonly body: Omit<ApplyDraftCommandV1, "editingLease">;
  readonly idempotencyKey: string;
  readonly expectedDocument: ArchitectureDocument;
}
function recoveryRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid command recovery checkpoint.");
  return value as Record<string, unknown>;
}
export interface DraftCommandRecovery {
  readonly contractVersion: 1;
  readonly purpose: "unsaved-command-recovery";
  readonly baseline: CommandDraftHead;
  readonly document: ArchitectureDocument;
  readonly pending: readonly {
    readonly body: Omit<ApplyDraftCommandV1, "editingLease">;
    readonly idempotencyKey: string;
  }[];
  readonly attempt: {
    readonly commandId: string;
    readonly originalEtag: string;
    readonly originalVersion: number;
  } | null;
  readonly reviewRequired: boolean;
}

/** An ordered command queue, separate from bounded undo history. Capture actual
 * operations before accepting a local edit. Nothing is inferred from snapshots.
 * The host checkpoints this queue before dispatch and after each acknowledgement.
 * A restored command is always reauthorized by the server; local hashes confer no authority. */
export class DraftCommandDrain {
  #confirmed: CommandDraftHead;
  #optimistic: ArchitectureDocument;
  #pending: PendingCommand[] = [];
  #attempt: {
    readonly entry: PendingCommand;
    readonly etag: string;
    readonly version: number;
  } | null = null;
  #inFlight: Promise<CommandDraftHead> | null = null;
  #reviewRequired = false;
  readonly #usedCommandIds = new Set<string>();
  readonly #usedKeys = new Set<string>();

  constructor(head: CommandDraftHead) {
    this.#confirmed = structuredClone(head);
    this.#optimistic = structuredClone(head.draft.architectureDocument);
  }
  static restore(raw: unknown, expected: CommandDraftHead): DraftCommandDrain {
    const data = recoveryRecord(raw);
    if (
      data["contractVersion"] !== 1 ||
      data["purpose"] !== "unsaved-command-recovery" ||
      !Array.isArray(data["pending"]) ||
      typeof data["reviewRequired"] !== "boolean"
    )
      throw new Error("Invalid command recovery checkpoint.");
    const baseline = recoveryRecord(data["baseline"]);
    if (typeof baseline["etag"] !== "string")
      throw new Error("Invalid command recovery ETag.");
    const draft = draftArchitectureDocumentV1Schema.parse(baseline["draft"]);
    if (
      draft.id !== expected.draft.id ||
      draft.projectId !== expected.draft.projectId ||
      draft.architectureDocument.documentId !==
        expected.draft.architectureDocument.documentId ||
      draft.architectureDocument.architectureId !==
        expected.draft.architectureDocument.architectureId ||
      draft.architectureDocument.revision.revisionId !==
        expected.draft.architectureDocument.revision.revisionId
    )
      throw new Error("Command recovery belongs to another draft.");
    const drain = new DraftCommandDrain({ draft, etag: baseline["etag"] });
    for (const rawEntry of data["pending"] as readonly unknown[]) {
      const entry = recoveryRecord(rawEntry);
      if (typeof entry["idempotencyKey"] !== "string")
        throw new Error("Invalid command recovery request identity.");
      const body = applyDraftCommandV1Schema.parse(entry["body"]);
      if (body.editingLease !== undefined)
        throw new Error("Recovery must not contain editing credentials.");
      drain.enqueue(body.command, entry["idempotencyKey"]);
      if (
        serializeCanonicalJson(drain.#pending.at(-1)?.body) !==
        serializeCanonicalJson(body)
      )
        throw new Error(
          "Recovery command binding does not match its original baseline.",
        );
    }
    if (
      getArchitectureDocumentCanonicalHash(
        parseArchitectureDocument(data["document"]),
      ) !== getArchitectureDocumentCanonicalHash(drain.#optimistic)
    )
      throw new Error(
        "Recovery history does not reproduce the retained document.",
      );
    if (data["attempt"] !== null) {
      const attempt = recoveryRecord(data["attempt"]);
      const entry = drain.#pending[0];
      if (
        entry === undefined ||
        attempt["commandId"] !== entry.body.command.commandId ||
        attempt["originalEtag"] !== drain.#confirmed.etag ||
        attempt["originalVersion"] !== draft.version
      )
        throw new Error("Invalid original recovery attempt.");
      drain.#attempt = {
        entry,
        etag: drain.#confirmed.etag,
        version: draft.version,
      };
    }
    drain.#reviewRequired = data["reviewRequired"];
    return drain;
  }
  enqueue(
    raw: GraphCommandV1,
    idempotencyKey: string,
    expectedDocument?: ArchitectureDocument,
  ): ArchitectureDocument {
    if (this.#reviewRequired)
      throw new DraftCommandRecoveryError(
        "review-required",
        "Keep unsaved work and review the server baseline before further commands.",
      );
    const command = parseGraphCommandV1(structuredClone(raw));
    if (
      this.#usedCommandIds.has(command.commandId) ||
      this.#usedKeys.has(idempotencyKey) ||
      !/^[^\s]{16,128}$/u.test(idempotencyKey)
    )
      throw new Error(
        "Use a new command/request identity for a new edit; retry through flush.",
      );
    const applied = applyGraphCommand(this.#optimistic, command);
    if (
      expectedDocument !== undefined &&
      getArchitectureDocumentCanonicalHash(expectedDocument) !==
        getArchitectureDocumentCanonicalHash(applied.document)
    )
      throw new DraftCommandRecoveryError(
        "review-required",
        "The local document is outside the captured command history. Keep it for recovery or copy.",
      );
    this.#pending.push({
      body: {
        contractVersion: 1,
        command,
        contentBinding: {
          expectedContentDigest: getArchitectureDocumentContentHash(
            this.#optimistic,
          ),
          resultingContentDigest: getArchitectureDocumentContentHash(
            applied.document,
          ),
        },
      },
      idempotencyKey,
      expectedDocument: applied.document,
    });
    this.#usedCommandIds.add(command.commandId);
    this.#usedKeys.add(idempotencyKey);
    this.#optimistic = applied.document;
    return structuredClone(applied.document);
  }
  recovery(): DraftCommandRecovery {
    return structuredClone({
      contractVersion: 1 as const,
      purpose: "unsaved-command-recovery" as const,
      baseline: this.#confirmed,
      document: this.#optimistic,
      pending: this.#pending.map((entry) => ({
        body: entry.body,
        idempotencyKey: entry.idempotencyKey,
      })),
      attempt:
        this.#attempt === null
          ? null
          : {
              commandId: this.#attempt.entry.body.command.commandId,
              originalEtag: this.#attempt.etag,
              originalVersion: this.#attempt.version,
            },
      reviewRequired: this.#reviewRequired,
    });
    // Editing lease tokens deliberately never enter exported recovery data.
  }
  flush(transport: DraftCommandTransport): Promise<CommandDraftHead> {
    if (this.#inFlight !== null) return this.#inFlight;
    const published = Promise.resolve().then(() => this.#drain(transport));
    this.#inFlight = published;
    return published;
  }
  async #drain(transport: DraftCommandTransport): Promise<CommandDraftHead> {
    try {
      if (this.#reviewRequired)
        throw new DraftCommandRecoveryError(
          "review-required",
          "Keep unsaved work and review the changed server baseline.",
        );
      while (this.#pending.length > 0) {
        const lease = transport.editingLease();
        if (!transport.isCurrent() || lease === null)
          throw new DraftCommandRecoveryError(
            "editing-interrupted",
            "Unsaved commands remain queued until editing access is reviewed.",
          );
        const proof = structuredClone(lease);
        const entry = this.#pending[0];
        if (entry === undefined)
          throw new Error("The command queue is unavailable.");
        this.#attempt ??= {
          entry,
          etag: this.#confirmed.etag,
          version: this.#confirmed.draft.version,
        };
        const attempt = this.#attempt;
        await transport.checkpoint?.(this.recovery());
        if (
          !transport.isCurrent() ||
          serializeCanonicalJson(transport.editingLease()) !==
            serializeCanonicalJson(proof)
        )
          throw new DraftCommandRecoveryError(
            "editing-interrupted",
            "Editing access changed before dispatch; the request remains recoverable.",
          );
        const request: DraftCommandRequest = {
          body: { ...structuredClone(attempt.entry.body), editingLease: proof },
          path: { projectId: this.#confirmed.draft.projectId },
          headers: {
            "if-match": attempt.etag,
            "idempotency-key": attempt.entry.idempotencyKey,
          },
        };
        let response;
        try {
          response = await transport.send(request);
        } catch (error) {
          if (
            error instanceof ApiClientError &&
            [
              "precondition_failed",
              "idempotency_key_reused",
              "invalid_request",
              "unsupported_version",
            ].includes(error.envelope.error.code)
          )
            this.#reviewRequired = true;
          throw error;
        }
        if (
          !transport.isCurrent() ||
          serializeCanonicalJson(transport.editingLease()) !==
            serializeCanonicalJson(proof)
        )
          throw new DraftCommandRecoveryError(
            "editing-interrupted",
            "The response may have committed; retain this exact command for reconciliation.",
          );
        if (
          response.value.appliedCommandId !== entry.body.command.commandId ||
          response.value.draft.id !== this.#confirmed.draft.id ||
          response.value.draft.projectId !== this.#confirmed.draft.projectId ||
          response.value.draft.version !== attempt.version + 1 ||
          getArchitectureDocumentCanonicalHash(
            response.value.draft.architectureDocument,
          ) !== getArchitectureDocumentCanonicalHash(entry.expectedDocument)
        ) {
          this.#reviewRequired = true;
          throw new DraftCommandRecoveryError(
            "receipt-mismatch",
            "The accepted result does not match this command. Keep unsaved work for review.",
          );
        }
        this.#confirmed = {
          draft: structuredClone(response.value.draft),
          etag: response.etag,
        };
        this.#pending.shift();
        this.#attempt = null;
        await transport.checkpoint?.(this.recovery());
      }
      await transport.checkpoint?.(this.recovery());
      return structuredClone(this.#confirmed);
    } finally {
      this.#inFlight = null;
    }
  }
}
