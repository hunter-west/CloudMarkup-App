import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCompilerProbeResult,
  isNativeCompilerHeader,
} from "./verify-test-compiler.mjs";

function result() {
  return {
    status: 0,
    signal: null,
    stderr: "",
    stdout: JSON.stringify({
      contractVersion: 1,
      parser: { id: "cloudmarkup.terraform-hcl-inspector", version: "1.0.0" },
      succeeded: true,
      diagnostics: [],
      blocks: [
        {
          type: "resource",
          labels: ["aws_vpc", "verification"],
          attributes: [
            {
              name: "cidr_block",
              expressionDigest:
                "sha256:bb550a8a72fa9f675164b7815febb65e5c72291fbc43dd458afd6392242553cd",
            },
          ],
        },
      ],
    }),
  };
}
test("native header admission rejects the Go library archive and wrong host format", () => {
  const elf = Buffer.from([127, 69, 76, 70]);
  const pe = Buffer.from("MZ");
  assert.equal(isNativeCompilerHeader(elf, "linux"), true);
  assert.equal(isNativeCompilerHeader(pe, "win32"), true);
  for (const platform of ["linux", "win32"]) {
    assert.equal(
      isNativeCompilerHeader(Buffer.from("!<arch>\n"), platform),
      false,
    );
    assert.equal(
      isNativeCompilerHeader(Buffer.from("#!/bin/sh\n"), platform),
      false,
    );
    assert.equal(isNativeCompilerHeader(Buffer.alloc(0), platform), false);
  }
  assert.equal(isNativeCompilerHeader(pe, "linux"), false);
  assert.equal(isNativeCompilerHeader(elf, "win32"), false);
});
test("probe admits only successful actual-parser output", () => {
  assert.doesNotThrow(() => assertCompilerProbeResult(result()));
  for (const change of [
    { status: 2 },
    { signal: "SIGKILL" },
    { error: new Error("synthetic") },
    { stderr: "diagnostic" },
    { stdout: "" },
    { stdout: "{}" },
    { stdout: "null" },
  ])
    assert.throws(() => assertCompilerProbeResult({ ...result(), ...change }));
});
test("probe requires the exact parser, resource, attribute and clean diagnostics", () => {
  for (const mutate of [
    (v) => (v.contractVersion = 2),
    (v) => (v.parser.id = "different"),
    (v) => (v.parser.version = "2.0.0"),
    (v) => (v.succeeded = false),
    (v) => (v.diagnostics = [{}]),
    (v) => (v.blocks = []),
    (v) => (v.blocks[0].labels = ["aws_vpc", "other"]),
    (v) =>
      (v.blocks[0].attributes[0].expressionDigest = "sha256:" + "0".repeat(64)),
  ]) {
    const r = result(),
      value = JSON.parse(r.stdout);
    mutate(value);
    assert.throws(() =>
      assertCompilerProbeResult({ ...r, stdout: JSON.stringify(value) }),
    );
  }
});
