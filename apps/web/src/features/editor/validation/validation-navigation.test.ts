import {
  createValidationDocumentPath,
  createValidationFindingCode,
  defineValidationRuleV1,
  validateArchitectureDocumentWithRules,
  type ValidationAffectedLocation,
} from "@cloudmarkup/domain";
import { describe, expect, it, vi } from "vitest";

import { loadFoundationArchitectureDocument } from "../model/index.js";
import { createEditorSessionStore } from "../session/editor-session-store.js";
import {
  validationFocusTargetId,
  validationLocationEdgeId,
  validationLocationMatchesPort,
  validationLocationNodeId,
  navigateToValidationFinding,
} from "./validation-navigation.js";

const document = loadFoundationArchitectureDocument();
const boundaryNode = document.nodes.find((node) => node.id === "node_network");
const edge = document.edges.find(
  (candidate) => candidate.id === "edge_application_network",
);
if (boundaryNode === undefined || edge === undefined) {
  throw new Error(
    "The foundation validation navigation fixtures are required.",
  );
}

const nodeLocation: ValidationAffectedLocation = {
  kind: "node",
  nodeId: boundaryNode.id,
  path: createValidationDocumentPath("$.nodes[0]"),
};
const edgeLocation: ValidationAffectedLocation = {
  edgeId: edge.id,
  kind: "edge",
  path: createValidationDocumentPath("$.edges[0]"),
};
const portLocation: ValidationAffectedLocation = {
  edgeId: edge.id,
  endpoint: "source",
  kind: "port",
  nodeId: edge.semantic.source.nodeId,
  path: createValidationDocumentPath("$.edges[0].semantic.source.port"),
  port: edge.semantic.source.port,
};

describe("validation finding navigation", () => {
  it("reports actual fallback focus and repeats user feedback while preserving background validation", () => {
    const location: ValidationAffectedLocation = {
      kind: "configuration",
      owner: { kind: "node", nodeId: boundaryNode.id },
      key: "missingField",
      path: createValidationDocumentPath(
        "$.nodes[0].semantic.configuration.values.missingField",
      ),
    };
    const code = createValidationFindingCode(
      "test.validation.navigation-focus",
    );
    const rule = defineValidationRuleV1({
      id: "test.validation.navigation-focus",
      interfaceVersion: 1,
      ruleVersion: "1.0.0",
      input: "architecture-document",
      applicability: {
        catalogs: { kind: "all" },
        environments: ["unknown"],
        providers: { kind: "all" },
        targets: ["draft"],
      },
      evaluate: () => [
        {
          code,
          severity: "error",
          title: "Review the field",
          beginnerExplanation: "Correct the affected setting.",
          technicalExplanation: "Synthetic missing-field navigation.",
          affected: [location],
          documentationReferences: [],
        },
      ],
    });
    const finding = validateArchitectureDocumentWithRules({
      document,
      environment: "unknown",
      target: "draft",
      additionalRules: [rule],
    }).findings.find((entry) => entry.code === code);
    if (finding === undefined)
      throw new Error("Canonical navigation finding is required.");
    const store = createEditorSessionStore();
    store.getState().announceValidation("Validation complete.");
    const messages: string[] = [];
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.liveAnnouncement !== previous.liveAnnouncement)
        messages.push(state.liveAnnouncement);
    });
    const container = globalThis.document.createElement("div");
    const fallback = globalThis.document.createElement("div");
    fallback.id = "architecture-list";
    fallback.tabIndex = -1;
    container.append(fallback);
    globalThis.document.body.append(container);
    vi.useFakeTimers();
    try {
      const navigate = () => {
        navigateToValidationFinding({
          finding,
          location,
          shell: null,
          store,
          target: "draft",
        });
      };
      navigate();
      vi.runAllTimers();
      expect(globalThis.document.activeElement).toBe(fallback);
      const firstMessage = store.getState().liveAnnouncement;
      expect(firstMessage).toContain("architecture list");
      expect(firstMessage).not.toContain("Focused the affected configuration");
      navigate();
      vi.runAllTimers();
      expect(messages.slice(-3)).toEqual([firstMessage, "", firstMessage]);
      const details = globalThis.document.createElement("details");
      const control = globalThis.document.createElement("input");
      control.id = validationFocusTargetId(location).targetId;
      control.disabled = true;
      details.append(control);
      container.append(details);
      navigate();
      vi.runAllTimers();
      expect(globalThis.document.activeElement).toBe(fallback);
      control.disabled = false;
      navigate();
      vi.runAllTimers();
      expect(details.open).toBe(true);
      expect(globalThis.document.activeElement).toBe(control);
      expect(store.getState().liveAnnouncement).toContain(
        "Focused the affected configuration",
      );
      control.readOnly = true;
      navigate();
      vi.runAllTimers();
      expect(globalThis.document.activeElement).toBe(fallback);
      const dialog = globalThis.document.createElement("div");
      dialog.setAttribute("data-cm-modal-drawer", "");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "navigation-panel-title");
      const title = globalThis.document.createElement("h2");
      title.id = "navigation-panel-title";
      title.tabIndex = -1;
      title.textContent = "Configure inspector";
      dialog.append(title);
      container.append(dialog);
      navigate();
      vi.runAllTimers();
      expect(globalThis.document.activeElement).toBe(title);
      expect(store.getState().liveAnnouncement).toContain(
        "configuration panel",
      );
      expect(store.getState().validationAnnouncement).toBe(
        "Validation complete.",
      );
      navigate();
      store.getState().setValidationFocus(null);
      vi.runAllTimers();
      expect(store.getState().liveAnnouncement).toBe("");
    } finally {
      unsubscribe();
      vi.useRealTimers();
      container.remove();
    }
  });

  it.each([
    {
      expected: { targetId: "architecture-list" },
      location: {
        kind: "document",
        path: createValidationDocumentPath("$"),
      } satisfies ValidationAffectedLocation,
      name: "document",
    },
    {
      expected: { targetId: "validation-architecture-node-node_network" },
      location: nodeLocation,
      name: "node or boundary",
    },
    {
      expected: {
        targetId: "validation-architecture-edge-edge_application_network",
      },
      location: edgeLocation,
      name: "edge",
    },
    {
      expected: {
        targetId:
          "validation-architecture-port-node_application-example.port.network-client",
      },
      location: portLocation,
      name: "port",
    },
    {
      expected: {
        inspectorTab: "configure",
        targetId: "inspector-configuration-node-node_network-timeout",
      },
      location: {
        key: "timeout",
        kind: "configuration",
        owner: { kind: "node", nodeId: boundaryNode.id },
        path: createValidationDocumentPath(
          "$.nodes[1].semantic.configuration.values.timeout",
        ),
      } satisfies ValidationAffectedLocation,
      name: "node configuration field",
    },
    {
      expected: {
        inspectorTab: "configure",
        targetId:
          "inspector-configuration-edge-edge_application_network-routeKey",
      },
      location: {
        key: "routeKey",
        kind: "configuration",
        owner: { edgeId: edge.id, kind: "edge" },
        path: createValidationDocumentPath(
          "$.edges[0].semantic.configuration.values.routeKey",
        ),
      } satisfies ValidationAffectedLocation,
      name: "edge configuration field",
    },
  ])("maps $name to one exact fallback target", ({ expected, location }) => {
    expect(validationFocusTargetId(location)).toEqual(expected);
  });

  it("projects node, edge, and exact port highlight ownership without conflating ports", () => {
    expect(validationLocationNodeId(nodeLocation)).toBe("node_network");
    expect(validationLocationEdgeId(nodeLocation)).toBeNull();

    expect(validationLocationNodeId(edgeLocation)).toBeNull();
    expect(validationLocationEdgeId(edgeLocation)).toBe(
      "edge_application_network",
    );

    expect(validationLocationNodeId(portLocation)).toBe("node_application");
    expect(validationLocationEdgeId(portLocation)).toBe(
      "edge_application_network",
    );
    expect(
      validationLocationMatchesPort(
        portLocation,
        edge.semantic.source.nodeId,
        edge.semantic.source.port,
      ),
    ).toBe(true);
    expect(
      validationLocationMatchesPort(
        portLocation,
        edge.semantic.source.nodeId,
        edge.semantic.target.port,
      ),
    ).toBe(false);
  });
});
