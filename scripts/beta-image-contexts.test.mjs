import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";

import {
  BETA_IMAGE_CONTEXT_TESTING,
  createCanonicalContextArchive,
  extractCanonicalContextArchive,
  formatBetaImageContextDigests,
  materializeBetaImageContexts,
  validateBetaImageContexts,
} from "./beta-image-contexts-core.mjs";
import {
  CANONICAL_PNPM_STORE_INDEX_PATH,
  PNPM_STORE_INDEX_DATABASE_PATH,
  exportCanonicalPnpmStoreIndex,
  restoreCanonicalPnpmStoreIndex,
} from "../infra/images/application-build/service/pnpm-store-index.mjs";

const {
  assertPnpmFetchContract,
  canonicalJson,
  extractPinnedTarGzip,
  extractPinnedZip,
  fetchOciBytes,
  fetchPinnedArtifact,
  finalizeCanonicalExtraction,
  normalizeGeneratedHardLinks,
  pnpmDeterministicClockBytes,
  pnpmDeterministicClockPath,
  pnpmDeterministicNodeOptions,
  pnpmFetchArguments,
  pnpmHostAuthority,
  pnpmStoreVersion,
  pnpmTarget,
  pnpmWorkspaceConfiguration,
  removeGeneratedPnpmProjectRegistration,
  sha256,
  stageVerifiedPnpmImplementation,
} = BETA_IMAGE_CONTEXT_TESTING;
const fakeDigest = (label) =>
  createHash("sha256").update(label, "utf8").digest("hex");

async function listWithSystemTar(archivePath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("tar", ["-tf", archivePath], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code !== 0) {
        rejectPromise(
          new Error(
            `system tar listing failed: ${Buffer.concat(stderr).toString("utf8")}`,
          ),
        );
        return;
      }
      resolvePromise(
        Buffer.concat(stdout)
          .toString("utf8")
          .split(/\r?\n/u)
          .filter((line) => line.length > 0),
      );
    });
  });
}

async function extractWithSystemTar(archivePath, destination) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("tar", ["-xf", archivePath, "-C", destination], {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code !== 0) {
        rejectPromise(
          new Error(
            `system tar extraction failed: ${Buffer.concat(stderr).toString("utf8")}`,
          ),
        );
        return;
      }
      resolvePromise();
    });
  });
}

async function write(root, path, bytes, { executable = false } = {}) {
  const target = resolve(root, ...path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  if (executable && process.platform !== "win32") await chmod(target, 0o755);
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
  return {
    executable,
    path,
    role: path.includes("service/") ? "service-entrypoint" : "context-input",
    sha256: sha256(content),
    sizeBytes: content.byteLength,
  };
}

async function createContext(root, contextId, values) {
  const contextRoot = resolve(root, "infra", "images", contextId);
  await mkdir(contextRoot, { recursive: true });
  const members = [];
  for (const file of values.files) {
    members.push(await write(contextRoot, file.path, file.bytes, file));
  }
  members.sort((left, right) => (left.path < right.path ? -1 : 1));
  const manifest = {
    ...values.manifest,
    contextId,
    kind: "cloudmarkup.image-context-inputs",
    members,
    platform: "linux/amd64",
    schemaVersion: 1,
    self: {
      executable: false,
      path: "image-inputs-v1.json",
      role: "context-manifest",
    },
  };
  await writeFile(
    resolve(contextRoot, "image-inputs-v1.json"),
    canonicalJson(manifest),
  );
  return { contextRoot, manifest };
}

async function createFixtureRepository() {
  const root = await mkdtemp(
    resolve(tmpdir(), "cloudmarkup-image-context-test-"),
  );
  for (const path of [
    "Dockerfile",
    "recipe.sh",
    "patches/tflint.patch",
    "patches/trivy.patch",
  ]) {
    const output = resolve(root, "infra/images/go-tools", path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(
      output,
      await readFile(
        new URL(`../infra/images/go-tools/${path}`, import.meta.url),
      ),
    );
  }
  const repositoryLock = Buffer.from("lockfileVersion: '9.0'\n", "utf8");
  await writeFile(resolve(root, "pnpm-lock.yaml"), repositoryLock);
  const entrypoint = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const input = JSON.parse(readFileSync("/workspace/input/request.json", "utf8"));
if (input === null || typeof input !== "object" || Array.isArray(input)) process.exit(2);
const result = { kind: "cloudmarkup.validation-result", passed: true, checks: ["lint", "type", "test", "compile"] };
writeFileSync("/workspace/output/result.json", JSON.stringify(result));
`;
  const applicationDockerfile = `# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
  FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd
  COPY --chmod=0444 offline/apk/libcrypto3-3.5.9-r0.apk /opt/cloudmarkup/apk/libcrypto3-3.5.9-r0.apk
  COPY --chmod=0444 offline/apk/libssl3-3.5.9-r0.apk /opt/cloudmarkup/apk/libssl3-3.5.9-r0.apk
  RUN test "$(sha256sum /opt/cloudmarkup/apk/libcrypto3-3.5.9-r0.apk | cut -d ' ' -f 1)" = "6632d758d8f5e9ea3b650fe966f23bbf9a202f8b8dceecac93da135dec5e3689" && test "$(sha256sum /opt/cloudmarkup/apk/libssl3-3.5.9-r0.apk | cut -d ' ' -f 1)" = "05e3393fb95aa5751ca2f9d242f659f6cff82c1cc7767cc2df4a086f7ad01877" && /sbin/apk add --no-network --no-cache --repositories-file /dev/null --no-scripts --upgrade /opt/cloudmarkup/apk/libcrypto3-3.5.9-r0.apk /opt/cloudmarkup/apk/libssl3-3.5.9-r0.apk && /sbin/apk info -e "libcrypto3=3.5.9-r0" && /sbin/apk info -e "libssl3=3.5.9-r0" && rm -rf /opt/cloudmarkup/apk /opt/yarn-v1.22.22 /usr/local/lib/node_modules/npm && rm -f /usr/local/bin/docker-entrypoint.sh /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg && test ! -e /opt/cloudmarkup/apk && test ! -e /opt/yarn-v1.22.22 && test ! -e /usr/local/lib/node_modules/npm && test ! -e /usr/local/bin/docker-entrypoint.sh && test ! -L /usr/local/bin/docker-entrypoint.sh && test ! -e /usr/local/bin/npm && test ! -L /usr/local/bin/npm && test ! -e /usr/local/bin/npx && test ! -L /usr/local/bin/npx && test ! -e /usr/local/bin/yarn && test ! -L /usr/local/bin/yarn && test ! -e /usr/local/bin/yarnpkg && test ! -L /usr/local/bin/yarnpkg && test "$(/opt/cloudmarkup/toolchain/bin/trivy --version | head -n 1)" = "Version: 0.74.0"
COPY service/application-build-service /usr/local/bin/application-build-service
COPY offline/ /opt/cloudmarkup/offline/
RUN chown -R 65532:65532 /opt/cloudmarkup && find /opt/cloudmarkup -xdev -type d -exec chmod 0555 {} + && test -z "$(find /opt/cloudmarkup -xdev -type d ! -perm 0555 -print -quit)" && test "$(stat -c '%a' /opt/cloudmarkup)" = "555"
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/application-build-service"]
`;
  const toolchainPackage = await readFile(
    new URL(
      "../infra/images/application-build/offline/toolchain/package.json",
      import.meta.url,
    ),
  );
  const toolchainLock = await readFile(
    new URL(
      "../infra/images/application-build/offline/toolchain/pnpm-lock.yaml",
      import.meta.url,
    ),
  );
  const pnpmClock = await readFile(
    new URL(
      "../infra/images/application-build/service/pnpm-deterministic-clock.cjs",
      import.meta.url,
    ),
  );
  const pnpmStoreIndex = await readFile(
    new URL(
      "../infra/images/application-build/service/pnpm-store-index.mjs",
      import.meta.url,
    ),
  );
  const applicationAcquisition = JSON.parse(
    await readFile(
      new URL(
        "../infra/images/application-build/offline/acquisition-v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const app = await createContext(root, "application-build", {
    files: [
      { bytes: applicationDockerfile, path: "Dockerfile" },
      {
        bytes: canonicalJson(applicationAcquisition),
        path: "offline/acquisition-v1.json",
      },
      {
        bytes: toolchainPackage,
        path: "offline/toolchain/package.json",
      },
      {
        bytes: toolchainLock,
        path: "offline/toolchain/pnpm-lock.yaml",
      },
      {
        bytes: entrypoint,
        executable: true,
        path: "service/application-build-service",
      },
      {
        bytes: pnpmClock,
        path: "service/pnpm-deterministic-clock.cjs",
      },
      {
        bytes: pnpmStoreIndex,
        path: "service/pnpm-store-index.mjs",
      },
    ],
    manifest: {
      bindings: {
        nodeBaseImage: {
          imageDigest:
            "sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc",
          indexDigest:
            "sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd",
          reference: "node:24.18.0-alpine3.24",
        },
        offlineStore: {
          manifest: "offline/pnpm-store/manifest-v1.json",
          network: "deny",
          path: "offline/pnpm-store",
        },
        repositoryLockfile: {
          path: "../../../pnpm-lock.yaml",
          sha256: sha256(repositoryLock),
          sizeBytes: repositoryLock.byteLength,
        },
        toolchainLockfile: {
          path: "offline/toolchain/pnpm-lock.yaml",
          sha256: sha256(toolchainLock),
          sizeBytes: toolchainLock.byteLength,
        },
        trivyDatabase: {
          layerDigest:
            "sha256:1edf7a495c6d68e691fb710b63926e4f1a3dbffa392fd8057cd10bdfd8c3eef5",
          layerSizeBytes: 117_915_639,
          manifestDigest:
            "sha256:98e1c199793bfcbe64fa41538fa3cf2c55650689a7920075bbba6165404a44d0",
        },
        trivyBinary: {
          path: "offline/bin/trivy",
          sha256:
            "2f78848b474c6f0b27d0df1833ae8fc7d297640344c6d5c7a25f63cc9e22d3dc",
          sizeBytes: 168288382,
        },
      },
      generatedPrefixes: [
        { path: "offline/apk", role: "verified-runtime-package" },
        { path: "offline/bin", role: "verified-tool-binaries" },
        { path: "offline/licenses", role: "verified-tool-licenses" },
        { path: "offline/pnpm-store", role: "offline-package-byte" },
        { path: "offline/toolchain", role: "offline-toolchain" },
        { path: "offline/trivy-cache", role: "trivy-database" },
      ],
      toolchain: {
        awsSdkClientDynamodb: "3.1101.0",
        eslint: "9.39.5",
        node: "24.18.0",
        pnpm: "11.16.0",
        trivy: "0.74.0",
        typescript: "6.0.3",
        typescriptEslint: "8.65.0",
        vite: "8.1.5",
        vitest: "4.1.10",
      },
    },
  });

  const terraformAcquisition = JSON.parse(
    await readFile(
      new URL(
        "../infra/images/terraform-validation/offline/acquisition-v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const providerLock = await readFile(
    new URL(
      "../infra/images/terraform-validation/offline/.terraform.lock.hcl",
      import.meta.url,
    ),
  );
  const mirrorIndexBytes = await readFile(
    new URL(
      "../infra/images/terraform-validation/offline/provider-mirror/index-v1.json",
      import.meta.url,
    ),
  );
  const terraformDockerfile = `# syntax=docker/dockerfile:1.19.0@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6
FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd
COPY --chmod=0444 offline/apk/libcrypto3-3.5.9-r0.apk /tmp/cloudmarkup-apk/libcrypto3-3.5.9-r0.apk
COPY --chmod=0444 offline/apk/libssl3-3.5.9-r0.apk /tmp/cloudmarkup-apk/libssl3-3.5.9-r0.apk
RUN /sbin/apk add --no-network --no-cache --repositories-file /dev/null --no-scripts --upgrade /tmp/cloudmarkup-apk/libcrypto3-3.5.9-r0.apk /tmp/cloudmarkup-apk/libssl3-3.5.9-r0.apk && /sbin/apk info -e "libcrypto3=3.5.9-r0" && /sbin/apk info -e "libssl3=3.5.9-r0" && rm -rf /usr/local/lib/node_modules/npm && rm -rf /opt/yarn-v1.22.22 && rm -f /usr/local/bin/docker-entrypoint.sh && test ! -e /usr/local/bin/npm && test ! -e /usr/local/bin/npx && test ! -e /usr/local/bin/yarn && test ! -e /usr/local/bin/yarnpkg && test ! -e /usr/local/bin/docker-entrypoint.sh
COPY service/terraform-validation-service /usr/local/bin/terraform-validation-service
COPY offline/ /opt/cloudmarkup/offline/
RUN find /opt/cloudmarkup -xdev -type d -exec chmod 0555 {} + && test -z "$(find /opt/cloudmarkup -xdev -type d ! -perm 0555 -print -quit)" && test "$(stat -c '%a' /opt/cloudmarkup)" = "555"
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/terraform-validation-service"]
`;
  const terraformConfig = await readFile(
    new URL(
      "../infra/images/terraform-validation/offline/terraform.rc",
      import.meta.url,
    ),
  );
  const toolBinaryIndex = await readFile(
    new URL(
      "../infra/images/terraform-validation/offline/tool-binaries-v1.json",
      import.meta.url,
    ),
  );
  const terraform = await createContext(root, "terraform-validation", {
    files: [
      { bytes: terraformDockerfile, path: "Dockerfile" },
      { bytes: providerLock, path: "offline/.terraform.lock.hcl" },
      {
        bytes: canonicalJson(terraformAcquisition),
        path: "offline/acquisition-v1.json",
      },
      {
        bytes: mirrorIndexBytes,
        path: "offline/provider-mirror/index-v1.json",
      },
      { bytes: terraformConfig, path: "offline/terraform.rc" },
      {
        bytes: toolBinaryIndex,
        path: "offline/tool-binaries-v1.json",
      },
      {
        bytes: entrypoint,
        executable: true,
        path: "service/terraform-validation-service",
      },
    ],
    manifest: {
      generatedPrefixes: [
        { path: "offline/apk", role: "verified-runtime-package" },
        { path: "offline/bin", role: "validation-tool" },
        { path: "offline/licenses", role: "verified-tool-license" },
        { path: "offline/provider-mirror", role: "terraform-provider-package" },
        { path: "offline/trivy-cache", role: "trivy-database" },
      ],
      offlineInputs: {
        acquisition: {
          path: "offline/acquisition-v1.json",
          sha256: sha256(canonicalJson(terraformAcquisition)),
          sizeBytes: canonicalJson(terraformAcquisition).byteLength,
        },
        providerLock: {
          path: "offline/.terraform.lock.hcl",
          sha256: sha256(providerLock),
          sizeBytes: providerLock.byteLength,
        },
        providerMirror: {
          indexPath: "offline/provider-mirror/index-v1.json",
          indexSha256: sha256(mirrorIndexBytes),
        },
        terraformCliConfig: {
          path: "offline/terraform.rc",
          sha256: sha256(terraformConfig),
          sizeBytes: terraformConfig.byteLength,
        },
        trivyDatabase: {
          layerDigest:
            "sha256:1edf7a495c6d68e691fb710b63926e4f1a3dbffa392fd8057cd10bdfd8c3eef5",
          layerSizeBytes: 117_915_639,
          manifestDigest:
            "sha256:98e1c199793bfcbe64fa41538fa3cf2c55650689a7920075bbba6165404a44d0",
        },
      },
      tools: {
        node: {
          baseImage: "node:24.18.0-alpine3.24",
          imageDigest:
            "sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc",
          indexDigest:
            "sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd",
          version: "24.18.0",
        },
        provider: {
          platform: "linux_amd64",
          source: "registry.terraform.io/hashicorp/aws",
          version: "6.63.0",
        },
        terraform: { version: "1.16.2" },
        tflint: { version: "0.64.0" },
        trivy: {
          version: "0.74.0",
          binarySha256:
            "2f78848b474c6f0b27d0df1833ae8fc7d297640344c6d5c7a25f63cc9e22d3dc",
        },
      },
    },
  });
  return {
    app,
    dispose: async () => rm(root, { force: true, recursive: true }),
    root,
    terraform,
  };
}

async function withFixture(run) {
  const fixture = await createFixtureRepository();
  try {
    await run(fixture);
  } finally {
    await fixture.dispose();
  }
}

test("validates both source contexts without fetching generated inputs", async () => {
  await withFixture(async ({ root }) => {
    const contexts = await validateBetaImageContexts(root, {
      allowMissingAcquired: true,
    });
    assert.deepEqual(
      contexts.map(({ spec }) => spec.contextId),
      ["application-build", "terraform-validation"],
    );
  });
});

test("keeps source JSON at 1 MiB and generated inventories at 4 MiB", async (t) => {
  const padJson = (bytes, targetSize) => {
    assert.ok(bytes.byteLength < targetSize);
    return Buffer.concat([
      bytes,
      Buffer.alloc(targetSize - bytes.byteLength, 0x20),
    ]);
  };

  await t.test(
    "resolved context manifest admits only the expanded ceiling",
    async () => {
      await withFixture(async ({ app, root }) => {
        const manifestPath = resolve(app.contextRoot, "image-inputs-v1.json");
        await writeFile(
          manifestPath,
          padJson(canonicalJson(app.manifest), 1024 * 1024 + 1),
        );
        await assert.rejects(
          validateBetaImageContexts(root, { allowMissingAcquired: true }),
          (error) => error?.code === "CONTEXT_FILE_TOO_LARGE",
        );
        await assert.rejects(
          validateBetaImageContexts(root, { allowMissingAcquired: false }),
          (error) => error?.code === "CONTEXT_ACQUISITION_MISSING",
        );

        await writeFile(
          manifestPath,
          padJson(canonicalJson(app.manifest), 4 * 1024 * 1024 + 1),
        );
        await assert.rejects(
          validateBetaImageContexts(root, { allowMissingAcquired: false }),
          (error) => error?.code === "CONTEXT_FILE_TOO_LARGE",
        );
      });
    },
  );

  await t.test(
    "pnpm store manifest uses only the generated ceiling",
    async () => {
      await withFixture(async ({ app, root }) => {
        const storePath = "offline/pnpm-store/manifest-v1.json";
        const absoluteStorePath = resolve(
          app.contextRoot,
          ...storePath.split("/"),
        );
        const installStore = async (size) => {
          const bytes = padJson(Buffer.from('{"padding":true}\n'), size);
          await mkdir(dirname(absoluteStorePath), { recursive: true });
          await writeFile(absoluteStorePath, bytes);
          app.manifest.members.push({
            executable: false,
            path: storePath,
            role: "offline-package-byte",
            sha256: sha256(bytes),
            sizeBytes: bytes.byteLength,
          });
          app.manifest.members.sort((left, right) =>
            left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
          );
          await writeFile(
            resolve(app.contextRoot, "image-inputs-v1.json"),
            canonicalJson(app.manifest),
          );
        };

        await installStore(1024 * 1024 + 1);
        await assert.rejects(
          validateBetaImageContexts(root, { allowMissingAcquired: true }),
          (error) => error?.code === "CONTEXT_SCHEMA_INVALID",
        );

        const storeMember = app.manifest.members.find(
          ({ path }) => path === storePath,
        );
        const oversized = padJson(
          Buffer.from('{"padding":true}\n'),
          4 * 1024 * 1024 + 1,
        );
        await writeFile(absoluteStorePath, oversized);
        storeMember.sha256 = sha256(oversized);
        storeMember.sizeBytes = oversized.byteLength;
        await writeFile(
          resolve(app.contextRoot, "image-inputs-v1.json"),
          canonicalJson(app.manifest),
        );
        await assert.rejects(
          validateBetaImageContexts(root, { allowMissingAcquired: true }),
          (error) => error?.code === "CONTEXT_FILE_TOO_LARGE",
        );
      });
    },
  );
});

test("failed materialization removes its exact staging directory", async () => {
  await withFixture(async ({ root }) => {
    const stagingParent = await mkdtemp(
      resolve(tmpdir(), "cloudmarkup-materialize-cleanup-"),
    );
    try {
      await assert.rejects(
        materializeBetaImageContexts(root, {
          fetchImpl: async () => {
            throw new Error("controlled fetch failure");
          },
          stagingParent,
        }),
        (error) => error?.code === "CONTEXT_ACQUISITION_TRANSPORT_FAILED",
      );
      assert.deepEqual(await readdir(stagingParent), []);
    } finally {
      await rm(stagingParent, { force: true, recursive: true });
    }
  });
});

test("rejects undeclared members and nested source-control metadata", async (t) => {
  await t.test("undeclared file", async () => {
    await withFixture(async ({ app, root }) => {
      await writeFile(resolve(app.contextRoot, "surprise.txt"), "unexpected");
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_UNDECLARED_MEMBER/u,
      );
    });
  });
  await t.test("nested VCS metadata", async () => {
    await withFixture(async ({ app, root }) => {
      await mkdir(resolve(app.contextRoot, ".git"));
      await writeFile(resolve(app.contextRoot, ".git", "config"), "[core]\n");
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_NESTED_VCS/u,
      );
    });
  });
});

test("rejects member, monorepo-lock, and provider-index drift", async (t) => {
  await t.test("member content", async () => {
    await withFixture(async ({ app, root }) => {
      await writeFile(resolve(app.contextRoot, "Dockerfile"), "changed\n");
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_(?:SCHEMA_INVALID|SIZE_DRIFT|CONTENT_DRIFT)/u,
      );
    });
  });
  await t.test("repository lock", async () => {
    await withFixture(async ({ root }) => {
      await writeFile(resolve(root, "pnpm-lock.yaml"), "changed\n");
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_LOCK_DRIFT/u,
      );
    });
  });
  await t.test("reviewed acquisition authority", async () => {
    await withFixture(async ({ app, root }) => {
      const acquisitionPath = resolve(
        app.contextRoot,
        "offline/acquisition-v1.json",
      );
      const acquisition = JSON.parse(await readFile(acquisitionPath, "utf8"));
      acquisition.artifacts[0].url =
        "https://github.com/pnpm/pnpm/releases/download/v11.16.0/changed.tar.gz";
      await writeFile(acquisitionPath, canonicalJson(acquisition));
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_ACQUISITION_AUTHORITY_DRIFT/u,
      );
    });
  });
  await t.test("reviewed Terraform APK acquisition authority", async () => {
    await withFixture(async ({ root, terraform }) => {
      const acquisitionPath = resolve(
        terraform.contextRoot,
        "offline/acquisition-v1.json",
      );
      const acquisition = JSON.parse(await readFile(acquisitionPath, "utf8"));
      acquisition.artifacts[0].sha256 =
        "061223a16f042b8e469e9441291e071464fd91d4f4bbe6f496ee8d0abd4e0701";
      await writeFile(acquisitionPath, canonicalJson(acquisition));
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_ACQUISITION_AUTHORITY_DRIFT/u,
      );
    });
  });
  await t.test("provider mirror index", async () => {
    await withFixture(async ({ root, terraform }) => {
      await writeFile(
        resolve(terraform.contextRoot, "offline/provider-mirror/index-v1.json"),
        "{}\n",
      );
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_(?:SCHEMA_INVALID|SIZE_DRIFT|CONTENT_DRIFT)/u,
      );
    });
  });
  await t.test("provider lock with refreshed manifest authority", async () => {
    await withFixture(async ({ root, terraform }) => {
      const lockPath = resolve(
        terraform.contextRoot,
        "offline/.terraform.lock.hcl",
      );
      const changed = Buffer.from(
        `${await readFile(lockPath, "utf8")}# reviewed-drift-fixture\n`,
        "utf8",
      );
      await writeFile(lockPath, changed);
      const member = terraform.manifest.members.find(
        ({ path }) => path === "offline/.terraform.lock.hcl",
      );
      member.sha256 = sha256(changed);
      member.sizeBytes = changed.byteLength;
      terraform.manifest.offlineInputs.providerLock.sha256 = sha256(changed);
      terraform.manifest.offlineInputs.providerLock.sizeBytes =
        changed.byteLength;
      await writeFile(
        resolve(terraform.contextRoot, "image-inputs-v1.json"),
        canonicalJson(terraform.manifest),
      );
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_PROVIDER_LOCK_DRIFT/u,
      );
    });
  });
});

test("rejects placeholder success entrypoints after authority refresh", async () => {
  await withFixture(async ({ app, root }) => {
    const placeholder = Buffer.from(
      "#!/bin/sh\nset -eu\necho success\n",
      "utf8",
    );
    const entrypointPath = "service/application-build-service";
    await writeFile(resolve(app.contextRoot, entrypointPath), placeholder);
    const member = app.manifest.members.find(
      ({ path }) => path === entrypointPath,
    );
    member.sha256 = sha256(placeholder);
    member.sizeBytes = placeholder.byteLength;
    await writeFile(
      resolve(app.contextRoot, "image-inputs-v1.json"),
      canonicalJson(app.manifest),
    );
    await assert.rejects(
      validateBetaImageContexts(root),
      /CONTEXT_ENTRYPOINT_PLACEHOLDER/u,
    );
  });
});

test("resolved admission rejects missing generated offline inputs", async () => {
  await withFixture(async ({ root }) => {
    await assert.rejects(
      validateBetaImageContexts(root, { allowMissingAcquired: false }),
      /CONTEXT_(?:ACQUISITION_MISSING|GENERATED_PREFIX_EMPTY)/u,
    );
  });
});

test("rejects Docker base-image authority drift", async () => {
  await withFixture(async ({ app, root }) => {
    const dockerfilePath = resolve(app.contextRoot, "Dockerfile");
    const dockerfile = await readFile(dockerfilePath, "utf8");
    const changed = dockerfile.replace(
      "node:24.18.0-alpine3.24",
      "node:24.18.0-alpine3.23",
    );
    await writeFile(dockerfilePath, changed);
    app.manifest.members.find(({ path }) => path === "Dockerfile").sha256 =
      sha256(Buffer.from(changed, "utf8"));
    app.manifest.members.find(({ path }) => path === "Dockerfile").sizeBytes =
      Buffer.byteLength(changed, "utf8");
    await writeFile(
      resolve(app.contextRoot, "image-inputs-v1.json"),
      canonicalJson(app.manifest),
    );
    await assert.rejects(
      validateBetaImageContexts(root),
      /CONTEXT_DOCKER_BASE_DRIFT/u,
    );
  });
});

test("rejects relaxed application runtime package hardening", async (t) => {
  const rewriteDockerfile = async (app, changed) => {
    const bytes = Buffer.from(changed, "utf8");
    await writeFile(resolve(app.contextRoot, "Dockerfile"), bytes);
    const member = app.manifest.members.find(
      ({ path }) => path === "Dockerfile",
    );
    member.sha256 = sha256(bytes);
    member.sizeBytes = bytes.byteLength;
    await writeFile(
      resolve(app.contextRoot, "image-inputs-v1.json"),
      canonicalJson(app.manifest),
    );
  };

  for (const [name, expected, replacement] of [
    ["unsigned APKs", "--no-scripts", "--allow-untrusted"],
    ["PATH-selected apk", "/sbin/apk add", "apk add"],
    [
      "non-traversable application directories",
      "find /opt/cloudmarkup -xdev -type d -exec chmod 0555 {} +",
      "find /opt/cloudmarkup -xdev -type d -exec chmod 0444 {} +",
    ],
    ["retained npm", "test ! -e /usr/local/bin/npm", "true"],
  ]) {
    await t.test(name, async () => {
      await withFixture(async ({ app, root }) => {
        const dockerfile = await readFile(
          resolve(app.contextRoot, "Dockerfile"),
          "utf8",
        );
        await rewriteDockerfile(app, dockerfile.replace(expected, replacement));
        await assert.rejects(
          validateBetaImageContexts(root),
          /CONTEXT_DOCKER_RUNTIME_HARDENING_DRIFT/u,
        );
      });
    });
  }

  const terraformInstall =
    "/sbin/apk add --no-network --no-cache --repositories-file /dev/null --no-scripts --upgrade /tmp/cloudmarkup-apk/libcrypto3-3.5.9-r0.apk /tmp/cloudmarkup-apk/libssl3-3.5.9-r0.apk";
  const unsafeTerraformInstall =
    "/sbin/apk add --no-network --no-cache /tmp/cloudmarkup-apk/libcrypto3-3.5.9-r0.apk /tmp/cloudmarkup-apk/libssl3-3.5.9-r0.apk";
  for (const [name, expected, replacement] of [
    [
      "PATH-selected Terraform apk",
      terraformInstall,
      terraformInstall.replace("/sbin/apk add", "apk add"),
    ],
    [
      "Terraform repository indexes enabled",
      terraformInstall,
      terraformInstall.replace(
        "--repositories-file /dev/null",
        "--repositories-file /etc/apk/repositories",
      ),
    ],
    [
      "Terraform package scripts enabled",
      terraformInstall,
      terraformInstall.replace("--no-scripts", "--allow-untrusted"),
    ],
    [
      "Terraform repository update cache enabled",
      terraformInstall,
      terraformInstall.replace("--no-cache", "--update-cache"),
    ],
    [
      "Terraform exact package upgrade disabled",
      terraformInstall,
      terraformInstall.replace(" --upgrade", ""),
    ],
    [
      "Terraform extra package admitted",
      terraformInstall,
      `${terraformInstall} /tmp/unreviewed.apk`,
    ],
    [
      "Terraform libcrypto version not bound",
      '/sbin/apk info -e "libcrypto3=3.5.9-r0"',
      '/sbin/apk info -e "libcrypto3"',
    ],
    [
      "Terraform libssl version not bound",
      '/sbin/apk info -e "libssl3=3.5.9-r0"',
      '/sbin/apk info -e "libssl3"',
    ],
    [
      "Terraform second APK command admitted on the reviewed RUN line",
      terraformInstall,
      `${terraformInstall} && /sbin/apk add --no-network /tmp/unreviewed.apk`,
    ],
    [
      "Terraform APK authority supplied only by a comment",
      `RUN ${terraformInstall}`,
      `# ${terraformInstall}\nRUN ${unsafeTerraformInstall}`,
    ],
  ]) {
    await t.test(name, async () => {
      await withFixture(async ({ root, terraform }) => {
        const dockerfile = await readFile(
          resolve(terraform.contextRoot, "Dockerfile"),
          "utf8",
        );
        assert.notEqual(dockerfile.replace(expected, replacement), dockerfile);
        await rewriteDockerfile(
          terraform,
          dockerfile.replace(expected, replacement),
        );
        await assert.rejects(
          validateBetaImageContexts(root),
          /CONTEXT_DOCKER_RUNTIME_UNSAFE/u,
        );
      });
    });
  }

  await t.test("non-traversable Terraform directories", async () => {
    await withFixture(async ({ root, terraform }) => {
      const dockerfile = await readFile(
        resolve(terraform.contextRoot, "Dockerfile"),
        "utf8",
      );
      await rewriteDockerfile(
        terraform,
        dockerfile.replace(
          "find /opt/cloudmarkup -xdev -type d -exec chmod 0555 {} +",
          "find /opt/cloudmarkup -xdev -type d -exec chmod 0444 {} +",
        ),
      );
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_DOCKER_RUNTIME_UNSAFE/u,
      );
    });
  });
});

test("rejects mutable or unreviewed Docker syntax frontends", async (t) => {
  const rewriteDockerfile = async (context, changed) => {
    await writeFile(resolve(context.contextRoot, "Dockerfile"), changed);
    const member = context.manifest.members.find(
      ({ path }) => path === "Dockerfile",
    );
    member.sha256 = sha256(Buffer.from(changed, "utf8"));
    member.sizeBytes = Buffer.byteLength(changed, "utf8");
    await writeFile(
      resolve(context.contextRoot, "image-inputs-v1.json"),
      canonicalJson(context.manifest),
    );
  };

  await t.test("tag-only frontend", async () => {
    await withFixture(async ({ app, root }) => {
      const dockerfile = await readFile(
        resolve(app.contextRoot, "Dockerfile"),
        "utf8",
      );
      const changed = dockerfile.replace(
        "# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e",
        "# syntax=docker/dockerfile:1.7",
      );
      await rewriteDockerfile(app, changed);
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_DOCKER_FRONTEND_UNPINNED/u,
      );
    });
  });

  await t.test("context-mismatched digest-pinned frontend", async () => {
    await withFixture(async ({ root, terraform }) => {
      const dockerfile = await readFile(
        resolve(terraform.contextRoot, "Dockerfile"),
        "utf8",
      );
      const changed = dockerfile.replace(
        "# syntax=docker/dockerfile:1.19.0@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6",
        "# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e",
      );
      await rewriteDockerfile(terraform, changed);
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_DOCKER_FRONTEND_DRIFT/u,
      );
    });
  });
});

test("rejects undeclared Docker stages and build mounts", async (t) => {
  const rewriteDockerfile = async (app, changed) => {
    await writeFile(resolve(app.contextRoot, "Dockerfile"), changed);
    const member = app.manifest.members.find(
      ({ path }) => path === "Dockerfile",
    );
    member.sha256 = sha256(Buffer.from(changed, "utf8"));
    member.sizeBytes = Buffer.byteLength(changed, "utf8");
    await writeFile(
      resolve(app.contextRoot, "image-inputs-v1.json"),
      canonicalJson(app.manifest),
    );
  };
  await t.test("external COPY --from", async () => {
    await withFixture(async ({ app, root }) => {
      const dockerfile = await readFile(
        resolve(app.contextRoot, "Dockerfile"),
        "utf8",
      );
      const changed = dockerfile.replace(
        "COPY service/application-build-service",
        "COPY --from=attacker/latest /tool /tmp/tool\nCOPY service/application-build-service",
      );
      await rewriteDockerfile(app, changed);
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_DOCKER_COPY_EXTERNAL_STAGE/u,
      );
    });
  });
  await t.test("RUN mount", async () => {
    await withFixture(async ({ app, root }) => {
      const dockerfile = await readFile(
        resolve(app.contextRoot, "Dockerfile"),
        "utf8",
      );
      const changed = dockerfile.replace(
        "COPY service/application-build-service",
        "RUN --mount=type=cache,target=/tmp true\nCOPY service/application-build-service",
      );
      await rewriteDockerfile(app, changed);
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_DOCKER_NETWORK_OR_SECRET_INPUT/u,
      );
    });
  });
});

test("rejects secret-shaped files, links, and hard links", async (t) => {
  await t.test("secret-shaped input", async () => {
    await withFixture(async ({ app, root }) => {
      await writeFile(
        resolve(app.contextRoot, ".env.production"),
        "VALUE=redacted\n",
      );
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_SECRET_SHAPED_PATH/u,
      );
    });
  });
  await t.test("hard link", async () => {
    await withFixture(async ({ app, root }) => {
      const existing = resolve(app.contextRoot, "Dockerfile");
      const linked = resolve(app.contextRoot, "hard-linked-dockerfile");
      try {
        await link(existing, linked);
      } catch (error) {
        t.skip(`hard links unavailable: ${error.code}`);
        return;
      }
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_HARD_LINK_FORBIDDEN/u,
      );
    });
  });
  await t.test("symbolic link", async () => {
    await withFixture(async ({ app, root }) => {
      try {
        await symlink(
          resolve(app.contextRoot, "Dockerfile"),
          resolve(app.contextRoot, "linked-dockerfile"),
        );
      } catch (error) {
        t.skip(`symbolic links unavailable: ${error.code}`);
        return;
      }
      await assert.rejects(
        validateBetaImageContexts(root),
        /CONTEXT_LINK_FORBIDDEN/u,
      );
    });
  });
});

test("canonical context archive digest ignores mtime and absolute root", async () => {
  const roots = await Promise.all([
    mkdtemp(resolve(tmpdir(), "cloudmarkup-canonical-a-")),
    mkdtemp(resolve(tmpdir(), "cloudmarkup-canonical-b-")),
  ]);
  try {
    const contexts = [];
    for (const [index, root] of roots.entries()) {
      const bytes = Buffer.from("same bytes\n", "utf8");
      const path = resolve(root, "payload.txt");
      await writeFile(path, bytes);
      await utimes(path, new Date(index * 1_000), new Date(index * 5_000));
      contexts.push({
        actualByPath: new Map([
          ["payload.txt", { absolute: path, path: "payload.txt" }],
        ]),
        canonicalManifestBytes: canonicalJson({ context: "same" }),
        members: [
          {
            executable: false,
            path: "payload.txt",
            role: "fixture",
            sha256: sha256(bytes),
            sizeBytes: bytes.byteLength,
          },
        ],
        root,
      });
    }
    assert.equal(
      await createCanonicalContextArchive(contexts[0]),
      await createCanonicalContextArchive(contexts[1]),
    );
  } finally {
    await Promise.all(
      roots.map((root) => rm(root, { force: true, recursive: true })),
    );
  }
});

test("tar-derived build context admits only the exact canonical archive bytes", async () => {
  const root = await mkdtemp(
    resolve(tmpdir(), "cloudmarkup-canonical-build-context-"),
  );
  try {
    const sourceRoot = resolve(root, "source");
    await mkdir(sourceRoot);
    const payload = Buffer.from("reviewed build bytes\n", "utf8");
    const payloadPath = resolve(sourceRoot, "payload.txt");
    await writeFile(payloadPath, payload);
    const context = {
      actualByPath: new Map([
        ["payload.txt", { absolute: payloadPath, path: "payload.txt" }],
      ]),
      canonicalManifestBytes: canonicalJson({ context: "reviewed" }),
      members: [
        {
          executable: false,
          path: "payload.txt",
          role: "fixture",
          sha256: sha256(payload),
          sizeBytes: payload.byteLength,
        },
      ],
      root: sourceRoot,
    };
    const archivePath = resolve(root, "context.tar");
    const digest = await createCanonicalContextArchive(context, archivePath);

    await writeFile(payloadPath, "unreviewed source mutation\n");
    const buildRoot = resolve(root, "build");
    await extractCanonicalContextArchive(
      context,
      archivePath,
      buildRoot,
      digest,
    );
    assert.deepEqual(
      await readFile(resolve(buildRoot, "payload.txt")),
      payload,
    );

    const tampered = Buffer.from(await readFile(archivePath));
    tampered[512] ^= 1;
    const tamperedPath = resolve(root, "tampered.tar");
    await writeFile(tamperedPath, tampered);
    const rejectedRoot = resolve(root, "rejected-build");
    await assert.rejects(
      extractCanonicalContextArchive(
        context,
        tamperedPath,
        rejectedRoot,
        digest,
      ),
      /CONTEXT_CANONICAL_ARCHIVE_DRIFT/u,
    );
    assert.equal(
      await lstat(rejectedRoot).then(
        () => true,
        () => false,
      ),
      false,
    );

    const trailingPath = resolve(root, "trailing.tar");
    await writeFile(
      trailingPath,
      Buffer.concat([await readFile(archivePath), Buffer.from([0])]),
    );
    const trailingRoot = resolve(root, "trailing-build");
    await assert.rejects(
      extractCanonicalContextArchive(
        context,
        trailingPath,
        trailingRoot,
        digest,
      ),
      /CONTEXT_CANONICAL_ARCHIVE_DRIFT/u,
    );
    assert.equal(
      await lstat(trailingRoot).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("canonical archive uses one exact PAX path record for long basenames", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "cloudmarkup-canonical-pax-"));
  try {
    const sourceRoot = resolve(root, "source");
    await mkdir(sourceRoot);
    const memberPath = `offline/pnpm-store/v11/files/00/${"a".repeat(128)}`;
    const payload = Buffer.from("content-addressed package bytes\n", "utf8");
    const absolute = resolve(sourceRoot, ...memberPath.split("/"));
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, payload);
    const context = {
      actualByPath: new Map([[memberPath, { absolute, path: memberPath }]]),
      canonicalManifestBytes: canonicalJson({ context: "pax" }),
      members: [
        {
          executable: false,
          path: memberPath,
          role: "fixture",
          sha256: sha256(payload),
          sizeBytes: payload.byteLength,
        },
      ],
      root: sourceRoot,
    };
    const archivePath = resolve(root, "context.tar");
    const digest = await createCanonicalContextArchive(context, archivePath);
    const archiveBytes = await readFile(archivePath);
    const manifestSize = context.canonicalManifestBytes.byteLength;
    const longEntryOffset =
      512 + manifestSize + ((512 - (manifestSize % 512)) % 512);
    assert.equal(archiveBytes[longEntryOffset + 156], "x".charCodeAt(0));
    assert.deepEqual(await listWithSystemTar(archivePath), [
      "image-inputs-v1.json",
      memberPath,
    ]);
    const independentRoot = resolve(root, "system-tar");
    await mkdir(independentRoot);
    await extractWithSystemTar(archivePath, independentRoot);
    assert.deepEqual(
      await readFile(resolve(independentRoot, ...memberPath.split("/"))),
      payload,
    );
    assert.deepEqual(
      await readFile(resolve(independentRoot, "image-inputs-v1.json")),
      context.canonicalManifestBytes,
    );
    for (const placeholder of ["PaxFiles", "PaxHeaders"]) {
      assert.equal(
        await lstat(resolve(independentRoot, placeholder)).then(
          () => true,
          () => false,
        ),
        false,
      );
    }

    const buildRoot = resolve(root, "build");
    await extractCanonicalContextArchive(
      context,
      archivePath,
      buildRoot,
      digest,
    );
    assert.deepEqual(
      await readFile(resolve(buildRoot, ...memberPath.split("/"))),
      payload,
    );

    const tampered = Buffer.from(archiveBytes);
    tampered[longEntryOffset + 512 + 8] ^= 1;
    const tamperedPath = resolve(root, "tampered.tar");
    await writeFile(tamperedPath, tampered);
    const rejectedRoot = resolve(root, "rejected");
    await assert.rejects(
      extractCanonicalContextArchive(
        context,
        tamperedPath,
        rejectedRoot,
        digest,
      ),
      /CONTEXT_CANONICAL_ARCHIVE_DRIFT/u,
    );
    assert.equal(
      await lstat(rejectedRoot).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("canonical archive boundary rejects caller-supplied path traversal", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "cloudmarkup-canonical-path-"));
  try {
    const sourceRoot = resolve(root, "source");
    await mkdir(sourceRoot);
    const payload = Buffer.from("safe bytes\n", "utf8");
    const absolute = resolve(sourceRoot, "payload.txt");
    await writeFile(absolute, payload);
    const context = {
      actualByPath: new Map([
        ["payload.txt", { absolute, path: "payload.txt" }],
      ]),
      canonicalManifestBytes: canonicalJson({ context: "safe" }),
      members: [
        {
          executable: false,
          path: "payload.txt",
          role: "fixture",
          sha256: sha256(payload),
          sizeBytes: payload.byteLength,
        },
      ],
      root: sourceRoot,
    };
    const archivePath = resolve(root, "context.tar");
    const digest = await createCanonicalContextArchive(context, archivePath);
    const escapedPath = resolve(root, "escaped.txt");
    const forged = {
      ...context,
      members: [{ ...context.members[0], path: "../escaped.txt" }],
    };
    await assert.rejects(
      createCanonicalContextArchive(forged),
      /CONTEXT_PATH_INVALID/u,
    );
    await assert.rejects(
      extractCanonicalContextArchive(
        forged,
        archivePath,
        resolve(root, "rejected"),
        digest,
      ),
      /CONTEXT_PATH_INVALID/u,
    );
    assert.equal(
      await lstat(escapedPath).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("canonical extraction removes output after archive close failure", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "cloudmarkup-canonical-close-"));
  try {
    const destination = resolve(root, "build");
    await mkdir(destination);
    await writeFile(resolve(destination, "partial.txt"), "partial\n");
    let closeCalls = 0;
    await assert.rejects(
      finalizeCanonicalExtraction({
        archive: {
          close: async () => {
            closeCalls += 1;
            throw new Error("forced archive close failure");
          },
        },
        destination,
        destinationCreated: true,
        operationError: undefined,
        result: { digest: fakeDigest("archive"), root: destination },
      }),
      /canonical archive close or cleanup failed/u,
    );
    assert.equal(closeCalls, 1);
    assert.equal(
      await lstat(destination).then(
        () => true,
        () => false,
      ),
      false,
    );

    const foreignDestination = resolve(root, "foreign");
    await mkdir(foreignDestination);
    await writeFile(resolve(foreignDestination, "owned.txt"), "preserve\n");
    await assert.rejects(
      finalizeCanonicalExtraction({
        archive: {
          close: async () => {
            throw new Error("forced pre-create close failure");
          },
        },
        destination: foreignDestination,
        destinationCreated: false,
        operationError: undefined,
        result: undefined,
      }),
      /canonical archive close or cleanup failed/u,
    );
    assert.equal(
      await readFile(resolve(foreignDestination, "owned.txt"), "utf8"),
      "preserve\n",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("normalizes only generated pnpm-store hardlinks before strict admission", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "cloudmarkup-pnpm-hardlinks-"));
  try {
    const storeRoot = resolve(root, "store");
    await mkdir(storeRoot);
    const first = resolve(storeRoot, "first");
    const second = resolve(storeRoot, "second");
    await writeFile(first, "content-addressed bytes\n");
    try {
      await link(first, second);
    } catch (error) {
      t.skip("hard links unavailable: " + error.code);
      return;
    }
    assert.ok((await lstat(first)).nlink > 1);
    await normalizeGeneratedHardLinks(storeRoot, root);
    assert.equal((await lstat(first)).nlink, 1);
    assert.equal((await lstat(second)).nlink, 1);
    assert.deepEqual(await readFile(first), await readFile(second));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("removes only the exact pnpm v11 generated project registration", async (t) => {
  assert.equal(pnpmStoreVersion, "v11");
  const withRegistrations = async (registrations, run) => {
    const root = await mkdtemp(
      resolve(tmpdir(), "cloudmarkup-pnpm-project-link-"),
    );
    try {
      const storeRoot = resolve(root, "store");
      const toolchainRoot = resolve(root, "toolchain");
      const wrongRoot = resolve(root, "wrong");
      const projectsRoot = resolve(storeRoot, "v11", "projects");
      await mkdir(projectsRoot, { recursive: true });
      await mkdir(toolchainRoot);
      await mkdir(wrongRoot);
      for (const { name, target = toolchainRoot } of registrations) {
        try {
          await symlink(
            target,
            resolve(projectsRoot, name),
            process.platform === "win32" ? "junction" : "dir",
          );
        } catch (error) {
          t.skip("directory links unavailable: " + error.code);
          return;
        }
      }
      await run({ projectsRoot, root, storeRoot, toolchainRoot, wrongRoot });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  };

  await t.test("exact controlled registration", async () => {
    await withRegistrations(
      [{ name: "a".repeat(32) }],
      async ({ projectsRoot, root, storeRoot, toolchainRoot }) => {
        await removeGeneratedPnpmProjectRegistration(storeRoot, toolchainRoot);
        assert.deepEqual(await readdir(projectsRoot), []);
        await normalizeGeneratedHardLinks(storeRoot, root);
      },
    );
  });
  await t.test("arbitrary registration name", async () => {
    await withRegistrations(
      [{ name: "not-a-reviewed-registration" }],
      async ({ storeRoot, toolchainRoot }) => {
        await assert.rejects(
          removeGeneratedPnpmProjectRegistration(storeRoot, toolchainRoot),
          /CONTEXT_PNPM_STORE_LAYOUT_INVALID/u,
        );
      },
    );
  });
  await t.test("multiple registrations", async () => {
    await withRegistrations(
      [{ name: "a".repeat(32) }, { name: "b".repeat(32) }],
      async ({ storeRoot, toolchainRoot }) => {
        await assert.rejects(
          removeGeneratedPnpmProjectRegistration(storeRoot, toolchainRoot),
          /CONTEXT_PNPM_STORE_LAYOUT_INVALID/u,
        );
      },
    );
  });
  await t.test("registration outside controlled toolchain", async () => {
    await withRegistrations(
      [{ name: "a".repeat(32), target: undefined }],
      async ({ storeRoot, toolchainRoot, wrongRoot, projectsRoot }) => {
        const registration = resolve(projectsRoot, "a".repeat(32));
        await unlink(registration);
        await symlink(
          wrongRoot,
          registration,
          process.platform === "win32" ? "junction" : "dir",
        );
        await assert.rejects(
          removeGeneratedPnpmProjectRegistration(storeRoot, toolchainRoot),
          /CONTEXT_PNPM_PROJECT_LINK_INVALID/u,
        );
      },
    );
  });
});

test("rejects a tampered host pnpm 11.16.0 CLI closure", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "cloudmarkup-pnpm-cli-tamper-"));
  try {
    const packageRoot = resolve(root, "node_modules", "pnpm");
    const binRoot = resolve(packageRoot, "bin");
    const distRoot = resolve(packageRoot, "dist");
    const stagingRoot = resolve(root, "staging");
    await mkdir(binRoot, { recursive: true });
    await mkdir(distRoot);
    await mkdir(stagingRoot);
    await writeFile(resolve(binRoot, "pnpm.cjs"), "tampered launcher\n");
    await writeFile(resolve(binRoot, "pnpm.mjs"), "tampered launcher\n");
    await writeFile(resolve(distRoot, "pnpm.mjs"), "tampered bundle\n");
    await assert.rejects(
      stageVerifiedPnpmImplementation(
        resolve(binRoot, "pnpm.mjs"),
        stagingRoot,
      ),
      /CONTEXT_PNPM_CLI_DRIFT/u,
    );
    assert.deepEqual(pnpmHostAuthority.implementation, {
      path: "dist/pnpm.mjs",
      sha256:
        "6d1d488e4ff9371a32cf4d322a01a8f6998e31b9c97342a77ca2bb179cf3234f",
      sizeBytes: 12_902_503,
    });
    assert.deepEqual(pnpmHostAuthority.packageMetadata, {
      path: "package.json",
      sha256:
        "fb72b825a5b0ad77974b0af4a02e02aa1b108140cedf80c2a8e8a2f18f0d8944",
      sizeBytes: 2_349,
    });
    assert.deepEqual(pnpmHostAuthority.worker, {
      path: "dist/worker.js",
      sha256:
        "86c0c2a1f8f927980560cbd66be94267829d3082cc12baa03b864da644bf9775",
      sizeBytes: 438_718,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("stages the exact pnpm 11.16.0 runtime closure and rejects worker drift", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "cloudmarkup-pnpm-runtime-"));
  try {
    assert.equal(typeof process.env.npm_execpath, "string");
    const officialCli = await realpath(process.env.npm_execpath);
    const officialRoot = resolve(dirname(officialCli), "..");
    const packageRoot = resolve(root, "node_modules", "pnpm");
    const authorities = [
      ...pnpmHostAuthority.launchers,
      pnpmHostAuthority.packageMetadata,
      pnpmHostAuthority.implementation,
      pnpmHostAuthority.worker,
    ];
    const officialBytes = new Map();
    for (const authority of authorities) {
      const bytes = await readFile(
        resolve(officialRoot, ...authority.path.split("/")),
      );
      officialBytes.set(authority.path, bytes);
      await write(packageRoot, authority.path, bytes);
    }

    const stagingRoot = resolve(root, "staging-success");
    await mkdir(stagingRoot);
    const stagedCli = await stageVerifiedPnpmImplementation(
      resolve(packageRoot, "bin", "pnpm.cjs"),
      stagingRoot,
    );
    assert.equal(
      stagedCli,
      resolve(
        stagingRoot,
        "pnpm-host-11.16.0",
        ...pnpmHostAuthority.implementation.path.split("/"),
      ),
    );
    for (const authority of [
      pnpmHostAuthority.packageMetadata,
      pnpmHostAuthority.implementation,
      pnpmHostAuthority.worker,
    ]) {
      const bytes = await readFile(
        resolve(stagingRoot, "pnpm-host-11.16.0", ...authority.path.split("/")),
      );
      assert.equal(bytes.byteLength, authority.sizeBytes);
      assert.equal(sha256(bytes), authority.sha256);
    }
    assert.equal(
      await lstat(resolve(stagingRoot, "pnpm-host-11.16.0.mjs")).catch(
        () => undefined,
      ),
      undefined,
    );

    await unlink(resolve(packageRoot, "dist", "worker.js"));
    const missingRoot = resolve(root, "staging-missing");
    await mkdir(missingRoot);
    await assert.rejects(
      stageVerifiedPnpmImplementation(
        resolve(packageRoot, "bin", "pnpm.cjs"),
        missingRoot,
      ),
      /CONTEXT_PNPM_CLI_INVALID/u,
    );

    await writeFile(
      resolve(packageRoot, "dist", "worker.js"),
      officialBytes.get("dist/worker.js"),
    );
    await writeFile(resolve(packageRoot, "dist", "worker.js"), "tampered\n");
    const tamperedRoot = resolve(root, "staging-tampered");
    await mkdir(tamperedRoot);
    await assert.rejects(
      stageVerifiedPnpmImplementation(
        resolve(packageRoot, "bin", "pnpm.cjs"),
        tamperedRoot,
      ),
      /CONTEXT_PNPM_CLI_DRIFT/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("pnpm fetch target, arguments, and worker clock are fixed", async () => {
  const cliPath = resolve("fixture", "pnpm-host-11.16.0.mjs");
  const toolchainRoot = resolve("fixture", "toolchain");
  const storeRoot = resolve("fixture", "store");
  const clockPath = resolve("fixture", "pnpm-deterministic-clock.cjs");
  const workspace = pnpmWorkspaceConfiguration();
  const arguments_ = pnpmFetchArguments(cliPath, toolchainRoot, storeRoot);
  const environment = {
    NODE_OPTIONS: pnpmDeterministicNodeOptions(clockPath),
    PNPM_MAX_WORKERS: "1",
    SOURCE_DATE_EPOCH: "0",
  };
  assert.deepEqual(pnpmTarget, {
    cpu: "x64",
    libc: "musl",
    os: "linux",
  });
  assert.match(workspace.toString("utf8"), /os:\n {4}- linux/u);
  assert.match(workspace.toString("utf8"), /cpu:\n {4}- x64/u);
  assert.match(workspace.toString("utf8"), /libc:\n {4}- musl/u);
  assert.doesNotMatch(
    workspace.toString("utf8"),
    /current|darwin|win32|arm64/u,
  );
  assert.ok(arguments_.includes("--network-concurrency=1"));
  assert.equal(
    pnpmDeterministicClockPath,
    "service/pnpm-deterministic-clock.cjs",
  );
  assert.doesNotThrow(() =>
    assertPnpmFetchContract(
      arguments_,
      environment,
      workspace,
      clockPath,
      cliPath,
      toolchainRoot,
      storeRoot,
    ),
  );
  assert.throws(
    () =>
      assertPnpmFetchContract(
        [...arguments_, "--config.os=win32"],
        environment,
        workspace,
        clockPath,
        cliPath,
        toolchainRoot,
        storeRoot,
      ),
    /CONTEXT_PNPM_FETCH_CONTRACT_INVALID/u,
  );
  assert.throws(
    () =>
      assertPnpmFetchContract(
        arguments_,
        environment,
        Buffer.from(
          workspace.toString("utf8").replace("linux", "win32"),
          "utf8",
        ),
        clockPath,
        cliPath,
        toolchainRoot,
        storeRoot,
      ),
    /CONTEXT_PNPM_FETCH_CONTRACT_INVALID/u,
  );
  assert.throws(
    () =>
      assertPnpmFetchContract(
        arguments_,
        { ...environment, PNPM_MAX_WORKERS: "2" },
        workspace,
        clockPath,
        cliPath,
        toolchainRoot,
        storeRoot,
      ),
    /CONTEXT_PNPM_FETCH_CONTRACT_INVALID/u,
  );

  const root = await mkdtemp(resolve(tmpdir(), "cloudmarkup-pnpm-clock-"));
  try {
    const hook = resolve(root, "clock.cjs");
    await writeFile(hook, pnpmDeterministicClockBytes());
    const output = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          'const { Worker } = require("node:worker_threads"); const main = Date.now(); const worker = new Worker(\'const { parentPort } = require("node:worker_threads"); parentPort.postMessage(Date.now());\', { eval: true }); worker.once("message", value => process.stdout.write(JSON.stringify({ main, worker: value })));',
        ],
        {
          env: {
            NODE_OPTIONS: pnpmDeterministicNodeOptions(hook),
            ...(process.platform === "win32" &&
            process.env.SystemRoot !== undefined
              ? { SystemRoot: process.env.SystemRoot }
              : {}),
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      const stdout = [];
      const stderr = [];
      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
      child.once("error", rejectPromise);
      child.once("close", (code) => {
        if (code !== 0) {
          rejectPromise(new Error(Buffer.concat(stderr).toString("utf8")));
        } else {
          resolvePromise(Buffer.concat(stdout).toString("utf8"));
        }
      });
    });
    const observed = JSON.parse(output);
    assert.equal(observed.worker, -1_000_000_000_000);
    assert.ok(observed.main > 0);
    assert.ok(0 - observed.worker > 100);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("pnpm store index has one canonical logical preimage", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "cloudmarkup-pnpm-index-"));
  const integrity = (byte) => Buffer.alloc(64, byte).toString("base64");
  const records = [
    [`sha512-${integrity(1)}\ta@1.0.0`, Buffer.from([0x81, 0xa1, 0x61, 0x01])],
    [`sha512-${integrity(2)}\tb@2.0.0`, Buffer.from([0x81, 0xa1, 0x62, 0x02])],
  ];
  const createIndex = async (name, values) => {
    const storeRoot = resolve(root, name);
    const databasePath = resolve(
      storeRoot,
      ...PNPM_STORE_INDEX_DATABASE_PATH.split("/"),
    );
    await mkdir(dirname(databasePath), { recursive: true });
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`CREATE TABLE package_index (
          key TEXT PRIMARY KEY,
          data BLOB NOT NULL
        ) WITHOUT ROWID`);
      const insert = database.prepare(
        "INSERT INTO package_index (key, data) VALUES (?, ?)",
      );
      for (const [key, data] of values) insert.run(key, data);
    } finally {
      database.close();
    }
    return { databasePath, storeRoot };
  };
  try {
    const left = await createIndex("left", records);
    const right = await createIndex("right", [...records].reverse());
    const [leftAuthority, rightAuthority] = await Promise.all([
      exportCanonicalPnpmStoreIndex(left.storeRoot),
      exportCanonicalPnpmStoreIndex(right.storeRoot),
    ]);
    assert.deepEqual(leftAuthority, rightAuthority);
    const canonicalPath = (storeRoot) =>
      resolve(storeRoot, ...CANONICAL_PNPM_STORE_INDEX_PATH.split("/"));
    assert.deepEqual(
      await readFile(canonicalPath(left.storeRoot)),
      await readFile(canonicalPath(right.storeRoot)),
    );
    const concurrentRoot = resolve(root, "concurrent");
    await mkdir(resolve(concurrentRoot, "v11"), { recursive: true });
    await writeFile(
      canonicalPath(concurrentRoot),
      await readFile(canonicalPath(left.storeRoot)),
    );
    const concurrentResults = await Promise.allSettled([
      restoreCanonicalPnpmStoreIndex(concurrentRoot),
      restoreCanonicalPnpmStoreIndex(concurrentRoot),
    ]);
    assert.equal(
      concurrentResults.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    assert.equal(
      concurrentResults.filter(({ status }) => status === "rejected").length,
      1,
    );
    assert.equal(
      (
        await lstat(
          resolve(concurrentRoot, ...PNPM_STORE_INDEX_DATABASE_PATH.split("/")),
        )
      ).isFile(),
      true,
    );
    assert.deepEqual((await readdir(resolve(concurrentRoot, "v11"))).sort(), [
      "index-v1.json",
      "index.db",
    ]);
    for (const databasePath of [left.databasePath, right.databasePath]) {
      assert.equal(
        await lstat(databasePath).then(
          () => true,
          () => false,
        ),
        false,
      );
      for (const suffix of ["-journal", "-shm", "-wal"]) {
        assert.equal(
          await lstat(`${databasePath}${suffix}`).then(
            () => true,
            () => false,
          ),
          false,
        );
      }
    }

    const restored = await restoreCanonicalPnpmStoreIndex(left.storeRoot);
    assert.equal(restored.entryCount, records.length);
    const verification = new DatabaseSync(left.databasePath, {
      readOnly: true,
    });
    try {
      const actual = verification
        .prepare("SELECT key, data FROM package_index ORDER BY key")
        .all()
        .map(({ data, key }) => [key, Buffer.from(data)]);
      assert.deepEqual(actual, records);
    } finally {
      verification.close();
    }

    const noncanonical = JSON.parse(
      await readFile(canonicalPath(right.storeRoot), "utf8"),
    );
    noncanonical.entries.reverse();
    await writeFile(
      canonicalPath(right.storeRoot),
      JSON.stringify(noncanonical),
    );
    await assert.rejects(
      restoreCanonicalPnpmStoreIndex(right.storeRoot),
      /PNPM_STORE_INDEX_INVALID/u,
    );
    assert.equal(
      await lstat(right.databasePath).then(
        () => true,
        () => false,
      ),
      false,
    );

    const sidecar = await createIndex("sidecar", records);
    await writeFile(`${sidecar.databasePath}-wal`, Buffer.from([1]));
    await assert.rejects(
      exportCanonicalPnpmStoreIndex(sidecar.storeRoot),
      /PNPM_STORE_INDEX_INVALID/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("pnpm store index rejects a linked version-directory escape", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "cloudmarkup-pnpm-index-link-"));
  try {
    const storeRoot = resolve(root, "store");
    const outside = resolve(root, "outside");
    await mkdir(storeRoot);
    await mkdir(outside);
    try {
      await symlink(
        outside,
        resolve(storeRoot, "v11"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      t.skip(`directory links unavailable: ${error.code}`);
      return;
    }
    const databasePath = resolve(outside, "index.db");
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`CREATE TABLE package_index (
          key TEXT PRIMARY KEY,
          data BLOB NOT NULL
        ) WITHOUT ROWID`);
      database
        .prepare("INSERT INTO package_index (key, data) VALUES (?, ?)")
        .run(
          `sha512-${Buffer.alloc(64, 3).toString("base64")}\tpkg@1.0.0`,
          Buffer.from([1]),
        );
    } finally {
      database.close();
    }
    await assert.rejects(
      exportCanonicalPnpmStoreIndex(storeRoot),
      /PNPM_STORE_INDEX_INVALID/u,
    );
    assert.equal((await lstat(databasePath)).isFile(), true);
    assert.equal(
      await lstat(resolve(outside, "index-v1.json")).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFixture(
  name,
  content,
  {
    centralExtra = Buffer.alloc(0),
    descriptor = false,
    descriptorSignature = 0x08074b50,
    flags = 0x0800,
    localExtra = centralExtra,
  } = {},
) {
  const compressed = deflateRawSync(content);
  const nameBytes = Buffer.from(name, "utf8");
  const crc = crc32(content);
  const local = Buffer.alloc(30 + nameBytes.byteLength + localExtra.byteLength);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(descriptor ? 0 : crc, 14);
  local.writeUInt32LE(descriptor ? 0 : compressed.byteLength, 18);
  local.writeUInt32LE(descriptor ? 0 : content.byteLength, 22);
  local.writeUInt16LE(nameBytes.byteLength, 26);
  local.writeUInt16LE(localExtra.byteLength, 28);
  nameBytes.copy(local, 30);
  localExtra.copy(local, 30 + nameBytes.byteLength);
  const dataDescriptor = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
  if (descriptor) {
    dataDescriptor.writeUInt32LE(descriptorSignature, 0);
    dataDescriptor.writeUInt32LE(crc, 4);
    dataDescriptor.writeUInt32LE(compressed.byteLength, 8);
    dataDescriptor.writeUInt32LE(content.byteLength, 12);
  }
  const central = Buffer.alloc(
    46 + nameBytes.byteLength + centralExtra.byteLength,
  );
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x031e, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.byteLength, 20);
  central.writeUInt32LE(content.byteLength, 24);
  central.writeUInt16LE(nameBytes.byteLength, 28);
  central.writeUInt16LE(centralExtra.byteLength, 30);
  central.writeUInt32LE((0o100755 << 16) >>> 0, 38);
  nameBytes.copy(central, 46);
  centralExtra.copy(central, 46 + nameBytes.byteLength);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.byteLength, 12);
  eocd.writeUInt32LE(
    local.byteLength + compressed.byteLength + dataDescriptor.byteLength,
    16,
  );
  return Buffer.concat([local, compressed, dataDescriptor, central, eocd]);
}

test("strict ZIP extraction accepts exact bytes and rejects path traversal", () => {
  const content = Buffer.from("binary bytes", "utf8");
  const artifact = {
    members: [
      {
        archivePath: "tool",
        destination: "offline/bin/tool",
        executable: true,
        mode: "0755",
        role: "validation-tool",
        sha256: sha256(content),
        sizeBytes: content.byteLength,
      },
    ],
    url: "https://example.invalid/tool.zip",
  };
  assert.deepEqual(
    extractPinnedZip(zipFixture("tool", content), artifact)[0].bytes,
    content,
  );
  assert.throws(
    () =>
      extractPinnedZip(zipFixture("../tool", content), {
        ...artifact,
        members: [{ ...artifact.members[0], archivePath: "../tool" }],
      }),
    /CONTEXT_PATH_INVALID/u,
  );
});

test("ZIP extraction admits only reviewed signed descriptors and timestamp extras", async (t) => {
  const content = Buffer.from("reviewed descriptor bytes", "utf8");
  const layouts = [
    {
      extra: "01ed270b69",
      url: "https://releases.hashicorp.com/terraform/1.13.5/terraform_1.13.5_linux_amd64.zip",
    },
    {
      extra: "01a97b996a",
      url: "https://releases.hashicorp.com/terraform-provider-aws/6.63.0/terraform-provider-aws_6.63.0_linux_amd64.zip",
    },
    {
      extra: "01410bb468",
      url: "https://github.com/terraform-linters/tflint/releases/download/v0.59.1/tflint_linux_amd64.zip",
    },
  ];
  const artifactFor = (url) => ({
    members: [
      {
        archivePath: "tool",
        destination: "offline/bin/tool",
        executable: true,
        mode: "0755",
        role: "validation-tool",
        sha256: sha256(content),
        sizeBytes: content.byteLength,
      },
    ],
    url,
  });
  const extraFor = (payload) => Buffer.from("55540500" + payload, "hex");

  for (const layout of layouts) {
    await t.test(layout.url, () => {
      assert.deepEqual(
        extractPinnedZip(
          zipFixture("tool", content, {
            centralExtra: extraFor(layout.extra),
            descriptor: true,
            flags: 0x0008,
          }),
          artifactFor(layout.url),
        )[0].bytes,
        content,
      );
    });
  }

  const layout = layouts[0];
  const artifact = artifactFor(layout.url);
  const reviewedExtra = extraFor(layout.extra);
  await t.test("unknown same-size extra", () => {
    const unknown = Buffer.from(reviewedExtra);
    unknown[0] ^= 1;
    assert.throws(
      () =>
        extractPinnedZip(
          zipFixture("tool", content, {
            centralExtra: unknown,
            descriptor: true,
            flags: 0x0008,
          }),
          artifact,
        ),
      /CONTEXT_ZIP_EXTRA_INVALID/u,
    );
  });
  await t.test("duplicate extra", () => {
    assert.throws(
      () =>
        extractPinnedZip(
          zipFixture("tool", content, {
            centralExtra: Buffer.concat([reviewedExtra, reviewedExtra]),
            descriptor: true,
            flags: 0x0008,
          }),
          artifact,
        ),
      /CONTEXT_ZIP_INVALID/u,
    );
  });
  await t.test("conflicting local extra", () => {
    const conflicting = Buffer.from(reviewedExtra);
    conflicting[conflicting.byteLength - 1] ^= 1;
    assert.throws(
      () =>
        extractPinnedZip(
          zipFixture("tool", content, {
            centralExtra: reviewedExtra,
            descriptor: true,
            flags: 0x0008,
            localExtra: conflicting,
          }),
          artifact,
        ),
      /CONTEXT_ZIP_INVALID/u,
    );
  });
  await t.test("unsigned descriptor", () => {
    assert.throws(
      () =>
        extractPinnedZip(
          zipFixture("tool", content, {
            centralExtra: reviewedExtra,
            descriptor: true,
            descriptorSignature: 0,
            flags: 0x0008,
          }),
          artifact,
        ),
      /CONTEXT_ZIP_DESCRIPTOR_INVALID/u,
    );
  });
});

function tarFixture(name, content, mode = 0o755) {
  const header = Buffer.alloc(512);
  Buffer.from(name).copy(header, 0);
  Buffer.from(mode.toString(8).padStart(7, "0") + "\0").copy(header, 100);
  Buffer.from("0000000\0").copy(header, 108);
  Buffer.from("0000000\0").copy(header, 116);
  Buffer.from(content.byteLength.toString(8).padStart(11, "0") + "\0").copy(
    header,
    124,
  );
  Buffer.from("00000000000\0").copy(header, 136);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  Buffer.from("ustar\0").copy(header, 257);
  Buffer.from("00").copy(header, 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  Buffer.from(checksum.toString(8).padStart(6, "0") + "\0 ").copy(header, 148);
  const padding = Buffer.alloc((512 - (content.byteLength % 512)) % 512);
  return gzipSync(
    Buffer.concat([header, content, padding, Buffer.alloc(1024)]),
    {
      mtime: 0,
    },
  );
}

test("strict tar.gz extraction accepts the exact declared regular member", () => {
  const content = Buffer.from("standalone tool", "utf8");
  const artifact = {
    members: [
      {
        archivePath: "tool",
        destination: "offline/toolchain/tool",
        disposition: "extract",
        executable: true,
        mode: "0755",
        role: "package-manager-cli",
        sha256: sha256(content),
        sizeBytes: content.byteLength,
      },
    ],
    url: "https://example.invalid/tool.tar.gz",
  };
  assert.deepEqual(
    extractPinnedTarGzip(tarFixture("tool", content), artifact)[0].bytes,
    content,
  );
  assert.throws(
    () =>
      extractPinnedTarGzip(tarFixture("../tool", content), {
        ...artifact,
        members: [{ ...artifact.members[0], archivePath: "../tool" }],
      }),
    /CONTEXT_PATH_INVALID/u,
  );
});

test("HTTPS acquisition admits only bounded reviewed release redirects", async (t) => {
  const content = Buffer.from("reviewed bytes", "utf8");
  const artifact = {
    sha256: sha256(content),
    sizeBytes: content.byteLength,
    url: "https://github.com/example/project/releases/download/v1/tool.zip",
  };
  await t.test("approved release asset", async () => {
    const calls = [];
    const bytes = await fetchPinnedArtifact(artifact, async (url, options) => {
      calls.push({ options, url });
      if (calls.length === 1) {
        return new Response(null, {
          headers: {
            location:
              "https://release-assets.githubusercontent.com/github-production-release-asset/tool.zip?signature=reviewed",
          },
          status: 302,
        });
      }
      return new Response(content, {
        headers: { "content-length": String(content.byteLength) },
        status: 200,
      });
    });
    assert.deepEqual(bytes, content);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(({ options }) => options.credentials === "omit"));
    assert.ok(calls.every(({ options }) => options.redirect === "manual"));
    assert.ok(
      calls.every(({ options }) => options.headers.authorization === undefined),
    );
  });
  await t.test("unapproved redirect", async () => {
    await assert.rejects(
      fetchPinnedArtifact(
        artifact,
        async () =>
          new Response(null, {
            headers: { location: "https://example.invalid/tool.zip" },
            status: 302,
          }),
      ),
      /CONTEXT_ACQUISITION_REDIRECT_INVALID/u,
    );
  });
  await t.test("redirect loop", async () => {
    await assert.rejects(
      fetchPinnedArtifact(
        artifact,
        async () =>
          new Response(null, {
            headers: {
              location:
                "https://release-assets.githubusercontent.com/github-production-release-asset/tool.zip",
            },
            status: 302,
          }),
      ),
      /CONTEXT_ACQUISITION_REDIRECT_LOOP/u,
    );
  });
  await t.test("oversized streamed body", async () => {
    await assert.rejects(
      fetchPinnedArtifact(
        { ...artifact, sizeBytes: content.byteLength - 1 },
        async () => new Response(content, { status: 200 }),
      ),
      /CONTEXT_RESPONSE_SIZE_INVALID/u,
    );
  });
});

test("OCI layer redirect is digest-path-bound and drops bearer authorization", async (t) => {
  const content = Buffer.from("layer", "utf8");
  const source = "https://ghcr.io/v2/aquasecurity/trivy-db/blobs/sha256:abc";
  const target =
    "https://pkg-containers.githubusercontent.com/ghcrblobs19/blobs/sha256:abc?signature=reviewed";
  const authority = {
    hostname: "pkg-containers.githubusercontent.com",
    pathSuffix: "/blobs/sha256:abc",
  };
  await t.test("approved redirect", async () => {
    const calls = [];
    const bytes = await fetchOciBytes(
      async (url, options) => {
        calls.push({ options, url });
        return calls.length === 1
          ? new Response(null, {
              headers: { location: target },
              status: 307,
            })
          : new Response(content, { status: 200 });
      },
      source,
      {
        accept: "application/octet-stream",
        authorization: "reviewed-anonymous-token",
        maximum: content.byteLength,
        redirectAuthority: authority,
      },
    );
    assert.deepEqual(bytes, content);
    assert.equal(
      calls[0].options.headers.authorization,
      "Bearer reviewed-anonymous-token",
    );
    assert.equal(calls[1].options.headers.authorization, undefined);
  });
  await t.test("unapproved host", async () => {
    await assert.rejects(
      fetchOciBytes(
        async () =>
          new Response(null, {
            headers: {
              location: "https://example.invalid/ghcrblobs19/blobs/sha256:abc",
            },
            status: 307,
          }),
        source,
        {
          accept: "application/octet-stream",
          authorization: "reviewed-anonymous-token",
          maximum: content.byteLength,
          redirectAuthority: authority,
        },
      ),
      /CONTEXT_OCI_REDIRECT_INVALID/u,
    );
  });
});

test("digest formatting emits exactly two bare lowercase authorities", () => {
  const application = fakeDigest("application");
  const terraform = fakeDigest("terraform");
  assert.equal(
    formatBetaImageContextDigests({
      "application-build": application,
      "terraform-validation": terraform,
    }),
    `APPLICATION_BUILD_CONTEXT_SHA256=${application}\nTERRAFORM_VALIDATION_CONTEXT_SHA256=${terraform}\n`,
  );
  assert.ok(
    !formatBetaImageContextDigests({
      "application-build": application,
      "terraform-validation": terraform,
    }).includes("sha256:"),
  );
});

test("application-only acquisition selects no Terraform tools and keeps complete source admission", async () => {
  await withFixture(async ({ root }) => {
    const contexts = await validateBetaImageContexts(root, {
      contextIds: ["application-build"],
    });
    assert.deepEqual(
      contexts.map((context) => context.spec.contextId),
      ["application-build"],
    );
    assert.ok(
      contexts
        .flatMap((context) => context.artifacts)
        .every((artifact) => !["terraform", "tflint"].includes(artifact.tool)),
    );
    await writeFile(
      resolve(root, "infra/images/terraform-validation/Dockerfile"),
      "tampered\n",
    );
    let fetched = false;
    await assert.rejects(
      materializeBetaImageContexts(root, {
        contextIds: ["application-build"],
        fetchImpl: async () => {
          fetched = true;
          throw Error("must not fetch");
        },
      }),
      /CONTEXT_DOCKER_RUNTIME_UNSAFE/u,
    );
    assert.equal(fetched, false);
  });
});

test("invalid or empty context selection fails before filesystem, fetch or staging access", async () => {
  for (const contextIds of [
    [],
    ["unknown"],
    ["application-build", "application-build"],
    "../escape",
    null,
  ]) {
    await assert.rejects(
      materializeBetaImageContexts(resolve("nonexistent-context-root"), {
        contextIds,
        fetchImpl: () => assert.fail("must not fetch"),
      }),
      /CONTEXT_SELECTION_INVALID/u,
    );
  }
});

test("scoped digest receipts cannot be confused with the complete release context pair", () => {
  const application = { "application-build": fakeDigest("application") };
  assert.equal(
    formatBetaImageContextDigests(application, ["application-build"]),
    `APPLICATION_BUILD_CONTEXT_SHA256=${application["application-build"]}\n`,
  );
  assert.throws(
    () => formatBetaImageContextDigests(application),
    /CONTEXT_DIGEST_INVALID/u,
  );
  assert.throws(
    () =>
      formatBetaImageContextDigests(
        {
          ...application,
          "terraform-validation": fakeDigest("terraform"),
        },
        ["application-build"],
      ),
    /CONTEXT_DIGEST_INVALID/u,
  );
});
