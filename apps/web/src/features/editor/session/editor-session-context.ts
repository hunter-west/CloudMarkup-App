import type { PreparedResourceRepair } from "../model/resource-repair-command.js";
import type { PreparedServiceRemoval } from "../model/remove-service-command.js";
import type { ArchitectureDocumentIndex } from "../model/architecture-document-index.js";
import type {
  ArchitectureDocument,
  ArchitectureDocumentHashes,
  ValidationFindingId,
} from "@cloudmarkup/domain";
import type { IconRegistry } from "@cloudmarkup/ui";
import type { ConfigurationValue } from "@cloudmarkup/schemas";
import { createContext, type ReactNode } from "react";

import type {
  ConfigurationCommandPreparationIssue,
  ConfigurationCommandTarget,
  ConfigurationEdit,
  PreparedConfigurationCommand,
} from "../model/configuration-command.js";
import type { OwnedPolicyGraphDescriptorSet } from "../model/owned-configuration-policy-model.js";
import type { OwnedPolicyCommandPreparationResult } from "../model/owned-policy-commands.js";
import type { EditorConnectionDockInspection } from "../model/connection-docks.js";
import type {
  EditorConnectionStartIntent,
  EditorConnectionWorkflow,
} from "../model/connection-workflow.js";
import type { PreparedArchitectureLayout } from "../model/architecture-layout.js";
import type { EditorCatalog } from "../model/editor-catalog.js";
import type {
  EditorPlacementOption,
  ServiceCreationOptions,
} from "../model/placement-rules.js";
import type { PreparedWorkloadOperationCommand } from "../model/workload-operation-command.js";
import type {
  EditorPosition,
  EditorSessionStore,
} from "./editor-session-store.js";
import type {
  EditorValidationFixResult,
  EditorValidationState,
  EditorValidationTarget,
} from "../validation/editor-validation.js";

export interface EditorDocumentProblem {
  readonly message: string;
  readonly title: string;
}

export interface MoveNodeSuccess {
  readonly document: ArchitectureDocument;
  readonly hashes: ArchitectureDocumentHashes;
  readonly ok: true;
}

export interface MoveNodeFailure {
  readonly code:
    "command-rejected" | "document-unavailable" | "placement-rejected";
  readonly message: string;
  readonly ok: false;
}

export type MoveNodeResult = MoveNodeFailure | MoveNodeSuccess;

export interface AddServiceSuccess {
  readonly deploymentKey: string;
  readonly document: ArchitectureDocument;
  readonly hashes: ArchitectureDocumentHashes;
  readonly nodeId: string;
  readonly ok: true;
}

export interface AddServiceFailure {
  readonly code: "command-rejected" | "document-unavailable";
  readonly message: string;
  readonly ok: false;
}

export type AddServiceResult = AddServiceFailure | AddServiceSuccess;

export type ServiceRemovalPreviewResult =
  | { readonly ok: true; readonly preview: PreparedServiceRemoval }
  | { readonly ok: false; readonly message: string };

export interface ConfigurationPreviewSuccess {
  readonly ok: true;
  readonly preview: PreparedConfigurationCommand;
}

export interface ConfigurationPreviewFailure {
  readonly code: "command-rejected" | "document-unavailable";
  readonly issues: readonly ConfigurationCommandPreparationIssue[];
  readonly message: string;
  readonly ok: false;
}

export type ConfigurationPreviewResult =
  ConfigurationPreviewFailure | ConfigurationPreviewSuccess;

export interface ConfigurationApplySuccess {
  readonly document: ArchitectureDocument;
  readonly hashes: ArchitectureDocumentHashes;
  readonly ok: true;
}

export interface ConfigurationApplyFailure {
  readonly code:
    "command-rejected" | "document-unavailable" | "preview-unavailable";
  readonly message: string;
  readonly ok: false;
}

export type ConfigurationApplyResult =
  ConfigurationApplyFailure | ConfigurationApplySuccess;

export type ConnectionWorkflowActionResult =
  | {
      readonly ok: true;
    }
  | {
      readonly message: string;
      readonly ok: false;
    };

export type EditorLayoutWorkflow =
  | {
      readonly message: null;
      readonly preview: null;
      readonly status: "idle" | "running";
    }
  | {
      readonly message: null;
      readonly preview: PreparedArchitectureLayout;
      readonly status: "preview";
    }
  | {
      readonly message: string;
      readonly preview: null;
      readonly status: "error";
    };

export interface EditorCommandHistoryStatus {
  readonly entries?: readonly {
    readonly id: string;
    readonly label: string;
    readonly applied: boolean;
  }[];
  readonly barrierMessage: string | null;
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly redoLabel: string | null;
  readonly undoLabel: string | null;
}

export type EditorHistoryActionResult =
  | {
      readonly document: ArchitectureDocument;
      readonly hashes: ArchitectureDocumentHashes;
      readonly ok: true;
    }
  | {
      readonly message: string;
      readonly ok: false;
    };

interface EditorDocumentSessionBase {
  readonly automaticLayoutAvailable: boolean;
  readonly catalog: EditorCatalog;
  readonly connectionWorkflow: EditorConnectionWorkflow;
  readonly configurationPreview: PreparedConfigurationCommand | null;
  readonly history: EditorCommandHistoryStatus;
  readonly iconRegistry: IconRegistry<ReactNode>;
  readonly layoutWorkflow: EditorLayoutWorkflow;
  readonly ownedPolicyDescriptors: OwnedPolicyGraphDescriptorSet | null;
  readonly validation: EditorValidationState;
  addService(
    serviceId: string,
    position?: EditorPosition,
    options?: ServiceCreationOptions,
  ): AddServiceResult;
  applyAutomaticLayout(): MoveNodeResult;
  applyConfigurationPreview(): ConfigurationApplyResult;
  applyValidationFix(
    findingId: ValidationFindingId | string,
    target: EditorValidationTarget,
  ): EditorValidationFixResult;
  applyConnectionPreview(): ConnectionWorkflowActionResult;
  applyOwnedPolicyCommand(
    prepared: OwnedPolicyCommandPreparationResult,
    label: string,
  ): ConnectionWorkflowActionResult;
  applyReviewedCommand(
    prepared: PreparedResourceRepair,
  ): ConnectionWorkflowActionResult;
  applyResourceRepair(
    prepared: PreparedResourceRepair,
  ): ConnectionWorkflowActionResult;
  applyWorkloadOperationCommand(
    prepared: PreparedWorkloadOperationCommand,
  ): ConnectionWorkflowActionResult;
  beginConnection(
    intent: EditorConnectionStartIntent,
  ): ConnectionWorkflowActionResult;
  cancelConnection(): void;
  cancelAutomaticLayout(): void;
  discardConnectionPreview(): void;
  disconnectEdge(edgeId: string): ConnectionWorkflowActionResult;
  previewServiceRemoval(nodeId: string): ServiceRemovalPreviewResult;
  removeService(
    preview: PreparedServiceRemoval,
  ): ConnectionWorkflowActionResult;
  createId(): string;
  discardConfigurationPreview(): void;
  inspectConnectionDock(
    nodeId: string,
    portIds: readonly string[],
  ): EditorConnectionDockInspection;
  listPlacementOptions(nodeId: string): readonly EditorPlacementOption[];
  moveNode(nodeId: string, position: EditorPosition): MoveNodeResult;
  placeNode(
    nodeId: string,
    targetParentNodeId: string | null,
    absolutePosition?: EditorPosition,
  ): MoveNodeResult;
  previewConfiguration(
    target: ConfigurationCommandTarget,
    edits: Readonly<Record<string, ConfigurationEdit>>,
  ): ConfigurationPreviewResult;
  requestValidation(): void;
  previewConnection(): ConnectionWorkflowActionResult;
  selectConnectionCandidate(candidateKey: string): void;
  startAutomaticLayout(): void;
  redo(): EditorHistoryActionResult;
  undo(): EditorHistoryActionResult;
  updateConnectionConfiguration(
    property: string,
    value: Readonly<ConfigurationValue> | undefined,
  ): void;
}

export type EditorDocumentSession =
  | (EditorDocumentSessionBase & {
      readonly document: ArchitectureDocument;
      readonly hashes: ArchitectureDocumentHashes;
      readonly problem: null;
      readonly status: "ready";
    })
  | (EditorDocumentSessionBase & {
      readonly document: null;
      readonly hashes: null;
      readonly problem: EditorDocumentProblem;
      readonly status: "invalid";
    });

export const EditorSessionStoreContext =
  createContext<EditorSessionStore | null>(null);

export const EditorDocumentSessionContext =
  createContext<EditorDocumentSession | null>(null);

export const EditorDocumentIndexContext =
  createContext<ArchitectureDocumentIndex | null>(null);
