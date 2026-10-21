import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../App.js";
import { LocalOwnerBrowserSession } from "./local-owner-browser-auth.js";

const proof = "A".repeat(43);
const token = `cmlo1_${"B".repeat(43)}`;

describe("local owner sign-in presentation", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/sign-in");
  });

  it("shows a local-only proof form and returns to the authorized path", async () => {
    const destination = "/organizations/org_test/projects/project_test";
    window.history.replaceState(
      null,
      "",
      "/sign-in?" + new URLSearchParams({ returnTo: destination }).toString(),
    );
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          accessToken: token,
          expiresAt: new Date(Date.now() + 28_800_000).toISOString(),
          expiresIn: 28_800,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const session = new LocalOwnerBrowserSession(
      fetchImplementation,
      "http://127.0.0.1:4173",
    );

    render(<App localOwnerSession={session} />);
    expect(
      screen.getByRole("heading", { name: "Sign in to local CloudMarkup" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Sign in securely" }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Local owner proof"), {
      target: { value: proof },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in locally" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(destination);
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(session.getValidAccessToken()).toBe(token);
  });

  it("shows a retryable error without retaining the entered proof", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          error: "rejected",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    const session = new LocalOwnerBrowserSession(
      fetchImplementation,
      "http://127.0.0.1:4173",
    );

    render(<App localOwnerSession={session} />);
    const proofField = screen.getByLabelText("Local owner proof");
    fireEvent.change(proofField, { target: { value: proof } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in locally" }));
    await screen.findByRole("alert");
    expect(proofField).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Sign in locally" }),
    ).toBeEnabled();
    expect(session.getValidAccessToken()).toBeUndefined();
  });

  it("routes an unauthenticated private visit to local sign-in", async () => {
    const destination = "/settings/profile";
    window.history.replaceState(null, "", destination);
    const session = new LocalOwnerBrowserSession(
      vi.fn(),
      "http://127.0.0.1:4173",
    );
    render(<App localOwnerSession={session} />);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/sign-in");
    });
    expect(
      screen.getByRole("heading", { name: "Sign in to local CloudMarkup" }),
    ).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("returnTo")).toBe(
      destination,
    );
  });
});
