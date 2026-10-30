import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import { EditorMain } from "./app/DeferredRoutes.js";

const modules = vi.hoisted(() => {
  let resolve: (() => void) | undefined;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    pending,
    finish: () => {
      resolve?.();
    },
    editor: vi.fn(),
    main: vi.fn(),
    revisions: vi.fn(),
    exports: vi.fn(),
    mounted: vi.fn(),
  };
});

vi.mock("./features/editor/EditorRoute.js", async () => {
  modules.editor();
  await modules.pending;
  const { AppShell } = await import("./shell/AppShell.js");
  const { RoutePage } = await import("./shell/RoutePage.js");
  return {
    EditorRoute: () => {
      modules.mounted();
      return (
        <AppShell>
          <RoutePage title="Deferred editor fixture" routeKey="fixture">
            <p>Editor loaded</p>
          </RoutePage>
        </AppShell>
      );
    },
  };
});
vi.mock("./features/editor/EditorWorkspace.js", () => {
  modules.main();
  return { EditorMain: () => <p>Editor main fixture</p> };
});
vi.mock("./features/revisions/RevisionPages.js", () => {
  modules.revisions();
  throw new Error("private revision chunk URL");
});
vi.mock("./features/exports/ExportPages.js", () => {
  modules.exports();
  return { ArtifactReviewPage: () => <p>Export fixture</p> };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("application deferred routes", () => {
  it("keeps login and account navigation eager and does not mount an abandoned editor load", async () => {
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1440,
    });
    window.history.replaceState(null, "", "/sign-in");
    const view = render(<App />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(modules.editor).not.toHaveBeenCalled();
    expect(modules.main).not.toHaveBeenCalled();
    expect(modules.revisions).not.toHaveBeenCalled();
    expect(modules.exports).not.toHaveBeenCalled();
    view.unmount();
    window.history.replaceState(
      null,
      "",
      "/organizations/local-org/projects/field-notes",
    );
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: "Open editor shell" }));
    expect(
      await screen.findByText("Loading architecture editor…"),
    ).toBeVisible();
    expect(
      screen.queryByRole("navigation", { name: "Primary navigation" }),
    ).not.toBeInTheDocument();
    expect(modules.editor).toHaveBeenCalledTimes(1);
    expect(modules.main).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Dashboard home" }));
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Primary navigation" }),
      ).getByRole("link", { name: "Personal & organizations" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Organizations" }),
    ).toHaveFocus();
    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    fireEvent.click(
      within(navigation).getByRole("link", { name: "Preferences" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Experience preferences" }),
    ).toHaveFocus();
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Primary navigation" }),
      ).getByRole("link", { name: "Projects" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Projects" }),
    ).toBeVisible();
    await act(async () => {
      modules.finish();
      await modules.pending;
    });
    expect(modules.mounted).not.toHaveBeenCalled();
    expect(screen.queryByText("Editor loaded")).not.toBeInTheDocument();
    expect(modules.revisions).not.toHaveBeenCalled();
    expect(modules.exports).not.toHaveBeenCalled();
    act(() => {
      window.history.pushState(
        null,
        "",
        "/organizations/local-org/projects/field-notes/editor",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      await screen.findByRole("heading", { name: "Deferred editor fixture" }),
    ).toBeVisible();
    expect(modules.editor).toHaveBeenCalledTimes(1);
  });

  it("loads the separate editor-main entry point only when it is rendered", async () => {
    expect(modules.main).not.toHaveBeenCalled();
    render(<EditorMain projectId="field-notes" />);
    expect(await screen.findByText("Editor main fixture")).toBeVisible();
    expect(modules.main).toHaveBeenCalledTimes(1);
  });

  it("retains the shell and navigation when a revision chunk fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.history.replaceState(
      null,
      "",
      "/organizations/local-org/projects/field-notes/revisions",
    );
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "Revision history could not load",
      }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Reload this view" }),
    ).toBeEnabled();
    expect(document.body.textContent).not.toContain(
      "private revision chunk URL",
    );
    fireEvent.click(screen.getByRole("link", { name: "Dashboard home" }));
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Primary navigation" }),
      ).getByRole("link", { name: "Preferences" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Experience preferences" }),
    ).toHaveFocus();
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible();
  });
});
