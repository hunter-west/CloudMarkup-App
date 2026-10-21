import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  EditorRecoveryContext,
  type EditorRecoveryContextValue,
} from "./persistence/editor-recovery-context.js";
import { DevelopmentFixtureStatus } from "./DevelopmentFixtureStatus.js";

const diagnostic = {
  classification: "envelope-malformed",
  diagnostics: [
    {
      code: "malformed-envelope",
      message: "The stored recovery envelope is malformed.",
      path: "$",
    },
  ],
  kind: "cloudmarkup.editor-recovery-diagnostic",
  schemaVersion: 1,
} as const;

function renderStatus(
  value: Omit<EditorRecoveryContextValue, "documentChanged">,
  serverBacked = false,
) {
  return render(
    <EditorRecoveryContext.Provider
      value={{ ...value, documentChanged: () => undefined }}
    >
      <DevelopmentFixtureStatus serverBacked={serverBacked} />
    </EditorRecoveryContext.Provider>,
  );
}

describe("DevelopmentFixtureStatus", () => {
  it("keeps routine browser-only save feedback compact and exposes its scope in details", () => {
    renderStatus({
      discardLocalDraft: () => Promise.resolve(false),
      downloadDiagnosticCopy: () => false,
      recoverSafeCheckpoint: () => Promise.resolve(false),
      state: {
        hasPendingChanges: false,
        lastSavedAt: "2026-07-30T13:00:00Z",
        message: "Local recovery checkpoint saved.",
        recovered: false,
        status: "saved",
      },
    });
    const status = screen.getByRole("region", {
      name: "Development fixture status",
    });
    expect(status).toHaveAttribute("data-attention", "false");
    expect(status).toHaveTextContent("Saved in this browser");
    expect(status).toHaveTextContent(
      "backend persistence is not implemented yet",
    );
    expect(status.querySelector("summary")).not.toHaveTextContent(
      "Local recovery checkpoint saved.",
    );
  });

  it("keeps successful server-backed recovery in the save details instead of a development banner", () => {
    renderStatus(
      {
        discardLocalDraft: () => Promise.resolve(false),
        downloadDiagnosticCopy: () => false,
        recoverSafeCheckpoint: () => Promise.resolve(false),
        state: {
          hasPendingChanges: false,
          lastSavedAt: "2026-07-30T13:00:00Z",
          message: "Local recovery checkpoint saved.",
          recovered: false,
          status: "saved",
        },
      },
      true,
    );

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps server-backed recovery failures and recovery actions visible without false backend claims", () => {
    const recoverSafeCheckpoint = vi.fn(() => Promise.resolve(true));
    renderStatus(
      {
        discardLocalDraft: () => Promise.resolve(false),
        downloadDiagnosticCopy: () => false,
        recoverSafeCheckpoint,
        state: {
          classification: "envelope-malformed",
          diagnostic,
          hasPendingChanges: false,
          message: "A local draft could not be loaded safely.",
          status: "recovery-required",
        },
      },
      true,
    );

    expect(
      screen.getByRole("region", { name: "Local recovery status" }),
    ).toBeVisible();
    expect(
      screen.queryByText(/backend persistence is not implemented yet/),
    ).toBeNull();
    expect(
      screen.getByText(/server draft status is tracked separately/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recover safe copy" }));
    expect(recoverSafeCheckpoint).toHaveBeenCalledOnce();
  });

  it("offers all corrupt-draft actions and invokes the CAS-backed handlers", () => {
    const recoverSafeCheckpoint = vi.fn(() => Promise.resolve(true));
    const discardLocalDraft = vi.fn(() => Promise.resolve(true));
    const downloadDiagnosticCopy = vi.fn(() => true);
    renderStatus({
      discardLocalDraft,
      downloadDiagnosticCopy,
      recoverSafeCheckpoint,
      state: {
        classification: "envelope-malformed",
        diagnostic,
        hasPendingChanges: false,
        message: "A local draft could not be loaded safely.",
        status: "recovery-required",
      },
    });

    expect(
      screen.getByRole("button", { name: "Recover safe copy" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Discard local draft" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Download diagnostic copy" }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Recover safe copy" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Discard local draft" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Download diagnostic copy" }),
    );

    expect(recoverSafeCheckpoint).toHaveBeenCalledOnce();
    expect(discardLocalDraft).toHaveBeenCalledOnce();
    expect(downloadDiagnosticCopy).toHaveBeenCalledOnce();
  });
});
