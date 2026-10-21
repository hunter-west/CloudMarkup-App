import {
  digestCanonicalValue,
  modelLiveEvaluationScopeV2Schema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { inspectApplicationHostRepairSeedRequestV1 } from "@cloudmarkup/application-build-runner/host-repair-seed";
import { hostExecutionFixture } from "../../production-model-live-repair-seed-execution-fixture.js";
import { bindProductionRepairSeedCaseV1 } from "../../production-model-live-repair-seed-source.js";
// Synthetic metadata only; no tools execute and no authenticated receipt is issued.
export function syntheticSeedValidationBody() {
  const fixture = hostExecutionFixture(true);
  const binding = bindProductionRepairSeedCaseV1(
    "evaluation_case_repair_success_full_beta_v1",
  );
  const scope = modelLiveEvaluationScopeV2Schema.parse({
    organizationId: "organization_seed_test",
    projectId: "project_seed_test",
    userId: "principal_seed_test",
    environment: "development",
    plan: "pro",
  });
  return {
    contractVersion: 1 as const,
    recordKind: "model-live-seed-validation-receipt" as const,
    scope,
    operatorUserId: scope.userId,
    caseId: binding.caseId,
    caseDigest: binding.caseDigest,
    frozenInputDigest: binding.frozenInputDigest,
    datasetDigest: binding.dataset.datasetDigest,
    recipeId: fixture.source.recipe.id,
    recipeVersion: fixture.source.recipe.version,
    sourceAuthority: "fixed-host-synthetic" as const,
    variant: "invalid-seed" as const,
    disposition: "invalid-repairable" as const,
    observedDefect: "TS2322" as const,
    cleanup: "verified" as const,
    startedAt: utcTimestampSchema.parse("2026-09-14T12:00:00.000Z"),
    completedAt: utcTimestampSchema.parse("2026-09-14T12:00:20.000Z"),
    issuedAt: utcTimestampSchema.parse("2026-09-14T12:00:21.000Z"),
    ownershipDigest: digestCanonicalValue(
      fixture.request.solutionRevision.sourceOwnership,
    ),
    configurationDigest: digestCanonicalValue({
      policy: fixture.config.policy,
      helper: fixture.config.helperDigest,
    }),
    profileDigest: fixture.config.policy.profile.digest,
    toolchainDigest: digestCanonicalValue(fixture.config.policy.toolchain),
    builderDigest: fixture.config.policy.builder.digest,
    scannerDigest: fixture.config.policy.scanner.digest,
    bindings: inspectApplicationHostRepairSeedRequestV1(
      fixture.request,
      fixture.config,
    ).bindings,
    reportDigest: digestCanonicalValue("synthetic-result-no-tool-execution"),
  };
}
