import ELK from "elkjs/lib/elk-api.js";
import type {
  ElkExtendedEdge,
  ElkNode,
  ElkPort,
  LayoutOptions,
} from "elkjs/lib/elk-api.js";

import {
  BOUNDARY_CONTENT_BOTTOM,
  BOUNDARY_CONTENT_LEFT,
  BOUNDARY_CONTENT_RIGHT,
  BOUNDARY_CONTENT_TOP,
  EDITOR_GRID_SIZE,
} from "./architecture-geometry.js";
import {
  canonicalizeLayoutRequest,
  LayoutAdapterError,
  LayoutCanceledError,
  MAX_LAYOUT_COORDINATE,
  MAX_LAYOUT_DIMENSION,
  type CanonicalLayoutRequest,
  type LayoutAdapter,
  type LayoutNode,
  type LayoutPosition,
  type LayoutRequest,
  type LayoutResult,
  type LayoutRunOptions,
} from "./layout-adapter.js";

const ELK_ROOT_ID = "cloudmarkup.layout.root";
const PORT_SIZE = 8;

const ROOT_LAYOUT_OPTIONS: LayoutOptions = Object.freeze({
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
  "elk.layered.spacing.nodeNodeBetweenLayers": "112",
  "elk.padding": "[top=32,left=32,bottom=32,right=32]",
  "elk.randomSeed": "0",
  "elk.spacing.nodeNode": "72",
});

const NODE_LAYOUT_OPTIONS: LayoutOptions = Object.freeze({
  "elk.padding": `[top=${String(BOUNDARY_CONTENT_TOP)},left=${String(
    BOUNDARY_CONTENT_LEFT,
  )},bottom=${String(BOUNDARY_CONTENT_BOTTOM)},right=${String(
    BOUNDARY_CONTENT_RIGHT,
  )}]`,
  "elk.portConstraints": "FIXED_ORDER",
  "elk.spacing.nodeNode": "72",
});

const INPUT_PORT_OPTIONS: LayoutOptions = Object.freeze({
  "elk.port.side": "WEST",
});

const OUTPUT_PORT_OPTIONS: LayoutOptions = Object.freeze({
  "elk.port.side": "EAST",
});

export interface ElkLayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
  terminateWorker(): void;
}

export type ElkLayoutEngineFactory = () => ElkLayoutEngine;

export interface ElkLayoutAdapterOptions {
  readonly createEngine: ElkLayoutEngineFactory;
}

export function createWebWorkerElkLayoutEngine(
  createWorker: () => Worker,
): ElkLayoutEngine {
  const elk = new ELK({ workerFactory: createWorker });
  return {
    async layout(graph) {
      return elk.layout(graph);
    },
    terminateWorker() {
      elk.terminateWorker();
    },
  };
}

function invalidResult(path: string, message: string): never {
  throw new LayoutAdapterError("invalid-result", path, message);
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

function encodedIdentity(value: string): string {
  return encodeURIComponent(value);
}

function qualifiedPortId(nodeId: string, portId: string): string {
  return `cloudmarkup.layout.port/${encodedIdentity(nodeId)}/${encodedIdentity(
    portId,
  )}`;
}

function elkPort(nodeId: string, port: LayoutNode["ports"][number]): ElkPort {
  return {
    height: PORT_SIZE,
    id: qualifiedPortId(nodeId, port.id),
    layoutOptions:
      port.direction === "input" ? INPUT_PORT_OPTIONS : OUTPUT_PORT_OPTIONS,
    width: PORT_SIZE,
  };
}

function elkNode(
  node: LayoutNode,
  childrenByParent: ReadonlyMap<string, readonly LayoutNode[]>,
): ElkNode {
  const children = childrenByParent.get(node.id) ?? [];
  return {
    id: node.id,
    height: node.height,
    layoutOptions: NODE_LAYOUT_OPTIONS,
    ports: node.ports.map((port) => elkPort(node.id, port)),
    width: node.width,
    ...(children.length === 0
      ? {}
      : {
          children: children.map((child) => elkNode(child, childrenByParent)),
        }),
  };
}

function elkEdge(
  edge: CanonicalLayoutRequest["edges"][number],
): ElkExtendedEdge {
  return {
    id: edge.id,
    sources: [qualifiedPortId(edge.source.nodeId, edge.source.portId)],
    targets: [qualifiedPortId(edge.target.nodeId, edge.target.portId)],
  };
}

export function createElkGraph(request: CanonicalLayoutRequest): ElkNode {
  if (request.nodes.some((node) => node.id === ELK_ROOT_ID)) {
    throw new LayoutAdapterError(
      "invalid-request",
      "$.nodes",
      `The node ID "${ELK_ROOT_ID}" is reserved by the layout adapter.`,
    );
  }

  const childrenByParent = new Map<string, LayoutNode[]>();
  const roots: LayoutNode[] = [];
  for (const node of request.nodes) {
    if (node.parentId === undefined) {
      roots.push(node);
      continue;
    }
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }

  return {
    id: ELK_ROOT_ID,
    children: roots.map((root) => elkNode(root, childrenByParent)),
    edges: request.edges.map(elkEdge),
    layoutOptions: ROOT_LAYOUT_OPTIONS,
  };
}

function requireFiniteBounded(
  value: number | undefined,
  path: string,
  maximum: number,
): number {
  if (
    value === undefined ||
    !Number.isFinite(value) ||
    Math.abs(value) > maximum
  ) {
    invalidResult(
      path,
      `ELK returned a missing, non-finite, or out-of-bounds value (maximum ${String(
        maximum,
      )}).`,
    );
  }
  return value;
}

function snappedCoordinate(value: number, path: string): number {
  const snapped = Math.round(value / EDITOR_GRID_SIZE) * EDITOR_GRID_SIZE;
  if (!Number.isFinite(snapped) || Math.abs(snapped) > MAX_LAYOUT_COORDINATE) {
    invalidResult(path, "ELK returned a coordinate that cannot be normalized.");
  }
  return Object.is(snapped, -0) ? 0 : snapped;
}

function expectedParentByNodeId(
  request: CanonicalLayoutRequest,
): ReadonlyMap<string, string | null> {
  return new Map(
    request.nodes.map((node) => [node.id, node.parentId ?? null] as const),
  );
}

function expectedPortIdsByNodeId(
  request: CanonicalLayoutRequest,
): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    request.nodes.map(
      (node) =>
        [
          node.id,
          new Set(node.ports.map((port) => qualifiedPortId(node.id, port.id))),
        ] as const,
    ),
  );
}

function validateReturnedPorts(
  node: ElkNode,
  expectedPortIds: ReadonlySet<string>,
  path: string,
): void {
  const returnedPorts = node.ports ?? [];
  if (returnedPorts.length !== expectedPortIds.size) {
    invalidResult(
      `${path}.ports`,
      "ELK did not return the complete typed-port set.",
    );
  }
  const seen = new Set<string>();
  returnedPorts.forEach((port, index) => {
    if (!expectedPortIds.has(port.id) || seen.has(port.id)) {
      invalidResult(
        `${path}.ports[${String(index)}].id`,
        "ELK returned an unknown or duplicate typed port.",
      );
    }
    seen.add(port.id);
  });
}

function readElkResult(
  output: ElkNode,
  request: CanonicalLayoutRequest,
): LayoutResult {
  if (output.id !== ELK_ROOT_ID) {
    invalidResult("$.id", "ELK changed the deterministic root identity.");
  }

  const expectedParents = expectedParentByNodeId(request);
  const expectedPorts = expectedPortIdsByNodeId(request);
  const positionsByNodeId = new Map<string, LayoutPosition>();

  function visit(children: readonly ElkNode[], parentId: string | null): void {
    children.forEach((node, index) => {
      const path =
        parentId === null
          ? `$.children[${String(index)}]`
          : `$.nodes.${parentId}.children[${String(index)}]`;
      const expectedParent = expectedParents.get(node.id);
      if (expectedParent === undefined) {
        invalidResult(`${path}.id`, "ELK returned an unknown node.");
      }
      if (positionsByNodeId.has(node.id)) {
        invalidResult(`${path}.id`, "ELK returned a duplicate node.");
      }
      if (expectedParent !== parentId) {
        invalidResult(
          `${path}.id`,
          "ELK changed a node's visual parent relationship.",
        );
      }

      const x = requireFiniteBounded(
        node.x,
        `${path}.x`,
        MAX_LAYOUT_COORDINATE,
      );
      const y = requireFiniteBounded(
        node.y,
        `${path}.y`,
        MAX_LAYOUT_COORDINATE,
      );
      const width = requireFiniteBounded(
        node.width,
        `${path}.width`,
        MAX_LAYOUT_DIMENSION,
      );
      const height = requireFiniteBounded(
        node.height,
        `${path}.height`,
        MAX_LAYOUT_DIMENSION,
      );
      if (width <= 0 || height <= 0) {
        invalidResult(path, "ELK returned a non-positive node dimension.");
      }

      const portIds = expectedPorts.get(node.id);
      if (portIds === undefined) {
        invalidResult(
          `${path}.ports`,
          "ELK returned ports for an unknown node.",
        );
      }
      validateReturnedPorts(node, portIds, path);

      positionsByNodeId.set(
        node.id,
        Object.freeze({
          nodeId: node.id,
          parentId,
          position: Object.freeze({
            x: snappedCoordinate(x, `${path}.x`),
            y: snappedCoordinate(y, `${path}.y`),
          }),
        }),
      );
      visit(node.children ?? [], node.id);
    });
  }

  visit(output.children ?? [], null);
  if (positionsByNodeId.size !== request.nodes.length) {
    invalidResult(
      "$.children",
      "ELK did not return every requested layout node.",
    );
  }

  return Object.freeze({
    positions: Object.freeze(
      request.nodes.map((node) => {
        const position = positionsByNodeId.get(node.id);
        if (position === undefined) {
          invalidResult(
            "$.children",
            "ELK did not return every requested layout node.",
          );
        }
        return position;
      }),
    ),
  });
}

async function runEngine(
  engine: ElkLayoutEngine,
  graph: ElkNode,
  signal: AbortSignal | undefined,
): Promise<ElkNode> {
  if (isAborted(signal)) {
    throw new LayoutCanceledError();
  }

  let terminated = false;
  const terminate = () => {
    if (!terminated) {
      terminated = true;
      try {
        engine.terminateWorker();
      } catch {
        // The bundled Node fallback has no native Worker to terminate. Layout
        // results and cancellation still fail closed through the request race.
      }
    }
  };
  let rejectCancellation: ((reason: LayoutCanceledError) => void) | undefined;
  const cancellation =
    signal === undefined
      ? undefined
      : new Promise<never>((_resolve, reject) => {
          rejectCancellation = reject;
        });
  const onAbort = () => {
    terminate();
    rejectCancellation?.(new LayoutCanceledError());
  };

  signal?.addEventListener("abort", onAbort, { once: true });
  if (isAborted(signal)) {
    onAbort();
  }

  try {
    const work = Promise.resolve().then(() => engine.layout(graph));
    return cancellation === undefined
      ? await work
      : await Promise.race([work, cancellation]);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    terminate();
  }
}

export class ElkLayoutAdapter implements LayoutAdapter {
  readonly #createEngine: ElkLayoutEngineFactory;

  public constructor(options: ElkLayoutAdapterOptions) {
    this.#createEngine = options.createEngine;
  }

  public async layout(
    request: LayoutRequest,
    options: LayoutRunOptions = {},
  ): Promise<LayoutResult> {
    if (isAborted(options.signal)) {
      throw new LayoutCanceledError();
    }

    const canonicalRequest = canonicalizeLayoutRequest(request);
    if (canonicalRequest.nodes.length === 0) {
      return Object.freeze({ positions: Object.freeze([]) });
    }
    const graph = createElkGraph(canonicalRequest);
    const engine = this.#createEngine();

    try {
      const output = await runEngine(engine, graph, options.signal);
      if (isAborted(options.signal)) {
        throw new LayoutCanceledError();
      }
      return readElkResult(output, canonicalRequest);
    } catch (error) {
      if (error instanceof LayoutAdapterError) {
        throw error;
      }
      if (isAborted(options.signal)) {
        throw new LayoutCanceledError();
      }
      throw new LayoutAdapterError(
        "engine-failed",
        "$",
        "ELK could not produce an automatic layout.",
        { cause: error },
      );
    }
  }
}
