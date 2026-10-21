import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { ArchitectureFlowEdge } from "../model/index.js";
import { useEditorSessionState } from "../session/editor-session-hooks.js";
import { validationLocationEdgeId } from "../validation/validation-navigation.js";
import { createSemanticEdgeFanoutPath } from "./semantic-edge-path.js";
import { connectionDockHighlightsEdge } from "./connection-dock-presentation.js";
import { semanticEdgePresentation } from "./semantic-edge-presentation.js";
export const SemanticEdge = memo(function SemanticEdge({
  data,
  markerEnd,
  selected,
  source,
  sourceX,
  sourceY,
  sourcePosition,
  target,
  targetX,
  targetY,
  targetPosition,
}: EdgeProps<ArchitectureFlowEdge>) {
  const { isValidationTarget, isDockTarget, ...presentation } =
    useEditorSessionState(
      useShallow((state) => {
        const validationEdgeId =
          state.validationFocus === null
            ? null
            : validationLocationEdgeId(state.validationFocus.location);
        const isDockTarget = connectionDockHighlightsEdge(
          state.activeConnectionDock,
          data,
          source,
          target,
        );
        return {
          isValidationTarget: data?.architectureEdgeId === validationEdgeId,
          isDockTarget,
          ...semanticEdgePresentation({
            edgeId: data?.architectureEdgeId ?? "",
            sourceNodeId: source,
            targetNodeId: target,
            visualRole: data?.visualRole ?? "relationship",
            hoveredElement: state.hoveredElement,
            selectedElement: state.selection,
            validationEdgeId,
            dockHighlighted: isDockTarget,
          }),
        };
      }),
    );
  const [edgePath, labelX, labelY] = createSemanticEdgeFanoutPath({
    sourceX,
    sourceY,
    sourcePosition,
    sourceRank: data?.sourceDockRank ?? 0,
    sourceCount: data?.sourceDockCount ?? 1,
    targetX,
    targetY,
    targetPosition,
    targetRank: data?.targetDockRank ?? 0,
    targetCount: data?.targetDockCount ?? 1,
  });

  return (
    <>
      <BaseEdge
        {...(markerEnd === undefined || !presentation.showMarker
          ? {}
          : { markerEnd })}
        className={`architecture-edge__path architecture-edge__path--${
          data?.visualRole ?? "relationship"
        }${
          isValidationTarget
            ? " architecture-edge__path--validation-target"
            : ""
        }${isDockTarget ? " architecture-edge__path--dock-target" : ""}${
          presentation.emphasizePath
            ? " architecture-edge__path--emphasized"
            : ""
        }`}
        data-dock-highlight={isDockTarget ? "true" : "false"}
        data-route-visible={presentation.showPath ? "true" : "false"}
        data-validation-highlight={isValidationTarget ? "true" : "false"}
        data-visual-role={data?.visualRole ?? "relationship"}
        path={edgePath}
        style={{ opacity: presentation.showPath ? undefined : 0 }}
      />
      {data === undefined || !presentation.showLabel ? null : (
        <EdgeLabelRenderer>
          <div
            aria-hidden="true"
            className={`architecture-edge__label architecture-edge__label--${data.visualRole} nodrag nopan`}
            data-architecture-edge-id={data.architectureEdgeId}
            data-generic-fallback={
              data.relationship.kind === "generic" ? "true" : "false"
            }
            data-selected={selected ? "true" : "false"}
            data-dock-highlight={isDockTarget ? "true" : "false"}
            data-validation-highlight={isValidationTarget ? "true" : "false"}
            data-visual-role={data.visualRole}
            style={{
              position: "absolute",
              transform: `translate(-50%, calc(-100% - 8px)) translate(${String(
                labelX,
              )}px, ${String(labelY)}px)`,
            }}
          >
            <strong>{data.label}</strong>
            {/* Exact relationship details remain in Inspector. */}
            {isValidationTarget ? <span>Finding target</span> : null}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
