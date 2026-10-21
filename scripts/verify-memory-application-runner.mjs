// Explicit opt-in real-container proof. Full stdin request, result and package
// bytes stay in memory; only derived identity/count/digest metadata is emitted.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  createMemoryProofCheckpoint,
  encodeMemoryProofFailure,
} from "./memory-proof-diagnostics.mjs";

const exec = promisify(execFile),
  maximum = 256 * 1024 * 1024;
async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.byteLength;
    if (size > maximum)
      throw new RangeError("Memory proof input exceeds its bound.");
    chunks.push(chunk);
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, size),
    ),
  );
}
async function resources(docker, kind) {
  const { stdout } = await exec(
    docker,
    [
      kind,
      "ls",
      ...(kind === "container" ? ["--all"] : []),
      "--filter",
      "label=cloudmarkup.owner=cloudmarkup.application-memory-workspace.v1",
      "--format",
      kind === "container" ? "{{.Names}}" : "{{.Name}}",
    ],
    {
      env: { PATH: process.env.PATH },
      shell: false,
      timeout: 5000,
      maxBuffer: 65536,
    },
  );
  return stdout.trim().split("\n").filter(Boolean).sort();
}
async function main() {
  const checkpoint = createMemoryProofCheckpoint("child-bootstrap");
  try {
    if (
      process.env.CLOUDMARKUP_MEMORY_RUNNER_VERIFY !== "1" ||
      process.argv.length !== 3
    )
      throw new TypeError(
        "Real memory-runner proof requires explicit opt-in and a trusted Docker executable.",
      );
    const docker = process.argv[2];
    const api = await import(
      pathToFileURL(
        resolve(
          fileURLToPath(new URL("..", import.meta.url)),
          "packages/application-build-runner/dist/index.js",
        ),
      ).href
    );
    checkpoint.enter("child-host-admission");
    await api.assertMemoryApplicationBuildHost();
    checkpoint.enter("child-input-admission");
    const input = await readInput();
    const policy = api.applicationBuildPolicyV1Schema.parse(input.policy);
    const request = api.applicationBuildRequestV1Schema.parse(input.request);
    const config = {
      containerRuntimeExecutable: docker,
      policy,
      helperDigest: input.helperDigest,
      cacheBytes: input.cacheBytes,
    };
    checkpoint.enter("resource-before");
    const before = {
      containers: await resources(docker, "container"),
      volumes: await resources(docker, "volume"),
    };
    const results = [];
    for (let repeat = 0; repeat < 2; repeat += 1) {
      checkpoint.enter(repeat === 0 ? "build-1" : "build-2");
      const actual = api.createMemoryApplicationBuildContainerExecutor(config);
      const executor = {
        async open(input) {
          let session;
          try {
            session = await actual.open(input);
          } catch (error) {
            checkpoint.capture(
              "open",
              undefined,
              api.readMemoryApplicationBuildFailure(error),
            );
            throw error;
          }
          return {
            async execute(invocation, signal) {
              try {
                return await session.execute(invocation, signal);
              } catch (error) {
                checkpoint.capture("execute", invocation.step);
                throw error;
              }
            },
            async readProducedFiles() {
              try {
                return await session.readProducedFiles();
              } catch (error) {
                checkpoint.capture("collect");
                throw error;
              }
            },
            async dispose() {
              try {
                return await session.dispose();
              } catch (error) {
                checkpoint.capture("dispose");
                throw error;
              }
            },
          };
        },
      };
      const result = api.applicationBuildResultV1Schema.parse(
        await api
          .createApplicationBuildRunner({
            policy,
            executor,
          })
          .run(request),
      );
      checkpoint.result(
        result.state,
        result.steps.find((step) => step.state !== "passed")?.step,
      );
      if (
        result.state !== "passed" ||
        result.steps.length !== 9 ||
        result.steps.some((step) => step.state !== "passed") ||
        result.artifacts.length === 0
      )
        throw new TypeError(
          "Actual memory-only build did not complete its required tool sequence.",
        );
      results.push(result);
    }
    checkpoint.enter("reproducibility");
    const artifacts = (result) =>
      result.artifacts.map(({ path, checksum, sizeBytes }) => ({
        path,
        checksum,
        sizeBytes,
      }));
    if (
      JSON.stringify(artifacts(results[0])) !==
      JSON.stringify(artifacts(results[1]))
    )
      throw new TypeError("Actual memory-only artifacts are not reproducible.");
    checkpoint.enter("resource-after");
    const after = {
      containers: await resources(docker, "container"),
      volumes: await resources(docker, "volume"),
    };
    checkpoint.enter("cleanup-admission");
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new TypeError("Real memory workspace cleanup was not verified.");
    checkpoint.enter("observation-output");
    process.stdout.write(
      JSON.stringify({
        kind: "cloudmarkup.application-memory-runner-observation.v1",
        requestDigest: api.applicationBuildRequestDigest(request),
        solutionRevisionDigest: request.solutionRevisionDigest,
        candidateBundleDigest:
          request.source.kind === "ai-assisted-custom"
            ? request.source.candidateBundleDigest
            : null,
        sourceTreeDigest:
          "sourceTreeDigest" in request.source
            ? request.source.sourceTreeDigest
            : null,
        image: policy.container.image + "@" + policy.container.digest,
        helperDigest: config.helperDigest,
        reports: results.map(({ reportDigest }) => reportDigest),
        artifacts: artifacts(results[0]),
        exactCleanupVerified: true,
        reproducibleArtifactBytes: true,
      }) + "\n",
    );
  } catch (error) {
    throw checkpoint.failure(error);
  }
}
main().catch((error) => {
  process.stderr.write(encodeMemoryProofFailure(error));
  process.exitCode = 1;
});
