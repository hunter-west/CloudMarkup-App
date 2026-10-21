import type { ObservedSolutionV1 } from "@cloudmarkup/schemas";
import { Button } from "@cloudmarkup/ui";
import { useEffect, useRef, useState } from "react";

const PAGE_SIZE = 48;
const MAX_COLUMNS = 4;

/** Observation layout is presentation only; it never creates graph commands. */
export function ObservedArchitectureDiagram({
  solution,
}: {
  readonly solution: ObservedSolutionV1;
}) {
  const [page, setPage] = useState(0);
  const container = useRef<HTMLElement>(null);
  const [availableColumns, setAvailableColumns] = useState(MAX_COLUMNS);
  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined)
        setAvailableColumns(
          Math.max(
            1,
            Math.min(MAX_COLUMNS, Math.floor(entry.contentRect.width / 220)),
          ),
        );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [
    solution.observedSolutionId,
    solution.resources.length,
    solution.externalResources.length,
  ]);
  const evidence = new Map(
    solution.evidence.map((item) => [item.sourceEvidenceId, item.path]),
  );
  const nodes = [
    ...solution.resources.map((resource) => ({
      id: resource.observedResourceId,
      label: resource.resourceType,
      detail:
        resource.sourceEvidenceIds
          .map((id) => evidence.get(id))
          .find((path) => path !== undefined) ?? "Source unavailable",
      state:
        resource.certainty.kind !== "deterministic"
          ? "unresolved"
          : resource.designComparison.state === "matches-approved-design"
            ? "matching"
            : resource.designComparison.state ===
                "conflicts-with-approved-design"
              ? "changed"
              : "observed-only",
    })),
    ...solution.externalResources.map((resource) => ({
      id: resource.candidateId,
      label: "External resource",
      detail: resource.capability,
      state: "external",
    })),
  ].sort((left, right) => left.id.localeCompare(right.id));
  if (nodes.length === 0) {
    return (
      <p>
        No resources were detected. Review the import issues and selected files.
      </p>
    );
  }
  const pages = Math.ceil(nodes.length / PAGE_SIZE);
  const currentPage = Math.min(page, pages - 1);
  const visible = nodes.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const columns = Math.min(availableColumns, visible.length);
  const positions = new Map(
    visible.map((node, index) => [
      node.id,
      {
        x: 110 + (index % columns) * 220,
        y: 60 + Math.floor(index / columns) * 120,
      },
    ]),
  );
  const lines = solution.connections.flatMap((connection) => {
    const source = positions.get(
      connection.source.kind === "resource"
        ? connection.source.observedResourceId
        : connection.source.candidateId,
    );
    const target = positions.get(
      connection.target.kind === "resource"
        ? connection.target.observedResourceId
        : connection.target.candidateId,
    );
    return source === undefined || target === undefined
      ? []
      : [{ connection, source, target }];
  });
  const shorten = (value: string) =>
    value.length > 27 ? `${value.slice(0, 26)}…` : value;
  return (
    <figure className="repository-conformance__diagram" ref={container}>
      <svg
        aria-label="Imported architecture diagram from repository source"
        role="img"
        viewBox={`0 0 ${String(columns * 220)} ${String(Math.ceil(visible.length / columns) * 120)}`}
      >
        <g className="repository-conformance__diagram-edges">
          {lines.map(({ connection, source, target }) => (
            <line
              aria-label={connection.relationshipType}
              key={connection.observedConnectionId}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
            >
              <title>{connection.relationshipType}</title>
            </line>
          ))}
        </g>
        {visible.map((node) => {
          const position = positions.get(node.id);
          if (position === undefined) return null;
          return (
            <g
              aria-label={`${node.label}, ${node.state}, ${node.detail}`}
              data-conformance-state={node.state}
              key={node.id}
              transform={`translate(${String(position.x - 96)} ${String(position.y - 34)})`}
            >
              <title>{`${node.label} · ${node.detail}`}</title>
              <rect width="192" height="68" rx="10" />
              <text x="12" y="27">
                {shorten(node.label)}
              </text>
              <text
                className="repository-conformance__diagram-service"
                x="12"
                y="49"
              >
                {shorten(node.detail)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        Detected resources and connections from the selected source files.
        {pages > 1
          ? ` Showing ${String(currentPage * PAGE_SIZE + 1)}–${String(Math.min((currentPage + 1) * PAGE_SIZE, nodes.length))} of ${String(nodes.length)} resources; lines connect resources on this page.`
          : null}
      </figcaption>
      {pages > 1 ? (
        <nav aria-label="Imported diagram pages">
          <Button
            disabled={currentPage === 0}
            onClick={() => {
              setPage(currentPage - 1);
            }}
          >
            Previous resources
          </Button>
          <Button
            disabled={currentPage === pages - 1}
            onClick={() => {
              setPage(currentPage + 1);
            }}
          >
            Next resources
          </Button>
        </nav>
      ) : null}
    </figure>
  );
}
