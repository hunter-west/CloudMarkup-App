import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import {
  loadAwsEditorArchitectureDocument,
  loadBlankAwsEditorArchitectureDocument,
} from "../../../provider-catalog/aws-editor-fixture.js";
import {
  createServiceCatalogViewModel,
  type ServiceCatalogViewModel,
} from "./service-catalog-view-model.js";

function serviceIds(viewModel: ServiceCatalogViewModel): readonly string[] {
  return viewModel.categories.flatMap((category) =>
    category.items.map((item) => item.serviceId),
  );
}

function createViewModel(
  query: string,
  mode: "guided" | "professional" = "guided",
) {
  return createServiceCatalogViewModel({
    catalog: awsEditorCatalog,
    document: loadAwsEditorArchitectureDocument(),
    mode,
    query,
    recentServiceIds: [],
  });
}

describe("createServiceCatalogViewModel", () => {
  it("offers application services on a blank project without network prerequisites", () => {
    const view = createServiceCatalogViewModel({
      catalog: awsEditorCatalog,
      document: loadBlankAwsEditorArchitectureDocument(),
      mode: "guided",
      query: "",
      recentServiceIds: [],
    });
    const items = view.categories.flatMap((category) => category.items);
    for (const serviceId of [
      "aws.apigateway.http-api",
      "aws.lambda.function",
      "aws.dynamodb.table",
      "aws.s3.bucket",
      "aws.sqs.queue",
    ]) {
      expect(
        items.find((item) => item.serviceId === serviceId)?.addability.enabled,
      ).toBe(true);
    }
  });
  it("finds services by AWS display name and catalog-owned education", () => {
    const byName = createViewModel("DynamoDB table");
    const byCapability = createViewModel("bounded application workload");

    expect(serviceIds(byName)).toContain("aws.dynamodb.table");
    expect(serviceIds(byCapability)).toContain("aws.lambda.function");

    const imageSearch = createViewModel("Published image identity");
    expect(serviceIds(imageSearch)).toEqual(["aws.ecr.repository"]);
    expect(imageSearch.categories[0]?.items[0]?.searchContext).toBe(
      "Configure → Image identities",
    );
    expect(serviceIds(createViewModel("Image identities"))).toEqual([
      "aws.ecr.repository",
    ]);
  });

  it("excludes settings, nondeployable entries, missing icons, and secondary product variants", () => {
    const lambda = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.lambda.function",
    );
    if (lambda === undefined) {
      throw new Error("Expected the Lambda catalog projection.");
    }
    const group = {
      id: "test.catalog.product",
      displayName: "Test product",
      primaryServiceType: "aws.lambda.function",
      variantLabel: "Primary",
      summary: "A controlled product visibility fixture.",
    };
    const view = createServiceCatalogViewModel({
      catalog: {
        ...awsEditorCatalog,
        services: [
          {
            ...lambda,
            serviceType: "test.catalog.configuration",
            catalogVisibility: "configuration",
          },
          {
            ...lambda,
            serviceType: "test.catalog.non-deployable",
            deployable: false,
          },
          { ...lambda, serviceType: "test.catalog.no-icon", iconId: null },
          {
            ...lambda,
            serviceType: "test.catalog.variant",
            catalogGroup: { ...group, variantLabel: "Secondary" },
          },
          { ...lambda, catalogGroup: group },
        ],
      },
      document: loadBlankAwsEditorArchitectureDocument(),
      mode: "guided",
      query: "",
      recentServiceIds: [
        "test.catalog.configuration",
        "test.catalog.non-deployable",
        "test.catalog.no-icon",
        "test.catalog.variant",
        "aws.lambda.function",
      ],
    });

    expect(serviceIds(view)).toEqual(["aws.lambda.function"]);
    expect(view.resultCount).toBe(1);
    expect(view.recentItems.map((item) => item.serviceId)).toEqual([
      "aws.lambda.function",
    ]);
  });

  it("shows one FSx product and keeps internal settings in configuration", () => {
    const matches = serviceIds(createViewModel("FSx")).filter((id) =>
      id.startsWith("aws.fsx."),
    );
    expect(matches).toEqual(["aws.fsx.lustre-file-system"]);
    expect(serviceIds(createViewModel("Windows"))).toContain(
      "aws.fsx.lustre-file-system",
    );
    expect(
      serviceIds(createViewModel("aws.iam.policy-statement")),
    ).not.toContain("aws.iam.policy-statement");
    expect(
      awsEditorCatalog.services.filter((service) =>
        service.serviceType.startsWith("aws.fsx."),
      ),
    ).toHaveLength(6);
  });

  it("changes category labels and explanations without changing the service set", () => {
    const guided = createViewModel("", "guided");
    const professional = createViewModel("", "professional");

    expect(
      guided.categories.map((category) => [category.id, category.label]),
    ).toEqual([
      ["root-placeable", "Add directly"],
      ["parent-required", "Needs a parent"],
    ]);
    expect(
      professional.categories.map((category) => [category.id, category.label]),
    ).toEqual([
      ["root-placeable", "Root-placeable"],
      ["parent-required", "Parent-required"],
    ]);
    expect([...serviceIds(guided)].sort()).toEqual(
      [...serviceIds(professional)].sort(),
    );

    const guidedLambda = guided.categories
      .flatMap((category) => category.items)
      .find((item) => item.serviceId === "aws.lambda.function");
    const professionalLambda = professional.categories
      .flatMap((category) => category.items)
      .find((item) => item.serviceId === "aws.lambda.function");
    const lambda = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.lambda.function",
    );

    expect(guidedLambda?.modeExplanation).toBe(
      lambda?.education.guidedExplanation,
    );
    expect(professionalLambda?.modeExplanation).toBe(
      lambda?.education.professionalExplanation,
    );
    expect(guidedLambda?.modeExplanation).not.toBe(
      professionalLambda?.modeExplanation,
    );
  });
});
