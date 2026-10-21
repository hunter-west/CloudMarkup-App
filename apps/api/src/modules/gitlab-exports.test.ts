import { describe, expect, it, vi } from "vitest";
import type { GitlabExportV1 } from "@cloudmarkup/api-contract";
import { createApp } from "../app.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "../testing/in-memory-adapters.js";
import { ApplicationError } from "../application/errors.js";
import type { GitLabExportsApplication } from "../application/gitlab-export-application.js";
const now = "2026-10-01T12:00:00.000Z",
  origin = "https://beta.example.invalid";
const actor = {
  principalId: "principal_actor",
  sessionId: "family_actor",
  authenticatedAt: now,
  expiresAt: "2026-10-01T13:00:00.000Z",
};
const digest = "sha256:" + "a".repeat(64),
  reviewId = "gitlabreview_" + "b".repeat(32);
const record: GitlabExportV1 = {
  contractVersion: 1,
  reviewId,
  organizationId: "org_example",
  projectId: "project_example",
  principalId: actor.principalId,
  connectionId: "gitlab_" + "c".repeat(32),
  providerProjectId: 42,
  selectionVersion: 1,
  artifactId: "solutionartifact_example",
  artifactManifestDigest: digest,
  artifactZipDigest: digest,
  approvalDigest: digest,
  baseCommitSha: "d".repeat(40),
  baseBranch: "main",
  branch: "cloudmarkup/export-" + "b".repeat(32),
  destinationFolder: "exports/first",
  fileCount: 1,
  state: "prepared",
  recordVersion: 1,
  verifiedFiles: 0,
  commitSha: null,
  mergeRequest: null,
  expiresAt: "2026-10-01T12:15:00.000Z",
  expired: false,
};
const preview = {
  export: record,
  files: [
    {
      path: "exports/first/main.tf",
      sizeBytes: 20,
      sha256: digest,
      mode: "100644" as const,
    },
  ],
};
const create = {
  contractVersion: 1,
  connectionId: record.connectionId,
  providerProjectId: 42,
  selectionVersion: 1,
  artifactId: record.artifactId,
  destinationFolder: record.destinationFolder,
};
const advance = {
  contractVersion: 1,
  expectedVersion: 1,
  approvalDigest: digest,
  acknowledgedAutomation: true,
};
const root = "/v1/projects/project_example/gitlab-exports",
  detail = root + "/" + reviewId;
const headers = {
  authorization: "Bearer actor",
  origin,
  "content-type": "application/json",
};
function fixture(configured = true) {
  const port = {
    preview: vi
      .fn<GitLabExportsApplication["preview"]>()
      .mockResolvedValue(preview),
    get: vi.fn<GitLabExportsApplication["get"]>().mockResolvedValue(record),
    advance: vi.fn<GitLabExportsApplication["advance"]>().mockResolvedValue({
      ...record,
      state: "commit-dispatched",
      recordVersion: 2,
    }),
  };
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    principalResolver: new FixedPrincipalResolver({ "Bearer actor": actor }),
    ...(configured
      ? { gitlabExports: { publicOrigin: origin, application: port } }
      : {}),
  });
  return { app, port };
}
const paths = [
  ["POST", root, create],
  ["GET", detail, undefined],
  ["POST", detail + "/advance", advance],
] as const;
describe("GitLab reviewed export HTTP boundary", () => {
  it.each(paths)(
    "serves configured %s %s with private cache policy",
    async (method, path, body) => {
      const f = fixture();
      const response = await f.app.request(path, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      expect(response.status).toBe(path === root ? 201 : 200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const value = await response.json();
      expect(JSON.stringify(value)).not.toMatch(
        /accessToken|sealedGrant|applicationId|expectedTreeSha/u,
      );
    },
  );
  it.each(paths)("denies unauthenticated %s %s", async (method, path, body) => {
    const f = fixture();
    const response = await f.app.request(path, {
      method,
      headers: { origin, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect(response.status).toBe(401);
    expect(f.port.preview).not.toHaveBeenCalled();
    expect(f.port.get).not.toHaveBeenCalled();
    expect(f.port.advance).not.toHaveBeenCalled();
  });
  it.each(paths)(
    "does not enable %s %s without explicit configuration",
    async (method, path, body) => {
      const f = fixture(false);
      expect(
        (
          await f.app.request(path, {
            method,
            headers,
            ...(body ? { body: JSON.stringify(body) } : {}),
          })
        ).status,
      ).toBe(503);
    },
  );
  it.each([
    {},
    { origin: "https://other.example" },
    { origin, "sec-fetch-site": "cross-site" },
    { origin, "sec-fetch-site": "same-site" },
  ])("rejects mutation origin %#", async (extra) => {
    const f = fixture();
    for (const [path, body] of [
      [root, create],
      [detail + "/advance", advance],
    ] as const)
      expect(
        (
          await f.app.request(path, {
            method: "POST",
            headers: {
              authorization: "Bearer actor",
              "content-type": "application/json",
              ...extra,
            },
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(403);
    expect(f.port.preview).not.toHaveBeenCalled();
    expect(f.port.advance).not.toHaveBeenCalled();
  });
  it.each([
    { organizationId: "org_other" },
    { principalId: "principal_other" },
    { providerProjectId: -1 },
    { selectionVersion: 0 },
    { destinationFolder: "../outside" },
    { artifactId: "artifact_wrong-kind" },
    { accessToken: "forbidden" },
  ])("rejects malformed/owner-supplied preview %#", async (patch) => {
    const f = fixture();
    expect(
      (
        await f.app.request(root, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...create, ...patch }),
        })
      ).status,
    ).toBe(400);
    expect(f.port.preview).not.toHaveBeenCalled();
  });
  it.each([
    { expectedVersion: 0 },
    { approvalDigest: "wrong" },
    { acknowledgedAutomation: "yes" },
    { organizationId: "org_other" },
  ])("rejects malformed advance %#", async (patch) => {
    const f = fixture();
    expect(
      (
        await f.app.request(detail + "/advance", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...advance, ...patch }),
        })
      ).status,
    ).toBe(400);
    expect(f.port.advance).not.toHaveBeenCalled();
  });
  it.each([
    "projectId",
    "principalId",
    "connectionId",
    "artifactId",
    "destinationFolder",
  ] as const)("rejects mismatched preview %s", async (field) => {
    const f = fixture();
    f.port.preview.mockResolvedValue({
      ...preview,
      files:
        field === "destinationFolder"
          ? preview.files.map((file) => ({ ...file, path: "other/main.tf" }))
          : preview.files,
      export: {
        ...record,
        [field]:
          field === "projectId"
            ? "project_other"
            : field === "principalId"
              ? "principal_other"
              : field === "connectionId"
                ? "gitlab_" + "d".repeat(32)
                : field === "artifactId"
                  ? "solutionartifact_other"
                  : "other",
      },
    });
    expect(
      (
        await f.app.request(root, {
          method: "POST",
          headers,
          body: JSON.stringify(create),
        })
      ).status,
    ).toBe(503);
  });
  it.each(
    (
      ["access_denied", "not_found", "conflict", "service_unavailable"] as const
    ).filter((_, index) => index !== 0 && index !== 1 && index !== 2),
  )("preserves safe application denial %s", async (code) => {
    const f = fixture();
    f.port.advance.mockRejectedValue(
      new ApplicationError(code, "The export is unavailable."),
    );
    expect(
      (
        await f.app.request(detail + "/advance", {
          method: "POST",
          headers,
          body: JSON.stringify(advance),
        })
      ).status,
    ).toBe(
      {
        access_denied: 403,
        not_found: 404,
        conflict: 409,
        service_unavailable: 503,
      }[code],
    );
  });
  it("rejects review, actor, version and approval substitution in status/progress", async () => {
    const f = fixture();
    f.port.get.mockResolvedValue({ ...record, principalId: "principal_other" });
    expect((await f.app.request(detail, { headers })).status).toBe(503);
    for (const patch of [
      { recordVersion: 4 },
      { approvalDigest: "sha256:" + "0".repeat(64) },
      {
        reviewId: "gitlabreview_" + "e".repeat(32),
        branch: "cloudmarkup/export-" + "e".repeat(32),
      },
    ]) {
      f.port.advance.mockResolvedValue({ ...record, ...patch });
      expect(
        (
          await f.app.request(detail + "/advance", {
            method: "POST",
            headers,
            body: JSON.stringify(advance),
          })
        ).status,
      ).toBe(503);
    }
  });
  it.each(paths.filter((_, index) => index !== 0 && index !== 2))(
    "rejects unrecognized query fields on %s %s",
    async (method, path, body) => {
      const f = fixture();
      expect(
        (
          await f.app.request(path + "?organizationId=org_other", {
            method,
            headers,
            ...(body ? { body: JSON.stringify(body) } : {}),
          })
        ).status,
      ).toBe(400);
    },
  );
});
