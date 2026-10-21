import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function isNativeCompilerHeader(bytes, platform) {
  return platform === "win32"
    ? bytes.subarray(0, 2).equals(Buffer.from("MZ"))
    : platform === "linux" &&
        bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]));
}

export function assertCompilerProbeResult(result) {
  if (
    result.error ||
    result.signal ||
    result.status !== 0 ||
    result.stderr !== ""
  )
    throw new Error(
      "Test compiler did not execute the HCL probe successfully.",
    );
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new Error("Test compiler returned invalid HCL probe JSON.");
  }
  const block = value?.blocks?.[0];
  if (
    value?.contractVersion !== 1 ||
    value?.parser?.id !== "cloudmarkup.terraform-hcl-inspector" ||
    value?.parser?.version !== "1.0.0" ||
    value?.succeeded !== true ||
    !Array.isArray(value.diagnostics) ||
    value.diagnostics.length !== 0 ||
    !Array.isArray(value.blocks) ||
    value.blocks.length !== 1 ||
    block?.type !== "resource" ||
    JSON.stringify(block.labels) !==
      JSON.stringify(["aws_vpc", "verification"]) ||
    block.attributes?.length !== 1 ||
    block.attributes[0].name !== "cidr_block" ||
    block.attributes[0].expressionDigest !==
      "sha256:bb550a8a72fa9f675164b7815febb65e5c72291fbc43dd458afd6392242553cd"
  )
    throw new Error("Test compiler returned an unexpected HCL probe result.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const executable = process.argv[2];
  if (process.argv.length !== 3 || !executable || !isAbsolute(executable))
    throw new Error("An absolute test compiler path is required.");
  const stat = lstatSync(executable);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 64 * 1024 * 1024 ||
    !isNativeCompilerHeader(readFileSync(executable), process.platform)
  )
    throw new Error(
      "Test compiler is not a native executable; Go library archives are not admitted.",
    );
  assertCompilerProbeResult(
    spawnSync(
      executable,
      [
        "inspect-terraform-hcl",
        "--input",
        "-",
        "--output",
        "-",
        "--max-input-bytes",
        "1024",
        "--max-output-bytes",
        "65536",
      ],
      {
        input:
          'resource "aws_vpc" "verification" { cidr_block = "10.0.0.0/16" }\n',
        encoding: "utf8",
        env: {},
        shell: false,
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 65536,
      },
    ),
  );
  console.log("Test compiler native format and actual HCL execution verified.");
}
