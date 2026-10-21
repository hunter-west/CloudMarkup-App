import { expect, test } from "@playwright/test";

test("serves the beta web application and same-origin API health", async ({
  page,
  request,
}) => {
  const application = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(application?.status()).toBe(200);
  expect(application?.headers()["content-type"]).toMatch(/^text\/html\b/iu);
  const applicationHtml = await application?.text();
  for (const publicPath of [
    "/favicon.ico",
    "/app-icon-192.png",
    "/apple-touch-icon.png",
    "/site.webmanifest",
  ]) {
    expect(applicationHtml).toContain(`href="${publicPath}"`);
  }
  await expect(page.locator("#root")).not.toBeEmpty();

  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const publicPath of [
    "/cloudmarkup-logo.png",
    "/app-icon-192.png",
    "/app-icon-512.png",
    "/apple-touch-icon.png",
  ]) {
    const image = await request.get(publicPath);
    expect(image.status(), publicPath).toBe(200);
    expect(image.headers()["content-type"], publicPath).toMatch(
      /^image\/png(?:;|$)/iu,
    );
    expect((await image.body()).subarray(0, 8), publicPath).toEqual(
      pngSignature,
    );
  }

  const favicon = await request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toMatch(
    /^image\/(?:x-icon|vnd\.microsoft\.icon)(?:;|$)/iu,
  );
  expect((await favicon.body()).subarray(0, 4)).toEqual(
    Buffer.from([0, 0, 1, 0]),
  );

  const manifest = await request.get("/site.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toMatch(
    /^application\/(?:manifest\+json|json)(?:;|$)/iu,
  );
  expect(await manifest.json()).toMatchObject({
    name: "Cloud Markup",
    icons: [
      {
        sizes: "192x192",
        src: "/app-icon-192.png",
        type: "image/png",
      },
      {
        sizes: "512x512",
        src: "/app-icon-512.png",
        type: "image/png",
      },
    ],
  });

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({
    contractVersion: 1,
    service: "cloudmarkup-api",
    status: "ok",
  });

  const readiness = await request.get("/api/ready");
  expect(readiness.status()).toBe(200);
  expect(await readiness.json()).toMatchObject({
    contractVersion: 1,
    service: "cloudmarkup-api",
    status: "ready",
  });
});
