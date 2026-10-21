import {
  createReviewedCustomerCiRepositoryWorkflowsV1,
  customerCiWorkflowConfigV1Schema,
  generateCustomerCiWorkflowSetV1,
  validateCustomerCiWorkflowSetV1,
} from "@cloudmarkup/customer-ci-workflow";
import {
  localSolutionExportService,
  solutionExportRequestV1Schema,
} from "@cloudmarkup/solution-export";
import {
  diagramExportForSolutionExport,
  solutionExportRepositoryWorkflowReviewV1Schema,
  type SolutionExportPackagerPort,
} from "@cloudmarkup/solution-export-workflow";

type SolutionExportPackageInput = Parameters<
  SolutionExportPackagerPort["package"]
>[0];

function packageRequest(
  input: SolutionExportPackageInput,
  reviewedRepositoryWorkflows?: ReturnType<
    typeof createReviewedCustomerCiRepositoryWorkflowsV1
  >,
) {
  return solutionExportRequestV1Schema.parse({
    architectureDocument: input.sources.architectureDocument,
    diagram: diagramExportForSolutionExport(input.diagram),
    ...(input.application === undefined
      ? {}
      : { application: input.application }),
    contractVersion: 1,
    existingFiles: input.sources.existingFiles ?? [],
    externalStageStatus: input.externalStageStatus,
    infrastructure: input.infrastructure,
    ...(reviewedRepositoryWorkflows === undefined
      ? {}
      : { reviewedRepositoryWorkflows }),
    solutionRevision: input.sources.solutionRevision,
    supplementalFiles: input.supplementalFiles,
    target: {
      exportName: input.request.exportName,
      limits: input.request.targetSettings.limits,
      policyPacks: input.request.targetSettings.policyPacks,
      renderer: input.request.targetSettings.renderer,
      target: input.request.targetSettings.target,
    },
  });
}

export function createSolutionExportPackager(): SolutionExportPackagerPort {
  return {
    package(input) {
      const baseRequest = packageRequest(input);
      const base = localSolutionExportService.generate(baseRequest);
      const source = input.sources.repositoryWorkflowReview;
      if (source === undefined) return Promise.resolve(base);

      try {
        const review =
          solutionExportRepositoryWorkflowReviewV1Schema.parse(source);
        if (
          review.solutionRevision.id !==
            input.request.subject.solutionRevisionId ||
          review.solutionRevision.digest !==
            input.request.subject.manifestDigest
        ) {
          throw new TypeError(
            "Repository-workflow review does not match the immutable Solution Revision.",
          );
        }
        if (review.decision === "denied" || base.state !== "ready") {
          return Promise.resolve(base);
        }

        const config = customerCiWorkflowConfigV1Schema.parse(
          review.configuration,
        );
        if (
          config.solutionRevision.id !== review.solutionRevision.id ||
          config.solutionRevision.digest !== review.solutionRevision.digest
        ) {
          throw new TypeError(
            "Approved workflow configuration does not match its reviewed Solution Revision.",
          );
        }
        const result = generateCustomerCiWorkflowSetV1(config);
        const validation = validateCustomerCiWorkflowSetV1(config, result);
        if (!validation.valid) {
          throw new TypeError(
            "Approved workflow generation did not pass deterministic validation.",
          );
        }
        const reviewedRepositoryWorkflows =
          createReviewedCustomerCiRepositoryWorkflowsV1({
            config,
            packageFiles: base.artifact.manifest.files.map(
              ({ checksum, path }) => ({ checksum, path }),
            ),
            result,
          });
        return Promise.resolve(
          localSolutionExportService.generate(
            packageRequest(input, reviewedRepositoryWorkflows),
          ),
        );
      } catch {
        // Reviewed configuration is immutable untrusted data. Any parse,
        // lineage, generation, validation, or sealing failure is permanent and
        // returns only the exporter’s bounded public invalid-request diagnostic.
        return Promise.resolve(localSolutionExportService.generate({}));
      }
    },
  };
}
