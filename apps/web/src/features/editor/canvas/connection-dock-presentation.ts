import { Position } from "@xyflow/react";

import type {
  ArchitectureConnectionGroupData,
  EditorConnectionDockSide,
} from "../model/index.js";

export type ConnectionDockDirection = "input" | "output";
export type ConnectionDockSide = EditorConnectionDockSide;

export const CONNECTION_DOCK_SIDES = [
  "left",
  "right",
  "top",
  "bottom",
] as const satisfies readonly ConnectionDockSide[];

export interface ConnectionDockFace {
  readonly direction: ConnectionDockDirection;
  readonly group: ArchitectureConnectionGroupData;
  readonly portIds: readonly string[];
  readonly side: ConnectionDockSide;
}
interface DirectionalDockEdge {
  readonly sourceConnectionGroupId: string;
  readonly sourceDockSide: ConnectionDockSide;
  readonly targetConnectionGroupId: string;
  readonly targetDockSide: ConnectionDockSide;
}

interface DirectionalDockReference {
  readonly direction: ConnectionDockDirection;
  readonly groupId: string;
  readonly nodeId: string;
}

export function connectionDockSide(
  direction: ConnectionDockDirection,
): ConnectionDockSide {
  return direction === "input" ? "left" : "right";
}

export function collapsedConnectionDockGroupId(
  direction: ConnectionDockDirection,
  side: ConnectionDockSide = connectionDockSide(direction),
): string {
  return side === connectionDockSide(direction)
    ? `collapsed:${direction}`
    : `collapsed:${side}:${direction}`;
}

export function connectionDockHandlePosition(
  side: ConnectionDockSide,
): Position {
  switch (side) {
    case "left":
      return Position.Left;
    case "right":
      return Position.Right;
    case "top":
      return Position.Top;
    case "bottom":
      return Position.Bottom;
  }
}

export interface ConnectionDockBucket {
  readonly direction: ConnectionDockDirection;
  readonly faces: readonly ConnectionDockFace[];
  readonly side: ConnectionDockSide;
}

/**
 * Keeps authored group order while aggregating only faces that share both a
 * catalog side and semantic direction.
 */
export function connectionDockBuckets(
  faces: readonly ConnectionDockFace[],
): readonly ConnectionDockBucket[] {
  const buckets: {
    direction: ConnectionDockDirection;
    faces: ConnectionDockFace[];
    side: ConnectionDockSide;
  }[] = [];
  for (const face of faces) {
    const existing = buckets.find(
      (bucket) =>
        bucket.side === face.side && bucket.direction === face.direction,
    );
    if (existing === undefined) {
      buckets.push({
        direction: face.direction,
        faces: [face],
        side: face.side,
      });
      continue;
    }
    existing.faces.push(face);
  }
  return buckets;
}

export function connectionDockPosition(
  index: number,
  count: number,
  side: ConnectionDockSide,
): { readonly left?: string; readonly top?: string } {
  const position = `${String(((index + 1) / (count + 1)) * 100)}%`;
  return side === "left" || side === "right"
    ? { top: position }
    : { left: position };
}

/**
 * Projects catalog groups into directional boundary faces. A mixed group keeps
 * one stable group identity and exact semantic ports while rendering one input
 * face and one output face.
 */
export function connectionDockFaces(
  groups: readonly ArchitectureConnectionGroupData[],
): readonly ConnectionDockFace[] {
  return groups.flatMap((group) =>
    (["input", "output"] as const).flatMap((direction) => {
      const portIds = group.ports
        .filter((port) => port.direction === direction)
        .map((port) => port.id);
      return portIds.length === 0
        ? []
        : [{ direction, group, portIds, side: group.side }];
    }),
  );
}

export function connectionDockHighlightsEdge(
  activeDock: DirectionalDockReference | null,
  edge: DirectionalDockEdge | undefined,
  sourceNodeId: string,
  targetNodeId: string,
): boolean {
  if (activeDock === null || edge === undefined) {
    return false;
  }
  const endpointNodeId =
    activeDock.direction === "output" ? sourceNodeId : targetNodeId;
  const endpointGroupId =
    activeDock.direction === "output"
      ? edge.sourceConnectionGroupId
      : edge.targetConnectionGroupId;
  const endpointSide =
    activeDock.direction === "output"
      ? edge.sourceDockSide
      : edge.targetDockSide;
  return (
    activeDock.nodeId === endpointNodeId &&
    (activeDock.groupId === endpointGroupId ||
      activeDock.groupId ===
        collapsedConnectionDockGroupId(activeDock.direction, endpointSide))
  );
}
