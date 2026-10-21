import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  MODE_SWITCH_ANNOUNCEMENTS,
  ModePreferenceProvider,
  getModePreferenceStorageKey,
  useModePreference,
} from "./index.js";
import type { ModePreferenceStorage } from "./index.js";

function PreferenceProbe() {
  const { announcement, mode, setMode, storageStatus } = useModePreference();

  return (
    <div>
      <output data-testid="mode">{mode}</output>
      <output data-testid="storage-status">{storageStatus}</output>
      <output data-testid="announcement">{announcement}</output>
      <button
        type="button"
        onClick={() => {
          setMode("guided");
        }}
      >
        Use Guided
      </button>
      <button
        type="button"
        onClick={() => {
          setMode("professional");
        }}
      >
        Use Professional
      </button>
    </div>
  );
}

function renderPreferenceProvider(
  options: {
    readonly actorId?: string;
    readonly storage?: ModePreferenceStorage | null;
  } = {},
) {
  const actorProps =
    options.actorId === undefined ? {} : { actorId: options.actorId };
  const storageProps =
    options.storage === undefined ? {} : { storage: options.storage };

  return render(
    <ModePreferenceProvider {...actorProps} {...storageProps}>
      <PreferenceProbe />
    </ModePreferenceProvider>,
  );
}

describe("ModePreferenceProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset["mode"];
    delete document.documentElement.dataset["cmDensity"];
  });

  it("defaults a new actor to Guided presentation without selecting density", () => {
    renderPreferenceProvider();

    expect(screen.getByTestId("mode")).toHaveTextContent("guided");
    expect(screen.getByTestId("storage-status")).toHaveTextContent("available");
    expect(document.documentElement).toHaveAttribute("data-mode", "guided");
    expect(document.documentElement).not.toHaveAttribute("data-cm-density");
  });

  it("persists a switch for only the current actor and announces parity", () => {
    const actorId = "actor with spaces";
    const otherActorKey = getModePreferenceStorageKey("another-actor");

    renderPreferenceProvider({ actorId });
    fireEvent.click(screen.getByRole("button", { name: "Use Professional" }));

    expect(
      window.localStorage.getItem(getModePreferenceStorageKey(actorId)),
    ).toBe("professional");
    expect(window.localStorage.getItem(otherActorKey)).toBeNull();
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      MODE_SWITCH_ANNOUNCEMENTS.professional,
    );
    expect(document.documentElement).toHaveAttribute(
      "data-mode",
      "professional",
    );
    expect(document.documentElement).not.toHaveAttribute("data-cm-density");
  });

  it("preserves density selected independently from presentation mode", () => {
    document.documentElement.dataset["cmDensity"] = "compact";
    const { unmount } = renderPreferenceProvider();

    fireEvent.click(screen.getByRole("button", { name: "Use Professional" }));

    expect(document.documentElement).toHaveAttribute(
      "data-cm-density",
      "compact",
    );

    unmount();
    expect(document.documentElement).toHaveAttribute(
      "data-cm-density",
      "compact",
    );
  });

  it("restores a valid persisted mode", () => {
    const actorId = "returning-actor";
    window.localStorage.setItem(
      getModePreferenceStorageKey(actorId),
      "professional",
    );

    renderPreferenceProvider({ actorId });

    expect(screen.getByTestId("mode")).toHaveTextContent("professional");
    expect(screen.getByTestId("storage-status")).toHaveTextContent("available");
    expect(screen.getByTestId("announcement")).toBeEmptyDOMElement();
  });

  it("falls back safely when stored preference reading fails", () => {
    const readFailureStorage: ModePreferenceStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        // A later user choice can still attempt to restore persistence.
      },
    };

    renderPreferenceProvider({ storage: readFailureStorage });

    expect(screen.getByTestId("mode")).toHaveTextContent("guided");
    expect(screen.getByTestId("storage-status")).toHaveTextContent(
      "read-failed",
    );
  });

  it("keeps the selected session mode when preference writing fails", () => {
    const writeFailureStorage: ModePreferenceStorage = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error("blocked");
      },
    };

    renderPreferenceProvider({ storage: writeFailureStorage });
    fireEvent.click(screen.getByRole("button", { name: "Use Professional" }));

    expect(screen.getByTestId("mode")).toHaveTextContent("professional");
    expect(screen.getByTestId("storage-status")).toHaveTextContent(
      "write-failed",
    );
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      MODE_SWITCH_ANNOUNCEMENTS.professional,
    );
  });

  it("treats an invalid stored mode as a failed restore", () => {
    window.localStorage.setItem(
      getModePreferenceStorageKey(),
      "architecture-changing-mode",
    );

    renderPreferenceProvider();

    expect(screen.getByTestId("mode")).toHaveTextContent("guided");
    expect(screen.getByTestId("storage-status")).toHaveTextContent(
      "read-failed",
    );
  });

  it("rejects access outside its provider", () => {
    expect(() => render(<PreferenceProbe />)).toThrow(
      new Error(
        "useModePreference must be used within a ModePreferenceProvider.",
      ),
    );
  });
});
