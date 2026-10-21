import { describe, expect, it, vi } from "vitest";
import { sha256DigestSchema } from "@cloudmarkup/schemas";

import { ApplicationError } from "../../application/errors.js";
import type { ObjectStore } from "../../application/persistence.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import { SolutionExportArtifactObjects } from "./solution-export-artifact-objects.js";
import {
  exportScope,
  retainedArtifactFixture,
} from "./solution-export-artifact-test-helpers.js";

describe("target-neutral retained export object boundary", () => {
  async function fixture() {
    const store = new InMemoryObjectStore();
    const objects = new SolutionExportArtifactObjects(store);
    const artifact = retainedArtifactFixture();
    const scope = exportScope();
    const authorize = vi.fn(() => Promise.resolve(scope));
    const input = {
      artifact,
      artifactId: "artifact.export",
      organizationId: scope.organizationId,
      projectId: "project.export",
    };
    const retained = await objects.stage(input, authorize);
    return { store, objects, artifact, scope, authorize, input, retained };
  }

  it("stages retry-identical target-neutral manifest/archive objects without publishing or deleting", async () => {
    const f = await fixture();
    const publish = vi.spyOn(f.store, "publish");
    const discard = vi.spyOn(f.store, "discardStaged");
    expect(await f.objects.stage(f.input, f.authorize)).toEqual(f.retained);
    expect(publish).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(f.retained.manifest.purpose).toBe("artifact-manifest");
    expect(f.retained.archive.purpose).toBe("export-package");
    expect(await f.objects.read(f.retained, f.authorize)).toEqual(f.artifact);
    expect(f.authorize).toHaveBeenCalledTimes(12);
  });

  it("denies missing current export permission and wrong organization before object I/O", async () => {
    const f = await fixture();
    const open = vi.spyOn(f.store, "open");
    for (const scope of [
      { ...f.scope, capabilities: [] },
      { ...f.scope, organizationId: "organization.foreign" },
    ]) {
      await expect(
        f.objects.read(f.retained, () => Promise.resolve(scope)),
      ).rejects.toMatchObject({ code: "access_denied" });
    }
    expect(open).not.toHaveBeenCalled();
  });

  it("reauthorizes after complete object reads and exposes no bytes after revocation", async () => {
    const f = await fixture();
    const authorize = vi.fn(() => {
      if (authorize.mock.calls.length > 1)
        throw new ApplicationError("not_found", "Unavailable.");
      return Promise.resolve(f.scope);
    });
    const open = vi.spyOn(f.store, "open");
    await expect(f.objects.read(f.retained, authorize)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each(["wrong-owner", "wrong-purpose", "oversize", "wrong-media"])(
    "rejects %s metadata before opening an object",
    async (kind) => {
      const f = await fixture();
      const open = vi.spyOn(f.store, "open");
      const manifest = {
        ...f.retained.manifest,
        ...(kind === "wrong-owner"
          ? {
              owner: {
                ...f.retained.manifest.owner,
                projectId: "project.foreign",
              },
            }
          : {}),
        ...(kind === "wrong-purpose"
          ? { purpose: "input-payload" as const }
          : {}),
        ...(kind === "oversize" ? { sizeBytes: Number.MAX_SAFE_INTEGER } : {}),
        ...(kind === "wrong-media" ? { mediaType: "text/plain" } : {}),
      };
      await expect(
        f.objects.read({ ...f.retained, manifest }, f.authorize),
      ).rejects.toThrow();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it.each(["short", "long", "corrupt"])(
    "independently rejects a %s stream even when the object port omits its own verifier",
    async (kind) => {
      const f = await fixture();
      const store: ObjectStore = {
        stage: f.store.stage.bind(f.store),
        publish: f.store.publish.bind(f.store),
        requestDeletion: f.store.requestDeletion.bind(f.store),
        discardStaged: f.store.discardStaged.bind(f.store),
        head: f.store.head.bind(f.store),
        open: () =>
          Promise.resolve(
            (async function* () {
              yield await Promise.resolve(
                new Uint8Array(
                  f.retained.manifest.sizeBytes +
                    (kind === "short" ? -1 : kind === "long" ? 1 : 0),
                ),
              );
            })(),
          ),
      };
      await expect(
        new SolutionExportArtifactObjects(store).read(f.retained, f.authorize),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    },
  );

  it("verifies an artifact before staging any bytes", async () => {
    const f = await fixture();
    const stage = vi.spyOn(f.store, "stage");
    await expect(
      f.objects.stage(
        {
          ...f.input,
          artifact: {
            ...f.artifact,
            zipDigest: sha256DigestSchema.parse(`sha256:${"0".repeat(64)}`),
          },
        },
        f.authorize,
      ),
    ).rejects.toThrow();
    expect(stage).not.toHaveBeenCalled();
  });
});
