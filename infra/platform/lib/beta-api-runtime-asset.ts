import { fileURLToPath } from "node:url";
import { AssetHashType, aws_lambda as lambda } from "aws-cdk-lib";
import { buildSync } from "esbuild";

/** CDK's ordinary NodejsFunction uses --outfile, which cannot emit lazy ESM
 * chunks. This local, fixed-entry build uses the same reviewed esbuild package
 * and output hashing while preserving conditional native module loading. */
export function createBetaApiRuntimeCode(): lambda.Code {
  const source = fileURLToPath(
    new URL("../../../apps/api/src/", import.meta.url),
  );
  return lambda.Code.fromAsset(source, {
    assetHashType: AssetHashType.OUTPUT,
    bundling: {
      image: lambda.Runtime.NODEJS_24_X.bundlingImage,
      command: ["false"],
      local: {
        tryBundle(outputDirectory) {
          buildBetaApiRuntime(outputDirectory);
          return true;
        },
      },
    },
  });
}

/** The same fixed-entry build is exercised by the real cold-start regression. */
export function buildBetaApiRuntime(outputDirectory: string) {
  return buildSync({
    absWorkingDir: fileURLToPath(new URL("../../../", import.meta.url)),
    entryPoints: {
      index: fileURLToPath(
        new URL("../../../apps/api/src/production-lambda.ts", import.meta.url),
      ),
    },
    outdir: outputDirectory,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    splitting: true,
    platform: "node",
    target: "node24",
    minify: false,
    sourcemap: true,
    sourcesContent: false,
    external: ["@resvg/resvg-js"],
    banner: {
      js: 'import { createRequire as cloudmarkupCreateRequire } from "node:module"; const require = cloudmarkupCreateRequire(import.meta.url);',
    },
    logLevel: "error",
    metafile: true,
  });
}
