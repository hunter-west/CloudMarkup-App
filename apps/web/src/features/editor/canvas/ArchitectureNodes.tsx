import {
  boundaryOverviewAtZoom,
  boundaryOverviewTile,
  compactServiceTile,
} from "./compact-service-tile.js";
import {
  Button,
  NeutralProviderIcon,
  Popover,
  ServiceIconContainer,
  StatusBadge,
} from "@cloudmarkup/ui";
import {
  Handle,
  NodeToolbar,
  Position,
  useStore,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Info,
  Link2,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  memo,
} from "react";
import { createPortal } from "react-dom";

import { useWorkspaceShellController } from "../../../shell/workspace-shell-context.js";
import { CatalogServiceIcon } from "../../../provider-icons/CatalogServiceIcon.js";
import { useModePreference } from "../../../preferences/index.js";
import type {
  ArchitectureConnectionGroupData,
  ArchitectureFlowNode,
} from "../model/index.js";
import { resolveExactEditorCatalogRelationship } from "@cloudmarkup/graph-preparation/catalog-selection";
import {
  useEditorDocumentSession,
  useEditorDocumentIndex,
  useEditorSessionState,
  useEditorSessionStoreApi,
} from "../session/editor-session-hooks.js";
import { snapshotFromValidationState } from "../validation/editor-validation.js";
import {
  validationLocationEdgeId,
  validationLocationMatchesPort,
  validationLocationNodeId,
} from "../validation/validation-navigation.js";
import {
  CONNECTION_DOCK_SIDES,
  collapsedConnectionDockGroupId,
  connectionDockBuckets,
  connectionDockFaces,
  connectionDockHandlePosition,
  connectionDockPosition,
  type ConnectionDockDirection,
  type ConnectionDockFace,
} from "./connection-dock-presentation.js";

function ConnectionDragSurface({
  children,
  direction,
  groupId,
  side,
  enabled = true,
}: {
  readonly children: ReactNode;
  readonly direction: ConnectionDockDirection;
  readonly groupId: string;
  readonly side: ConnectionDockFace["side"];
  readonly enabled?: boolean;
}) {
  if (!enabled) return children;
  return (
    <Handle
      className="architecture-connection-dock__drag-surface"
      id={`connect:${groupId}:${direction}`}
      isConnectable
      position={connectionDockHandlePosition(side)}
      tabIndex={-1}
      type={direction === "input" ? "target" : "source"}
    >
      {children}
    </Handle>
  );
}

function ConnectionDock({
  group,
  direction,
  layout = "rail",
  nodeId,
  nodeLabel,
  ownerRef,
  style,
  portIds,
  side,
}: {
  readonly direction: ConnectionDockDirection;
  readonly group: ArchitectureConnectionGroupData;
  readonly layout?: "details" | "rail";
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly ownerRef: RefObject<HTMLElement | null>;
  readonly portIds: readonly string[];
  readonly side: ConnectionDockFace["side"];
  readonly style?: CSSProperties;
}) {
  const session = useEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const shell = useWorkspaceShellController();
  const { mode } = useModePreference();
  const open = useEditorSessionState(
    (state) =>
      state.activeConnectionDock?.nodeId === nodeId &&
      state.activeConnectionDock.groupId === group.id &&
      state.activeConnectionDock.direction === direction,
  );
  const isValidationTarget = useEditorSessionState((state) =>
    portIds.some(
      (portId) =>
        state.validationFocus !== null &&
        validationLocationMatchesPort(
          state.validationFocus.location,
          nodeId,
          portId,
        ),
    ),
  );
  const document = session.status === "ready" ? session.document : null;
  const documentIndex = useEditorDocumentIndex();
  const currentEdges =
    document === null
      ? []
      : group.currentEdgeIds.flatMap((edgeId) => {
          const edge = documentIndex?.edgesById.get(edgeId);
          if (edge === undefined) {
            return [];
          }
          const endpoint =
            direction === "input" ? edge.semantic.target : edge.semantic.source;
          return endpoint.nodeId === nodeId && portIds.includes(endpoint.port)
            ? [edge]
            : [];
        });
  const actionable = group.ports.some(
    (port) => port.direction === direction && port.actionable,
  );
  const currentConnectionLabel = `${String(currentEdges.length)} current ${
    currentEdges.length === 1 ? "connection" : "connections"
  }`;
  const dockInspection = open
    ? session.inspectConnectionDock(nodeId, portIds)
    : null;

  return (
    <span
      className={`architecture-connection-dock architecture-connection-dock--${layout} nodrag nopan`}
      data-connection-control-layout={layout}
      data-actionable={actionable ? "true" : "false"}
      data-connection-group-id={group.id}
      data-direction={direction}
      data-side={side}
      data-validation-highlight={isValidationTarget ? "true" : "false"}
      style={style}
    >
      {/* Left/right rails use node-adjacent placement; top/bottom use the shared trigger fallback. */}
      <ConnectionDragSurface
        direction={direction}
        groupId={group.id}
        side={side}
        enabled={layout === "rail"}
      >
        <Popover
          {...(side === "left" || side === "right"
            ? { adjacentPositioning: { ownerRef, preferredPlacement: side } }
            : {})}
          className="architecture-connection-dock__popover"
          label={`${group.label} ${direction} connections for ${nodeLabel}`}
          onOpenChange={(nextOpen) => {
            if (nextOpen) {
              store.getState().setActiveConnectionDock({
                direction,
                groupId: group.id,
                nodeId,
              });
              return;
            }
            const currentDock = store.getState().activeConnectionDock;
            if (
              currentDock?.nodeId === nodeId &&
              currentDock.groupId === group.id &&
              currentDock.direction === direction
            ) {
              store.getState().setActiveConnectionDock(null);
            }
          }}
          open={open}
          renderContent={(content) => {
            const ownerDocument = ownerRef.current?.ownerDocument;
            return ownerDocument === undefined
              ? content
              : createPortal(content, ownerDocument.body);
          }}
          trigger={
            <span className="architecture-connection-dock__trigger-content">
              <span
                aria-hidden="true"
                className="architecture-connection-dock__dot"
                data-status={actionable ? "available" : "information-only"}
              />
              {layout === "details" ? (
                <span className="architecture-connection-dock__details-copy">
                  <strong>{group.label}</strong>
                  <span>
                    {direction === "input" ? "Input" : "Output"} ·{" "}
                    {currentConnectionLabel}
                  </span>
                </span>
              ) : null}
              {isValidationTarget ? (
                <span
                  aria-hidden="true"
                  className="architecture-connection-dock__validation-marker"
                  data-status="finding-target"
                >
                  <AlertTriangle size={13} />
                </span>
              ) : null}
              {layout === "details" || currentEdges.length === 0 ? null : (
                <span
                  aria-hidden="true"
                  className="architecture-connection-dock__count"
                >
                  {String(currentEdges.length)}
                </span>
              )}
            </span>
          }
          triggerLabel={`Open ${group.label} ${direction} connections for ${nodeLabel}; ${currentConnectionLabel}; ${
            actionable ? "connections available" : "information only"
          }${isValidationTarget ? "; finding target" : ""}`}
          triggerTooltip={{
            content: `${direction === "input" ? "Input" : "Output"}: ${group.label}`,
            placement: side,
            renderInPortal: layout === "details",
          }}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- This non-interactive boundary only prevents canvas gestures from observing menu clicks. */}
          <section
            className="architecture-connection-menu"
            onClick={(event) => {
              event.stopPropagation();
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
          >
            <header>
              <h3>{group.label}</h3>
              <p>
                {mode === "guided"
                  ? group.guidedAssistance
                  : group.professionalMetadata}
              </p>
              <details className="architecture-connection-menu__technical">
                <summary>Technical details</summary>
                <p>
                  Dock ID: {group.id}. Category: {group.category}. Placement:{" "}
                  {side}. Endpoint direction: {direction}. Group direction:{" "}
                  {group.direction}.
                </p>
                <p>
                  {group.category}; {side} dock; {direction}; cardinality{" "}
                  {String(group.cardinality.minimum)} to{" "}
                  {group.cardinality.maximum === "many"
                    ? "many"
                    : String(group.cardinality.maximum)}{" "}
                  ({group.cardinality.enforcement}); exclusive relationships{" "}
                  {group.containsExclusiveRelationships ? "present" : "absent"}
                </p>
                <p>Semantic ports: {portIds.join(", ")}.</p>
              </details>
            </header>
            <section
              aria-labelledby={`${nodeId}-${group.id}-${direction}-current`}
            >
              <h4 id={`${nodeId}-${group.id}-${direction}-current`}>
                Current connections
              </h4>
              {currentEdges.length === 0 ? (
                <p>No current connections in this group.</p>
              ) : (
                <ul className="architecture-connection-menu__list">
                  {currentEdges.map((edge) => {
                    const fromThisNode = edge.semantic.source.nodeId === nodeId;
                    const remoteNodeId = fromThisNode
                      ? edge.semantic.target.nodeId
                      : edge.semantic.source.nodeId;
                    const remoteLabel =
                      document?.nodes.find((node) => node.id === remoteNodeId)
                        ?.presentation.label ?? remoteNodeId;
                    const exactPortId = fromThisNode
                      ? edge.semantic.source.port
                      : edge.semantic.target.port;
                    const relationship =
                      document === null
                        ? undefined
                        : resolveExactEditorCatalogRelationship(
                            document,
                            edge,
                            session.catalog,
                          );
                    const relationshipLabel =
                      relationship?.presentationLabel ??
                      relationship?.displayName ??
                      "Relationship";
                    const validationSnapshot = snapshotFromValidationState(
                      session.validation,
                    );
                    const edgeFindings =
                      validationSnapshot === null
                        ? []
                        : [
                            ...validationSnapshot.draftReport.findings,
                            ...validationSnapshot.compilationReport.findings,
                          ].filter((finding) =>
                            finding.affected.some(
                              (location) =>
                                validationLocationEdgeId(location) === edge.id,
                            ),
                          );
                    const hasError = edgeFindings.some(
                      (finding) =>
                        finding.severity === "error" ||
                        finding.severity === "security-error",
                    );
                    const hasWarning = edgeFindings.some(
                      (finding) =>
                        finding.severity === "warning" ||
                        finding.severity === "cost-warning",
                    );
                    const editable =
                      edge.semantic.lifecycle.ownership === "generated";
                    const disconnectable =
                      edge.semantic.lifecycle.ownership === "user";
                    return (
                      <li key={edge.id}>
                        <span>
                          <strong>{remoteLabel}</strong>
                          <span>
                            {fromThisNode ? "Outgoing" : "Incoming"} -{" "}
                            {relationshipLabel}
                          </span>
                          {hasError ? (
                            <StatusBadge
                              label="Connection issue"
                              tone="error"
                            />
                          ) : hasWarning ? (
                            <StatusBadge label="Needs review" tone="warning" />
                          ) : null}
                          <details className="architecture-connection-menu__technical">
                            <summary>Technical details</summary>
                            <span>Edge ID: {edge.id}</span>
                            <span>Semantic port: {exactPortId}</span>
                            <span>
                              Relationship type:{" "}
                              {edge.semantic.relationshipType}
                            </span>
                          </details>
                        </span>
                        <span className="architecture-connection-menu__actions">
                          <Button
                            aria-label={`${editable ? "Manage" : disconnectable ? "Settings for" : "Details for"} ${remoteLabel} connection ${edge.id}`}
                            onClick={() => {
                              if (editable) {
                                session.beginConnection({
                                  edgeId: edge.id,
                                  kind: "edge",
                                });
                                return;
                              }
                              store
                                .getState()
                                .setSelection({ id: edge.id, kind: "edge" });
                              shell?.openContextPanel(
                                "selected-resource-inspector",
                                disconnectable ? "configure" : "connect",
                              );
                            }}
                            size="compact"
                            variant="secondary"
                          >
                            {editable
                              ? "Manage"
                              : disconnectable
                                ? "Settings"
                                : "Details"}
                          </Button>
                          {disconnectable ? (
                            <Button
                              aria-label={`Remove ${remoteLabel} connection ${edge.id}`}
                              onClick={() => {
                                session.disconnectEdge(edge.id);
                              }}
                              size="compact"
                              variant="secondary"
                            >
                              Remove
                            </Button>
                          ) : edge.semantic.lifecycle.ownership ===
                            "adopted" ? (
                            <span className="architecture-connection-menu__unavailable-reason">
                              Adopted connections require separate ownership
                              review before removal.
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section
              aria-labelledby={`${nodeId}-${group.id}-${direction}-available`}
            >
              <h4 id={`${nodeId}-${group.id}-${direction}-available`}>
                Available connections
              </h4>
              {dockInspection?.unavailableReason === null ? (
                <ul className="architecture-connection-menu__list">
                  {dockInspection.purposes.map((purpose) => (
                    <li key={purpose.portId}>
                      <span>
                        <strong>{purpose.displayName}</strong>
                        <span>{purpose.description}</span>
                        {purpose.choices.length === 0 ? (
                          <span className="architecture-connection-menu__unavailable-reason">
                            Unavailable: {purpose.unavailableReason?.[mode]}
                          </span>
                        ) : (
                          <span
                            aria-label={`Compatible resources for ${purpose.displayName}`}
                            className="architecture-connection-menu__choices"
                            role="list"
                          >
                            {purpose.choices.map((choice) => (
                              <span
                                data-available={
                                  choice.available ? "true" : "false"
                                }
                                key={`${choice.ruleId}:${choice.source.nodeId}:${choice.source.portId}:${choice.target.nodeId}:${choice.target.portId}`}
                                role="listitem"
                              >
                                <span>
                                  <strong>{choice.remoteNodeLabel}</strong>
                                  <span>{choice.remoteServiceName}</span>
                                  <span>
                                    {choice.direction === "outgoing"
                                      ? "Outgoing"
                                      : "Incoming"}
                                    {" - "}
                                    {choice.relationshipLabel}
                                  </span>
                                  {choice.recommendation === null ? null : (
                                    <span className="architecture-connection-menu__recommendation">
                                      Recommended. {choice.recommendation[mode]}
                                    </span>
                                  )}
                                  {choice.unavailableReason === null ? null : (
                                    <span className="architecture-connection-menu__unavailable-reason">
                                      Unavailable:{" "}
                                      {choice.unavailableReason[mode]}
                                    </span>
                                  )}
                                  <details className="architecture-connection-menu__technical">
                                    <summary>Technical details</summary>
                                    <span>Rule ID: {choice.ruleId}</span>
                                    <span>
                                      Relationship type:{" "}
                                      {choice.relationshipType}
                                    </span>
                                    <span>
                                      Source: {choice.source.nodeId} /{" "}
                                      {choice.source.portId}
                                    </span>
                                    <span>
                                      Target: {choice.target.nodeId} /{" "}
                                      {choice.target.portId}
                                    </span>
                                  </details>
                                </span>
                                <Button
                                  aria-label={`Connect ${purpose.displayName} ${choice.direction} with ${choice.remoteNodeLabel}`}
                                  disabled={!choice.available}
                                  onClick={() => {
                                    session.beginConnection({
                                      kind: "endpoints",
                                      source: choice.source,
                                      target: choice.target,
                                    });
                                  }}
                                  size="compact"
                                  variant="secondary"
                                >
                                  Connect
                                </Button>
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="architecture-connection-menu__unavailable-reason">
                  Unavailable: {dockInspection?.unavailableReason?.[mode]}
                </p>
              )}
            </section>
            {isValidationTarget ? (
              <p className="architecture-validation-target-marker">
                Finding target
              </p>
            ) : null}
          </section>
        </Popover>
      </ConnectionDragSurface>
    </span>
  );
}

function PresentationFacts({
  data,
}: {
  readonly data: ArchitectureFlowNode["data"];
}) {
  if (data.primaryFacts.length === 0) {
    return null;
  }
  return (
    <dl
      aria-label={`Key configuration for ${data.label}`}
      className="architecture-node__facts"
    >
      {data.primaryFacts.map((fact) => (
        <div data-tone={fact.tone} key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AssociationBadges({
  data,
}: {
  readonly data: ArchitectureFlowNode["data"];
}) {
  if (data.associationBadges.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label={`Network associations for ${data.label}`}
      className="architecture-node__associations"
    >
      {data.associationBadges.map((badge) => (
        <li
          data-association-id={badge.id}
          data-edge-count={badge.count}
          key={badge.id}
        >
          <Link2 aria-hidden="true" size={13} />
          <span>{badge.label}</span>
          <strong aria-label={`${String(badge.count)} current associations`}>
            {String(badge.count)}
          </strong>
        </li>
      ))}
    </ul>
  );
}

function NodeHelp({ data }: { readonly data: ArchitectureFlowNode["data"] }) {
  const store = useEditorSessionStoreApi();
  const shell = useWorkspaceShellController();
  if (data.education === null) return null;
  return (
    <Button
      className="architecture-node-help__popover nodrag nopan"
      size="compact"
      variant="quiet"
      aria-label={`Explain ${data.label}`}
      onClick={() => {
        store
          .getState()
          .setSelection({ kind: "node", id: data.architectureNodeId });
        shell?.openContextPanel("selected-resource-inspector", "learn");
      }}
    >
      <Info aria-hidden="true" size={15} />
    </Button>
  );
}

function NodeHeader({
  data,
  icon,
  compact = false,
}: {
  readonly data: ArchitectureFlowNode["data"];
  readonly icon: ReactNode;
  readonly compact?: boolean;
}) {
  return (
    <header className="architecture-node__header">
      {icon}
      <span className="architecture-node__title">
        <strong>{data.label}</strong>
        {compact ? null : <span>{data.serviceName}</span>}
      </span>
      {compact ? null : <NodeHelp data={data} />}
    </header>
  );
}

function NodeIcon({ data }: { readonly data: ArchitectureFlowNode["data"] }) {
  const { iconRegistry } = useEditorDocumentSession();

  if (data.iconId === null) {
    return (
      <ServiceIconContainer
        label={data.serviceName}
        size="medium"
        status="missing"
      >
        <NeutralProviderIcon decorative />
      </ServiceIconContainer>
    );
  }

  return (
    <CatalogServiceIcon
      iconId={data.iconId}
      registry={iconRegistry}
      serviceName={data.serviceName}
    />
  );
}

function CompactFindingMarker() {
  return (
    <span
      aria-label="Finding target"
      className="architecture-node__compact-finding"
      role="img"
    >
      <AlertTriangle aria-hidden="true" size={14} />
    </span>
  );
}

function serviceDetailsId(nodeId: string): string {
  return `architecture-service-details-${nodeId}`;
}

function ServiceCollapseControl({
  collapsed,
  detailsId,
  nodeId,
  nodeLabel,
}: {
  readonly collapsed: boolean;
  readonly detailsId: string;
  readonly nodeId: string;
  readonly nodeLabel: string;
}) {
  const store = useEditorSessionStoreApi();
  const zoom = useStore((state) => state.transform[2]);
  const safeZoom = Math.max(zoom, Number.EPSILON);
  const viewportStyle = {
    "--architecture-service-toggle-inverse-zoom": String(
      Math.max(1, 1 / safeZoom),
    ),
    "--architecture-service-toggle-min-target-size": `${String(32 / safeZoom)}px`,
    "--architecture-service-toggle-coarse-target-size": `${String(45 / safeZoom)}px`,
  } as CSSProperties;

  const action = collapsed ? "Expand" : "Collapse";
  return (
    <Button
      aria-controls={detailsId}
      aria-expanded={!collapsed}
      aria-label={`${action} ${nodeLabel}`}
      className="architecture-service-toggle nodrag nokey nopan"
      onClick={(event) => {
        event.stopPropagation();
        store.getState().setActiveConnectionDock(null);
        store.getState().setServiceNodeExpanded(nodeId, collapsed);
        store.getState().setSelection({ id: nodeId, kind: "node" });
        store
          .getState()
          .announce(
            `${nodeLabel} ${collapsed ? "expanded" : "collapsed"}. Architecture semantics did not change.`,
          );
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      size="compact"
      style={viewportStyle}
      title={`${action} ${nodeLabel}`}
      variant="quiet"
    >
      <span aria-hidden="true" className="architecture-service-toggle__visual">
        {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </span>
    </Button>
  );
}

function CollapsedConnectionDock({
  aggregateOnly = false,
  direction,
  faces,
  nodeId,
  nodeLabel,
  ownerRef,
  side,
  style,
}: {
  readonly aggregateOnly?: boolean;
  readonly direction: ConnectionDockDirection;
  readonly faces: readonly ConnectionDockFace[];
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly ownerRef: RefObject<HTMLElement | null>;
  readonly side: ConnectionDockFace["side"];
  readonly style: CSSProperties;
}) {
  const session = useEditorDocumentSession();
  const shell = useWorkspaceShellController();
  const store = useEditorSessionStoreApi();
  const aggregateGroupId = collapsedConnectionDockGroupId(direction, side);
  const open = useEditorSessionState(
    (state) =>
      state.activeConnectionDock?.nodeId === nodeId &&
      state.activeConnectionDock.groupId === aggregateGroupId &&
      state.activeConnectionDock.direction === direction,
  );
  const portIds = [...new Set(faces.flatMap((face) => face.portIds))];
  const document = session.status === "ready" ? session.document : null;
  const documentIndex = useEditorDocumentIndex();
  const currentEdges =
    document === null
      ? []
      : (documentIndex?.incidentEdges.get(nodeId) ?? []).filter((edge) => {
          const endpoint =
            direction === "input" ? edge.semantic.target : edge.semantic.source;
          return endpoint.nodeId === nodeId && portIds.includes(endpoint.port);
        });
  const actionable = faces.some((face) =>
    face.group.ports.some(
      (port) => port.direction === direction && port.actionable,
    ),
  );
  const isValidationTarget = useEditorSessionState((state) =>
    portIds.some(
      (portId) =>
        state.validationFocus !== null &&
        validationLocationMatchesPort(
          state.validationFocus.location,
          nodeId,
          portId,
        ),
    ),
  );
  const directionLabel = direction === "input" ? "Inputs" : "Outputs";
  const groupLabels = faces.map((face) => face.group.label);

  return (
    <span
      className="architecture-connection-dock architecture-connection-dock--aggregate nodrag nopan"
      data-actionable={actionable ? "true" : "false"}
      data-direction={direction}
      data-side={side}
      data-validation-highlight={isValidationTarget ? "true" : "false"}
      style={style}
    >
      {/* Left/right rails use node-adjacent placement; top/bottom use the shared trigger fallback. */}
      <ConnectionDragSurface
        direction={direction}
        groupId={aggregateGroupId}
        side={side}
      >
        <Popover
          {...(side === "left" || side === "right"
            ? { adjacentPositioning: { ownerRef, preferredPlacement: side } }
            : {})}
          className="architecture-connection-dock__popover"
          label={`${directionLabel} for ${nodeLabel}`}
          onOpenChange={(nextOpen) => {
            if (nextOpen) {
              store.getState().setActiveConnectionDock({
                direction,
                groupId: aggregateGroupId,
                nodeId,
              });
            } else if (
              store.getState().activeConnectionDock?.groupId ===
              aggregateGroupId
            ) {
              store.getState().setActiveConnectionDock(null);
            }
          }}
          open={open}
          renderContent={(content) => {
            const ownerDocument = ownerRef.current?.ownerDocument;
            return ownerDocument === undefined
              ? content
              : createPortal(content, ownerDocument.body);
          }}
          trigger={
            <span className="architecture-connection-dock__trigger-content">
              <span
                aria-hidden="true"
                className="architecture-connection-dock__dot"
                data-status={actionable ? "available" : "information-only"}
              />
              {isValidationTarget ? (
                <span
                  aria-hidden="true"
                  className="architecture-connection-dock__validation-marker"
                  data-status="finding-target"
                >
                  <AlertTriangle size={13} />
                </span>
              ) : null}
              {currentEdges.length === 0 ? null : (
                <span
                  aria-hidden="true"
                  className="architecture-connection-dock__count"
                >
                  {String(currentEdges.length)}
                </span>
              )}
            </span>
          }
          triggerLabel={`Open ${directionLabel.toLowerCase()} for ${nodeLabel}; ${groupLabels.join(", ")}; ${String(currentEdges.length)} current ${
            currentEdges.length === 1 ? "connection" : "connections"
          }${isValidationTarget ? "; finding target" : ""}`}
          triggerTooltip={{
            content: `${directionLabel}: ${groupLabels.join(", ")}`,
            placement: side,
          }}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- This boundary prevents canvas gestures from observing popup actions. */}
          <section
            className="architecture-connection-menu architecture-connection-menu--aggregate"
            onClick={(event) => {
              event.stopPropagation();
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
          >
            <header>
              <h3>{directionLabel}</h3>
              <p>
                The fixed {side} boundary rail keeps every exact connection
                stable.{" "}
                {aggregateOnly
                  ? "Open the Connect inspector to inspect individual relationships."
                  : "Expand the service to inspect an individual named dock."}
              </p>
            </header>
            <ul className="architecture-connection-menu__list">
              {faces.map((face) => {
                const count = currentEdges.filter((edge) => {
                  const endpoint =
                    direction === "input"
                      ? edge.semantic.target
                      : edge.semantic.source;
                  return face.portIds.includes(endpoint.port);
                }).length;
                return (
                  <li key={`${face.group.id}:${direction}`}>
                    <span>
                      <strong>{face.group.label}</strong>
                      <span>{face.group.description}</span>
                      <span>
                        {String(count)} current{" "}
                        {count === 1 ? "connection" : "connections"}
                      </span>
                    </span>
                    <Button
                      aria-label={`Open ${face.group.label} ${direction} details for ${nodeLabel}`}
                      onClick={() => {
                        if (count === 0) {
                          store.getState().setActiveConnectionDock(null);
                          session.beginConnection({ kind: "node", nodeId });
                          return;
                        }
                        if (aggregateOnly) {
                          store.getState().setActiveConnectionDock(null);
                          store
                            .getState()
                            .setSelection({ id: nodeId, kind: "node" });
                          shell?.openContextPanel(
                            "selected-resource-inspector",
                            "connect",
                          );
                          return;
                        }
                        store.getState().setServiceNodeExpanded(nodeId, true);
                        store.getState().setActiveConnectionDock({
                          direction,
                          groupId: face.group.id,
                          nodeId,
                        });
                        window.setTimeout(() => {
                          const expandedOwner = ownerRef.current;
                          if (expandedOwner === null) {
                            return;
                          }
                          const targetDock = [
                            ...expandedOwner.querySelectorAll<HTMLElement>(
                              ".architecture-connection-dock[data-connection-group-id]",
                            ),
                          ].find(
                            (dock) =>
                              dock.dataset["connectionGroupId"] ===
                                face.group.id &&
                              dock.dataset["direction"] === direction,
                          );
                          targetDock
                            ?.querySelector<HTMLButtonElement>(
                              ".cm-popover__trigger",
                            )
                            ?.focus();
                        }, 0);
                      }}
                      size="compact"
                      variant="secondary"
                    >
                      {count === 0 ? "Add connection" : "Open details"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        </Popover>
      </ConnectionDragSurface>
    </span>
  );
}

/**
 * React Flow handles live on one invariant rail. Disclosure may replace the
 * compact aggregate controls with named controls, but it never remounts an
 * exact edge anchor at a different coordinate.
 */
function StableConnectionAnchors({
  compact = false,
  faces,
}: {
  readonly compact?: boolean;
  readonly faces: readonly ConnectionDockFace[];
}) {
  const buckets = connectionDockBuckets(faces);
  return (
    <>
      {CONNECTION_DOCK_SIDES.flatMap((side) => {
        const sideFaces = faces.filter((face) => face.side === side);
        const sideBuckets = buckets.filter((bucket) => bucket.side === side);
        return sideFaces.map((face, index) => {
          const handleId = `dock:${face.group.id}:${face.direction}`;
          const bucketIndex = sideBuckets.findIndex(
            (bucket) => bucket.direction === face.direction,
          );
          return (
            <span
              aria-hidden="true"
              className="architecture-connection-anchor"
              data-connection-anchor-id={handleId}
              data-connection-anchor-layout={compact ? "aggregate" : "exact"}
              data-direction={face.direction}
              data-side={side}
              key={handleId}
              style={
                compact
                  ? connectionDockPosition(
                      bucketIndex,
                      sideBuckets.length,
                      side,
                    )
                  : connectionDockPosition(index, sideFaces.length, side)
              }
            >
              <Handle
                className="architecture-connection-dock__edge-anchor"
                id={handleId}
                isConnectable
                isConnectableStart={false}
                isConnectableEnd
                position={connectionDockHandlePosition(side)}
                tabIndex={-1}
                type={face.direction === "input" ? "target" : "source"}
              />
            </span>
          );
        });
      })}
    </>
  );
}

function ConnectionDocks({
  aggregateOnly = false,
  collapsed = false,
  data,
  nodeId,
  ownerRef,
}: {
  readonly aggregateOnly?: boolean;
  readonly collapsed?: boolean;
  readonly data: ArchitectureFlowNode["data"];
  readonly nodeId: string;
  readonly ownerRef: RefObject<HTMLElement | null>;
}) {
  const faces = connectionDockFaces(data.connectionGroups);
  const buckets = connectionDockBuckets(faces);
  const zoom = useStore((state) => state.transform[2]);
  const safeZoom = Math.max(zoom, Number.EPSILON);
  const viewportStyle = {
    "--architecture-connection-dock-inverse-zoom": String(
      Math.max(1, 1 / safeZoom),
    ),
    "--architecture-connection-dock-min-target-size": `${String(24 / safeZoom)}px`,
    "--architecture-connection-dock-coarse-target-size": `${String(44 / safeZoom)}px`,
  } as CSSProperties;
  if (faces.length === 0) {
    return null;
  }

  if (collapsed || aggregateOnly) {
    return (
      <div
        aria-label="Compact connection docks"
        className="architecture-connection-docks architecture-connection-docks--compact"
        role="group"
        style={viewportStyle}
      >
        <StableConnectionAnchors compact faces={faces} />
        {CONNECTION_DOCK_SIDES.flatMap((side) => {
          const sideBuckets = buckets.filter((bucket) => bucket.side === side);
          return sideBuckets.map((bucket, index) => (
            <CollapsedConnectionDock
              aggregateOnly={aggregateOnly}
              direction={bucket.direction}
              faces={bucket.faces}
              key={`${side}:${bucket.direction}`}
              nodeId={nodeId}
              nodeLabel={data.label}
              ownerRef={ownerRef}
              side={side}
              style={connectionDockPosition(index, sideBuckets.length, side)}
            />
          ));
        })}
      </div>
    );
  }

  return (
    <div
      aria-label="Connection docks"
      className="architecture-connection-docks"
      role="group"
      style={viewportStyle}
    >
      <StableConnectionAnchors faces={faces} />
      {CONNECTION_DOCK_SIDES.flatMap((side) => {
        const sideFaces = faces.filter((face) => face.side === side);
        return sideFaces.map((face, index) => (
          <ConnectionDock
            direction={face.direction}
            group={face.group}
            key={`${face.group.id}:${face.direction}`}
            nodeId={nodeId}
            nodeLabel={data.label}
            ownerRef={ownerRef}
            portIds={face.portIds}
            side={side}
            style={connectionDockPosition(index, sideFaces.length, side)}
          />
        ));
      })}
    </div>
  );
}

function ExpandedConnectionControls({
  data,
  nodeId,
  ownerRef,
}: {
  readonly data: ArchitectureFlowNode["data"];
  readonly nodeId: string;
  readonly ownerRef: RefObject<HTMLElement | null>;
}) {
  const session = useEditorDocumentSession();
  const faces = connectionDockFaces(data.connectionGroups).filter(
    (face) =>
      session.status === "ready" &&
      session.document.edges.some((edge) => {
        const endpoint =
          face.direction === "input"
            ? edge.semantic.target
            : edge.semantic.source;
        return (
          endpoint.nodeId === nodeId && face.portIds.includes(endpoint.port)
        );
      }),
  );
  return (
    <section
      aria-label={`Exact connection points for ${data.label}`}
      className="architecture-service-details__connections"
    >
      <div className="selected-inspector__actions">
        <h4>Active connections</h4>
        <Button
          className="architecture-service-details__add-connection"
          size="compact"
          variant="secondary"
          onClick={() => session.beginConnection({ kind: "node", nodeId })}
        >
          <Link2 aria-hidden="true" size={14} /> Add connection
        </Button>
      </div>
      {faces.length === 0 ? <p>No connections yet.</p> : null}
      <div className="architecture-service-details__connection-grid">
        {faces.map((face) => (
          <ConnectionDock
            direction={face.direction}
            group={face.group}
            key={`${face.group.id}:${face.direction}`}
            layout="details"
            nodeId={nodeId}
            nodeLabel={data.label}
            ownerRef={ownerRef}
            portIds={face.portIds}
            side={face.side}
          />
        ))}
      </div>
    </section>
  );
}

interface FloatingServicePlacement {
  readonly side: Position.Left | Position.Right;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function ServicePanelPositioner({
  children,
  ownerRef,
  panelRef,
  placement,
  safeArea,
  setPlacement,
}: {
  readonly children: ReactNode;
  readonly ownerRef: RefObject<HTMLElement | null>;
  readonly panelRef: RefObject<HTMLElement | null>;
  readonly placement: FloatingServicePlacement;
  readonly safeArea:
    | { readonly bottom: number; readonly left: number; readonly right: number }
    | undefined;
  readonly setPlacement: (next: FloatingServicePlacement) => void;
}) {
  const viewportTransform = useStore((state) => state.transform);
  useLayoutEffect(() => {
    const node = ownerRef.current;
    const panel = panelRef.current;
    const flow = node?.closest<HTMLElement>(".architecture-canvas__flow");
    if (node == null || panel === null || flow == null) return;
    const workspace = flow.closest<HTMLElement>(".architecture-workspace");
    const measure = () => {
      const styles = workspace === null ? null : getComputedStyle(workspace);
      const inset = (name: string) =>
        Number.parseFloat(styles?.getPropertyValue(name) ?? "") || 12;
      const bounds = flow.getBoundingClientRect();
      const nodeBounds = node.getBoundingClientRect();
      const left = bounds.left + inset("--architecture-safe-left");
      const right = bounds.right - inset("--architecture-safe-right");
      const top = bounds.top + inset("--architecture-safe-top");
      const bottom = bounds.bottom - inset("--architecture-safe-bottom");
      const spaceRight = right - nodeBounds.right;
      const spaceLeft = nodeBounds.left - left;
      const side = spaceRight >= spaceLeft ? Position.Right : Position.Left;
      const sideSpace = side === Position.Right ? spaceRight : spaceLeft;
      const width = Math.max(160, Math.min(360, sideSpace - 12, right - left));
      const height = Math.max(160, bottom - top);
      if (
        side !== placement.side ||
        width !== placement.width ||
        height !== placement.height
      ) {
        setPlacement({ side, x: 0, y: 0, width, height });
        return;
      }
      // Move only the floating panel when an edge or shell overlay would clip it.
      const box = panel.getBoundingClientRect();
      // Derive the natural toolbar anchor from the node, not the already
      // translated panel. Measuring the latter feeds our last offset back into
      // the next layout pass and can oscillate at narrower canvas widths.
      const originX =
        side === Position.Right
          ? nodeBounds.right + 12
          : nodeBounds.left - box.width - 12;
      const originY = nodeBounds.top;
      const x = Math.round(
        Math.min(Math.max(originX, left), right - box.width) - originX,
      );
      const y = Math.round(
        Math.min(Math.max(originY, top), bottom - box.height) - originY,
      );
      if (x !== placement.x || y !== placement.y) {
        setPlacement({ ...placement, x, y });
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(flow);
    observer.observe(panel);
    const topStack = workspace?.querySelector<HTMLElement>(
      ".architecture-top-stack",
    );
    if (topStack !== undefined && topStack !== null) observer.observe(topStack);
    return () => {
      observer.disconnect();
    };
  }, [
    ownerRef,
    panelRef,
    placement,
    safeArea?.bottom,
    safeArea?.left,
    safeArea?.right,
    setPlacement,
    viewportTransform,
  ]);
  return <>{children}</>;
}

function ExpandedServiceDetails({
  data,
  hidden,
  isValidationTarget,
  nodeId,
  ownerRef,
  supportDetail,
}: {
  readonly data: ArchitectureFlowNode["data"];
  readonly hidden: boolean;
  readonly isValidationTarget: boolean;
  readonly nodeId: string;
  readonly ownerRef: RefObject<HTMLElement | null>;
  readonly supportDetail?: string;
}) {
  const shell = useWorkspaceShellController();
  const store = useEditorSessionStoreApi();
  const panelRef = useRef<HTMLElement>(null);
  const [placement, setPlacement] = useState<FloatingServicePlacement>({
    side: Position.Right,
    x: 0,
    y: 0,
    width: 360,
    height: 560,
  });
  useEffect(() => {
    if (hidden) return;
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        !panelRef.current?.contains(document.activeElement)
      )
        return;
      store.getState().setServiceNodeExpanded(nodeId, false);
      ownerRef.current
        ?.querySelector<HTMLElement>(".architecture-service-toggle")
        ?.focus();
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("keydown", onEscape);
    };
  }, [hidden, nodeId, ownerRef, store]);
  const detailsId = serviceDetailsId(nodeId);
  const titleId = `${detailsId}-title`;
  if (hidden) return <section aria-hidden="true" hidden id={detailsId} />;
  return (
    <NodeToolbar
      align="start"
      className="architecture-service-floating-toolbar"
      isVisible
      nodeId={nodeId}
      offset={12}
      position={placement.side}
      style={{ pointerEvents: "all" }}
    >
      <ServicePanelPositioner
        ownerRef={ownerRef}
        panelRef={panelRef}
        placement={placement}
        safeArea={shell?.overlays.safeArea}
        setPlacement={setPlacement}
      >
        <section
          aria-label={data.label}
          className="architecture-service-details nodrag nopan"
          data-architecture-service-details-for={nodeId}
          id={detailsId}
          ref={panelRef}
          role="dialog"
          style={
            {
              "--service-panel-offset-x": `${String(placement.x)}px`,
              "--service-panel-offset-y": `${String(placement.y)}px`,
              "--service-panel-width": `${String(placement.width)}px`,
              "--service-panel-height": `${String(placement.height)}px`,
            } as CSSProperties
          }
          tabIndex={-1}
        >
          <header className="architecture-service-details__header">
            <span>
              <h3 id={titleId}>Settings and connections</h3>
              <span>{data.serviceName}</span>
            </span>
            <Button
              className="architecture-service-details__configure"
              size="compact"
              variant="secondary"
              onClick={() => {
                store.getState().setSelection({ id: nodeId, kind: "node" });
                shell?.openContextPanel(
                  "selected-resource-inspector",
                  "configure",
                );
              }}
            >
              Configure
            </Button>
            <NodeHelp data={data} />
          </header>
          {isValidationTarget ? (
            <StatusBadge label="Finding target" tone="warning" />
          ) : null}
          {data.support.kind === "available" ? null : (
            <p className="architecture-service-details__support-notice">
              <AlertTriangle aria-hidden="true" size={15} />
              <strong>{data.support.label}</strong>
            </p>
          )}
          <PresentationFacts data={data} />
          <AssociationBadges data={data} />
          <p className="architecture-node__explanation">
            {supportDetail === undefined ? (
              data.description
            ) : (
              <>
                <AlertTriangle aria-hidden="true" size={16} /> {supportDetail}
              </>
            )}
          </p>
          <ExpandedConnectionControls
            data={data}
            nodeId={nodeId}
            ownerRef={ownerRef}
          />
        </section>
      </ServicePanelPositioner>
    </NodeToolbar>
  );
}

function ConnectionToolbar({
  data,
  nodeId,
  selected,
}: {
  readonly data: ArchitectureFlowNode["data"];
  readonly nodeId: string;
  readonly selected: boolean;
}) {
  const session = useEditorDocumentSession();
  if (!selected || !data.ports.some((port) => port.actionable)) {
    return null;
  }
  return (
    <NodeToolbar isVisible position={Position.Top}>
      <Button
        className="nodrag nopan"
        onClick={() => {
          session.beginConnection({ kind: "node", nodeId });
        }}
        size="compact"
        variant="secondary"
      >
        <Link2 aria-hidden="true" size={15} /> Connect {data.label}
      </Button>
    </NodeToolbar>
  );
}

function BoundaryCollapseControl({
  childCount,
  nodeId,
}: {
  readonly childCount: number;
  readonly nodeId: string;
}) {
  const store = useEditorSessionStoreApi();
  const collapsed = useEditorSessionState((state) =>
    state.collapsedBoundaryIds.has(nodeId),
  );
  const { mode } = useModePreference();

  if (childCount === 0) {
    return null;
  }

  return (
    <Button
      aria-expanded={!collapsed}
      className="architecture-boundary-toggle nodrag nokey nopan"
      onClick={(event) => {
        event.stopPropagation();
        store.getState().setActiveConnectionDock(null);
        store.getState().setBoundaryCollapsed(nodeId, !collapsed);
        store.getState().setSelection({ id: nodeId, kind: "node" });
        store
          .getState()
          .announce(
            collapsed
              ? "Boundary contents expanded."
              : "Boundary contents collapsed. Architecture semantics did not change.",
          );
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      size="compact"
      variant="quiet"
    >
      {collapsed ? (
        <ChevronRight aria-hidden="true" size={15} />
      ) : (
        <ChevronDown aria-hidden="true" size={15} />
      )}
      {mode === "guided"
        ? collapsed
          ? "Show contents"
          : "Hide contents"
        : collapsed
          ? "Expand"
          : "Collapse"}
    </Button>
  );
}

function useCompactTile(nodeId: string, collapsed: boolean) {
  const zoom = useStore((state) => state.transform[2]);
  const updateNodeInternals = useUpdateNodeInternals();
  const tile = compactServiceTile(zoom);
  const compact = collapsed && tile.compact;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      updateNodeInternals(nodeId);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [compact, nodeId, updateNodeInternals, zoom]);
  return {
    compact,
    iconOnly: tile.iconOnly,
    style: {
      "--service-tile-scale": String(tile.scale),
      "--service-tile-width": String(tile.width) + "px",
      "--service-tile-height": String(tile.height) + "px",
    } as CSSProperties,
  };
}

export const ResourceNode = memo(function ResourceNode({
  data,
  id,
  selected,
}: NodeProps<ArchitectureFlowNode>) {
  const isValidationTarget = useEditorSessionState(
    (state) =>
      state.validationFocus !== null &&
      validationLocationNodeId(state.validationFocus.location) === id,
  );
  const collapsed = useEditorSessionState(
    (state) => !state.expandedServiceNodeIds.has(id),
  );
  const tile = useCompactTile(id, collapsed);
  const ownerRef = useRef<HTMLElement>(null);
  return (
    <article
      className="architecture-node architecture-node--resource architecture-node--service"
      data-architecture-node-id={data.architectureNodeId}
      data-network-association-count={data.associationBadges.length}
      ref={ownerRef}
      data-selected={selected ? "true" : "false"}
      data-support={data.support.kind}
      data-validation-highlight={isValidationTarget ? "true" : "false"}
      data-collapsed={collapsed ? "true" : "false"}
      data-overview-tile={tile.compact ? "true" : "false"}
      data-icon-only={tile.iconOnly ? "true" : "false"}
      style={tile.style}
      title={data.label + " · " + data.serviceName}
    >
      {collapsed ? null : (
        <ConnectionToolbar data={data} nodeId={id} selected={selected} />
      )}
      {isValidationTarget ? <CompactFindingMarker /> : null}
      <NodeHeader compact data={data} icon={<NodeIcon data={data} />} />
      <ConnectionDocks collapsed data={data} nodeId={id} ownerRef={ownerRef} />
      <ExpandedServiceDetails
        data={data}
        hidden={collapsed}
        isValidationTarget={isValidationTarget}
        nodeId={id}
        ownerRef={ownerRef}
      />
      <ServiceCollapseControl
        collapsed={collapsed}
        detailsId={serviceDetailsId(id)}
        nodeId={id}
        nodeLabel={data.label}
      />
    </article>
  );
});

export const BoundaryNode = memo(function BoundaryNode({
  data,
  id,
  selected,
}: NodeProps<ArchitectureFlowNode>) {
  const manuallyCollapsed = useEditorSessionState((state) =>
    state.collapsedBoundaryIds.has(id),
  );
  const zoom = useStore((state) => state.transform[2]);
  const overview = boundaryOverviewAtZoom(data.boundaryLevel, zoom);
  const tile = boundaryOverviewTile(zoom);
  const collapsed = manuallyCollapsed || overview;
  const isValidationTarget = useEditorSessionState(
    (state) =>
      state.validationFocus !== null &&
      validationLocationNodeId(state.validationFocus.location) === id,
  );
  const ownerRef = useRef<HTMLElement>(null);
  return (
    <article
      className="architecture-node architecture-node--boundary"
      data-boundary-level={data.boundaryLevel ?? "unknown"}
      data-network-association-count={data.associationBadges.length}
      data-architecture-node-id={data.architectureNodeId}
      ref={ownerRef}
      data-selected={selected ? "true" : "false"}
      data-collapsed={collapsed ? "true" : "false"}
      data-overview-tile={overview ? "true" : "false"}
      data-icon-only={overview && tile.iconOnly ? "true" : "false"}
      data-condensed-heading={zoom < 0.7 ? "true" : "false"}
      title={data.label}
      style={
        {
          "--boundary-overview-scale": String(tile.scale),
          "--boundary-readable-scale": String(
            Math.min(3, Math.max(1, 1 / Math.max(zoom, Number.EPSILON))),
          ),
          "--boundary-heading-scale": String(
            Math.min(2, Math.max(1, 1 / Math.max(zoom, Number.EPSILON))),
          ),
        } as CSSProperties
      }
      data-support={data.support.kind}
      data-validation-highlight={isValidationTarget ? "true" : "false"}
    >
      <ConnectionToolbar
        data={data}
        nodeId={id}
        selected={selected && !overview}
      />
      {isValidationTarget ? (
        <StatusBadge label="Finding target" tone="warning" />
      ) : null}
      <div className="architecture-boundary-heading">
        <NodeHeader
          compact={overview}
          data={data}
          icon={<NodeIcon data={data} />}
        />
        <PresentationFacts data={data} />
        <div className="architecture-boundary-heading__contents">
          <span>
            Contains {data.childNodeIds.length}{" "}
            {data.childNodeIds.length === 1 ? "item" : "items"}
          </span>
          {overview ? null : (
            <BoundaryCollapseControl
              childCount={data.childNodeIds.length}
              nodeId={id}
            />
          )}
        </div>
      </div>
      <ConnectionDocks
        aggregateOnly
        data={data}
        nodeId={id}
        ownerRef={ownerRef}
      />
    </article>
  );
});

export const FallbackNode = memo(function FallbackNode({
  data,
  id,
  selected,
}: NodeProps<ArchitectureFlowNode>) {
  const isValidationTarget = useEditorSessionState(
    (state) =>
      state.validationFocus !== null &&
      validationLocationNodeId(state.validationFocus.location) === id,
  );
  const collapsed = useEditorSessionState(
    (state) => !state.expandedServiceNodeIds.has(id),
  );
  const tile = useCompactTile(id, collapsed);
  const ownerRef = useRef<HTMLElement>(null);

  return (
    <article
      className="architecture-node architecture-node--fallback architecture-node--service"
      data-architecture-node-id={data.architectureNodeId}
      ref={ownerRef}
      data-selected={selected ? "true" : "false"}
      data-support={data.support.kind}
      data-validation-highlight={isValidationTarget ? "true" : "false"}
      data-collapsed={collapsed ? "true" : "false"}
      data-overview-tile={tile.compact ? "true" : "false"}
      data-icon-only={tile.iconOnly ? "true" : "false"}
      style={tile.style}
      title={data.label + " · " + data.serviceName}
    >
      {collapsed ? null : (
        <ConnectionToolbar data={data} nodeId={id} selected={selected} />
      )}
      {isValidationTarget ? <CompactFindingMarker /> : null}
      <NodeHeader compact data={data} icon={<NodeIcon data={data} />} />
      <ConnectionDocks collapsed data={data} nodeId={id} ownerRef={ownerRef} />
      <ExpandedServiceDetails
        data={data}
        hidden={collapsed}
        isValidationTarget={isValidationTarget}
        nodeId={id}
        ownerRef={ownerRef}
        supportDetail={data.support.detail}
      />
      <ServiceCollapseControl
        collapsed={collapsed}
        detailsId={serviceDetailsId(id)}
        nodeId={id}
        nodeLabel={data.label}
      />
    </article>
  );
});
