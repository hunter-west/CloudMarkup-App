import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  createDiagramIconSetV1,
  diagramRendererSfntV1Pin,
  DIAGRAM_SFNT_FONT_SOURCE,
  createSfntResvgDiagramRasterizer,
  createSfntDiagramExportService,
} from "@cloudmarkup/diagram-export";
import { awsCatalogArtifactV1 } from "@cloudmarkup/provider-aws/catalog";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import {
  exactToolPinV1Schema,
  sha256Digest,
} from "@cloudmarkup/solution-export";
import {
  SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS,
  solutionExportCompilerArgs,
  type createSolutionExportDiagramRendererPort,
} from "@cloudmarkup/solution-export-workflow";
import {
  solutionExportDiagramProfileDigest,
  solutionExportWorkflowTargetSettingsDigest,
  solutionExportWorkflowTargetSettingsProjectionV1Schema,
  solutionExportWorkflowTargetSettingsV1Schema,
  type SolutionExportWorkflowTargetSettingsV1,
} from "@cloudmarkup/solution-export-workflow/contracts";
import { z } from "zod";

import type { ProductionSolutionExportEnvironment } from "./production-solution-export-environment.js";

const digest = (value: unknown) => sha256Digest(serializeCanonicalJson(value));
const pin = (id: string, descriptor: unknown) =>
  exactToolPinV1Schema.parse({
    id,
    version: "1.0.0",
    digest: digest(descriptor),
  });

export const PRODUCTION_SOLUTION_EXPORT_LIMITS = Object.freeze({
  maxArchiveBytes: 4 * 1024 * 1024,
  maxDecompressedBytes: 8 * 1024 * 1024,
  maxFileBytes: 4 * 1024 * 1024,
  maxFiles: 512,
  maxPathBytes: 200,
});

/** This descriptor identifies the implemented denial adapter, not an available
 * application generator, package builder, dependency set, or runtime. */
const unavailable = Object.freeze({
  contractVersion: 1,
  state: "unavailable",
  failure: "cloudmarkup.export.host-stage-unavailable",
  execution: "deny",
});
const unavailablePin = pin("cloudmarkup.export.unavailable-stage", unavailable);
const unavailableStage = {
  adapter: unavailablePin,
  limitsDigest: digest({ executions: 0 }),
  profileDigest: digest(unavailable),
  profileId: "cloudmarkup.export.unavailable-stage",
};
const defaultDiagram = {
  layout: {
    algorithm: { id: "cloudmarkup.diagram-layout", version: "1.0.0" },
    strategy: "deterministic",
  },
  output: { format: "svg-and-png", maxHeight: 4096, maxWidth: 4096, scale: 2 },
  profile: {
    architectureTitle: "Immutable solution architecture",
    includeStableDeploymentIdentifiers: false,
    kind: "presentation",
    projectTitle: "CloudFormation export",
  },
  theme: { background: "opaque-light" },
} as const;
const validation = Object.freeze({
  contractVersion: 1,
  localValidation: "cloudmarkup-structured-template-v1",
  templateFormat: "json",
  templateSpecificationVersion: "2010-09-09",
  checks: [
    "artifact-checksum",
    "one-template",
    "json-object",
    "resources-object",
    "outputs-object",
    "parameters-object",
  ],
  network: "deny",
  cloudDeployment: "deny",
});
const exporter = Object.freeze({
  contractVersion: 1,
  implementation: "cloudmarkup.solution-export",
  archive: "deterministic-zip",
  epoch: "1980-01-01T00:00:00.000Z",
  target: "cloudformation",
  applicationExecution: "deny",
  download: "buffered",
  limits: PRODUCTION_SOLUTION_EXPORT_LIMITS,
});

/** Source-defined policy plus the exact packaged compiler/icon bytes. Diagram
 * choices are subsequently bound by the existing request admission boundary. */
export function createProductionSolutionExportTargetSettings(assets: {
  readonly compilerExecutableSha256: string;
  readonly iconBundleSha256: string;
}): SolutionExportWorkflowTargetSettingsV1 {
  for (const value of Object.values(assets)) {
    if (!/^[a-f0-9]{64}$/u.test(value))
      throw new TypeError("Export assets need exact SHA-256 pins.");
  }
  const compilerDescriptor = {
    id: "cloudmarkup.iac-compiler",
    version: "1.2.1",
  };
  const exporterPin = pin("cloudmarkup.solution-export", exporter);
  const projection =
    solutionExportWorkflowTargetSettingsProjectionV1Schema.parse({
      contractVersion: 1,
      limits: PRODUCTION_SOLUTION_EXPORT_LIMITS,
      policyPacks: [],
      renderer: exporterPin,
      target: "cloudformation",
      stageDescriptors: {
        applicationBuild: {
          ...unavailableStage,
          dependencyContractDigest: digest([]),
          toolchainDigest: digest([]),
        },
        applicationGenerator: {
          ...unavailableStage,
          pattern: unavailablePin,
          template: unavailablePin,
          runtime: {
            ...unavailablePin,
            handler: "unavailable",
            languageFamily: "cloudmarkup.unavailable",
            moduleFormat: "esm",
            runtime: "unavailable",
            runtimeFamily: "cloudmarkup.unavailable",
          },
        },
        compiler: {
          adapter: {
            ...compilerDescriptor,
            digest: sha256Digest(JSON.stringify(compilerDescriptor)),
          },
          limitsDigest: digest(SOLUTION_EXPORT_COMPILER_COMMAND_LIMITS),
          profileId: "cloudmarkup.compiler.cloudformation",
          profileDigest: digest({
            args: solutionExportCompilerArgs("cloudformation"),
            executableSha256: assets.compilerExecutableSha256,
            implementationModes: ["infrastructure-only"],
            network: "deny",
            target: "cloudformation",
          }),
        },
        diagramRenderer: {
          adapter: diagramRendererSfntV1Pin,
          limitsDigest: digest(defaultDiagram.output),
          profileDigest: solutionExportDiagramProfileDigest(defaultDiagram),
          profileId: "cloudmarkup.diagram.presentation",
        },
        exporter: {
          adapter: exporterPin,
          limitsDigest: digest(PRODUCTION_SOLUTION_EXPORT_LIMITS),
          profileDigest: digest({
            ...exporter,
            catalogDigest: awsCatalogArtifactV1.digest,
            iconBundleSha256: assets.iconBundleSha256,
          }),
          profileId: "cloudmarkup.export.cloudformation",
        },
        cloudFormationValidation: {
          adapter: pin(
            "cloudmarkup.cloudformation-structured-validator",
            validation,
          ),
          limitsDigest: digest({
            maxTemplates: 1,
            maxResources: 10000,
            maxFileBytes: PRODUCTION_SOLUTION_EXPORT_LIMITS.maxFileBytes,
          }),
          profileDigest: digest(validation),
          profileId: "cloudmarkup.validation.cloudformation",
        },
      },
    });
  return solutionExportWorkflowTargetSettingsV1Schema.parse({
    ...projection,
    digest: solutionExportWorkflowTargetSettingsDigest(projection),
  });
}

export const productionSolutionExportIconBundleSchema = z
  .object({
    contractVersion: z.literal(1),
    catalogDigest: z.literal(awsCatalogArtifactV1.digest),
    manifest: z.unknown(),
    assetsByFile: z.record(
      z.string().regex(/^[a-z0-9][a-z0-9.-]{0,95}\.svg$/u),
      z.string().max(65536),
    ),
  })
  .strict();

async function verifiedBytes(
  path: string,
  expected: string,
  maximum: number,
): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/u.test(expected))
    throw new TypeError("Export asset pin is invalid.");
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > maximum)
      throw new TypeError("Export asset exceeds the admitted file boundary.");
    const bytes = await file.readFile();
    if (
      bytes.byteLength !== stat.size ||
      createHash("sha256").update(bytes).digest("hex") !== expected
    )
      throw new TypeError(
        "Export asset bytes do not match their approved pin.",
      );
    return bytes;
  } finally {
    await file.close();
  }
}

export async function loadProductionSolutionExportProfile(
  config: Pick<
    ProductionSolutionExportEnvironment,
    "compiler" | "iconBundlePath" | "iconBundleSha256" | "targetSettingsDigest"
  >,
): Promise<{
  targetSettings: SolutionExportWorkflowTargetSettingsV1;
  diagram: Pick<
    Parameters<typeof createSolutionExportDiagramRendererPort>[0],
    "catalog" | "iconSet" | "renderer" | "service"
  >;
}> {
  const targetSettings = createProductionSolutionExportTargetSettings({
    compilerExecutableSha256: config.compiler.executableSha256,
    iconBundleSha256: config.iconBundleSha256,
  });
  if (targetSettings.digest !== config.targetSettingsDigest)
    throw new TypeError(
      "Export settings do not match the source-approved profile.",
    );
  await verifiedBytes(
    config.compiler.executablePath,
    config.compiler.executableSha256,
    64 * 1024 * 1024,
  );
  const bytes = await verifiedBytes(
    config.iconBundlePath,
    config.iconBundleSha256,
    4 * 1024 * 1024,
  );
  const bundle = productionSolutionExportIconBundleSchema.parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
  const iconSet = createDiagramIconSetV1({
    ...bundle,
    catalog: awsCatalogArtifactV1,
  });
  const fonts = [
    DIAGRAM_SFNT_FONT_SOURCE.regular,
    DIAGRAM_SFNT_FONT_SOURCE.semibold,
  ] as const;
  const fontPaths = fonts.map((font) =>
    join(dirname(config.iconBundlePath), "fonts", font.outputFile),
  );
  for (const [index, font] of fonts.entries())
    await verifiedBytes(
      fontPaths[index] ?? "",
      font.outputSha256,
      font.outputSizeBytes,
    );
  const rasterizer = createSfntResvgDiagramRasterizer([
    fontPaths[0] ?? "",
    fontPaths[1] ?? "",
  ]);
  return {
    targetSettings,
    diagram: {
      catalog: awsCatalogArtifactV1,
      iconSet,
      renderer: diagramRendererSfntV1Pin,
      service: createSfntDiagramExportService({ rasterizer }),
    },
  };
}
