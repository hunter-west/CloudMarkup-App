/** Test-only recipe copied to apps/api/.cache/legacy-ai-capture inside exact committed
 * a979e325. Every relative/package import resolves inside that historical
 * checkout before bundling. This file is never a production entry point. */
import { REPOSITORY_IMPORTER_VERSION } from "@cloudmarkup/repository-importer";
import { frozenFullBetaEvaluationDatasetV1 } from "@cloudmarkup/model-gateway";
import { modelRepositoryInterpretationResponseV1Schema } from "@cloudmarkup/schemas";
import { createLiveHostEvidencePgFixture } from "../../dist/adapters/persistence/model-live-runtime-host-evidence-pg-test-helpers.js";
import { syntheticRepositoryCase } from "../../dist/model-live-repository-test-helpers.js";
import { createProductionModelLiveCaseRequest } from "../../dist/production-model-live-case-request.js";
import { prepareProductionModelLiveProposalValidation } from "../../dist/production-model-live-proposal-validation.js";
import { PostgresModelLiveCommercialAccounting } from "../../dist/adapters/persistence/model-live-commercial-accounting.js";
import { readProductionModelLiveObservationV2 } from "../../dist/production-model-live-observation.js";

export async function captureLegacyRepositoryReceipts({ harness, compiler }) {
  if (REPOSITORY_IMPORTER_VERSION !== "1.0.1")
    throw Error("Exact historical importer required.");
  const captured = [];
  for (const kind of [
    "ambiguous-source-code-inference",
    "external-existing-resource",
  ]) {
    const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
      (c) => c.caseKind === kind,
    );
    if (!evaluationCase) throw Error("Exact frozen historical case required.");
    const repository =
      kind === "ambiguous-source-code-inference"
        ? syntheticRepositoryCase(kind)
        : undefined;
    const request =
      repository?.request ??
      createProductionModelLiveCaseRequest({
        caseId: evaluationCase.caseId,
        requestedMode: "guided",
      });
    const f = await createLiveHostEvidencePgFixture(
      harness,
      "candidate",
      true,
      true,
      "standard",
      { request, caseId: evaluationCase.caseId, fullBeta: true },
    );
    if (repository) {
      const response = modelRepositoryInterpretationResponseV1Schema.parse(
        f.gatewayResult.response,
      );
      response.claims = structuredClone(repository.response.claims);
      response.proposalContext = structuredClone(
        repository.response.proposalContext,
      );
      Object.assign(f.gatewayResult.response, response);
    }
    if (!f.liveRouting || !f.executionInput)
      throw Error("Actual historical input authority required.");
    const host = await prepareProductionModelLiveProposalValidation({
      invocation: f.hostInput.invocation,
      context: f.liveRouting.context,
      execution: f.executionInput,
      allowedApprovalPathIds: [],
      repositoryCompiler: compiler,
    });
    if (!host) throw Error("Historical fixed validator required.");
    await f.complete();
    const authorize = async () => {
      await f.plans.requireCurrent(f.identity);
    };
    const receipt = await host.issue({
      plans: f.plans,
      evidence: f.issuer,
      journal: f.journal,
      result: f.gatewayResult,
      signal: new AbortController().signal,
      authorize,
    });
    const version =
      kind === "ambiguous-source-code-inference" ? "2.6.0" : "2.7.0";
    if (receipt.assessment.validatorVersion !== version)
      throw Error("Original historical receipt was not issued.");
    const accounting = new PostgresModelLiveCommercialAccounting({
      database: f.database,
      scope: f.scope,
      binding: f.binding,
      plans: f.plans,
      ...f.identity,
    });
    const observation = await readProductionModelLiveObservationV2({
      journal: f.journal,
      accounting,
      request: f.record.request,
      admissionRequest: f.runtime.request,
      authorize,
    });
    // Only scoped metadata and observed measurements leave RAM. No request,
    // response, parser source bytes or fabricated receipt are returned.
    captured.push({
      caseId: evaluationCase.caseId,
      validatorVersion: version,
      plan: f.plan,
      principal: f.principal,
      invocationId: f.hostInput.invocation.descriptor.invocationId,
      observation,
    });
  }
  return captured;
}
