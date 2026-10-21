import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createNotesGenerationRequest } from "@cloudmarkup/application-generator/testing";
import { createAwsDiagramIconRegistryTestInput } from "@cloudmarkup/provider-aws/testing/diagram-icon-registry";
import {
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentHashes,
  hashCanonicalValue,
} from "@cloudmarkup/domain";
import { solutionRevisionManifestV1Schema } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { createDiagramIconSetV1 } from "./assets.js";
import {
  diagramExportRequestV1Schema,
  type DiagramExportRequestV1,
} from "./contracts.js";
import { createResvgDiagramRasterizer } from "./renderer.js";
import { buildDiagramScene } from "./scene.js";
import {
  createDiagramExportService,
  createSfntDiagramExportService,
  diagramRendererV1Pin,
  diagramRendererSfntV1Pin,
} from "./service.js";
import { DIAGRAM_SFNT_FONT } from "./sfnt-font.js";

const awsIconRegistry = createAwsDiagramIconRegistryTestInput();

function assetsByFile(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(awsIconRegistry.assetSpecifiersByFile).map(
      ([file, specifier]) => [
        file,
        readFileSync(fileURLToPath(import.meta.resolve(specifier)), "utf8"),
      ],
    ),
  );
}

const iconSet = createDiagramIconSetV1({
  assetsByFile: assetsByFile(),
  catalog: awsIconRegistry.catalog,
  manifest: awsIconRegistry.manifest,
});

function request(
  options: {
    readonly profile?: "presentation" | "technical";
    readonly reverseCollections?: boolean;
    readonly scale?: number;
  } = {},
): DiagramExportRequestV1 {
  const generation = createNotesGenerationRequest({
    operations: ["create", "read", "update", "delete"],
    ...(options.reverseCollections === undefined
      ? {}
      : { reverseCollections: options.reverseCollections }),
  });
  const solutionRevision = solutionRevisionManifestV1Schema.parse({
    ...generation.solutionRevision,
    versions: {
      ...generation.solutionRevision.versions,
      diagramRenderer: { state: "pinned", tool: diagramRendererV1Pin },
    },
  });
  return {
    architectureDocument: generation.architectureDocument,
    catalog: awsIconRegistry.catalog,
    contractVersion: 1,
    iconSet,
    layout: {
      algorithm: {
        id: "cloudmarkup.diagram-layout",
        version: "1.0.0",
      },
      strategy: "deterministic",
    },
    output: {
      format: "svg-and-png",
      maxHeight: 4_096,
      maxWidth: 4_096,
      scale: options.scale ?? 2,
    },
    profile: {
      architectureTitle: "Authenticated notes API",
      includeStableDeploymentIdentifiers: options.profile === "technical",
      kind: options.profile ?? "presentation",
      projectTitle: "CloudMarkup Notes",
    },
    renderer: diagramRendererV1Pin,
    solutionRevision,
    theme: { background: "opaque-light" },
  };
}

function rebindArchitecture(
  input: DiagramExportRequestV1,
  architectureDocument: DiagramExportRequestV1["architectureDocument"],
): DiagramExportRequestV1 {
  const hashes = getArchitectureDocumentHashes(architectureDocument);
  return {
    ...input,
    architectureDocument,
    solutionRevision: solutionRevisionManifestV1Schema.parse({
      ...input.solutionRevision,
      architecture: {
        ...input.solutionRevision.architecture,
        contentHash: hashes.contentHash,
        documentHash:
          getArchitectureDocumentCanonicalHash(architectureDocument),
        visualHash: hashes.visualHash,
      },
    }),
  };
}

describe("deterministic diagram export", () => {
  it("preserves the historical renderer while binding the explicit SFNT successor and rejecting crossed pins", () => {
    const original = request();
    const input = diagramExportRequestV1Schema.parse({
      ...original,
      output: { ...original.output, format: "svg" },
      renderer: diagramRendererSfntV1Pin,
      solutionRevision: {
        ...original.solutionRevision,
        versions: {
          ...original.solutionRevision.versions,
          diagramRenderer: { state: "pinned", tool: diagramRendererSfntV1Pin },
        },
      },
    });
    const successor = createSfntDiagramExportService({
      rasterizer: {
        rasterize() {
          throw new Error("SVG-only compatibility test cannot request PNG");
        },
      },
    });
    expect(diagramRendererV1Pin.version).toBe("1.0.0");
    expect(diagramRendererSfntV1Pin.version).toBe("1.1.0");
    expect(diagramRendererSfntV1Pin.digest).not.toBe(
      diagramRendererV1Pin.digest,
    );
    const result = successor.generate(input);
    expect(result.artifact.font).toEqual(DIAGRAM_SFNT_FONT);
    expect(result.artifact.renderer).toEqual(diagramRendererSfntV1Pin);
    expect(successor.verify({ request: input, result })).toEqual(result);
    expect(() => createDiagramExportService().generate(input)).toThrow(
      /exact renderer/u,
    );
    expect(() => successor.generate(original)).toThrow(/exact renderer/u);
    expect(() =>
      successor.generate({
        ...input,
        renderer: {
          ...diagramRendererSfntV1Pin,
          digest: "sha256:" + "0".repeat(64),
        },
      }),
    ).toThrow(/exact renderer/u);
  });
  it("renders reproducible accessible SVG and high-resolution PNG from one immutable revision", () => {
    const service = createDiagramExportService();
    const input = request();
    const first = service.generate(input);
    const second = service.generate(structuredClone(input));

    const firstSvg = first.svg;
    if (firstSvg === undefined) {
      throw new TypeError("Expected canonical SVG output.");
    }
    expect(first.artifact).toEqual(second.artifact);
    expect(first.svg).toBe(second.svg);
    expect(first.png).toEqual(second.png);
    expect(firstSvg).toContain('<title id="diagram-title">');
    expect(firstSvg).toContain('<desc id="diagram-description">');
    expect(first.svg).toContain('role="img"');
    expect(
      firstSvg.replace('xmlns="http://www.w3.org/2000/svg"', ""),
    ).not.toMatch(/<script|foreignObject|https?:\/\/|file:\/\//iu);
    expect(first.png?.slice(0, 8)).toEqual(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(first.artifact.files.map((file) => file.path)).toEqual([
      "diagram/README.md",
      "diagram/architecture.png",
      "diagram/architecture.svg",
    ]);
    expect(first.artifact.architecture.semanticHash).toBe(
      input.solutionRevision.architecture.contentHash,
    );
    expect(first.artifact.iconSet.digest).toBe(iconSet.assetSet.digest);
    const { artifactDigest, ...artifactContent } = first.artifact;
    expect(artifactDigest).toBe(hashCanonicalValue(artifactContent));
    expect(service.verify({ request: input, result: first })).toEqual(first);
  });
  it("rejects substituted SVG and PNG bytes against complete artifact checksums", () => {
    const service = createDiagramExportService();
    const input = request();
    const result = service.generate(input);
    expect(() =>
      service.verify({
        request: input,
        result: { ...result, svg: `${result.svg ?? ""} ` },
      }),
    ).toThrow(/checksum|size|metadata|mismatch|reproduce/iu);
    const png = result.png?.slice();
    if (png === undefined)
      throw new Error("The fixture must render PNG output.");
    png[png.byteLength - 1] = (png[png.byteLength - 1] ?? 0) ^ 1;
    expect(() =>
      service.verify({ request: input, result: { ...result, png } }),
    ).toThrow(/checksum|size|metadata|mismatch|reproduce/iu);
  });

  it("is invariant to equivalent input collection order", () => {
    const service = createDiagramExportService();
    const baseline = service.generate(request());
    const reordered = service.generate(request({ reverseCollections: true }));

    expect(reordered.artifact).toEqual(baseline.artifact);
    expect(reordered.svg).toBe(baseline.svg);
    expect(reordered.png).toEqual(baseline.png);
  });

  it("keeps presentation and technical profiles semantically identical", () => {
    const presentation = buildDiagramScene(
      request({ profile: "presentation" }),
    );
    const technical = buildDiagramScene(request({ profile: "technical" }));

    expect(technical.nodes.map((node) => node.internalId)).toEqual(
      presentation.nodes.map((node) => node.internalId),
    );
    expect(
      technical.edges.map((edge) => [
        edge.internalId,
        edge.sourceNodeId,
        edge.targetNodeId,
      ]),
    ).toEqual(
      presentation.edges.map((edge) => [
        edge.internalId,
        edge.sourceNodeId,
        edge.targetNodeId,
      ]),
    );
    expect(technical.sceneDigest).not.toBe(presentation.sceneDigest);
    expect(
      technical.nodes.some((node) => node.deploymentIdentifier !== undefined),
    ).toBe(true);
    expect(
      presentation.nodes.every(
        (node) => node.deploymentIdentifier === undefined,
      ),
    ).toBe(true);
  });

  it("routes parallel semantic relationships in distinct stable lanes", () => {
    const result = createDiagramExportService().generate(
      request({ profile: "technical" }),
    );
    const routes = [
      ...(result.svg ?? "").matchAll(
        /<path d="([^"]+)"[^>]+marker-end="url\(#edge-arrow\)"/gu,
      ),
    ].map((match) => match[1]);
    expect(routes.length).toBeGreaterThan(1);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("uses reviewed provider icon bytes and rejects substituted external assets", () => {
    const baseline = request();
    const lambdaIconIndex = baseline.iconSet.icons.findIndex(
      (icon) => icon.iconId === "aws.cloudmarkup.icons.lambda",
    );
    expect(lambdaIconIndex).toBeGreaterThanOrEqual(0);
    const icons = baseline.iconSet.icons.map((icon, index) =>
      index === lambdaIconIndex
        ? {
            ...icon,
            svg: '<svg viewBox="0 0 64 64"><image href="https://example.invalid/icon.svg"/></svg>',
          }
        : icon,
    );
    expect(() =>
      createDiagramExportService().generate({
        ...baseline,
        iconSet: { ...baseline.iconSet, icons },
      }),
    ).toThrow(/icon bytes|active|external|unsupported/iu);
  });

  it("escapes malicious labels without exposing active markup", () => {
    const baseline = request();
    const architectureDocument = {
      ...baseline.architectureDocument,
      nodes: baseline.architectureDocument.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              presentation: {
                ...node.presentation,
                label: "</text><script>run()</script>",
              },
            }
          : node,
      ),
    };
    const result = createDiagramExportService().generate(
      rebindArchitecture(baseline, architectureDocument),
    );
    expect(result.svg).not.toContain("<script>run()</script>");
    expect(result.svg).toContain(
      "&lt;/text&gt;&lt;script&gt;run()&lt;/script&gt;",
    );
  });

  it("warns on bounded label truncation and fails before unbounded graphs allocate", () => {
    const baseline = request();
    const longLabel = "Readable label ".repeat(40);
    const architectureDocument = {
      ...baseline.architectureDocument,
      nodes: baseline.architectureDocument.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              presentation: { ...node.presentation, label: longLabel },
            }
          : node,
      ),
    };
    const labelResult = createDiagramExportService().generate(
      rebindArchitecture(baseline, architectureDocument),
    );
    expect(labelResult.artifact.warnings.map((item) => item.code)).toContain(
      "cloudmarkup.diagram.label-truncated",
    );

    const tooManyNodes = Array.from({ length: 1_001 }, (_, index) => ({
      ...baseline.architectureDocument.nodes[0],
      id: `node_oversized_${String(index).padStart(4, "0")}`,
    }));
    expect(() =>
      createDiagramExportService().generate({
        ...baseline,
        architectureDocument: {
          ...baseline.architectureDocument,
          edges: [],
          nodes: tooManyNodes,
        },
      }),
    ).toThrow(/node limit/iu);
  });

  it("rejects viewport, selection, and panel state at the strict service boundary", () => {
    const baseline = request();
    const transientEditorStates = [
      {
        activeDock: {
          direction: "output",
          groupId: "networking",
          nodeId: "node_a",
        },
      },
      { assistanceMode: "guided" },
      { collapsedBoundaryIds: ["node_network"] },
      { disclosureState: { networkHelp: true, routes: true } },
      { minimapViewport: { height: 104, width: 152, x: 0, y: 0 } },
      { panelState: { catalog: "open", inspector: "collapsed" } },
      {
        selectedNodeId: baseline.architectureDocument.nodes[0]?.id,
      },
      { viewport: { x: 100, y: 200, zoom: 3 } },
    ];

    for (const transientState of transientEditorStates) {
      expect(() =>
        createDiagramExportService().generate({
          ...baseline,
          ...transientState,
        }),
      ).toThrow();
    }
  });

  it("derives identical strict requests and bytes from unchanged documents across editor presentations", () => {
    const baseline = request();
    const guidedSnapshot = Object.freeze({
      architectureDocument: structuredClone(baseline.architectureDocument),
      presentation: Object.freeze({
        assistanceMode: "guided",
        collapsedBoundaryIds: Object.freeze([]),
        disclosureState: Object.freeze({ networkHelp: false }),
        minimapViewport: Object.freeze({ x: 0, y: 0, zoom: 1 }),
        panelState: Object.freeze({ inspector: "open" }),
      }),
    });
    const professionalSnapshot = Object.freeze({
      architectureDocument: structuredClone(baseline.architectureDocument),
      presentation: Object.freeze({
        assistanceMode: "professional",
        collapsedBoundaryIds: Object.freeze(["node_network"]),
        disclosureState: Object.freeze({ networkHelp: true }),
        minimapViewport: Object.freeze({ x: 12, y: 20, zoom: 0.5 }),
        panelState: Object.freeze({ inspector: "closed" }),
      }),
    });
    expect(professionalSnapshot.presentation).not.toEqual(
      guidedSnapshot.presentation,
    );
    expect(professionalSnapshot.architectureDocument).toEqual(
      guidedSnapshot.architectureDocument,
    );
    expect(
      getArchitectureDocumentHashes(professionalSnapshot.architectureDocument),
    ).toEqual(
      getArchitectureDocumentHashes(guidedSnapshot.architectureDocument),
    );

    const guidedRequest = diagramExportRequestV1Schema.parse(
      rebindArchitecture(baseline, guidedSnapshot.architectureDocument),
    );
    const professionalRequest = diagramExportRequestV1Schema.parse(
      rebindArchitecture(
        structuredClone(baseline),
        professionalSnapshot.architectureDocument,
      ),
    );
    expect(professionalRequest).toEqual(guidedRequest);

    const service = createDiagramExportService();
    const guided = service.generate(guidedRequest);
    const professional = service.generate(professionalRequest);
    expect(professional.artifact).toEqual(guided.artifact);
    expect(professional.svg).toBe(guided.svg);
    expect(professional.png).toEqual(guided.png);
  });

  it("derives exact PNG dimensions from canonical SVG with pinned local fonts", () => {
    const input = request({ scale: 3 });
    const result = createDiagramExportService({
      rasterizer: createResvgDiagramRasterizer(),
    }).generate(input);
    expect(result.artifact.dimensions.png?.width).toBe(
      (result.artifact.dimensions.svg?.width ?? 0) * 3,
    );
    expect(result.artifact.dimensions.png?.height).toBe(
      (result.artifact.dimensions.svg?.height ?? 0) * 3,
    );
    expect(result.artifact.font).toMatchObject({
      family: "Inter",
      source: "pinned-local-assets",
      version: "5.3.0",
    });
  });
});
