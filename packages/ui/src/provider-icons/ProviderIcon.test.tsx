import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createIconRegistry } from "./icon-registry.js";
import { NeutralProviderIcon } from "./NeutralProviderIcon.js";
import { ProviderIcon } from "./ProviderIcon.js";

const registry = createIconRegistry({
  assetSet: {
    id: "cloudmarkup.test.icons",
    providerId: "example.provider",
    version: "1.0.0",
    digest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  placeholderAsset: <NeutralProviderIcon data-testid="placeholder" />,
  registrations: [],
});

describe("ProviderIcon", () => {
  it("is decorative when adjacent text names the service", () => {
    render(
      <p>
        <ProviderIcon
          iconId="opaque.missing"
          registry={registry}
          serviceName="Example service"
        />
        Example service
      </p>,
    );

    expect(screen.getByText("Example service")).toBeInTheDocument();
    expect(screen.getByTestId("placeholder")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("has an accessible name when it conveys unique content", () => {
    render(
      <ProviderIcon
        decorative={false}
        iconId="opaque.missing"
        registry={registry}
        serviceName="Example service"
      />,
    );

    expect(
      screen.getByRole("img", {
        name: "Example service service icon placeholder",
      }),
    ).toHaveAttribute("data-placeholder-reason", "missing");
  });

  it("can render a named standalone neutral placeholder", () => {
    render(
      <NeutralProviderIcon
        decorative={false}
        label="Provider icon unavailable"
      />,
    );

    expect(
      screen.getByRole("img", { name: "Provider icon unavailable" }),
    ).toBeInTheDocument();
  });
});
