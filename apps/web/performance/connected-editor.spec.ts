import { expect, test, type Page } from "@playwright/test";

import { connectedPerformanceDocument } from "../src/features/editor/beta-performance-fixture.js";
import {
  TypedBackendApiHarness,
  TYPED_BACKEND_NOTES_PROJECT_ID,
  TYPED_BACKEND_ORGANIZATION_ID,
} from "../e2e/support/typed-backend-api-harness.js";

interface Probe {
  frames: number[];
  longTasks: number[];
  active: boolean;
  last: number;
}

async function observe(page: Page, label: string, action: () => Promise<void>) {
  await page.evaluate(() => {
    const probe = (window as unknown as { connectedEditorProbe: Probe })
      .connectedEditorProbe;
    probe.frames = [];
    probe.longTasks = [];
    probe.last = 0;
    probe.active = true;
  });
  const started = performance.now();
  await action();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      ),
  );
  const elapsedMs = performance.now() - started;
  const measurements = await page.evaluate(() => {
    const probe = (window as unknown as { connectedEditorProbe: Probe })
      .connectedEditorProbe;
    probe.active = false;
    const frames = [...probe.frames].sort((left, right) => left - right);
    return {
      frameSamples: frames.length,
      frameMedianMs: frames[Math.floor(frames.length / 2)] ?? null,
      frameP95Ms: frames[Math.floor(frames.length * 0.95)] ?? null,
      longTasks: probe.longTasks,
    };
  });
  return { label, elapsedMs, ...measurements };
}

for (const size of [
  { nodes: 100, edges: 200 },
  { nodes: 500, edges: 1_000 },
  { nodes: 1_000, edges: 2_000 },
]) {
  test(`observes connected production canvas ${String(size.nodes)}/${String(size.edges)}`, async ({
    context,
    page,
  }, testInfo) => {
    const api = new TypedBackendApiHarness();
    api.seedArchitecture(
      TYPED_BACKEND_NOTES_PROJECT_ID,
      connectedPerformanceDocument(size.nodes, size.edges),
    );
    await api.install(context);
    // Production attempts the same-origin refresh preflight. The synthetic API
    // supplies its own principal; no real cookie, token or identity is used.
    await context.route("**/api/auth/session/v1/restore", (route) =>
      route.fulfill({ status: 401 }),
    );
    await context.addInitScript(() => {
      localStorage.setItem(
        "cloudmarkup.workspace-tour.v1.principal_local_owner",
        "complete",
      );
      const probe = {
        frames: [] as number[],
        longTasks: [] as number[],
        active: false,
        last: 0,
      };
      Object.assign(window, { connectedEditorProbe: probe });
      new PerformanceObserver((entries) => {
        if (probe.active)
          probe.longTasks.push(
            ...entries.getEntries().map((entry) => entry.duration),
          );
      }).observe({ type: "longtask", buffered: true });
      const frame = (now: number) => {
        if (probe.active && probe.last > 0) probe.frames.push(now - probe.last);
        probe.last = probe.active ? now : 0;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const entryStarted = performance.now();
    await page.goto(
      `/organizations/${TYPED_BACKEND_ORGANIZATION_ID}/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/editor`,
    );
    await expect(page.locator(".react-flow__node")).toHaveCount(size.nodes);
    await expect(page.locator(".react-flow__edge")).toHaveCount(size.edges);
    const coldReadyMs = performance.now() - entryStarted;
    const coldResources = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
        .map((entry) => ({
          path: new URL(entry.name).pathname,
          bytes: (entry as PerformanceResourceTiming).encodedBodySize,
        })),
    );
    const walkthrough = page
      .locator(".guided-walkthrough")
      .getByRole("button", { name: "Dismiss", exact: true });
    if (await walkthrough.isVisible()) await walkthrough.click();
    // A tour can cover the synthetic canvas. Dismiss it through its ordinary control.
    const dismiss = page.getByRole("button", {
      name: /Skip tour|Dismiss tour|Skip walkthrough/i,
    });
    if (await dismiss.count()) await dismiss.first().click();
    const editor = page.locator(".architecture-editor");
    const contentBefore = await editor.getAttribute("data-content-hash");
    const visualBefore = await editor.getAttribute("data-visual-hash");
    const idsBefore = await page
      .locator(".react-flow__node")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-id")),
      );
    const pane = page.locator(".react-flow__pane");
    // Hit-test actual blank pane; a fixed coordinate can accidentally drag a node.
    const blank = await pane.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      for (let y = bounds.top + 120; y < bounds.bottom - 100; y += 28)
        for (let x = bounds.left + 300; x < bounds.right - 300; x += 28)
          if (document.elementFromPoint(x, y) === element) return { x, y };
      throw new Error("No unoccluded blank canvas point in the fixed profile.");
    });
    const phases = [];
    phases.push(
      await observe(page, "pan-zoom", async () => {
        await page.mouse.move(blank.x, blank.y);
        await page.mouse.down();
        for (let step = 0; step < 30; step += 1)
          await page.mouse.move(blank.x + step * 3, blank.y + step, {
            steps: 2,
          });
        await page.mouse.up();
        await page.mouse.wheel(0, -160);
      }),
    );
    await expect(editor).toHaveAttribute(
      "data-content-hash",
      contentBefore ?? "",
    );
    await expect(editor).toHaveAttribute(
      "data-visual-hash",
      visualBefore ?? "",
    );
    expect(api.latestDraftSave(TYPED_BACKEND_NOTES_PROJECT_ID)).toBeUndefined();
    const visibleId = await page
      .locator(".react-flow__node")
      .evaluateAll((nodes) => {
        for (const node of nodes) {
          const box = node.getBoundingClientRect();
          const x = box.x + box.width / 2,
            y = box.y + box.height / 2;
          if (
            x > 300 &&
            x < innerWidth - 300 &&
            y > 150 &&
            y < innerHeight - 150 &&
            document.elementFromPoint(x, y)?.closest(".react-flow__node") ===
              node
          )
            return node.getAttribute("data-id");
        }
        throw new Error("Expected a visible, unoccluded synthetic node.");
      });
    const node = page.locator(
      `.react-flow__node[data-id="${visibleId ?? ""}"]`,
    );
    phases.push(
      await observe(page, "selection", async () => {
        await node.click();
      }),
    );
    for (const label of ["Configure", "Issues", "Assistant"]) {
      phases.push(
        await observe(page, `panel-${label}`, async () => {
          await page
            .getByRole("button", {
              name: label === "Issues" ? /^Issues/u : label,
              exact: label !== "Issues",
            })
            .first()
            .click();
        }),
      );
    }
    await expect(editor).toHaveAttribute(
      "data-content-hash",
      contentBefore ?? "",
    );
    await expect(editor).toHaveAttribute(
      "data-visual-hash",
      visualBefore ?? "",
    );
    // Close overlays through their launch controls before a genuine committed drag.
    await page
      .getByRole("button", { name: "Assistant", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Configure", exact: true })
      .first()
      .click();
    const nodeBox = await node.boundingBox();
    if (nodeBox === null) throw new Error("Expected a visible drag anchor.");
    phases.push(
      await observe(page, "drag-preview", async () => {
        const x = nodeBox.x + nodeBox.width / 2;
        const y = nodeBox.y + nodeBox.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 48, y + 32, { steps: 15 });
      }),
    );
    await expect(editor).toHaveAttribute(
      "data-content-hash",
      contentBefore ?? "",
    );
    await expect(editor).toHaveAttribute(
      "data-visual-hash",
      visualBefore ?? "",
    );
    expect(api.latestDraftSave(TYPED_BACKEND_NOTES_PROJECT_ID)).toBeUndefined();
    phases.push(
      await observe(page, "commit-save", async () => {
        await page.mouse.up();
        await expect
          .poll(() => api.latestDraftSave(TYPED_BACKEND_NOTES_PROJECT_ID))
          .toBeDefined();
      }),
    );
    expect(
      api.requestCount(
        "PUT",
        `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/draft`,
      ),
    ).toBe(1);
    const observations = await page.evaluate(() => {
      return {
        resources: performance.getEntriesByType("resource").map((entry) => {
          const resource = entry as PerformanceResourceTiming;
          return {
            path: new URL(resource.name).pathname,
            bytes: resource.encodedBodySize,
            duration: resource.duration,
          };
        }),
        browser: navigator.userAgent,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      };
    });
    expect(
      await page
        .locator(".react-flow__node")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-id")),
        ),
    ).toEqual(idsBefore);
    expect(observations.reducedMotion).toBe(true);
    await testInfo.attach("connected-observation", {
      body: JSON.stringify(
        {
          size,
          coldReadyMs,
          coldResources,
          phases,
          observations,
          requests: api.requests.map(({ method, path }) => ({ method, path })),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    console.info(
      "Connected production observation",
      JSON.stringify({
        size,
        coldReadyMs,
        coldResources,
        phases,
        ...observations,
        resources: observations.resources.filter((entry) =>
          entry.path.endsWith(".js"),
        ),
      }),
    );
  });
}
