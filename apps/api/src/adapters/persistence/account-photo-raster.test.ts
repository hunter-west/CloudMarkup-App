import { Resvg } from "@resvg/resvg-js";
import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { canonicalAccountPhoto } from "./account-photo-raster.js";
const png = (size = 192, height = size) =>
  new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(height)}"><rect width="100%" height="100%" fill="#365ec8"/></svg>`,
    { font: { loadSystemFonts: false } },
  )
    .render()
    .asPng();
const uri = (bytes: Buffer) =>
  "data:image/png;base64," + bytes.toString("base64");
// Build independently checksummed PNG fixtures so rejection is not just a bad CRC.
function chunk(type: string, data: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let checksum = 0xffffffff;
  for (const byte of payload) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++)
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  tail.writeUInt32BE((checksum ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, payload, tail]);
}
it("decodes and re-encodes a bounded raster deterministically without external resolution", () => {
  const result = canonicalAccountPhoto(uri(png()));
  expect(result.readUInt32BE(16)).toBe(192);
  expect(result.readUInt32BE(20)).toBe(192);
  expect(canonicalAccountPhoto(uri(result))).toEqual(result);
  const view = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><image width="192" height="192" href="${uri(result)}"/></svg>`,
    { font: { loadSystemFonts: false } },
  ).render();
  expect([...view.pixels.subarray(0, 4)]).toEqual([54, 94, 200, 255]);
});
it.each([191, 193])(
  "rejects decoded dimensions %s before native raster rendering",
  (size) => {
    const image = png(size === 191 ? size : 192, size === 191 ? 192 : size);
    expect(() => canonicalAccountPhoto(uri(image))).toThrow(
      /could not be processed/u,
    );
  },
);
it("rejects corruption, trailing content, oversized bytes and noncanonical base64", () => {
  const valid = png(),
    corrupt = Buffer.from(valid);
  corrupt[45] = (corrupt[45] ?? 0) ^ 1;
  for (const value of [
    uri(corrupt),
    uri(valid.subarray(0, -1)),
    uri(Buffer.concat([valid, Buffer.from("<script>")])),
    uri(Buffer.alloc(184321)),
    uri(valid) + "=",
    "data:image/png;base64,AAAA",
  ])
    expect(() => canonicalAccountPhoto(value)).toThrow(
      /could not be processed/u,
    );
});
it("strips ancillary metadata and rejects animation control before saving", () => {
  const valid = png();
  const insert = (extra: Buffer) =>
    Buffer.concat([valid.subarray(0, 33), extra, valid.subarray(33)]);
  const marked = insert(
    chunk("tEXt", Buffer.from("fixture\0private metadata must disappear")),
  );
  const result = canonicalAccountPhoto(uri(marked));
  expect(result.includes(Buffer.from("private metadata"))).toBe(false);
  expect(result).toEqual(canonicalAccountPhoto(uri(valid)));
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(1);
  expect(() =>
    canonicalAccountPhoto(uri(insert(chunk("acTL", animation)))),
  ).toThrow(/could not be processed/u);
});
it("rejects a small compressed image with excessive decoded data and invalid scanline filters", () => {
  const valid = png();
  const wrap = (decoded: Buffer) =>
    Buffer.concat([
      valid.subarray(0, 33),
      chunk("IDAT", deflateSync(decoded)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  const bomb = wrap(Buffer.alloc(2 * 1024 * 1024));
  expect(bomb.length).toBeLessThan(180 * 1024);
  expect(() => canonicalAccountPhoto(uri(bomb))).toThrow(
    /could not be processed/u,
  );
  const channels = valid[25] === 6 ? 4 : 3;
  const invalidFilter = Buffer.alloc(192 * (192 * channels + 1));
  invalidFilter[0] = 5;
  expect(() => canonicalAccountPhoto(uri(wrap(invalidFilter)))).toThrow(
    /could not be processed/u,
  );
});
