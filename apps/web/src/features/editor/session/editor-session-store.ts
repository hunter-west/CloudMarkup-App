import type { ValidationAffectedLocation } from "@cloudmarkup/domain";

import type { EditorValidationTarget } from "../validation/editor-validation.js";

import { createStore, type StoreApi } from "zustand/vanilla";

export interface EditorPosition {
  readonly x: number;
  readonly y: number;
}

export interface EditorViewport extends EditorPosition {
  readonly zoom: number;
}

export type EditorElementReference =
  | {
      readonly id: string;
      readonly kind: "node";
    }
  | {
      readonly id: string;
      readonly kind: "edge";
    };

export type EditorSelection = EditorElementReference | null;

export interface EditorConnectionDockReference {
  readonly direction: "input" | "output";
  readonly groupId: string;
  readonly nodeId: string;
}

export interface EditorConfigurationFormBuffer {
  readonly shouldValidate: boolean;
  readonly values: Readonly<Record<string, unknown>>;
}

interface EditorValidationFocus {
  readonly findingId: string;
  readonly location: ValidationAffectedLocation;
  readonly target: EditorValidationTarget;
}

interface EditorValidationReview {
  readonly documentHash: string;
  readonly findingIdsByTarget: Readonly<
    Record<EditorValidationTarget, ReadonlySet<string>>
  >;
}

export interface EditorCanvasNotice {
  readonly message: string;
  readonly tone: "error" | "info";
}

export interface EditorSessionState {
  readonly activeConnectionDock: EditorConnectionDockReference | null;
  readonly canvasNotice: EditorCanvasNotice | null;
  readonly catalogPreviewServiceId: string | null;
  readonly catalogSearchQuery: string;
  readonly collapsedBoundaryIds: ReadonlySet<string>;
  readonly expandedServiceNodeIds: ReadonlySet<string>;
  readonly configurationFormBuffers: ReadonlyMap<
    string,
    EditorConfigurationFormBuffer
  >;
  readonly hoveredElement: EditorElementReference | null;
  readonly assistantActivity: {
    readonly status: "running" | "ready" | "failed" | "cancelled" | "applied";
    readonly message: string;
  } | null;
  setAssistantActivity(activity: EditorSessionState["assistantActivity"]): void;
  readonly liveAnnouncement: string;
  readonly validationAnnouncement: string;
  readonly previewPositions: ReadonlyMap<string, EditorPosition>;
  readonly recentServiceIds: readonly string[];
  readonly selection: EditorSelection;
  readonly validationFocus: EditorValidationFocus | null;
  readonly validationReview: EditorValidationReview | null;
  readonly viewport: EditorViewport;
  announce(message: string): void;
  announceValidation(message: string): void;
  clearAllPositionPreviews(): void;
  clearConfigurationFormBuffer(key: string): void;
  clearNodePositionPreview(nodeId: string): void;
  recordRecentService(serviceId: string): void;
  reset(): void;
  setActiveConnectionDock(dock: EditorConnectionDockReference | null): void;
  setCanvasNotice(notice: EditorCanvasNotice | null): void;
  setCatalogPreviewServiceId(serviceId: string | null): void;
  setCatalogSearchQuery(query: string): void;
  setBoundaryCollapsed(nodeId: string, collapsed: boolean): void;
  setServiceNodeExpanded(nodeId: string, expanded: boolean): void;
  setConfigurationFormBuffer(
    key: string,
    buffer: EditorConfigurationFormBuffer,
  ): void;
  setHoveredElement(element: EditorElementReference | null): void;
  setNodePositionPreview(nodeId: string, position: EditorPosition): void;
  setSelection(selection: EditorSelection): void;
  setValidationFindingReviewed(
    documentHash: string,
    target: EditorValidationTarget,
    findingId: string,
    reviewed: boolean,
  ): void;
  setValidationFocus(focus: EditorValidationFocus | null): void;
  setViewport(viewport: EditorViewport): void;
}

export type EditorSessionStore = StoreApi<EditorSessionState>;

export const DEFAULT_EDITOR_VIEWPORT: EditorViewport = Object.freeze({
  x: 0,
  y: 0,
  zoom: 1,
});

function cloneConnectionDockReference(
  reference: EditorConnectionDockReference | null,
): EditorConnectionDockReference | null {
  return reference === null
    ? null
    : Object.freeze({
        direction: reference.direction,
        groupId: reference.groupId,
        nodeId: reference.nodeId,
      });
}

function cloneElementReference(
  reference: EditorElementReference | null,
): EditorElementReference | null {
  return reference === null ? null : Object.freeze({ ...reference });
}

function clonePosition(position: EditorPosition): EditorPosition {
  return Object.freeze({ x: position.x, y: position.y });
}

function cloneViewport(viewport: EditorViewport): EditorViewport {
  return Object.freeze({
    x: viewport.x,
    y: viewport.y,
    zoom: viewport.zoom,
  });
}

function isFinitePosition(position: EditorPosition): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}

function isUsableViewport(viewport: EditorViewport): boolean {
  return (
    isFinitePosition(viewport) &&
    Number.isFinite(viewport.zoom) &&
    viewport.zoom > 0
  );
}

function initialTransientState(): Pick<
  EditorSessionState,
  | "activeConnectionDock"
  | "catalogPreviewServiceId"
  | "catalogSearchQuery"
  | "canvasNotice"
  | "collapsedBoundaryIds"
  | "expandedServiceNodeIds"
  | "configurationFormBuffers"
  | "hoveredElement"
  | "assistantActivity"
  | "liveAnnouncement"
  | "validationAnnouncement"
  | "previewPositions"
  | "recentServiceIds"
  | "selection"
  | "validationFocus"
  | "validationReview"
  | "viewport"
> {
  return {
    activeConnectionDock: null,
    catalogPreviewServiceId: null,
    catalogSearchQuery: "",
    canvasNotice: null,
    collapsedBoundaryIds: new Set(),
    expandedServiceNodeIds: new Set(),
    configurationFormBuffers: new Map(),
    hoveredElement: null,
    assistantActivity: null,
    liveAnnouncement: "",
    validationAnnouncement: "",
    previewPositions: new Map(),
    recentServiceIds: [],
    selection: null,
    validationFocus: null,
    validationReview: null,
    viewport: DEFAULT_EDITOR_VIEWPORT,
  };
}

/**
 * Creates one editor-local transient store. Architecture Documents and Graph
 * Commands deliberately do not live in this store.
 */
export function createEditorSessionStore(): EditorSessionStore {
  return createStore<EditorSessionState>((set) => ({
    ...initialTransientState(),
    setAssistantActivity(assistantActivity) {
      set({ assistantActivity });
    },
    announce(message) {
      set({ liveAnnouncement: message });
    },
    announceValidation(message) {
      set({ validationAnnouncement: message });
    },
    clearAllPositionPreviews() {
      set({ previewPositions: new Map() });
    },
    clearConfigurationFormBuffer(key) {
      set((state) => {
        if (!state.configurationFormBuffers.has(key)) {
          return state;
        }

        const configurationFormBuffers = new Map(
          state.configurationFormBuffers,
        );
        configurationFormBuffers.delete(key);
        return { configurationFormBuffers };
      });
    },
    clearNodePositionPreview(nodeId) {
      set((state) => {
        if (!state.previewPositions.has(nodeId)) {
          return state;
        }

        const previewPositions = new Map(state.previewPositions);
        previewPositions.delete(nodeId);
        return { previewPositions };
      });
    },
    recordRecentService(serviceId) {
      if (serviceId.trim() === "") {
        return;
      }
      set((state) => ({
        recentServiceIds: [
          serviceId,
          ...state.recentServiceIds.filter(
            (candidate) => candidate !== serviceId,
          ),
        ].slice(0, 5),
      }));
    },
    reset() {
      set(initialTransientState());
    },
    setActiveConnectionDock(dock) {
      if (
        dock !== null &&
        (dock.nodeId.trim() === "" || dock.groupId.trim() === "")
      ) {
        return;
      }
      set({ activeConnectionDock: cloneConnectionDockReference(dock) });
    },
    setCanvasNotice(notice) {
      set({
        canvasNotice:
          notice === null
            ? null
            : Object.freeze({
                message: notice.message,
                tone: notice.tone,
              }),
      });
    },
    setBoundaryCollapsed(nodeId, collapsed) {
      if (nodeId.trim() === "") {
        return;
      }
      set((state) => {
        const collapsedBoundaryIds = new Set(state.collapsedBoundaryIds);
        if (collapsed) {
          collapsedBoundaryIds.add(nodeId);
        } else {
          collapsedBoundaryIds.delete(nodeId);
        }
        return { collapsedBoundaryIds };
      });
    },
    setServiceNodeExpanded(nodeId, expanded) {
      if (nodeId.trim() === "") {
        return;
      }
      set((state) => {
        const expandedServiceNodeIds = new Set(state.expandedServiceNodeIds);
        if (expanded) {
          expandedServiceNodeIds.add(nodeId);
        } else {
          expandedServiceNodeIds.delete(nodeId);
        }
        return { expandedServiceNodeIds };
      });
    },
    setCatalogPreviewServiceId(serviceId) {
      set({
        catalogPreviewServiceId:
          serviceId === null || serviceId.trim() === "" ? null : serviceId,
      });
    },
    setCatalogSearchQuery(query) {
      set({ catalogSearchQuery: query.slice(0, 256) });
    },
    setConfigurationFormBuffer(key, buffer) {
      if (key.trim() === "") {
        return;
      }

      set((state) => {
        const configurationFormBuffers = new Map(
          state.configurationFormBuffers,
        );
        configurationFormBuffers.set(
          key,
          Object.freeze({
            shouldValidate: buffer.shouldValidate,
            values: Object.freeze(structuredClone(buffer.values)),
          }),
        );
        return { configurationFormBuffers };
      });
    },
    setHoveredElement(element) {
      set({ hoveredElement: cloneElementReference(element) });
    },
    setNodePositionPreview(nodeId, position) {
      if (!isFinitePosition(position)) {
        return;
      }

      set((state) => {
        const previewPositions = new Map(state.previewPositions);
        previewPositions.set(nodeId, clonePosition(position));
        return { previewPositions };
      });
    },
    setSelection(selection) {
      set({ selection: cloneElementReference(selection) });
    },
    setValidationFindingReviewed(documentHash, target, findingId, reviewed) {
      if (documentHash.trim() === "" || findingId.trim() === "") {
        return;
      }
      set((state) => {
        const previousFindingIds =
          state.validationReview?.documentHash === documentHash
            ? state.validationReview.findingIdsByTarget
            : { draft: new Set<string>(), compilation: new Set<string>() };
        const findingIdsByTarget = {
          draft: new Set(previousFindingIds.draft),
          compilation: new Set(previousFindingIds.compilation),
        } satisfies Record<EditorValidationTarget, Set<string>>;
        const findingIds = findingIdsByTarget[target];
        if (reviewed) {
          findingIds.add(findingId);
        } else {
          findingIds.delete(findingId);
        }
        return {
          validationReview: Object.freeze({
            documentHash,
            findingIdsByTarget: Object.freeze(findingIdsByTarget),
          }),
        };
      });
    },
    setValidationFocus(focus) {
      set({
        validationFocus:
          focus === null
            ? null
            : Object.freeze({
                findingId: focus.findingId,
                location: structuredClone(focus.location),
                target: focus.target,
              }),
      });
    },
    setViewport(viewport) {
      if (!isUsableViewport(viewport)) {
        return;
      }

      set({ viewport: cloneViewport(viewport) });
    },
  }));
}
