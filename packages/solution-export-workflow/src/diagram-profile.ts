import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";
import type { SolutionExportDiagramRendererPort } from "./ports.js";

/** Commits presentation settings without loading the worker's native renderer. */
export function solutionExportDiagramProfileDigest(
  diagram: Parameters<
    SolutionExportDiagramRendererPort["render"]
  >[0]["request"]["diagram"],
) {
  return sha256Digest(
    serializeCanonicalJson({
      layout: {
        algorithm: diagram.layout.algorithm,
        strategy: diagram.layout.strategy,
      },
      profile: {
        includeStableDeploymentIdentifiers:
          diagram.profile.includeStableDeploymentIdentifiers,
        kind: diagram.profile.kind,
      },
      theme: diagram.theme,
    }),
  );
}
