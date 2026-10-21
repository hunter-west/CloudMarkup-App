import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { applicationLambdaArtifactManifestV1Schema } from "./contracts.js";
import {
  applicationHostRepairSeedManifestV1Schema,
  generateApplicationHostRepairSeedManifestV1JsonSchema,
} from "./host-repair-seed-manifest.js";
import { canonicalJson, sha256Digest } from "./security.js";

function fixture() {
  const pin = sha256Digest(
    "synthetic manifest metadata, no executable archive",
  );
  const body = {
    kind: "cloudmarkup.host-repair-seed-artifact-manifest",
    contractVersion: 1,
    origin: "fixed-host-synthetic",
    authority: "host-validation-only",
    bindings: {
      requestDigest: pin,
      recipeDigest: pin,
      solutionRevisionDigest: pin,
      generationArtifactDigest: pin,
      originalBuildContractDigest: pin,
      baselineSourceDigest: pin,
      sourceTreeDigest: pin,
      extensionContentDigest: pin,
      dependencyLockDigest: pin,
      policyDigest: pin,
      imageDigest: pin,
      helperDigest: pin,
    },
    runtime: {
      id: "cloudmarkup.application-runtime.nodejs24",
      version: "1.0.0",
      digest: pin,
      runtimeFamily: "aws.lambda.runtime-family.nodejs24",
      languageFamily: "cloudmarkup.language.typescript",
      runtime: "nodejs24.x",
      handler: "index.handler",
      moduleFormat: "esm",
    },
    archive: { checksum: pin, sizeBytes: 1, entrypoint: "index.js" },
    files: [{ path: "index.js", checksum: pin, sizeBytes: 1 }],
  };
  return { ...body, manifestDigest: sha256Digest(canonicalJson(body)) };
}
function rehash(raw: ReturnType<typeof fixture>) {
  const { manifestDigest, ...body } = raw;
  expect(manifestDigest).toMatch(/^sha256:/u);
  return { ...body, manifestDigest: sha256Digest(canonicalJson(body)) };
}

describe("separate host manifest compatibility", () => {
  it("parses its own strict discriminator and never the normal artifact shape", () => {
    const value = fixture();
    expect(applicationHostRepairSeedManifestV1Schema.parse(value)).toEqual(
      value,
    );
    expect(
      applicationLambdaArtifactManifestV1Schema.safeParse(value).success,
    ).toBe(false);
    const normal = z.toJSONSchema(applicationLambdaArtifactManifestV1Schema, {
      io: "input",
      target: "draft-2020-12",
    });
    expect(JSON.stringify(normal)).not.toContain("host-validation-only");
  });

  it("admits safe scoped runtime package paths inside the ZIP", () => {
    const value = fixture();
    const file = value.files[0];
    if (file === undefined) throw Error("Missing fixture entrypoint.");
    value.files.push({
      ...file,
      path: "node_modules/@aws-sdk/client-dynamodb/package.json",
    });
    expect(
      applicationHostRepairSeedManifestV1Schema.parse(rehash(value)).files,
    ).toHaveLength(2);
  });

  it.each(["root", "bindings", "archive", "runtime", "file"])(
    "denies extra authority in %s",
    (scope) => {
      const raw = fixture();
      const value =
        scope === "root"
          ? { ...raw, promote: true }
          : scope === "bindings"
            ? { ...raw, bindings: { ...raw.bindings, operatorApproved: true } }
            : scope === "archive"
              ? { ...raw, archive: { ...raw.archive, deploy: true } }
              : scope === "runtime"
                ? {
                    ...raw,
                    runtime: { ...raw.runtime, credentials: "invented" },
                  }
                : {
                    ...raw,
                    files: raw.files.map((file) => ({
                      ...file,
                      content: "unretained",
                    })),
                  };
      const { manifestDigest, ...body } = value;
      expect(manifestDigest).toMatch(/^sha256:/u);
      expect(
        applicationHostRepairSeedManifestV1Schema.safeParse({
          ...body,
          manifestDigest: sha256Digest(canonicalJson(body)),
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    "duplicate",
    "portable-alias",
    "unsorted",
    "missing-entry",
    "parent-path",
    "absolute",
    "empty",
    "invalid-digest",
  ])("denies coherently rehashed %s", (kind) => {
    const value = fixture();
    const file = value.files[0];
    if (file === undefined) throw Error("Missing metadata fixture.");
    if (kind === "duplicate") value.files.push({ ...file });
    if (kind === "portable-alias")
      value.files.push({ ...file, path: "INDEX.js" });
    if (kind === "unsorted") value.files.push({ ...file, path: "a.js" });
    if (kind === "missing-entry") value.files = [{ ...file, path: "other.js" }];
    if (kind === "parent-path")
      value.files.push({ ...file, path: "../other.js" });
    if (kind === "absolute") value.files.push({ ...file, path: "/other.js" });
    if (kind === "empty") value.files.push({ ...file, path: "" });
    if (kind === "invalid-digest")
      value.files.push({
        ...file,
        path: "other.js",
        checksum: "wrong" as typeof file.checksum,
      });
    expect(
      applicationHostRepairSeedManifestV1Schema.safeParse(rehash(value))
        .success,
    ).toBe(false);
  });

  it("rejects an unchanged digest after metadata substitution", () => {
    const value = fixture();
    expect(
      applicationHostRepairSeedManifestV1Schema.safeParse({
        ...value,
        archive: { ...value.archive, sizeBytes: 2 },
      }).success,
    ).toBe(false);
  });

  it("registers the manifest and preserves the host schema before recipe 1.1", () => {
    const generated = `${JSON.stringify(generateApplicationHostRepairSeedManifestV1JsonSchema())}\n`;
    expect(
      readFileSync(
        new URL(
          "../json-schema/application-host-repair-seed-manifest-v1.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toBe(generated);
    const currentHost = readFileSync(
      new URL(
        "../json-schema/application-host-repair-seed-v1.schema.json",
        import.meta.url,
      ),
    );
    // Removing the sole additive recipe option must reconstruct every historical byte.
    const legacy: unknown = JSON.parse(currentHost.toString("utf8"));
    let replacements = 0;
    const restoreLegacyRecipe = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(restoreLegacyRecipe);
        return;
      }
      const object = value as Record<string, unknown>;
      if (
        object["type"] === "string" &&
        JSON.stringify(object["enum"]) === '["1.0.0","1.1.0"]'
      ) {
        delete object["enum"];
        object["const"] = "1.0.0";
        replacements += 1;
      }
      Object.values(object).forEach(restoreLegacyRecipe);
    };
    restoreLegacyRecipe(legacy);
    expect(replacements).toBe(1);
    const old = Buffer.from(JSON.stringify(legacy, null, 2) + "\n");
    expect(old.byteLength).toBe(217057);
    expect(sha256Digest(old)).toBe(
      "sha256:a14495a150370314d81607e315ad610e59ec5df0e2b5cfce8393b746b6410ba2",
    );
    const manifest: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(manifest).toMatchObject({
      exports: {
        ".": { types: "./src/index.ts", import: "./dist/index.js" },
        "./schema/host-repair-seed-v1":
          "./json-schema/application-host-repair-seed-v1.schema.json",
        "./schema/host-repair-seed-manifest-v1":
          "./json-schema/application-host-repair-seed-manifest-v1.schema.json",
      },
    });
    expect(
      readFileSync(new URL("./index.ts", import.meta.url), "utf8"),
    ).not.toContain("host-repair-seed");
  });
});
