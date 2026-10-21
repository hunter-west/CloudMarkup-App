import {
  applicationBuildRequestDigest,
  applicationLambdaArtifactManifestV1Schema,
  applicationBuildRequestV1Schema,
  applicationBuildResultV1Schema,
  type ApplicationBuildRequestV1,
  type ApplicationBuildRunner,
  type ApplicationBuildResultV1,
} from "@cloudmarkup/application-build-runner";
import {
  serializeCanonicalJson,
  solutionRevisionManifestV1Schema,
  type Prompt32ABuildArtifactEnvelopeV1,
} from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";

import {
  solutionExportApplicationBuildBatchInputV1Schema,
  solutionExportApplicationBuildBatchReportDigest,
  solutionExportApplicationBuildBatchResultV1Schema,
  solutionExportWorkflowFailureV1Schema,
  solutionExportWorkflowRequestV1Schema,
  solutionExportWorkflowStageDescriptorsV1Schema,
  type SolutionExportApplicationBuildBatchResultV1,
  type SolutionExportWorkflowStageDescriptorsV1,
} from "./contracts.js";
import {
  canonicalEqual,
  resolvedJsonMatchesReference,
} from "./canonical-json.js";
import { SolutionExportWorkflowFailureError } from "./orchestrator.js";
import type { SolutionExportApplicationBuildPort } from "./ports.js";

export interface SolutionExportApplicationBuildPortDependencies {
  readonly approvedSettings: SolutionExportWorkflowStageDescriptorsV1["applicationBuild"];
  readonly runner: ApplicationBuildRunner;
}

function failure(
  code: string,
  publicMessage:
    "export-build-failed" | "export-input-invalid" = "export-input-invalid",
): SolutionExportWorkflowFailureError {
  return new SolutionExportWorkflowFailureError(
    solutionExportWorkflowFailureV1Schema.parse({
      classification: "permanent",
      code,
      publicMessage,
      stage: "build-application",
    }),
  );
}

function abortError(): Error {
  const error = new Error("Application build was canceled.");
  error.name = "AbortError";
  return error;
}

function canonicalDigest(value: unknown): string {
  return sha256Digest(serializeCanonicalJson(value));
}

function expectedGeneratedInputState(
  envelope: Prompt32ABuildArtifactEnvelopeV1,
  state:
    | ApplicationBuildResultV1["coverage"]["inputState"]
    | "infrastructure-only"
    | "target-unsupported"
    | undefined,
): ApplicationBuildResultV1["coverage"]["inputState"] {
  if (
    state === "complete-supported-pattern" ||
    (state === "starter-application" &&
      envelope.contract.implementationMode === "complete-supported-pattern")
  ) {
    return "complete-supported-pattern";
  }
  return state === "starter-application"
    ? "starter-application"
    : "custom-implementation-required";
}

function passingArtifactsMatchEnvelope(
  result: ApplicationBuildResultV1,
  envelope: Prompt32ABuildArtifactEnvelopeV1,
): boolean {
  if (result.state !== "passed") return true;
  const zip = result.artifacts.find(
    ({ mediaType }) => mediaType === "application/zip",
  );
  const manifestArtifact = result.artifacts.find(
    ({ mediaType }) => mediaType === "application/json",
  );
  if (zip === undefined || manifestArtifact === undefined) return false;
  try {
    const manifest = applicationLambdaArtifactManifestV1Schema.parse(
      JSON.parse(
        Buffer.from(manifestArtifact.bytesBase64, "base64").toString("utf8"),
      ) as unknown,
    );
    return (
      zip.path === envelope.contract.expectedArtifact.path &&
      zip.mediaType === envelope.contract.expectedArtifact.mediaType &&
      zip.provenance.buildContractDigest === envelope.contractDigest &&
      manifest.bindings.buildContractDigest === envelope.contractDigest &&
      canonicalEqual(manifest.artifact, {
        ...envelope.contract.expectedArtifact,
        checksum: zip.checksum,
      }) &&
      canonicalEqual(manifest.runtime, envelope.contract.runtime) &&
      manifest.entrypoint === envelope.contract.entrypoint &&
      manifest.compiledEntrypoint === envelope.contract.compiledEntrypoint
    );
  } catch {
    return false;
  }
}

/**
 * Accept only a complete, content-addressed application-build request whose generated
 * source and immutable revision exactly equal the preceding workflow stages.
 */
export function applicationBuildRequestFromWorkflowInput(
  input: Parameters<SolutionExportApplicationBuildPort["build"]>[0],
  approvedSettings: SolutionExportWorkflowStageDescriptorsV1["applicationBuild"],
  candidate: unknown = input.sources.applicationBuildInputs,
  resolvedReferenceValue: unknown = candidate,
): ApplicationBuildRequestV1 {
  const parsedWorkflowRequest = solutionExportWorkflowRequestV1Schema.safeParse(
    input.request,
  );
  const parsedSettings =
    solutionExportWorkflowStageDescriptorsV1Schema.shape.applicationBuild.safeParse(
      input.settings,
    );
  const parsedApprovedSettings =
    solutionExportWorkflowStageDescriptorsV1Schema.shape.applicationBuild.safeParse(
      approvedSettings,
    );
  const parsedBuildRequest =
    applicationBuildRequestV1Schema.safeParse(candidate);
  const parsedSolutionRevision = solutionRevisionManifestV1Schema.safeParse(
    input.sources.solutionRevision,
  );
  if (
    !parsedWorkflowRequest.success ||
    !parsedSettings.success ||
    !parsedApprovedSettings.success ||
    !parsedBuildRequest.success ||
    !parsedSolutionRevision.success
  ) {
    throw failure("cloudmarkup.export.build-input-invalid");
  }

  const workflowRequest = parsedWorkflowRequest.data;
  const settings = parsedSettings.data;
  const buildRequest = parsedBuildRequest.data;
  const solutionRevision = parsedSolutionRevision.data;
  const buildInputReference = workflowRequest.sources.applicationBuildInputs;
  if (
    buildInputReference === undefined ||
    !resolvedJsonMatchesReference(
      resolvedReferenceValue,
      buildInputReference,
    ) ||
    !resolvedJsonMatchesReference(
      solutionRevision,
      workflowRequest.sources.solutionRevision,
    ) ||
    !canonicalEqual(settings, parsedApprovedSettings.data) ||
    !canonicalEqual(
      settings,
      workflowRequest.targetSettings.stageDescriptors.applicationBuild,
    ) ||
    solutionRevision.solutionRevisionId !==
      workflowRequest.subject.solutionRevisionId ||
    !canonicalEqual(buildRequest.solutionRevision, solutionRevision) ||
    !canonicalEqual(buildRequest.environment, workflowRequest.environment) ||
    buildRequest.solutionRevisionDigest !== canonicalDigest(solutionRevision)
  ) {
    throw failure("cloudmarkup.export.build-input-binding-invalid");
  }

  if (
    buildRequest.source.kind !== "generated" ||
    !canonicalEqual(buildRequest.source.applicationGeneration, input.generation)
  ) {
    throw failure("cloudmarkup.export.build-input-binding-invalid");
  }
  const generatedSource = buildRequest.source;

  const buildEnvelope = input.generation.artifact.buildContracts.find(
    ({ contractDigest }) =>
      contractDigest === generatedSource.buildContractDigest,
  );
  if (
    buildEnvelope === undefined ||
    settings.profileId !== buildRequest.profile.id ||
    settings.profileDigest !== buildRequest.profile.digest ||
    settings.limitsDigest !== canonicalDigest(buildRequest.limits) ||
    settings.dependencyContractDigest !==
      canonicalDigest(buildEnvelope.contract.dependencies) ||
    settings.toolchainDigest !==
      canonicalDigest(buildEnvelope.contract.toolchain)
  ) {
    throw failure("cloudmarkup.export.build-settings-binding-invalid");
  }

  return buildRequest;
}

export function applicationBuildRequestsFromWorkflowInput(
  input: Parameters<SolutionExportApplicationBuildPort["build"]>[0],
  approvedSettings: SolutionExportWorkflowStageDescriptorsV1["applicationBuild"],
): readonly ApplicationBuildRequestV1[] {
  const batch = solutionExportApplicationBuildBatchInputV1Schema.safeParse(
    input.sources.applicationBuildInputs,
  );
  let requests: readonly ApplicationBuildRequestV1[];
  if (!batch.success) {
    requests = [
      applicationBuildRequestFromWorkflowInput(input, approvedSettings),
    ];
  } else {
    const reference = input.request.sources.applicationBuildInputs;
    if (
      reference === undefined ||
      !resolvedJsonMatchesReference(batch.data, reference)
    ) {
      throw failure("cloudmarkup.export.build-input-binding-invalid");
    }
    requests = batch.data.requests.map((request) =>
      applicationBuildRequestFromWorkflowInput(
        input,
        approvedSettings,
        request,
        batch.data,
      ),
    );
  }
  const expectedContracts = input.generation.artifact.buildContracts
    .map(({ contractDigest }) => contractDigest)
    .sort();
  const actualContracts = requests
    .flatMap(({ source }) =>
      source.kind === "generated" ? [source.buildContractDigest] : [],
    )
    .sort();
  if (
    expectedContracts.length !== actualContracts.length ||
    expectedContracts.some(
      (contractDigest, index) => contractDigest !== actualContracts[index],
    )
  ) {
    throw failure("cloudmarkup.export.build-input-coverage-invalid");
  }
  return requests;
}

/** Connect the workflow to one preconfigured isolated application runner. */
export function createSolutionExportApplicationBuildPort(
  dependencies: SolutionExportApplicationBuildPortDependencies,
): SolutionExportApplicationBuildPort & {
  build(
    input: Parameters<SolutionExportApplicationBuildPort["build"]>[0],
  ): Promise<
    ApplicationBuildResultV1 | SolutionExportApplicationBuildBatchResultV1
  >;
} {
  const approvedSettings =
    solutionExportWorkflowStageDescriptorsV1Schema.shape.applicationBuild.parse(
      dependencies.approvedSettings,
    );
  return {
    async build(input) {
      if (input.signal.aborted) throw abortError();
      const requests = applicationBuildRequestsFromWorkflowInput(
        input,
        approvedSettings,
      );
      const results: ApplicationBuildResultV1[] = [];
      for (const request of requests) {
        const rawResult = await dependencies.runner.run(request, {
          signal: input.signal,
        });
        const parsed = applicationBuildResultV1Schema.safeParse(rawResult);
        if (!parsed.success) {
          throw failure(
            "cloudmarkup.export.build-result-invalid",
            "export-build-failed",
          );
        }
        const result = parsed.data;
        const actor = result.evidence.provenance.actor;
        const generationSource = request.source;
        const selectedEnvelope =
          generationSource.kind === "generated"
            ? input.generation.artifact.buildContracts.find(
                ({ contractDigest }) =>
                  contractDigest === generationSource.buildContractDigest,
              )
            : undefined;
        const selectedWorkloadCoverage =
          input.generation.artifact.coverage.workloads.find(
            ({ workloadId }) =>
              workloadId === selectedEnvelope?.contract.workloadId,
          );
        if (
          generationSource.kind !== "generated" ||
          selectedEnvelope === undefined ||
          result.coverage.buildRequestDigest !==
            applicationBuildRequestDigest(request) ||
          result.coverage.generationArtifactDigest !==
            generationSource.applicationGeneration.artifactDigest ||
          result.coverage.solutionRevisionDigest !==
            request.solutionRevisionDigest ||
          result.coverage.solutionRevisionId !==
            request.solutionRevision.solutionRevisionId ||
          result.coverage.workloadId !== selectedEnvelope.contract.workloadId ||
          result.coverage.inputState !==
            expectedGeneratedInputState(
              selectedEnvelope,
              selectedWorkloadCoverage?.state,
            ) ||
          !passingArtifactsMatchEnvelope(result, selectedEnvelope) ||
          result.evidence.solutionRevisionId !==
            input.request.subject.solutionRevisionId ||
          !canonicalEqual(
            result.evidence.environment,
            input.request.environment,
          ) ||
          actor.kind !== "deterministic-tool" ||
          !canonicalEqual(actor.tool, input.settings.adapter)
        ) {
          throw failure(
            "cloudmarkup.export.build-result-binding-invalid",
            "export-build-failed",
          );
        }
        results.push(result);
      }
      if (results.length === 1) {
        const only = results[0];
        if (only === undefined) {
          throw failure(
            "cloudmarkup.export.build-result-invalid",
            "export-build-failed",
          );
        }
        return only;
      }
      const parsedBatch =
        solutionExportApplicationBuildBatchResultV1Schema.safeParse({
          contractVersion: 1,
          kind: "cloudmarkup.application-build-batch-result",
          reportDigest:
            solutionExportApplicationBuildBatchReportDigest(results),
          results,
        });
      if (!parsedBatch.success) {
        throw failure(
          "cloudmarkup.export.build-result-invalid",
          "export-build-failed",
        );
      }
      return parsedBatch.data;
    },
  };
}
