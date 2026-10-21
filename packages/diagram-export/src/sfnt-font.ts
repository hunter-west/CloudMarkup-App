/** Exact deterministic SFNT reconstruction of the existing locked Inter WOFF1
 * assets. No system fonts, new font family or downloaded converter is used. */
export const DIAGRAM_SFNT_FONT_SOURCE = Object.freeze({
  converter: { id: "cloudmarkup.woff1-sfnt", version: "1.0.0" },
  sourcePackage: { name: "@fontsource/inter", version: "5.3.0" },
  format: "sfnt",
  regular: {
    sourceFile: "inter-latin-400-normal.woff",
    sourceSha256:
      "e20fa0b4fd2dd26e4d14b3ac3cc922509c3a63fa5e910e90c614544aa042dd45",
    sourceSizeBytes: 30696,
    outputFile: "inter-latin-400-normal.ttf",
    outputSha256:
      "27396a89e10048c8e76096b1b4a5500bdc54d3b04d200f267ed6bf0d5466b2ba",
    outputSizeBytes: 67952,
  },
  semibold: {
    sourceFile: "inter-latin-600-normal.woff",
    sourceSha256:
      "6a9cb3a509b4eeaf12b7dda6c4aacac3e85d07f4201bf4dd716e332e692b87bd",
    sourceSizeBytes: 31260,
    outputFile: "inter-latin-600-normal.ttf",
    outputSha256:
      "85c5903688f4329aaeebfc050fe6c3cb373f75ef1ff0a6f68d2640a870573584",
    outputSizeBytes: 68060,
  },
} as const);
export const DIAGRAM_SFNT_FONT = Object.freeze({
  family: "Inter" as const,
  regularDigest:
    `sha256:${DIAGRAM_SFNT_FONT_SOURCE.regular.outputSha256}` as const,
  semiboldDigest:
    `sha256:${DIAGRAM_SFNT_FONT_SOURCE.semibold.outputSha256}` as const,
  source: "pinned-local-assets" as const,
  version: "5.3.0" as const,
});
