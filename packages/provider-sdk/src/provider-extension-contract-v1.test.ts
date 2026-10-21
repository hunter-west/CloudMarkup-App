import { describe, expect, it } from "vitest";

import {
  defineProviderCanonicalPolicyDocumentV1,
  defineProviderOwnedConfigurationSlotV1,
  providerCanonicalPolicyDocumentV1Schema,
  providerPolicyResourceV1Schema,
  providerTargetReadinessV1Schema,
} from "./provider-extension-contract-v1.js";

function targetReadiness() {
  return {
    modeling: {
      status: "supported" as const,
      reason: "The typed architecture graph represents this concept.",
    },
    configuration: {
      status: "supported" as const,
      reason: "A strict typed configuration contract exists.",
    },
    validation: {
      status: "supported" as const,
      reason: "Deterministic validation covers the bounded contract.",
    },
    terraform: {
      status: "pending" as const,
      reason: "Terraform rendering remains metadata-only.",
    },
    cloudformation: {
      status: "pending" as const,
      reason: "CloudFormation rendering remains metadata-only.",
    },
    generatedCode: {
      status: "not-applicable" as const,
      reason: "This configuration does not produce application code.",
    },
  };
}

function trustPolicyDocument() {
  return defineProviderCanonicalPolicyDocumentV1({
    contractVersion: 1 as const,
    id: "policy-node-1",
    ownerNodeId: "role-node-1",
    slotId: "example.cloud.slot.trust-policy",
    schemaVersion: "1.0.0",
    displayName: "Function trust policy",
    policyKind: "trust" as const,
    lifecycle: {
      ownership: "user" as const,
      origin: "user" as const,
    },
    statements: [
      {
        id: "statement-node-1",
        statementIdentifier: "AllowFunctionAssumeRole",
        effect: "allow" as const,
        actions: [
          {
            kind: "provider-action" as const,
            action: "sts:AssumeRole",
          },
        ],
        resources: [],
        principals: [
          {
            kind: "service" as const,
            service: "example.cloud.principal.function",
          },
        ],
        conditions: [
          {
            id: "condition-node-1",
            operator: "StringEquals",
            key: "example:SourceType",
            values: [{ kind: "string" as const, value: "function" }],
          },
        ],
        lifecycle: {
          ownership: "user" as const,
          origin: "user" as const,
        },
      },
    ],
    targetReadiness: targetReadiness(),
  });
}

describe("provider extension contracts v1", () => {
  it("declares graph-bound owned configuration slots with closed policy kinds", () => {
    const slot = defineProviderOwnedConfigurationSlotV1({
      id: "example.cloud.slot.inline-policy",
      slotVersion: "1.0.0",
      configurationKind: "example.cloud.configuration.policy",
      displayName: "Inline policies",
      description: "User-authored identity policies owned by this service.",
      graphBinding: {
        configurationServiceId: "example.cloud.policy-document",
        ownershipRelationshipType: "example.cloud.owns-policy",
      },
      cardinality: {
        minimum: 0,
        maximum: "many",
        enforcement: "provider-rule",
      },
      allowedOwnership: ["user", "generated"],
      generatedAdoption: "allowed",
      policyKinds: ["identity-inline", "generated-permission"],
      targetReadiness: targetReadiness(),
      guidedExplanation: "Add only the permissions this service needs.",
      professionalExplanation:
        "Policy nodes retain exact owner-slot relationships and lifecycle provenance.",
    });

    expect(slot.policyKinds).toEqual([
      "identity-inline",
      "generated-permission",
    ]);
    expect(slot.graphBinding.configurationServiceId).toBe(
      "example.cloud.policy-document",
    );
    expect(() =>
      defineProviderOwnedConfigurationSlotV1({
        ...slot,
        policyKinds: ["trust", "trust"],
      }),
    ).toThrow();
  });

  it("keeps policy kind distinct from allow or deny statement effect", () => {
    const document = trustPolicyDocument();

    expect(document.policyKind).toBe("trust");
    expect(document.statements[0]?.effect).toBe("allow");
    expect(document.statements[0]?.principals[0]?.kind).toBe("service");
  });

  it("enforces principal rules and non-empty typed actions", () => {
    const identityWithPrincipal = structuredClone(trustPolicyDocument());
    identityWithPrincipal.policyKind = "identity-inline";
    identityWithPrincipal.statements[0]?.resources.push(
      providerPolicyResourceV1Schema.parse({
        kind: "architecture-node",
        nodeId: "table-node-1",
        attribute: "example.cloud.output.resource",
      }),
    );
    expect(
      providerCanonicalPolicyDocumentV1Schema.safeParse(identityWithPrincipal)
        .success,
    ).toBe(false);

    const emptyActions = structuredClone(trustPolicyDocument());
    emptyActions.statements[0]?.actions.splice(0);
    expect(
      providerCanonicalPolicyDocumentV1Schema.safeParse(emptyActions).success,
    ).toBe(false);

    const trustWithoutPrincipal = structuredClone(trustPolicyDocument());
    trustWithoutPrincipal.statements[0]?.principals.splice(0);
    expect(
      providerCanonicalPolicyDocumentV1Schema.safeParse(trustWithoutPrincipal)
        .success,
    ).toBe(false);
  });

  it("rejects arbitrary condition JSON and incomplete readiness matrices", () => {
    const arbitraryCondition = structuredClone(trustPolicyDocument());
    const condition = arbitraryCondition.statements[0]?.conditions[0];
    if (condition !== undefined) {
      condition.values = [
        {
          kind: "string",
          value: "function",
          nested: { unsafe: true },
        } as never,
      ];
    }
    expect(
      providerCanonicalPolicyDocumentV1Schema.safeParse(arbitraryCondition)
        .success,
    ).toBe(false);

    const incomplete = targetReadiness() as Record<string, unknown>;
    delete incomplete["validation"];
    expect(providerTargetReadinessV1Schema.safeParse(incomplete).success).toBe(
      false,
    );
  });
});
