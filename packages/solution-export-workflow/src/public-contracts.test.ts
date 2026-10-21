import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";
import { expect, it } from "vitest";
import * as existing from "./index.js";
import * as contracts from "./public-contracts.js";
import { workflowFixture } from "./workflow.test-support.js";

it("preserves existing contract and diagram-profile identities on the data-only export", () => {
  expect(contracts.solutionExportWorkflowRequestV1Schema).toBe(
    existing.solutionExportWorkflowRequestV1Schema,
  );
  expect(contracts.solutionExportWorkflowRequestDigest).toBe(
    existing.solutionExportWorkflowRequestDigest,
  );
  expect(contracts.solutionExportDiagramProfileDigest).toBe(
    existing.solutionExportDiagramProfileDigest,
  );
  const { request } = workflowFixture();
  const { diagram } = request;
  expect(
    contracts.solutionExportWorkflowRequestV1Schema.parse(request),
  ).toEqual(existing.solutionExportWorkflowRequestV1Schema.parse(request));
  expect(contracts.solutionExportDiagramProfileDigest(diagram)).toBe(
    sha256Digest(
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
    ),
  );
});
