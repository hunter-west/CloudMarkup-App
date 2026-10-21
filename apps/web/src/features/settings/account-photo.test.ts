import { describe, expect, it, vi } from "vitest";
import { accountInitials, prepareAccountPhoto } from "./account-photo.js";

function file(bytes: number[], type: string): File {
  const value = new File([new Uint8Array(bytes)], "synthetic", { type });
  Object.defineProperty(value, "arrayBuffer", {
    value: () => Promise.resolve(new Uint8Array(bytes).buffer),
  });
  return value;
}
function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return file(Array.from(bytes), "image/png");
}
describe("profile preview input boundary", () => {
  it("derives account initials from the user's name, including Unicode", () => {
    expect(accountInitials("  Morgan   Example ")).toBe("ME");
    expect(accountInitials("Émile")).toBe("ÉM");
    expect(accountInitials("李 雷")).toBe("李雷");
    expect(accountInitials(" ")).toBe("?");
  });
  it("rejects active formats and disguised SVG bytes", async () => {
    await expect(
      prepareAccountPhoto(file([60, 115, 118, 103], "image/svg+xml")),
    ).rejects.toThrow("JPEG, PNG or WebP");
    await expect(
      prepareAccountPhoto(file([60, 115, 118, 103], "image/png")),
    ).rejects.toThrow("not a supported image");
  });
  it("rejects empty and oversized files", async () => {
    await expect(prepareAccountPhoto(file([], "image/png"))).rejects.toThrow(
      "5 MB",
    );
    const huge = file([0], "image/png");
    Object.defineProperty(huge, "size", { value: 5 * 1024 * 1024 + 1 });
    await expect(prepareAccountPhoto(huge)).rejects.toThrow("5 MB");
  });
  it.each([
    [1, 64],
    [64, 1],
    [8193, 64],
    [64, 8193],
    [6000, 5000],
  ])(
    "rejects unsafe dimensions %i by %i before decoding",
    async (width, height) => {
      const decode = vi.spyOn(document, "createElement");
      await expect(prepareAccountPhoto(png(width, height))).rejects.toThrow(
        "24 megapixels",
      );
      expect(decode).not.toHaveBeenCalled();
      decode.mockRestore();
    },
  );
  it("rejects truncated JPEG and WebP headers", async () => {
    await expect(
      prepareAccountPhoto(file([255, 216, 255], "image/jpeg")),
    ).rejects.toThrow("header");
    await expect(
      prepareAccountPhoto(
        file([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80], "image/webp"),
      ),
    ).rejects.toThrow("header");
  });
});
