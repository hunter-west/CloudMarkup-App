import { resolve } from "node:path";

import {
  formatSecretScanResult,
  scanSecretDirectory,
} from "./security/secret-scan-core.mjs";

const result = await scanSecretDirectory(resolve("."));
const output = formatSecretScanResult(result);
if (result.findings.length > 0 || result.coverageErrors.length > 0) {
  process.stderr.write(output);
  process.exitCode = 1;
} else {
  process.stdout.write(output);
}
