import {
  createDiagramExportService,
  diagramExportResultV1Schema,
  diagramRendererV1Pin,
  diagramRendererSfntV1Pin,
  diagramRendererPinV1Schema,
  type DiagramRendererPinV1,
  type DiagramExportIconSetV1,
  type DiagramExportResultV1,
  type DiagramExportServiceV1,
} from "@cloudmarkup/diagram-export";
import type { ProviderCatalogArtifactV1 } from "@cloudmarkup/provider-sdk";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import {
  sha256Digest,
  solutionExportDiagramV1Schema,
  type SolutionExportDiagramV1,
} from "@cloudmarkup/solution-export";

import type { SolutionExportDiagramRendererPort } from "./ports.js";
import { solutionExportDiagramProfileDigest } from "./diagram-profile.js";
export { solutionExportDiagramProfileDigest } from "./diagram-profile.js";

function abortError(): Error {
  const error = new Error("Diagram rendering was canceled.");
  error.name = "AbortError";
  return error;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function assertStageBinding(
  input: Parameters<SolutionExportDiagramRendererPort["render"]>[0],
  renderer: DiagramRendererPinV1,
): void {
  const expectedProfileId = `cloudmarkup.diagram.${input.request.diagram.profile.kind}`;
  if (
    input.settings.adapter.id !== renderer.id ||
    input.settings.adapter.version !== renderer.version ||
    input.settings.adapter.digest !== renderer.digest ||
    input.settings.profileId !== expectedProfileId ||
    input.settings.profileDigest !==
      solutionExportDiagramProfileDigest(input.request.diagram) ||
    input.settings.limitsDigest !==
      sha256Digest(serializeCanonicalJson(input.request.diagram.output))
  ) {
    throw new TypeError(
      "Diagram renderer settings do not match the exact approved request.",
    );
  }
}

/**
 * Binds the provider-neutral renderer to one reviewed catalog/icon set. The
 * adapter has no browser state, network access, filesystem access, or mutable
 * layout dependency.
 */
export function createSolutionExportDiagramRendererPort(input: {
  readonly catalog: ProviderCatalogArtifactV1;
  readonly iconSet: DiagramExportIconSetV1;
  readonly service?: DiagramExportServiceV1;
  readonly renderer?: DiagramRendererPinV1;
}): SolutionExportDiagramRendererPort {
  const renderer = diagramRendererPinV1Schema.parse(
    input.renderer ?? diagramRendererV1Pin,
  );
  const samePin = (pin: DiagramRendererPinV1) =>
    pin.version === renderer.version && pin.digest === renderer.digest;
  if (
    (!samePin(diagramRendererV1Pin) && !samePin(diagramRendererSfntV1Pin)) ||
    (samePin(diagramRendererSfntV1Pin) && input.service === undefined)
  ) {
    throw new TypeError(
      "An exact successor renderer requires its explicitly admitted service.",
    );
  }
  const service = input.service ?? createDiagramExportService();
  return Object.freeze({
    async render(
      request: Parameters<SolutionExportDiagramRendererPort["render"]>[0],
    ): Promise<DiagramExportResultV1> {
      await Promise.resolve();
      assertNotAborted(request.signal);
      assertStageBinding(request, renderer);
      const generated = service.generate({
        architectureDocument: request.sources.architectureDocument,
        catalog: input.catalog,
        contractVersion: 1,
        iconSet: input.iconSet,
        ...request.request.diagram,
        renderer,
        solutionRevision: request.sources.solutionRevision,
      });
      await Promise.resolve();
      assertNotAborted(request.signal);
      return diagramExportResultV1Schema.parse(generated);
    },
  });
}

/** Converts verified renderer bytes into the exporter's strict content input. */
export function diagramExportForSolutionExport(
  input: DiagramExportResultV1,
): SolutionExportDiagramV1 {
  const result = diagramExportResultV1Schema.parse(input);
  return solutionExportDiagramV1Schema.parse({
    artifact: result.artifact,
    files: result.artifact.files.map(({ path }) => {
      if (path === "diagram/README.md") {
        return { content: { encoding: "utf8", value: result.readme }, path };
      }
      if (path === "diagram/architecture.svg" && result.svg !== undefined) {
        return { content: { encoding: "utf8", value: result.svg }, path };
      }
      if (path === "diagram/architecture.png" && result.png !== undefined) {
        return {
          content: {
            encoding: "base64",
            value: Buffer.from(result.png).toString("base64"),
          },
          path,
        };
      }
      throw new TypeError(
        "Diagram result content does not match its metadata.",
      );
    }),
  });
}
