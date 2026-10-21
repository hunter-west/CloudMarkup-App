import { createHash } from "node:crypto";

import {
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import {
  ObjectStoreError,
  type AuthorizedOrganizationScope,
  type StageObjectInput,
} from "../../application/persistence.js";
import { S3ObjectStore } from "./s3-object-store.js";

const scope: AuthorizedOrganizationScope = {
  capabilities: ["projects.write"],
  correlationId: "correlation_s3_test",
  membershipId: "membership_s3_test",
  organizationId: "organization_s3_test",
  principalId: "principal_s3_test",
  roleKey: "test-owner",
  sessionId: "session_s3_test",
};

function stageInput(): StageObjectInput {
  const bytes = new TextEncoder().encode("revision payload");
  return {
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "application/vnd.cloudmarkup.architecture+json",
    objectId: "object_s3_test",
    open: () =>
      (async function* body() {
        await Promise.resolve();
        yield bytes;
      })(),
    owner: {
      organizationId: scope.organizationId,
      projectId: "project_s3_test",
    },
    purpose: "architecture-revision",
    sizeBytes: bytes.byteLength,
  };
}

describe("S3 object store", () => {
  it("uses conditional versioned writes and exact-version publication", async () => {
    const commands: object[] = [];
    let putInput: PutObjectCommand["input"] | undefined;
    const client = {
      destroy: () => undefined,
      async send(command: object): Promise<object> {
        commands.push(command);
        if (command instanceof PutObjectCommand) {
          putInput = command.input;
          const body = command.input.Body;
          if (typeof body === "object" && Symbol.asyncIterator in body) {
            for await (const chunk of body) {
              void chunk;
              // Consume the controlled stream so digest/size verification runs.
            }
          }
          return { ETag: '"etag-s3-test"', VersionId: "version-s3-test" };
        }
        if (command instanceof GetObjectTaggingCommand) {
          return {
            TagSet: [{ Key: "cloudmarkup-state", Value: "published" }],
          };
        }
        if (command instanceof HeadObjectCommand) {
          return {
            ContentLength: putInput?.ContentLength,
            ContentType: putInput?.ContentType,
            ETag: '"etag-s3-test"',
            Metadata: putInput?.Metadata,
            VersionId: "version-s3-test",
          };
        }
        return {};
      },
    } as unknown as S3Client;
    const store = new S3ObjectStore({ bucket: "cloudmarkup-test", client });

    const staged = await store.stage(scope, stageInput());
    await store.publish(scope, staged);
    await store.requestDeletion(scope, staged);

    expect(putInput?.IfNoneMatch).toBe("*");
    expect(putInput?.Tagging).toBe("cloudmarkup-state=staged");
    expect(putInput?.Metadata).toMatchObject({
      "content-sha256": stageInput().contentSha256,
      "object-id": "object_s3_test",
      "organization-id": scope.organizationId,
      "project-id": "project_s3_test",
    });
    expect(staged.objectVersion).toBe("version-s3-test");
    const lifecycleTags = commands.filter(
      (command) => command instanceof PutObjectTaggingCommand,
    );
    expect(lifecycleTags).toHaveLength(2);
    const publish = lifecycleTags[0];
    const deletion = lifecycleTags[1];
    if (
      publish instanceof PutObjectTaggingCommand &&
      deletion instanceof PutObjectTaggingCommand
    ) {
      expect(publish.input.VersionId).toBe("version-s3-test");
      expect(publish.input.Tagging?.TagSet).toEqual([
        { Key: "cloudmarkup-state", Value: "published" },
      ]);
      expect(deletion.input.VersionId).toBe("version-s3-test");
      expect(deletion.input.Tagging?.TagSet).toEqual([
        { Key: "cloudmarkup-state", Value: "delete-pending" },
      ]);
    }
  });

  it("fails closed when bucket versioning does not return a version ID", async () => {
    const client = {
      destroy: () => undefined,
      async send(command: object): Promise<object> {
        if (command instanceof PutObjectCommand) {
          const body = command.input.Body;
          if (typeof body === "object" && Symbol.asyncIterator in body) {
            for await (const chunk of body) {
              void chunk;
              // Consume the controlled stream.
            }
          }
          return { ETag: '"etag-without-version"' };
        }
        return {};
      },
    } as unknown as S3Client;
    const store = new S3ObjectStore({ bucket: "cloudmarkup-test", client });

    await expect(store.stage(scope, stageInput())).rejects.toMatchObject({
      code: "storage-unavailable",
    } satisfies Partial<ObjectStoreError>);
  });
});

describe("retained history definitive S3 staging", () => {
  function fixture(error?: unknown, attempts = 1) {
    const commands: object[] = [];
    let input: PutObjectCommand["input"] | undefined;
    const client = {
      config: { maxAttempts: () => Promise.resolve(attempts) },
      async send(command: object) {
        await Promise.resolve();
        commands.push(command);
        if (command instanceof PutObjectCommand) {
          input = command.input;
          if (error instanceof Error) throw error;
          if (error !== undefined)
            throw Object.assign(Error("Synthetic non-SDK error"), error);
          return { VersionId: "actual-version", ETag: '"actual-etag"' };
        }
        if (command instanceof HeadObjectCommand)
          return {
            ContentLength: input?.ContentLength,
            ContentType: input?.ContentType,
            Metadata: input?.Metadata,
            VersionId: "existing-version",
            ETag: '"existing-etag"',
          };
        throw Error("unexpected command");
      },
    } as unknown as S3Client;
    return {
      commands,
      store: new S3ObjectStore({
        bucket: "cloudmarkup-test",
        client,
        requireDefinitiveStage: true,
      }),
    };
  }
  it.each([
    Error("lost response"),
    new S3ServiceException({
      name: "ConditionalRequestConflict",
      $fault: "client",
      $metadata: { httpStatusCode: 409 },
    }),
    new S3ServiceException({
      name: "InternalError",
      $fault: "server",
      $metadata: { httpStatusCode: 500 },
    }),
    { $metadata: { httpStatusCode: 412 }, name: "PreconditionFailed" },
  ])(
    "keeps ambiguous or unauthenticated outcomes held without HEAD convergence %#",
    async (error) => {
      const f = fixture(error);
      await expect(f.store.stage(scope, stageInput())).rejects.toMatchObject({
        code: "storage-unavailable",
      });
      expect(f.commands).toHaveLength(1);
      expect(f.commands[0]).toBeInstanceOf(PutObjectCommand);
    },
  );
  it("accepts the actual version from the single acknowledged PUT", async () => {
    const f = fixture();
    expect((await f.store.stage(scope, stageInput())).objectVersion).toBe(
      "actual-version",
    );
    expect(f.commands).toHaveLength(1);
  });
  it("only reuses exact existing content after the single SDK request definitively returned 412", async () => {
    const f = fixture(
      new S3ServiceException({
        name: "PreconditionFailed",
        $fault: "client",
        $metadata: { httpStatusCode: 412 },
      }),
    );
    expect((await f.store.stage(scope, stageInput())).objectVersion).toBe(
      "existing-version",
    );
    expect(f.commands).toHaveLength(2);
    expect(f.commands[1]).toBeInstanceOf(HeadObjectCommand);
  });
  it("refuses SDK retry configuration before issuing any body", async () => {
    const f = fixture(undefined, 3);
    await expect(f.store.stage(scope, stageInput())).rejects.toThrow(
      /single S3 write attempt/,
    );
    expect(f.commands).toHaveLength(0);
  });
});
