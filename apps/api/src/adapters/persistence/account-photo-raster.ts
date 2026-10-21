import { inflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import {
  ACCOUNT_PHOTO_EDGE_V1 as edge,
  MAX_ACCOUNT_PHOTO_BYTES_V1 as maximum,
} from "@cloudmarkup/api-contract";
import { ApplicationError } from "../../application/errors.js";

function invalid(): never {
  throw new ApplicationError(
    "invalid_request",
    "Choose another image. This photo could not be processed.",
  );
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
/** Bound compressed and decoded data before the raster decoder; discard all metadata. */
function boundedPng(bytes: Buffer): Buffer {
  if (bytes.length > maximum || !bytes.subarray(0, 8).equals(signature))
    invalid();
  const chunks: Buffer[] = [signature],
    compressed: Buffer[] = [];
  let offset = 8,
    channels = 0,
    ended = false,
    dataEnded = false;
  while (offset + 12 <= bytes.length && !ended) {
    const length = bytes.readUInt32BE(offset),
      end = offset + 12 + length;
    if (end > bytes.length) invalid();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (
      !/^[A-Za-z]{4}$/u.test(type) ||
      crc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      invalid();
    const data = bytes.subarray(offset + 8, end - 4);
    if (offset === 8) {
      if (
        type !== "IHDR" ||
        length !== 13 ||
        data.readUInt32BE(0) !== edge ||
        data.readUInt32BE(4) !== edge ||
        data[8] !== 8 ||
        ![2, 6].includes(data[9] ?? -1) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      )
        invalid();
      channels = data[9] === 6 ? 4 : 3;
      chunks.push(bytes.subarray(offset, end));
    } else if (type === "IDAT") {
      if (dataEnded) invalid();
      compressed.push(data);
      chunks.push(bytes.subarray(offset, end));
    } else if (type === "IEND") {
      if (length !== 0 || compressed.length === 0) invalid();
      ended = true;
      chunks.push(bytes.subarray(offset, end));
    } else {
      // APNG, unknown critical chunks and duplicate headers are not static RGB/RGBA photos.
      if (
        ["acTL", "fcTL", "fdAT"].includes(type) ||
        type.startsWith(type[0]?.toUpperCase() ?? "")
      )
        invalid();
      if (compressed.length > 0) dataEnded = true;
    }
    offset = end;
  }
  if (!ended || offset !== bytes.length) invalid();
  const stride = edge * channels + 1;
  const decoded = inflateSync(Buffer.concat(compressed), {
    maxOutputLength: edge * stride,
  });
  if (decoded.length !== edge * stride) invalid();
  for (let y = 0; y < edge; y++)
    if ((decoded[y * stride] ?? 255) > 4) invalid();
  return Buffer.concat(chunks);
}
/** Only constant SVG markup and checked inline PNG bytes reach resvg; no paths, URLs or fonts. */
export function canonicalAccountPhoto(dataUri: string): Buffer {
  try {
    if (!dataUri.startsWith("data:image/png;base64,")) invalid();
    const encoded = dataUri.slice("data:image/png;base64,".length);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) invalid();
    const safe = boundedPng(bytes);
    const renderer = new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${String(edge)}" height="${String(edge)}"><image width="${String(edge)}" height="${String(edge)}" href="data:image/png;base64,${safe.toString("base64")}"/></svg>`,
      { font: { loadSystemFonts: false }, logLevel: "off" },
    );
    if (renderer.imagesToResolve().length !== 0) invalid();
    const image = renderer.render();
    if (image.width !== edge || image.height !== edge) invalid();
    return boundedPng(image.asPng());
  } catch {
    return invalid();
  }
}
