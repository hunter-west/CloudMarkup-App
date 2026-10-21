import {
  frozenTypedPlanningFullBetaEvaluationDatasetV1,
  digestStructuredValue,
} from "@cloudmarkup/model-gateway";
import {
  createProductionModelLiveCaseRequest,
  createProductionTypedPlanningModelLiveCaseRequest,
} from "./production-model-live-case-request.js";
import type { ModelProviderInvocationV1 } from "@cloudmarkup/model-gateway";
import type { ModelEvaluationCaseV1 } from "@cloudmarkup/schemas";

/** Check the exact RAM source read from current issued host configuration.
 * Hashing an arbitrary request does not prove that it exercises the frozen case.
 * This is input preparation only, never a quality result or receipt authority.
 * Other families still require their own source builders and actual validators. */
export function requireProductionModelLiveCaseSource(input: {
  readonly evaluationCase: ModelEvaluationCaseV1;
  readonly invocation: Pick<
    ModelProviderInvocationV1,
    "request" | "descriptor"
  >;
}): void {
  const { evaluationCase, invocation } = input;
  const { request, descriptor } = invocation;
  const authority = evaluationCase.expected.authorityRequirement;
  const planning =
    evaluationCase.caseKind === "prompt-injection-and-secrets" ||
    evaluationCase.caseKind === "direct-deployment-credential-request" ||
    evaluationCase.caseKind === "private-vpc-application" ||
    evaluationCase.caseKind === "event-driven-image-processing" ||
    evaluationCase.caseKind === "nonexistent-unsupported-services" ||
    evaluationCase.caseKind === "excessive-resource-request" ||
    evaluationCase.caseKind === "external-existing-resource";
  const intent =
    evaluationCase.caseKind === "vague-conflicting-requirements" &&
    authority.operation === "intent.extract";
  const questions =
    evaluationCase.caseKind === "novice-language-professional-constraints";
  const repository = [
    "deterministic-repository-import",
    "ambiguous-source-code-inference",
    "designed-observed-mismatch",
  ].includes(evaluationCase.caseKind);
  if (!planning && !intent && !questions && !repository)
    throw new Error("The frozen evaluation case validator is unavailable.");
  const content = questions
    ? request.operation === "requirements.blocking-questions"
      ? request.intentDocument.application.summary
      : undefined
    : planning
      ? request.operation === "operations.propose"
        ? request.planningContext?.approvedIntent.application.summary
        : undefined
      : request.operation === "intent.extract"
        ? request.source.content
        : undefined;
  if (
    (!repository && content !== evaluationCase.input.requirements) ||
    request.operation !== authority.operation ||
    descriptor.feature !== authority.operation ||
    descriptor.role !== authority.role ||
    ((repository || evaluationCase.caseId.endsWith("_full_beta_v1")) &&
      digestStructuredValue(request) !==
        digestStructuredValue(
          createProductionModelLiveCaseRequest({
            caseId: evaluationCase.caseId,
            requestedMode: request.requestedMode,
          }),
        ))
  )
    throw new Error(
      "The exact frozen evaluation request source is unavailable.",
    );
}

/** Bind the entire current 1.7.0 case and exact typed request. The caller still
 * needs genuine current host policy, authenticated scope and commercial authority. */
export function requireProductionTypedPlanningModelLiveCaseSource(input: {
  readonly evaluationCase: ModelEvaluationCaseV1;
  readonly invocation: Pick<
    ModelProviderInvocationV1,
    "request" | "descriptor"
  >;
}): void {
  const {
    evaluationCase,
    invocation: { request, descriptor },
  } = input;
  const installed = frozenTypedPlanningFullBetaEvaluationDatasetV1.cases.find(
    (entry) => entry.caseId === evaluationCase.caseId,
  );
  if (
    installed === undefined ||
    digestStructuredValue(installed) !== digestStructuredValue(evaluationCase)
  )
    throw new Error("The typed planning evaluation source is unavailable.");
  const expected = createProductionTypedPlanningModelLiveCaseRequest({
    caseId: installed.caseId,
    requestedMode: request.requestedMode,
  });
  const digest = digestStructuredValue(expected);
  const authority = installed.expected.authorityRequirement;
  if (
    digestStructuredValue(request) !== digest ||
    descriptor.inputDigest !==
      digestStructuredValue({ request: expected, scope: descriptor.scope }) ||
    descriptor.feature !== authority.operation ||
    descriptor.role !== authority.role ||
    descriptor.requestedMode !== request.requestedMode
  )
    throw new Error(
      "The exact typed planning evaluation request source is unavailable.",
    );
}
