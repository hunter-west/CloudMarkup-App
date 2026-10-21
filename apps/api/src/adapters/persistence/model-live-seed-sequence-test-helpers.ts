import { randomUUID } from "node:crypto";
import { syntheticSequenceFixtureV3 } from "@cloudmarkup/model-gateway/testing";
import {
  digestCanonicalValue,
  modelLiveSequenceDefinitionV3Schema,
} from "@cloudmarkup/schemas";
import type { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import {
  createSeedValidationPgFixture,
  type SeedValidationAdapterOverrides,
} from "./model-live-seed-validation-pg-test-helpers.js";
import type { ModelLiveSequenceConfigurationV3 } from "./model-live-sequences.js";
import { sql } from "./sql.js";
const hash = <T extends object>(value: T, key: string): T => ({
  ...value,
  [key]: digestCanonicalValue(
    Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)),
  ),
});
/** Shared synthetic seed/sequence fixture; no real identity or tool proof. */
export function createSeedBoundSequencePgFixture(
  harness: ReturnType<typeof createModelAccountingPgTestHarness>,
) {
  const seedFixture = createSeedValidationPgFixture(harness);
  return async function fixture() {
    const f = await seedFixture();
    const template = syntheticSequenceFixtureV3({
      ...f.scope,
      now: f.principal.authenticatedAt,
      definitionId: "definition_" + randomUUID().replaceAll("-", ""),
    });
    const definitionState = {
      definition: template.definition,
      available: true,
    };
    const configuration: ModelLiveSequenceConfigurationV3 = {
      ...f.config,
      resolveDefinition: (definitionId) =>
        Promise.resolve(
          definitionState.available &&
            definitionId === definitionState.definition.definitionId
            ? {
                definition: definitionState.definition,
                dataset: template.dataset,
                policy: template.policy,
              }
            : null,
        ),
    };
    const make = (overrides: SeedValidationAdapterOverrides = {}) =>
      f.make({ configuration, ...overrides });
    const adapter = make();
    const approval = () => ({
      definitionId: definitionState.definition.definitionId,
      expectedDefinitionDigest: definitionState.definition.definitionDigest,
    });
    const seeds = async (count = template.definition.cases.length) => {
      const receipts: Awaited<ReturnType<typeof adapter.validateSeed>>[] = [];
      for (const entry of template.definition.cases.slice(0, count))
        receipts.push(await adapter.validateSeed(entry.caseId));
      definitionState.definition = modelLiveSequenceDefinitionV3Schema.parse(
        hash(
          {
            ...template.definition,
            cases: template.definition.cases.map((entry, index) => {
              const receipt = receipts[index];
              if (!receipt) return entry;
              return {
                ...entry,
                seed: {
                  sourceDigest: receipt.bindings.baselineSourceDigest,
                  revisionDigest: receipt.bindings.solutionRevisionDigest,
                  candidateDigest: receipt.bindings.sourceTreeDigest,
                  ownershipDigest: receipt.ownershipDigest,
                  validationReceiptDigest: receipt.receiptDigest,
                  validatorPolicyDigest: receipt.bindings.policyDigest,
                },
              };
            }),
          },
          "definitionDigest",
        ),
      );
      return receipts;
    };
    const issue = async () => {
      const receipts = await seeds();
      const plan = await adapter.approve(approval());
      const reference = {
        definitionId: plan.definition.definitionId,
        planDigest: plan.planDigest,
      };
      return { receipts, plan, reference };
    };
    const stored = async () => {
      const result = await harness.database.query(
        sql(
          "SELECT (SELECT count(*)::int FROM model_live_sequence_plans WHERE organization_id=$1) AS plans, (SELECT count(*)::int FROM model_live_sequence_selections WHERE organization_id=$1) AS selections, (SELECT count(*)::int FROM model_live_sequence_revocations WHERE organization_id=$1) AS revocations",
          [f.scope.organizationId],
        ),
      );
      return result.rows[0];
    };
    return {
      ...f,
      template,
      definitionState,
      configuration,
      make,
      adapter,
      approval,
      seeds,
      issue,
      stored,
    };
  };
}
