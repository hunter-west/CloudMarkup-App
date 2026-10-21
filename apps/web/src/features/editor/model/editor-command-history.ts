import {
  applyGraphCommand,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
  type ArchitectureDocument,
  type ArchitectureDocumentHashes,
  type GraphCommandApplicationResult,
  type GraphCommandNonInvertibleReason,
} from "@cloudmarkup/domain";
import {
  parseGraphCommandV1,
  serializeCanonicalJson,
  type GraphCommandV1,
} from "@cloudmarkup/schemas";

export const DEFAULT_EDITOR_COMMAND_HISTORY_MAX_ENTRIES = 100;
export const DEFAULT_EDITOR_COMMAND_HISTORY_MAX_SERIALIZED_BYTES =
  2 * 1024 * 1024;

export interface EditorCommandHistoryLimits {
  readonly maxEntries: number;
  readonly maxSerializedCommandBytes: number;
}

export interface EditorCommandHistoryOptions {
  readonly maxEntries?: number;
  readonly maxSerializedCommandBytes?: number;
}

export type EditorCommandHistoryBarrier =
  | {
      readonly kind: "invalidated";
      readonly code:
        | "command-rejected"
        | "current-document-mismatch"
        | "history-replay-failed"
        | "result-hash-mismatch"
        | "result-inversion-unavailable";
      readonly message: string;
    }
  | {
      readonly kind: "limit";
      readonly code: "entry-too-large" | "history-truncated";
      readonly message: string;
    }
  | {
      readonly kind: "non-invertible";
      readonly reason: GraphCommandNonInvertibleReason;
    };

export interface EditorCommandHistoryEntry {
  readonly afterHashes: ArchitectureDocumentHashes;
  readonly beforeHashes: ArchitectureDocumentHashes;
  readonly forwardCommand: GraphCommandV1;
  readonly label: string;
  readonly serializedCommandBytes: number;
  readonly undoCommand: GraphCommandV1;
}

export interface EditorCommandHistory {
  readonly barrier: EditorCommandHistoryBarrier | null;
  readonly checkpoint: ArchitectureDocument;
  readonly checkpointHashes: ArchitectureDocumentHashes;
  readonly cursor: number;
  readonly entries: readonly EditorCommandHistoryEntry[];
  readonly limits: EditorCommandHistoryLimits;
  readonly serializedCommandBytes: number;
}

export interface EditorCommandHistorySummary {
  readonly barrier: EditorCommandHistoryBarrier | null;
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly checkpointHashes: ArchitectureDocumentHashes;
  readonly cursor: number;
  readonly entryCount: number;
  readonly redoLabel: string | null;
  readonly serializedCommandBytes: number;
  readonly undoLabel: string | null;
}

export type EditorCommandHistoryFailureCode =
  | "application-mismatch"
  | "command-rejected"
  | "current-document-mismatch"
  | "history-replay-failed"
  | "nothing-to-redo"
  | "nothing-to-undo"
  | "result-hash-mismatch"
  | "result-inversion-unavailable";

export interface EditorCommandHistoryFailure {
  readonly code: EditorCommandHistoryFailureCode;
  readonly history: EditorCommandHistory;
  readonly message: string;
  readonly ok: false;
}

export type EditorCommandHistoryRecordResult =
  | EditorCommandHistoryFailure
  | {
      readonly application: GraphCommandApplicationResult;
      readonly document: ArchitectureDocument;
      readonly history: EditorCommandHistory;
      readonly ok: true;
      readonly status: "checkpointed" | "no-change" | "recorded";
    };

export type EditorCommandHistoryTransitionResult =
  | EditorCommandHistoryFailure
  | {
      readonly application: GraphCommandApplicationResult;
      readonly direction: "redo" | "undo";
      readonly document: ArchitectureDocument;
      readonly history: EditorCommandHistory;
      readonly label: string;
      readonly ok: true;
    };

const UTF8_ENCODER = new TextEncoder();

function cloneHashes(
  hashes: ArchitectureDocumentHashes,
): ArchitectureDocumentHashes {
  return Object.freeze({
    contentHash: hashes.contentHash,
    visualHash: hashes.visualHash,
  });
}

function hashesEqual(
  left: ArchitectureDocumentHashes,
  right: ArchitectureDocumentHashes,
): boolean {
  return (
    left.contentHash === right.contentHash &&
    left.visualHash === right.visualHash
  );
}

function commandBytes(command: GraphCommandV1): number {
  return UTF8_ENCODER.encode(serializeCanonicalJson(command)).byteLength;
}

function createEntry(input: {
  readonly afterHashes: ArchitectureDocumentHashes;
  readonly beforeHashes: ArchitectureDocumentHashes;
  readonly forwardCommand: GraphCommandV1;
  readonly label: string;
  readonly undoCommand: GraphCommandV1;
}): EditorCommandHistoryEntry {
  const forwardCommand = parseGraphCommandV1(input.forwardCommand);
  const undoCommand = parseGraphCommandV1(input.undoCommand);
  return Object.freeze({
    afterHashes: cloneHashes(input.afterHashes),
    beforeHashes: cloneHashes(input.beforeHashes),
    forwardCommand,
    label: input.label.trim() || "Architecture change",
    serializedCommandBytes:
      commandBytes(forwardCommand) + commandBytes(undoCommand),
    undoCommand,
  });
}

function resolveLimits(
  options: EditorCommandHistoryOptions,
): EditorCommandHistoryLimits {
  const maxEntries =
    options.maxEntries ?? DEFAULT_EDITOR_COMMAND_HISTORY_MAX_ENTRIES;
  const maxSerializedCommandBytes =
    options.maxSerializedCommandBytes ??
    DEFAULT_EDITOR_COMMAND_HISTORY_MAX_SERIALIZED_BYTES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("Editor command history maxEntries must be positive.");
  }
  if (
    !Number.isSafeInteger(maxSerializedCommandBytes) ||
    maxSerializedCommandBytes < 1
  ) {
    throw new RangeError(
      "Editor command history maxSerializedCommandBytes must be positive.",
    );
  }
  return Object.freeze({ maxEntries, maxSerializedCommandBytes });
}

function createHistory(input: {
  readonly barrier: EditorCommandHistoryBarrier | null;
  readonly checkpoint: ArchitectureDocument;
  readonly cursor: number;
  readonly entries: readonly EditorCommandHistoryEntry[];
  readonly limits: EditorCommandHistoryLimits;
}): EditorCommandHistory {
  if (
    !Number.isSafeInteger(input.cursor) ||
    input.cursor < 0 ||
    input.cursor > input.entries.length
  ) {
    throw new RangeError("Editor command history cursor is out of range.");
  }
  const checkpoint = parseArchitectureDocument(input.checkpoint);
  const entries = Object.freeze([...input.entries]);
  return Object.freeze({
    barrier: input.barrier,
    checkpoint,
    checkpointHashes: cloneHashes(getArchitectureDocumentHashes(checkpoint)),
    cursor: input.cursor,
    entries,
    limits: input.limits,
    serializedCommandBytes: entries.reduce(
      (total, entry) => total + entry.serializedCommandBytes,
      0,
    ),
  });
}

export function createEditorCommandHistory(
  document: ArchitectureDocument,
  options: EditorCommandHistoryOptions = {},
): EditorCommandHistory {
  return createHistory({
    barrier: null,
    checkpoint: document,
    cursor: 0,
    entries: [],
    limits: resolveLimits(options),
  });
}

export function canUndoEditorCommand(history: EditorCommandHistory): boolean {
  return history.cursor > 0;
}

export function canRedoEditorCommand(history: EditorCommandHistory): boolean {
  return history.cursor < history.entries.length;
}

export function getEditorCommandHistorySummary(
  history: EditorCommandHistory,
): EditorCommandHistorySummary {
  return Object.freeze({
    barrier: history.barrier,
    canRedo: canRedoEditorCommand(history),
    canUndo: canUndoEditorCommand(history),
    checkpointHashes: cloneHashes(history.checkpointHashes),
    cursor: history.cursor,
    entryCount: history.entries.length,
    redoLabel: history.entries[history.cursor]?.label ?? null,
    serializedCommandBytes: history.serializedCommandBytes,
    undoLabel: history.entries[history.cursor - 1]?.label ?? null,
  });
}

function replayToCursor(history: EditorCommandHistory): ArchitectureDocument {
  let document = parseArchitectureDocument(history.checkpoint);
  if (
    !hashesEqual(
      getArchitectureDocumentHashes(document),
      history.checkpointHashes,
    )
  ) {
    throw new Error("The history checkpoint no longer matches its hashes.");
  }

  for (let index = 0; index < history.cursor; index += 1) {
    const entry = history.entries[index];
    if (entry === undefined) {
      throw new Error("The history cursor references a missing entry.");
    }
    if (
      !hashesEqual(getArchitectureDocumentHashes(document), entry.beforeHashes)
    ) {
      throw new Error("A history entry does not match its prior checkpoint.");
    }
    const application = applyGraphCommand(document, entry.forwardCommand);
    if (
      !hashesEqual(
        getArchitectureDocumentHashes(application.document),
        entry.afterHashes,
      )
    ) {
      throw new Error(
        "A history entry did not reproduce its resulting hashes.",
      );
    }
    if (application.inversion.kind !== "available") {
      throw new Error("A retained history entry is no longer invertible.");
    }
    document = application.document;
  }

  return document;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

function architectureDocumentsEqual(
  left: ArchitectureDocument,
  right: ArchitectureDocument,
): boolean {
  return (
    getArchitectureDocumentCanonicalHash(left) ===
    getArchitectureDocumentCanonicalHash(right)
  );
}

function applicationMatches(
  expected: GraphCommandApplicationResult,
  received: GraphCommandApplicationResult,
): boolean {
  return (
    canonicalEqual(expected.document, received.document) &&
    hashesEqual(
      getArchitectureDocumentHashes(expected.document),
      getArchitectureDocumentHashes(received.document),
    ) &&
    canonicalEqual(expected.changes, received.changes) &&
    canonicalEqual(expected.inversion, received.inversion)
  );
}

function failure(
  history: EditorCommandHistory,
  code: EditorCommandHistoryFailureCode,
  message: string,
): EditorCommandHistoryFailure {
  return Object.freeze({ code, history, message, ok: false });
}

function invalidatedHistory(
  history: EditorCommandHistory,
  document: ArchitectureDocument,
  code: Extract<EditorCommandHistoryBarrier, { kind: "invalidated" }>["code"],
  message: string,
): EditorCommandHistory {
  return createHistory({
    barrier: Object.freeze({ code, kind: "invalidated", message }),
    checkpoint: document,
    cursor: 0,
    entries: [],
    limits: history.limits,
  });
}

function limitBarrier(
  code: Extract<EditorCommandHistoryBarrier, { kind: "limit" }>["code"],
): Extract<EditorCommandHistoryBarrier, { kind: "limit" }> {
  return Object.freeze({
    code,
    kind: "limit",
    message:
      code === "entry-too-large"
        ? "The change exceeds the command-history size limit, so it starts a new checkpoint."
        : "Earlier changes are outside the bounded command history.",
  });
}

function enforceHistoryLimits(
  history: EditorCommandHistory,
): EditorCommandHistory {
  let checkpoint = history.checkpoint;
  let checkpointHashes = history.checkpointHashes;
  let entries = [...history.entries];
  let cursor = history.cursor;
  let serializedCommandBytes = history.serializedCommandBytes;
  let truncated = false;

  while (
    entries.length > history.limits.maxEntries ||
    serializedCommandBytes > history.limits.maxSerializedCommandBytes
  ) {
    const oldest = entries[0];
    if (oldest === undefined || cursor < 1) {
      throw new Error("The history limit cannot evict an unapplied command.");
    }
    if (!hashesEqual(checkpointHashes, oldest.beforeHashes)) {
      throw new Error("The history checkpoint cannot advance safely.");
    }
    const advanced = applyGraphCommand(checkpoint, oldest.forwardCommand);
    const advancedHashes = getArchitectureDocumentHashes(advanced.document);
    if (
      !hashesEqual(advancedHashes, oldest.afterHashes) ||
      advanced.inversion.kind !== "available"
    ) {
      throw new Error("The history checkpoint command did not replay exactly.");
    }
    checkpoint = advanced.document;
    checkpointHashes = advancedHashes;
    entries = entries.slice(1);
    cursor -= 1;
    serializedCommandBytes -= oldest.serializedCommandBytes;
    truncated = true;
  }

  return createHistory({
    barrier: truncated ? limitBarrier("history-truncated") : history.barrier,
    checkpoint,
    cursor,
    entries,
    limits: history.limits,
  });
}

export function recordEditorCommand(
  history: EditorCommandHistory,
  forwardCommandInput: GraphCommandV1,
  receivedApplication: GraphCommandApplicationResult,
  label: string,
): EditorCommandHistoryRecordResult {
  let beforeDocument: ArchitectureDocument;
  try {
    beforeDocument = replayToCursor(history);
  } catch (error) {
    return failure(
      history,
      "history-replay-failed",
      error instanceof Error
        ? error.message
        : "The command history could not reproduce its current document.",
    );
  }

  const forwardCommand = parseGraphCommandV1(forwardCommandInput);
  let application: GraphCommandApplicationResult;
  try {
    application = applyGraphCommand(beforeDocument, forwardCommand);
  } catch (error) {
    return failure(
      history,
      "command-rejected",
      error instanceof Error
        ? error.message
        : "The Graph Command was rejected without changing history.",
    );
  }
  if (!applicationMatches(application, receivedApplication)) {
    return failure(
      history,
      "application-mismatch",
      "The supplied Graph Command result does not match deterministic replay.",
    );
  }

  const beforeHashes = getArchitectureDocumentHashes(beforeDocument);
  const afterHashes = getArchitectureDocumentHashes(application.document);
  if (hashesEqual(beforeHashes, afterHashes)) {
    return Object.freeze({
      application,
      document: beforeDocument,
      history,
      ok: true,
      status: "no-change",
    });
  }

  if (application.inversion.kind === "unavailable") {
    const checkpointed = createHistory({
      barrier: Object.freeze({
        kind: "non-invertible",
        reason: Object.freeze({ ...application.inversion.reason }),
      }),
      checkpoint: application.document,
      cursor: 0,
      entries: [],
      limits: history.limits,
    });
    return Object.freeze({
      application,
      document: application.document,
      history: checkpointed,
      ok: true,
      status: "checkpointed",
    });
  }

  const entry = createEntry({
    afterHashes,
    beforeHashes,
    forwardCommand,
    label,
    undoCommand: application.inversion.command,
  });
  if (entry.serializedCommandBytes > history.limits.maxSerializedCommandBytes) {
    const checkpointed = createHistory({
      barrier: limitBarrier("entry-too-large"),
      checkpoint: application.document,
      cursor: 0,
      entries: [],
      limits: history.limits,
    });
    return Object.freeze({
      application,
      document: application.document,
      history: checkpointed,
      ok: true,
      status: "checkpointed",
    });
  }

  const entries = [...history.entries.slice(0, history.cursor), entry];
  const appended = createHistory({
    barrier: history.barrier,
    checkpoint: history.checkpoint,
    cursor: entries.length,
    entries,
    limits: history.limits,
  });
  try {
    const bounded = enforceHistoryLimits(appended);
    return Object.freeze({
      application,
      document: application.document,
      history: bounded,
      ok: true,
      status: "recorded",
    });
  } catch (error) {
    return failure(
      history,
      "history-replay-failed",
      error instanceof Error
        ? error.message
        : "The history checkpoint could not advance safely.",
    );
  }
}

function transitionFailure(
  history: EditorCommandHistory,
  currentDocument: ArchitectureDocument,
  code: Extract<
    EditorCommandHistoryFailureCode,
    | "command-rejected"
    | "current-document-mismatch"
    | "history-replay-failed"
    | "result-hash-mismatch"
    | "result-inversion-unavailable"
  >,
  message: string,
): EditorCommandHistoryFailure {
  let nextHistory = history;
  try {
    nextHistory = invalidatedHistory(history, currentDocument, code, message);
  } catch {
    // An invalid current document cannot become a trusted checkpoint.
  }
  return failure(nextHistory, code, message);
}

function transitionEditorCommand(
  history: EditorCommandHistory,
  currentDocumentInput: ArchitectureDocument,
  direction: "redo" | "undo",
): EditorCommandHistoryTransitionResult {
  const entryIndex = direction === "undo" ? history.cursor - 1 : history.cursor;
  const entry = history.entries[entryIndex];
  if (entry === undefined) {
    return failure(
      history,
      direction === "undo" ? "nothing-to-undo" : "nothing-to-redo",
      direction === "undo"
        ? "There is no architecture change to undo."
        : "There is no architecture change to redo.",
    );
  }

  let currentDocument: ArchitectureDocument;
  let expectedCurrent: ArchitectureDocument;
  try {
    currentDocument = parseArchitectureDocument(currentDocumentInput);
    expectedCurrent = replayToCursor(history);
  } catch (error) {
    return transitionFailure(
      history,
      currentDocumentInput,
      "history-replay-failed",
      error instanceof Error
        ? error.message
        : "The command history could not reproduce its current document.",
    );
  }
  if (
    !architectureDocumentsEqual(currentDocument, expectedCurrent) ||
    !hashesEqual(
      getArchitectureDocumentHashes(currentDocument),
      getArchitectureDocumentHashes(expectedCurrent),
    )
  ) {
    return transitionFailure(
      history,
      currentDocument,
      "current-document-mismatch",
      "The architecture changed outside this command history.",
    );
  }

  const command =
    direction === "undo" ? entry.undoCommand : entry.forwardCommand;
  let application: GraphCommandApplicationResult;
  try {
    application = applyGraphCommand(currentDocument, command);
  } catch (error) {
    return transitionFailure(
      history,
      currentDocument,
      "command-rejected",
      error instanceof Error
        ? error.message
        : "The history command was rejected without changing the document.",
    );
  }
  const resultingHashes = getArchitectureDocumentHashes(application.document);
  const expectedHashes =
    direction === "undo" ? entry.beforeHashes : entry.afterHashes;
  if (!hashesEqual(resultingHashes, expectedHashes)) {
    return transitionFailure(
      history,
      currentDocument,
      "result-hash-mismatch",
      "The history command did not reproduce its exact document hashes.",
    );
  }
  if (application.inversion.kind === "unavailable") {
    return transitionFailure(
      history,
      currentDocument,
      "result-inversion-unavailable",
      application.inversion.reason.message,
    );
  }

  const updatedEntry =
    direction === "undo"
      ? createEntry({
          ...entry,
          forwardCommand: application.inversion.command,
        })
      : createEntry({
          ...entry,
          undoCommand: application.inversion.command,
        });
  const entries = [...history.entries];
  entries[entryIndex] = updatedEntry;
  const transitioned = createHistory({
    barrier: history.barrier,
    checkpoint: history.checkpoint,
    cursor: history.cursor + (direction === "undo" ? -1 : 1),
    entries,
    limits: history.limits,
  });
  if (
    transitioned.serializedCommandBytes >
    transitioned.limits.maxSerializedCommandBytes
  ) {
    const checkpointed = createHistory({
      barrier: limitBarrier("entry-too-large"),
      checkpoint: application.document,
      cursor: 0,
      entries: [],
      limits: history.limits,
    });
    return Object.freeze({
      application,
      direction,
      document: application.document,
      history: checkpointed,
      label: entry.label,
      ok: true,
    });
  }

  return Object.freeze({
    application,
    direction,
    document: application.document,
    history: transitioned,
    label: entry.label,
    ok: true,
  });
}

export function undoEditorCommand(
  history: EditorCommandHistory,
  currentDocument: ArchitectureDocument,
): EditorCommandHistoryTransitionResult {
  return transitionEditorCommand(history, currentDocument, "undo");
}

export function redoEditorCommand(
  history: EditorCommandHistory,
  currentDocument: ArchitectureDocument,
): EditorCommandHistoryTransitionResult {
  return transitionEditorCommand(history, currentDocument, "redo");
}
