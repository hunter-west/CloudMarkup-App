#!/usr/bin/env node

import { runArchitectureCliExecutable } from "./executable.js";
import { createManifestDeclaredConformancePortV1 } from "./manifest-conformance-source.js";

const controller = new AbortController();
process.once("SIGINT", () => {
  controller.abort();
});

// Published distributions add reviewed registrations at build time. The
// repository package intentionally contains no implicit policy or executable
// discovery and therefore fails closed for an unregistered locked profile.
process.exitCode = await runArchitectureCliExecutable({
  args: process.argv.slice(2),
  conformance: createManifestDeclaredConformancePortV1(),
  registrations: [],
  signal: controller.signal,
  stderr: process.stderr,
  stdout: process.stdout,
});
