import {
  ApiClientError,
  updateAccountProfileV1Schema,
  type AccountProfileV1,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { AccountProfileSettings } from "./AccountProfileSettings.js";
const principal: CurrentPrincipalV1 = {
  id: "principal_profile_form",
  displayName: "Original name",
  resourceVersion: 1,
  organizationContexts: [],
};
const initial: AccountProfileV1 = {
  contractVersion: 1,
  principalId: principal.id,
  displayName: principal.displayName,
  username: null,
  version: 1,
};
const tag = (version: number) =>
  '"profile:' + "a".repeat(32) + ":" + String(version) + '"';
const conflict = () =>
  new ApiClientError(412, {
    apiVersion: "v1",
    error: {
      code: "precondition_failed",
      message: "Reload profile.",
      correlationId: "correlation_profile",
    },
  });
function setup(writeOverride?: (input: unknown) => Promise<unknown>) {
  let saved = { ...initial };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const envelope = () => ({
    data: { apiVersion: "v1", data: saved },
    metadata: { etag: tag(saved.version) },
  });
  const requestWithMetadata = vi.fn(
    async (operation: string, input: unknown): Promise<unknown> => {
      if (operation === "account.photo.get")
        return {
          data: {
            apiVersion: "v1",
            data: {
              contractVersion: 1,
              principalId: principal.id,
              version: 0,
              image: null,
            },
          },
          metadata: { etag: '"photo:empty:0"' },
        };
      if (operation === "account.profile.get") return envelope();
      if (operation !== "account.profile.update")
        throw Error("Unexpected metadata request");
      if (writeOverride) return writeOverride(input);
      const request = input as {
        body: unknown;
        headers: Record<string, string>;
      };
      if (request.headers["if-match"] !== tag(saved.version)) throw conflict();
      const body = updateAccountProfileV1Schema.parse(request.body);
      saved = { ...saved, ...body, version: saved.version + 1 };
      return envelope();
    },
  );
  const request = vi.fn(() =>
    Promise.resolve({ data: { ...principal, displayName: saved.displayName } }),
  );
  const runtime = {
    queryClient,
    client: { requestWithMetadata, request },
  } as unknown as CloudMarkupQueryRuntime;
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AccountProfileSettings runtime={runtime} principal={principal} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    request,
    requestWithMetadata,
    queryClient,
    setSaved: (value: AccountProfileV1) => {
      saved = value;
    },
    envelope,
  };
}
afterEach(cleanup);
describe("verified account profile form", () => {
  it("saves with the loaded ETag and confirms profile plus current-principal readback", async () => {
    const f = setup();
    fireEvent.change(await screen.findByLabelText("Display name"), {
      target: { value: "Updated name" },
    });
    fireEvent.change(screen.getByLabelText("Username (optional)"), {
      target: { value: "New_User" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Profile saved.");
    expect(f.requestWithMetadata).toHaveBeenCalledWith(
      "account.profile.update",
      {
        headers: { "if-match": tag(1) },
        body: {
          contractVersion: 1,
          displayName: "Updated name",
          username: "new_user",
        },
      },
    );
    expect(screen.getByLabelText("Username (optional)")).toHaveValue(
      "new_user",
    );
    expect(f.request).toHaveBeenCalledWith("principal.get", {});
    expect(
      f.queryClient.getQueryData(cloudMarkupQueryKeys.currentPrincipal()),
    ).toMatchObject({ id: principal.id, displayName: "Updated name" });
  });
  it("keeps unsaved edits after a stale save and reloads only on explicit request", async () => {
    const f = setup();
    fireEvent.change(await screen.findByLabelText("Display name"), {
      target: { value: "My unsaved name" },
    });
    f.setSaved({
      ...initial,
      displayName: "Name from another tab",
      version: 2,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Display name")).toHaveValue(
      "My unsaved name",
    );
    expect(screen.queryByText("Profile saved.")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Reload saved profile" }),
    );
    await screen.findByText("Saved profile loaded.");
    expect(
      screen.getByRole("heading", { name: "Name from another tab" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Display name")).toHaveValue(
      "Name from another tab",
    );
  });
  it("does not disclose or confirm a write response bound to another account", async () => {
    const f = setup(() =>
      Promise.resolve({
        data: {
          data: {
            ...initial,
            principalId: "principal_foreign",
            displayName: "Foreign account",
          },
        },
        metadata: { etag: tag(2) },
      }),
    );
    fireEvent.change(await screen.findByLabelText("Display name"), {
      target: { value: "My name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Foreign account")).not.toBeInTheDocument();
    expect(f.request).not.toHaveBeenCalled();
    expect(
      f.queryClient.getQueryData(cloudMarkupQueryKeys.currentPrincipal()),
    ).toBeUndefined();
  });
  it("suppresses duplicate saves and ignores readback after leaving the account", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>((done) => {
      resolve = done;
    });
    const f = setup(() => pending);
    fireEvent.change(await screen.findByLabelText("Display name"), {
      target: { value: "Updated name" },
    });
    const button = screen.getByRole("button", { name: "Save profile" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => {
      expect(
        f.requestWithMetadata.mock.calls.filter(
          ([operation]) => operation === "account.profile.update",
        ),
      ).toHaveLength(1);
    });
    f.unmount();
    f.setSaved({ ...initial, displayName: "Updated name", version: 2 });
    await act(async () => {
      resolve(f.envelope());
      await pending;
    });
    expect(
      f.queryClient.getQueryData(cloudMarkupQueryKeys.currentPrincipal()),
    ).toBeUndefined();
  });
  it("rejects invalid usernames before sending a save", async () => {
    const f = setup();
    await screen.findByLabelText("Display name");
    fireEvent.change(screen.getByLabelText("Username (optional)"), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByRole("alert");
    expect(
      f.requestWithMetadata.mock.calls.filter(
        ([operation]) => operation === "account.profile.update",
      ),
    ).toHaveLength(0);
  });
});
