import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RouterProvider } from "../../routing/RouterProvider.js";
import { TemplateDetailPage, TemplatesPage } from "./TemplatePages.js";

function renderPage(page: React.ReactNode) {
  return render(<RouterProvider>{page}</RouterProvider>);
}

describe("event-driven product templates", () => {
  it("renders reviewed delivery and readiness without inventing handler source", () => {
    renderPage(
      <TemplateDetailPage
        organizationId="org-production-42"
        templateId="queue-consumer-with-dlq"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Queue consumer with DLQ" }),
    ).toBeVisible();
    expect(screen.getByText(/partial batch failure/u)).toBeVisible();
    expect(
      screen.getByText(/complete-supported SQS batch Workload/u),
    ).toBeVisible();
    expect(
      screen.getByText(/do not claim a durable replay store/u),
    ).toBeVisible();
    expect(
      screen.getByText(/revising the Workload and implementing/u),
    ).toBeVisible();
    expect(
      screen.getByText(/source coverage remains starter-application/u),
    ).toBeVisible();
    expect(
      screen.getByText(/final Lambda ZIP evidence-confirmed complete/u),
    ).toBeVisible();
    expect(
      screen.queryByText(/pending until Prompt 45A/u),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create project from template" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Project creation permission is required/iu),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Open template in editor" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Return to templates" }),
    ).toHaveAttribute("href", "/organizations/org-production-42/templates");
  });

  it("preserves explicit local template fixtures only when requested", () => {
    renderPage(
      <TemplateDetailPage
        localFixturesEnabled
        organizationId="local-org"
        templateId="queue-consumer-with-dlq"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Open template in editor" }),
    ).toHaveAttribute(
      "href",
      "/organizations/local-org/projects/field-notes/editor?start=event-template&template=queue-consumer-with-dlq",
    );
    expect(
      screen.queryByRole("button", { name: "Create project from template" }),
    ).not.toBeInTheDocument();
  });

  it("uses the selected organization for unavailable-template return links", () => {
    renderPage(
      <TemplateDetailPage
        organizationId="org-production-42"
        templateId="not-in-the-catalog"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Return to templates" }),
    ).toHaveAttribute("href", "/organizations/org-production-42/templates");
  });

  it("keeps the Notes API walkthrough as an explicit local fixture", () => {
    renderPage(
      <TemplatesPage localFixturesEnabled organizationId="local-org" />,
    );

    expect(
      screen.getByRole("heading", { name: "Notes API walkthrough" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open local notes template" }),
    ).toHaveAttribute(
      "href",
      "/organizations/local-org/projects/field-notes/editor?start=template",
    );
  });
});
