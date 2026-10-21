import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { createS3ProjectContentEraser } from "./s3-project-content-eraser.js";

const prefix = "documents/v1/organizations/organization_a/projects/project_a/";
const key = prefix + "architecture-draft/object_a/" + "a".repeat(64);
const binding = {
  organizationId: "organization_a",
  projectId: "project_a",
  deletionRequestedAt: "2026-09-08T18:00:00.000Z",
  recordVersion: 2,
};
function page(overrides: Record<string, unknown> = {}) {
  return {
    Name: "cloudmarkup-test",
    Prefix: prefix,
    IsTruncated: false,
    Versions: [],
    DeleteMarkers: [],
    ...overrides,
  };
}
function fixture() {
  const send =
    vi.fn<
      (
        command: ListObjectVersionsCommand | DeleteObjectsCommand,
      ) => Promise<Record<string, unknown>>
    >();
  const authorize = vi.fn(() => Promise.resolve());
  const create = (override: Record<string, unknown> = {}) =>
    createS3ProjectContentEraser({
      bucket: "cloudmarkup-test",
      expectedBucketOwner: "123456789012",
      keyPrefix: "documents",
      binding,
      client: { send } as unknown as S3Client,
      assertCurrentAuthority: authorize,
      ...override,
    });
  return { send, authorize, create };
}
describe("project S3 content erasure", () => {
  it("removes every listed version and delete marker by exact identity, then verifies absence", async () => {
    const f = fixture();
    const objects = [
      { Key: key, VersionId: "old" },
      { Key: key, VersionId: "new" },
      { Key: key, VersionId: "marker" },
    ];
    f.send
      .mockResolvedValueOnce(
        page({
          Versions: objects.slice(0, 2),
          DeleteMarkers: objects.slice(2),
        }),
      )
      .mockResolvedValueOnce({ Deleted: [...objects].reverse() })
      .mockResolvedValueOnce(page());
    expect(await f.create().erasePage()).toEqual({
      observedEmpty: true,
      deletedVersionCount: 3,
    });
    expect(f.send.mock.calls.map(([command]) => command.constructor)).toEqual([
      ListObjectVersionsCommand,
      DeleteObjectsCommand,
      ListObjectVersionsCommand,
    ]);
    expect(f.send.mock.calls[1]?.[0].input).toEqual({
      Bucket: "cloudmarkup-test",
      ExpectedBucketOwner: "123456789012",
      Delete: { Objects: objects, Quiet: false },
    });
    expect(f.authorize).toHaveBeenCalledTimes(6);
    expect(f.authorize).toHaveBeenCalledWith(binding);
  });
  it("reports a remaining page without skipping versions after deletion", async () => {
    const f = fixture(),
      object = { Key: key, VersionId: "first" };
    f.send
      .mockResolvedValueOnce(page({ IsTruncated: true, Versions: [object] }))
      .mockResolvedValueOnce({ Deleted: [object] })
      .mockResolvedValueOnce(
        page({ Versions: [{ Key: key, VersionId: "next" }] }),
      );
    expect(await f.create().erasePage()).toEqual({
      observedEmpty: false,
      deletedVersionCount: 1,
    });
    for (const [index, [command]] of f.send.mock.calls.entries()) {
      if (index === 1) continue;
      expect(command.input).toEqual({
        Bucket: "cloudmarkup-test",
        ExpectedBucketOwner: "123456789012",
        Prefix: prefix,
        MaxKeys: 1000,
      });
    }
  });
  it("replays an already empty scope without deleting anything", async () => {
    const f = fixture();
    f.send.mockResolvedValue(page());
    expect(await f.create().erasePage()).toEqual({
      observedEmpty: true,
      deletedVersionCount: 0,
    });
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each([
    { Prefix: prefix.replace("project_a", "project_other") },
    { Name: "other-bucket" },
    { Delimiter: "/" },
    { CommonPrefixes: [{ Prefix: prefix + "nested/" }] },
    { IsTruncated: undefined },
    { IsTruncated: true },
    {
      Versions: [
        { Key: key.replace("project_a/", "project_ab/"), VersionId: "one" },
      ],
    },
    {
      Versions: [
        {
          Key: key.replace("organization_a", "organization_b"),
          VersionId: "one",
        },
      ],
    },
    { Versions: [{ Key: key }] },
    {
      Versions: [
        { Key: key, VersionId: "one" },
        { Key: key, VersionId: "one" },
      ],
    },
    {
      Versions: Array.from({ length: 1001 }, (_, i) => ({
        Key: key,
        VersionId: String(i),
      })),
    },
  ])(
    "rejects incomplete or foreign list evidence before deletion (%j)",
    async (override) => {
      const f = fixture();
      f.send.mockResolvedValueOnce(page(override));
      await expect(f.create().erasePage()).rejects.toMatchObject({
        code: "storage-unavailable",
      });
      expect(f.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { Errors: [{ Code: "AccessDenied", Key: key, VersionId: "one" }] },
    { Deleted: [] },
    { Deleted: [{ Key: key, VersionId: "other" }] },
    {
      Deleted: [
        { Key: key.replace("project_a", "project_b"), VersionId: "one" },
      ],
    },
  ])(
    "does not claim erasure from partial or mismatched deletion results (%j)",
    async (result) => {
      const f = fixture();
      f.send
        .mockResolvedValueOnce(
          page({ Versions: [{ Key: key, VersionId: "one" }] }),
        )
        .mockResolvedValueOnce(result);
      await expect(f.create().erasePage()).rejects.toMatchObject({
        code: "storage-unavailable",
      });
      expect(f.send).toHaveBeenCalledTimes(2);
    },
  );
  it("rechecks authority before mutation and redacts provider errors", async () => {
    const f = fixture();
    f.send.mockResolvedValueOnce(
      page({ Versions: [{ Key: key, VersionId: "one" }] }),
    );
    f.authorize.mockRejectedValueOnce(new Error("internal authority detail"));
    await expect(f.create().erasePage()).rejects.toMatchObject({
      message: "Project content erasure could not be verified.",
    });
    expect(f.send).not.toHaveBeenCalled();
    const afterList = fixture();
    afterList.send.mockResolvedValueOnce(
      page({ Versions: [{ Key: key, VersionId: "one" }] }),
    );
    afterList.authorize
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error(key));
    await expect(afterList.create().erasePage()).rejects.toMatchObject({
      message: "Project content erasure could not be verified.",
    });
    expect(afterList.send).toHaveBeenCalledTimes(1);
  });
  it.each([
    { binding: { ...binding, projectId: "organization" } },
    { binding: { ...binding, organizationId: "../foreign" } },
    { binding: { ...binding, recordVersion: 0 } },
    { binding: { ...binding, deletionRequestedAt: "invalid" } },
    { keyPrefix: "" },
    { keyPrefix: "../documents" },
    { expectedBucketOwner: "" },
    { bucket: "arn:aws:s3:::anything" },
  ])("rejects unbounded host configuration (%j)", (override) => {
    const f = fixture();
    expect(() => f.create(override)).toThrow();
    expect(f.send).not.toHaveBeenCalled();
  });
});
