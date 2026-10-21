import { Button, IconButton, StatusBadge } from "@cloudmarkup/ui";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  CircleDot,
  ChevronRight,
  Frame,
  Link2,
  Move,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { useWorkspaceShellController } from "../../../shell/workspace-shell-context.js";
import type {
  ArchitectureFlowModel,
  ArchitectureFlowNode,
} from "../model/index.js";
import {
  useEditorDocumentSession,
  useEditorSessionState,
  useEditorSessionStoreApi,
} from "../session/editor-session-hooks.js";
import {
  validationLocationEdgeId,
  validationLocationMatchesPort,
  validationLocationNodeId,
} from "../validation/validation-navigation.js";

const KEYBOARD_MOVE_STEP = 16;

interface ArchitectureTreeProps {
  readonly model: ArchitectureFlowModel;
  readonly allowMovement: boolean;
  readonly showHeader?: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function ArchitectureTree({
  allowMovement,
  model,
  showHeader = true,
}: ArchitectureTreeProps) {
  const documentSession = useEditorDocumentSession();
  const workspaceShell = useWorkspaceShellController();
  const { document, status } = documentSession;
  const store = useEditorSessionStoreApi();
  const selection = useEditorSessionState((state) => state.selection);
  const validationFocus = useEditorSessionState(
    (state) => state.validationFocus,
  );
  const treeReference = useRef<HTMLDivElement>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  /* eslint-disable react-hooks/set-state-in-effect -- Validation focus is an
     external editor navigation request. Its exact port must be revealed before
     the existing focus handoff runs. */
  useEffect(() => {
    if (validationFocus === null) {
      return;
    }
    const focusedNode = model.nodes.find((node) =>
      node.data.ports.some((port) =>
        validationLocationMatchesPort(
          validationFocus.location,
          node.id,
          port.id,
        ),
      ),
    );
    if (focusedNode === undefined) {
      return;
    }
    setExpandedNodeIds((current) => {
      if (current.has(focusedNode.id)) {
        return current;
      }
      const next = new Set(current);
      next.add(focusedNode.id);
      return next;
    });
  }, [model.nodes, validationFocus]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const nodesById = useMemo(
    () => new Map(model.nodes.map((node) => [node.id, node])),
    [model.nodes],
  );
  const childIdsByParent = useMemo(() => {
    const children = new Map<string, string[]>();
    if (status !== "ready") {
      return children;
    }

    for (const node of model.nodes) {
      if (node.parentId === undefined || !nodesById.has(node.parentId)) {
        continue;
      }
      const parentId = node.parentId;
      const childIds = children.get(parentId) ?? [];
      childIds.push(node.id);
      children.set(parentId, childIds);
    }

    for (const childIds of children.values()) {
      childIds.sort(compareText);
    }
    return children;
  }, [model.nodes, nodesById, status]);

  const rootNodes = useMemo(() => {
    if (status !== "ready") {
      return [];
    }

    return model.nodes.filter(
      (node) => node.parentId === undefined || !nodesById.has(node.parentId),
    );
  }, [model.nodes, nodesById, status]);

  function moveSelectedNode(node: ArchitectureFlowNode, key: string): void {
    if (!allowMovement || !node.draggable || status !== "ready") {
      store
        .getState()
        .announce("This architecture element cannot be moved in this view.");
      return;
    }

    const architectureNode = document.nodes.find(
      (candidate) => candidate.id === node.id,
    );
    if (architectureNode === undefined) {
      return;
    }

    const delta = {
      ArrowDown: { x: 0, y: KEYBOARD_MOVE_STEP },
      ArrowLeft: { x: -KEYBOARD_MOVE_STEP, y: 0 },
      ArrowRight: { x: KEYBOARD_MOVE_STEP, y: 0 },
      ArrowUp: { x: 0, y: -KEYBOARD_MOVE_STEP },
    }[key];
    if (delta === undefined) {
      return;
    }

    documentSession.moveNode(node.id, {
      x: architectureNode.presentation.position.x + delta.x,
      y: architectureNode.presentation.position.y + delta.y,
    });
  }

  function focusSibling(current: HTMLElement, direction: -1 | 1): void {
    const items = [
      ...(treeReference.current?.querySelectorAll<HTMLElement>(
        '[data-selectable="true"]',
      ) ?? []),
    ];
    const currentIndex = items.indexOf(current);
    const nextIndex = Math.max(
      0,
      Math.min(items.length - 1, currentIndex + direction),
    );
    items[nextIndex]?.focus();
  }

  function nodeKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    node: ArchitectureFlowNode,
  ): void {
    if (
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key.toLowerCase() === "c"
    ) {
      event.preventDefault();
      store.getState().setSelection({ id: node.id, kind: "node" });
      if (!node.data.ports.some((port) => port.actionable)) {
        store
          .getState()
          .announce(
            "No implemented connection is available for this resource.",
          );
        return;
      }
      documentSession.beginConnection({ kind: "node", nodeId: node.id });
      return;
    }

    if (event.altKey && event.key.startsWith("Arrow")) {
      event.preventDefault();
      store.getState().setSelection({ id: node.id, kind: "node" });
      moveSelectedNode(node, event.key);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusSibling(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      store.getState().setSelection({ id: node.id, kind: "node" });
      store.getState().announce(`${node.data.label} selected.`);
    }
  }

  function renderNode(node: ArchitectureFlowNode) {
    const childIds = childIdsByParent.get(node.id) ?? [];
    const detailsId = `architecture-tree-details-${node.id}`;
    const hasDetails = node.data.ports.length > 0;
    const isExpanded = expandedNodeIds.has(node.id);
    const isSelected = selection?.kind === "node" && selection.id === node.id;
    const canMove = allowMovement && node.draggable === true;
    const isValidationTarget =
      validationFocus !== null &&
      validationLocationNodeId(validationFocus.location) === node.id;

    return (
      <li className="architecture-tree__item" key={node.id}>
        <div className="architecture-tree__resource-row">
          <button
            aria-current={isSelected ? "true" : undefined}
            aria-label={`${node.ariaLabel}${
              isValidationTarget ? " Finding target." : ""
            }`}
            className="architecture-tree__button"
            data-architecture-tree-node-id={node.id}
            data-selectable="true"
            data-validation-highlight={isValidationTarget ? "true" : "false"}
            id={`validation-architecture-node-${node.id}`}
            onClick={() => {
              store.getState().setSelection({ id: node.id, kind: "node" });
              store.getState().announce(`${node.data.label} selected.`);
            }}
            onKeyDown={(event) => {
              nodeKeyDown(event, node);
            }}
            type="button"
          >
            {node.type === "boundary" ? (
              <Frame aria-hidden="true" size={14} />
            ) : node.type === "fallback" ? (
              <AlertTriangle aria-hidden="true" size={14} />
            ) : (
              <Box aria-hidden="true" size={14} />
            )}
            <span className="architecture-tree__content">
              <strong>{node.data.label}</strong>
              <span className="architecture-tree__technical">
                {node.data.serviceType}
              </span>
            </span>
            <span className="architecture-tree__kind">
              {isValidationTarget ? "Finding target · " : ""}
              {node.type === "fallback" ? node.data.support.label : node.type}
              {canMove ? <Move aria-hidden="true" size={13} /> : null}
            </span>
          </button>
          {hasDetails ? (
            <IconButton
              aria-controls={detailsId}
              aria-expanded={isExpanded}
              className="architecture-tree__details-toggle"
              icon={<ChevronRight size={14} />}
              label={`${isExpanded ? "Hide" : "Show"} details for ${node.data.label}`}
              onClick={() => {
                setExpandedNodeIds((current) => {
                  const next = new Set(current);
                  if (isExpanded) {
                    next.delete(node.id);
                  } else {
                    next.add(node.id);
                  }
                  return next;
                });
                store
                  .getState()
                  .announce(
                    `${node.data.label} details ${isExpanded ? "collapsed" : "expanded"}.`,
                  );
              }}
            />
          ) : null}
        </div>
        {isSelected ? (
          <div
            className="architecture-tree__actions"
            aria-label={`Actions for ${node.data.label}`}
          >
            {(["configure", "connect", "learn", "iac"] as const).map((tab) => (
              <Button
                key={tab}
                size="compact"
                variant="quiet"
                onClick={() =>
                  tab === "iac"
                    ? workspaceShell?.openWorkspacePanel("code")
                    : workspaceShell?.openContextPanel(
                        "selected-resource-inspector",
                        tab,
                      )
                }
              >
                {tab === "iac"
                  ? "Code"
                  : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Button>
            ))}
          </div>
        ) : null}
        {canMove ? (
          <details className="architecture-tree__move-controls">
            <summary>Move or change boundary for {node.data.label}</summary>
            <div
              aria-label={`Move ${node.data.label}`}
              className="architecture-tree__move-actions"
              role="group"
            >
              {(
                [
                  ["ArrowUp", "Move up", ArrowUp],
                  ["ArrowDown", "Move down", ArrowDown],
                  ["ArrowLeft", "Move left", ArrowLeft],
                  ["ArrowRight", "Move right", ArrowRight],
                ] as const
              ).map(([key, label, Icon]) => (
                <IconButton
                  icon={<Icon size={14} />}
                  key={key}
                  label={`${label} ${node.data.label}`}
                  onClick={() => {
                    store
                      .getState()
                      .setSelection({ id: node.id, kind: "node" });
                    moveSelectedNode(node, key);
                  }}
                />
              ))}
              <Button
                aria-label={`Change boundary for ${node.data.label}`}
                onClick={() => {
                  store.getState().setSelection({ id: node.id, kind: "node" });
                  workspaceShell?.openContextPanel(
                    "selected-boundary-placement",
                    "configure",
                  );
                }}
                size="compact"
                variant="quiet"
              >
                Change boundary
              </Button>
            </div>
            <p>
              Movement changes saved presentation coordinates through the same
              Graph Command as dragging. Change boundary lists only
              catalog-valid semantic parents in Configure.
            </p>
          </details>
        ) : null}
        {hasDetails ? (
          <ul
            aria-label={`${node.data.label} details`}
            className="architecture-tree__details"
            hidden={!isExpanded}
            id={detailsId}
          >
            {node.data.ports.map((port) => {
              const isPortValidationTarget =
                validationFocus !== null &&
                validationLocationMatchesPort(
                  validationFocus.location,
                  node.id,
                  port.id,
                );
              return (
                <li
                  aria-label={`${port.displayName}, ${port.direction} capability. ${port.description.replace(/\.+$/u, "")}. Port ${port.id}. Capability ${port.capability ?? "not declared"}. Cardinality ${port.cardinality ?? "not declared"}. ${
                    port.actionable
                      ? "Connection available."
                      : "No implemented connection is available."
                  }${isPortValidationTarget ? " Finding target." : ""}`}
                  className="architecture-tree__port"
                  data-validation-highlight={
                    isPortValidationTarget ? "true" : "false"
                  }
                  id={`validation-architecture-port-${node.id}-${port.id}`}
                  key={`${node.id}:${port.id}`}
                  tabIndex={-1}
                >
                  <div className="architecture-tree__button">
                    <CircleDot aria-hidden="true" size={13} />
                    <span className="architecture-tree__content">
                      {port.displayName}
                      <span className="architecture-tree__technical">
                        {port.capability ?? "Capability not declared"} ·{" "}
                        {port.id} · {port.cardinality ?? "no cardinality"}
                      </span>
                      {port.actionable ? null : (
                        <span>No implemented connection yet</span>
                      )}
                    </span>
                    <span className="architecture-tree__kind">
                      {port.direction}
                    </span>
                  </div>
                  {port.actionable ? (
                    <Button
                      aria-label={`Connect ${node.data.label} using ${port.displayName} ${port.direction} capability`}
                      onClick={() => {
                        documentSession.beginConnection({
                          direction: port.direction,
                          kind: "port",
                          nodeId: node.id,
                          portId: port.id,
                        });
                      }}
                      size="compact"
                      variant="quiet"
                    >
                      <Link2 aria-hidden="true" size={13} /> Connect
                    </Button>
                  ) : (
                    <StatusBadge label="Unsupported" tone="unsupported" />
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
        {childIds.length === 0 ? null : (
          <ul>
            {childIds.map((childId) => {
              const child = nodesById.get(childId);
              return child === undefined ? null : renderNode(child);
            })}
          </ul>
        )}
      </li>
    );
  }

  return (
    <section
      className={`architecture-summary ${
        showHeader ? "" : "architecture-summary--embedded"
      }`}
      aria-label="Architecture summary"
    >
      {showHeader ? (
        <header className="architecture-summary__header">
          <p className="status-label">Synchronized document view</p>
          <h2>Architecture list</h2>
          <p>
            Select the same stable elements without relying on canvas position.
          </p>
        </header>
      ) : null}
      <div
        aria-label="Architecture list"
        className="architecture-tree"
        id="architecture-list"
        ref={treeReference}
        role="region"
        tabIndex={-1}
      >
        <ul aria-label="Architecture elements">
          {rootNodes.map((node) => renderNode(node))}
        </ul>
        {model.edges.length === 0 ? null : (
          <ul aria-label="Relationships">
            {model.edges.map((edge) => {
              const isSelected =
                selection?.kind === "edge" && selection.id === edge.id;
              const isValidationTarget =
                validationFocus !== null &&
                validationLocationEdgeId(validationFocus.location) === edge.id;
              return (
                <li className="architecture-tree__item" key={edge.id}>
                  <button
                    aria-current={isSelected ? "true" : undefined}
                    aria-label={`${edge.ariaLabel}${
                      isValidationTarget ? " Finding target." : ""
                    }`}
                    className="architecture-tree__button"
                    data-architecture-tree-edge-id={edge.id}
                    data-selectable="true"
                    data-validation-highlight={
                      isValidationTarget ? "true" : "false"
                    }
                    id={`validation-architecture-edge-${edge.id}`}
                    onClick={() => {
                      store
                        .getState()
                        .setSelection({ id: edge.id, kind: "edge" });
                      store
                        .getState()
                        .announce(
                          `${edge.data?.label ?? "Relationship"} selected.`,
                        );
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        focusSibling(
                          event.currentTarget,
                          event.key === "ArrowDown" ? 1 : -1,
                        );
                      } else if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        store
                          .getState()
                          .setSelection({ id: edge.id, kind: "edge" });
                      }
                    }}
                    type="button"
                  >
                    <Link2 aria-hidden="true" size={14} />
                    <span className="architecture-tree__content">
                      <strong>{edge.data?.label ?? "Relationship"}</strong>
                      <span className="architecture-tree__technical">
                        {edge.data?.relationshipType}
                      </span>
                    </span>
                    {isValidationTarget ? (
                      <StatusBadge label="Finding target" tone="warning" />
                    ) : null}
                    <StatusBadge
                      label={
                        edge.data?.relationship.kind === "catalog"
                          ? "Catalog"
                          : "Generic"
                      }
                      tone={
                        edge.data?.relationship.kind === "catalog"
                          ? "info"
                          : "incomplete"
                      }
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="architecture-tree__move-help">
        {allowMovement
          ? "Select with Enter or Space, press C to connect a focused resource, use Move or change boundary, or hold Alt and press an arrow key for the same Graph Command."
          : "Select with Enter or Space or press C to connect a focused resource. Use a desktop canvas for precision movement."}
      </p>
    </section>
  );
}
