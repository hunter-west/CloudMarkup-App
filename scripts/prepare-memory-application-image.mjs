// Produces a local context from trusted repository code only. No candidate
// input, acquisition, image build, push, or deployment is performed.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export function pinnedApplicationImage(value) {
  if (
    !/^[a-z0-9][a-z0-9./_-]{1,255}(?::candidate)?@sha256:[a-f0-9]{64}$/u.test(
      value ?? "",
    )
  )
    throw new TypeError(
      "An exact previously verified application tool image is required.",
    );
  return value;
}
export function memoryImageDockerfile(
  baseImage,
  helperDigest,
  localContext = false,
) {
  pinnedApplicationImage(baseImage);
  if (!/^sha256:[a-f0-9]{64}$/u.test(helperDigest))
    throw new TypeError("Exact helper bytes are required.");
  return [
    "FROM " + (localContext ? "cloudmarkup-memory-base" : baseImage),
    'LABEL cloudmarkup.memory-workspace.protocol="1"',
    'LABEL cloudmarkup.memory-workspace.sha256="' + helperDigest + '"',
    "COPY --chown=65532:65532 --chmod=0444 memory-workspace-v1.mjs /opt/cloudmarkup/service/memory-workspace-v1.mjs",
    "USER 65532:65532",
    "WORKDIR /workspace",
    'ENTRYPOINT ["/usr/local/bin/node", "/opt/cloudmarkup/service/memory-workspace-v1.mjs"]',
    "",
  ].join("\n");
}
export async function prepareMemoryApplicationImage({
  repositoryRoot,
  output,
  baseImage,
  localContext = false,
}) {
  pinnedApplicationImage(baseImage);
  const root = resolve(repositoryRoot),
    destination = resolve(output);
  const local = relative(resolve(root, ".cache"), destination);
  if (
    !isAbsolute(output) ||
    local === "" ||
    local.startsWith(".." + sep) ||
    local === ".." ||
    isAbsolute(local)
  )
    throw new TypeError(
      "Image context must use a new task-owned directory below this checkout's .cache.",
    );
  const result = await build({
    absWorkingDir: root,
    entryPoints: [
      "packages/application-build-runner/src/memory-workspace-service.ts",
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    write: false,
    legalComments: "none",
    sourcemap: false,
    logLevel: "silent",
  });
  if (result.outputFiles.length !== 1)
    throw new TypeError("Memory helper must have one closed bundle.");
  const bytes = result.outputFiles[0].contents;
  const helperDigest =
    "sha256:" + createHash("sha256").update(bytes).digest("hex");
  await mkdir(destination, { recursive: false });
  await writeFile(resolve(destination, "memory-workspace-v1.mjs"), bytes, {
    flag: "wx",
    mode: 0o444,
  });
  const dockerfile = memoryImageDockerfile(
    baseImage,
    helperDigest,
    localContext,
  );
  await writeFile(resolve(destination, "Dockerfile"), dockerfile, {
    flag: "wx",
    mode: 0o444,
  });
  const manifest = {
    contractVersion: 1,
    kind: "cloudmarkup.application-memory-image-inputs",
    helperProtocolVersion: "1.0.0",
    baseImage,
    ...(localContext ? { baseImageContext: "cloudmarkup-memory-base" } : {}),
    helperDigest,
    dockerfileDigest:
      "sha256:" + createHash("sha256").update(dockerfile).digest("hex"),
  };
  await writeFile(
    resolve(destination, "memory-image-inputs-v1.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx", mode: 0o444 },
  );
  return manifest;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4)
    throw new TypeError(
      "Expected exact base image and new absolute context directory.",
    );
  const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  prepareMemoryApplicationImage({
    repositoryRoot,
    baseImage: process.argv[2],
    output: process.argv[3],
  })
    .then((manifest) => {
      process.stdout.write(JSON.stringify(manifest) + "\n");
    })
    .catch(() => {
      process.stderr.write("Memory image context preparation failed.\n");
      process.exitCode = 1;
    });
}
