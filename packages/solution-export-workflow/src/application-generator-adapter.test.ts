import { generateApplication } from "@cloudmarkup/application-generator";
import { sha256Digest } from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import {
  SolutionExportApplicationGenerationInputError,
  applicationGenerationRequestFromWorkflowInput,
  createSolutionExportApplicationGeneratorPort,
} from "./application-generator-adapter.js";
import { projectGoCompilationResultToSolutionExportInfrastructure } from "./compiler-projection.js";
import { workflowFixture } from "./workflow.test-support.js";

function portInput() {
  const fixture = workflowFixture("complete-supported-pattern");
  return {
    fixture,
    input: {
      compilation: fixture.compilation,
      infrastructure: projectGoCompilationResultToSolutionExportInfrastructure(
        fixture.compilation,
      ),
      request: fixture.request,
      settings:
        fixture.request.targetSettings.stageDescriptors.applicationGenerator,
      signal: new AbortController().signal,
      sources: {
        architectureDocument: fixture.generationRequest.architectureDocument,
        solutionRevision: fixture.generationRequest.solutionRevision,
        workloadBehavior: fixture.generationRequest.workloadBehavior,
      },
    },
  };
}

describe("application generator workflow input adapter", () => {
  it("reconstructs the real strict request only from resolved workflow inputs", () => {
    const { fixture, input } = portInput();

    expect(applicationGenerationRequestFromWorkflowInput(input)).toEqual(
      fixture.generationRequest,
    );
  });

  it("connects the strict workflow handoff to the public deterministic generator", async () => {
    const { fixture, input } = portInput();

    await expect(
      createSolutionExportApplicationGeneratorPort().generate(input),
    ).resolves.toEqual(generateApplication(fixture.generationRequest));
  });

  it("rejects cancellation before invoking generation", async () => {
    const { input } = portInput();
    const controller = new AbortController();
    controller.abort();

    await expect(
      createSolutionExportApplicationGeneratorPort().generate({
        ...input,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails closed when the approved generator pin mismatches the Solution Revision", () => {
    const { input } = portInput();

    expect(() =>
      applicationGenerationRequestFromWorkflowInput({
        ...input,
        settings: {
          ...input.settings,
          adapter: {
            ...input.settings.adapter,
            digest: sha256Digest("forged-generator-pin"),
          },
        },
      }),
    ).toThrow(SolutionExportApplicationGenerationInputError);
  });

  it("classifies an immutable generator binding mismatch as permanent", async () => {
    const { input } = portInput();

    await expect(
      createSolutionExportApplicationGeneratorPort().generate({
        ...input,
        settings: {
          ...input.settings,
          adapter: {
            ...input.settings.adapter,
            digest: sha256Digest("forged-generator-pin"),
          },
        },
      }),
    ).rejects.toMatchObject({
      failure: {
        classification: "permanent",
        code: "cloudmarkup.export.application-generation-input-invalid",
        publicMessage: "export-input-invalid",
        stage: "generate-application",
      },
    });
  });
});
