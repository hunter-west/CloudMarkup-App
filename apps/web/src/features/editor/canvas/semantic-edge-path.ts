import { getSmoothStepPath, Position } from "@xyflow/react";

function fanoutOffset(rank: number, count: number): number {
  return (rank - (count - 1) / 2) * 10;
}

function outwardPoint(
  x: number,
  y: number,
  position: Position,
  distance: number,
): { readonly x: number; readonly y: number } {
  switch (position) {
    case Position.Left:
      return { x: x - distance, y };
    case Position.Right:
      return { x: x + distance, y };
    case Position.Top:
      return { x, y: y - distance };
    case Position.Bottom:
      return { x, y: y + distance };
    default:
      throw new TypeError("Unsupported React Flow handle position.");
  }
}

function branchPoint(
  x: number,
  y: number,
  position: Position,
  rank: number,
  count: number,
): { readonly x: number; readonly y: number } {
  const outward = outwardPoint(x, y, position, 24);
  const offset = fanoutOffset(rank, count);
  return position === Position.Top || position === Position.Bottom
    ? { x: outward.x + offset, y: outward.y }
    : { x: outward.x, y: outward.y + offset };
}

export interface SemanticEdgeFanoutPathInput {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourcePosition: Position;
  readonly sourceRank: number;
  readonly sourceCount: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetPosition: Position;
  readonly targetRank: number;
  readonly targetCount: number;
}

/** Keeps every shared-dock path on one exact anchor before branching. */
export function createSemanticEdgeFanoutPath({
  sourceX,
  sourceY,
  sourcePosition,
  sourceRank,
  sourceCount,
  targetX,
  targetY,
  targetPosition,
  targetRank,
  targetCount,
}: SemanticEdgeFanoutPathInput): readonly [string, number, number] {
  const sourceLead = outwardPoint(sourceX, sourceY, sourcePosition, 12);
  const sourceBranch = branchPoint(
    sourceX,
    sourceY,
    sourcePosition,
    sourceRank,
    sourceCount,
  );
  const targetLead = outwardPoint(targetX, targetY, targetPosition, 12);
  const targetBranch = branchPoint(
    targetX,
    targetY,
    targetPosition,
    targetRank,
    targetCount,
  );
  const [centralPath, labelX, labelY] = getSmoothStepPath({
    sourceX: sourceBranch.x,
    sourceY: sourceBranch.y,
    sourcePosition,
    targetX: targetBranch.x,
    targetY: targetBranch.y,
    targetPosition,
    borderRadius: 12,
  });
  const continuationIndex = centralPath.search(/[LCQ]/u);
  const centralContinuation =
    continuationIndex < 0 ? "" : centralPath.slice(continuationIndex);
  return [
    [
      `M${String(sourceX)} ${String(sourceY)}`,
      `L${String(sourceLead.x)} ${String(sourceLead.y)}`,
      `L${String(sourceBranch.x)} ${String(sourceBranch.y)}`,
      centralContinuation,
      `L${String(targetLead.x)} ${String(targetLead.y)}`,
      `L${String(targetX)} ${String(targetY)}`,
    ]
      .filter((segment) => segment.length > 0)
      .join(" "),
    labelX,
    labelY,
  ];
}
