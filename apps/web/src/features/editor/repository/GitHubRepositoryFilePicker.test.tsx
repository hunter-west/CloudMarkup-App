import type {
  DiscoverGithubRepositoryV1,
  GithubRepositoryDiscoveryV1,
} from "@cloudmarkup/api-contract";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitHubRepositoryFilePicker } from "./GitHubRepositoryFilePicker.js";

const input: DiscoverGithubRepositoryV1 = {
  branch: "main",
  commitSha: "a".repeat(40),
  contractVersion: 1,
  integrationId: "integration_test",
  repositoryId: 42,
  ignoredPaths: [".env"],
  selectedPaths: ["."],
};
function result(files = 2): GithubRepositoryDiscoveryV1 {
  return {
    ...input,
    projectId: "project_test",
    branchHeadSha: input.commitSha,
    branchChangedSinceSelection: false,
    treeSha: "b".repeat(40),
    files: Array.from({ length: files }, (_, i) => ({
      path: "src/file-" + String(i) + ".ts",
      gitBlobSha: "c".repeat(40),
      sizeBytes: 100,
    })),
  };
}

describe("repository file selection", () => {
  it("discovers exact metadata, selects files across searches, and retains explicit scan-all", async () => {
    const onDiscover = vi.fn(() => Promise.resolve(result()));
    const onSelect = vi.fn();
    render(
      <GitHubRepositoryFilePicker
        input={input}
        onDiscover={onDiscover}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Discover repository files" }),
    );
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Select src/file-1.ts" }),
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Find repository files" }),
      { target: { value: "file-0" } },
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select src/file-0.ts" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use selected files" }));
    expect(onDiscover).toHaveBeenCalledWith(input);
    expect(onSelect).toHaveBeenLastCalledWith([
      "src/file-0.ts",
      "src/file-1.ts",
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "Scan all eligible files" }),
    );
    expect(onSelect).toHaveBeenLastCalledWith(["."]);
  });
  it("bounds visible files, retains selections across pages, and stops at 128 selected files", async () => {
    render(
      <GitHubRepositoryFilePicker
        input={input}
        onDiscover={() => Promise.resolve(result(130))}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Discover repository files" }),
    );
    await screen.findByRole("checkbox", { name: "Select src/file-0.ts" });
    expect(screen.getAllByRole("checkbox")).toHaveLength(50);
    for (let page = 0; page < 2; page++) {
      for (const checkbox of screen.getAllByRole("checkbox"))
        fireEvent.click(checkbox);
      fireEvent.click(screen.getByRole("button", { name: "Next files" }));
    }
    const last = screen.getAllByRole("checkbox");
    for (const checkbox of last.slice(0, 28)) fireEvent.click(checkbox);
    expect(last[28]).toBeDisabled();
    expect(last[0]).toBeEnabled();
    expect(screen.getByText(/128 of 128 files selected/u)).toBeVisible();
    const first = last[0];
    if (first === undefined) throw new Error("Missing selected file.");
    fireEvent.click(first);
    expect(last[28]).toBeEnabled();
  });
  it("ignores an old source response after switching commits", async () => {
    let resolve!: (value: GithubRepositoryDiscoveryV1) => void;
    const onDiscover = vi.fn(
      () =>
        new Promise<GithubRepositoryDiscoveryV1>((done) => {
          resolve = done;
        }),
    );
    const view = render(
      <GitHubRepositoryFilePicker
        key="first"
        input={input}
        onDiscover={onDiscover}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Discover repository files" }),
    );
    view.rerender(
      <GitHubRepositoryFilePicker
        key="second"
        input={{ ...input, commitSha: "d".repeat(40) }}
        onDiscover={onDiscover}
        onSelect={vi.fn()}
      />,
    );
    await act(async () => {
      resolve(result());
      await Promise.resolve();
    });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Discover repository files" }),
    ).toBeEnabled();
  });
  it("reports empty, failed, and mismatched results without selecting anything", async () => {
    const onDiscover = vi
      .fn()
      .mockRejectedValueOnce(new Error("Repository unavailable."))
      .mockResolvedValueOnce(result(0))
      .mockResolvedValueOnce({ ...result(), commitSha: "d".repeat(40) });
    const onSelect = vi.fn();
    render(
      <GitHubRepositoryFilePicker
        input={input}
        onDiscover={onDiscover}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Discover repository files" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Repository unavailable.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Discover repository files" }),
    );
    expect(
      await screen.findByText(/No eligible files were found/u),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh file list" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("no longer matches"),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("explains a moved branch while keeping the selected commit", async () => {
    render(
      <GitHubRepositoryFilePicker
        input={input}
        onDiscover={() =>
          Promise.resolve({
            ...result(),
            branchHeadSha: "d".repeat(40),
            branchChangedSinceSelection: true,
          })
        }
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Discover repository files" }),
    );
    expect(await screen.findByText(/The branch has moved/u)).toBeVisible();
  });
});
