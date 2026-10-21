import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { IconPlaceholderReason, IconRegistry } from "@cloudmarkup/ui";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";

import { CloudMarkupDevelopmentGallery } from "./CloudMarkupDevelopmentGallery.js";
import {
  DevelopmentVisualGallery,
  type DevelopmentGalleryCatalogService,
} from "./DevelopmentVisualGallery.js";

const assetSet = Object.freeze({
  id: "aws.cloudmarkup.icons.placeholder-set",
  providerId: "aws",
  version: "0.0.0-development",
  digest: "sha256:synthetic-development-fixture",
});

const services: readonly DevelopmentGalleryCatalogService[] = [
  {
    id: "aws.apigateway.http-api",
    displayName: "API Gateway HTTP API",
    iconId: "aws.cloudmarkup.icons.apigateway",
  },
  {
    id: "aws.dynamodb.table",
    displayName: "DynamoDB Table",
    iconId: "aws.cloudmarkup.icons.dynamodb",
  },
  {
    id: "aws.lambda.function",
    displayName: "Lambda Function",
    iconId: "aws.cloudmarkup.icons.lambda",
  },
];

function createPlaceholderRegistry(
  reason: IconPlaceholderReason = "pending-approval",
) {
  const resolve = vi.fn((iconId: string) => ({
    kind: "placeholder" as const,
    iconId,
    asset: (
      <span aria-hidden="true" data-testid={`placeholder-${iconId}`}>
        ◇
      </span>
    ),
    assetSet,
    reason,
  }));

  return {
    registry: Object.freeze({
      assetSet,
      resolve,
    }) satisfies IconRegistry<ReactNode>,
    resolve,
  };
}

afterEach(() => {
  document.title = "";
});

describe("DevelopmentVisualGallery", () => {
  it("resolves catalog-facing icon IDs only through the injected registry", () => {
    const { registry, resolve } = createPlaceholderRegistry();

    render(
      <DevelopmentVisualGallery iconRegistry={registry} services={services} />,
    );

    expect(resolve.mock.calls.map(([iconId]) => iconId)).toEqual(
      services.map((service) => service.iconId),
    );
    expect(
      screen.getByRole("list", { name: "Catalog provider icon samples" }),
    ).toBeInTheDocument();
    for (const service of services) {
      expect(
        screen.getByRole("heading", { level: 3, name: service.displayName }),
      ).toBeInTheDocument();
      expect(screen.getByText(service.iconId)).toBeInTheDocument();
    }
  });

  it("labels every unresolved provider icon as pending without a support claim", () => {
    const { registry } = createPlaceholderRegistry();

    render(
      <DevelopmentVisualGallery iconRegistry={registry} services={services} />,
    );

    expect(screen.getAllByText("Icon pending approval")).toHaveLength(
      services.length,
    );
    expect(
      screen.getByText(/approved local icon or the neutral fallback/iu),
    ).toBeVisible();
    expect(screen.getAllByText(/support is not inferred/iu)).toHaveLength(
      services.length,
    );
    expect(screen.queryByText(/^Supported$/u)).not.toBeInTheDocument();
  });

  it.each([
    [
      "missing",
      "Icon unavailable",
      "No admitted local provider artwork is present.",
    ],
    [
      "rejected",
      "Icon rejected",
      "The provider artwork was rejected; the safe placeholder remains.",
    ],
    [
      "withdrawn",
      "Icon withdrawn",
      "The provider artwork was withdrawn; the safe placeholder remains.",
    ],
    [
      "integrity-failure",
      "Icon integrity check failed",
      "The provider artwork failed integrity checks; the safe placeholder remains.",
    ],
  ] as const)(
    "labels a %s placeholder without calling it pending",
    (reason, expectedLabel, expectedExplanation) => {
      const { registry } = createPlaceholderRegistry(reason);

      render(
        <DevelopmentVisualGallery
          iconRegistry={registry}
          services={services.slice(0, 1)}
        />,
      );

      const samples = screen.getByRole("list", {
        name: "Catalog provider icon samples",
      });
      expect(within(samples).getByText(expectedLabel)).toBeVisible();
      expect(samples).toHaveTextContent(expectedExplanation);
      expect(
        within(samples).queryByText("Icon pending approval"),
      ).not.toBeInTheDocument();
    },
  );

  it("provides text and accessible names for visual status, edge, and boundary samples", () => {
    const { registry } = createPlaceholderRegistry();

    render(
      <DevelopmentVisualGallery iconRegistry={registry} services={services} />,
    );

    expect(
      screen.getByRole("list", { name: "Synthetic node-status samples" }),
    ).toHaveTextContent("No blocking policy");
    expect(
      screen.getByRole("img", {
        name: "Synchronous invocation directed line sample",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Generic relationship directed line sample",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", {
        name: "Synthetic boundary treatment samples",
      }),
    ).toHaveTextContent("Read-only");
    expect(
      screen.getByText(
        /catalog defines exact Region, VPC, Availability Zone, and subnet boundary semantics/iu,
      ),
    ).toBeVisible();
  });

  it("keeps controls and layout identical across assistance samples", () => {
    const { registry } = createPlaceholderRegistry();

    render(
      <DevelopmentVisualGallery iconRegistry={registry} services={services} />,
    );

    const guided = screen.getByRole("region", { name: "Guided assistance" });
    const professional = screen.getByRole("region", {
      name: "Professional assistance",
    });
    const actionNames = (region: HTMLElement) =>
      within(region)
        .getAllByRole("button")
        .map((button) => button.textContent);

    expect(actionNames(professional)).toEqual(actionNames(guided));
    expect(guided).not.toHaveAttribute("data-cm-density");
    expect(professional).not.toHaveAttribute("data-cm-density");
    expect(professional.className).toBe(guided.className);
    expect(guided).toHaveTextContent("No Architecture Document");
    expect(professional).toHaveTextContent("No Architecture Document");
  });

  it("distinguishes legend samples from generated diagram artifacts", () => {
    const { registry } = createPlaceholderRegistry();

    render(
      <DevelopmentVisualGallery iconRegistry={registry} services={services} />,
    );

    expect(
      screen.getByRole("region", { name: "Presentation legend" }),
    ).toHaveTextContent("supplementary provider icon or neutral fallback");
    expect(
      screen.getByRole("region", { name: "Technical legend" }),
    ).toHaveTextContent("Exact validated relationship and ports would appear");
    expect(
      screen.getAllByText(
        "No artifact, renderer result, digest, or downloadable file is created.",
      ),
    ).toHaveLength(2);
  });

  it("shows an honest empty state when no catalog services are injected", () => {
    const { registry, resolve } = createPlaceholderRegistry();

    render(<DevelopmentVisualGallery iconRegistry={registry} services={[]} />);

    expect(
      screen.getByRole("heading", {
        name: "No catalog-facing icon samples supplied",
      }),
    ).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("composes the development page from the public AWS catalog and approved registry", () => {
    const unavailableArtworkServiceIds = new Set([
      "aws.ec2.instance",
      "aws.ecr.repository",
      "aws.ecs.cluster",
      "aws.ecs.service",
      "aws.ecs.task-definition",
      "aws.iam.instance-profile",
      "aws.kms.key",
      "aws.secretsmanager.secret",
      "aws.wafv2.alb-association",
      "aws.wafv2.web-acl",
    ]);

    render(<CloudMarkupDevelopmentGallery />);

    const iconBearingServices = awsCatalogV1
      .listServices()
      .filter((service) => service.iconId !== null);
    const iconSamples = within(
      screen.getByRole("list", { name: "Catalog provider icon samples" }),
    ).getAllByRole("listitem");

    expect(iconSamples).toHaveLength(iconBearingServices.length);
    for (const service of iconBearingServices) {
      const heading = screen.getByRole("heading", {
        level: 3,
        name: service.displayName,
      });
      expect(heading).toBeInTheDocument();
      const sample = heading.closest("li");
      if (sample === null) throw new Error("Expected the catalog icon sample.");
      if (unavailableArtworkServiceIds.has(service.id)) {
        expect(within(sample).getByText("Icon unavailable")).toBeVisible();
        expect(
          within(sample).queryByText("Approved local icon"),
        ).not.toBeInTheDocument();
      } else {
        expect(within(sample).getByText("Approved local icon")).toBeVisible();
        expect(
          within(sample).queryByText("Icon unavailable"),
        ).not.toBeInTheDocument();
      }
    }
    expect(screen.getAllByText("Approved local icon")).toHaveLength(
      iconBearingServices.length - unavailableArtworkServiceIds.size,
    );
    expect(screen.getAllByText("Icon unavailable")).toHaveLength(
      unavailableArtworkServiceIds.size,
    );
    expect(screen.queryByText("Icon pending approval")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Icon integrity check failed"),
    ).not.toBeInTheDocument();
  });
});
