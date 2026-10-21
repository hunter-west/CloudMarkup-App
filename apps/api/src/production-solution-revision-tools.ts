import type { ProductionSolutionExportEnvironment } from "./production-solution-export-environment.js";
import {
  solutionRevisionToolSelectionsV1Schema,
  type SolutionRevisionToolSelectionsV1,
} from "./application/solution-revision-builder.js";

/** Lazily verify packaged tools at new freeze; no compiler or renderer is run. */
export function createProductionSolutionRevisionToolSelector(
  config: ProductionSolutionExportEnvironment,
): () => Promise<SolutionRevisionToolSelectionsV1> {
  let selected: Promise<SolutionRevisionToolSelectionsV1> | undefined;
  return async () => {
    selected ??= import("./production-solution-export-profile.js").then(
      async ({ loadProductionSolutionExportProfile }) => {
        const profile = await loadProductionSolutionExportProfile(config);
        return solutionRevisionToolSelectionsV1Schema.parse({
          compiler: {
            state: "pinned",
            tool: profile.targetSettings.stageDescriptors.compiler.adapter,
          },
          diagramRenderer: {
            state: "pinned",
            tool: profile.targetSettings.stageDescriptors.diagramRenderer
              .adapter,
          },
        });
      },
    );
    return solutionRevisionToolSelectionsV1Schema.parse(await selected);
  };
}
