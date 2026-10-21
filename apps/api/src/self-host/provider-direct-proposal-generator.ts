import type { SelfHostModelComposition } from "./model-composition.js";
import type { ProviderDirectProposalExecutionV1 } from "../beta-infrastructure-worker.js";
import { createBetaInfrastructureApplication } from "../application/beta-infrastructure.js";
/** Concrete architecture callback: the verified running root supplies D's
 * scope, and the existing application retains baseline/result admission. */
export function createProviderDirectProposalGenerator(options: {
  readonly models: SelfHostModelComposition;
  readonly preparer: NonNullable<
    Parameters<typeof createBetaInfrastructureApplication>[0]["applicability"]
  >["preparer"];
}) {
  return (execution: ProviderDirectProposalExecutionV1) =>
    options.models.runForVerifiedAttempt(
      "architecture",
      execution,
      async (models, signal) => {
        const application = createBetaInfrastructureApplication({
          model: models.architecture,
          applicability: {
            preparer: options.preparer,
            readBaseline: execution.baselineReader,
          },
        });
        return application.generate(
          execution.input,
          signal,
          execution.assertCurrent,
          180_000,
          undefined,
          execution.baselineReader,
        );
      },
    );
}
