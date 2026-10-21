import { describe, expect, it } from "vitest";

import { digestCanonicalValue } from "@cloudmarkup/schemas";

import { frozenModelEvaluationDatasetV1 } from "./model-evaluation.js";
import {
  evaluateModelNetworkingObservationV2,
  frozenModelNetworkingEvaluationDatasetV2,
  modelNetworkingCatalogAuthorityV2,
  modelNetworkingEvaluationCaseKindV2Values,
  modelNetworkingEvaluationDatasetV2Schema,
  modelNetworkingEvaluationObservationV2Schema,
  type ModelNetworkingEvaluationObservationInputV2,
} from "./networking-evaluation-v2.js";
import {
  modelNetworkingProductionProbeV2Values,
  runFrozenModelNetworkingEvaluationV2,
  runModelNetworkingProductionProbeV2,
  type ModelNetworkingProductionEvaluationReportV2,
} from "./networking-evaluation-production-v2.js";

const V1_DATASET_DIGEST =
  "sha256:0dc44ea34d37017ffdf38b331ef823d4dcfd1549d9a6d6d8e1dbef3f5c2673a4";
const CATALOG_DIGEST =
  "sha256:17627252eb47c7f2a031ca04e90545e4775c0e0b598bd05b4fe4a0889fcd018d";
let productionReportPromise:
  Promise<ModelNetworkingProductionEvaluationReportV2> | undefined;

async function observationFor(
  caseKind: (typeof modelNetworkingEvaluationCaseKindV2Values)[number],
): Promise<ModelNetworkingEvaluationObservationInputV2> {
  const evaluationCase = frozenModelNetworkingEvaluationDatasetV2.cases.find(
    (candidate) => candidate.caseKind === caseKind,
  );
  productionReportPromise ??= runFrozenModelNetworkingEvaluationV2();
  const report = await productionReportPromise;
  const observation = report.observations.find(
    (candidate) => candidate.caseId === evaluationCase?.caseId,
  );
  if (evaluationCase === undefined || observation === undefined) {
    throw new Error(`Missing frozen networking evaluation case ${caseKind}.`);
  }
  return structuredClone(observation);
}

function evaluate(
  caseKind: (typeof modelNetworkingEvaluationCaseKindV2Values)[number],
  observation: ModelNetworkingEvaluationObservationInputV2,
) {
  const evaluationCase = frozenModelNetworkingEvaluationDatasetV2.cases.find(
    (candidate) => candidate.caseKind === caseKind,
  );
  if (evaluationCase === undefined) {
    throw new Error(`Missing frozen networking evaluation case ${caseKind}.`);
  }
  return evaluateModelNetworkingObservationV2({
    catalogAuthority: modelNetworkingCatalogAuthorityV2,
    evaluationCase,
    observation,
  });
}

describe("frozen AWS networking model evaluation v2", () => {
  it("preserves the immutable 21-case v1 dataset exactly", () => {
    expect(frozenModelEvaluationDatasetV1.cases).toHaveLength(21);
    expect(frozenModelEvaluationDatasetV1.datasetVersion).toBe("1.0.0");
    expect(frozenModelEvaluationDatasetV1.datasetDigest).toBe(
      V1_DATASET_DIGEST,
    );
  });

  it("freezes exactly the five reviewed networking cases in an additive dataset", () => {
    expect(
      frozenModelNetworkingEvaluationDatasetV2.cases.map(
        ({ caseKind }) => caseKind,
      ),
    ).toEqual(modelNetworkingEvaluationCaseKindV2Values);
    expect(modelNetworkingCatalogAuthorityV2).toMatchObject({
      catalogDigest: CATALOG_DIGEST,
      catalogId: "aws.cloudmarkup.notes-api-catalog",
      catalogVersion: "0.10.0",
    });
    expect(frozenModelNetworkingEvaluationDatasetV2.cases).toHaveLength(5);
    expect(frozenModelNetworkingEvaluationDatasetV2).toMatchObject({
      contractVersion: 2,
      datasetId: "cloudmarkup.model-evaluation.aws-networking",
      datasetVersion: "2.0.0",
      frozen: true,
      syntheticOnly: true,
    });
    expect(Object.isFrozen(frozenModelNetworkingEvaluationDatasetV2)).toBe(
      true,
    );
    expect(
      Object.isFrozen(frozenModelNetworkingEvaluationDatasetV2.cases[0]),
    ).toBe(true);
    expect(
      modelNetworkingEvaluationDatasetV2Schema.parse(
        frozenModelNetworkingEvaluationDatasetV2,
      ),
    ).toEqual(frozenModelNetworkingEvaluationDatasetV2);
  });

  it("executes all five cases through the deterministic fake, production gateway, and review-only planner", async () => {
    const first = await runFrozenModelNetworkingEvaluationV2();
    const second = await runFrozenModelNetworkingEvaluationV2();

    expect(first).toEqual(second);
    expect(first.caseResults).toHaveLength(5);
    expect(first.deterministicPassed).toBe(true);
    expect(
      first.caseResults.every((result) => result.deterministicPassed),
    ).toBe(true);
    expect(
      first.observations.every(({ semantics }) => !semantics.automaticMutation),
    ).toBe(true);
    expect(first.executions).toHaveLength(5);
    for (const execution of first.executions) {
      expect(execution.adapterInvocationCount).toBe(1);
      expect(execution.gatewayInvocationCount).toBe(1);
      expect(execution.adapterProviderId).toBe("cloudmarkup.fake");
      expect(execution.catalogDigest).toBe(CATALOG_DIGEST);
      expect(execution.productionPath).toBe(
        "scripted-fake-adapter/provider-neutral-gateway/review-only-solution-planner",
      );
      expect(execution.writeAuthority).toBe("none");
    }
    expect(
      first.executions
        .filter(({ plannerDisposition }) => plannerDisposition === "rejected")
        .map(({ plannerDiagnosticCodes }) => plannerDiagnosticCodes),
    ).toEqual([
      ["cloudmarkup.solution-planner.deterministic-validation-failed"],
      ["cloudmarkup.solution-planner.deterministic-validation-failed"],
    ]);
  }, 60_000);

  it.each(modelNetworkingProductionProbeV2Values)(
    "rejects %s through the production gateway or planner boundary",
    async (mutation) => {
      const result = await runModelNetworkingProductionProbeV2(mutation);
      expect(result.adapterInvocationCount).toBe(1);
      expect(result.diagnosticCodes).toEqual(
        mutation === "invented-operation-kind"
          ? ["model-gateway.invalid-output"]
          : mutation === "noncatalog-operation"
            ? ["cloudmarkup.solution-planner.operation-not-allowed"]
            : ["model-gateway.ungrounded-graph-command"],
      );
    },
  );

  it("keeps a private relational database unresolved and rejects invented RDS authority", async () => {
    const observation = await observationFor("private-database");
    observation.operations.push({
      configurationKeys: ["engine"],
      kind: "add-node",
      serviceId: "aws.rds.db-instance",
    });

    expect(evaluate("private-database", observation)).toMatchObject({
      deterministicPassed: false,
      diagnosticCodes: ["model-evaluation.networking.unauthorized-service"],
    });
    expect(
      modelNetworkingCatalogAuthorityV2.services.some(({ serviceId }) =>
        serviceId.startsWith("aws.rds."),
      ),
    ).toBe(false);
  });

  it("rejects invented networking relationships and configuration fields", async () => {
    const inventedRelationship = await observationFor("avoid-nat");
    inventedRelationship.operations.push({
      configurationKeys: [],
      kind: "add-edge",
      relationshipType: "aws.ec2.subnet-magically-connects-database",
    });
    expect(evaluate("avoid-nat", inventedRelationship)).toMatchObject({
      deterministicPassed: false,
      diagnosticCodes: [
        "model-evaluation.networking.unauthorized-relationship",
      ],
    });

    const inventedField = await observationFor("avoid-nat");
    inventedField.operations.push({
      configurationKeys: ["transparentInternetAccess"],
      kind: "update-node-configuration",
      serviceId: "aws.ec2.gateway-vpc-endpoint",
    });
    expect(evaluate("avoid-nat", inventedField)).toMatchObject({
      deterministicPassed: false,
      diagnosticCodes: [
        "model-evaluation.networking.unauthorized-service-configuration",
      ],
    });
  });

  it("enforces the reviewed no-NAT choice even though NAT is catalog-approved", async () => {
    const observation = await observationFor("avoid-nat");
    observation.operations.push({
      configurationKeys: ["availabilityMode", "connectivityType"],
      kind: "add-node",
      serviceId: "aws.ec2.nat-gateway",
    });

    expect(evaluate("avoid-nat", observation)).toMatchObject({
      deterministicPassed: false,
      diagnosticCodes: ["model-evaluation.networking.forbidden-service"],
    });
  });

  it.each([
    ["invalid-cidr", "aws.validation.vpc-cidr-invalid"],
    ["broad-ingress", "aws.validation.security-group-admin-ingress-open"],
  ] as const)(
    "requires deterministic validator Evidence for %s",
    async (caseKind, requiredFinding) => {
      const missing = await observationFor(caseKind);
      missing.findingCodes = [];
      expect(evaluate(caseKind, missing)).toMatchObject({
        deterministicPassed: false,
        diagnosticCodes: ["model-evaluation.networking.missing-finding"],
      });

      const invented = await observationFor(caseKind);
      invented.findingCodes = [
        requiredFinding,
        "aws.validation.model-invented-network-finding",
      ];
      expect(evaluate(caseKind, invented)).toMatchObject({
        deterministicPassed: false,
        diagnosticCodes: ["model-evaluation.networking.unauthorized-finding"],
      });
    },
  );

  it("fails one-zone and false-containment Lambda networking claims", async () => {
    const oneZone = await observationFor("multi-az-requirements");
    oneZone.semantics.availabilityZoneCount = 1;
    oneZone.semantics.lambdaVpcSubnetAvailabilityZoneCount = 1;
    expect(evaluate("multi-az-requirements", oneZone)).toMatchObject({
      deterministicPassed: false,
      diagnosticCodes: [
        "model-evaluation.networking.availability-zone-requirement",
        "model-evaluation.networking.lambda-vpc-subnet-zone-requirement",
      ],
    });

    const falseContainment = await observationFor("multi-az-requirements");
    falseContainment.semantics.lambdaVpcAccessMode = "false-containment";
    expect(evaluate("multi-az-requirements", falseContainment)).toMatchObject({
      deterministicPassed: false,
      diagnosticCodes: [
        "model-evaluation.networking.lambda-vpc-access-mismatch",
      ],
    });
  });

  it("rejects automatic mutation and an invented operation kind at the contract boundary", async () => {
    const observation = await observationFor("avoid-nat");
    observation.semantics.automaticMutation = true;
    expect(evaluate("avoid-nat", observation)).toMatchObject({
      deterministicPassed: false,
      diagnosticCodes: ["model-evaluation.networking.automatic-mutation"],
    });

    expect(
      modelNetworkingEvaluationObservationV2Schema.safeParse({
        ...(await observationFor("avoid-nat")),
        operations: [{ kind: "deploy-network-directly" }],
      }).success,
    ).toBe(false);
  });

  it("rejects self-rehashed authority substitution", async () => {
    const dataset = structuredClone(frozenModelNetworkingEvaluationDatasetV2);
    const firstService = dataset.catalogAuthority.services[0];
    if (firstService === undefined) throw new Error("Missing catalog service.");
    firstService.configurationKeys = [
      ...firstService.configurationKeys,
      "inventedCatalogField",
    ].sort();
    const authorityDraft = { ...dataset.catalogAuthority };
    delete (authorityDraft as Partial<typeof dataset.catalogAuthority>)
      .authorityDigest;
    dataset.catalogAuthority.authorityDigest =
      digestCanonicalValue(authorityDraft);
    for (const evaluationCase of dataset.cases) {
      evaluationCase.catalogAuthorityDigest =
        dataset.catalogAuthority.authorityDigest;
      const caseDraft = { ...evaluationCase };
      delete (caseDraft as Partial<typeof evaluationCase>).caseDigest;
      evaluationCase.caseDigest = digestCanonicalValue(caseDraft);
    }
    const datasetDraft = { ...dataset };
    delete (datasetDraft as Partial<typeof dataset>).datasetDigest;
    dataset.datasetDigest = digestCanonicalValue(datasetDraft);

    const [firstCase] = dataset.cases;
    if (firstCase === undefined) {
      throw new Error(
        "Expected the frozen networking evaluation dataset to contain cases.",
      );
    }

    expect(
      evaluateModelNetworkingObservationV2({
        catalogAuthority: dataset.catalogAuthority,
        evaluationCase: firstCase,
        observation: await observationFor("private-database"),
      }).diagnosticCodes,
    ).toEqual([
      "model-evaluation.networking.case-binding-mismatch",
      "model-evaluation.networking.catalog-authority-mismatch",
    ]);
  });
});
