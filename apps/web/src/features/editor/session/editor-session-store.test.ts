import { describe, expect, it } from "vitest";

import { createEditorSessionStore } from "./editor-session-store.js";

describe("editor session store", () => {
  it("owns selection, hover, and announcement state without document data", () => {
    const store = createEditorSessionStore();

    store.getState().setSelection({ id: "node-a", kind: "node" });
    store.getState().setHoveredElement({ id: "edge-a", kind: "edge" });
    store.getState().announce("Selection changed.");
    store
      .getState()
      .announceValidation("Draft validation complete: 1 finding.");

    expect(store.getState().selection).toEqual({
      id: "node-a",
      kind: "node",
    });
    expect(store.getState().hoveredElement).toEqual({
      id: "edge-a",
      kind: "edge",
    });
    expect(store.getState().liveAnnouncement).toBe("Selection changed.");
    expect(store.getState().validationAnnouncement).toBe(
      "Draft validation complete: 1 finding.",
    );
    expect(Object.keys(store.getState())).not.toContain("document");
    expect(Object.keys(store.getState())).not.toContain("hashes");

    store.getState().setSelection(null);
    expect(store.getState().selection).toBeNull();
  });

  it("bounds and deduplicates recently used services in most-recent-first order", () => {
    const store = createEditorSessionStore();

    for (const serviceId of [
      "example.service.one",
      "example.service.two",
      "example.service.three",
      "example.service.four",
      "example.service.five",
      "example.service.two",
      "example.service.six",
      "   ",
    ]) {
      store.getState().recordRecentService(serviceId);
    }

    expect(store.getState().recentServiceIds).toEqual([
      "example.service.six",
      "example.service.two",
      "example.service.five",
      "example.service.four",
      "example.service.three",
    ]);
  });

  it("keeps boundary collapse as transient presentation state", () => {
    const store = createEditorSessionStore();

    store.getState().setBoundaryCollapsed("node-boundary", true);
    expect(store.getState().collapsedBoundaryIds).toEqual(
      new Set(["node-boundary"]),
    );
    expect(Object.keys(store.getState())).not.toContain("document");
    expect(Object.keys(store.getState())).not.toContain("command");

    store.getState().setBoundaryCollapsed("node-boundary", false);
    expect(store.getState().collapsedBoundaryIds.size).toBe(0);
  });

  it("defaults service cards to compact and keeps expansion resettable", () => {
    const store = createEditorSessionStore();

    expect(store.getState().expandedServiceNodeIds.size).toBe(0);
    store.getState().setServiceNodeExpanded("node-service", true);
    store.getState().setServiceNodeExpanded("   ", true);
    expect(store.getState().expandedServiceNodeIds).toEqual(
      new Set(["node-service"]),
    );
    expect(Object.keys(store.getState())).not.toContain("document");
    expect(Object.keys(store.getState())).not.toContain("command");

    store.getState().setServiceNodeExpanded("node-service", false);
    expect(store.getState().expandedServiceNodeIds.size).toBe(0);

    store.getState().setServiceNodeExpanded("node-service", true);
    store.getState().reset();
    expect(store.getState().expandedServiceNodeIds.size).toBe(0);
  });

  it("clones, replaces, and clears configuration form buffers without storing documents", () => {
    const store = createEditorSessionStore();
    const sourceValues: Record<string, unknown> = {
      enabled: true,
      nested: { label: "original" },
    };

    store.getState().setConfigurationFormBuffer("node:a:schema@1", {
      shouldValidate: false,
      values: sourceValues,
    });
    sourceValues["enabled"] = false;
    (sourceValues["nested"] as { label: string }).label = "mutated";

    expect(
      store.getState().configurationFormBuffers.get("node:a:schema@1"),
    ).toEqual({
      shouldValidate: false,
      values: {
        enabled: true,
        nested: { label: "original" },
      },
    });
    expect(Object.keys(store.getState())).not.toContain("document");
    expect(Object.keys(store.getState())).not.toContain("command");

    store.getState().setConfigurationFormBuffer("node:a:schema@1", {
      shouldValidate: true,
      values: { enabled: false },
    });
    expect(
      store.getState().configurationFormBuffers.get("node:a:schema@1"),
    ).toEqual({
      shouldValidate: true,
      values: { enabled: false },
    });
    expect(store.getState().configurationFormBuffers.size).toBe(1);

    store.getState().setConfigurationFormBuffer("   ", {
      shouldValidate: true,
      values: { ignored: true },
    });
    expect(store.getState().configurationFormBuffers.size).toBe(1);

    store.getState().clearConfigurationFormBuffer("node:a:schema@1");
    expect(store.getState().configurationFormBuffers.size).toBe(0);
  });

  it("keeps warning review transient and replaces it at an exact document hash boundary", () => {
    const store = createEditorSessionStore();

    store
      .getState()
      .setValidationFindingReviewed(
        "sha256:document-a",
        "draft",
        "finding-a",
        true,
      );
    store
      .getState()
      .setValidationFindingReviewed(
        "sha256:document-a",
        "compilation",
        "finding-b",
        true,
      );
    store
      .getState()
      .setValidationFindingReviewed(
        "sha256:document-a",
        "draft",
        "finding-a",
        false,
      );

    expect(store.getState().validationReview).toEqual({
      documentHash: "sha256:document-a",
      findingIdsByTarget: {
        draft: new Set(),
        compilation: new Set(["finding-b"]),
      },
    });

    store
      .getState()
      .setValidationFindingReviewed(
        "sha256:document-b",
        "draft",
        "finding-c",
        true,
      );
    expect(store.getState().validationReview).toEqual({
      documentHash: "sha256:document-b",
      findingIdsByTarget: {
        draft: new Set(["finding-c"]),
        compilation: new Set(),
      },
    });
    expect(Object.keys(store.getState())).not.toContain("document");
    expect(Object.keys(store.getState())).not.toContain("command");
  });
  it("resets every transient value to the editor defaults", () => {
    const store = createEditorSessionStore();

    store.getState().setSelection({ id: "node-a", kind: "node" });
    store.getState().setHoveredElement({ id: "node-a", kind: "node" });
    store.getState().setCatalogPreviewServiceId("example.service.one");
    store.getState().setCatalogSearchQuery("service");
    store.getState().setBoundaryCollapsed("node-boundary", true);
    store.getState().setActiveConnectionDock({
      direction: "input",
      groupId: "network-and-security",
      nodeId: "node-a",
    });
    store.getState().setConfigurationFormBuffer("node:a:schema@1", {
      shouldValidate: true,
      values: { enabled: true },
    });
    store.getState().recordRecentService("example.service.one");
    store.getState().setViewport({ x: 10, y: 20, zoom: 2 });
    store.getState().setNodePositionPreview("node-a", { x: 30, y: 40 });
    store
      .getState()
      .setValidationFindingReviewed(
        "sha256:document-a",
        "draft",
        "finding-a",
        true,
      );
    store.getState().announce("Changed.");
    store.getState().announceValidation("Validation changed.");
    store.getState().reset();

    expect(store.getState()).toMatchObject({
      activeConnectionDock: null,
      catalogPreviewServiceId: null,
      catalogSearchQuery: "",
      hoveredElement: null,
      liveAnnouncement: "",
      validationAnnouncement: "",
      recentServiceIds: [],
      selection: null,
      validationReview: null,
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(store.getState().configurationFormBuffers.size).toBe(0);
    expect(store.getState().collapsedBoundaryIds.size).toBe(0);
    expect(store.getState().expandedServiceNodeIds.size).toBe(0);
    expect(store.getState().previewPositions.size).toBe(0);
  });
});
