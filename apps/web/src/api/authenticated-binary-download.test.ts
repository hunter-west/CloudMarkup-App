import { describe, expect, it, vi } from "vitest";

import { createAuthenticatedBinaryDownloader } from "./authenticated-binary-download.js";

const bytes = new TextEncoder().encode("zip-bytes");
const digest =
  "sha256:4b9a4ac59f3c3aa32273260df6cf4bf358d1c46f8415126aa35b6380d0abb8f7";

function downloadResponse(overrides: Readonly<Record<string, string>> = {}) {
  return new Response(bytes, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": 'attachment; filename="notes-api.zip"',
      "content-length": String(bytes.byteLength),
      "content-security-policy": "sandbox",
      "content-type": "application/zip",
      "referrer-policy": "no-referrer",
      "x-cloudmarkup-content-sha256": digest,
      "x-content-type-options": "nosniff",
      ...overrides,
    },
    status: 200,
  });
}

describe("authenticated binary downloads", () => {
  it("sends the verified session credential and accepts only a header- and checksum-bound ZIP", async () => {
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(downloadResponse()),
    );
    const downloader = createAuthenticatedBinaryDownloader({
      apiBaseUrl: "https://api.test.invalid",
      development: true,
      fetchImplementation,
      localDevelopmentToken: "principal_one",
    });

    if (downloader === undefined)
      throw new Error("The configured test downloader is unavailable.");
    const result = await downloader(
      "/v1/projects/project_one/solution-export-artifacts/solutionartifact_one/download-grants/downloadgrant_one/content",
    );
    expect(result.bytes).toBeInstanceOf(ArrayBuffer);
    expect(result.digest).toBe(digest);
    expect(result.fileName).toBe("notes-api.zip");
    expect(result.mediaType).toBe("application/zip");
    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.test.invalid/v1/projects/project_one/solution-export-artifacts/solutionartifact_one/download-grants/downloadgrant_one/content",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/zip",
          authorization: "Bearer local-development:principal_one",
        },
        method: "GET",
        redirect: "error",
      }),
    );
  });

  it("rejects tampered bytes and unsafe grant paths", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      downloadResponse({
        "x-cloudmarkup-content-sha256": `sha256:${"0".repeat(64)}`,
      }),
    );
    const downloader = createAuthenticatedBinaryDownloader({
      apiBaseUrl: "/api",
      development: false,
      fetchImplementation,
    });

    await expect(
      downloader?.(
        "/v1/projects/project_one/solution-export-artifacts/solutionartifact_one/download-grants/downloadgrant_one/content",
      ),
    ).rejects.toThrow("integrity checks");
    await expect(
      downloader?.("https://attacker.invalid/archive.zip"),
    ).rejects.toThrow("integrity checks");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("rejects missing safe response headers before saving bytes", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(downloadResponse({ "cache-control": "public" }));
    const downloader = createAuthenticatedBinaryDownloader({
      apiBaseUrl: "/api",
      development: false,
      fetchImplementation,
    });

    await expect(
      downloader?.(
        "/v1/projects/project_one/solution-export-artifacts/solutionartifact_one/download-grants/downloadgrant_one/content",
      ),
    ).rejects.toThrow("integrity checks");
  });

  it("reads the production access token again for every download request", async () => {
    let accessToken = "access-token-one";
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(downloadResponse()),
    );
    const downloader = createAuthenticatedBinaryDownloader({
      accessToken: () => accessToken,
      apiBaseUrl: "/api",
      development: false,
      fetchImplementation,
    });
    const path =
      "/v1/projects/project_one/solution-export-artifacts/solutionartifact_one/download-grants/downloadgrant_one/content";

    await downloader?.(path);
    accessToken = "access-token-two";
    await downloader?.(path);

    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      `/api${path}`,
      expect.objectContaining({
        headers: {
          accept: "application/zip",
          authorization: "Bearer access-token-one",
        },
      }),
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      `/api${path}`,
      expect.objectContaining({
        headers: {
          accept: "application/zip",
          authorization: "Bearer access-token-two",
        },
      }),
    );
  });

  it("waits for renewal before downloading and preserves byte integrity checks", async () => {
    let finish: (token: string | undefined) => void = () => {
      throw new Error("Deferred token is not initialized.");
    };
    const token = new Promise<string | undefined>((resolve) => {
      finish = resolve;
    });
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(downloadResponse()),
    );
    const downloader = createAuthenticatedBinaryDownloader({
      accessToken: () => token,
      development: false,
      fetchImplementation,
    });
    const request = downloader?.("/v1/artifacts/artifact_one/content");
    expect(fetchImplementation).not.toHaveBeenCalled();
    finish("renewed-download-token");
    expect((await request)?.digest).toBe(digest);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/v1/artifacts/artifact_one/content",
      expect.objectContaining({
        headers: {
          accept: "application/zip",
          authorization: "Bearer renewed-download-token",
        },
      }),
    );
  });
});
