import { parseIntentDocument } from "@cloudmarkup/domain";
import {
  awsCatalogV1,
  awsServiceExtensionV1,
  awsValidationRuleRegistrationsV1,
} from "@cloudmarkup/provider-aws";
import {
  architectureDocumentV3Schema,
  digestCanonicalValue,
} from "@cloudmarkup/schemas";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCurrentProductionAiCatalogGrounding as createProductionAiCatalogGrounding } from "./production-ai-catalog.js";
import {
  createProductionAiPlanningRequest,
  productionAiPlanningCatalogAuthority,
} from "./production-ai-planning-request.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../packages/test-fixtures/fixtures/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
}
function input() {
  const architecture = architectureDocumentV3Schema.parse(
    fixture("architecture-document/v3/valid/representative.json"),
  );
  return {
    architecture: architectureDocumentV3Schema.parse({
      ...architecture,
      provider: { id: "aws.cloudmarkup", region: "us-east-1" },
      catalog: createProductionAiCatalogGrounding().catalog,
    }),
    approvedIntent: parseIntentDocument(
      fixture("intent-document/v1/valid/representative.json"),
    ),
    requestedMode: "guided" as const,
    target: "terraform" as const,
    limits: {
      maximumAddedNodes: 8,
      maximumNodes: 32,
      maximumEdges: 64,
      maximumExternalResources: 8,
    },
    assistantLimits: {
      maximumOperations: 32,
      maximumApplicationContracts: 16,
      maximumWorkloads: 16,
      maximumWorkloadOperations: 32,
      maximumTestScenarios: 32,
      maximumSourceOwnershipDeclarations: 64,
    },
  };
}

describe("production operations request from current catalog and approved RAM content", () => {
  it.each(["terraform", "cloudformation"] as const)(
    "projects actual complete metadata for %s",
    (target) => {
      const authority = productionAiPlanningCatalogAuthority(
        target,
        createProductionAiCatalogGrounding().catalog,
      );
      expect(authority.targetReadiness).toHaveLength(73);
      expect(authority.validationRules.map((entry) => entry.ruleId)).toEqual(
        awsValidationRuleRegistrationsV1.map((entry) => entry.descriptor.id),
      );
      for (const service of awsCatalogV1.listServices()) {
        const entry = authority.targetReadiness.find(
          (item) => item.serviceType === service.id,
        );
        const installed = awsServiceExtensionV1.requireServiceExtension(
          service.id,
        ).targetReadiness[target];
        expect(entry?.rationale).toBe(installed.reason);
        expect(entry?.target).toBe(target);
        if (installed.status === "not-applicable") {
          expect([
            "aws.region.boundary",
            "aws.ec2.availability-zone",
          ]).toContain(service.id);
          expect(service.nodeKind.kind).toBe("boundary");
          expect(entry?.status).toBe("ready");
        } else
          expect(entry?.status).toBe(
            installed.status === "supported" ? "ready" : installed.status,
          );
      }
    },
  );
  it("preserves the exact supplied limits and accepted requirements without aliasing source content", () => {
    const source = input();
    const before = digestCanonicalValue(source);
    const request = createProductionAiPlanningRequest(source);
    expect(request.planningContext?.limits).toEqual(source.limits);
    expect(request.planningContext?.assistantLimits).toEqual(
      source.assistantLimits,
    );
    expect(request.planningContext?.approvedIntent).toEqual(
      source.approvedIntent,
    );
    expect(request.architecture).toEqual(source.architecture);
    expect(request.planningContext?.allowedGraphCommandKinds).not.toContain(
      "replace-workload-and-application-contracts",
    );
    expect(
      request.planningContext?.allowedAssistantOperationKinds,
    ).not.toContain("graph-command");
    request.architecture.nodes.length = 0;
    if (request.planningContext)
      request.planningContext.approvedIntent.application.summary = "changed";
    expect(digestCanonicalValue(source)).toBe(before);
  });
  it("does not reinterpret an older or forged catalog as current", () => {
    const source = input();
    expect(() =>
      createProductionAiPlanningRequest({
        ...source,
        architecture: architectureDocumentV3Schema.parse({
          ...source.architecture,
          catalog: { ...source.architecture.catalog, version: "0.8.0" },
        }),
      }),
    ).toThrow("This revision uses an unsupported AWS catalog.");
  });
  it("does not widen a host limit to fit an existing graph", () => {
    const source = input();
    expect(source.architecture.nodes.length).toBeGreaterThan(1);
    expect(() =>
      createProductionAiPlanningRequest({
        ...source,
        limits: { ...source.limits, maximumNodes: 1 },
      }),
    ).toThrow("Current production planning context");
  });
  it("rejects invalid limit shapes instead of using defaults", () => {
    const source = input();
    expect(() =>
      createProductionAiPlanningRequest({
        ...source,
        assistantLimits: { ...source.assistantLimits, maximumOperations: 0 },
      }),
    ).toThrow();
  });
  it("rejects a secret-bearing requirement before any provider dispatch", () => {
    const source = input();
    source.approvedIntent.application.summary =
      "Use AWS access key " + "AKIA" + "0".repeat(16);
    expect(() => createProductionAiPlanningRequest(source)).toThrow(
      "Current production planning context",
    );
  });
  it("keeps Guided/Professional presentation independent of allowed mutations", () => {
    const source = input();
    const guided = createProductionAiPlanningRequest(source);
    const professional = createProductionAiPlanningRequest({
      ...source,
      requestedMode: "professional",
    });
    expect(guided.planningContext).toEqual(professional.planningContext);
    expect(professional.requestedMode).toBe("professional");
  });
});
it.each(["terraform", "cloudformation"] as const)(
  "rejects older planning bindings for %s",
  (target) => {
    const current = createProductionAiPlanningRequest({ ...input(), target });
    expect(() =>
      productionAiPlanningCatalogAuthority(target, {
        ...current.catalogGrounding.catalog,
        version: "0.16.0",
      }),
    ).toThrow("This revision uses an unsupported AWS catalog.");
  },
);

it("grounds the new capacity rule in both current export targets", () => {
  for (const target of ["terraform", "cloudformation"] as const) {
    const request = createProductionAiPlanningRequest({ ...input(), target });
    expect(request.planningContext?.validationRules).toContainEqual({
      ruleId: "aws.cloudmarkup.validation.fsx-storage-capacity",
      kind: "target-readiness",
    });
  }
});

it.each(["terraform", "cloudformation"] as const)(
  "grounds the installed KMS readiness rule for %s in current planning",
  (target) => {
    const current = createProductionAiPlanningRequest({ ...input(), target });
    expect(current.planningContext?.validationRules).toContainEqual({
      ruleId: "aws.cloudmarkup.validation.kms-key-readiness",
      kind: "target-readiness",
    });
  },
);
