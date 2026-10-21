import { createHash } from "node:crypto";

import {
  serializeCanonicalJson,
  sha256DigestSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import {
  restoreSolutionExportArtifact,
  verifySolutionExportArtifact,
  type SolutionExportArtifactV1,
} from "@cloudmarkup/solution-export/retained-artifact";

import { ApplicationError } from "../../application/errors.js";
import type {
  AuthorizedOrganizationScope,
  ObjectStore,
  StoredObjectReference,
} from "../../application/persistence.js";
import { assertObjectReference } from "./object-store-common.js";

export interface RetainedSolutionExportObjects {
  readonly archive: StoredObjectReference;
  readonly archiveFileName: string;
  readonly fileCount: number;
  readonly manifest: StoredObjectReference;
  readonly organizationId: string;
  readonly projectId: string;
  readonly solutionRevisionDigest: Sha256Digest;
  readonly solutionRevisionId: string;
}

export type AuthorizeSolutionExportObjects =
  () => Promise<AuthorizedOrganizationScope>;

function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "The retained export could not be verified.",
  );
}

function checkScope(
  scope: AuthorizedOrganizationScope,
  organizationId: string,
  permission: "artifacts.read" | "exports.run" = "exports.run",
): void {
  if (
    scope.organizationId !== organizationId ||
    !scope.capabilities.includes(permission)
  )
    throw new ApplicationError(
      "access_denied",
      "The export is not available for this account.",
    );
}

function assertReference(
  scope: AuthorizedOrganizationScope,
  reference: StoredObjectReference,
  projectId: string,
  kind: "manifest" | "archive",
): void {
  assertObjectReference(scope, reference);
  if (
    reference.owner.projectId !== projectId ||
    reference.purpose !==
      (kind === "manifest" ? "artifact-manifest" : "export-package") ||
    reference.mediaType !==
      (kind === "manifest" ? "application/json" : "application/zip") ||
    !Number.isSafeInteger(reference.sizeBytes) ||
    reference.sizeBytes < 1 ||
    reference.sizeBytes > (kind === "manifest" ? 33_554_432 : 67_108_864)
  )
    unavailable();
}

/** Target-neutral bytes only. Staging never grants public artifact availability. */
export class SolutionExportArtifactObjects {
  readonly #store: ObjectStore;
  constructor(store: ObjectStore) {
    this.#store = store;
  }

  async read(
    input: RetainedSolutionExportObjects,
    authorize: AuthorizeSolutionExportObjects,
    permission: "artifacts.read" | "exports.run" = "exports.run",
  ): Promise<SolutionExportArtifactV1> {
    // Capture trusted metadata before any await; adapters cannot change the commitment in flight.
    const metadata = structuredClone(input);
    const read = async (kind: "manifest" | "archive") => {
      const scope = await authorize();
      checkScope(scope, metadata.organizationId, permission);
      const reference = metadata[kind];
      assertReference(scope, reference, metadata.projectId, kind);
      const stream = await this.#store.open(scope, reference);
      const chunks: Uint8Array[] = [];
      const hash = createHash("sha256");
      let length = 0;
      for await (const chunk of stream) {
        if (!(chunk instanceof Uint8Array)) unavailable();
        length += chunk.byteLength;
        if (length > reference.sizeBytes) unavailable();
        // An untrusted stream may reuse its mutable buffer between yields.
        const copy = chunk.slice();
        hash.update(copy);
        chunks.push(copy);
      }
      if (
        length !== reference.sizeBytes ||
        hash.digest("hex") !== reference.contentSha256
      )
        unavailable();
      checkScope(await authorize(), metadata.organizationId, permission);
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    };
    const manifestBytes = await read("manifest");
    const zipBytes = await read("archive");
    try {
      return restoreSolutionExportArtifact({
        archiveFileName: metadata.archiveFileName,
        fileCount: metadata.fileCount,
        manifestBytes,
        manifestDigest: sha256DigestSchema.parse(
          `sha256:${metadata.manifest.contentSha256}`,
        ),
        solutionRevisionDigest: metadata.solutionRevisionDigest,
        solutionRevisionId: metadata.solutionRevisionId,
        zipBytes,
        zipDigest: sha256DigestSchema.parse(
          `sha256:${metadata.archive.contentSha256}`,
        ),
      });
    } catch {
      unavailable();
    }
  }

  async stage(
    input: {
      readonly artifact: SolutionExportArtifactV1;
      readonly artifactId: string;
      readonly organizationId: string;
      readonly projectId: string;
    },
    authorize: AuthorizeSolutionExportObjects,
  ): Promise<RetainedSolutionExportObjects> {
    const artifact = structuredClone(input.artifact);
    const { artifactId, organizationId, projectId } = input;
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(artifactId) ||
      verifySolutionExportArtifact(artifact).some(
        ({ severity }) => severity === "error",
      )
    )
      unavailable();
    const identity = createHash("sha256")
      .update(serializeCanonicalJson({ artifactId, organizationId, projectId }))
      .digest("hex");
    const manifestBytes = new TextEncoder().encode(
      serializeCanonicalJson(artifact.manifest),
    );
    const stage = async (
      kind: "manifest" | "archive",
      bytes: Uint8Array,
      digest: Sha256Digest,
    ) => {
      const scope = await authorize();
      checkScope(scope, organizationId);
      const object = await this.#store.stage(scope, {
        contentSha256: digest.slice(7),
        mediaType: kind === "manifest" ? "application/json" : "application/zip",
        objectId: `object.export-${kind}.${identity}`,
        open: async function* () {
          yield await Promise.resolve(bytes.slice());
        },
        owner: { organizationId, projectId },
        purpose: kind === "manifest" ? "artifact-manifest" : "export-package",
        sizeBytes: bytes.byteLength,
      });
      assertReference(scope, object, projectId, kind);
      if (
        object.contentSha256 !== digest.slice(7) ||
        object.sizeBytes !== bytes.byteLength ||
        object.objectId !== `object.export-${kind}.${identity}`
      )
        unavailable();
      checkScope(await authorize(), organizationId);
      return object;
    };
    const manifest = await stage(
      "manifest",
      manifestBytes,
      artifact.manifestDigest,
    );
    const archive = await stage(
      "archive",
      artifact.zipBytes,
      artifact.zipDigest,
    );
    return {
      archive,
      archiveFileName: artifact.archiveFileName,
      fileCount: artifact.files.length,
      manifest,
      organizationId,
      projectId,
      solutionRevisionDigest: artifact.manifest.solutionRevision.digest,
      solutionRevisionId: artifact.manifest.solutionRevision.id,
    };
  }
}
