import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSemanticVersions,
  isSemanticVersion,
} from "./semantic-version.mjs";
import {
  calculateAssetSetDigest,
  validateProviderIconManifest,
} from "./manifest-contract.mjs";
import { createPlaceholderManifest } from "./test-helpers.mjs";

test("orders semantic versions without numeric precision loss", () => {
  assert.equal(
    compareSemanticVersions("9007199254740992.1.0", "9007199254740993.0.0"),
    -1,
  );
  assert.equal(
    compareSemanticVersions(
      `1.0.0-${"9".repeat(400)}`,
      `1.0.0-${"1".repeat(401)}`,
    ),
    -1,
  );
  assert.equal(compareSemanticVersions("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compareSemanticVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareSemanticVersions("1.0.0+first", "1.0.0+second"), 0);
});

test("rejects non-semantic and ambiguous prerelease identifiers", () => {
  for (const version of [
    "1.0.0-01",
    "1.0.0-alpha..1",
    "1.0.0-",
    "1.0.0+",
    "01.0.0",
    "1.0",
  ]) {
    assert.equal(isSemanticVersion(version), false, version);
    assert.throws(
      () => compareSemanticVersions(version, "1.0.0"),
      /requires valid versions/u,
    );
  }
});

test("the manifest contract uses the same strict semantic-version rules", () => {
  const invalidManifest = structuredClone(createPlaceholderManifest());
  invalidManifest.assetSet.version = "1.0.0-01";
  invalidManifest.assetSet.digest = calculateAssetSetDigest(invalidManifest);

  assert.throws(
    () => validateProviderIconManifest(invalidManifest),
    /assetSet\.version must be semantic/u,
  );
});
