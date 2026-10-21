import { prepareBetaInfrastructureProposal as prepareSharedProposal } from "@cloudmarkup/provider-aws/proposals";
import { prepareArchitectureLayout } from "../editor/model/architecture-layout.js";
import { separateArchitectureLayout } from "../editor/model/separate-architecture-layout.js";

/** Presentation stays in the web host; semantic commands use the shared engine. */
export function prepareBetaInfrastructureProposal(
  input: Parameters<typeof prepareSharedProposal>[0],
) {
  return prepareSharedProposal({
    ...input,
    prepareLayout: (document) =>
      prepareArchitectureLayout(
        document,
        input.catalog,
        separateArchitectureLayout(
          document,
          input.catalog,
          new Set(input.document.nodes.map((node) => node.id)),
          96,
        ),
        input.createId,
      )?.command ?? null,
  });
}
