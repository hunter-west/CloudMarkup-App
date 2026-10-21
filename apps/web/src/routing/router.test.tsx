import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppLink } from "./AppLink.js";
import { useAppLocation, useNavigate, useRouteMatch } from "./hooks.js";
import { encodeRouteSelector, resolveAppDestination } from "./location.js";
import { RouterProvider } from "./RouterProvider.js";

function RouterProbe() {
  const location = useAppLocation();
  const route = useRouteMatch();

  return (
    <output aria-label="Current route">
      {JSON.stringify({ location, params: route.params, routeId: route.id })}
    </output>
  );
}

function NavigationControl() {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => {
        navigate("/denied", { replace: true });
      }}
    >
      Replace with denied
    </button>
  );
}

describe("RouterProvider", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/sign-in");
  });

  it("matches the site root as the public product landing route", () => {
    window.history.replaceState(null, "", "/");

    render(
      <RouterProvider>
        <RouterProbe />
      </RouterProvider>,
    );

    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      '"routeId":"landing"',
    );
  });

  it("uses pushState for an ordinary AppLink click", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    render(
      <RouterProvider>
        <AppLink to="/organizations/org-1/templates/?view=curated">
          Templates
        </AppLink>
        <RouterProbe />
      </RouterProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Templates" }));

    expect(pushState).toHaveBeenCalledWith(
      null,
      "",
      "/organizations/org-1/templates?view=curated",
    );
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      '"routeId":"templates"',
    );
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      '"search":"?view=curated"',
    );
    expect(window.history.state).toBeNull();
  });

  it("uses replaceState when requested through the navigation hook", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");

    render(
      <RouterProvider>
        <NavigationControl />
        <RouterProbe />
      </RouterProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Replace with denied" }),
    );

    expect(replaceState).toHaveBeenCalledWith(null, "", "/denied");
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      '"routeId":"denied"',
    );
  });

  it("does not intercept modified clicks or links targeting another context", () => {
    render(
      <RouterProvider>
        <AppLink to="/unsupported">Unsupported</AppLink>
        <AppLink target="_blank" to="/settings/profile">
          Profile in new tab
        </AppLink>
      </RouterProvider>,
    );

    const modifiedClick = createEvent.click(
      screen.getByRole("link", { name: "Unsupported" }),
      {
        bubbles: true,
        button: 0,
        cancelable: true,
        ctrlKey: true,
      },
    );
    fireEvent(screen.getByRole("link", { name: "Unsupported" }), modifiedClick);

    const targetedClick = createEvent.click(
      screen.getByRole("link", { name: "Profile in new tab" }),
      {
        bubbles: true,
        button: 0,
        cancelable: true,
      },
    );
    fireEvent(
      screen.getByRole("link", { name: "Profile in new tab" }),
      targetedClick,
    );

    expect(modifiedClick.defaultPrevented).toBe(false);
    expect(targetedClick.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe("/sign-in");
  });

  it("updates after browser popstate without replaying navigation state", () => {
    render(
      <RouterProvider>
        <RouterProbe />
      </RouterProvider>,
    );

    window.history.pushState(
      { ignoredAction: "export" },
      "",
      "/organizations/org-1/projects/project-1/revisions/revision-2?tab=graph",
    );
    fireEvent.popState(window);

    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      '"routeId":"project-revision"',
    );
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      '"revisionId":"revision-2"',
    );
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      '"search":"?tab=graph"',
    );
  });
});

describe("resolveAppDestination", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/settings/profile");
  });

  it("accepts presentation-only query and fragment destinations", () => {
    expect(resolveAppDestination("?density=compact#mode")).toEqual({
      href: "/settings/profile?density=compact#mode",
      location: {
        hash: "#mode",
        pathname: "/settings/profile",
        search: "?density=compact",
      },
    });
  });

  it("rejects external and non-path destinations", () => {
    expect(() => resolveAppDestination("https://example.com/denied")).toThrow(
      /same-origin path/u,
    );
    expect(() => resolveAppDestination("//example.com/denied")).toThrow(
      /current origin/u,
    );
    expect(() => resolveAppDestination("javascript:alert(1)")).toThrow(
      /same-origin path/u,
    );
  });
});

describe("encodeRouteSelector", () => {
  it("keeps untrusted selectors inside one path segment", () => {
    expect(encodeRouteSelector("../project?tab=secret#details")).toBe(
      "..%2Fproject%3Ftab%3Dsecret%23details",
    );
  });
});
