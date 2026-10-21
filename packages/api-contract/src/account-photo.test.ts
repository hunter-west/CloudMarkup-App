import { expect, it } from "vitest";
import {
  accountPhotoV1Schema,
  updateAccountPhotoV1Schema,
  MAX_ACCOUNT_PHOTO_BYTES_V1,
} from "./account-photo.js";
import { MAX_JSON_REQUEST_BYTES } from "./common.js";
it("keeps a strict private raster/photo contract separate from profile identity", () => {
  expect(
    updateAccountPhotoV1Schema.parse({ contractVersion: 1, image: null }),
  ).toEqual({ contractVersion: 1, image: null });
  for (const extra of [
    "principalId",
    "organizationId",
    "role",
    "url",
    "version",
  ])
    expect(
      updateAccountPhotoV1Schema.safeParse({
        contractVersion: 1,
        image: null,
        [extra]: "foreign",
      }).success,
    ).toBe(false);
  for (const image of [
    "https://private.test/photo",
    "data:image/svg+xml;base64,AAAA",
    "data:image/png;base64," + "A".repeat(300000),
  ])
    expect(
      updateAccountPhotoV1Schema.safeParse({ contractVersion: 1, image })
        .success,
    ).toBe(false);
  expect(
    accountPhotoV1Schema.safeParse({
      contractVersion: 1,
      principalId: "principal_photo",
      version: 0,
      image: null,
    }).success,
  ).toBe(true);
  expect(4 * Math.ceil(MAX_ACCOUNT_PHOTO_BYTES_V1 / 3) + 100).toBeLessThan(
    MAX_JSON_REQUEST_BYTES,
  );
});
