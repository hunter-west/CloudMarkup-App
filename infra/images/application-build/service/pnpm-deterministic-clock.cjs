"use strict";
const { isMainThread } = require("node:worker_threads");
if (!isMainThread) {
  Object.defineProperty(Date, "now", {
    configurable: false,
    enumerable: false,
    value: () => -1_000_000_000_000,
    writable: false,
  });
}
