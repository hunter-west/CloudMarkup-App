import {
  architectureDocumentV3Schema,
  sha256DigestSchema,
  solutionRevisionManifestV1Schema,
  type ArchitectureDocumentV3,
  type Sha256Digest,
  type SolutionRevisionManifestV1,
} from "@cloudmarkup/schemas";
import { providerCatalogArtifactV1Schema } from "@cloudmarkup/provider-sdk";
import { z } from "zod";

export const DIAGRAM_EXPORT_CONTRACT_VERSION = 1 as const;
export const DIAGRAM_RENDERER_ID = "cloudmarkup.diagram-renderer" as const;
export const DIAGRAM_RENDERER_VERSION = "1.0.0" as const;
export const DIAGRAM_RENDERER_SFNT_VERSION = "1.1.0" as const;
export const DIAGRAM_LAYOUT_ID = "cloudmarkup.diagram-layout" as const;
export const DIAGRAM_LAYOUT_VERSION = "1.0.0" as const;

export const DIAGRAM_EXPORT_LIMITS = Object.freeze({
  maxEdges: 4_000,
  maxHeight: 8_192,
  maxIconBytes: 65_536,
  maxIcons: 2_048,
  maxLabelLength: 256,
  maxNodes: 1_000,
  maxPixels: 32_000_000,
  maxPngBytes: 64 * 1_024 * 1_024,
  maxSvgBytes: 8 * 1_024 * 1_024,
  maxWidth: 8_192,
  minHeight: 320,
  minReadableLabelPixels: 12,
  minWidth: 480,
  warnings: 128,
});

function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}

const stableTextSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) => !hasUnsafeControlCharacter(value),
    "Diagram text must not contain control characters.",
  );

export const diagramRendererPinV1Schema = z
  .object({
    digest: sha256DigestSchema,
    id: z.literal(DIAGRAM_RENDERER_ID),
    version: z.enum([DIAGRAM_RENDERER_VERSION, DIAGRAM_RENDERER_SFNT_VERSION]),
  })
  .strict();

export const diagramIconAssetV1Schema = z
  .object({
    iconId: z.string().min(1).max(256),
    normalizedSha256: sha256DigestSchema,
    svg: z.string().min(1).max(DIAGRAM_EXPORT_LIMITS.maxIconBytes),
    viewBox: z
      .string()
      .regex(/^\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?$/u),
  })
  .strict();

export const diagramIconSetV1Schema = z
  .object({
    assetSet: z
      .object({
        digest: sha256DigestSchema,
        id: z.string().min(1).max(256),
        providerId: z.string().min(1).max(256),
        version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
      })
      .strict(),
    contractVersion: z.literal(1),
    icons: z
      .array(diagramIconAssetV1Schema)
      .max(DIAGRAM_EXPORT_LIMITS.maxIcons),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.icons.forEach((icon, index) => {
      if (ids.has(icon.iconId)) {
        context.addIssue({
          code: "custom",
          message: "Diagram icon IDs must be unique.",
          path: ["icons", index, "iconId"],
        });
      }
      ids.add(icon.iconId);
      const previous = value.icons[index - 1];
      if (previous !== undefined && previous.iconId >= icon.iconId) {
        context.addIssue({
          code: "custom",
          message: "Diagram icons must be uniquely UTF-16 sorted.",
          path: ["icons", index, "iconId"],
        });
      }
    });
  });

export const diagramExportProfileV1Schema = z
  .object({
    architectureTitle: stableTextSchema,
    includeStableDeploymentIdentifiers: z.boolean(),
    kind: z.enum(["presentation", "technical"]),
    projectTitle: stableTextSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.kind === "presentation" &&
      value.includeStableDeploymentIdentifiers
    ) {
      context.addIssue({
        code: "custom",
        message: "Presentation diagrams cannot include deployment identifiers.",
        path: ["includeStableDeploymentIdentifiers"],
      });
    }
  });

export const diagramExportLayoutV1Schema = z
  .object({
    algorithm: z
      .object({
        id: z.literal(DIAGRAM_LAYOUT_ID),
        version: z.literal(DIAGRAM_LAYOUT_VERSION),
      })
      .strict(),
    strategy: z.enum(["deterministic", "saved-positions"]),
  })
  .strict();

export const diagramExportThemeV1Schema = z
  .object({
    background: z.enum(["canvas-light", "opaque-light", "transparent"]),
  })
  .strict();

export const diagramExportOutputV1Schema = z
  .object({
    format: z.enum(["png", "svg", "svg-and-png"]),
    maxHeight: z
      .number()
      .int()
      .min(DIAGRAM_EXPORT_LIMITS.minHeight)
      .max(DIAGRAM_EXPORT_LIMITS.maxHeight),
    maxWidth: z
      .number()
      .int()
      .min(DIAGRAM_EXPORT_LIMITS.minWidth)
      .max(DIAGRAM_EXPORT_LIMITS.maxWidth),
    scale: z.number().int().min(1).max(4),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.maxWidth / value.scale < DIAGRAM_EXPORT_LIMITS.minWidth ||
      value.maxHeight / value.scale < DIAGRAM_EXPORT_LIMITS.minHeight
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Diagram dimensions must retain the minimum readable canvas at the selected scale.",
        path: ["scale"],
      });
    }
    if (value.maxHeight * value.maxWidth > DIAGRAM_EXPORT_LIMITS.maxPixels) {
      context.addIssue({
        code: "custom",
        message: "Diagram output dimensions exceed the pixel budget.",
        path: ["maxWidth"],
      });
    }
  });

export const diagramExportSelectionV1Schema = z
  .object({
    layout: diagramExportLayoutV1Schema,
    output: diagramExportOutputV1Schema,
    profile: diagramExportProfileV1Schema,
    theme: diagramExportThemeV1Schema,
  })
  .strict();

export const diagramExportRequestV1Schema = z
  .object({
    architectureDocument: architectureDocumentV3Schema,
    catalog: providerCatalogArtifactV1Schema,
    contractVersion: z.literal(DIAGRAM_EXPORT_CONTRACT_VERSION),
    iconSet: diagramIconSetV1Schema,
    layout: diagramExportLayoutV1Schema,
    output: diagramExportOutputV1Schema,
    profile: diagramExportProfileV1Schema,
    renderer: diagramRendererPinV1Schema,
    solutionRevision: solutionRevisionManifestV1Schema,
    theme: diagramExportThemeV1Schema,
  })
  .strict();

export const diagramExportWarningV1Schema = z
  .object({
    code: z.string().regex(/^cloudmarkup\.diagram\.[a-z0-9-]+$/u),
    message: z.string().min(1).max(500),
  })
  .strict();

export const diagramExportFileMetadataV1Schema = z
  .object({
    checksum: sha256DigestSchema,
    mediaType: z.enum(["image/png", "image/svg+xml", "text/markdown"]),
    path: z.enum([
      "diagram/README.md",
      "diagram/architecture.png",
      "diagram/architecture.svg",
    ]),
    semanticChecksum: sha256DigestSchema,
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(DIAGRAM_EXPORT_LIMITS.maxPngBytes),
  })
  .strict();

export const diagramExportArtifactV1Schema = z
  .object({
    architecture: z
      .object({
        canonicalHash: sha256DigestSchema,
        contentHash: sha256DigestSchema,
        semanticHash: sha256DigestSchema,
        visualHash: sha256DigestSchema,
      })
      .strict(),
    artifactDigest: sha256DigestSchema,
    catalog: z
      .object({
        digest: sha256DigestSchema,
        id: z.string().min(1).max(256),
        version: z.string().min(1).max(64),
      })
      .strict(),
    contractVersion: z.literal(DIAGRAM_EXPORT_CONTRACT_VERSION),
    dimensions: z
      .object({
        png: z
          .object({
            height: z.number().int().positive(),
            width: z.number().int().positive(),
          })
          .strict()
          .optional(),
        svg: z
          .object({
            height: z.number().int().positive(),
            width: z.number().int().positive(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    evidenceSummary: z
      .object({
        evidenceAtFreezeDigest: sha256DigestSchema,
        evidenceAtFreezeCount: z.number().int().nonnegative(),
        generationCoverageDigest: sha256DigestSchema,
        generationCoverageEvidenceCount: z.number().int().nonnegative(),
      })
      .strict(),
    files: z.array(diagramExportFileMetadataV1Schema).min(2).max(3),
    font: z
      .object({
        family: z.literal("Inter"),
        regularDigest: sha256DigestSchema,
        semiboldDigest: sha256DigestSchema,
        source: z.literal("pinned-local-assets"),
        version: z.literal("5.3.0"),
      })
      .strict(),
    iconSet: diagramIconSetV1Schema.shape.assetSet,
    kind: z.literal("cloudmarkup.diagram-export-artifact"),
    layout: diagramExportLayoutV1Schema,
    profile: diagramExportProfileV1Schema,
    renderer: diagramRendererPinV1Schema,
    sceneDigest: sha256DigestSchema,
    solutionRevision: z
      .object({ digest: sha256DigestSchema, id: z.string().min(1).max(256) })
      .strict(),
    theme: diagramExportThemeV1Schema,
    warnings: z
      .array(diagramExportWarningV1Schema)
      .max(DIAGRAM_EXPORT_LIMITS.warnings),
  })
  .strict();

const diagramBytesV1Schema = z.custom<Uint8Array>(
  (value) => value instanceof Uint8Array,
  "Diagram PNG content must be a Uint8Array.",
);

export const diagramExportResultV1Schema = z
  .object({
    artifact: diagramExportArtifactV1Schema,
    png: diagramBytesV1Schema.optional(),
    readme: z.string().min(1).max(DIAGRAM_EXPORT_LIMITS.maxSvgBytes),
    svg: z.string().min(1).max(DIAGRAM_EXPORT_LIMITS.maxSvgBytes).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const paths = new Set(value.artifact.files.map(({ path }) => path));
    if (
      !paths.has("diagram/README.md") ||
      paths.has("diagram/architecture.svg") !== (value.svg !== undefined) ||
      paths.has("diagram/architecture.png") !== (value.png !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Diagram result bytes must exactly match its file metadata.",
        path: ["artifact", "files"],
      });
    }
  });

export type DiagramExportArtifactV1 = z.output<
  typeof diagramExportArtifactV1Schema
>;
export type DiagramExportIconSetV1 = z.output<typeof diagramIconSetV1Schema>;
export type DiagramExportFileMetadataV1 = z.output<
  typeof diagramExportFileMetadataV1Schema
>;
export type DiagramExportRequestV1 = z.output<
  typeof diagramExportRequestV1Schema
>;
export type DiagramExportSelectionV1 = z.output<
  typeof diagramExportSelectionV1Schema
>;
export type DiagramExportWarningV1 = z.output<
  typeof diagramExportWarningV1Schema
>;
export type DiagramRendererPinV1 = z.output<typeof diagramRendererPinV1Schema>;

export type DiagramExportResultV1 = z.output<
  typeof diagramExportResultV1Schema
>;

export interface ParsedDiagramExportInputV1 {
  readonly architectureDocument: ArchitectureDocumentV3;
  readonly solutionRevision: SolutionRevisionManifestV1;
}

export type DiagramSha256Digest = Sha256Digest;
