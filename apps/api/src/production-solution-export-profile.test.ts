import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, basename, join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSfntResvgDiagramRasterizer,
  DIAGRAM_SFNT_FONT,
  diagramRendererSfntV1Pin,
} from "@cloudmarkup/diagram-export";
import { createSolutionExportDiagramRendererPort } from "@cloudmarkup/solution-export-workflow";
import { awsCatalogArtifactV1 } from "@cloudmarkup/provider-aws/catalog";
import { collectProductionSolutionExportAssets } from "./production-solution-export-assets.js";
import {
  createProductionSolutionExportTargetSettings,
  loadProductionSolutionExportProfile,
} from "./production-solution-export-profile.js";

const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const path = resolve(directory);
    if (
      !path.startsWith(resolve(tmpdir()) + sep) ||
      !path.includes("cloudmarkup-export-profile-test-")
    )
      throw new Error("Unexpected test cleanup path.");
    await rm(path, { recursive: true, force: true });
  }
});
async function fixture() {
  const directory = await mkdtemp(
    join(tmpdir(), "cloudmarkup-export-profile-test-"),
  );
  directories.push(directory);
  const assets = collectProductionSolutionExportAssets();
  // Only verifies immutable byte admission; native execution has its own real
  // compiler integration gate and is never claimed by this small unit fixture.
  const compilerBytes = Buffer.from("unit-only-compiler-byte-admission");
  const compiler = {
    executablePath: join(directory, "compiler"),
    executableSha256: hash(compilerBytes),
  };
  const iconBundlePath = join(directory, "diagram-icons.json");
  await writeFile(compiler.executablePath, compilerBytes);
  await writeFile(iconBundlePath, assets.iconBundle.bytes);
  await mkdir(join(directory, "fonts"));
  for (const font of assets.runtimeFiles.filter(({ path }) =>
    path.startsWith("cloudmarkup-export/fonts/"),
  ))
    await writeFile(join(directory, "fonts", basename(font.path)), font.bytes);
  const targetSettings = createProductionSolutionExportTargetSettings({
    compilerExecutableSha256: compiler.executableSha256,
    iconBundleSha256: assets.iconBundle.sha256,
  });
  return {
    assets,
    targetSettings,
    config: {
      compiler,
      iconBundlePath,
      iconBundleSha256: assets.iconBundle.sha256,
      targetSettingsDigest: targetSettings.digest,
    },
  };
}

describe("restricted production CloudFormation profile", () => {
  it("admits current catalog icons and actual pinned ARM64/native/font assets deterministically", () => {
    const first = collectProductionSolutionExportAssets();
    const metadata = (
      assets: ReturnType<typeof collectProductionSolutionExportAssets>,
    ) =>
      [assets.iconBundle, ...assets.runtimeFiles].map(
        ({ path, sha256, bytes }) => ({
          path,
          sha256,
          sizeBytes: bytes.byteLength,
        }),
      );
    expect(metadata(collectProductionSolutionExportAssets())).toEqual(
      metadata(first),
    );
    expect(first.runtimeFiles).toHaveLength(12);
    const native = first.runtimeFiles.find(({ path }) =>
      path.endsWith(".node"),
    );
    expect(native?.path).toBe(
      "nodejs/node_modules/@resvg/resvg-js-linux-arm64-gnu/resvgjs.linux-arm64-gnu.node",
    );
    expect(Buffer.from(native?.bytes ?? []).readUInt16LE(18)).toBe(183);
    for (const file of [first.iconBundle, ...first.runtimeFiles])
      expect(hash(file.bytes)).toBe(file.sha256);
  });
  it("uses exact bytes/settings/current catalog and explicitly denies application stages", async () => {
    const input = await fixture();
    const admitted = await loadProductionSolutionExportProfile(input.config);
    expect(admitted.targetSettings).toEqual(input.targetSettings);
    expect(admitted.targetSettings.target).toBe("cloudformation");
    expect(admitted.targetSettings.limits.maxArchiveBytes).toBe(
      4 * 1024 * 1024,
    );
    expect(
      admitted.targetSettings.stageDescriptors.compiler.adapter.digest,
    ).toBe(
      "sha256:2c25a5610c825d171a167a38201c3090aa2278071ddd648bb957e67b7b98f203",
    );
    expect(
      admitted.targetSettings.stageDescriptors.applicationGenerator.adapter.id,
    ).toBe("cloudmarkup.export.unavailable-stage");
    expect(
      admitted.targetSettings.stageDescriptors.applicationBuild.adapter.id,
    ).toBe("cloudmarkup.export.unavailable-stage");
    expect(admitted.diagram.catalog.digest).toBe(awsCatalogArtifactV1.digest);
    expect(admitted.diagram.iconSet.icons.length).toBeGreaterThan(0);
    expect(
      "terraformValidation" in admitted.targetSettings.stageDescriptors,
    ).toBe(false);
  });
  it("renders actual visible text with both derived pinned fonts and admits only the explicit successor service", async () => {
    const input = await fixture();
    const admitted = await loadProductionSolutionExportProfile(input.config);
    expect(admitted.diagram.renderer).toEqual(diagramRendererSfntV1Pin);
    expect(
      admitted.targetSettings.stageDescriptors.diagramRenderer.adapter,
    ).toEqual(diagramRendererSfntV1Pin);
    const rasterizer = createSfntResvgDiagramRasterizer([
      join(
        dirname(input.config.iconBundlePath),
        "fonts",
        "inter-latin-400-normal.ttf",
      ),
      join(
        dirname(input.config.iconBundlePath),
        "fonts",
        "inter-latin-600-normal.ttf",
      ),
    ]);
    const base =
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="96"><rect width="320" height="96" fill="white"/>';
    const text =
      '<text x="16" y="38" font-family="Inter" font-size="24" font-weight="600">Beta export</text><text x="16" y="70" font-family="Inter" font-size="16" font-weight="400">CloudFormation diagram</text>';
    const blank = rasterizer.rasterize({
      svg: base + "</svg>",
      width: 320,
      height: 96,
    });
    const first = rasterizer.rasterize({
      svg: base + text + "</svg>",
      width: 320,
      height: 96,
    });
    expect(hash(first)).not.toBe(hash(blank));
    expect(
      hash(
        rasterizer.rasterize({
          svg: base + text + "</svg>",
          width: 320,
          height: 96,
        }),
      ),
    ).toBe(hash(first));
    expect(DIAGRAM_SFNT_FONT.regularDigest).not.toBe(
      DIAGRAM_SFNT_FONT.semiboldDigest,
    );
    const { service, ...withoutService } = admitted.diagram;
    expect(service).toBeDefined();
    expect(() =>
      createSolutionExportDiagramRendererPort(withoutService),
    ).toThrow(/explicitly admitted service/u);
  });
  it.each(["regular", "semibold"] as const)(
    "rejects altered %s derived font bytes before returning a service",
    async (weight) => {
      const { config } = await fixture();
      await writeFile(
        join(
          dirname(config.iconBundlePath),
          "fonts",
          weight === "regular"
            ? "inter-latin-400-normal.ttf"
            : "inter-latin-600-normal.ttf",
        ),
        "changed font bytes",
      );
      await expect(loadProductionSolutionExportProfile(config)).rejects.toThrow(
        /match/u,
      );
    },
  );
  it.each(["settings", "compiler", "icons"] as const)(
    "rejects changed %s pins or bytes before returning authority",
    async (kind) => {
      const { config } = await fixture();
      if (kind === "settings")
        config.targetSettingsDigest = ("sha256:" +
          "0".repeat(64)) as typeof config.targetSettingsDigest;
      else
        await writeFile(
          kind === "compiler"
            ? config.compiler.executablePath
            : config.iconBundlePath,
          "changed bytes",
        );
      await expect(loadProductionSolutionExportProfile(config)).rejects.toThrow(
        /match/u,
      );
    },
  );
  it("rejects catalog/icon authority drift even when an operator recomputes the outer file pin", async () => {
    const { config, assets } = await fixture();
    const bundle = JSON.parse(
      Buffer.from(assets.iconBundle.bytes).toString("utf8"),
    ) as { catalogDigest: string };
    bundle.catalogDigest = "sha256:" + "0".repeat(64);
    const bytes = Buffer.from(JSON.stringify(bundle));
    await writeFile(config.iconBundlePath, bytes);
    config.iconBundleSha256 = hash(bytes);
    config.targetSettingsDigest = createProductionSolutionExportTargetSettings({
      compilerExecutableSha256: config.compiler.executableSha256,
      iconBundleSha256: config.iconBundleSha256,
    }).digest;
    await expect(loadProductionSolutionExportProfile(config)).rejects.toThrow();
  });
  it("commits compiler and icon bytes into different admitted target settings", () => {
    const assets = {
      compilerExecutableSha256: "a".repeat(64),
      iconBundleSha256: "b".repeat(64),
    };
    const initial = createProductionSolutionExportTargetSettings(assets);
    expect(
      createProductionSolutionExportTargetSettings({
        ...assets,
        compilerExecutableSha256: "c".repeat(64),
      }).digest,
    ).not.toBe(initial.digest);
    expect(
      createProductionSolutionExportTargetSettings({
        ...assets,
        iconBundleSha256: "c".repeat(64),
      }).digest,
    ).not.toBe(initial.digest);
    expect(() =>
      createProductionSolutionExportTargetSettings({
        ...assets,
        iconBundleSha256: "not-a-digest",
      }),
    ).toThrow();
  });
});
