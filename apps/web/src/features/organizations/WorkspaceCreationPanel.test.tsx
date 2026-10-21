import type { CurrentPrincipalV1 } from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { WorkspaceCreationPanel } from "./WorkspaceCreationPanel.js";
const principal: CurrentPrincipalV1 = {
  id: "principal_creation",
  displayName: "Synthetic owner",
  resourceVersion: 1,
  organizationContexts: [],
};
const created = {
  contractVersion: 1,
  principalId: principal.id,
  id: "org_created",
  displayName: "Example",
  kind: "organization",
  role: "owner",
};
const current: CurrentPrincipalV1 = {
  ...principal,
  organizationContexts: [
    {
      organizationId: created.id,
      membershipId: "membership_created",
      isOwner: true,
      role: "owner",
      capabilities: ["organizations.read", "projects.read"],
    },
  ],
};
function setup(
  action: (operation: string, input: unknown) => Promise<unknown> = () =>
    Promise.resolve({ data: created }),
) {
  const queryClient = new QueryClient();
  const request = vi.fn((operation: string, input: unknown) =>
    operation === "principal.get"
      ? Promise.resolve({ data: current })
      : action(operation, input),
  );
  const runtime = {
    queryClient,
    client: { request },
  } as unknown as CloudMarkupQueryRuntime;
  const view = render(
    <WorkspaceCreationPanel
      runtime={runtime}
      principal={principal}
      hasPersonal
      disabled={false}
    />,
  );
  return { ...view, queryClient, request };
}
afterEach(cleanup);
describe("verified workspace creation", () => {
  it("creates only the chosen name and requires current identity readback before confirming", async () => {
    const f = setup();
    fireEvent.change(screen.getByLabelText("Organization name"), {
      target: { value: "Example" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );
    await screen.findByText(
      "Your organization is ready. Open its settings to manage members.",
    );
    expect(f.request).toHaveBeenCalledWith("account.organizations.create", {
      body: { contractVersion: 1, displayName: "Example" },
      headers: {
        "idempotency-key": expect.stringMatching(/^workspace-/u) as unknown,
      },
    });
    expect(
      f.queryClient.getQueryData(cloudMarkupQueryKeys.currentPrincipal()),
    ).toEqual(current);
    expect(screen.getByLabelText("Organization name")).toHaveValue("");
  });
  it("keeps the same retry identity after an uncertain response", async () => {
    const f = setup(() => Promise.reject(Error("Unknown result")));
    fireEvent.change(screen.getByLabelText("Organization name"), {
      target: { value: "Example" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );
    await waitFor(() => {
      expect(f.request).toHaveBeenCalledTimes(2);
    });
    expect(f.request.mock.calls[0]?.[1]).toEqual(f.request.mock.calls[1]?.[1]);
  });
  it("suppresses double clicks and discards a late response after leaving the account", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    const f = setup(() => pending);
    fireEvent.change(screen.getByLabelText("Organization name"), {
      target: { value: "Example" },
    });
    const button = screen.getByRole("button", { name: "Create organization" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(f.request).toHaveBeenCalledOnce();
    f.unmount();
    await act(async () => {
      resolve({ data: created });
      await pending;
    });
    expect(
      f.queryClient.getQueryData(cloudMarkupQueryKeys.currentPrincipal()),
    ).toBeUndefined();
  });
  it("refuses another actor's creation response without changing the session", async () => {
    const f = setup(() =>
      Promise.resolve({
        data: { ...created, principalId: "principal_foreign" },
      }),
    );
    fireEvent.change(screen.getByLabelText("Organization name"), {
      target: { value: "Example" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );
    await screen.findByRole("alert");
    expect(f.request).toHaveBeenCalledOnce();
    expect(
      f.queryClient.getQueryData(cloudMarkupQueryKeys.currentPrincipal()),
    ).toBeUndefined();
  });
});
