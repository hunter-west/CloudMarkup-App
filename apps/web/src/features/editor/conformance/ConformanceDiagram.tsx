import type {
  ContinuousConformanceDifference,
  ContinuousConformanceLayer,
} from "./model.js";
import { safeConformanceLabel } from "./presentation.js";

import "./continuous-conformance.css";

const WIDTH = 960;
const HEIGHT = 520;
const NODE_WIDTH = 176;
const NODE_HEIGHT = 66;

function project(
  value: number,
  minimum: number,
  maximum: number,
  start: number,
  end: number,
): number {
  if (minimum === maximum) return (start + end) / 2;
  return start + ((value - minimum) / (maximum - minimum)) * (end - start);
}

export function ConformanceDiagram({
  differences,
  layer,
  showDifferences,
}: {
  readonly differences: readonly ContinuousConformanceDifference[];
  readonly layer: ContinuousConformanceLayer;
  readonly showDifferences: boolean;
}) {
  const nodes = layer.diagram.nodes;
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const edges = layer.diagram.edges.filter(
    (edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
  );
  if (nodes.length === 0) {
    return (
      <section className="continuous-conformance__empty-diagram" role="status">
        <h3>No safely mapped diagram inventory</h3>
        <p>
          This state may still contain partial or unmapped Evidence. An empty
          projection is not a claim that the environment contains no resources.
        </p>
      </section>
    );
  }

  const xValues = nodes.map(({ position }) => position.x);
  const yValues = nodes.map(({ position }) => position.y);
  const minimumX = Math.min(...xValues);
  const maximumX = Math.max(...xValues);
  const minimumY = Math.min(...yValues);
  const maximumY = Math.max(...yValues);
  const positions = new Map(
    nodes.map((node) => [
      node.id,
      {
        x: project(
          node.position.x,
          minimumX,
          maximumX,
          72 + NODE_WIDTH / 2,
          WIDTH - 72 - NODE_WIDTH / 2,
        ),
        y: project(
          node.position.y,
          minimumY,
          maximumY,
          64 + NODE_HEIGHT / 2,
          HEIGHT - 64 - NODE_HEIGHT / 2,
        ),
      },
    ]),
  );
  const differenceTargets = new Set(
    differences
      .filter(({ states }) => states.includes(layer.state))
      .flatMap(({ target }) => (target === undefined ? [] : [target.id])),
  );
  const diagramTitleId = `conformance-diagram-${layer.state}-title`;
  const diagramDescriptionId = `conformance-diagram-${layer.state}-description`;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <figure className="continuous-conformance__diagram">
      <svg
        aria-describedby={diagramDescriptionId}
        aria-labelledby={diagramTitleId}
        role="img"
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      >
        <title id={diagramTitleId}>
          {layer.state.replaceAll("-", " ")} safely mapped evidence diagram
        </title>
        <desc id={diagramDescriptionId}>
          {String(nodes.length)} safely mapped resources and{" "}
          {String(edges.length)}
          mapped connections. Presence and comparison status are also listed in
          the text alternative after this diagram.
        </desc>
        <g aria-label="Mapped connections">
          {edges.map((edge) => {
            const source = positions.get(edge.sourceNodeId);
            const target = positions.get(edge.targetNodeId);
            if (source === undefined || target === undefined) return null;
            const highlighted =
              showDifferences &&
              (differenceTargets.has(edge.id) || edge.status !== "matching");
            const label = safeConformanceLabel(edge.label, 72);
            return (
              <g
                aria-label={`${label}, ${edge.presence}, ${edge.status}`}
                data-conformance-presence={edge.presence}
                data-conformance-status={
                  highlighted ? edge.status : "unaccented"
                }
                key={edge.id}
              >
                <line x1={source.x} x2={target.x} y1={source.y} y2={target.y} />
                <text
                  textAnchor="middle"
                  x={(source.x + target.x) / 2}
                  y={(source.y + target.y) / 2 - 7}
                >
                  {label} →
                </text>
              </g>
            );
          })}
        </g>
        <g aria-label="Safely mapped resources">
          {nodes.map((node) => {
            const position = positions.get(node.id);
            if (position === undefined) return null;
            const highlighted =
              showDifferences &&
              (differenceTargets.has(node.id) || node.status !== "matching");
            const label = safeConformanceLabel(node.label, 44);
            const service = safeConformanceLabel(node.serviceLabel, 52);
            return (
              <g
                aria-label={`${label}, ${node.presence}, ${node.status}`}
                data-conformance-presence={node.presence}
                data-conformance-status={
                  highlighted ? node.status : "unaccented"
                }
                key={node.id}
                transform={`translate(${String(position.x - NODE_WIDTH / 2)} ${String(position.y - NODE_HEIGHT / 2)})`}
              >
                <title>{`${label} · ${service} · ${node.presence} · ${node.status}`}</title>
                <rect height={NODE_HEIGHT} rx="10" width={NODE_WIDTH} />
                <text
                  className="continuous-conformance__node-label"
                  x="12"
                  y="27"
                >
                  {label}
                </text>
                <text
                  className="continuous-conformance__service-label"
                  x="12"
                  y="49"
                >
                  {service}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <figcaption>
        Stable mapped identities retain their approved relative positions.
        Comparison-only and unknown elements are labeled and patterned; unmapped
        Evidence is listed separately and never fabricated as inventory.
      </figcaption>
      <details className="continuous-conformance__diagram-alternative">
        <summary>Diagram text alternative</summary>
        <h4>Safely mapped resources</h4>
        <ul aria-label="Safely mapped resources text alternative">
          {nodes.map((node) => (
            <li key={node.id}>
              {safeConformanceLabel(node.label, 120)} ·{" "}
              {safeConformanceLabel(node.serviceLabel, 120)} · {node.presence} ·{" "}
              {node.status}
            </li>
          ))}
        </ul>
        <h4>Mapped connections</h4>
        {edges.length === 0 ? (
          <p>No safely mapped connections are available in this state.</p>
        ) : (
          <ul aria-label="Mapped connections text alternative">
            {edges.map((edge) => (
              <li key={edge.id}>
                {safeConformanceLabel(
                  nodesById.get(edge.sourceNodeId)?.label ?? edge.sourceNodeId,
                  120,
                )}{" "}
                → {safeConformanceLabel(edge.label, 120)} →{" "}
                {safeConformanceLabel(
                  nodesById.get(edge.targetNodeId)?.label ?? edge.targetNodeId,
                  120,
                )}{" "}
                · {edge.presence} · {edge.status}
              </li>
            ))}
          </ul>
        )}
      </details>
    </figure>
  );
}
