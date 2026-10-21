import { ApiClientError } from "@cloudmarkup/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  type CloudMarkupQueryRuntime,
  cloudMarkupQueryKeys,
} from "../../api/index.js";
import { AccountPhotoSettings } from "./AccountPhotoSettings.js";
import { prepareAccountPhoto } from "./account-photo.js";
vi.mock("./account-photo.js", async (original) => ({
  ...(await original<typeof import("./account-photo.js")>()),
  prepareAccountPhoto: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const actor = "principal_photo_form",
  image = "data:image/png;base64,AAAA";
const tag = (version: number) => '"photo:form:' + String(version) + '"';
function setup(
  options: {
    readonly failLoad?: boolean;
    readonly failSave?: boolean;
    readonly mismatch?: boolean;
  } = {},
) {
  let value = {
    contractVersion: 1 as const,
    principalId: actor,
    version: 0,
    image: null as string | null,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const envelope = () => ({
    data: { apiVersion: "v1", data: value },
    metadata: { etag: tag(value.version) },
  });
  const requestWithMetadata = vi.fn(
    async (operation: string, input: unknown): Promise<unknown> => {
      await Promise.resolve();
      if (operation === "account.photo.get") {
        if (options.failLoad) throw Error("Unavailable");
        return options.mismatch
          ? {
              ...envelope(),
              data: {
                apiVersion: "v1",
                data: { ...value, principalId: "principal_foreign" },
              },
            }
          : envelope();
      }
      if (operation !== "account.photo.update")
        throw Error("Unexpected operation");
      if (options.failSave)
        throw new ApiClientError(412, {
          apiVersion: "v1",
          error: {
            code: "precondition_failed",
            message: "Changed",
            correlationId: "correlation_photo",
          },
        });
      const request = input as {
        readonly body: { readonly image: string | null };
        readonly headers: Record<string, string>;
      };
      expect(request.headers["if-match"]).toBe(tag(value.version));
      value = {
        ...value,
        version: value.version + 1,
        image: request.body.image,
      };
      return envelope();
    },
  );
  const runtime = {
    queryClient,
    client: { requestWithMetadata },
    sessionExpired: false,
    expireSession: vi.fn(),
  } as unknown as CloudMarkupQueryRuntime;
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AccountPhotoSettings
        runtime={runtime}
        principalId={actor}
        displayName="Morgan Example"
      />
    </QueryClientProvider>,
  );
  return { ...view, requestWithMetadata, queryClient, value: () => value };
}
async function choose() {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeEnabled();
  });
  fireEvent.change(screen.getByLabelText("Choose profile photo"), {
    target: {
      files: [new File(["synthetic"], "photo.png", { type: "image/png" })],
    },
  });
}
it.each([{ failLoad: true }, { mismatch: true }])(
  "disables changes when the private saved-photo read fails or belongs to another identity: %j",
  async (options) => {
    const f = setup(options);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Change photo" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save photo" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("ME")).toBeVisible();
    expect(f.requestWithMetadata).not.toHaveBeenCalledWith(
      "account.photo.update",
      expect.anything(),
    );
  },
);
it("keeps cancellation authoritative while image decoding is pending and restores focus", async () => {
  let resolve!: (value: string) => void;
  vi.mocked(prepareAccountPhoto).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const f = setup();
  await choose();
  expect(screen.getByRole("button", { name: "Upload photo" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel photo preview" }));
  await act(async () => {
    resolve(image);
    await Promise.resolve();
  });
  expect(
    screen.queryByRole("img", { name: "New profile preview" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Upload photo" })).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("has not changed");
  expect(f.value().image).toBeNull();
});
it("applies a saved photo only after matching private readback and removes it with a fresh version", async () => {
  vi.mocked(prepareAccountPhoto).mockResolvedValue(image);
  const f = setup();
  await choose();
  await screen.findByRole("img", { name: "New profile preview" });
  expect(f.value().image).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save photo" }));
  await screen.findByText("Profile photo saved.");
  expect(
    f.queryClient.getQueryData(cloudMarkupQueryKeys.accountPhoto(actor)),
  ).toMatchObject({
    value: { principalId: actor, image, version: 1 },
    etag: tag(1),
  });
  expect(
    screen.queryByRole("img", { name: "New profile preview" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
  await screen.findByText("Profile photo removed.");
  expect(f.value()).toMatchObject({ image: null, version: 2 });
  expect(screen.getByRole("button", { name: "Upload photo" })).toHaveFocus();
});
it("preserves the preview and saved identity on a version conflict", async () => {
  vi.mocked(prepareAccountPhoto).mockResolvedValue(image);
  const f = setup({ failSave: true });
  await choose();
  fireEvent.click(await screen.findByRole("button", { name: "Save photo" }));
  await screen.findByRole("alert");
  expect(
    screen.getByRole("img", { name: "New profile preview" }),
  ).toBeVisible();
  expect(screen.queryByText("Profile photo saved.")).not.toBeInTheDocument();
  expect(f.value().image).toBeNull();
});
