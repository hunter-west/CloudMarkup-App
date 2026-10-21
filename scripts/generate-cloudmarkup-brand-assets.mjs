import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const diagramExportRequire = createRequire(
  resolve("packages", "diagram-export", "package.json"),
);
const { Resvg } = diagramExportRequire("@resvg/resvg-js");

const brandRoot = resolve("apps", "web", "src", "assets", "brand", "public");
const sourcePath = resolve(brandRoot, "cloudmarkup-logo.png");
const sourceSha256 =
  "5de84bce69f6348cb1c8a2272c4bc966dcde444c87df0808f48dbae953e70bf6";
const sourceByteLength = 313_933;
const sourceDimensions = Object.freeze({ height: 1_254, width: 1_254 });
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const generatedPngSizes = Object.freeze({
  "app-icon-192.png": 192,
  "app-icon-512.png": 512,
  "apple-touch-icon.png": 180,
});
const faviconSizes = Object.freeze([16, 32, 48, 64, 128, 256]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertPng(bytes, expectedDimensions, label) {
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, pngSignature.length).equals(pngSignature) ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR" ||
    bytes.readUInt32BE(16) !== expectedDimensions.width ||
    bytes.readUInt32BE(20) !== expectedDimensions.height
  ) {
    throw new Error(`${label} is not the expected PNG.`);
  }
}

async function readRegularFile(path, label) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  return readFile(path);
}

async function readSource() {
  const source = await readRegularFile(sourcePath, "The Cloud Markup logo");
  if (source.length !== sourceByteLength || sha256(source) !== sourceSha256) {
    throw new Error(
      "The Cloud Markup logo must remain byte-identical to the supplied source.",
    );
  }
  assertPng(source, sourceDimensions, "The Cloud Markup logo");
  return source;
}

function renderSquarePng(source, size) {
  const encodedSource = source.toString("base64");
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg"',
    ` width="${String(sourceDimensions.width)}"`,
    ` height="${String(sourceDimensions.height)}"`,
    ` viewBox="0 0 ${String(sourceDimensions.width)} ${String(sourceDimensions.height)}">`,
    '<image x="0" y="0"',
    ` width="${String(sourceDimensions.width)}"`,
    ` height="${String(sourceDimensions.height)}"`,
    ` href="data:image/png;base64,${encodedSource}"/>`,
    "</svg>",
  ].join("");
  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: false },
  });
  const rendered = Buffer.from(renderer.render().asPng());
  assertPng(rendered, { height: size, width: size }, `${String(size)}px icon`);
  return rendered;
}

function createIco(images) {
  const headerByteLength = 6 + images.length * 16;
  const header = Buffer.alloc(headerByteLength);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = headerByteLength;
  for (const [index, image] of images.entries()) {
    const entryOffset = 6 + index * 16;
    header.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset);
    header.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.bytes.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += image.bytes.length;
  }
  return Buffer.concat([header, ...images.map(({ bytes }) => bytes)]);
}

export async function buildCloudMarkupBrandAssets() {
  const source = await readSource();
  const generated = new Map();
  for (const [file, size] of Object.entries(generatedPngSizes)) {
    generated.set(file, renderSquarePng(source, size));
  }
  const faviconImages = faviconSizes.map((size) => ({
    bytes: renderSquarePng(source, size),
    size,
  }));
  generated.set("favicon.ico", createIco(faviconImages));
  return generated;
}

export async function checkCloudMarkupBrandAssets() {
  const expected = await buildCloudMarkupBrandAssets();
  for (const [file, bytes] of expected) {
    const actual = await readRegularFile(
      resolve(brandRoot, file),
      `Cloud Markup brand asset ${file}`,
    );
    if (!actual.equals(bytes)) {
      throw new Error(
        `Cloud Markup brand asset ${file} does not match its deterministic source rendering.`,
      );
    }
  }
  return Object.freeze(
    [...expected].map(([file, bytes]) =>
      Object.freeze({ byteLength: bytes.length, file, sha256: sha256(bytes) }),
    ),
  );
}

async function writeCloudMarkupBrandAssets() {
  const generated = await buildCloudMarkupBrandAssets();
  for (const [file, bytes] of generated) {
    await writeFile(resolve(brandRoot, file), bytes, { flag: "w" });
  }
  return checkCloudMarkupBrandAssets();
}

async function main() {
  const mode = process.argv[2] ?? "--check";
  if (mode !== "--check" && mode !== "--write") {
    throw new Error(
      "Usage: node scripts/generate-cloudmarkup-brand-assets.mjs [--check|--write]",
    );
  }
  const assets =
    mode === "--write"
      ? await writeCloudMarkupBrandAssets()
      : await checkCloudMarkupBrandAssets();
  process.stdout.write(
    `Cloud Markup brand assets ${mode === "--write" ? "generated and verified" : "verified"}: ${assets
      .map(
        ({ byteLength, file, sha256: digest }) =>
          `${file} (${String(byteLength)} bytes, sha256:${digest})`,
      )
      .join(", ")}\n`,
  );
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPoint)).href
) {
  await main();
}
