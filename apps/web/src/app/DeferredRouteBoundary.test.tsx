import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { lazy, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "./AppErrorBoundary.js";
import { DeferredRouteBoundary } from "./DeferredRouteBoundary.js";
import { loadDeferredRouteModule } from "./deferred-route-loader.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("deferred route boundary", () => {
  it("announces a compact loading view, then preserves mounted state on parent renders", async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const load = vi.fn(async () => {
      await pending;
      return { default: Counter };
    });
    const View = lazy(() => loadDeferredRouteModule(load));
    function Counter() {
      const [count, setCount] = useState(0);
      return (
        <button
          onClick={() => {
            setCount(count + 1);
          }}
        >
          Local edits {count}
        </button>
      );
    }
    const content = () => (
      <DeferredRouteBoundary title="Architecture editor">
        <View />
      </DeferredRouteBoundary>
    );
    const view = render(content());
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading architecture editor",
    );
    expect(document.title).toBe("Loading architecture editor");
    await act(async () => {
      finish?.();
      await pending;
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Local edits 0" }),
    );
    view.rerender(content());
    expect(screen.getByRole("button", { name: "Local edits 1" })).toBeVisible();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not classify ordinary loaded-view rendering failures as chunk failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function BrokenView(): never {
      throw new Error("private render detail");
    }
    const View = lazy(() =>
      loadDeferredRouteModule(() => Promise.resolve({ default: BrokenView })),
    );
    render(
      <AppErrorBoundary>
        <DeferredRouteBoundary title="Architecture editor">
          <View />
        </DeferredRouteBoundary>
      </AppErrorBoundary>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "This view could not be rendered",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Reload this view" }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("private render detail");
  });
});
