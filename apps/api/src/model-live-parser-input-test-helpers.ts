import {
  digestStructuredValue,
  fullBetaRepositorySourcesV1,
} from "@cloudmarkup/model-gateway";
import { prepareModelLiveRepositoryInput } from "./model-live-repository-input.js";
import { createModelLiveRepositoryParserAuthority } from "./model-live-repository-parser-authority.js";
import { identifyModelLiveParserInputReceipt } from "./adapters/persistence/model-live-parser-input-codec.js";
import type { PinnedCompilerConfiguration } from "./adapters/pinned-go-executable.js";
import type { syntheticRepositoryCase } from "./model-live-repository-test-helpers.js";

/** Pure assessor test metadata around an actual parser run. Synthetic plan and
 * receipt identifiers never represent SQL issuance, provider execution or
 * settlement authority; separate PostgreSQL cases exercise the real issuer. */
export async function actualRepositoryParserMetadataFixture(
  sample: ReturnType<typeof syntheticRepositoryCase>,
  compiler: PinnedCompilerConfiguration,
) {
  const source = fullBetaRepositorySourcesV1.find(
    (entry) => entry.caseKind === sample.evaluationCase.caseKind,
  );
  if (!source || !sample.descriptor.scope.projectId)
    throw Error("Missing synthetic parser input");
  const parsed = await prepareModelLiveRepositoryInput({
    caseKind: source.caseKind,
    compiler,
  });
  const repositoryParser = createModelLiveRepositoryParserAuthority({
    result: parsed.result,
    expectedSnapshotDigest: sample.request.repositorySnapshotDigest,
    compiler,
  });
  const syntheticDigest = digestStructuredValue(
    "synthetic parser metadata only",
  );
  return identifyModelLiveParserInputReceipt({
    contractVersion: 1,
    recordKind: "model-live-parser-input-receipt",
    organizationId: sample.descriptor.scope.organizationId,
    projectId: sample.descriptor.scope.projectId,
    userId: sample.descriptor.scope.userId,
    invocationId: sample.descriptor.invocationId,
    invocationScopeDigest: digestStructuredValue(sample.descriptor.scope),
    invocationDigest: syntheticDigest,
    descriptorDigest: digestStructuredValue(sample.descriptor),
    requestDigest: digestStructuredValue(sample.request),
    runtimeRequestDigest: syntheticDigest,
    planDigest: syntheticDigest,
    approvalDigest: syntheticDigest,
    caseId: sample.evaluationCase.caseId,
    caseDigest: sample.evaluationCase.caseDigest,
    sourceInputDigest: digestStructuredValue(sample.evaluationCase.input),
    inputDigest: sample.descriptor.inputDigest,
    inputEvidenceId: "evidence_" + syntheticDigest.slice(7),
    inputEvidenceDigest: syntheticDigest,
    repositoryParser,
  });
}
