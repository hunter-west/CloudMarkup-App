import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import {
  ObjectStoreError,
  type AuthorizedOrganizationScope,
  type ObjectStore,
  type StageObjectInput,
  type StoredObjectReference,
} from "../../application/persistence.js";
import {
  assertObjectReference,
  assertStageInput,
  buildStorageKey,
  collectAndVerify,
  referencesMatch,
  verifiedObjectStream,
} from "./object-store-common.js";

interface FileMetadata {
  readonly reference: StoredObjectReference;
  readonly state: "staged" | "published" | "delete-pending";
  readonly storageContractVersion: 1;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function parseMetadata(value: unknown): FileMetadata {
  if (
    typeof value !== "object" ||
    value === null ||
    !("storageContractVersion" in value) ||
    value.storageContractVersion !== 1 ||
    !("state" in value) ||
    (value.state !== "staged" &&
      value.state !== "published" &&
      value.state !== "delete-pending") ||
    !("reference" in value) ||
    typeof value.reference !== "object" ||
    value.reference === null
  ) {
    throw new ObjectStoreError(
      "storage-unavailable",
      "The local object metadata is invalid.",
    );
  }
  return value as unknown as FileMetadata;
}

export class FilesystemObjectStore implements ObjectStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async stage(
    scope: AuthorizedOrganizationScope,
    input: StageObjectInput,
  ): Promise<StoredObjectReference> {
    assertStageInput(scope, input);
    const storageKey = buildStorageKey(input);
    const reference: StoredObjectReference = {
      contentSha256: input.contentSha256,
      entityTag: `"${input.contentSha256}"`,
      mediaType: input.mediaType,
      objectId: input.objectId,
      objectVersion: `sha256-${input.contentSha256}`,
      owner: input.owner,
      purpose: input.purpose,
      sizeBytes: input.sizeBytes,
      storageKey,
      storageProvider: "filesystem",
    };
    const path = this.#dataPath(storageKey);
    const metadataPath = this.#metadataPath(path);
    await mkdir(dirname(path), { recursive: true });
    const bytes = await collectAndVerify(input);
    try {
      await writeFile(path, bytes, { flag: "wx" });
      await writeFile(
        metadataPath,
        JSON.stringify(
          {
            reference,
            state: "staged",
            storageContractVersion: 1,
          } satisfies FileMetadata,
          null,
          2,
        ) + "\n",
        { encoding: "utf8", flag: "wx" },
      );
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        throw new ObjectStoreError(
          "storage-unavailable",
          "The local object could not be written.",
          { cause: error },
        );
      }
      const existing = await this.head(scope, reference);
      if (existing === null || !referencesMatch(reference, existing)) {
        throw new ObjectStoreError(
          "object-conflict",
          "The local object conflicts with existing content.",
        );
      }
      return existing;
    }
    return reference;
  }

  async publish(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    const metadata = await this.#readMetadata(scope, object);
    if (metadata.state === "published") {
      return;
    }
    const path = this.#dataPath(object.storageKey);
    const metadataPath = this.#metadataPath(path);
    const temporary = `${metadataPath}.pending-${randomUUID()}`;
    try {
      await writeFile(
        temporary,
        JSON.stringify({ ...metadata, state: "published" }, null, 2) + "\n",
        { encoding: "utf8", flag: "wx" },
      );
      await rename(temporary, metadataPath);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch {
        // A local-development orphan is safe to remove after inspection.
      }
      throw new ObjectStoreError(
        "storage-unavailable",
        "The local object could not be published.",
        { cause: error },
      );
    }
  }

  async requestDeletion(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    const metadata = await this.#readMetadata(scope, object);
    if (metadata.state === "delete-pending") {
      return;
    }
    if (metadata.state !== "published") {
      throw new ObjectStoreError(
        "object-conflict",
        "Only a published object can enter deletion.",
      );
    }
    const path = this.#dataPath(object.storageKey);
    const metadataPath = this.#metadataPath(path);
    const temporary = `${metadataPath}.pending-${randomUUID()}`;
    try {
      await writeFile(
        temporary,
        JSON.stringify({ ...metadata, state: "delete-pending" }, null, 2) +
          "\n",
        { encoding: "utf8", flag: "wx" },
      );
      await rename(temporary, metadataPath);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch {
        // A local-development orphan is safe to remove after inspection.
      }
      throw new ObjectStoreError(
        "storage-unavailable",
        "The local object could not enter deletion.",
        { cause: error },
      );
    }
  }

  async discardStaged(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    const metadata = await this.#readMetadata(scope, object);
    if (metadata.state !== "staged") {
      return;
    }
    const path = this.#dataPath(object.storageKey);
    const metadataPath = this.#metadataPath(path);
    try {
      await unlink(metadataPath);
      await unlink(path);
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        throw new ObjectStoreError(
          "storage-unavailable",
          "The staged local object could not be discarded.",
          { cause: error },
        );
      }
    }
  }

  async head(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<StoredObjectReference | null> {
    assertObjectReference(scope, object);
    try {
      const metadata = parseMetadata(
        JSON.parse(
          await readFile(
            this.#metadataPath(this.#dataPath(object.storageKey)),
            "utf8",
          ),
        ),
      );
      if (!referencesMatch(object, metadata.reference)) {
        throw new ObjectStoreError(
          "object-conflict",
          "The local object reference does not match stored metadata.",
        );
      }
      return metadata.reference;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return null;
      }
      if (error instanceof ObjectStoreError) {
        throw error;
      }
      throw new ObjectStoreError(
        "storage-unavailable",
        "The local object metadata could not be read.",
        { cause: error },
      );
    }
  }

  async open(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<AsyncIterable<Uint8Array>> {
    await this.#readMetadata(scope, object);
    const stream = createReadStream(this.#dataPath(object.storageKey));
    return verifiedObjectStream(
      (async function* bytes(): AsyncIterable<Uint8Array> {
        for await (const chunk of stream) {
          if (!(chunk instanceof Uint8Array)) {
            throw new ObjectStoreError(
              "storage-unavailable",
              "The local object body is invalid.",
            );
          }
          yield chunk;
        }
      })(),
      object.sizeBytes,
      object.contentSha256,
    );
  }

  async #readMetadata(
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<FileMetadata> {
    const found = await this.head(scope, object);
    if (found === null) {
      throw new ObjectStoreError("not-found", "The object is not available.");
    }
    const metadata = parseMetadata(
      JSON.parse(
        await readFile(
          this.#metadataPath(this.#dataPath(object.storageKey)),
          "utf8",
        ),
      ),
    );
    return metadata;
  }

  #dataPath(storageKey: string): string {
    const path = resolve(this.#root, ...storageKey.split("/"));
    if (path !== this.#root && !path.startsWith(`${this.#root}${sep}`)) {
      throw new ObjectStoreError(
        "invalid-input",
        "The local object path is invalid.",
      );
    }
    return path;
  }

  #metadataPath(dataPath: string): string {
    return `${dataPath}.metadata.json`;
  }
}
