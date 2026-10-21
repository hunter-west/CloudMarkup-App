import { requireModelLiveRepositoryImporter } from "./model-live-repository-parser-authority.js";
import {
  frozenFullBetaEvaluationDatasetV1,
  fullBetaRepositorySourcesV1,
} from "@cloudmarkup/model-gateway";
import { calculateRepositoryImportSnapshotDigestV1 } from "@cloudmarkup/repository-importer";
import {
  modelRepositoryInterpretationRequestV1Schema,
  modelSolutionPlanningContextV1Schema,
} from "@cloudmarkup/schemas";

/** Exact reviewed source envelope only; parsing, consent and invocation authority are separate. */
export function createProductionModelLiveRepositoryEvidence(caseId: string) {
  requireModelLiveRepositoryImporter("1.0.2");
  const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
    (c) => c.caseId === caseId,
  );
  const source = fullBetaRepositorySourcesV1.find(
    (s) => s.caseKind === evaluationCase?.caseKind,
  );
  if (!source) throw Error("The frozen repository input is unavailable.");
  const lines = source.content.trimEnd().split("\n");
  return modelSolutionPlanningContextV1Schema.shape.approvedRepositoryEvidence
    .unwrap()
    .parse({
      repositorySnapshotId:
        "snapshot_frozen_" + source.caseKind.replaceAll("-", "_"),
      repositorySnapshotDigest: calculateRepositoryImportSnapshotDigestV1({
        files: [{ path: source.path, checksum: source.contentDigest }],
        importedAt: "2026-09-11T00:00:00.000Z",
        commitSha: source.commitSha,
      }),
      commitSha: source.commitSha,
      evidence: [
        {
          evidenceId: source.evidenceId,
          content: source.content,
          fileChecksum: source.contentDigest,
          path: source.path,
          location: {
            startLine: 1,
            startColumn: 1,
            endLine: lines.length,
            endColumn: (lines.at(-1)?.length ?? 0) + 1,
          },
          redaction: {
            categories: [],
            noSecretValues: true,
            status: "not-required",
          },
        },
      ],
    });
}

/** Pure frozen input, with no parser result, operator approval or invocation authority. */
export function createProductionModelLiveRepositoryRequest(input: {
  readonly caseId: string;
  readonly requestedMode: "guided" | "professional";
}) {
  const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
    (c) => c.caseId === input.caseId,
  );
  if (
    evaluationCase?.expected.authorityRequirement.operation !==
    "repository.interpret"
  )
    throw Error("The frozen repository interpretation input is unavailable.");
  return modelRepositoryInterpretationRequestV1Schema.parse({
    contractVersion: 1,
    operation: "repository.interpret",
    requestedMode: input.requestedMode,
    ...createProductionModelLiveRepositoryEvidence(input.caseId),
  });
}
