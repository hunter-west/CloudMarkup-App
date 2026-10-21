import { describe, expect, it } from "vitest";
import {
  applicationBuildSourceFileV1Schema,
  type ApplicationBuildCommandResult,
} from "./contracts.js";
import { HOST_REPAIR_SEED_EXTENSION_PATH } from "./host-repair-seed-contracts.js";
import { inspectHostRepairSeedTypeFailure } from "./host-repair-seed-diagnostic.js";
import { sha256Digest } from "./security.js";

function fixture() {
  const content =
    '// synthetic parser fixture\nexport const repairSeedTypeWitness: number = "invalid";\n';
  const source = applicationBuildSourceFileV1Schema.parse({
    path: HOST_REPAIR_SEED_EXTENSION_PATH,
    content,
    checksum: sha256Digest(content),
    ownership: "user-owned",
    mediaType: "text/typescript",
  });
  const stdout = `${HOST_REPAIR_SEED_EXTENSION_PATH}(2,14): error TS2322: Type 'string' is not assignable to type 'number'.\n`;
  const output: ApplicationBuildCommandResult = {
    stdout,
    stderr: "",
    exitCode: 2,
    termination: "completed",
    outputBytes: Buffer.byteLength(stdout),
  };
  return { source, output };
}
describe("exact fixed TypeScript observation parser (synthetic strings only)", () => {
  it.each(["lf", "crlf", "no-newline", "stderr"])(
    "admits one exact diagnostic with %s framing",
    (framing) => {
      const f = fixture();
      let text = f.output.stdout;
      if (framing === "crlf") text = text.replaceAll("\n", "\r\n");
      if (framing === "no-newline") text = text.trimEnd();
      const output = {
        ...f.output,
        stdout: framing === "stderr" ? "" : text,
        stderr: framing === "stderr" ? text : "",
        outputBytes: Buffer.byteLength(text),
      };
      expect(inspectHostRepairSeedTypeFailure(output, f.source)).toEqual({
        code: "TS2322",
        path: HOST_REPAIR_SEED_EXTENSION_PATH,
        line: 2,
        column: 14,
        sourceDigest: f.source.checksum,
      });
    },
  );
  const changes: readonly [string, (text: string) => string][] = [
    ["duplicate", (text) => text + text],
    [
      "extra error",
      (text) => text + "other.ts(1,1): error TS2304: Cannot find name 'x'.\n",
    ],
    ["wrong code", (text) => text.replace("TS2322", "TS2304")],
    ["wrong line", (text) => text.replace("(2,14)", "(3,14)")],
    ["wrong column", (text) => text.replace("(2,14)", "(2,15)")],
    ["missing cwd prefix", (text) => text.replace("application/", "")],
    ["absolute cwd prefix", (text) => "/workspace/" + text],
    ["relative dot prefix", (text) => "./" + text],
    ["neighbor path", (text) => text.replace("custom.ts", "custom-other.ts")],
    ["truncated", (text) => text.slice(0, -8)],
    ["ANSI", (text) => "\u001b[31m" + text],
    ["control", (text) => text + "\u0000"],
    ["extra newline", (text) => text + "\n"],
    ["overflow", (text) => text + "x".repeat(8192)],
  ];
  it.each(changes)("denies %s", (_name, change) => {
    const f = fixture();
    const stdout = change(f.output.stdout);
    expect(
      inspectHostRepairSeedTypeFailure(
        { ...f.output, stdout, outputBytes: Buffer.byteLength(stdout) },
        f.source,
      ),
    ).toBeUndefined();
  });
  it.each(["timeout", "cancelled", "output-limit", "unavailable"] as const)(
    "denies %s termination even with matching text",
    (termination) => {
      const f = fixture();
      expect(
        inspectHostRepairSeedTypeFailure(
          { ...f.output, termination },
          f.source,
        ),
      ).toBeUndefined();
    },
  );
  it.each([0, null, 1.5])("denies exit code %s", (exitCode) => {
    const f = fixture();
    expect(
      inspectHostRepairSeedTypeFailure({ ...f.output, exitCode }, f.source),
    ).toBeUndefined();
  });
  it("denies split stdout/stderr and false output accounting", () => {
    const f = fixture();
    expect(
      inspectHostRepairSeedTypeFailure(
        { ...f.output, stderr: "extra", outputBytes: f.output.outputBytes + 5 },
        f.source,
      ),
    ).toBeUndefined();
    expect(
      inspectHostRepairSeedTypeFailure(
        { ...f.output, outputBytes: 0 },
        f.source,
      ),
    ).toBeUndefined();
  });
  it("requires the exact bound source, ownership and one invalid declaration", () => {
    const f = fixture();
    expect(
      inspectHostRepairSeedTypeFailure(f.output, {
        ...f.source,
        checksum: sha256Digest("wrong"),
      }),
    ).toBeUndefined();
    expect(
      inspectHostRepairSeedTypeFailure(f.output, {
        ...f.source,
        ownership: "generated",
      }),
    ).toBeUndefined();
    const content = f.source.content + f.source.content;
    expect(
      inspectHostRepairSeedTypeFailure(f.output, {
        ...f.source,
        content,
        checksum: sha256Digest(content),
      }),
    ).toBeUndefined();
  });
});
