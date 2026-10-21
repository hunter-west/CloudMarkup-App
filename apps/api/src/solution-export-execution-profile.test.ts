import { describe, expect, it } from "vitest";
import sqsEventTemplate from "@cloudmarkup/provider-aws/testing/sqs-event-template-v1.json" with { type: "json" };
import {
  SolutionExportWorkflowFailureError,
  type SolutionExportCompilerPort,
} from "@cloudmarkup/solution-export-workflow";
import { workflowFixture } from "@cloudmarkup/solution-export-workflow/testing";
import {
  assertBufferedSolutionExportArchiveFitsDownload,
  assertCloudFormationInfrastructureOnly,
  unsupportedSolutionExportStage,
} from "./solution-export-execution-profile.js";

type Input = Parameters<SolutionExportCompilerPort["compile"]>[0];
function input(
  mode: Parameters<typeof workflowFixture>[0] = "infrastructure-only",
  target: Parameters<typeof workflowFixture>[1] = "cloudformation",
): Input {
  const f = workflowFixture(mode, target);
  return {
    request: f.request,
    settings: f.request.targetSettings.stageDescriptors.compiler,
    signal: new AbortController().signal,
    sources: {
      architectureDocument: f.generationRequest.architectureDocument,
      solutionRevision: f.generationRequest.solutionRevision,
      workloadBehavior: f.generationRequest.workloadBehavior,
    },
  };
}
function rejected(value: Input) {
  expect(() => {
    assertCloudFormationInfrastructureOnly(value);
  }).toThrow(SolutionExportWorkflowFailureError);
}

describe("restricted CloudFormation export execution", () => {
  it("admits the actual SQS template only with explicit infrastructure delivery and identical workload bytes", () => {
    const base = input("complete-supported-pattern");
    const value = {
      ...base,
      request: {
        ...base.request,
        applicationDelivery: "infrastructure-only-v1" as const,
        sources: { ...base.request.sources, applicationBuildInputs: undefined },
      },
      sources: {
        ...base.sources,
        architectureDocument: sqsEventTemplate,
        workloadBehavior: sqsEventTemplate.workloadBehavior,
      },
    };
    const before = structuredClone({
      request: value.request,
      sources: value.sources,
    });
    expect(() => {
      assertCloudFormationInfrastructureOnly(value);
    }).not.toThrow();
    expect({ request: value.request, sources: value.sources }).toEqual(before);
    rejected({
      ...value,
      request: { ...value.request, applicationDelivery: undefined },
    });
    rejected({
      ...value,
      request: { ...value.request, applicationSource: "ai-source-draft-v2" },
    });
    rejected({
      ...value,
      sources: { ...value.sources, applicationBuildInputs: {} },
    });
    rejected({
      ...value,
      sources: {
        ...value.sources,
        workloadBehavior: base.sources.workloadBehavior,
      },
    });
  });
  it.each([
    "generated-starter",
    "ai-assisted-custom",
    "user-provided",
    "external-artifact",
  ] as const)(
    "keeps %s denied even with an explicit delivery selection",
    (mode) => {
      const value = input(mode);
      rejected({
        ...value,
        request: {
          ...value.request,
          applicationDelivery: "infrastructure-only-v1",
          sources: {
            ...value.request.sources,
            applicationBuildInputs: undefined,
          },
        },
      });
    },
  );
  it("accepts the current immutable infrastructure-only source", () => {
    expect(() => {
      assertCloudFormationInfrastructureOnly(input());
    }).not.toThrow();
  });
  it("rejects Terraform and profile substitution before compilation", () => {
    rejected(input("infrastructure-only", "terraform"));
    const value = input();
    rejected({
      ...value,
      request: {
        ...value.request,
        targetProfileId: input("infrastructure-only", "terraform").request
          .targetProfileId,
      },
    });
  });
  it.each([
    "generated-starter",
    "complete-supported-pattern",
    "ai-assisted-custom",
    "user-provided",
    "external-artifact",
  ] as const)("rejects unsupported %s application requirements", (mode) => {
    rejected(input(mode));
  });
  it("rejects a separate workload requesting generation", () => {
    const value = input();
    rejected({
      ...value,
      sources: {
        ...value.sources,
        workloadBehavior: input("generated-starter").sources.workloadBehavior,
      },
    });
  });
  it("rejects both referenced and unexpectedly resolved build inputs", () => {
    const value = input();
    rejected({
      ...value,
      request: {
        ...value.request,
        sources: input("generated-starter").request.sources,
      },
    });
    rejected({
      ...value,
      sources: { ...value.sources, applicationBuildInputs: {} },
    });
  });
  it("rejects malformed versioned source without exposing its contents", () => {
    const value = input();
    rejected({
      ...value,
      sources: { ...value.sources, architectureDocument: {} },
    });
    try {
      assertCloudFormationInfrastructureOnly({
        ...value,
        sources: {
          ...value.sources,
          workloadBehavior: { secret: "synthetic-private-source" },
        },
      });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(SolutionExportWorkflowFailureError);
      expect(JSON.stringify(error)).not.toContain("synthetic-private-source");
      expect((error as SolutionExportWorkflowFailureError).failure).toEqual({
        classification: "permanent",
        code: "cloudmarkup.export.host-stage-unavailable",
        publicMessage: "export-input-invalid",
        stage: "compile-infrastructure",
      });
    }
  });
  it.each([
    "generate-application",
    "build-application",
    "validate-infrastructure",
  ] as const)("cannot report an unavailable %s stage as success", (stage) => {
    expect(() => unsupportedSolutionExportStage(stage)).toThrow(
      SolutionExportWorkflowFailureError,
    );
  });
});

describe("hosted archive size admission", () => {
  it("accepts exactly the download limit and rejects one byte more before publication", () => {
    expect(() => {
      assertBufferedSolutionExportArchiveFitsDownload(
        new Uint8Array(4 * 1024 * 1024),
      );
    }).not.toThrow();
    try {
      assertBufferedSolutionExportArchiveFitsDownload(
        new Uint8Array(4 * 1024 * 1024 + 1),
      );
      throw new Error("Expected oversized archive rejection.");
    } catch (error) {
      expect(error).toBeInstanceOf(SolutionExportWorkflowFailureError);
      expect((error as SolutionExportWorkflowFailureError).failure).toEqual({
        classification: "permanent",
        code: "cloudmarkup.export.host-package-size-limit",
        publicMessage: "export-input-invalid",
        stage: "package-export",
      });
    }
  });
});
