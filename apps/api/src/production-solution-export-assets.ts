import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import {
  DIAGRAM_FONT,
  DIAGRAM_SFNT_FONT_SOURCE,
} from "@cloudmarkup/diagram-export";

import { convertPinnedWoff1ToSfnt } from "./production-solution-export-font-converter.js";

import { collectAwsDiagramIconRegistryBundle } from "./provider-icons/aws-diagram-icon-registry.js";

export interface ProductionSolutionExportAsset {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Build-time-only local asset staging. Every input is an existing declared,
 * lock-pinned package; no downloads or arbitrary source paths are accepted. */
export function collectProductionSolutionExportAssets(): {
  readonly iconBundle: ProductionSolutionExportAsset;
  readonly runtimeFiles: readonly ProductionSolutionExportAsset[];
} {
  const iconBundle = collectAwsDiagramIconRegistryBundle();
  const diagramRequire = createRequire(
    import.meta.resolve("@cloudmarkup/diagram-export"),
  );
  const resvgRoot = dirname(
    diagramRequire.resolve("@resvg/resvg-js/package.json"),
  );
  const nativeRequire = createRequire(join(resvgRoot, "package.json"));
  const nativeRoot = dirname(
    nativeRequire.resolve("@resvg/resvg-js-linux-arm64-gnu/package.json"),
  );
  const fontRoot = dirname(
    diagramRequire.resolve("@fontsource/inter/package.json"),
  );
  const packages = [
    {
      root: resvgRoot,
      name: "@resvg/resvg-js",
      version: "2.6.2",
      files: ["package.json", "index.js", "js-binding.js", "LICENSE"],
    },
    {
      root: nativeRoot,
      name: "@resvg/resvg-js-linux-arm64-gnu",
      version: "2.6.2",
      files: ["package.json", "resvgjs.linux-arm64-gnu.node"],
    },
    {
      root: fontRoot,
      name: "@fontsource/inter",
      version: "5.3.0",
      files: [
        "package.json",
        "LICENSE",
        "files/inter-latin-400-normal.woff2",
        "files/inter-latin-600-normal.woff2",
      ],
    },
  ] as const;
  const runtimeFiles = packages.flatMap((pkg) => {
    const metadata = JSON.parse(
      readFileSync(join(pkg.root, "package.json"), "utf8"),
    ) as { name: string; version: string };
    if (metadata.name !== pkg.name || metadata.version !== pkg.version)
      throw new TypeError(
        "The export runtime package does not match the reviewed version.",
      );
    return pkg.files.map((file) => {
      const content = readFileSync(join(pkg.root, file));
      const checksum = sha256(content);
      if (
        file.endsWith(".node") &&
        (content.length < 64 ||
          content.subarray(0, 6).toString("hex") !== "7f454c460201" ||
          content.readUInt16LE(18) !== 183)
      )
        throw new TypeError(
          "The diagram rasterizer must be the Linux ARM64 ELF module.",
        );
      if (
        (file.endsWith("400-normal.woff2") &&
          "sha256:" + checksum !== DIAGRAM_FONT.regularDigest) ||
        (file.endsWith("600-normal.woff2") &&
          "sha256:" + checksum !== DIAGRAM_FONT.semiboldDigest)
      )
        throw new TypeError(
          "The diagram fonts do not match the actual renderer pin.",
        );
      return {
        path: "nodejs/node_modules/" + pkg.name + "/" + file,
        bytes: content,
        sha256: checksum,
      };
    });
  });
  for (const font of [
    DIAGRAM_SFNT_FONT_SOURCE.regular,
    DIAGRAM_SFNT_FONT_SOURCE.semibold,
  ]) {
    const source = readFileSync(join(fontRoot, "files", font.sourceFile));
    if (
      source.length !== font.sourceSizeBytes ||
      sha256(source) !== font.sourceSha256
    )
      throw new TypeError(
        "The SFNT source font does not match the locked asset.",
      );
    const bytes = convertPinnedWoff1ToSfnt(source);
    if (
      bytes.length !== font.outputSizeBytes ||
      sha256(bytes) !== font.outputSha256
    )
      throw new TypeError(
        "The reconstructed SFNT font does not match its exact output pin.",
      );
    runtimeFiles.push({
      path: "cloudmarkup-export/fonts/" + font.outputFile,
      bytes: Buffer.from(bytes),
      sha256: font.outputSha256,
    });
  }
  return { iconBundle, runtimeFiles };
}
