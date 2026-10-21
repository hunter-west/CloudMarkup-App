import { parseIntentDocument } from "@cloudmarkup/domain";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { acceptedIntentV1Schema } from "@cloudmarkup/api-contract";
import { AI_INTENT_PREVIEW_SSE_EVENT_V1 } from "@cloudmarkup/api-contract";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiIntentPreviewPanel } from "./AiIntentPreviewPanel.js";
import { createSyntheticAiPreviewCandidate } from "./ai-intent-preview-test-helpers.js";

const authority = {
  principalId: "principal_preview",
  sessionId: "view_preview",
  projectId: "project_preview",
  draftEtag: '"draft:draft_preview:v1"',
  editingProof: {
    leaseId: "projectlease_00000000-0000-4000-8000-000000000001",
    token: "A".repeat(43),
  },
  accessToken: "synthetic-access-token",
};
const invocationId = "preview_panel_synthetic";
const frame = () => createSyntheticAiPreviewCandidate(invocationId);
const wire = (value: unknown) =>
  new TextEncoder().encode(
    `event: ${AI_INTENT_PREVIEW_SSE_EVENT_V1}\ndata: ${JSON.stringify(value)}\n\n`,
  );
const status = (code: string) => ({ contractVersion: 1, type: "status", code });
function stream() {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const value of [status("processing"), frame(), status("finished")])
          controller.enqueue(Uint8Array.from(wire(value)));
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "private, no-store, no-transform",
        "content-security-policy": "sandbox",
        "x-content-type-options": "nosniff",
        "x-cloudmarkup-preview-invocation-id": invocationId,
      },
    },
  );
}
function submit() {
  fireEvent.change(
    screen.getByRole("textbox", { name: "What do you want to build?" }),
    { target: { value: "A small synthetic notes API." } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview requirements" }));
}
afterEach(() => {
  vi.restoreAllMocks();
});
describe("mounted requirements preview", () => {
  it("receives and reviews a candidate through the real stream consumer without saving content", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const fetcher = vi
      .spyOn(window, "fetch")
      .mockResolvedValueOnce(stream())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            apiVersion: "v1",
            data: { contractVersion: 1, state: "acknowledged" },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    render(
      <AiIntentPreviewPanel
        projectId={authority.projectId}
        currentAuthority={() => authority}
        requestedMode="professional"
      />,
    );
    submit();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Preview received. Review the requirements below",
      );
    });
    expect(
      screen.getByRole("region", { name: "Extracted requirements" }),
    ).toBeVisible();
    expect(
      screen.getByText(frame().candidate.intentDocument.application.summary),
    ).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.body).toContain(
      '"requestedMode":"professional"',
    );
    expect(fetcher.mock.calls[1]?.[1]?.body).not.toContain(
      "A small synthetic notes API.",
    );
    expect(storage).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /accept|save|apply/iu }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard preview" }));
    expect(
      screen.queryByRole("region", { name: "Extracted requirements" }),
    ).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retains a received candidate when acknowledgement fails", async () => {
    vi.spyOn(window, "fetch")
      .mockResolvedValueOnce(stream())
      .mockRejectedValueOnce(new Error("Disconnected"));
    render(
      <AiIntentPreviewPanel
        projectId={authority.projectId}
        currentAuthority={() => authority}
      />,
    );
    submit();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "delivery confirmation is incomplete",
      );
    });
    expect(
      screen.getByRole("region", { name: "Extracted requirements" }),
    ).toBeVisible();
  });
  it("keeps an already received preview visible after editing access is lost", async () => {
    const fetcher = vi
      .spyOn(window, "fetch")
      .mockResolvedValueOnce(stream())
      .mockRejectedValueOnce(new Error("Disconnected"));
    const view = render(
      <AiIntentPreviewPanel
        projectId={authority.projectId}
        currentAuthority={() => authority}
      />,
    );
    submit();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "delivery confirmation is incomplete",
      );
    });
    view.rerender(
      <AiIntentPreviewPanel
        projectId={authority.projectId}
        currentAuthority={() => undefined}
        editingAvailable={false}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Extracted requirements" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Preview requirements" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard preview" }),
    ).toBeEnabled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not request a model with missing authority or an empty prompt", () => {
    const fetcher = vi.spyOn(window, "fetch");
    const view = render(
      <AiIntentPreviewPanel
        projectId={authority.projectId}
        currentAuthority={() => undefined}
      />,
    );
    submit();
    expect(
      screen.getByRole("button", { name: "Preview requirements" }),
    ).toBeDisabled();
    expect(fetcher).not.toHaveBeenCalled();
    view.unmount();
    render(
      <AiIntentPreviewPanel
        projectId={authority.projectId}
        currentAuthority={() => authority}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Preview requirements" }),
    ).toBeDisabled();
  });
  it.each(["cancel", "unmount"] as const)(
    "aborts the request on %s without retrying",
    async (action) => {
      let signal: AbortSignal | null | undefined;
      const fetcher = vi
        .spyOn(window, "fetch")
        .mockImplementation((_url, init) => {
          signal = init?.signal;
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                reject(new Error("Aborted"));
              },
              { once: true },
            );
          });
        });
      const view = render(
        <AiIntentPreviewPanel
          projectId={authority.projectId}
          currentAuthority={() => authority}
        />,
      );
      submit();
      await waitFor(() => {
        expect(fetcher).toHaveBeenCalledTimes(1);
      });
      if (action === "cancel")
        fireEvent.click(screen.getByRole("button", { name: "Stop preview" }));
      else view.unmount();
      await act(async () => {
        await Promise.resolve();
      });
      expect(signal?.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      if (action === "cancel")
        await waitFor(() => {
          expect(screen.getByRole("status")).toHaveTextContent(
            "Preview stopped",
          );
        });
    },
  );
});

function acceptanceFixture() {
  const candidate = frame().candidate;
  const intentDocument = parseIntentDocument(candidate.intentDocument);
  return acceptedIntentV1Schema.parse({
    contractVersion: 1,
    acceptedIntentId: "accepted_intent_" + "a".repeat(48),
    projectId: authority.projectId,
    createdAt: "2026-09-11T12:00:00.000Z",
    createdByPrincipalId: authority.principalId,
    sourceDraftId: "draft_preview",
    sourceDraftVersion: 1,
    invocationId: candidate.provenance.invocationId,
    outputDigest: digestCanonicalValue(candidate),
    intentDigest: digestCanonicalValue(intentDocument),
    intentDocument,
  });
}
function acceptanceTransport() {
  return vi
    .spyOn(window, "fetch")
    .mockResolvedValueOnce(stream())
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          apiVersion: "v1",
          data: { contractVersion: 1, state: "acknowledged" },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
}
describe("explicit requirements acceptance", () => {
  it("saves only on the reviewer's action and clears the temporary prompt after exact acceptance", async () => {
    acceptanceTransport();
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const onAccept = vi.fn().mockResolvedValue(acceptanceFixture());
    render(
      <AiIntentPreviewPanel
        projectId={authority.projectId}
        currentAuthority={() => authority}
        onAccept={onAccept}
      />,
    );
    submit();
    const button = await screen.findByRole("button", {
      name: "Accept and save requirements",
    });
    await waitFor(() => expect(button).toBeEnabled());
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(
      await screen.findByRole("heading", { name: "Accepted requirements" }),
    ).toBeVisible();
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0]?.[0]).toEqual({
      contractVersion: 1,
      candidate: frame().candidate,
      editingProof: authority.editingProof,
    });
    expect(onAccept.mock.calls[0]?.[1]).toHaveProperty(
      "if-match",
      authority.draftEtag,
    );
    expect(onAccept.mock.calls[0]?.[1]).toHaveProperty("idempotency-key");
    expect(
      screen.getByRole("textbox", { name: "What do you want to build?" }),
    ).toHaveValue("");
    expect(storage).not.toHaveBeenCalled();
  });
  it("reuses the exact candidate, baseline and idempotency key after an ambiguous failure", async () => {
    acceptanceTransport();
    const onAccept = vi
      .fn()
      .mockRejectedValueOnce(Error("Synthetic lost response"))
      .mockResolvedValueOnce(acceptanceFixture());
    render(
      <AiIntentPreviewPanel
        projectId={authority.projectId}
        currentAuthority={() => authority}
        onAccept={onAccept}
      />,
    );
    submit();
    const button = await screen.findByRole("button", {
      name: "Accept and save requirements",
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText(/Saving could not be confirmed/);
    fireEvent.click(
      screen.getByRole("button", { name: "Accept and save requirements" }),
    );
    await screen.findByRole("heading", { name: "Accepted requirements" });
    expect(onAccept.mock.calls[1]).toEqual(onAccept.mock.calls[0]);
  });
  it("keeps the candidate when the response names another project", async () => {
    acceptanceTransport();
    const onAccept = vi.fn().mockResolvedValue({
      ...acceptanceFixture(),
      projectId: "project_other",
    });
    render(
      <AiIntentPreviewPanel
        projectId={authority.projectId}
        currentAuthority={() => authority}
        onAccept={onAccept}
      />,
    );
    submit();
    const button = await screen.findByRole("button", {
      name: "Accept and save requirements",
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByText(/Saving could not be confirmed/);
    expect(
      screen.getByRole("heading", { name: "Requirements to review" }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "What do you want to build?" }),
    ).not.toHaveValue("");
  });
  it("rejects a changed editing baseline before requesting acceptance", async () => {
    acceptanceTransport();
    let current = authority;
    const onAccept = vi.fn();
    render(
      <AiIntentPreviewPanel
        projectId={authority.projectId}
        currentAuthority={() => current}
        onAccept={onAccept}
      />,
    );
    submit();
    const button = await screen.findByRole("button", {
      name: "Accept and save requirements",
    });
    await waitFor(() => expect(button).toBeEnabled());
    current = { ...authority, draftEtag: '"draft:draft_preview:v2"' };
    fireEvent.click(button);
    expect(
      await screen.findByText(/Original editing access has changed/),
    ).toBeVisible();
    expect(onAccept).not.toHaveBeenCalled();
  });
});
