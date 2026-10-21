import { hashCanonicalValue } from "@cloudmarkup/domain";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";

import {
  DIAGRAM_EXPORT_LIMITS,
  DIAGRAM_LAYOUT_ID,
  DIAGRAM_LAYOUT_VERSION,
  DIAGRAM_RENDERER_ID,
  DIAGRAM_RENDERER_VERSION,
  DIAGRAM_RENDERER_SFNT_VERSION,
  diagramExportArtifactV1Schema,
  diagramExportRequestV1Schema,
  type DiagramExportArtifactV1,
  type DiagramExportFileMetadataV1,
  type DiagramExportRequestV1,
  type DiagramExportResultV1,
  type DiagramRendererPinV1,
} from "./contracts.js";
import {
  createResvgDiagramRasterizer,
  DIAGRAM_FONT,
  renderDiagramSvg,
  type DiagramPngRasterizer,
} from "./renderer.js";
import { buildDiagramScene } from "./scene.js";
import { DIAGRAM_SFNT_FONT, DIAGRAM_SFNT_FONT_SOURCE } from "./sfnt-font.js";
import { compareUtf16, digestBytes, utf8Size } from "./security.js";

const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const rendererCommitment = Object.freeze({
  font: DIAGRAM_FONT,
  layout: { id: DIAGRAM_LAYOUT_ID, version: DIAGRAM_LAYOUT_VERSION },
  rasterizer: {
    id: "resvg-js",
    package: "@resvg/resvg-js",
    version: "2.6.2",
  },
  renderer: { id: DIAGRAM_RENDERER_ID, version: DIAGRAM_RENDERER_VERSION },
  svgPolicy: "cloudmarkup.safe-diagram-svg.v1",
});

export const diagramRendererV1Pin: DiagramRendererPinV1 = Object.freeze({
  digest: hashCanonicalValue(rendererCommitment),
  id: DIAGRAM_RENDERER_ID,
  version: DIAGRAM_RENDERER_VERSION,
});

/** Prospective font-correct successor; historical 1.0.0 commitments stay exact. */
export const diagramRendererSfntV1Pin: DiagramRendererPinV1 = Object.freeze({
  digest: hashCanonicalValue({
    ...rendererCommitment,
    font: DIAGRAM_SFNT_FONT,
    fontEncoding: DIAGRAM_SFNT_FONT_SOURCE,
    renderer: {
      id: DIAGRAM_RENDERER_ID,
      version: DIAGRAM_RENDERER_SFNT_VERSION,
    },
  }),
  id: DIAGRAM_RENDERER_ID,
  version: DIAGRAM_RENDERER_SFNT_VERSION,
});

function metadataForText(
  path: DiagramExportFileMetadataV1["path"],
  mediaType: DiagramExportFileMetadataV1["mediaType"],
  content: string,
  semanticChecksum: DiagramExportFileMetadataV1["semanticChecksum"],
): DiagramExportFileMetadataV1 {
  return {
    checksum: digestBytes(content),
    mediaType,
    path,
    semanticChecksum,
    sizeBytes: utf8Size(content),
  };
}

function metadataForBytes(
  path: DiagramExportFileMetadataV1["path"],
  mediaType: DiagramExportFileMetadataV1["mediaType"],
  content: Uint8Array,
  semanticChecksum: DiagramExportFileMetadataV1["semanticChecksum"],
): DiagramExportFileMetadataV1 {
  return {
    checksum: digestBytes(content),
    mediaType,
    path,
    semanticChecksum,
    sizeBytes: content.byteLength,
  };
}

function renderReadme(
  request: DiagramExportRequestV1,
  sceneDigest: string,
  warnings: readonly { readonly code: string; readonly message: string }[],
  hasSvg: boolean,
  hasPng: boolean,
): string {
  const lines = [
    "# Architecture diagram",
    "",
    "This diagram was rendered from the immutable Solution Revision used by the infrastructure and application workflow. It is not a browser screenshot and does not use selection, panels, hover, viewport, zoom, minimap, or scroll state.",
    "",
    `- Profile: \`${request.profile.kind}\``,
    `- Background: \`${request.theme.background}\``,
    `- Layout: \`${request.layout.strategy}\` (` +
      `\`${request.layout.algorithm.id}@${request.layout.algorithm.version}\`)`,
    `- Renderer: \`${request.renderer.id}@${request.renderer.version}\``,
    `- Scene digest: \`${sceneDigest}\``,
    `- Catalog: \`${request.catalog.catalog.id}@${request.catalog.catalog.version}\``,
    `- Icon set: \`${request.iconSet.assetSet.id}@${request.iconSet.assetSet.version}\``,
    "",
  ];
  if (hasSvg) {
    lines.push(
      "## Scalable preview",
      "",
      "![Immutable architecture diagram](architecture.svg)",
      "",
    );
  }
  if (hasPng) {
    lines.push(
      "## High-resolution PNG",
      "",
      "[Open the PNG diagram](architecture.png)",
      "",
    );
  }
  if (warnings.length > 0) {
    lines.push("## Rendering warnings", "");
    for (const item of warnings) {
      lines.push(`- \`${item.code}\`: ${item.message}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function evidenceCount(request: DiagramExportRequestV1): number {
  return (
    request.solutionRevision.generationCoverage.evidence.length +
    request.solutionRevision.generationCoverage.workloads.reduce(
      (total, workload) => total + workload.evidence.length,
      0,
    )
  );
}

function artifactContent(
  artifact: DiagramExportArtifactV1,
): Omit<DiagramExportArtifactV1, "artifactDigest"> {
  const { artifactDigest, ...content } = artifact;
  void artifactDigest;
  return content;
}

function parsePngDimensions(png: Uint8Array): {
  readonly height: number;
  readonly width: number;
} {
  if (
    png.length < 24 ||
    !PNG_SIGNATURE.every((value, index) => png[index] === value) ||
    String.fromCharCode(...png.slice(12, 16)) !== "IHDR"
  ) {
    throw new TypeError("Diagram PNG is missing a valid PNG/IHDR header.");
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { height: view.getUint32(20), width: view.getUint32(16) };
}

function rendererPinsEqual(
  left: {
    readonly digest: string;
    readonly id: string;
    readonly version: string;
  },
  right: {
    readonly digest: string;
    readonly id: string;
    readonly version: string;
  },
): boolean {
  return (
    left.digest === right.digest &&
    left.id === right.id &&
    left.version === right.version
  );
}

export interface DiagramExportServiceV1 {
  generate(input: unknown): DiagramExportResultV1;
  verify(input: {
    readonly request: unknown;
    readonly result: unknown;
  }): DiagramExportResultV1;
}

export function createDiagramExportService(
  options: {
    readonly rasterizer?: DiagramPngRasterizer;
  } = {},
): DiagramExportServiceV1 {
  return createBoundDiagramExportService({
    rasterizer: options.rasterizer ?? createResvgDiagramRasterizer(),
    font: DIAGRAM_FONT,
    renderer: diagramRendererV1Pin,
  });
}

/** The SFNT successor always requires the explicitly admitted native rasterizer. */
export function createSfntDiagramExportService(options: {
  readonly rasterizer: DiagramPngRasterizer;
}): DiagramExportServiceV1 {
  return createBoundDiagramExportService({
    rasterizer: options.rasterizer,
    font: DIAGRAM_SFNT_FONT,
    renderer: diagramRendererSfntV1Pin,
  });
}

function createBoundDiagramExportService(options: {
  readonly rasterizer: DiagramPngRasterizer;
  readonly font: typeof DIAGRAM_FONT | typeof DIAGRAM_SFNT_FONT;
  readonly renderer: DiagramRendererPinV1;
}): DiagramExportServiceV1 {
  const { rasterizer, font, renderer } = options;
  function generate(input: unknown): DiagramExportResultV1 {
    const request = diagramExportRequestV1Schema.parse(input);
    if (!rendererPinsEqual(request.renderer, renderer)) {
      throw new TypeError("Diagram request does not pin this exact renderer.");
    }
    const scene = buildDiagramScene(request);
    const canonicalSvg = renderDiagramSvg(scene, request);
    if (utf8Size(canonicalSvg) > DIAGRAM_EXPORT_LIMITS.maxSvgBytes) {
      throw new TypeError("Canonical SVG exceeds the approved byte limit.");
    }
    const auditedSvg = canonicalSvg.replace(
      'xmlns="http://www.w3.org/2000/svg"',
      "",
    );
    if (
      /<(?:script|foreignObject)\b|\b(?:href|xlink:href|on[A-Za-z]+)\s*=|https?:\/\/|file:\/\//iu.test(
        auditedSvg,
      )
    ) {
      throw new TypeError(
        "Canonical SVG contains forbidden active or external content.",
      );
    }
    const hasSvg = request.output.format !== "png";
    const hasPng = request.output.format !== "svg";
    const pngWidth = scene.dimensions.width * request.output.scale;
    const pngHeight = scene.dimensions.height * request.output.scale;
    if (
      pngWidth > request.output.maxWidth ||
      pngHeight > request.output.maxHeight ||
      pngWidth * pngHeight > DIAGRAM_EXPORT_LIMITS.maxPixels
    ) {
      throw new TypeError("Derived PNG dimensions exceed the approved bounds.");
    }
    const png = hasPng
      ? rasterizer.rasterize({
          height: pngHeight,
          svg: canonicalSvg,
          width: pngWidth,
        })
      : undefined;
    if (
      png !== undefined &&
      png.byteLength > DIAGRAM_EXPORT_LIMITS.maxPngBytes
    ) {
      throw new TypeError("Derived PNG exceeds the approved byte limit.");
    }
    if (png !== undefined) {
      const dimensions = parsePngDimensions(png);
      if (dimensions.width !== pngWidth || dimensions.height !== pngHeight) {
        throw new TypeError(
          "Derived PNG dimensions do not match its manifest.",
        );
      }
    }
    const readme = renderReadme(
      request,
      scene.sceneDigest,
      scene.warnings,
      hasSvg,
      hasPng,
    );
    const files: DiagramExportFileMetadataV1[] = [
      metadataForText(
        "diagram/README.md",
        "text/markdown",
        readme,
        digestBytes(readme.replaceAll("\r\n", "\n")),
      ),
      ...(hasSvg
        ? [
            metadataForText(
              "diagram/architecture.svg",
              "image/svg+xml",
              canonicalSvg,
              digestBytes(canonicalSvg.replaceAll("\r\n", "\n")),
            ),
          ]
        : []),
      ...(png === undefined
        ? []
        : [
            metadataForBytes(
              "diagram/architecture.png",
              "image/png",
              png,
              digestBytes(png),
            ),
          ]),
    ].sort((left, right) => compareUtf16(left.path, right.path));

    const content = {
      architecture: {
        canonicalHash: scene.architecture.canonicalHash,
        contentHash: scene.architecture.contentHash,
        semanticHash: scene.architecture.contentHash,
        visualHash: scene.architecture.visualHash,
      },
      catalog: {
        digest: request.catalog.digest,
        id: request.catalog.catalog.id,
        version: request.catalog.catalog.version,
      },
      contractVersion: 1 as const,
      dimensions: {
        ...(png === undefined
          ? {}
          : { png: { height: pngHeight, width: pngWidth } }),
        ...(hasSvg
          ? {
              svg: {
                height: scene.dimensions.height,
                width: scene.dimensions.width,
              },
            }
          : {}),
      },
      evidenceSummary: {
        evidenceAtFreezeCount:
          request.solutionRevision.evidenceIdsAtFreeze.length,
        evidenceAtFreezeDigest: hashCanonicalValue(
          request.solutionRevision.evidenceIdsAtFreeze,
        ),
        generationCoverageDigest: hashCanonicalValue(
          request.solutionRevision.generationCoverage,
        ),
        generationCoverageEvidenceCount: evidenceCount(request),
      },
      files,
      font,
      iconSet: request.iconSet.assetSet,
      kind: "cloudmarkup.diagram-export-artifact" as const,
      layout: request.layout,
      profile: request.profile,
      renderer: request.renderer,
      sceneDigest: scene.sceneDigest,
      solutionRevision: {
        digest: hashCanonicalValue(request.solutionRevision),
        id: request.solutionRevision.solutionRevisionId,
      },
      theme: request.theme,
      warnings: scene.warnings,
    };
    const artifact = diagramExportArtifactV1Schema.parse({
      ...content,
      artifactDigest: hashCanonicalValue(content),
    });
    return Object.freeze({
      artifact,
      ...(png === undefined ? {} : { png }),
      readme,
      ...(hasSvg ? { svg: canonicalSvg } : {}),
    });
  }

  function verify(input: {
    readonly request: unknown;
    readonly result: unknown;
  }): DiagramExportResultV1 {
    if (
      typeof input.result !== "object" ||
      input.result === null ||
      Array.isArray(input.result)
    ) {
      throw new TypeError("Diagram result must be an object.");
    }
    const result = input.result as Partial<DiagramExportResultV1>;
    const artifact = diagramExportArtifactV1Schema.parse(result.artifact);
    if (
      artifact.artifactDigest !== hashCanonicalValue(artifactContent(artifact))
    ) {
      throw new TypeError(
        "Diagram artifact digest does not match its metadata.",
      );
    }
    const expected = generate(input.request);
    if (
      serializeCanonicalJson(artifact) !==
        serializeCanonicalJson(expected.artifact) ||
      result.readme !== expected.readme ||
      result.svg !== expected.svg ||
      (result.png === undefined) !== (expected.png === undefined) ||
      (result.png !== undefined &&
        expected.png !== undefined &&
        digestBytes(result.png) !== digestBytes(expected.png))
    ) {
      throw new TypeError(
        "Diagram result does not reproduce from the exact immutable request.",
      );
    }
    return expected;
  }

  return Object.freeze({ generate, verify });
}
