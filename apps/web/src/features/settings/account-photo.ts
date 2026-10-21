import {
  ACCOUNT_PHOTO_EDGE_V1 as edge,
  accountPhotoDataV1Schema,
} from "@cloudmarkup/api-contract";

function rasterDimensions(
  bytes: Uint8Array,
  type: string,
): readonly [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png" && bytes.length >= 24)
    return [view.getUint32(16), view.getUint32(20)];
  if (type === "image/jpeg") {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 8
      )
        return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  if (type === "image/webp" && bytes.length >= 30) {
    const format = String.fromCharCode(...bytes.slice(12, 16));
    if (format === "VP8X")
      return [
        1 + (view.getUint32(24, true) & 0xffffff),
        1 + (view.getUint32(26, true) >>> 8),
      ];
    if (
      format === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 1 &&
      bytes[25] === 0x2a
    )
      return [
        view.getUint16(26, true) & 0x3fff,
        view.getUint16(28, true) & 0x3fff,
      ];
    if (format === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
    }
  }
  throw Error("This image has an invalid or unsupported header.");
}

function validateDimensions(width: number, height: number): void {
  if (
    width < 32 ||
    height < 32 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 24000000
  )
    throw Error(
      "Use an image between 32 and 8192 pixels, up to 24 megapixels.",
    );
}

export function accountInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  return (
    words.length > 1
      ? `${Array.from(words[0] ?? "")[0] ?? ""}${Array.from(words.at(-1) ?? "")[0] ?? ""}`
      : Array.from(words[0] ?? "?")
          .slice(0, 2)
          .join("")
  ).toLocaleUpperCase();
}

/** Only raster signatures accepted. Re-encoding strips metadata and active content. */
export async function prepareAccountPhoto(file: File): Promise<string> {
  if (file.size === 0 || file.size > 5 * 1024 * 1024)
    throw Error("Choose an image smaller than 5 MB.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("Choose a JPEG, PNG or WebP image.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
    (byte, i) => bytes[i] === byte,
  );
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(
    (file.type === "image/jpeg" && jpeg) ||
    (file.type === "image/png" && png) ||
    (file.type === "image/webp" && webp)
  ))
    throw Error("This file is not a supported image.");
  // Reject excessive encoded dimensions before allocating a browser decoder.
  const [encodedWidth, encodedHeight] = rasterDimensions(bytes, file.type);
  validateDimensions(encodedWidth, encodedHeight);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    validateDimensions(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext("2d");
    if (context === null)
      throw Error("Photo processing is unavailable in this browser.");
    context.fillStyle = "#eef0f3";
    context.fillRect(0, 0, edge, edge);
    const cropEdge = Math.min(width, height);
    context.drawImage(
      image,
      (width - cropEdge) / 2,
      (height - cropEdge) / 2,
      cropEdge,
      cropEdge,
      0,
      0,
      edge,
      edge,
    );
    const output = canvas.toDataURL("image/png");
    if (!accountPhotoDataV1Schema.safeParse(output).success)
      throw Error("This image could not be prepared. Choose another image.");
    return output;
  } finally {
    URL.revokeObjectURL(url);
  }
}
