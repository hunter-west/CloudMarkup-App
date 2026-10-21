import type { ArchitectureDocument } from "@cloudmarkup/domain";
import { createContext, useContext } from "react";

import type {
  EditorRecoveryDiagnosticClassification,
  EditorRecoveryDiagnosticV1,
} from "./editor-recovery-store.js";

interface EditorRecoveryStatusBase {
  readonly hasPendingChanges: boolean;
  readonly message: string;
}

export type EditorRecoveryStatus =
  | (EditorRecoveryStatusBase & {
      readonly status: "checking";
    })
  | (EditorRecoveryStatusBase & {
      readonly status: "unsaved";
    })
  | (EditorRecoveryStatusBase & {
      readonly status: "saving";
    })
  | (EditorRecoveryStatusBase & {
      readonly lastSavedAt: string | null;
      readonly recovered: boolean;
      readonly status: "saved";
    })
  | (EditorRecoveryStatusBase & {
      readonly status: "conflict";
    })
  | (EditorRecoveryStatusBase & {
      readonly diagnostic?: EditorRecoveryDiagnosticV1;
      readonly status: "failed";
    })
  | (EditorRecoveryStatusBase & {
      readonly classification: EditorRecoveryDiagnosticClassification;
      readonly diagnostic: EditorRecoveryDiagnosticV1;
      readonly status: "recovery-required";
    })
  | (EditorRecoveryStatusBase & {
      readonly status: "unsupported";
    });

export interface EditorRecoveryContextValue {
  readonly state: EditorRecoveryStatus;
  readonly documentChanged: (document: ArchitectureDocument) => void;
  discardLocalDraft(): Promise<boolean>;
  downloadDiagnosticCopy(): boolean;
  recoverSafeCheckpoint(): Promise<boolean>;
}

const UNSUPPORTED_RECOVERY_CONTEXT: EditorRecoveryContextValue = {
  state: {
    hasPendingChanges: false,
    message:
      "Local draft recovery is unavailable in this browser. Changes are not persisted.",
    status: "unsupported",
  },
  discardLocalDraft: () => Promise.resolve(false),
  documentChanged: () => undefined,
  downloadDiagnosticCopy: () => false,
  recoverSafeCheckpoint: () => Promise.resolve(false),
};

export const EditorRecoveryContext = createContext<EditorRecoveryContextValue>(
  UNSUPPORTED_RECOVERY_CONTEXT,
);

export function useEditorRecovery(): EditorRecoveryContextValue {
  return useContext(EditorRecoveryContext);
}
